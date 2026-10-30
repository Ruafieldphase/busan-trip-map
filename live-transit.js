/* Current-screen transit only. No transport, persistence, response history or credentials. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TripLiveTransit=api;})(globalThis,function(){
'use strict';
const MAX_STEPS=200,MAX_VERTICES=50000,MAX_STEP_VERTICES=20000;
const labels={walk:'도보',bus:'버스',subway:'지하철',rail:'철도',transfer:'환승 이동'};
const colors={walk:'#269666',bus:'#519be5',subway:'#ba8bed',rail:'#ba8bed',transfer:'#e7be69'};
// Fixed diagnostics only. Never accept an exception/body/header as UI text.
const failureMessages=Object.freeze({
 authentication:'인증 확인 필요 (HTTP 401) · 연결 코드를 확인하세요',
 authorization:'접근 권한 확인 필요 (HTTP 403) · 연결 허용 설정을 확인하세요',
 service_unavailable:'서비스 설정 또는 가용성 확인 필요 (HTTP 503)',
 upstream_gateway:'게이트웨이가 상위 경로 응답을 받지 못했습니다 (HTTP 502)',
 http_failure:'서버가 HTTP 오류를 반환했습니다',
 network_unconfirmed:'읽을 수 있는 응답 없음 · 네트워크·브라우저 정책·서버 상태 중 원인은 미확인입니다',
 timeout:'요청 제한 시간 초과',
 invalid_body:'응답 본문 형식 또는 크기를 확인할 수 없습니다',
 unsupported_response:'지원하지 않거나 유효하지 않은 경로 응답 구조입니다',
 unclassified:'실패 원인 미확인'
});
const failureReason=v=>typeof v==='string'&&Object.hasOwn(failureMessages,v)?v:'unclassified';
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const need=ok=>{if(!ok)throw Error('LIVE_TRANSIT_INVALID');};
const point=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=90&&Math.abs(p[1])<=180;
const text=(v,max=2000)=>{need(typeof v==='string'&&v.length<=max);return v;};
const metric=v=>{need(Number.isFinite(v)&&v>=0&&v<=10000000);return v;};
function meters(a,b){const r=Math.PI/180,dlat=(b[0]-a[0])*r,dlon=(b[1]-a[1])*r,h=Math.sin(dlat/2)**2+Math.cos(a[0]*r)*Math.cos(b[0]*r)*Math.sin(dlon/2)**2;return 12742000*Math.asin(Math.sqrt(Math.min(1,h)));}
// Guard accidental JSON serialization of runtime-owned display trees, including
// arrays obtained by a renderer. This is not a security boundary against copying.
function ephemeral(v){if(v&&typeof v==='object'&&!Object.isFrozen(v)){for(const x of Object.values(v))ephemeral(x);Object.defineProperty(v,'toJSON',{value:()=>undefined});Object.freeze(v);}return v;}
function edge(spec){
 need(object(spec)&&typeof spec.a==='string'&&typeof spec.b==='string'&&spec.a!==spec.b&&point(spec.from)&&point(spec.to));
 const kind=v=>{need(['place','stop','entrance','platform'].includes(v));return v;};
 return {a:text(spec.a,80),b:text(spec.b,80),from:[...spec.from],to:[...spec.to],fromKind:kind(spec.fromKind||'place'),toKind:kind(spec.toKind||'place'),approx:[spec.approx?.[0]===true,spec.approx?.[1]===true]};
}
const key=s=>JSON.stringify([s.a,s.b,s.from,s.to]);
function validateRailRules(rules){
 need(Array.isArray(rules)&&rules.length<=20);const seen=new Set();
 return Object.freeze(rules.map(rule=>{
  need(object(rule)&&rule.providerMode==='SUBWAY'&&object(rule.vehicle)&&object(rule.evidence));
  const vehicle={name:text(rule.vehicle.name,400),type:text(rule.vehicle.type,100)},e=rule.evidence;
  need(vehicle.name.trim().length>0&&vehicle.type.trim().length>0);
  const evidence={source:text(e.source,400),reference:text(e.reference,1000),observedAt:text(e.observedAt,80),verification:e.verification};
  need(evidence.source.trim().length>0&&evidence.reference.trim().length>0&&Number.isFinite(Date.parse(evidence.observedAt))&&e.verification==='source-verified');
  const id=JSON.stringify(vehicle);need(!seen.has(id));seen.add(id);
  return Object.freeze({providerMode:'SUBWAY',vehicle:Object.freeze(vehicle),evidence:Object.freeze(evidence)});
 }));
}
function parseResponse(body,input,{routeIndex=0,observedAt,railRules=[]}={}){
 const rules=validateRailRules(railRules);
 const spec=edge(input);need(object(body)&&body.status==='OK'&&Array.isArray(body.routes)&&body.routes.length>0&&body.routes.length<=100);
 need(Number.isInteger(routeIndex)&&routeIndex>=0&&routeIndex<body.routes.length);
 need(typeof observedAt==='string'&&observedAt.length<=80&&Number.isFinite(Date.parse(observedAt)));
 const route=body.routes[routeIndex];need(object(route)&&object(route.properties)&&Array.isArray(route.steps)&&route.steps.length>0&&route.steps.length<=MAX_STEPS);
 // Route properties are structurally required, but not copied/retained. Step
 // distance/time remain per-step provider estimates; no fabricated total.
 let vertices=0;
 const raw=route.steps.map((step,i)=>{
  need(object(step)&&object(step.properties)&&object(step.path));const p=step.properties;
  need(['BUS','SUBWAY','WALKING'].includes(p.type));
  const points=step.path.points;need(Array.isArray(points)&&points.length>=2&&points.length<=MAX_STEP_VERTICES);
  vertices+=points.length;need(vertices<=MAX_VERTICES);
  // The ONLY provider lon/lat -> renderer lat/lon conversion.
  const coords=points.map(p=>{need(Array.isArray(p)&&p.length===2&&p.every(Number.isFinite));const c=[p[1],p[0]];need(point(c));return c;});
  need(coords.some(c=>meters(coords[0],c)>.1));
  // Bound unsupported regional excursions and implausible individual jumps.
  need(coords.every((c,j)=>meters(spec.from,c)<=300000&&meters(spec.to,c)<=300000&&(!j||meters(coords[j-1],c)<=50000)));
  const names=(list,vehicles=false)=>{if(list===undefined)return [];need(Array.isArray(list)&&list.length<=500);return list.map(v=>{need(object(v));const n={name:text(v.name,400)};if(vehicles)n.type=text(v.type,100);return n;});};
  return {id:'live-step-'+i,providerMode:p.type,mode:{BUS:'bus',SUBWAY:'subway',WALKING:'walk'}[p.type],coords,guidance:text(p.guidance),distance:metric(p.distance),duration:metric(p.time),stops:names(p.stops),vehicles:names(p.vehicles,true)};
 });
 const first=raw[0].coords[0],last=raw.at(-1).coords.at(-1);
 // Reject a known reversed overall direction; never silently reverse geometry.
 need(meters(spec.from,spec.to)<=1||meters(spec.from,first)+meters(spec.to,last)<=meters(spec.to,first)+meters(spec.from,last)+.5);
 // A locally reversed step is detectable only with independent neighbours.
 // Missing intermediate stop coordinates cannot establish headsign/platform direction.
 for(let i=0;i<raw.length;i++){
  const s=raw[i],a=i?raw[i-1].coords.at(-1):spec.from,b=i+1<raw.length?raw[i+1].coords[0]:spec.to;
  need(meters(a,s.coords[0])+meters(s.coords.at(-1),b)<=meters(a,s.coords.at(-1))+meters(s.coords[0],b)+.5);
 }
 const issues=['현재 공급원 응답 · 실제 도로·현장·운영·출입구 미검증'],gaps=[];
 const gap=(a,b,message)=>{issues.push(message);if(meters(a,b)>.5)gaps.push({coords:[[...a],[...b]],message});};
 const endpoint=(coords,name,kind)=>({coords,name,kind,evidence:{source:'Kakao 현재 응답 끝점',reference:null,observedAt,verification:'unverified'}});
 const isTransit=s=>s.providerMode==='BUS'||s.providerMode==='SUBWAY';
 const steps=raw.map((s,i)=>{
  if(s.mode==='walk')s.walkRole=raw.slice(0,i).some(isTransit)&&raw.slice(i+1).some(isTransit)?'transfer':raw.slice(0,i).some(isTransit)?'exit':raw.slice(i+1).some(isTransit)?'access':'standalone';
  if(s.walkRole==='transfer')s.mode='transfer';
  // Only one exact, explicitly evidenced service identity can rename this ride.
  const rail=s.providerMode==='SUBWAY'&&s.vehicles.length===1&&rules.find(r=>r.vehicle.name===s.vehicles[0].name&&r.vehicle.type===s.vehicles[0].type);
  if(rail){s.mode='rail';s.railIdentityEvidence=rail.evidence;}
  const transit=isTransit(s),kind=transit?'stop':'place';
  const from=endpoint(s.coords[0],s.stops[0]?.name||'제공 경로 시작점',kind),to=endpoint(s.coords.at(-1),s.stops.at(-1)?.name||'제공 경로 끝점',kind);
  const service=s.vehicles.map(v=>v.name).filter(Boolean).join(', ');
  const instruction=labels[s.mode]+(service?' '+service:'')+' · '+(s.guidance||'상세 안내 없음')+(s.stops.length?' · '+s.stops.map(v=>v.name).join(' → '):'');
  return {...s,number:i+1,from,to,color:colors[s.mode],geometryBacked:true,endpointOnly:s.coords.length===2,instruction,measure:`${(s.distance/1000).toFixed(2)}km · 제공자 약 ${Math.round(s.duration/60)}분`,issues:[],evidenceText:'Kakao 현재 응답 / '+observedAt+' / 현장 미검증',geometryEvidence:s.coords.length===2?'Kakao 현재 응답 좌표 2개 · 상세 경로·도로 정합 미확인':'Kakao 현재 응답 선형 · 도로 정합 미검증',serviceEvidence:transit?'현재 응답의 정류장·차량 표기 · 승강장·행선지 현장 미검증'+(rail?' / 철도 식별 근거: '+rail.evidence.source+' / '+rail.evidence.reference+' / '+rail.evidence.observedAt:''):null};
 });
 for(const s of steps)if(s.endpointOnly)issues.push(`${s.number}단계: 공급원 좌표 2개 · 두 점만으로 실제 경로 확인 불가`);
 // Exact stop/platform destinations require no invented zero-length walking.
 // An ordinary pin at the same coordinate still is not an entrance proof.
 const checkEnd=(pin,path,kind,step,side)=>{
  const d=meters(pin,path),place=kind==='place',walking=step.providerMode==='WALKING';
  if(d>.5)gap(pin,path,`${side}: 원래 핀과 응답 끝점 ${Math.round(d)}m 차이 · 연결 경로 없음`);
  if(place&&!walking)issues.push(`${side}: 장소 핀에서 승하차점까지 ${side==='출발'?'접근':'이탈'} 도보 근거 없음`);
  if(place)issues.push(`${side}: 건물·승강장 출입구 미확인`);
 };
 checkEnd(spec.from,first,spec.fromKind,raw[0],'출발');checkEnd(spec.to,last,spec.toKind,raw.at(-1),'도착');
 if(spec.approx.some(Boolean))issues.push('원래 개략 핀 유지 · 응답 끝점은 실제 출입구 근거가 아님');
 for(let i=1;i<steps.length;i++){
  const a=steps[i-1],b=steps[i];if(meters(a.coords.at(-1),b.coords[0])>.5)gap(a.coords.at(-1),b.coords[0],`${i}→${i+1}단계: 연결 경로 없음 · 환승·접근 미확인`);
  if(isTransit(a)&&isTransit(b))issues.push(`${i}→${i+1}단계: 명시적 환승 이동 없음`);
 }
 return ephemeral({live:true,status:'partial',baseSteps:steps,connectorSlots:slotsFor(spec,steps),walkConnections:[],steps,gaps,issues,sourceText:'Kakao 현재 응답 · 화면에서만 표시',observedAt});
}

const MAX_CONNECTORS=20;
function slotsFor(spec,steps){
 const slots=[];const add=(from,to,index,role)=>{if(meters(from,to)>.5)slots.push({id:'live-connector-'+slots.length,from:[...from],to:[...to],index,role});};
 add(spec.from,steps[0].coords[0],0,'access');
 for(let i=1;i<steps.length;i++){const left=steps.slice(0,i).some(s=>['BUS','SUBWAY'].includes(s.providerMode)),right=steps.slice(i).some(s=>['BUS','SUBWAY'].includes(s.providerMode));add(steps[i-1].coords.at(-1),steps[i].coords[0],i,left&&right?'transfer':left?'exit':right?'access':'transfer');}
 add(steps.at(-1).coords.at(-1),spec.to,steps.length,'exit');return slots;
}
function parseWalkResponse(body,input,{observedAt,idPrefix='live-connector-0',role='transfer'}={}){
 const spec=edge(input);need(['access','exit','transfer'].includes(role)&&typeof idPrefix==='string'&&/^live-connector-\d+$/.test(idPrefix));
 need(typeof observedAt==='string'&&observedAt.length<=80&&Number.isFinite(Date.parse(observedAt)));
 need(object(body)&&body.status==='OK'&&!Object.hasOwn(body,'routes')&&object(body.route));
 const route=body.route,allowed=p=>{need(object(p)&&(!Object.hasOwn(p,'type')||p.type==='WALKING')&&!Object.hasOwn(p,'vehicles'));};
 allowed(route.properties);metric(route.properties.totalDistance);metric(route.properties.totalTime);text(route.properties.landingUrl);
 need(Array.isArray(route.legs)&&route.legs.length>=1&&route.legs.length<=20);
 let vertices=0,count=0;const steps=[];
 route.legs.forEach((leg,li)=>{
  need(object(leg));allowed(leg.properties);metric(leg.properties.distance);metric(leg.properties.time);
  need(Array.isArray(leg.steps)&&leg.steps.length>=1&&leg.steps.length<=MAX_STEPS);
  leg.steps.forEach((step,si)=>{
   need(++count<=MAX_STEPS&&object(step)&&object(step.path));const p=step.properties;allowed(p);
   const guidance=text(p.guidance),distance=metric(p.distance),duration=metric(p.time);need(point([p.y,p.x]));
   const points=step.path.points;need(Array.isArray(points)&&points.length>=2&&points.length<=MAX_STEP_VERTICES);vertices+=points.length;need(vertices<=MAX_VERTICES);
   const coords=points.map(p=>{need(Array.isArray(p)&&p.length===2&&p.every(Number.isFinite));const c=[p[1],p[0]];need(point(c));return c;});
   need(coords.some(c=>meters(coords[0],c)>.1));
   need(coords.every((c,i)=>meters(spec.from,c)<=300000&&meters(spec.to,c)<=300000&&(!i||meters(coords[i-1],c)<=50000)));
   const endpoint=c=>({coords:c,name:'도보 응답 끝점',kind:'place',evidence:{source:'Kakao 현재 도보 응답 끝점',reference:null,observedAt,verification:'unverified'}});
   steps.push({id:idPrefix+'-leg-'+li+'-step-'+si,providerMode:'WALKING',mode:role==='transfer'?'transfer':'walk',walkRole:role,coords,guidance,distance,duration,from:endpoint(coords[0]),to:endpoint(coords.at(-1)),color:colors[role==='transfer'?'transfer':'walk'],geometryBacked:true,endpointOnly:coords.length===2,instruction:({access:'접근 도보',exit:'이탈 도보',transfer:'환승 이동'}[role])+' · '+guidance,measure:`${(distance/1000).toFixed(2)}km · 제공자 약 ${Math.round(duration/60)}분`,issues:[],evidenceText:'Kakao 현재 도보 응답 / '+observedAt+' / 현장 미검증',geometryEvidence:coords.length===2?'Kakao 도보 응답 좌표 2개 · 상세 경로·도로 정합 미확인':'Kakao 현재 도보 응답 선형 · 도로 정합 미검증',serviceEvidence:null});
  });
 });
 const first=steps[0].coords[0],last=steps.at(-1).coords.at(-1);
 need(meters(spec.from,spec.to)>.5);
 need(meters(spec.from,first)+meters(spec.to,last)<=meters(spec.to,first)+meters(spec.from,last)+.5);
 for(let i=0;i<steps.length;i++){const s=steps[i],a=i?steps[i-1].coords.at(-1):spec.from,b=i+1<steps.length?steps[i+1].coords[0]:spec.to;need(meters(a,s.coords[0])+meters(s.coords.at(-1),b)<=meters(a,s.coords.at(-1))+meters(s.coords[0],b)+.5);}
 return ephemeral({steps,observedAt,sourceText:'Kakao 현재 도보 응답 · 화면에서만 표시'});
}
function mergeWalk(model,spec,slot,result){
 need(model.live&&model.connectorSlots.includes(slot)&&!model.walkConnections.some(c=>c.slotId===slot.id));
 const connections=[...model.walkConnections,{slotId:slot.id,steps:result.steps}],steps=[];
 for(let i=0;i<=model.baseSteps.length;i++){
  for(const s of model.connectorSlots.filter(s=>s.index===i)){const c=connections.find(c=>c.slotId===s.id);if(c)steps.push(...c.steps);}
  if(i<model.baseSteps.length)steps.push(model.baseSteps[i]);
 }
 need(steps.length<=MAX_STEPS&&steps.reduce((n,s)=>n+s.coords.length,0)<=MAX_VERTICES);
 const numbered=steps.map((s,i)=>({...s,number:i+1})),gaps=[],issues=model.issues.filter(x=>!/연결 경로 없음|접근 도보 근거 없음|이탈 도보 근거 없음|명시적 환승 이동 없음/.test(x));
 const gap=(a,b,message)=>{if(meters(a,b)>.5){issues.push(message);gaps.push({coords:[[...a],[...b]],message});}};
 gap(spec.from,numbered[0].coords[0],'출발: 도보 응답 후에도 원래 핀까지 연결 경로 없음 · 진입 미확인');
 for(let i=1;i<numbered.length;i++){
  const a=numbered[i-1],b=numbered[i];gap(a.coords.at(-1),b.coords[0],i+'→'+(i+1)+'단계: 도보 응답 후에도 연결 경로 없음 · 환승·접근 미확인');
  if(a.providerMode!=='WALKING'&&b.providerMode!=='WALKING')issues.push(i+'→'+(i+1)+'단계: 명시적 환승 이동 없음');
 }
 gap(numbered.at(-1).coords.at(-1),spec.to,'도착: 도보 응답 후에도 원래 핀까지 연결 경로 없음 · 진입 미확인');
 if(spec.fromKind==='place'&&numbered[0].providerMode!=='WALKING')issues.push('출발: 장소 핀에서 승하차점까지 접근 도보 근거 없음');
 if(spec.toKind==='place'&&numbered.at(-1).providerMode!=='WALKING')issues.push('도착: 장소 핀에서 승하차점까지 이탈 도보 근거 없음');
 for(const s of result.steps)if(s.endpointOnly)issues.push(s.id+': 도보 응답 좌표 2개 · 두 점만으로 실제 경로 확인 불가');
 return ephemeral({...model,steps:numbered,gaps,issues:[...new Set(issues)],walkConnections:connections,status:'partial'});
}

function asLeg(original,model){
 const leg={...original,type:'composite',mode:'대중교통 · 현재 응답',coords:null,distance:null,duration:null,transportModel:model,liveTransit:true,source:model.sourceText,queriedAt:model.observedAt,desc:'현재 응답을 일시 표시합니다. 도로 정합·현장·운영 검증은 별도입니다. 원본 이동 메모: '+original.mode+' / '+original.desc};
 // Do not freeze, decorate or mutate source-owned nested trip objects.
 Object.defineProperty(leg,'toJSON',{value:()=>undefined});return Object.freeze(leg);
}
function create({onChange=()=>{}}={}){
 let context=null,edges=new Map(),models=new Map(),pending=new Map(),notices=new Map();
 function dispose(){context=null;edges.clear();models.clear();pending.clear();notices.clear();}
 function reconcile(next,specs){
  need(object(next)&&next.trip&&typeof next.day==='string'&&typeof next.composition==='string'&&Array.isArray(specs)&&specs.length<=500);
  if(!context||context.trip!==next.trip||context.day!==next.day||context.composition!==next.composition)dispose();
  context={trip:next.trip,day:next.day,composition:next.composition};
  const current=new Map(specs.map(s=>{const e=edge(s);return [key(e),e];}));
  // Keep current unaffected edges only. Removed edges cannot revive on re-add.
  for(const k of edges.keys())if(!current.has(k)||JSON.stringify(edges.get(k))!==JSON.stringify(current.get(k))){models.delete(k);pending.delete(k);notices.delete(k);}
  edges=current;
 }
 // Notice updates are batched by the request owner's render reconciliation.
 function notice(input,status){const k=key(edge(input));need(['queued','exhausted','unavailable'].includes(status));if(!edges.has(k)||models.has(k)||pending.has(k))return false;notices.set(k,{status});return true;}
 function begin(input){const k=key(edge(input));if(!edges.has(k))return null;const token=Object.freeze({});pending.set(k,token);models.delete(k);notices.delete(k);onChange();return token;}
 function locate(token){if(!token)return null;for(const [k,t] of pending)if(t===token)return k;return null;}
 function accept(token,body,options){
  const k=locate(token);if(k===null)return false;pending.delete(k);
  try{models.set(k,parseResponse(body,edges.get(k),options));}catch(_){models.delete(k);notices.set(k,{status:'failed',reason:'unsupported_response'});onChange();return false;}
  onChange();return true;
 }
 function fail(token,reason){const k=locate(token);if(k===null)return false;pending.delete(k);models.delete(k);notices.set(k,{status:'failed',reason:failureReason(reason)});onChange();return true;}
 function view(legs,specs){
  need(Array.isArray(legs)&&Array.isArray(specs)&&legs.length===specs.length);
  return legs.map((l,i)=>{const s=edge(specs[i]);need(l.a===s.a&&l.b===s.b);const k=key(s),model=models.get(k);if(model)return l.liveTransit&&l.transportModel===model?l:asLeg(l,model);
   const notice=notices.get(k),status=pending.has(k)?'pending':notice?.status;if(!status)return l;
   const messages={failed:'실시간 경로 확인 실패',pending:'실시간 경로를 불러오는 중',queued:'실시간 경로 조회 대기',exhausted:'이번 화면 세션의 요청 한도 소진 · 추가 전송 없음',unavailable:'실시간 연결을 사용할 수 없음 · 전송 없음'};
   const display={...l,liveTransitRequestState:status,liveTransitMessage:messages[status]+(status==='failed'?' · '+failureMessages[failureReason(notice?.reason)]+' · 이 구간 자동 재시도 없음':'')+' · 현재 선과 안내는 기존 자료입니다.',...(status==='failed'?{liveTransitFailureReason:failureReason(notice?.reason)}:{})};
   Object.defineProperty(display,'toJSON',{value:()=>undefined});return Object.freeze(display);
  });
 }
 function current(input){return models.get(key(edge(input)))||null;}
 function acceptWalk(input,expected,slotId,body,options){
  const k=key(edge(input)),model=models.get(k),spec=edges.get(k);if(!spec||model!==expected)return false;
  const slot=model.connectorSlots.find(s=>s.id===slotId);if(!slot)return false;
  try{const result=parseWalkResponse(body,{...spec,from:slot.from,to:slot.to},{...options,idPrefix:slot.id,role:slot.role});models.set(k,mergeWalk(model,spec,slot,result));}catch(_){return false;}
  onChange();return true;
 }
 return Object.freeze({reconcile,begin,accept,fail,notice,view,dispose,current,acceptWalk,toJSON:()=>undefined});
}
return Object.freeze({parseResponse,create,meters,validateRailRules,normalizeEdge:edge,edgeKey:key,parseWalkResponse,MAX_CONNECTORS,failureText:reason=>failureMessages[failureReason(reason)]});
});
