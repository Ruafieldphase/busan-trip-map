/* Local JSON boundary. No network, evaluation, or legacy-key writes. */
(function(root,factory){const local=typeof module==='object'&&module.exports;const api=factory(local?require('./routing.js'):root.TripRouting,local?require('./composite.js'):root.TripComposite);if(local)module.exports=api;else root.TripIO=api;})(globalThis,function(R,T){
'use strict';
const MAX_BYTES=2*1024*1024,KEY='local-trip-shell-v05';
const own=(o,k)=>Object.hasOwn(o,k),object=o=>o&&typeof o==='object'&&!Array.isArray(o);
function need(ok,message){if(!ok)throw Error(message);}
function str(v,max=12000){need(typeof v==='string'&&v.length<=max,'문자열 형식 또는 길이를 확인하세요.');return v;}
function id(v){str(v,80);need(/^[A-Za-z0-9_-]+$/.test(v)&&!['all','constructor','prototype','__proto__'].includes(v),'장소·날짜 식별자를 확인하세요.');return v;}
function list(v,max){need(Array.isArray(v)&&v.length<=max,'목록 크기 또는 형식을 확인하세요.');return v;}
function tree(v,depth=0,budget={n:0}){need(depth<24&&++budget.n<150000,'파일 구조가 너무 큽니다.');if(typeof v==='string')str(v,100000);else if(typeof v==='number')need(Number.isFinite(v),'유한한 숫자가 필요합니다.');else if(v&&typeof v==='object'){for(const [k,x] of Object.entries(v)){need(!['__proto__','prototype','constructor'].includes(k),'허용되지 않는 파일 속성입니다.');str(k,160);tree(x,depth+1,budget);}}else need(v===null||typeof v==='boolean','지원하지 않는 파일 값입니다.');}
const clone=v=>JSON.parse(JSON.stringify(v));
function point(p){need(Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=90&&Math.abs(p[1])<=180,'좌표 범위를 확인하세요.');}
function validateTrip(t){
 need(object(t)&&t.schema==='local-trip-v1','개인 일정 파일 또는 전체 백업 파일을 선택해 주세요.');str(t.title,200);id(t.legacyMemoryKey);str(t.source);str(t.sourceDate);
 const places=list(t.places,500);need(places.length>0,'장소가 비어 있습니다.');const ids=new Set();
 for(const p of places){need(object(p),'장소 형식을 확인하세요.');id(p.id);need(!ids.has(p.id),'장소 ID가 중복됩니다.');ids.add(p.id);point([p.lat,p.lon]);need(typeof p.pin_approx==='boolean','핀 근거가 필요합니다.');for(const k of ['name','address','area','cat','priority','day','note','coord_source'])str(p[k]);}
 const refs=(a,min=0)=>{list(a,500);need(a.length>=min,'동선이 비어 있습니다.');for(const i of a)need(ids.has(i),'동선에 없는 장소 ID가 있습니다.');};
 refs(t.overview,1);need(object(t.dayRoutes)&&object(t.dayDesc)&&object(t.dayLabels)&&object(t.dayAreas)&&object(t.modeLabels),'날짜 설정을 확인하세요.');
 const days=Object.keys(t.dayRoutes);need(days.length>0&&days.length<=60,'날짜 수를 확인하세요.');
 for(const d of days){id(d);str(t.dayLabels[d],200);list(t.dayDesc[d],10).forEach(x=>str(x));list(t.dayAreas[d],100).forEach(x=>str(x));need(object(t.dayRoutes[d]),'날짜 동선을 확인하세요.');const modes=Object.keys(t.dayRoutes[d]);need(modes.length>0&&modes.length<=12,'구성 수를 확인하세요.');for(const m of modes){id(m);str(t.modeLabels[m],200);refs(t.dayRoutes[d][m],1);}}
 list(t.reservations,100).forEach(x=>str(x));need(object(t.placeQueries),'장소 검색 정보를 확인하세요.');for(const [k,v] of Object.entries(t.placeQueries)){need(ids.has(k),'검색 장소 ID를 확인하세요.');str(v);}
 let vertices=0;
 for(const p of list(t.presets,100)){refs(p.ids,2);list(p.legs,499);need(p.legs.length===p.ids.length-1,'저장 구간 수를 확인하세요.');for(const leg of p.legs)need(Array.isArray(leg)&&leg.length===2&&leg.every(x=>Number.isFinite(x)&&x>=0&&x<=10000000),'저장 거리·시간을 확인하세요.');list(p.shape,20000);need(p.shape.length>=2,'저장 선형이 비어 있습니다.');vertices+=p.shape.length;need(vertices<=20000,'저장 좌표가 너무 많습니다.');p.shape.forEach(point);}
 for(const r of list(t.legRules,2000)){need(ids.has(r.a)&&ids.has(r.b),'구간 장소 ID를 확인하세요.');if(r.day)need(own(t.dayRoutes,r.day),'구간 날짜를 확인하세요.');if(r.mode)need(own(t.modeLabels,r.mode),'구간 구성을 확인하세요.');const l=r.leg;need(object(l)&&l.a===r.a&&l.b===r.b&&l.coords===null&&l.distance===null&&l.duration===null,'미확인 이동 구간에 확정 좌표·시간을 넣을 수 없습니다.');for(const k of ['type','mode','source','queriedAt','desc'])str(l[k]);}
 if(own(t,'transportLegs'))T.validate(t.transportLegs,t);
 return t;
}
function validateMemory(m){need(object(m)&&Array.isArray(m.visited)&&object(m.add),'방문·추가 기록 형식이 아닙니다.');list(m.visited,5000).forEach(id);need(Object.keys(m.add).length<=100,'추가 기록 날짜가 너무 많습니다.');for(const [d,a] of Object.entries(m.add)){id(d);list(a,5000).forEach(id);}return m;}
function validateState(s){need(object(s)&&s.schema==='local-trip-backup-v1','전체 백업 형식이 아닙니다.');validateTrip(s.trip);validateMemory(s.memory);if(s.legacyImports)list(s.legacyImports,100);if(own(s,'routeCache'))R.validateCache(s.routeCache,s.trip);return s;}
function parse(text){need(typeof text==='string'&&new TextEncoder().encode(text).length<=MAX_BYTES,'파일이 너무 큽니다. 최대 2MB입니다.');let value;try{value=JSON.parse(text);}catch(e){throw Error('JSON 파일을 읽을 수 없습니다.');}tree(value);return value;}
function prepare(text,current,kind='trip'){
 const raw=parse(text);let next;
 if(kind==='memory'){
  need(current,'먼저 전체 일정을 가져오세요.');
  need(raw.schema===undefined||raw.schema==='busan-local-memory-v1','방문 기록 파일을 선택하세요. 전체 백업은 일정 가져오기를 사용하세요.');
  if(raw.schema)need(raw.key===current.trip.legacyMemoryKey,'다른 일정의 방문 기록입니다.');
  if(raw.key!==undefined)need(raw.key===current.trip.legacyMemoryKey,'다른 일정의 방문 기록입니다.');
  const m=validateMemory(raw.memory||raw);next=clone(current);
  next.memory.visited=[...new Set([...next.memory.visited,...m.visited])];
  for(const [d,a] of Object.entries(m.add))next.memory.add[d]=[...new Set([...(next.memory.add[d]||[]),...a])];
  // Retain unknown legacy values in the full private backup, as well as active IDs.
  next.legacyImports=[...(next.legacyImports||[]),clone(raw)];
 }else if(raw.schema==='local-trip-backup-v1'){next=validateState(raw);}
 else {validateTrip(raw);next={schema:'local-trip-backup-v1',trip:raw,memory:{visited:[],add:{}},legacyImports:[]};}
 validateState(next);tree(next);need(new TextEncoder().encode(JSON.stringify(next)).length<=MAX_BYTES,'기록을 합친 파일이 너무 큽니다.');
 return {state:clone(next),replaces:!!current&&kind!=='memory'};
}
function commit(storage,state){const text=JSON.stringify(state);validateState(parse(text));storage.setItem(KEY,text);return state;}
function load(storage){const raw=storage.getItem(KEY);return raw===null?null:validateState(parse(raw));}
return {KEY,MAX_BYTES,prepare,commit,load,validateTrip,validateState,validateMemory};
});

