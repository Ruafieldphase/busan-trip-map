/* Current-display transport owner. Inactive until privately configured and enabled. */
(function(root,factory){
 const L=typeof module==='object'&&module.exports?require('./live-transit.js'):root.TripLiveTransit;
 const api=factory(L);if(typeof module==='object'&&module.exports)module.exports=api;else root.TripLiveRequest=api;
})(globalThis,function(L){
'use strict';
const TIMEOUT_MS=15000,MAX_BODY_BYTES=2*1024*1024,MAX_BUDGET=60;
const need=ok=>{if(!ok)throw Error('LIVE_REQUEST_INVALID');};
function endpoint(value){
 if(value==null)return null;
 need(typeof value==='string'&&!/[?#]/.test(value));const u=new URL(value);
 need(u.protocol==='https:'&&!!u.hostname&&!u.username&&!u.password&&u.pathname==='/v1/transit'&&u.href===value);
 return u.href;
}
function eligible(leg){
 if(/통제|폐쇄|closed|closure/i.test(leg.mode+' '+leg.desc))return false;
 if(leg.transportModel)return leg.transportModel.steps.some(s=>['bus','subway','rail'].includes(s.mode));
 if(leg.coords||['walk','walk-candidate'].includes(leg.type))return false;
 return ['transit','unknown','transfer'].includes(leg.type);
}
function create(options={}){
 const display=options.display;need(display&&typeof display.reconcile==='function');
 const url=endpoint(options.endpoint),fetcher=options.fetch||((...args)=>globalThis.fetch(...args));
 const later=options.setTimeout||setTimeout,clear=options.clearTimeout||clearTimeout,now=options.now||Date.now,changed=options.onChange||(()=>{});
 // Rules are validated/copied before any request, never accepted from a response.
 const railRules=L.validateRailRules(options.railRules||[]);
 let context=null,current=new Map(),flight=null,timer=null,enabled=false,token=null,limit=0,used=0;
 const identity=s=>L.edgeKey(s),fingerprint=s=>JSON.stringify(s);
 function cancel(){if(flight)flight.cancel();if(timer!==null){clear(timer);timer=null;}}
 function reset(){cancel();context=null;current.clear();display.dispose();}
 function notify(entry,state){entry.state=state;display.notice(entry.spec,state);}
 function queue(entry){
  if(!enabled||entry.state)return;
  notify(entry,used>=limit?'exhausted':'queued');
 }
 function reconcile(next,specs,legs){
  need(Array.isArray(specs)&&Array.isArray(legs)&&specs.length===legs.length);
  if(!context||context.trip!==next.trip||context.day!==next.day||context.composition!==next.composition)reset();
  display.reconcile(next,specs);context={trip:next.trip,day:next.day,composition:next.composition};
  const previous=current;current=new Map();
  specs.forEach((input,i)=>{
   const s=L.normalizeEdge(input),k=identity(s),old=previous.get(k);
   need(legs[i].a===s.a&&legs[i].b===s.b&&!current.has(k));
   const entry=old&&fingerprint(old.spec)===fingerprint(s)?old:{spec:s,state:null};
   entry.automatic=eligible(legs[i]);current.set(k,entry);if(entry.automatic)queue(entry);
  });
  if(flight&&current.get(flight.key)!==flight.entry)flight.cancel();
  schedule();
 }
 function schedule(){
  if(!enabled||flight||timer!==null||![...current.values()].some(e=>e.state==='queued'))return;
  // Render/reconcile never starts a request or invokes onChange synchronously.
  timer=later(()=>{timer=null;pump();},0);
 }
 async function readBody(response,active){
  need(response&&response.ok===true&&response.body&&typeof response.body.getReader==='function');
  const length=response.headers?.get('content-length');
  if(length!==null&&length!==undefined)need(/^\d+$/.test(length)&&Number(length)<=MAX_BODY_BYTES);
  const reader=response.body.getReader();active.reader=reader;
  const decoder=new TextDecoder('utf-8',{fatal:true});let size=0,body='';
  try{
   while(true){const part=await reader.read();if(active.cancelled)throw Error('LIVE_REQUEST_CANCELLED');if(part.done)break;
    need(part.value instanceof Uint8Array);size+=part.value.byteLength;need(size<=MAX_BODY_BYTES);body+=decoder.decode(part.value,{stream:true});
   }
   body+=decoder.decode();return JSON.parse(body);
  }finally{body='';active.reader=null;try{await reader.cancel();}catch(_){}try{reader.releaseLock();}catch(_){}}
 }
 async function pump(){
  if(!enabled||flight)return;
  if(used>=limit){for(const entry of current.values())if(entry.state==='queued')notify(entry,'exhausted');changed();return;}
  const pair=[...current].find(([,e])=>e.state==='queued');if(!pair)return;
  const [k,entry]=pair,controller=new AbortController();let rejectAbort,deadline;
  const aborted=new Promise((_,reject)=>{rejectAbort=reject;});aborted.catch(()=>{});
  const active={key:k,entry,reader:null,cancelled:false,cancel(){
   if(active.cancelled)return;active.cancelled=true;controller.abort();
   try{const p=active.reader?.cancel();p?.catch(()=>{});}catch(_){}
   rejectAbort(Error('LIVE_REQUEST_CANCELLED'));
  }};
  flight=active;entry.state='pending';const ticket=display.begin(entry.spec);
  // begin can invoke rendering; a synchronously changed context must not send.
  if(!ticket||active.cancelled||current.get(k)!==entry||!enabled){active.cancel();}
  else{
   used++;deadline=later(()=>{active.timedOut=true;active.cancel();},TIMEOUT_MS);
  }
  let body=null;
  try{
   if(active.cancelled)throw Error('LIVE_REQUEST_CANCELLED');
   const s=entry.spec;
   const request=fetcher(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},
    body:JSON.stringify({start_x:s.from[1],start_y:s.from[0],end_x:s.to[1],end_y:s.to[0]}),
    signal:controller.signal,credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer'});
   const response=await Promise.race([request,aborted]);
   body=await Promise.race([readBody(response,active),aborted]);
   if(!active.cancelled&&current.get(k)===entry){
    entry.state='settled';
    const accepted=display.accept(ticket,body,{observedAt:new Date(now()).toISOString(),railRules});
    entry.state=accepted?'accepted':'failed';
   }
  }catch(_){
   controller.abort();
   if(current.get(k)===entry&&(!active.cancelled||active.timedOut)){entry.state='failed';display.fail(ticket);}
  }finally{
   body=null;clear(deadline);if(flight===active)flight=null;schedule();
  }
 }
 function enable(input){
  if(!url)return false;
  need(input&&typeof input.token==='string'&&/^[A-Za-z0-9._~-]{16,512}$/.test(input.token));
  need(Number.isInteger(input.budget)&&input.budget>=1&&input.budget<=MAX_BUDGET);
  // Disconnect, import, date changes and re-enabling never replenish this budget.
  need(limit===0||input.budget===limit);if(!limit)limit=input.budget;
  token=input.token;enabled=true;for(const entry of current.values())if(entry.automatic)queue(entry);changed();schedule();return true;
 }
 function disconnect({notify=true}={}){enabled=false;token=null;reset();if(notify)changed();}
 function request(input){
  const s=L.normalizeEdge(input),entry=current.get(identity(s));
  if(!entry||fingerprint(entry.spec)!==fingerprint(s))return false;
  if(!enabled){display.notice(entry.spec,'unavailable');changed();return false;}
  if(entry.state)return false;queue(entry);changed();schedule();return entry.state==='queued';
 }
 return Object.freeze({reconcile,enable,disconnect,request,
  get configured(){return url!==null;},get enabled(){return enabled;},
  get budget(){return Object.freeze({limit,used,remaining:enabled?Math.max(0,limit-used):0});},toJSON:()=>undefined});
}
return Object.freeze({create,eligible,TIMEOUT_MS,MAX_BODY_BYTES,MAX_BUDGET});
});
