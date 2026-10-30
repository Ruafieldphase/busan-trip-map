/* Current-display transport owner. Inactive until privately configured and enabled. */
(function(root,factory){
 const L=typeof module==='object'&&module.exports?require('./live-transit.js'):root.TripLiveTransit;
 const api=factory(L);if(typeof module==='object'&&module.exports)module.exports=api;else root.TripLiveRequest=api;
})(globalThis,function(L){
'use strict';
const TIMEOUT_MS=15000,MAX_BODY_BYTES=2*1024*1024,MAX_BUDGET=60;
const need=ok=>{if(!ok)throw Error('LIVE_REQUEST_INVALID');};
class Failure extends Error{constructor(reason){super('LIVE_REQUEST_FAILED');this.reason=reason;}}
const validBody=ok=>{if(!ok)throw new Failure('invalid_body');};
function responseFailure(response){
 // Status 0 (including opaque/error responses) is never HTTP/auth evidence.
 if(!response||response.status===0||['opaque','opaqueredirect','error'].includes(response.type))return 'network_unconfirmed';
 const status=response.status;
 if(Number.isInteger(status)&&status>=100&&status<=599){if(status>=200&&status<300&&response.ok===true)return null;}
 else return response.ok===true&&status===undefined?null:'network_unconfirmed';
 return {401:'authentication',403:'authorization',503:'service_unavailable',502:'upstream_gateway'}[status]||'http_failure';
}
function discardResponse(response){try{const p=response?.body?.cancel();p?.catch(()=>{});}catch(_){}}
function closeReader(active){
 const reader=active.reader;if(!reader)return;active.reader=null;
 try{const p=reader.cancel();p?.catch(()=>{});}catch(_){}
 try{reader.releaseLock();}catch(_){}
}
// Header-safe caller format; preserve the exact supplied value for server comparison.
function validToken(value){return typeof value==='string'&&value.length>=32&&value.length<=512&&!/[^\x21-\x7e]/.test(value);}
function endpoint(value){
 if(value==null)return null;
 need(typeof value==='string'&&!/[?#]/.test(value));const u=new URL(value);
 need(u.protocol==='https:'&&!!u.hostname&&!u.username&&!u.password&&u.pathname==='/v1/transit'&&u.href===value);
 return u.href;
}
function eligible(leg){
 if(/통제|폐쇄|closed|closure/i.test(leg.mode+' '+leg.desc))return false;
 if(leg.transportModel)return leg.transportModel.steps.some(s=>['bus','subway','rail'].includes(s.mode));
 // Explicit transit intent must not be lost behind a legacy type or stored line.
 if(['bus','subway','rail','transit'].includes(leg.type))return true;
 if(leg.coords||['walk','walk-candidate'].includes(leg.type))return false;
 return ['unknown','transfer'].includes(leg.type);
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
  validBody(response.body&&typeof response.body.getReader==='function');
  const length=response.headers?.get('content-length');
  if(length!==null&&length!==undefined)validBody(/^\d+$/.test(length)&&Number(length)<=MAX_BODY_BYTES);
  let reader;try{reader=response.body.getReader();}catch(_){throw new Failure('invalid_body');}
  active.reader=reader;active.responseHandled=true;
  const decoder=new TextDecoder('utf-8',{fatal:true});let size=0,body='';
  const decode=(...args)=>{try{return decoder.decode(...args);}catch(_){throw new Failure('invalid_body');}};
  try{
   while(true){const part=await reader.read();if(active.cancelled)throw Error('LIVE_REQUEST_CANCELLED');if(part.done)break;
    validBody(part.value instanceof Uint8Array);size+=part.value.byteLength;validBody(size<=MAX_BODY_BYTES);body+=decode(part.value,{stream:true});
   }
   body+=decode();try{return JSON.parse(body);}catch(_){throw new Failure('invalid_body');}
  }finally{body='';closeReader(active);}
 }
 async function pump(){
  if(!enabled||flight)return;
  if(used>=limit){for(const entry of current.values())if(entry.state==='queued')notify(entry,'exhausted');changed();return;}
  const pair=[...current].find(([,e])=>e.state==='queued');if(!pair)return;
  const [k,entry]=pair,controller=new AbortController();let rejectAbort,deadline;
  const aborted=new Promise((_,reject)=>{rejectAbort=reject;});aborted.catch(()=>{});
  const active={key:k,entry,reader:null,cancelled:false,cancel(){
   if(active.cancelled)return;active.cancelled=true;controller.abort();
   closeReader(active);
   rejectAbort(Error('LIVE_REQUEST_CANCELLED'));
  }};
  flight=active;entry.state='pending';const ticket=display.begin(entry.spec);
  // begin can invoke rendering; a synchronously changed context must not send.
  if(!ticket||active.cancelled||current.get(k)!==entry||!enabled){active.cancel();}
  else{
   used++;deadline=later(()=>{active.timedOut=true;active.cancel();},TIMEOUT_MS);
  }
  let body=null,response=null;
  try{
   if(active.cancelled)throw Error('LIVE_REQUEST_CANCELLED');
   const s=entry.spec;
   const request=Promise.resolve(fetcher(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},
    body:JSON.stringify({start_x:s.from[1],start_y:s.from[0],end_x:s.to[1],end_y:s.to[0]}),
    signal:controller.signal,credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer'})).then(value=>{
     // Fetch may ignore abort and resolve after its owner was disposed.
     if(active.cancelled){discardResponse(value);return null;}return value;
    });
   changed(); // Fetch has been invoked: render the incremented used count while pending.
   response=await Promise.race([request,aborted]);
   if(active.cancelled)throw Error('LIVE_REQUEST_CANCELLED');
   const reason=responseFailure(response);if(reason)throw new Failure(reason);
   body=await Promise.race([readBody(response,active),aborted]);
   if(!active.cancelled&&current.get(k)===entry){
    entry.state='settled';
    const accepted=display.accept(ticket,body,{observedAt:new Date(now()).toISOString(),railRules});
    entry.state=accepted?'accepted':'failed';
   }
  }catch(error){
   controller.abort();
   if(current.get(k)===entry&&(!active.cancelled||active.timedOut)){
    entry.state='failed';display.fail(ticket,active.timedOut?'timeout':error instanceof Failure?error.reason:'network_unconfirmed');
   }
  }finally{
   body=null;if(response&&!active.responseHandled)discardResponse(response);response=null;closeReader(active);clear(deadline);if(flight===active)flight=null;schedule();
  }
 }
 function enable(input){
  if(!url)return false;
  need(input&&validToken(input.token));
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
return Object.freeze({create,eligible,validToken,TIMEOUT_MS,MAX_BODY_BYTES,MAX_BUDGET});
});
