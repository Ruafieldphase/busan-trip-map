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
 const url=endpoint(options.endpoint),walkUrl=url?url.replace('/v1/transit','/v1/walk'):null,fetcher=options.fetch||((...args)=>globalThis.fetch(...args));
 const later=options.setTimeout||setTimeout,clear=options.clearTimeout||clearTimeout,now=options.now||Date.now,changed=options.onChange||(()=>{});
 // Rules are validated/copied before any request, never accepted from a response.
 const railRules=L.validateRailRules(options.railRules||[]);
 let context=null,current=new Map(),flight=null,timer=null,enabled=false,token=null,limit=0,used=0;
 const attemptedRefinements=new Map();
 const identity=s=>L.edgeKey(s),fingerprint=s=>JSON.stringify(s);
 function cancel(){if(flight)flight.cancel();if(timer!==null){clear(timer);timer=null;}}
 function reset(){cancel();context=null;current.clear();attemptedRefinements.clear();display.dispose();}
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
   const entry=old&&fingerprint(old.spec)===fingerprint(s)?old:{spec:s,state:null,walkJobs:new Map(),refinementJobs:new Map()};
   entry.automatic=eligible(legs[i]);current.set(k,entry);if(entry.automatic)queue(entry);
  });
  if(flight&&current.get(flight.key)!==flight.entry)flight.cancel();
  schedule();
 }
 function hasRefinement(){return [...current.values()].some(e=>[...e.refinementJobs.values()].some(j=>j.state==='queued'));}
 function hasWalk(){return hasRefinement()||[...current.values()].some(e=>[...e.walkJobs.values()].some(j=>j.state==='queued'));}
 const attemptKey=(s,id)=>identity(s)+'|'+id;
 function finishRefinement(entry,job){attemptedRefinements.set(attemptKey(entry.spec,job.stepId),job.state);job.expected=null;job.slot=null;}
 function schedule(){
  if(!enabled||flight||timer!==null||(!hasWalk()&&![...current.values()].some(e=>e.state==='queued')))return;
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
  if(used>=limit){for(const entry of current.values()){
   if(entry.state==='queued')notify(entry,'exhausted');for(const job of entry.walkJobs.values())if(job.state==='queued')job.state='exhausted';
   for(const job of entry.refinementJobs.values())if(job.state==='queued'){job.state='exhausted';display.refinementState(entry.spec,job.expected,job.stepId,'exhausted');finishRefinement(entry,job);}
  }changed();return;}
  const refinement=[...current].flatMap(([key,entry])=>[...entry.refinementJobs.values()].filter(job=>job.state==='queued').map(job=>({key,entry,job})))[0];
  const walking=refinement||[...current].flatMap(([key,entry])=>[...entry.walkJobs.values()].filter(job=>job.state==='queued').map(job=>({key,entry,job})))[0];
  const pair=walking?[walking.key,walking.entry]:[...current].find(([,e])=>e.state==='queued');if(!pair)return;const job=walking?.job;
  const [k,entry]=pair;
  if(job?.kind==='refinement'&&(display.current(entry.spec)!==job.expected||!display.refinementTarget(entry.spec,job.expected,job.stepId))){
   job.state='failed';job.reason='unsupported_response';
   display.refinementState(entry.spec,display.current(entry.spec),job.stepId,'failed',job.reason);finishRefinement(entry,job);changed();schedule();return;
  }
  const controller=new AbortController();let rejectAbort,deadline;
  const aborted=new Promise((_,reject)=>{rejectAbort=reject;});aborted.catch(()=>{});
  const active={key:k,entry,reader:null,cancelled:false,cancel(){
   if(active.cancelled)return;active.cancelled=true;controller.abort();
   closeReader(active);
   rejectAbort(Error('LIVE_REQUEST_CANCELLED'));
  }};
  flight=active;if(job)job.state='pending';else entry.state='pending';
  let expected=job?display.current(entry.spec):null;
  if(job?.kind==='refinement')expected=display.refinementState(entry.spec,job.expected,job.stepId,'pending');
  const ticket=job?expected:display.begin(entry.spec);
  // begin can invoke rendering; a synchronously changed context must not send.
  if(!ticket||active.cancelled||current.get(k)!==entry||!enabled){active.cancel();}
  else{
   used++;deadline=later(()=>{active.timedOut=true;active.cancel();},TIMEOUT_MS);
  }
  let body=null,response=null;
  try{
   if(active.cancelled)throw Error('LIVE_REQUEST_CANCELLED');
   const s=job?{from:job.slot.from,to:job.slot.to}:entry.spec;
   const request=Promise.resolve(fetcher(job?walkUrl:url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},
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
    if(job){
     const options={observedAt:new Date(now()).toISOString()};
     const accepted=job.kind==='refinement'?display.acceptRefinement(entry.spec,expected,job.stepId,body,options):display.acceptWalk(entry.spec,expected,job.slot.id,body,options);
     job.state=accepted?'accepted':'failed';if(!accepted){job.reason='unsupported_response';if(job.kind==='refinement')display.refinementState(entry.spec,display.current(entry.spec),job.stepId,'failed',job.reason);}changed();
    }
    else{entry.state='settled';const accepted=display.accept(ticket,body,{observedAt:new Date(now()).toISOString(),railRules});entry.state=accepted?'accepted':'failed';}
   }
  }catch(error){
   controller.abort();
   if(current.get(k)===entry&&(!active.cancelled||active.timedOut)){
    const reason=active.timedOut?'timeout':error instanceof Failure?error.reason:'network_unconfirmed';
    if(job){job.state='failed';job.reason=reason;if(job.kind==='refinement')display.refinementState(entry.spec,display.current(entry.spec),job.stepId,'failed',reason);changed();}else{entry.state='failed';display.fail(ticket,reason);}
   }
  }finally{
   if(job?.kind==='refinement'){if(current.get(k)===entry)finishRefinement(entry,job);else{job.expected=null;job.slot=null;}}
   body=null;if(response&&!active.responseHandled)discardResponse(response);response=null;closeReader(active);clear(deadline);if(flight===active)flight=null;if(enabled&&current.get(k)===entry)changed();schedule();
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
 
 // Planning never queues. Only an explicit selected-leg action starts a walk batch.
 function walkPlan(input){
  const s=L.normalizeEdge(input),entry=current.get(identity(s)),model=display.current?.(s);
  const valid=!!entry&&fingerprint(entry.spec)===fingerprint(s)&&entry.state==='accepted'&&!!model;
  const slots=valid?model.connectorSlots:[],tooMany=slots.length>L.MAX_CONNECTORS,regional=p=>p[1]>=128.7&&p[1]<=129.4&&p[0]>=34.8&&p[0]<=35.5;
  const available=tooMany?[]:slots.filter(slot=>regional(slot.from)&&regional(slot.to)&&!entry.walkJobs.has(slot.id));
  const jobs=entry?[...entry.walkJobs.values()]:[],failed=jobs.filter(j=>j.state==='failed').length,pending=jobs.filter(j=>['pending','queued'].includes(j.state)).length,accepted=jobs.filter(j=>j.state==='accepted').length;
  const count=enabled&&!flight&&!hasRefinement()&&valid&&!pending?Math.min(available.length,Math.max(0,limit-used)):0;
  return Object.freeze({count,eligible:available.length,failed,pending,accepted,tooMany,busy:!!flight,enabled,unavailable:slots.filter(slot=>!regional(slot.from)||!regional(slot.to)).length,
   text:tooMany?'연결 간격 수가 안전 한도(20)를 초과하여 전송하지 않습니다.':`도보 추가 조회 ${count}회 가능 · 성공 ${accepted} · 대기 ${pending} · 실패 ${failed} · 실패 자동 재시도 없음 · 버스 선형 유지 · 남은 간격·출입구·현장 미검증`+jobs.filter(j=>j.state==='failed').map(j=>' · '+({access:'접근',exit:'이탈',transfer:'환승'}[j.slot.role])+' '+j.slot.id+': '+L.failureText(j.reason)).join('')});
 }
 function requestWalk(input){
  const s=L.normalizeEdge(input),plan=walkPlan(s);if(!plan.count)return false;
  const entry=current.get(identity(s)),model=display.current(s),regional=p=>p[1]>=128.7&&p[1]<=129.4&&p[0]>=34.8&&p[0]<=35.5;
  const slots=model.connectorSlots.filter(slot=>regional(slot.from)&&regional(slot.to)&&!entry.walkJobs.has(slot.id)).slice(0,plan.count);
  for(const slot of slots)entry.walkJobs.set(slot.id,{slot,state:'queued'});
  changed();schedule();return true;
 }
 // A single explicit source-step recheck; planning cannot queue or spend.
 function refinementPlan(input,expected,stepId){
  const s=L.normalizeEdge(input),entry=current.get(identity(s)),model=display.current?.(s);
  const valid=!!entry&&fingerprint(entry.spec)===fingerprint(s)&&entry.state==='accepted'&&model===expected&&!!model;
  const target=valid?display.refinementTarget(s,expected,stepId):null;
  const regional=p=>p[1]>=128.7&&p[1]<=129.4&&p[0]>=34.8&&p[0]<=35.5;
  const eligible=!!target&&regional(target.coords[0])&&regional(target.coords.at(-1))&&L.meters(target.coords[0],target.coords.at(-1))>.5;
  const job=entry?.refinementJobs.get(stepId),record=model?.refinements.find(r=>r.originalStepId===stepId),previous=attemptedRefinements.get(attemptKey(s,stepId));
  const busy=!!flight||hasWalk()||[...current.values()].some(e=>e.state==='queued');
  const state=job?.state||record?.state||previous||(!eligible?'unavailable':!enabled?'disabled':busy?'busy':model.refinements.length>=L.MAX_REFINEMENTS||attemptedRefinements.size>=MAX_BUDGET?'limited':used>=limit?'exhausted':'available');
  const messages={available:'선택한 도보를 1회 재확인 · 상세 개선 보장 없음',unavailable:'재확인 대상이 아닙니다',disabled:'연결을 켜야 재확인할 수 있습니다',busy:'다른 요청이 끝난 뒤 선택하세요',limited:'이 구간의 재확인 안전 한도에 도달했습니다',queued:'도보 1회 재확인 대기',pending:'도보 1회 재확인 중',accepted:'재확인 응답 반영 · 상세 개선·도로 정합 미검증',failed:'도보 재확인 실패 · 재시도 없음',exhausted:'세션 요청 한도 소진 · 재확인 보류'};
  return Object.freeze({count:eligible&&enabled&&!busy&&state==='available'?1:0,state,eligible,enabled,busy,text:record?.message||messages[state]});
 }
 function requestRefinement(input,expected,stepId){
  const s=L.normalizeEdge(input),plan=refinementPlan(s,expected,stepId);
  if(!plan.count&&!(plan.eligible&&plan.enabled&&!plan.busy&&plan.state==='exhausted'))return false;
  const entry=current.get(identity(s));if(entry.refinementJobs.has(stepId)||attemptedRefinements.has(attemptKey(s,stepId)))return false;
  const target=display.refinementTarget(s,expected,stepId);if(!target)return false;
  const state=plan.count?'queued':'exhausted',job={kind:'refinement',stepId,state,expected:null,slot:state==='queued'?{from:target.coords[0],to:target.coords.at(-1)}:null};
  entry.refinementJobs.set(stepId,job);attemptedRefinements.set(attemptKey(s,stepId),state);
  const next=display.beginRefinement(s,expected,stepId,new Date(now()).toISOString(),state);
  if(!next){job.state='failed';job.reason='unsupported_response';finishRefinement(entry,job);changed();return false;}
  job.expected=state==='queued'?next:null;changed();schedule();return state==='queued';
 }
 return Object.freeze({reconcile,enable,disconnect,request,walkPlan,requestWalk,refinementPlan,requestRefinement,
  get configured(){return url!==null;},get enabled(){return enabled;},
  get budget(){return Object.freeze({limit,used,remaining:enabled?Math.max(0,limit-used):0});},toJSON:()=>undefined});
}
return Object.freeze({create,eligible,validToken,TIMEOUT_MS,MAX_BODY_BYTES,MAX_BUDGET});
});
