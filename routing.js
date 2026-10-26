/* Opt-in pedestrian routing. Only two coordinates leave this module. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TripRouting=api;})(globalThis,function(){
'use strict';
const PROVIDER='fossgis-osrm-foot-v1',PROFILE='pedestrian';
const ENDPOINT='https://routing.openstreetmap.de/routed-foot/route/v1/foot/';
const SCHEMA='foot-route-cache-v1',PREFERENCE_KEY='local-trip-foot-enabled-v1';
const coord=p=>[p.lat,p.lon];
const point=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=90&&Math.abs(p[1])<=180;
function meters(a,b){const r=Math.PI/180,x=(b[0]-a[0])*r,y=(b[1]-a[1])*r,h=Math.sin(x/2)**2+Math.cos(a[0]*r)*Math.cos(b[0]*r)*Math.sin(y/2)**2;return 6371000*2*Math.asin(Math.sqrt(Math.min(1,h)));}
// Local SHA-256 identity covers the complete imported trip, including unknown
// properties. Neither this digest nor the JSON is included in route requests.
function scope(trip){
 const bytes=new TextEncoder().encode(JSON.stringify(trip)),size=Math.ceil((bytes.length+9)/64)*64,buf=new Uint8Array(size);buf.set(bytes);buf[bytes.length]=128;
 const bits=bytes.length*8;for(let i=0;i<8;i++)buf[size-1-i]=Math.floor(bits/2**(8*i))&255;
 const k=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
 const h=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19],w=new Uint32Array(64),rotr=(x,n)=>(x>>>n)|(x<<(32-n));
 for(let offset=0;offset<size;offset+=64){
  for(let i=0;i<16;i++){const j=offset+i*4;w[i]=(buf[j]<<24)|(buf[j+1]<<16)|(buf[j+2]<<8)|buf[j+3];}
  for(let i=16;i<64;i++){const x=w[i-15],y=w[i-2];w[i]=(w[i-16]+(rotr(x,7)^rotr(x,18)^(x>>>3))+w[i-7]+(rotr(y,17)^rotr(y,19)^(y>>>10)))>>>0;}
  let [a,b,c,d,e,f,g,z]=h;
  for(let i=0;i<64;i++){const t1=(z+(rotr(e,6)^rotr(e,11)^rotr(e,25))+((e&f)^(~e&g))+k[i]+w[i])>>>0,t2=((rotr(a,2)^rotr(a,13)^rotr(a,22))+((a&b)^(a&c)^(b&c)))>>>0;z=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}
  [a,b,c,d,e,f,g,z].forEach((x,i)=>h[i]=(h[i]+x)>>>0);
 }
 return 'trip-sha256-v1:'+h.map(x=>x.toString(16).padStart(8,'0')).join('');
}
const key=(a,b,from,to)=>JSON.stringify([a,b,from,to,PROFILE,PROVIDER]);
const requireValue=(ok,message)=>{if(!ok)throw Error(message);};
const pinLimits=(a,b)=>[a,b].map(p=>p.pin_approx===true?150:100);
function geometry(coords,distance,duration,from,to,snap,limits=[100,100]){
 requireValue(Array.isArray(coords)&&coords.length>=2&&coords.length<=20000&&coords.every(point),'잘못된 경로 좌표');
 requireValue(Number.isFinite(distance)&&distance>0&&distance<=10000000&&Number.isFinite(duration)&&duration>0&&duration<=10000000,'잘못된 거리·시간');
 requireValue(Array.isArray(snap)&&snap.length===2&&snap.every((n,i)=>Number.isFinite(n)&&n>=0&&n<=limits[i]),'핀과 보행로 차이가 허용 범위를 넘거나 연결 근거가 없습니다 (일반 100m · 개략 핀 150m).');
 requireValue(meters(from,coords[0])<=limits[0]&&meters(to,coords[coords.length-1])<=limits[1],'핀과 보행로 차이가 허용 범위를 넘습니다.');
 requireValue(coords.some(p=>meters(coords[0],p)>.1),'빈 경로');
}
function parseResponse(body,spec,queriedAt){
 requireValue(body&&body.code==='Ok',body&&body.code==='NoRoute'?'보행 경로 없음 (NoRoute)':'보행 엔진 응답 오류');
 const route=body.routes&&body.routes[0],w=body.waypoints;
 requireValue(route&&route.geometry&&route.geometry.type==='LineString'&&Array.isArray(route.geometry.coordinates),'GeoJSON 보행 경로 없음');
 const coords=route.geometry.coordinates.map(p=>Array.isArray(p)&&p.length===2?[p[1],p[0]]:null);
 requireValue(Array.isArray(w)&&w.length===2,'경로 진입점 근거 없음');
 const snap=w.map(p=>p.distance);
 geometry(coords,route.distance,route.duration,spec.from,spec.to,snap,spec.pinLimits);
 w.forEach((p,i)=>{requireValue(Array.isArray(p.location)&&point([p.location[1],p.location[0]]),'잘못된 경로 진입점');requireValue(meters([p.location[1],p.location[0]],coords[i?coords.length-1:0])<=2,'경로와 진입점 불일치');});
 return {key:spec.key,a:spec.a,b:spec.b,from:spec.from,to:spec.to,profile:PROFILE,provider:PROVIDER,coords,distance:route.distance,duration:route.duration,snap,queriedAt,explicit:!!spec.explicit};
}
function validateCache(cache,trip){
 requireValue(cache&&cache.schema===SCHEMA&&cache.scope===scope(trip)&&Array.isArray(cache.entries)&&cache.entries.length<=500,'다른 일정 또는 잘못된 보행 경로 캐시');
 const places=new Map(trip.places.map(p=>[p.id,p])),seen=new Set();let vertices=0;
 for(const e of cache.entries){
  requireValue(e&&places.has(e.a)&&places.has(e.b)&&point(e.from)&&point(e.to)&&JSON.stringify(e.from)===JSON.stringify(coord(places.get(e.a)))&&JSON.stringify(e.to)===JSON.stringify(coord(places.get(e.b))),'캐시 장소·좌표 불일치');
  requireValue(e.profile===PROFILE&&e.provider===PROVIDER&&e.key===key(e.a,e.b,e.from,e.to)&&!seen.has(e.key),'캐시 키·보행 제공자 불일치');seen.add(e.key);
  requireValue(typeof e.explicit==='boolean'&&typeof e.queriedAt==='string'&&e.queriedAt.length<=80&&Number.isFinite(Date.parse(e.queriedAt)),'캐시 조회시각·선택 근거 없음');
  geometry(e.coords,e.distance,e.duration,e.from,e.to,e.snap,pinLimits(places.get(e.a),places.get(e.b)));vertices+=e.coords.length;requireValue(vertices<=50000,'경로 캐시가 너무 큽니다.');
 }
 if(cache.failures!==undefined){requireValue(Array.isArray(cache.failures)&&cache.failures.length<=500,'잘못된 조회 실패 기록');for(const e of cache.failures){requireValue(e&&places.has(e.a)&&places.has(e.b)&&e.key===key(e.a,e.b,coord(places.get(e.a)),coord(places.get(e.b)))&&!seen.has(e.key),'실패 기록 구간 불일치');seen.add(e.key);requireValue(typeof e.explicit==='boolean'&&typeof e.message==='string'&&e.message.length<=240,'잘못된 실패 기록');}}
 return cache;
}
const transitIntent=leg=>/bus|rail|ferry|train|버스|열차|지하철|철도|페리|선박|통제/i.test(leg.type+' '+leg.mode);
function autoWalk(leg){return !leg.coords&&['walk','walk-candidate'].includes(leg.type)&&!transitIntent(leg);}
function explicitWalk(core,leg){
 if(leg.coords||!['transit','unknown','transfer'].includes(leg.type))return false;
 // Named transit and closures retain their original intent in every mode.
 if(transitIntent(leg))return false;
 return ['이동수단 미확인','unknown','미확인'].includes(leg.mode)&&meters(coord(core.lookup[leg.a]),coord(core.lookup[leg.b]))<=15000;
}
function asLeg(original,e){return {...original,type:'walk',mode:'도보 · 새 조회 경로',coords:e.coords,distance:e.distance,duration:e.duration,source:'FOSSGIS Routing / OSRM foot · © OpenStreetMap contributors',queriedAt:e.queriedAt,routeOrigin:'calculated',routeStatus:'ready',routeSnap:e.snap,desc:(e.explicit?'이 구간을 도보로 선택했습니다. 원본 주의: '+original.desc+' ':'')+`경로 연결점은 출발 핀과 ${Math.round(e.snap[0])}m, 도착 핀과 ${Math.round(e.snap[1])}m 떨어져 있습니다. 핀은 그대로 두고 보행로만 표시하며, 핀까지의 직선 연결이나 보행 가능성을 만들지 않습니다. `+'보행 엔진 추정, 휴식·현재 교통 미반영. 개략 핀 기준, 출발·도착 확인. 현장 통제·계단·진입로는 별도 확인.'};}
function create(options={}){
 const fetcher=options.fetch||((...args)=>globalThis.fetch(...args)),now=options.now||Date.now;
 const later=options.setTimeout||setTimeout,clear=options.clearTimeout||clearTimeout;
 const changed=options.onChange||(()=>{}),saved=options.onCache||(()=>{}),interval=Math.max(1100,options.interval||1100),timeout=options.timeout||15000;
 let core,cache,entries=new Map(),statuses=new Map(),choices=new Set(),desired=new Map(),base=[],enabled=false,epoch=0,lastStart=-Infinity,timer=null,flight=null;
 const spec=leg=>{const a=core.lookup[leg.a],b=core.lookup[leg.b],from=coord(a),to=coord(b);return {a:leg.a,b:leg.b,from,to,pinLimits:pinLimits(a,b),key:key(leg.a,leg.b,from,to)};};
 function cancelFlight(){if(flight){flight.cancel();}}
 function activate(next,stored,{enabled:allow=false}={}){
  epoch++;if(timer!==null){clear(timer);timer=null;}cancelFlight();core=next;
  cache=stored?validateCache(stored,core.data):{schema:SCHEMA,scope:scope(core.data),entries:[]};
  entries=new Map(cache.entries.map(e=>[e.key,e]));statuses=new Map((cache.failures||[]).map(e=>[e.key,{state:'failed',message:e.message}]));choices=new Set((cache.failures||[]).filter(e=>e.explicit).map(e=>e.key));desired=new Map();base=[];enabled=allow;
 }
 function schedule(){if(timer!==null||flight||![...desired].some(([k])=>statuses.get(k)?.state==='pending'))return;timer=later(()=>{timer=null;pump();},Math.max(0,lastStart+interval-now()));}
 async function pump(){
  if(flight)return;const item=[...desired].find(([k])=>statuses.get(k)?.state==='pending');if(!item)return;
  const [k,s]=item,version=epoch,controller=new AbortController();let deadline,cancelled=false;
  const abort=new Promise((_,reject)=>{deadline=later(()=>{controller.abort();reject(Error('응답 시간 초과'));},timeout);flight={key:k,cancel(){cancelled=true;controller.abort();reject(Error('조회 취소'));}};});
  lastStart=now();statuses.set(k,{state:'pending',message:'보행 경로 조회 중'});changed();
  try{
   const request=(async()=>{const response=await fetcher(ENDPOINT+s.from[1]+','+s.from[0]+';'+s.to[1]+','+s.to[0]+'?overview=full&geometries=geojson&steps=false',{signal:controller.signal,referrerPolicy:'strict-origin-when-cross-origin',credentials:'omit'});
    if(!response.ok)throw Error(response.status===429?'요청 제한 (429) · 자동 재시도 안 함':'경로 요청 실패 (HTTP '+response.status+')');
    // Bound the response before parsing, including providers returning an error page.
    const text=await response.text();requireValue(text.length<=2*1024*1024,'경로 응답이 너무 큽니다.');return parseResponse(JSON.parse(text),s,new Date(now()).toISOString());})();
   const entry=await Promise.race([request,abort]);
   if(!cancelled&&version===epoch&&desired.has(k)){
    requireValue(entries.size<500&&cache.entries.reduce((n,e)=>n+e.coords.length,0)+entry.coords.length<=50000,'경로 캐시가 가득 찼습니다.');
    entries.set(k,entry);cache.entries.push(entry);if(cache.failures)cache.failures=cache.failures.filter(e=>e.key!==k);statuses.set(k,{state:'ready'});saved(cache);
   }
  }catch(error){if(!cancelled&&version===epoch&&desired.has(k)){const message=String(error.message||'네트워크 연결 실패').slice(0,240);statuses.set(k,{state:'failed',message});cache.failures=[...(cache.failures||[]).filter(e=>e.key!==k),{key:k,a:s.a,b:s.b,explicit:!!s.explicit,message}].slice(-500);saved(cache);}}
  finally{clear(deadline);flight=null;if(version===epoch)changed();schedule();}
 }
 function view(legs){
  base=legs;const next=new Map();
  const out=legs.map(leg=>{
   if(leg.coords||leg.type==='composite')return leg;const s=spec(leg),entry=entries.get(s.key),chosen=choices.has(s.key)||(entry&&entry.explicit),eligible=autoWalk(leg)||(chosen&&explicitWalk(core,leg));
   if(!eligible)return leg;
   if(entry)return asLeg(leg,entry);
   if((enabled&&autoWalk(leg))||chosen){s.explicit=!!chosen;next.set(s.key,s);if(!statuses.has(s.key))statuses.set(s.key,{state:'pending',message:'보행 경로 대기 중'});}
   const status=statuses.get(s.key);return status?{...leg,type:'walk-candidate',mode:status.state==='failed'?'도보 조회 실패':'도보 · 조회 대기',source:'FOSSGIS Routing / OSRM foot · 응답 미확정',queriedAt:'확정 경로 없음',routeStatus:status.state,routeMessage:status.message,routeExplicit:!!chosen}:leg;
  });
  for(const [k] of desired)if(!next.has(k)&&statuses.get(k)?.state==='pending')statuses.delete(k);
  desired=next;if(flight&&!desired.has(flight.key))cancelFlight();schedule();return out;
 }
 function enable(){enabled=true;view(base);changed();}
 function request(leg,{explicit=false,retry=false}={}){
  if(!core||!(autoWalk(leg)||explicit&&explicitWalk(core,leg)))return false;
  const s=spec(leg);if(explicit)choices.add(s.key);if(retry&&statuses.get(s.key)?.state==='failed')statuses.delete(s.key);
  view(base);changed();return true;
 }
 return {activate,view,enable,request,get enabled(){return enabled;},get cache(){return cache;},cancel(){epoch++;desired.clear();if(timer!==null){clear(timer);timer=null;}cancelFlight();}};
}
return {PROVIDER,PROFILE,ENDPOINT,SCHEMA,PREFERENCE_KEY,scope,key,meters,parseResponse,validateCache,autoWalk,explicitWalk,create};
});

