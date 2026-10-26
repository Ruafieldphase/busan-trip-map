/* Pure itinerary and basemap evidence. No provider calls. */
(function(root,factory){
 const T=typeof module==='object'&&module.exports?require('./composite.js'):root.TripComposite;
 const api={create:data=>factory(data,T)};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.BusanCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(data,T){
'use strict';
const MEMORY_KEY=data.legacyMemoryKey;
const lookup=Object.assign(Object.create(null),Object.fromEntries(data.places.map(p=>[p.id,p])));
const SOURCE=data.source;
const SOURCE_DATE=data.sourceDate;
const reservations=data.reservations;
function normalizeMemory(value){
 const out={visited:[],add:{}};if(!value||typeof value!=='object')return out;
 out.visited=[...new Set(value.visited||[])];
 for(const [day,list] of Object.entries(value.add||{}))out.add[day]=[...new Set(list)];
 return out;
}
const distance=(a,b)=>Math.hypot((a.lat-b.lat)*111000,(a.lon-b.lon)*91000);
function routesFor(day,mode,memory){
 if(day==='all')return [...data.overview];
 const ids=[...((data.dayRoutes[day]||{})[mode]||[])];
 for(const id of (memory.add[day]||[])){
  if(!lookup[id]||ids.includes(id))continue;
  // Ordering aid only. It never proves walkability or travel time.
  let min=Infinity,at=Math.max(1,ids.length-1);
  for(let i=1;i<ids.length;i++){const delta=distance(lookup[ids[i-1]],lookup[id])+distance(lookup[id],lookup[ids[i]])-distance(lookup[ids[i-1]],lookup[ids[i]]);if(delta<min){min=delta;at=i;}}
  ids.splice(at,0,id);
 }
 return ids;
}
function decodePolyline(encoded){
 let i=0,lat=0,lon=0;const out=[];
 function component(){let value=0,shift=0,byte;do{if(i>=encoded.length||shift>30)throw Error('Invalid stored polyline');byte=encoded.charCodeAt(i++)-63;if(byte<0||byte>63)throw Error('Invalid stored polyline');value|=(byte&31)<<shift;shift+=5;}while(byte>=32);return value&1?~(value>>1):value>>1;}
 while(i<encoded.length){lat+=component();lon+=component();out.push([lat/1e5,lon/1e5]);}return out;
}
function segmentPreset(preset,maxSnapMeters=100){
 const shape=preset.shape;
 if(!Array.isArray(shape)||shape.length<2||shape.some(c=>c.length!==2||!c.every(Number.isFinite)))return [];
 // Bound segments with nearby original path vertices, strictly in waypoint order. No connectors.
 const indices=preset.ids.map(id=>{const p=lookup[id];if(!p)return -1;let best=-1,meters=Infinity;shape.forEach((c,i)=>{const d=distance(p,{lat:c[0],lon:c[1]});if(d<meters){best=i;meters=d;}});return meters<=maxSnapMeters?best:-1;});
 if(indices.some((at,i)=>at<0||(i&&at<=indices[i-1])))return [];
 return preset.ids.slice(1).map((b,i)=>({a:preset.ids[i],b,type:'walk',mode:'도보 · 저장 경로',distance:preset.legs[i][0],duration:preset.legs[i][1],coords:shape.slice(indices[i],indices[i+1]+1),pathIndices:[indices[i],indices[i+1]],source:SOURCE,queriedAt:SOURCE_DATE,desc:'저장된 경로의 해당 구간만 표시. 원본 핀·진입점과 현장 통제는 재확인 필요.'}));
}
const presets=data.presets;
const geometryCache=new Map();
const edgeKey=(a,b)=>JSON.stringify([a,b]);
presets.flatMap(p=>segmentPreset(p)).forEach(leg=>geometryCache.set(edgeKey(leg.a,leg.b),leg));
function chooseLeg(a,b,day,mode){
 const transport=T.choose(data.transportLegs,a,b,day,mode);
 if(transport){const transportModel=T.model(transport),original=data.legRules.find(r=>r.a===a&&r.b===b&&(!r.day||r.day===day)&&(!r.mode||r.mode===mode));return {a,b,type:'composite',mode:'복합 이동 · '+(transportModel.status==='documented'?'원본 근거 갖춤':'일부·미확인'),transport,transportModel,coords:null,distance:null,duration:null,source:transportModel.sourceText,queriedAt:transportModel.observedAt,desc:'가져온 단계 순서·개별 출처를 표시합니다. 현재 제공자·현장·운영 재검증은 하지 않았습니다.'+(original?' 원본 이동 메모: '+original.leg.mode+' / '+original.leg.desc+' / '+original.leg.source+' / '+original.leg.queriedAt:'')};}
 const unknown={a,b,type:'transit',mode:'이동수단 미확인',coords:null,distance:null,duration:null,source:'원본 장소·정류장 정보 / 길찾기 미조회',queriedAt:'신규 조회 없음',desc:'버스·지하철·택시 등 경로와 시간을 외부 지도에서 확인하세요.'};
 const rule=data.legRules.find(r=>r.a===a&&r.b===b&&(!r.day||r.day===day)&&(!r.mode||r.mode===mode));
 if(rule)return rule.leg;
 const saved=geometryCache.get(edgeKey(a,b));if(saved)return saved;
 if(distance(lookup[a],lookup[b])<2450)return {...unknown,type:'walk-candidate',mode:'도보 후보 · 미확인',desc:'직선상 가까운 후보일 뿐, 수역·계단·진입로·실제 보행 가능 여부와 시간은 미확인.'};
 return unknown;
}
function makeLegs(day,mode,memory){const ids=routesFor(day,mode,memory);return day==='all'?[]:ids.slice(1).map((b,i)=>chooseLeg(ids[i],b,day,mode));}
const drawnLegs=legs=>legs.filter(l=>l.coords&&l.coords.length>1);
const geometryPoints=legs=>legs.flatMap(l=>l.transportModel?l.transportModel.steps.flatMap(s=>s.coords||[]):l.coords||[]);
// Display topology is separate from acquired road geometry and never enters the trip/cache.
function displayLegs(legs){return legs.map((leg,i)=>{
 const a=lookup[leg.a],b=lookup[leg.b],from=[a.lat,a.lon],to=[b.lat,b.lon],known=!!(leg.coords&&leg.coords.length>1),coords=known?leg.coords:[from,to];
 if(leg.transportModel){const m=leg.transportModel,segments=m.steps.filter(s=>s.coords);return {leg,from:i+1,to:i+2,kind:'composite',coords:[from,to],segments,gaps:m.gaps.map(g=>g.coords),gapMessages:m.gaps.map(g=>g.message),drawOrder:segments.length===0,label:`${i+1}→${i+2}`,description:leg.mode+' · 현재 제공자 재검증 아님'};}
 const gaps=[];if(known){if(distance(a,{lat:coords[0][0],lon:coords[0][1]})>.5)gaps.push([from,coords[0]]);const end=coords[coords.length-1];if(distance(b,{lat:end[0],lon:end[1]})>.5)gaps.push([end,to]);}
 return {leg,from:i+1,to:i+2,kind:known?'road':'order',coords,gaps,label:`${i+1}→${i+2}`,description:known?leg.mode+' · 실제 경로 데이터':'이동 순서만 표시 · 실제 노선 미확인'};
});}
function pathMidpoint(coords){
 let total=0;const lengths=coords.slice(1).map((p,i)=>{const n=distance({lat:coords[i][0],lon:coords[i][1]},{lat:p[0],lon:p[1]});total+=n;return n;});let at=total/2;
 for(let i=0;i<lengths.length;i++){if(at<=lengths[i]||i===lengths.length-1){const a=coords[i],b=coords[i+1],t=lengths[i]?at/lengths[i]:0;return {point:[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t],angle:Math.atan2(-(b[0]-a[0])*111,(b[1]-a[1])*91)*180/Math.PI};}at-=lengths[i];}
 return {point:coords[0],angle:0};
}
const routeSummary=legs=>{const ready=drawnLegs(legs),fresh=ready.filter(l=>l.routeOrigin==='calculated').length,composite=legs.filter(l=>l.transportModel),documented=composite.filter(l=>l.transportModel.status==='documented').length,pending=legs.filter(l=>l.routeStatus==='pending').length,failed=legs.filter(l=>l.routeStatus==='failed').length;return `보행 선형 ${ready.length}/${legs.length}구간 · 저장 ${ready.length-fresh} · 새 조회 ${fresh} · 복합 원본 근거 ${documented} / 일부 ${composite.length-documented} · 대기 ${pending} · 실패 ${failed} · 미확인 ${legs.length-ready.length-composite.length-pending-failed}`;};
function textMeasure(leg){if(leg.transportModel)return `${leg.transportModel.steps.length}단계 · ${leg.transportModel.status==='documented'?'원본 근거 갖춤 · 현재 제공자 재검증 아님':'일부 근거·연결 미확인'} · 총시간 합산 안 함`;if(leg.coords&&leg.distance!=null&&leg.duration!=null)return `${(leg.distance/1000).toFixed(2)}km · 약 ${Math.round(leg.duration/60)}분 (${leg.routeOrigin==='calculated'?'새 조회':'원본'} 보행 엔진 추정, 휴식·현재 교통 제외)`;if(leg.routeStatus==='pending')return leg.routeMessage||'보행 경로 대기 중';if(leg.routeStatus==='failed')return '도보 조회 실패 · '+leg.routeMessage;return '경로·소요시간 미확인';}
function placeQuery(p){return Object.hasOwn(data.placeQueries,p.id)?data.placeQueries[p.id]:p.name;}
const highConfidence=p=>!p.pin_approx&&!p.coord_source.includes('시범판');
const kakaoSearch=p=>'https://map.kakao.com/link/search/'+encodeURIComponent(placeQuery(p));
const navUrl=p=>'https://map.naver.com/p/search/'+encodeURIComponent(placeQuery(p));
const kakaoMap=p=>highConfidence(p)?'https://map.kakao.com/link/map/'+encodeURIComponent(p.name)+','+p.lat+','+p.lon:kakaoSearch(p);
function directionLink(leg,method){
 const a=lookup[leg.a],b=lookup[leg.b];
 const coord=p=>encodeURIComponent(p.name)+','+p.lat+','+p.lon;
 return {url:'https://map.kakao.com/link/by/'+(method==='walk'?'walk':'traffic')+'/'+coord(a)+'/'+coord(b),label:(method==='walk'?'도보 길찾기 ↗':'대중교통 길찾기 ↗')+(!highConfidence(a)||!highConfidence(b)?' · 개략 핀 기준, 출발·도착 확인':'')};
}
function copySummary(day,mode,memory){
 const days=day==='all'?Object.keys(data.dayRoutes):[day];
 return days.map(d=>`${data.dayLabels[d]} ${data.dayDesc[d][0]}\n${routesFor(d,mode,memory).map((id,i)=>`${i+1}. ${lookup[id].name}`).join('\n')}`).join('\n\n')+'\n\n예약 (원본 유지)\n'+reservations.join('\n')+'\n\n※ 초록선은 저장·새 조회 또는 가져온 도보 선형입니다. 가져온 복합 이동은 단계별 교통수단·출처·시각·미확인 연결을 지도 카드에서 확인하세요. 가져온 원본 확인 주장은 현재 제공자 재검증이 아닙니다. 실제 선형이 없는 구간의 경로·시간은 미확인입니다. 후보 삽입 순서는 직선 거리 참고이며 이동 가능성을 보장하지 않습니다.';
}
// Image loading events never prove roads/coastline or provider policy acceptance.
function createBasemapState(){
 const tiles=new Map();let online=true,issue='',settled=false,timedOut=false;
 function snapshot(){
  let loaded=0,failed=0,pending=0;for(const value of tiles.values()){if(value==='loaded')loaded++;else if(value==='error')failed++;else pending++;}
  let status='loading';
  if(!online)status='offline';else if(issue)status='error';else if((failed||timedOut)&&loaded)status='partial';else if((settled||timedOut)&&!pending&&loaded)status='ready';else if((settled||timedOut)&&!loaded)status='error';else if(!pending&&loaded&&!failed)status='ready';
  return {status,loaded,failed,pending,issue,timedOut};
 }
 function event(kind,id){
  if(kind==='loading'){settled=false;timedOut=false;}
  if(kind==='tileloadstart')tiles.set(id,'pending');if(kind==='tileload')tiles.set(id,'loaded');if(kind==='tileerror')tiles.set(id,'error');if(kind==='tileunload'||kind==='tileabort')tiles.delete(id);
  if(kind==='load'){settled=true;timedOut=false;}if(kind==='timeout'){timedOut=true;settled=true;}if(kind==='offline')online=false;if(kind==='online'){online=true;settled=false;}
  if(kind==='library-error'||kind==='file')issue=kind;if(kind==='retry'){issue='';timedOut=false;settled=false;tiles.clear();}
  return snapshot();
 }
 return {event,snapshot};
}
return {data,lookup,MEMORY_KEY,reservations,normalizeMemory,distance,routesFor,decodePolyline,segmentPreset,presets,geometryCache,edgeKey,chooseLeg,makeLegs,drawnLegs,geometryPoints,displayLegs,pathMidpoint,routeSummary,textMeasure,placeQuery,highConfidence,kakaoSearch,kakaoMap,navUrl,directionLink,copySummary,createBasemapState};
});

