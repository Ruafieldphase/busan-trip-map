(function(){
'use strict';
let C; const I=window.TripIO,R=window.TripRouting,$=s=>document.querySelector(s);
let trip,state; const storage=()=>window.localStorage;
const colors={숙소:'#bea7ff',교통:'#91bcff',해변:'#68d6c5',산책:'#70edbb',전망:'#77dfe9',카페:'#ffd08b',먹거리:'#ffad8e',시장:'#ffa98b',선택관광:'#b9adfa'};
let memory,currentDay,mode,activeLegs=[],selection;
let leaf=null,tileLayer=null,markerLayer=null,routeLayer=null;
let tileTimer=null,assetTimer=null,assetsLoading=false;
let basemap;
let importEpoch=0;
const routeClient=R.create({onChange:()=>{if(trip)render(false);},onCache:cache=>{state={...state,routeCache:cache};persist();}});
const canQuery=()=>['http:','https:'].includes(location.protocol);
const node=(tag,text,cls)=>{const el=document.createElement(tag);if(text!=null)el.textContent=text;if(cls)el.className=cls;return el;};
const button=(text,action)=>{const el=node('button',text);el.type='button';el.onclick=action;return el;};
const link=(text,url)=>{const el=node('a',text);el.href=url;el.target='_blank';el.rel='noopener noreferrer';return el;};
const ids=()=>C.routesFor(currentDay,mode,memory);
function persist(){state={...state,trip,memory};try{I.commit(storage(),state);$('#memoryNotice').textContent='이 주소의 브라우저에 저장했습니다.';}catch(e){$('#memoryNotice').textContent='브라우저 저장 실패. 현재 화면의 기록을 전체 내보내기로 보관하세요.';}}
function byDay(p){return currentDay==='all'||(C.data.dayAreas[currentDay]||[]).includes(p.area);}
function activePlaces(){const route=ids();return C.data.places.filter(p=>route.includes(p.id)||byDay(p));}
function selectedLeg(){return selection.type==='leg'?activeLegs.find(l=>l.a===selection.a&&l.b===selection.b):null;}
function sequence(){const route=ids(),out=[];route.forEach((id,i)=>{out.push({type:'place',id});if(currentDay!=='all'&&i<route.length-1)out.push({type:'leg',a:id,b:route[i+1]});});return out;}
const sameSelection=(a,b)=>a.type===b.type&&(a.type==='place'?a.id===b.id:a.a===b.a&&a.b===b.b);
function select(value,focus=true){selection=value;renderCard();renderItinerary();renderSchematic();if(focus&&leaf){if(value.type==='place'){const p=C.lookup[value.id];leaf.panTo([p.lat,p.lon]);}else{const leg=selectedLeg();if(leg){const p=C.lookup[leg.a],q=C.lookup[leg.b];leaf.fitBounds(L.latLngBounds([[p.lat,p.lon],[q.lat,q.lon]]).pad(.25),{maxZoom:16,padding:[30,85]});}}}}
function focusCard(){document.querySelector('.selectedCard').scrollIntoView({block:'nearest',behavior:'smooth'});}
function selectFromPanel(value){select(value);focusCard();}
function toggleVisited(id){memory.visited=memory.visited.includes(id)?memory.visited.filter(x=>x!==id):[...memory.visited,id];persist();render(false);}
function addPlace(id){if(currentDay==='all'||ids().includes(id))return;(memory.add[currentDay]??=[]).push(id);persist();selection={type:'place',id};render(false);}
function removePlace(id){memory.add[currentDay]=(memory.add[currentDay]||[]).filter(x=>x!==id);persist();render(false);}
function renderCard(){
 const host=$('#selectedContent');host.replaceChildren();const list=sequence(),index=list.findIndex(v=>sameSelection(v,selection));
 $('#cardPosition').textContent=(currentDay==='all'?'여행 전체':C.data.dayLabels[currentDay])+(selection.type==='leg'?' · 이동 구간':' · 장소')+(index>=0?` ${index+1}/${list.length}`:' · 추가 후보');
 $('#previous').disabled=index<=0;$('#next').disabled=index<0||index>=list.length-1;
 if(selection.type==='place'){
  const p=C.lookup[selection.id];if(!p)return;
  host.append(node('h2',p.name),node('p',p.address),node('p',(p.pin_approx?'개략 핀 · 장소 검색 권장':'원본에 좌표 근거 있음 · 이번 작업 재검증 아님')+' / '+p.coord_source,'source'));
  const actions=node('div',null,'actions');actions.append(link('네이버 검색 ↗',C.navUrl(p)),link(p.pin_approx?'카카오 검색 ↗':'카카오 위치 ↗',C.kakaoMap(p)),button(memory.visited.includes(p.id)?'✓ 방문 표시됨':'방문 표시',()=>toggleVisited(p.id)));
  if(currentDay!=='all'&&!ids().includes(p.id))actions.append(button('오늘 동선에 추가',()=>addPlace(p.id)));
  else if(currentDay!=='all'&&(memory.add[currentDay]||[]).includes(p.id))actions.append(button('추가 취소',()=>removePlace(p.id)));
  host.append(node('p',p.note||''),actions);$('#selectedSource').textContent=`선택 장소 원본 메모: ${p.note||'없음'} / 원본 출처: ${p.coord_source}. 이번 작업에서 위치·영업·통제 여부를 재조회하지 않았습니다.`;
 }else{
  const leg=selectedLeg();if(!leg)return;
  host.append(node('h2',C.lookup[leg.a].name+' → '+C.lookup[leg.b].name),node('p',leg.mode+' · '+C.textMeasure(leg),'measure'),node('p',leg.source+' / '+leg.queriedAt,'source'));
  const actions=node('div',null,'actions');
  const walk=C.directionLink(leg,'walk'),traffic=C.directionLink(leg,'traffic');
  if(walk.url===traffic.url){actions.append(link(walk.label,walk.url),link('출발 장소 검색 ↗',C.kakaoSearch(C.lookup[leg.a])));}else{actions.append(link(walk.label,walk.url),link(traffic.label,traffic.url));}
  if(leg.routeOrigin==='calculated'||!C.highConfidence(C.lookup[leg.a])||!C.highConfidence(C.lookup[leg.b]))host.append(node('p','개략 핀 기준, 출발·도착 확인','pinWarning'));
  if(leg.routeSnap?.some(n=>n>100))host.append(node('p',`핀과 보행로 연결점 차이: 출발 ${Math.round(leg.routeSnap[0])}m · 도착 ${Math.round(leg.routeSnap[1])}m. 경로 끝의 실제 접근 지점을 확인하세요.`,'pinWarning'));
  if(R.explicitWalk(C,leg)&&!leg.routeStatus){const query=button('이 구간을 도보로 조회',()=>routeClient.request(leg,{explicit:true}));query.disabled=!canQuery();actions.append(query);}
  if(leg.routeStatus==='failed'){const retry=button('이 구간 도보 다시 시도',()=>routeClient.request(leg,{explicit:!!leg.routeExplicit,retry:true}));retry.disabled=!canQuery();actions.append(retry);}
  if(leg.routeStatus==='pending')host.append(node('p',leg.routeMessage,'routePending'));
  if(leg.routeStatus==='failed')host.append(node('p',leg.routeMessage+' · 자동 재시도하지 않습니다.','pinWarning'));
  host.append(node('p',leg.desc),actions);$('#selectedSource').textContent=`선택 이동 구간: ${leg.desc} / 출처: ${leg.source} / 조회시각: ${leg.queriedAt}`;
 }
}
function renderItinerary(){
 const host=$('#itinerary');host.replaceChildren();const route=ids();
 route.forEach((id,i)=>{
  const p=C.lookup[id],value={type:'place',id};const b=button(`${i+1}. ${p.name}${memory.visited.includes(id)?' ✓':''}`,()=>selectFromPanel(value));
  b.dataset.place=id;b.className=sameSelection(value,selection)?'active':'';host.append(b);
  if(currentDay==='all'||i>=route.length-1)return;
  const leg=activeLegs[i],v={type:'leg',a:leg.a,b:leg.b};
  const row=button(leg.mode,()=>selectFromPanel(v));row.className='leg'+(sameSelection(v,selection)?' active':'');row.dataset.edge=leg.a+':'+leg.b;
  row.append(node('small',C.textMeasure(leg)),node('small',leg.source+' / '+leg.queriedAt));host.append(row);
 });
}
function renderCandidates(){
 const host=$('#candidates');host.replaceChildren();const route=ids(),candidates=activePlaces().filter(p=>!route.includes(p.id));
 $('#candidateCount').textContent=`${candidates.length}곳 · 전체 ${C.data.places.length}곳 보관`;
 for(const p of candidates){const row=node('article',null,'candidate');row.append(node('strong',p.name,memory.visited.includes(p.id)?'visited':''),node('p',p.area+' · '+p.cat+' · '+(p.pin_approx?'개략 핀':'원본 근거 있음')));const actions=node('div',null,'actions');actions.append(button('선택',()=>selectFromPanel({type:'place',id:p.id})));if(currentDay!=='all')actions.append(button('동선에 추가',()=>addPlace(p.id)));row.append(actions);host.append(row);}
 $('#resetAdded').disabled=currentDay==='all'||!(memory.add[currentDay]||[]).length;
}
function fitLeaf(){if(!leaf)return;const points=ids().map(id=>C.lookup[id]);leaf.fitBounds(L.latLngBounds(points.map(p=>[p.lat,p.lon])).pad(.18),{padding:[35,90],maxZoom:15});}
function renderLeafContent(fit){
 if(!leaf)return;markerLayer.clearLayers();routeLayer.clearLayers();const route=ids();
 for(const p of activePlaces()){
  const n=route.indexOf(p.id),active=n>=0,size=active?27:17;
  const icon=L.divIcon({className:'',html:`<div class="mapDot" style="width:${size}px;height:${size}px;background:${(Object.hasOwn(colors,p.cat)?colors[p.cat]:'#a6c9d2')};opacity:${active?1:.65}">${active?n+1:''}</div>`,iconSize:[size,size],iconAnchor:[size/2,size/2]});
  L.marker([p.lat,p.lon],{icon,title:p.name,alt:p.name,riseOnHover:true}).on('click',()=>select({type:'place',id:p.id},false)).addTo(markerLayer);
 }
 for(const leg of C.drawnLegs(activeLegs))L.polyline(leg.coords,{color:leg.type==='walk'?'#269666':'#3c72ce',weight:5,opacity:.94}).bindTooltip(node('span',leg.mode+' · '+leg.source+' / '+leg.queriedAt+' · 현장 확인 필요')).on('click',()=>select({type:'leg',a:leg.a,b:leg.b},false)).addTo(routeLayer);
 if(fit)fitLeaf();
}
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function renderSchematic(){
 const route=ids(),points=activePlaces(),locs=route.map(id=>C.lookup[id]);const W=900,H=620;
 const midLat=locs.reduce((n,p)=>n+p.lat,0)/locs.length,midLon=locs.reduce((n,p)=>n+p.lon,0)/locs.length;
 const spanX=Math.max(1.4,...locs.map(p=>Math.abs(p.lon-midLon)*91))*2,spanY=Math.max(1.4,...locs.map(p=>Math.abs(p.lat-midLat)*111))*2;
 const scale=Math.min(740/spanX,420/spanY),xy=(lat,lon)=>[W/2+(lon-midLon)*91*scale,H/2-(lat-midLat)*111*scale+20];
 let grid='';for(let x=100;x<W;x+=100)grid+=`<path d="M${x},0V${H}"/>`;for(let y=100;y<H;y+=100)grid+=`<path d="M0,${y}H${W}"/>`;
 const paths=C.drawnLegs(activeLegs).map(leg=>`<polyline data-edge="${leg.a}:${leg.b}" points="${leg.coords.map(c=>xy(c[0],c[1]).map(v=>v.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="${leg.type==='walk'?'#6ce5b5':'#7ca8ee'}" stroke-width="5"/>`).join('');
 const pins=points.map(p=>{const [x,y]=xy(p.lat,p.lon),n=route.indexOf(p.id);if(x<15||x>885||y<95||y>580)return '';return `<g data-pin="${p.id}" role="button" tabindex="0" aria-label="${esc(p.name)}" style="cursor:pointer" transform="translate(${x.toFixed(1)},${y.toFixed(1)})"><title>${esc(p.name)}</title><circle r="${selection.id===p.id?12:n>=0?9:6}" fill="${(Object.hasOwn(colors,p.cat)?colors[p.cat]:'#aacccc')}" stroke="white" stroke-width="2"/>${n>=0?`<text x="13" y="-8" fill="#f0f8ff" stroke="#102a37" stroke-width="4" paint-order="stroke" font-size="13">${n+1}. ${esc(p.name.slice(0,12))}</text>`:''}</g>`;}).join('');
 $('#schematic').innerHTML=`<svg role="img" aria-label="위치 비례 개략도, 실제 지도 아님" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#183344"/><g stroke="#395669" opacity=".5">${grid}</g><text x="26" y="98" fill="#b4d2da" font-size="17">위치 비례 개략도 · 실제 도로·해안선 아님</text><text x="850" y="100" fill="#c4e1e7" font-size="20">↑ N</text>${paths}${pins}</svg>`;
 $('#schematic').querySelectorAll('[data-pin]').forEach(el=>{el.onclick=()=>select({type:'place',id:el.dataset.pin},false);el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();el.onclick();}};});
}
function render(fit=true){
 activeLegs=routeClient.view(C.makeLegs(currentDay,mode,memory));
 if(selection.type==='leg'&&!selectedLeg())selection={type:'place',id:ids()[0]};
 document.querySelectorAll('[data-day]').forEach(b=>{const active=b.dataset.day===currentDay;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
 document.querySelectorAll('[data-mode]').forEach(b=>{const active=b.dataset.mode===mode;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
 $('#dayDescription').textContent=currentDay==='all'?'전체 장소를 살펴보세요. 날짜를 선택하면 구간별 이동 정보가 나옵니다.':C.data.dayDesc[currentDay].join(' · ');
 const summary=currentDay==='all'?'전체: 장소만 표시':C.routeSummary(activeLegs);$('#routeStatus').textContent=summary;$('#mapRouteSummary').textContent=summary;
 $('#routeProgress').textContent=summary;
 $('#enableRoutes').disabled=routeClient.enabled||!canQuery();$('#enableRoutes').textContent=routeClient.enabled?'도보 경로 연결 켜짐':'빠진 도보 경로 연결';
 renderCard();renderItinerary();renderCandidates();renderSchematic();renderLeafContent(fit);
}
function showBasemap(state){
 $('#basemapBanner').dataset.state=state.status;$('#basemapBanner').setAttribute('aria-busy',String(state.status==='loading'));
 const labels={loading:'배경 불러오는 중',ready:'타일 불러옴',partial:'배경 일부 실패',error:'배경을 표시하지 못했습니다',offline:'오프라인'};
 $('#basemapLabel').textContent=labels[state.status];
 let detail='지도 프로그램·타일 응답 대기 · 위치 개략도 표시';
 if(state.issue==='file')detail='start_preview.cmd를 실행하세요. 이 파일을 직접 열면 표준 OSM 타일을 요청하지 않습니다.';
 else if(state.issue==='library-error')detail='지도 프로그램 또는 스타일 연결 실패 · 개략도와 선택 카드의 외부 지도 링크를 이용하세요.';
 else if(state.status==='ready')detail=`타일 ${state.loaded}장 불러옴 · 도로·해안선이 실제로 보이는지 확인하세요.`;
 else if(state.status==='partial')detail=`타일 ${state.loaded}장 불러옴 / ${state.failed}장 실패${state.timedOut?' · 응답 지연':''} · 외부 지도 확인 가능`;
 else if(state.status==='error')detail=`타일 ${state.failed}장 실패${state.timedOut?' · 응답 대기시간 초과':''} · 개략도와 외부 지도 링크를 이용하세요.`;
 else if(state.status==='offline')detail=state.loaded?'인터넷 연결 없음 · 이미 불러온 타일만 표시됩니다.':'인터넷 연결 없음 · 위치 개략도와 저장 경로만 표시됩니다.';
 else if(state.pending)detail=`타일 ${state.pending}장 대기 / ${state.loaded}장 불러옴`;
 $('#basemapDetail').textContent=detail;
 const schematic=state.loaded===0||!!state.issue;$('#schematic').hidden=!schematic;$('#schematicAttribution').hidden=!schematic;
 $('#retryMap').hidden=state.issue==='file'||state.status==='loading'||state.status==='ready';
}
function mapEvent(kind,id){const state=basemap.event(kind,id);showBasemap(state);return state;}
function armTileTimeout(){clearTimeout(tileTimer);tileTimer=setTimeout(()=>mapEvent('timeout'),15000);}
function initializeLeaflet(){
 if(leaf)return;
 try{
  leaf=L.map('map',{zoomControl:false,attributionControl:true});L.control.zoom({position:'bottomright'}).addTo(leaf);
  markerLayer=L.layerGroup().addTo(leaf);routeLayer=L.layerGroup().addTo(leaf);
  tileLayer=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',maxZoom:19});
  tileLayer.on('loading',()=>{mapEvent('loading');armTileTimeout();});
  for(const kind of ['tileloadstart','tileload','tileerror','tileunload','tileabort'])tileLayer.on(kind,e=>mapEvent(kind,e.tile));
  tileLayer.on('load',()=>{clearTimeout(tileTimer);mapEvent('load');});tileLayer.addTo(leaf);
  renderLeafContent(true);setTimeout(()=>leaf.invalidateSize(),100);armTileTimeout();
 }catch(e){mapEvent('library-error');}
}
function bootMap(){
 // Never load the standard OSM tile layer from file://. No identity spoofing or proxy.
 if(location.protocol==='file:'){mapEvent('file');return;}
 if(!['http:','https:'].includes(location.protocol)){mapEvent('library-error');return;}
 if(navigator.onLine===false){mapEvent('offline');return;}
 if(!trip||assetsLoading)return;assetsLoading=true;
 const css=document.createElement('link');css.rel='stylesheet';css.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
 const js=document.createElement('script');js.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';js.async=true;
 let cssReady=false,jsReady=false,failed=false;
 const finish=()=>{if(!failed&&cssReady&&jsReady){clearTimeout(assetTimer);initializeLeaflet();}};
 const fail=()=>{failed=true;clearTimeout(assetTimer);mapEvent('library-error');};
 css.onload=()=>{cssReady=true;finish();};js.onload=()=>{jsReady=true;finish();};css.onerror=fail;js.onerror=fail;
 assetTimer=setTimeout(fail,20000);document.head.append(css);document.body.append(js);
}
$('#retryMap').onclick=()=>{if(!leaf||!tileLayer){location.reload();return;}mapEvent('retry');tileLayer.redraw();armTileTimeout();};
window.addEventListener('offline',()=>{if(trip)mapEvent('offline');});window.addEventListener('online',()=>{if(trip){mapEvent('online');if(!leaf)mapEvent('library-error');}});
window.addEventListener('resize',()=>{if(leaf)leaf.invalidateSize();});
$('#previous').onclick=()=>{const list=sequence(),index=list.findIndex(v=>sameSelection(v,selection));if(index>0)select(list[index-1]);};
$('#next').onclick=()=>{const list=sequence(),index=list.findIndex(v=>sameSelection(v,selection));if(index>=0&&index<list.length-1)select(list[index+1]);};
$('#fit').onclick=()=>{if(!trip)return;if(leaf)fitLeaf();else renderSchematic();};
$('#enableRoutes').onclick=()=>{if(!trip||!canQuery())return;try{storage().setItem(R.PREFERENCE_KEY,JSON.stringify({scope:R.scope(trip),enabled:true}));}catch(e){$('#memoryNotice').textContent='도보 연결 설정은 이번 화면에서만 유지됩니다.';}routeClient.enable();};
window.addEventListener('pagehide',()=>routeClient.cancel());
$('#resetAdded').onclick=()=>{if(currentDay==='all')return;memory.add[currentDay]=[];persist();render(false);};
$('#copySummary').onclick=async()=>{const text=C.copySummary(currentDay,mode,memory);try{await navigator.clipboard.writeText(text);$('#copyNotice').textContent=' 복사했습니다.';$('#copyFallback').hidden=true;}catch(e){$('#copyText').value=text;$('#copyFallback').hidden=false;$('#copyText').focus();$('#copyText').select();}};

function download(value,name){const blob=new Blob([JSON.stringify(value,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=node('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('#exportMemory').onclick=()=>{if(trip)download({schema:'busan-local-memory-v1',key:trip.legacyMemoryKey,memory},'visit-memory.json');};
$('#exportTrip').onclick=()=>{if(trip)download({...state,trip,memory},'private-trip-backup.json');};
function activate(next,restorePreference=false){
 state=next;trip=state.trip;memory=state.memory;C=window.BusanCore.create(trip);basemap=basemap||C.createBasemapState();
 let enabled=false;try{const pref=JSON.parse(storage().getItem(R.PREFERENCE_KEY)||'null');enabled=restorePreference&&canQuery()&&pref?.enabled===true&&pref.scope===R.scope(trip);}catch(e){}
 if(!restorePreference)try{storage().setItem(R.PREFERENCE_KEY,JSON.stringify({scope:R.scope(trip),enabled:false}));}catch(e){}
 routeClient.activate(C,state.routeCache,{enabled});
 currentDay=Object.keys(trip.dayRoutes)[0];mode=Object.keys(trip.dayRoutes[currentDay])[0];selection={type:'place',id:C.routesFor(currentDay,mode,memory)[0]};
 $('#empty').hidden=true;$('#loaded').hidden=false;$('#tripTitle').textContent=trip.title;
 const days=$('#days');days.replaceChildren();for(const d of [...Object.keys(trip.dayRoutes),'all']){const b=button(d==='all'?'전체':trip.dayLabels[d],()=>{currentDay=d;if(d!=='all'&&!trip.dayRoutes[d][mode])mode=Object.keys(trip.dayRoutes[d])[0];buildModes();selection={type:'place',id:ids()[0]};render();});b.dataset.day=d;days.append(b);}
 buildModes();$('#reservations').replaceChildren();for(const r of C.reservations)$('#reservations').append(node('li',r));
 render();showBasemap(basemap.snapshot());if(!leaf)bootMap();
}
function buildModes(){const host=$('#modes');host.replaceChildren();const modes=Object.keys(trip.dayRoutes[currentDay==='all'?Object.keys(trip.dayRoutes)[0]:currentDay]);for(const m of modes){const b=button(trip.modeLabels[m]||m,()=>{mode=m;selection={type:'place',id:ids()[0]};render();});b.dataset.mode=m;host.append(b);}}
async function importFile(event,kind){const file=event.target.files[0];if(!file)return;const version=++importEpoch;try{
 if(file.size>I.MAX_BYTES)throw Error('파일이 너무 큽니다. 최대 2MB입니다.');
 const text=await file.text();if(version!==importEpoch)return;const prepared=I.prepare(text,state,kind);
 if(prepared.replaces&&!window.confirm('현재 일정과 기록을 이 파일로 바꿀까요? 보관하려면 먼저 전체 내보내기를 해 주세요.'))return;
 I.commit(storage(),prepared.state);activate(prepared.state);$('#memoryNotice').textContent=kind==='memory'?'기존 기록을 유지하고 가져온 기록을 합쳤습니다.':'일정을 이 브라우저에 가져왔습니다.';
 }catch(e){$('#memoryNotice').textContent='가져오지 못했습니다: '+e.message+' 기존 저장값은 유지했습니다.';}finally{event.target.value='';}}
$('#importTrip').onchange=e=>importFile(e,'trip');$('#importMemory').onchange=e=>importFile(e,'memory');
try{const saved=I.load(storage());if(saved)activate(saved,true);}catch(e){$('#memoryNotice').textContent='저장 기록을 읽지 못했습니다. 기존 저장값은 지우지 않았습니다. '+e.message;}
})();
