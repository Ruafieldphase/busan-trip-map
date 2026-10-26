/* Source-owned composite transport evidence. Pure/local; never queries a provider. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TripComposite=api;})(globalThis,function(){
'use strict';
const SCHEMA='composite-itinerary-leg-v1';
const modes={walk:'도보',bus:'버스',subway:'지하철',rail:'철도',transfer:'환승 이동'};
const colors={walk:'#269666',bus:'#519be5',subway:'#ba8bed',rail:'#ba8bed',transfer:'#e7be69'};
const transit=mode=>['bus','subway','rail'].includes(mode);
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const need=(ok,message)=>{if(!ok)throw Error('복합 이동: '+message);};
const str=(v,max=2000)=>need(typeof v==='string'&&v.length<=max,'문자열 형식·길이 오류');
const identity=v=>{str(v,80);need(/^[A-Za-z0-9_-]+$/.test(v)&&!['__proto__','constructor','prototype'].includes(v),'식별자 오류');};
const point=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=90&&Math.abs(p[1])<=180;
const meters=(a,b)=>Math.hypot((a[0]-b[0])*111000,(a[1]-b[1])*91000);
function evidence(e){
 need(object(e),'독립 출처 기록 필요');
 for(const k of ['source','reference','observedAt']){need(e[k]===null||typeof e[k]==='string','출처·조회시각은 문자열 또는 null');if(e[k]!==null)str(e[k]);}
 need(e.observedAt===null||Number.isFinite(Date.parse(e.observedAt)),'조회시각 오류');
 need(['unknown','unverified','source-verified'].includes(e.verification),'확인 상태 오류');
 if(e.verification==='source-verified')need(!!e.source?.trim()&&!!e.reference?.trim()&&!!e.observedAt,'원본 확인 주장에는 출처·참조·시각 필요');
}
const backed=e=>e.verification==='source-verified'&&!!e.source&&!!e.reference&&!!e.observedAt;
const evidenceText=e=>`${e.source||'출처 미확인'} / ${e.reference||'참조 미확인'} / ${e.observedAt||'시각 미확인'} / ${backed(e)?'원본 확인 주장 · 현재 제공자 재검증 아님':'미검증'}`;
function validate(legs,trip){
 need(Array.isArray(legs)&&legs.length<=2000,'구간 목록 오류');
 const places=new Map(trip.places.map(p=>[p.id,p])),seen=new Set();let vertices=0;
 for(const leg of legs){
  need(object(leg)&&leg.schema===SCHEMA,'지원하지 않는 구간 버전');identity(leg.id);need(!seen.has(leg.id),'중복 구간 ID');seen.add(leg.id);
  need(places.has(leg.a)&&places.has(leg.b)&&leg.a!==leg.b,'일정 출발·도착 ID 오류');
  if(leg.day!==undefined)need(Object.hasOwn(trip.dayRoutes,leg.day),'날짜 범위 오류');
  if(leg.composition!==undefined)need(Object.hasOwn(trip.modeLabels,leg.composition),'일정 구성 범위 오류');
  evidence(leg.evidence);
  need(Array.isArray(leg.endpoints)&&leg.endpoints.length>=2&&leg.endpoints.length<=500,'끝점 목록 오류');
  const endpoints=new Map();
  for(const p of leg.endpoints){
   need(object(p),'끝점 형식 오류');identity(p.id);str(p.name,400);need(!!p.name.trim()&&!endpoints.has(p.id),'끝점 이름 또는 중복 ID');
   need(['place','stop','entrance','platform'].includes(p.kind),'끝점 종류 오류');need(p.coords===null||point(p.coords),'끝점 좌표 오류');evidence(p.evidence);
   // An itinerary destination may itself be a bus stop or station platform.
   // placeId binds itinerary identity; kind preserves its physical role.
   if(p.kind==='place'||p.placeId!==undefined){need(places.has(p.placeId),'일정 장소 끝점 오류');const place=places.get(p.placeId);need(p.coords===null||JSON.stringify(p.coords)===JSON.stringify([place.lat,place.lon]),'원본 장소 핀 변경 불가');}
   endpoints.set(p.id,p);
  }
  const from=endpoints.get(leg.from),to=endpoints.get(leg.to);
  need(from?.placeId===leg.a&&to?.placeId===leg.b,'방향 또는 일정 끝점 불일치');
  need(Array.isArray(leg.steps)&&leg.steps.length>=1&&leg.steps.length<=200,'단계 목록 오류');const stepIds=new Set();
  need(leg.steps[0].from===leg.from&&leg.steps.at(-1).to===leg.to,'단계 순서·출발·도착 방향 불일치');
  for(const step of leg.steps){
   need(object(step),'단계 형식 오류');identity(step.id);need(!stepIds.has(step.id),'중복 단계 ID');stepIds.add(step.id);
   need(Object.hasOwn(modes,step.mode)&&endpoints.has(step.from)&&endpoints.has(step.to),'단계 수단·끝점 오류');evidence(step.evidence);
   for(const k of ['distance','duration'])need(step[k]===null||(Number.isFinite(step[k])&&step[k]>=0&&step[k]<=10000000),'거리·시간 오류');
   if(transit(step.mode)){
    const s=step.service;need(object(s)&&s.from===step.from&&s.to===step.to,'승차·하차 또는 운행 방향 불일치');
    for(const k of ['name','direction']){need(s[k]===null||typeof s[k]==='string','노선·방향 형식 오류');if(s[k]!==null)str(s[k],400);}
    evidence(s.evidence);need(['stop','platform'].includes(endpoints.get(step.from).kind)&&['stop','platform'].includes(endpoints.get(step.to).kind),'승하차 정류장·승강장 필요');
   }else need(step.service===undefined||step.service===null,'도보·환승 단계를 운송 노선으로 지정할 수 없음');
   if(step.geometry!==null){
    const g=step.geometry;need(object(g)&&Array.isArray(g.coords)&&g.coords.length>=2&&g.coords.length<=20000&&g.coords.every(point),'선형 좌표 오류');evidence(g.evidence);need(g.coords.some(p=>meters(g.coords[0],p)>.1),'빈 선형');
    vertices+=g.coords.length;need(vertices<=50000,'복합 선형이 너무 큼');
    const a=endpoints.get(step.from).coords,b=endpoints.get(step.to).coords;
    // A known reversed line is invalid; unknown or offset entrances remain partial.
    if(a&&b&&meters(a,b)>1){const forward=meters(a,g.coords[0])+meters(b,g.coords.at(-1)),reverse=meters(b,g.coords[0])+meters(a,g.coords.at(-1));need(forward<=reverse+.5,'선형 방향이 단계와 반대');}
   }
  }
  // Disconnected steps may express missing connectors. A later step reaching
  // that earlier step's departure instead is evidence of a reversed sequence.
  for(let i=1;i<leg.steps.length;i++)if(leg.steps[i-1].to!==leg.steps[i].from)need(!leg.steps.slice(i+1).some(s=>s.to===leg.steps[i].from),'연결되지 않은 단계가 역순');
 }
 for(let i=0;i<legs.length;i++)for(let j=i+1;j<legs.length;j++){
  const a=legs[i],b=legs[j];need(!(a.a===b.a&&a.b===b.b&&(!a.day||!b.day||a.day===b.day)&&(!a.composition||!b.composition||a.composition===b.composition)),'같은 방향·범위의 중복 선택');
 }
 return legs;
}
function choose(legs,a,b,day,composition){return (legs||[]).find(l=>l.a===a&&l.b===b&&(!l.day||l.day===day)&&(!l.composition||l.composition===composition));}
function model(leg){
 const endpoints=new Map(leg.endpoints.map(p=>[p.id,p])),issues=[],gaps=[];
 const issue=message=>issues.push(message);
 const gap=(a,b,message,required=false)=>{if(required||!a||!b||meters(a,b)>.5){issue(message);if(a&&b&&meters(a,b)>.5)gaps.push({coords:[a,b],message});}};
 if(!backed(leg.evidence))issue('구간 출처·시각·원본 확인 근거 미확인');
 const steps=leg.steps.map((s,i)=>{
  const from=endpoints.get(s.from),to=endpoints.get(s.to),local=[];
  if(!backed(s.evidence))local.push('단계 근거 미확인');
  if(s.distance===null||s.duration===null)local.push('거리·시간 미확인');
  for(const p of [from,to])if(!p.coords||!backed(p.evidence))local.push(`${p.name}: 위치·끝점 근거 미확인`);
  if(transit(s.mode)&&(!s.service.name?.trim()||!s.service.direction?.trim()||!backed(s.service.evidence)))local.push('노선·운행 방향·승하차 근거 미확인');
  const coords=s.geometry?.coords||null,geometryBacked=!!coords&&backed(s.geometry.evidence);
  if(!geometryBacked&&!(s.mode==='transfer'&&s.from===s.to&&backed(s.evidence)))local.push('실제 선형 근거 미확인');
  if(coords){gap(from.coords,coords[0],`${i+1}단계 출발 진입 연결 미확인`);gap(coords.at(-1),to.coords,`${i+1}단계 도착 진입 연결 미확인`);}
  else if(!(s.mode==='transfer'&&s.from===s.to&&backed(s.evidence)))gap(from.coords,to.coords,`${i+1}단계 끝점 사이 간격 · 실제 경로 미확인`,true);
  if(i){const prev=leg.steps[i-1],p=endpoints.get(prev.to);if(prev.to!==s.from)gap(p.coords,from.coords,`${i}→${i+1}단계 환승·연결 도보 근거 없음 (${p.name} → ${from.name})`,true);}
  if(i&&transit(s.mode)&&transit(leg.steps[i-1].mode))local.push('연속 승차 사이 명시적 환승 단계·근거 없음');
  local.forEach(x=>issue(`${i+1}단계: ${x}`));
  const instruction=transit(s.mode)?`${modes[s.mode]} ${s.service.name||'노선 미확인'} · ${s.service.direction||'방향 미확인'} · 승차 ${from.name} → 하차 ${to.name}`:`${modes[s.mode]} · ${from.name} → ${to.name}`;
  const measure=`${s.distance===null?'거리 미확인':(s.distance/1000).toFixed(2)+'km'} · ${s.duration===null?'시간 미확인':'원본 약 '+Math.round(s.duration/60)+'분'}`;
  return {id:s.id,number:i+1,mode:s.mode,from,to,coords,geometryBacked,color:colors[s.mode],instruction,measure,issues:local,evidenceText:evidenceText(s.evidence),geometryEvidence:s.geometry?evidenceText(s.geometry.evidence):'선형 없음',serviceEvidence:transit(s.mode)?evidenceText(s.service.evidence):null};
 });
 return {id:leg.id,status:issues.length?'partial':'documented',issues:[...new Set(issues)],steps,gaps,sourceText:evidenceText(leg.evidence),observedAt:leg.evidence.observedAt||'시각 미확인'};
}
return {SCHEMA,modes,colors,validate,choose,model,evidenceText};
});
