/* SolvePad v23 storage separation
   Data is stored locally in the browser IndexedDB.
   v5.5 fixes: MathJax rendering, LaTeX JSON repair, two-finger zoom + pan.
   v5.6 fixes: iPad Safari text selection/callout suppression for Pencil writing.
   v5.7 fixes: remove bottom command bar and add browser page zoom lock toggle.
   v23.4: separate local/server pack tabs and cascade local/server progress cleanup. */

'use strict';
const DB_NAME='solvepad_v5_local',DB_VERSION=1,MAX_ZOOM=4,MIN_ZOOM=.5;
let db,dpr=1,saveTimer=0,mathTimer=0;
const $=id=>document.getElementById(id);
const $$=sel=>Array.from(document.querySelectorAll(sel));
const el={
  app:$('app'),sidebarToggle:$('sidebarToggle'),packTitle:$('packTitle'),packMeta:$('packMeta'),progressFill:$('progressFill'),progressText:$('progressText'),mainTitle:$('mainTitle'),mainSub:$('mainSub'),questionList:$('questionList'),qBadge:$('qBadge'),qTitle:$('qTitle'),qTags:$('qTags'),questionBody:$('questionBody'),choices:$('choices'),assetArea:$('assetArea'),penBtn:$('penBtn'),eraserBtn:$('eraserBtn'),penWidth:$('penWidth'),undoBtn:$('undoBtn'),clearBtn:$('clearBtn'),saveImageBtn:$('saveImageBtn'),paperViewport:$('paperViewport'),paper:$('paper'),canvas:$('ink'),pageInfo:$('pageInfo'),zoomInfo:$('zoomInfo'),pageZoomLock:$('pageZoomLock'),penOnly:$('penOnly'),drawer:$('sideDrawer'),drawerTitle:$('drawerTitle'),drawerBody:$('drawerBody'),importModal:$('importModal'),libraryModal:$('libraryModal'),jsonInput:$('jsonInput'),jsonFile:$('jsonFile'),serverUrl:$('serverUrl'),actionKey:$('actionKey'),libraryServerUrl:$('libraryServerUrl'),libraryActionKey:$('libraryActionKey'),subjectFilter:$('subjectFilter'),folderFilter:$('folderFilter'),packList:$('packList'),serverPackList:$('serverPackList'),wrongList:$('wrongList'),storageInfo:$('storageInfo'),backupFile:$('backupFile'),wrongModal:$('wrongModal'),wrongSubjectFilter:$('wrongSubjectFilter'),wrongExamSetFilter:$('wrongExamSetFilter'),wrongUnitFilter:$('wrongUnitFilter'),wrongPackFilter:$('wrongPackFilter'),wrongStatusFilter:$('wrongStatusFilter'),openLocalPacks:$('openLocalPacks'),libraryTabLocal:$('libraryTabLocal'),libraryTabServer:$('libraryTabServer'),localPackPanel:$('localPackPanel'),serverPackPanel:$('serverPackPanel'),localPackSearch:$('localPackSearch'),serverPackSearch:$('serverPackSearch'),localPackCount:$('localPackCount'),serverPackCount:$('serverPackCount')
};
const state={pack:null,idx:0,filter:'all',tool:'pen',pages:[[]],pageIdx:0,zoom:1,panX:0,panY:0,penOnly:true,drawing:false,currentStroke:null,activePointerId:null,raf:0,pageZoomLocked:true,serverPacks:[],serverPackError:'',packSource:'local',serverPackId:'',wrongRows:[],libraryTab:'local'};
const gesture={pointers:new Map(),active:false,startDistance:1,startZoom:1,startPanX:0,startPanY:0,startWorldX:0,startWorldY:0};
const ctx=el.canvas.getContext('2d');
let lastInkInteraction=0;


function applyPageZoomLock(){
  const locked=state.pageZoomLocked!==false;
  const meta=document.querySelector('meta[name="viewport"]');
  if(meta){
    meta.setAttribute('content',locked
      ? 'width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover'
      : 'width=device-width,initial-scale=1,maximum-scale=5,user-scalable=yes,viewport-fit=cover');
  }
  document.documentElement.classList.toggle('page-zoom-locked',locked);
  if(el.pageZoomLock){
    el.pageZoomLock.textContent=locked?'화면 배율 고정: 켬':'화면 배율 고정: 끔';
    el.pageZoomLock.classList.toggle('locked',locked);
    el.pageZoomLock.classList.toggle('unlocked',!locked);
    el.pageZoomLock.title=locked
      ? 'Safari 화면 자체 확대를 막고 풀이 작성란 안에서만 두 손가락 확대/이동을 사용합니다.'
      : 'Safari 화면 자체 확대를 허용합니다. 필기 중 화면 확대가 잡히면 다시 켜세요.';
  }
  localStorage.setItem('solvepad_page_zoom_locked',locked?'1':'0');
}
function togglePageZoomLock(){state.pageZoomLocked=state.pageZoomLocked===false;applyPageZoomLock()}
function preventNativeZoom(e){if(state.pageZoomLocked!==false)e.preventDefault()}
window.addEventListener('gesturestart',preventNativeZoom,{passive:false});
window.addEventListener('gesturechange',preventNativeZoom,{passive:false});
window.addEventListener('gestureend',preventNativeZoom,{passive:false});
document.addEventListener('touchmove',e=>{
  if(state.pageZoomLocked!==false && e.touches && e.touches.length>1 && !['INPUT','TEXTAREA','SELECT'].includes(e.target?.tagName||'')) e.preventDefault();
},{passive:false});

const samplePack={schemaVersion:'solvepad.problemPack.v5',packId:'sample-math2-limit-v55',title:'수학 II 극한 예시 문제팩',description:'SolvePad v5.5 테스트용 샘플',subject:'수학 II',folder:'함수의 극한',unit:'함수의 극한',author:'SolvePad',createdAt:'2026-06-07',settings:{defaultCanvasHeight:900,answerRevealMode:'manual'},questions:[{id:'q001',order:1,section:'극한',title:'문제 1',type:'short_answer',difficulty:2,estimatedMinutes:3,promptMd:'다음 극한값을 구하시오.\n\n$$\\lim_{x\\to 2}\\frac{x^2-4}{x-2}$$',choices:null,assets:[],answer:{type:'text',value:'4',acceptable:['4']},solution:{concepts:['분모와 분자가 동시에 0이 되는 꼴에서는 인수분해를 먼저 확인한다.'],actualSolution:['$x^2-4=(x-2)(x+2)$ 이다.','$x\\ne2$에서 식은 $x+2$로 정리된다.','따라서 극한값은 $4$이다.'],cautions:['$x=2$를 원식에 바로 대입하면 분모가 0이 된다.'],tips:['$0/0$ 꼴은 인수분해, 유리화, 약분을 먼저 본다.']},hints:['분자를 인수분해해 보자.'],canvas:{height:900,template:'grid'},tags:['극한','인수분해']},{id:'q002',order:2,section:'행렬',title:'문제 2',type:'short_answer',difficulty:3,estimatedMinutes:5,promptMd:'다음 행렬식을 계산하시오.\n\n$$\\begin{vmatrix}1&2\\\\3&4\\end{vmatrix}$$',choices:null,assets:[],answer:{type:'text',value:'-2',acceptable:['-2']},solution:{concepts:['$2\\times2$ 행렬식은 $ad-bc$로 계산한다.'],actualSolution:['$1\\cdot4-2\\cdot3=4-6=-2$이다.'],cautions:['대각선 곱의 순서를 바꾸지 않는다.'],tips:['작은 행렬은 공식으로 바로 처리한다.']},hints:['$ad-bc$를 사용한다.'],canvas:{height:980,template:'grid'},tags:['행렬','행렬식']} ]};

function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function normalizeLatexControls(v){return String(v??'')
  .replace(/\u000c(?=rac)/g,'\\f')
  .replace(/\u0008(?=(egin|eta))/g,'\\b')
  .replace(/\u0009(?=(o|heta|ext|imes|an))/g,'\\t')
  .replace(/\u000d(?=ight)/g,'\\r');}
const MATH_RE=/(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$[^$\n]+?\$)/g;
function textMd(s){return esc(s).replace(/\*\*(.+?)\*\*/gs,'<b>$1</b>').replace(/\n/g,'<br>')}
function mdInline(src){const s=normalizeLatexControls(src);let out='',last=0;for(const m of s.matchAll(MATH_RE)){out+=textMd(s.slice(last,m.index));out+=esc(m[0]);last=m.index+m[0].length}out+=textMd(s.slice(last));return out}
function isTableSep(line){return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(String(line||'').trim())}
function splitTableRow(line){let s=String(line||'').trim();if(s.startsWith('|'))s=s.slice(1);if(s.endsWith('|'))s=s.slice(0,-1);return s.split('|').map(x=>x.trim())}
function renderMdTable(lines,start){const header=splitTableRow(lines[start]),align=splitTableRow(lines[start+1]);let i=start+2,rows=[];while(i<lines.length&&String(lines[i]||'').includes('|')&&String(lines[i]||'').trim()){rows.push(splitTableRow(lines[i]));i++}const th=header.map((c,idx)=>`<th${/:-+:/.test(align[idx]||'')?' style="text-align:center"':/^-+:/.test(align[idx]||'')?' style="text-align:right"':''}>${mdInline(c)}</th>`).join('');const body=rows.map(r=>`<tr>${r.map((c,idx)=>`<td${/:-+:/.test(align[idx]||'')?' style="text-align:center"':/^-+:/.test(align[idx]||'')?' style="text-align:right"':''}>${mdInline(c)}</td>`).join('')}</tr>`).join('');return{html:`<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`,next:i}}
function md(src){const s=normalizeLatexControls(src);const lines=String(s??'').split(/\r?\n/);let out='',buf=[];function flush(){if(buf.length){out+=mdInline(buf.join('\n'));buf=[]}}for(let i=0;i<lines.length;){if(i+1<lines.length&&String(lines[i]).includes('|')&&isTableSep(lines[i+1])){flush();const t=renderMdTable(lines,i);out+=t.html;i=t.next;continue}buf.push(lines[i]);i++}flush();return out}
function queueMath(root=document.body){clearTimeout(mathTimer);root.classList?.add('math-loading');mathTimer=setTimeout(async()=>{try{if(window.MathJax?.typesetPromise){await window.MathJax.typesetPromise([root])}}catch(err){console.warn('MathJax typeset failed:',err)}finally{root.classList?.remove('math-loading')}},40)}
function isEditableTarget(target){return !!target?.closest?.('input,textarea,select,[contenteditable="true"],.textarea')}
function markInkInteraction(){lastInkInteraction=Date.now()}
function clearNativeSelection(force=false){
  const active=document.activeElement;
  if(!force&&isEditableTarget(active))return;
  const sel=window.getSelection?.();
  if(sel&&sel.rangeCount)sel.removeAllRanges();
}
function installIOSPencilGuard(){
  const guarded=[el.paperViewport,el.paper,el.canvas].filter(Boolean);
  const block=e=>{markInkInteraction();if(!isEditableTarget(e.target)){e.preventDefault();clearNativeSelection(true)}};
  for(const node of guarded){
    for(const type of ['touchstart','touchmove','touchend','touchcancel','gesturestart','gesturechange','gestureend']){
      node.addEventListener(type,block,{passive:false});
    }
    for(const type of ['contextmenu','selectstart','dragstart']){
      node.addEventListener(type,e=>{if(!isEditableTarget(e.target)){e.preventDefault();clearNativeSelection(true)}},{passive:false});
    }
    node.addEventListener('pointerdown',markInkInteraction,{passive:true});
    node.addEventListener('pointermove',markInkInteraction,{passive:true});
  }
  document.addEventListener('selectionchange',()=>{
    if(Date.now()-lastInkInteraction<1800){clearNativeSelection(true)}
  });
  document.addEventListener('contextmenu',e=>{
    if(e.target?.closest?.('.paper-viewport,.paper,.ink')){e.preventDefault();clearNativeSelection(true)}
  },{passive:false});
}

const LATEX_CMDS='frac|sqrt|lim|to|theta|alpha|beta|gamma|delta|pi|sin|cos|tan|log|ln|begin|end|left|right|cdot|times|le|ge|neq|infty|sum|int|vec|overline|underline|text|mathrm|mathbf|mathbb|bmatrix|pmatrix|vmatrix|cases|rightarrow|leftarrow|ne|approx|equiv|partial|nabla|over|hat|bar|tilde|dot|ddot|therefore|because';
const LATEX_CMD_RE=new RegExp('(^|[^\\\\])\\\\('+LATEX_CMDS+')','g');
function repairLatexBackslashes(raw){return String(raw??'').replace(LATEX_CMD_RE,'$1\\\\$2').replace(/(^|[^\\])\\(?!["\\/bfnrtu])/g,'$1\\\\')}
function parsePackJson(raw){try{return JSON.parse(repairLatexBackslashes(raw))}catch(first){try{return JSON.parse(raw)}catch(second){throw new Error('JSON 파싱 실패: '+first.message+'\nLaTeX 백슬래시는 JSON 안에서 \\\\frac처럼 이스케이프되어야 합니다.')}}}
function q(){return state.pack?.questions?.[state.idx]||null}
function currentPackId(){return state.serverPackId||state.pack?.packId||'no-pack'}
function currentPackKey(){return `${state.packSource||'local'}:${currentPackId()}`}
function key(qid){return `${currentPackKey()}::${qid}`}
function assetKey(qid,aid){return `${currentPackKey()}::${qid}::${aid}`}
function openDB(){return new Promise((res,rej)=>{const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=e=>{const d=e.target.result;for(const s of ['packs','progress','strokes','assets'])if(!d.objectStoreNames.contains(s))d.createObjectStore(s,{keyPath:'id'})};r.onsuccess=()=>{db=r.result;res(db)};r.onerror=()=>rej(r.error)})}
function store(name,mode='readonly'){return db.transaction(name,mode).objectStore(name)}
function req(r){return new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
const put=(s,v)=>req(store(s,'readwrite').put(v));
const get=(s,id)=>req(store(s).get(id));
const del=(s,id)=>req(store(s,'readwrite').delete(id));
const all=s=>req(store(s).getAll());
const serverBase=()=>((el.libraryServerUrl?.value||el.serverUrl?.value||localStorage.getItem('solvepad_action_server_url')||location.origin).trim()||location.origin).replace(/\/$/,'');
function serverHeaders(json=false){const h={};if(json)h['Content-Type']='application/json';const k=(el.libraryActionKey?.value||el.actionKey?.value||localStorage.getItem('lecturenote_action_key')||'').trim();if(k)h['X-Action-Key']=k;return h}
function saveServerSettings(){const base=(el.libraryServerUrl?.value||el.serverUrl?.value||location.origin).trim()||location.origin;const key=(el.libraryActionKey?.value||el.actionKey?.value||'');localStorage.setItem('solvepad_action_server_url',base);localStorage.setItem('lecturenote_action_key',key);if(el.serverUrl)el.serverUrl.value=base;if(el.libraryServerUrl)el.libraryServerUrl.value=base;if(el.actionKey)el.actionKey.value=key;if(el.libraryActionKey)el.libraryActionKey.value=key}
async function fetchJson(path){const res=await fetch(serverBase()+path,{headers:serverHeaders(false)});const text=await res.text();let data;try{data=JSON.parse(text)}catch{data=text}if(!res.ok)throw new Error(typeof data==='string'?data:JSON.stringify(data));return data}
function validatePack(p){if(!p||!p.packId||!p.title||!Array.isArray(p.questions))throw new Error('packId/title/questions가 필요합니다.');const ids=new Set();p.questions.forEach((x,i)=>{if(!x.id)throw new Error(`${i+1}번 문제 id 누락`);if(ids.has(x.id))throw new Error(`${x.id} 문제 id 중복`);ids.add(x.id);if(!x.solution?.concepts||!x.solution?.actualSolution||!x.solution?.cautions||!x.solution?.tips)throw new Error(`${x.id} 해설 4항목 누락`)})}
async function savePack(p){validatePack(p);p.savedAt=new Date().toISOString();await put('packs',{id:p.packId,pack:p});state.pack=p;state.idx=0;state.packSource='local';state.serverPackId='';resetView();await loadStrokes();await renderAll();await renderLibrary()}
async function loadPack(id){const row=await get('packs',id);if(!row)return alert('문제팩 없음');state.pack=row.pack;state.idx=0;state.packSource='local';state.serverPackId='';resetView();await loadStrokes();await renderAll();closeModals()}
async function renderAll(){renderPackInfo();await renderQList();await renderQuestion();await renderProgress();resizeCanvas()}
function renderPackInfo(){const p=state.pack;const src=state.packSource==='server'?'메인 저장소':'기기 저장';el.packTitle.textContent=p?p.title:'없음';el.packMeta.textContent=p?`${src} · ${p.subject||'-'} · ${p.folder||p.unit||p.unitTitle||'-'} · ${p.questions.length}문항`:'문제팩을 불러오세요.';el.mainTitle.textContent=p?p.title:'문제팩을 불러오세요';el.mainSub.textContent=p?(p.description||src):'문제팩 관리에서 메인 저장소 문제팩을 열어주세요.'}
async function renderProgress(){if(!state.pack){el.progressFill.style.width='0%';el.progressText.textContent='0 / 0';return}let done=0;for(const qu of state.pack.questions){const pr=await get('progress',key(qu.id));if(pr?.status)done++}const pct=Math.round(done/state.pack.questions.length*100);el.progressFill.style.width=pct+'%';el.progressText.textContent=`${done} / ${state.pack.questions.length} · ${pct}%`}
async function renderQList(){el.questionList.innerHTML='';if(!state.pack)return;for(let i=0;i<state.pack.questions.length;i++){const qu=state.pack.questions[i],pr=await get('progress',key(qu.id));if(state.filter==='wrong'&&pr?.status!=='wrong')continue;if(state.filter==='book'&&!pr?.bookmarked)continue;const b=document.createElement('button');b.className='qitem'+(i===state.idx?' active':'');b.innerHTML=`<span>${qu.order||i+1}. ${esc(qu.title||qu.id)}</span><span>${pr?.status==='wrong'?'<span class="badge wrong">오답</span>':''}${pr?.status==='correct'?'<span class="badge ok">맞음</span>':''}${pr?.bookmarked?'<span class="badge book">★</span>':''}</span>`;b.onclick=async()=>{await saveStrokesNow();state.idx=i;resetView();await loadStrokes();await renderAll()};el.questionList.appendChild(b)}}
async function renderQuestion(){const qu=q();el.choices.innerHTML='';el.assetArea.innerHTML='';if(!qu){el.qTitle.textContent='-';el.questionBody.textContent='문제 없음';renderDrawer('answer');return}el.qBadge.textContent=`문제 ${qu.order||state.idx+1}`;el.qTitle.textContent=qu.title||qu.id;el.qTags.innerHTML=(qu.tags||[]).map(t=>`<span class="badge">${esc(t)}</span>`).join('');el.questionBody.innerHTML=md(qu.promptMd||'');if(Array.isArray(qu.choices)){for(const c of qu.choices){const d=document.createElement('div');d.className='choice';d.innerHTML=`<b>${esc(c.id)}.</b> ${md(c.text)}`;el.choices.appendChild(d)}}await renderAssets(qu);renderDrawer('answer');const h=qu.canvas?.height||state.pack.settings?.defaultCanvasHeight||900;const vh=Math.max(560,Math.min(h,window.innerHeight-260));el.paperViewport.style.height=vh+'px';el.paper.style.height=vh+'px';state.pageIdx=0;renderPageBar();queueMath(document.body)}
async function renderAssets(qu){for(const a of qu.assets||[]){const div=document.createElement('div');div.className='asset-box';div.innerHTML=`<b>${esc(a.label||a.id)}</b><div class="sub">${md(a.description||'이미지가 필요한 문제입니다.')}</div>`;if(a.type==='svg'&&a.content){div.insertAdjacentHTML('beforeend',a.content)}else{const saved=await get('assets',assetKey(qu.id,a.id));if(saved?.dataUrl)div.insertAdjacentHTML('beforeend',`<img src="${saved.dataUrl}" alt="${esc(a.label||a.id)}">`);const inp=document.createElement('input');inp.type='file';inp.accept='image/*';inp.onchange=async()=>{const f=inp.files?.[0];if(!f)return;await put('assets',{id:assetKey(qu.id,a.id),packId:state.pack.packId,questionId:qu.id,assetId:a.id,dataUrl:await fileToDataUrl(f),createdAt:new Date().toISOString()});await renderQuestion()};div.appendChild(inp)}el.assetArea.appendChild(div)}}
function fileToDataUrl(f){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>rej(r.error);r.readAsDataURL(f)})}
function answerHTML(qu){if(!qu)return '문제를 불러오세요.';const a=qu.answer||{},s=qu.solution||{};return `<div class="okbox"><b>정답:</b> ${md(a.value||a.choiceIds?.join(', ')||'-')}</div><h3>1. 문제와 관련된 개념</h3><ol>${(s.concepts||[]).map(x=>`<li>${md(x)}</li>`).join('')}</ol><h3>2. 문제 실제 풀이</h3><ol>${(s.actualSolution||[]).map(x=>`<li>${md(x)}</li>`).join('')}</ol><h3>3. 문제 풀이시 주의사항</h3><ol>${(s.cautions||[]).map(x=>`<li>${md(x)}</li>`).join('')}</ol><h3>4. 문제 풀이 꿀팁</h3><ol>${(s.tips||[]).map(x=>`<li>${md(x)}</li>`).join('')}</ol>`}
function hintHTML(qu){return qu&&(qu.hints||[]).length?`<ol>${qu.hints.map(x=>`<li>${md(x)}</li>`).join('')}</ol>`:'힌트 없음'}
function renderDrawer(kind='answer'){const qu=q();el.drawerTitle.textContent=kind==='hint'?'힌트':'답지/해설';el.drawerBody.className=kind==='hint'?'':'solution';el.drawerBody.innerHTML=kind==='hint'?hintHTML(qu):answerHTML(qu);queueMath(el.drawerBody)}
function pageStrokes(){if(!state.pages.length)state.pages=[[]];if(!state.pages[state.pageIdx])state.pages[state.pageIdx]=[];return state.pages[state.pageIdx]}
function renderPageBar(){const total=Math.max(1,state.pages.length);state.pageIdx=Math.min(Math.max(0,state.pageIdx),total-1);el.pageInfo.textContent=`${state.pageIdx+1} / ${total}`;el.zoomInfo.textContent=Math.round(state.zoom*100)+'%';el.paper.style.setProperty('--grid',(24*state.zoom)+'px');el.paper.style.backgroundPosition=`${state.panX}px ${state.panY}px`}
function resetView(){state.zoom=1;state.panX=0;state.panY=0;gesture.active=false;gesture.pointers.clear();renderPageBar()}
function viewportCenter(){const r=el.canvas.getBoundingClientRect();return{x:r.width/2,y:r.height/2}}
function setZoom(z,center){const old=state.zoom,next=Math.max(MIN_ZOOM,Math.min(MAX_ZOOM,z||1));center=center||viewportCenter();const wx=(center.x-state.panX)/old,wy=(center.y-state.panY)/old;state.zoom=next;state.panX=center.x-wx*next;state.panY=center.y-wy*next;renderPageBar();drawStrokes()}
function resizeCanvas(){const r=el.paper.getBoundingClientRect();dpr=window.devicePixelRatio||1;el.canvas.width=Math.max(1,Math.floor(r.width*dpr));el.canvas.height=Math.max(1,Math.floor(r.height*dpr));el.canvas.style.width=r.width+'px';el.canvas.style.height=r.height+'px';drawStrokes()}
function scheduleDraw(){if(state.raf)return;state.raf=requestAnimationFrame(()=>{state.raf=0;drawStrokes();if(state.currentStroke)drawStroke(state.currentStroke)})}
function drawStroke(s){if(!s.points||s.points.length<2)return;ctx.strokeStyle=s.color||'#111';ctx.lineWidth=s.width||4;ctx.beginPath();ctx.moveTo(s.points[0].x,s.points[0].y);for(let i=1;i<s.points.length-1;i++){const p=s.points[i],n=s.points[i+1];ctx.quadraticCurveTo(p.x,p.y,(p.x+n.x)/2,(p.y+n.y)/2)}ctx.lineTo(s.points[s.points.length-1].x,s.points[s.points.length-1].y);ctx.stroke()}
function drawStrokes(){ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,el.canvas.width,el.canvas.height);ctx.setTransform(dpr*state.zoom,0,0,dpr*state.zoom,dpr*state.panX,dpr*state.panY);ctx.lineCap='round';ctx.lineJoin='round';for(const s of pageStrokes())drawStroke(s)}
function pointerAllowed(e){return !state.penOnly||e.pointerType==='pen'}
function eventPoints(e){return e.getCoalescedEvents?e.getCoalescedEvents():[e]}
function screenPoint(e){const r=el.canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}}
function pos(e){const p=screenPoint(e);return{x:(p.x-state.panX)/state.zoom,y:(p.y-state.panY)/state.zoom}}
function distPointToSegment(p,a,b){const vx=b.x-a.x,vy=b.y-a.y,wx=p.x-a.x,wy=p.y-a.y,c1=vx*wx+vy*wy;if(c1<=0)return Math.hypot(p.x-a.x,p.y-a.y);const c2=vx*vx+vy*vy;if(c2<=c1)return Math.hypot(p.x-b.x,p.y-b.y);const t=c1/c2;return Math.hypot(p.x-(a.x+t*vx),p.y-(a.y+t*vy))}
function distToStroke(pt,s){const ps=s.points||[];if(ps.length<2)return 1e9;let m=1e9;for(let i=0;i<ps.length-1;i++)m=Math.min(m,distPointToSegment(pt,ps[i],ps[i+1]));return m}
function eraseAt(pt){const rad=((+el.penWidth.value||4)*3+14)/state.zoom,arr=pageStrokes(),before=arr.length;state.pages[state.pageIdx]=arr.filter(s=>distToStroke(pt,s)>rad);if(before!==state.pages[state.pageIdx].length){drawStrokes();queueSave()}}
function finishStroke(){if(!state.drawing)return;if(state.currentStroke&&state.currentStroke.points.length>1)pageStrokes().push(state.currentStroke);state.currentStroke=null;state.drawing=false;state.activePointerId=null;queueSave();drawStrokes()}
function updateTouch(e){if(e.pointerType!=='touch')return false;gesture.pointers.set(e.pointerId,screenPoint(e));return true}
function removeTouch(e){if(e.pointerType!=='touch')return false;gesture.pointers.delete(e.pointerId);if(gesture.pointers.size<2)gesture.active=false;return true}
function touchArray(){return [...gesture.pointers.values()]}
function pinchDistance(){const a=touchArray();return a.length<2?1:Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y)}
function pinchMid(){const a=touchArray();return a.length<2?viewportCenter():{x:(a[0].x+a[1].x)/2,y:(a[0].y+a[1].y)/2}}
function startGesture(){if(gesture.pointers.size<2)return false;finishStroke();const mid=pinchMid();gesture.active=true;gesture.startDistance=pinchDistance()||1;gesture.startZoom=state.zoom;gesture.startPanX=state.panX;gesture.startPanY=state.panY;gesture.startWorldX=(mid.x-state.panX)/state.zoom;gesture.startWorldY=(mid.y-state.panY)/state.zoom;return true}
function handleTouchGesture(e){if(e.pointerType!=='touch')return false;updateTouch(e);if(!gesture.active&&gesture.pointers.size>=2)startGesture();if(!gesture.active)return false;const mid=pinchMid();state.zoom=Math.max(MIN_ZOOM,Math.min(MAX_ZOOM,gesture.startZoom*(pinchDistance()/gesture.startDistance)));state.panX=mid.x-gesture.startWorldX*state.zoom;state.panY=mid.y-gesture.startWorldY*state.zoom;renderPageBar();drawStrokes();return true}
el.canvas.addEventListener('pointerdown',e=>{markInkInteraction();clearNativeSelection(true);if(!q())return;if(e.pointerType==='touch'){try{el.canvas.setPointerCapture(e.pointerId)}catch{}updateTouch(e);if(gesture.pointers.size>=2){e.preventDefault();startGesture();return}if(state.penOnly){e.preventDefault();return}}if(!pointerAllowed(e))return;e.preventDefault();try{el.canvas.setPointerCapture(e.pointerId)}catch{}state.activePointerId=e.pointerId;const p=pos(e);if(state.tool==='eraser'){eraseAt(p);return}const base=+el.penWidth.value||4,pressure=e.pressure&&e.pressure>0?(.75+e.pressure*.55):1;state.drawing=true;state.currentStroke={id:crypto.randomUUID?.()||String(Date.now()),color:'#111',width:base*pressure,points:[p]}});
el.canvas.addEventListener('pointermove',e=>{markInkInteraction();if(!q())return;if(e.pointerType==='touch'){if(handleTouchGesture(e)||state.penOnly){e.preventDefault();return}}if(state.activePointerId!==null&&e.pointerId!==state.activePointerId)return;if(!pointerAllowed(e))return;e.preventDefault();for(const ev of eventPoints(e)){const p=pos(ev);if(state.tool==='eraser'&&e.buttons){eraseAt(p);continue}if(state.drawing)state.currentStroke.points.push(p)}if(state.drawing)scheduleDraw()});
for(const type of ['pointerup','pointercancel','lostpointercapture'])el.canvas.addEventListener(type,e=>{markInkInteraction();clearNativeSelection(true);if(e.pointerType==='touch'){removeTouch(e);return}if(state.activePointerId===null||state.activePointerId===e.pointerId||type==='lostpointercapture')finishStroke()});
function queueSave(){clearTimeout(saveTimer);saveTimer=setTimeout(saveStrokesNow,250)}
async function saveStrokesNow(){const qu=q();if(!state.pack||!qu)return;clearTimeout(saveTimer);await put('strokes',{id:key(qu.id),packId:state.pack.packId,questionId:qu.id,pages:state.pages,updatedAt:new Date().toISOString()})}
async function loadStrokes(){const qu=q();state.pages=[[]];state.pageIdx=0;if(!state.pack||!qu){renderPageBar();drawStrokes();return}const row=await get('strokes',key(qu.id));state.pages=row?.pages||[row?.strokes||[]];if(!Array.isArray(state.pages)||!state.pages.length)state.pages=[[]];renderPageBar();drawStrokes()}
async function setProgress(patch){const qu=q(),p=state.pack;if(!qu||!p)return;const id=key(qu.id),cur=await get('progress',id)||{id,packSource:state.packSource||'local',packId:currentPackId(),serverPackId:state.serverPackId||'',questionId:qu.id};const meta={packSource:state.packSource||'local',packId:currentPackId(),serverPackId:state.serverPackId||'',questionId:qu.id,subject:packSubject(p),examSetId:p.examSetId||p.exam_set_id||p.metadata?.examSetId||'',examSetTitle:p.examSetTitle||p.exam_set_title||p.metadata?.examSetTitle||'',unitNumber:p.unitNumber||p.unit_number||'',unitTitle:p.unitTitle||p.unit_title||packUnit(p),packTitle:p.title||'',questionTitle:qu.title||qu.id};await put('progress',{...cur,...meta,...patch,updatedAt:new Date().toISOString()});await renderQList();await renderProgress()}
async function toggleBookmark(){const qu=q();if(!qu)return;const cur=await get('progress',key(qu.id));await setProgress({bookmarked:!cur?.bookmarked})}
function prevPage(){state.pageIdx=Math.max(0,state.pageIdx-1);renderPageBar();drawStrokes()}
function nextPage(){if(state.pageIdx>=state.pages.length-1)state.pages.push([]);state.pageIdx++;renderPageBar();drawStrokes();queueSave()}
function addPage(){state.pages.push([]);state.pageIdx=state.pages.length-1;renderPageBar();drawStrokes();queueSave()}

function packSubject(p){return p?.subject||p?.course||'미분류'}
function packUnit(p){return p?.unitTitle||p?.unitNumber||p?.folder||p?.unit||p?.section||'미분류'}
function packCount(p){return Number(p?.question_count??p?.questions?.length??0)||0}
function sortText(a,b){return String(a).localeCompare(String(b),'ko',{numeric:true,sensitivity:'base'})}
function groupByText(items,fn){const map=new Map();for(const item of items){const key=fn(item)||'미분류';if(!map.has(key))map.set(key,[]);map.get(key).push(item)}return [...map.entries()].sort((a,b)=>sortText(a[0],b[0]))}
function makeGroupSummary(label,count,level){const s=document.createElement('summary');s.innerHTML=`<span>${esc(label)}</span><span class="badge">${count}개</span>`;s.className=level==='subject'?'pack-subject-summary':'pack-unit-summary';return s}
function buildGroupedPackList(target,items,opts){target.innerHTML='';if(!items.length){target.innerHTML=`<div class="sub">${esc(opts.emptyText||'문제팩 없음')}</div>`;return}const tree=document.createElement('div');tree.className='pack-tree';for(const [subject,subjectItems] of groupByText(items,packSubject)){const sd=document.createElement('details');sd.className='pack-group pack-subject';sd.open=true;sd.appendChild(makeGroupSummary(subject,subjectItems.length,'subject'));const subjectBody=document.createElement('div');subjectBody.className='pack-group-body';for(const [unit,unitItems] of groupByText(subjectItems,packUnit)){const ud=document.createElement('details');ud.className='pack-group pack-unit';ud.open=true;ud.appendChild(makeGroupSummary(unit,unitItems.length,'unit'));const unitBody=document.createElement('div');unitBody.className='pack-unit-body';for(const p of unitItems){unitBody.appendChild(opts.card(p))}ud.appendChild(unitBody);subjectBody.appendChild(ud)}sd.appendChild(subjectBody);tree.appendChild(sd)}target.appendChild(tree)}
async function deleteRowsByPackPrefix(storeName,source,packId){const prefix=`${source}:${packId}::`;let n=0;for(const row of await all(storeName)){const id=String(row.id||'');if(id.startsWith(prefix)||(row.packSource===source&&row.packId===packId)){await del(storeName,id);n++}}return n}
async function deleteLocalPackCascade(packId){await del('packs',packId);const progress=await deleteRowsByPackPrefix('progress','local',packId);const strokes=await deleteRowsByPackPrefix('strokes','local',packId);const assets=await deleteRowsByPackPrefix('assets','local',packId);return{progress,strokes,assets}}
async function cleanupMissingServerProgress(){const ids=new Set((state.serverPacks||[]).map(p=>String(p.pack_id||p.packId||p.id||'')).filter(Boolean));let removed=0;for(const storeName of ['progress','strokes','assets']){for(const row of await all(storeName)){const id=String(row.id||'');if(!id.startsWith('server:'))continue;const packId=id.slice(7).split('::')[0];if(!ids.has(packId)){await del(storeName,id);removed++}}}if(removed)console.info('삭제된 서버 문제팩의 로컬 오답/필기/첨부 정리:',removed)}
async function fetchServerPackList(){saveServerSettings();state.serverPackError='';try{const data=await fetchJson('/problem-packs');state.serverPacks=data.problem_packs||[];await cleanupMissingServerProgress()}catch(e){state.serverPacks=[];state.serverPackError=e.message||String(e)}}
function packSearchText(p){return [p.title,p.packId,p.pack_id,p.subject,p.folder,p.unit,p.unitTitle,p.unit_number,p.unit_title,p.examSetTitle,p.exam_set_title,(p.tags||[]).join(' ')].map(x=>String(x||'')).join(' ').toLowerCase()}
function populateLibraryFilters(localPacks){const allPacks=[...localPacks.map(x=>x.pack),...state.serverPacks];const subjects=['전체',...new Set(allPacks.map(packSubject))].sort(sortText);const folders=['전체',...new Set(allPacks.map(packUnit))].sort(sortText);const oldSubject=el.subjectFilter?.value||'전체',oldFolder=el.folderFilter?.value||'전체';if(el.subjectFilter)el.subjectFilter.innerHTML=subjects.map(x=>`<option ${x===oldSubject?'selected':''}>${esc(x)}</option>`).join('');if(el.folderFilter)el.folderFilter.innerHTML=folders.map(x=>`<option ${x===oldFolder?'selected':''}>${esc(x)}</option>`).join('');if(el.subjectFilter&&!subjects.includes(oldSubject))el.subjectFilter.value='전체';if(el.folderFilter&&!folders.includes(oldFolder))el.folderFilter.value='전체'}
function applyPackFilters(items,kind='all'){const sf=el.subjectFilter?.value||'전체',ff=el.folderFilter?.value||'전체';const q=(kind==='server'?el.serverPackSearch?.value:kind==='local'?el.localPackSearch?.value:'')?.trim().toLowerCase()||'';return items.filter(p=>(sf==='전체'||packSubject(p)===sf)&&(ff==='전체'||packUnit(p)===ff)&&(!q||packSearchText(p).includes(q)))}
function setLibraryTab(tab='local'){state.libraryTab=tab;const local=tab!=='server';el.libraryTabLocal?.classList.toggle('primary',local);el.libraryTabServer?.classList.toggle('primary',!local);el.localPackPanel?.classList.toggle('active',local);el.serverPackPanel?.classList.toggle('active',!local)}
async function openPackLibrary(tab='local'){state.libraryTab=tab;await renderLibrary();setLibraryTab(tab);openModal(el.libraryModal)}
async function renderLibrary(){const packs=await all('packs');await fetchServerPackList();populateLibraryFilters(packs);setLibraryTab(state.libraryTab||'local');renderServerPackList();await renderPackList();if(navigator.storage?.estimate){const e=await navigator.storage.estimate();el.storageInfo.textContent=`기기 예상 사용량 ${Math.round((e.usage||0)/1048576)}MB / ${Math.round((e.quota||0)/1048576)}MB`}}
async function renderPackList(){const rows=await all('packs');const packs=applyPackFilters(rows.map(x=>x.pack),'local');if(el.localPackCount)el.localPackCount.textContent=`${packs.length}개`;buildGroupedPackList(el.packList,packs,{emptyText:'기기에 저장된 문제팩 없음',card:p=>{const d=document.createElement('div');d.className='pack-card local-pack';d.innerHTML=`<b>${esc(p.title)}</b><div class="sub">기기 저장 · ${esc(packSubject(p))} · ${esc(packUnit(p))} · ${packCount(p)}문항</div><div class="row" style="margin-top:8px"><button class="small primary open">열기</button><button class="small danger delete">오답·필기 포함 삭제</button></div>`;d.querySelector('.open').onclick=()=>loadPack(p.packId);d.querySelector('.delete').onclick=async()=>{if(confirm('기기 저장 문제팩과 연결된 오답/필기/첨부 이미지를 모두 삭제할까요?')){const r=await deleteLocalPackCascade(p.packId);if(state.packSource==='local'&&state.pack?.packId===p.packId){state.pack=null;state.idx=0;await renderAll()}await renderLibrary();alert(`삭제 완료: 오답 ${r.progress}개, 필기 ${r.strokes}개, 첨부 ${r.assets}개`)}};return d}})}
function renderServerPackList(){if(!el.serverPackList)return;if(state.serverPackError){el.serverPackList.innerHTML=`<div class="sub">메인 저장소 조회 실패: ${esc(state.serverPackError)}</div>`;if(el.serverPackCount)el.serverPackCount.textContent='오류';return}const packs=applyPackFilters(state.serverPacks,'server');if(el.serverPackCount)el.serverPackCount.textContent=`${packs.length}개`;buildGroupedPackList(el.serverPackList,packs,{emptyText:'메인 저장소 문제팩 없음',card:p=>{const d=document.createElement('div');d.className='pack-card server-pack';d.innerHTML=`<b>${esc(p.title||'제목 없음')}</b><div class="sub">메인 저장소 · ${esc(packSubject(p))} · ${esc(packUnit(p))} · ${packCount(p)}문항 · ${esc(p.examSetTitle||p.exam_set_title||'')}</div><div class="row" style="margin-top:8px"><button class="small primary open">열기</button><button class="small save-local">기기에 저장</button><button class="small link">다운로드/열기</button></div>`;d.querySelector('.open').onclick=()=>loadServerPack(p.pack_id,false);d.querySelector('.save-local').onclick=()=>loadServerPack(p.pack_id,true);d.querySelector('.link').onclick=()=>{if(p.shortcut_url)location.href=p.shortcut_url;else loadServerPack(p.pack_id,false)};return d}})}
async function loadServerPack(packId,saveLocal=false){if(!packId)return alert('pack_id가 없습니다.');try{saveServerSettings();const data=await fetchJson(`/problem-packs/${encodeURIComponent(packId)}`);const pack=data.pack||data;validatePack(pack);if(saveLocal){await savePack(pack);alert('기기에 저장했습니다.');return}state.pack=pack;state.idx=0;state.packSource='server';state.serverPackId=packId;resetView();await loadStrokes();await renderAll();closeModals()}catch(e){alert('메인 저장소 문제팩 열기 실패: '+(e.message||e))}}
function progressLabel(w){return `${w.subject||'-'} / ${w.examSetTitle||w.unitTitle||'-'} / ${w.packTitle||w.packId||'-'} / ${w.questionTitle||w.questionId||'-'}`}
async function collectWrongRows(){const progresses=await all('progress');const localRows=await all('packs');const map=new Map(localRows.map(x=>[x.pack.packId,x.pack]));return progresses.map(w=>{const p=map.get(w.packId);const qu=p?.questions?.find(x=>x.id===w.questionId);return {...w,subject:w.subject||p?.subject||'-',unitTitle:w.unitTitle||packUnit(p),packTitle:w.packTitle||p?.title||w.packId,questionTitle:w.questionTitle||qu?.title||w.questionId,examSetTitle:w.examSetTitle||p?.examSetTitle||'',_localPack:p,_question:qu}})}
function fillSelect(select,values,old='전체'){if(!select)return;const opts=['전체',...Array.from(new Set(values.filter(Boolean))).sort(sortText)];select.innerHTML=opts.map(x=>`<option ${x===old?'selected':''}>${esc(x)}</option>`).join('');if(!opts.includes(old))select.value='전체'}
async function openWrongManager(){state.wrongRows=await collectWrongRows();fillSelect(el.wrongSubjectFilter,state.wrongRows.map(x=>x.subject),el.wrongSubjectFilter?.value||'전체');fillSelect(el.wrongExamSetFilter,state.wrongRows.map(x=>x.examSetTitle),el.wrongExamSetFilter?.value||'전체');fillSelect(el.wrongUnitFilter,state.wrongRows.map(x=>x.unitTitle),el.wrongUnitFilter?.value||'전체');fillSelect(el.wrongPackFilter,state.wrongRows.map(x=>x.packTitle),el.wrongPackFilter?.value||'전체');renderWrongList();openModal(el.wrongModal)}
function renderWrongList(){const sf=el.wrongSubjectFilter?.value||'전체',ef=el.wrongExamSetFilter?.value||'전체',uf=el.wrongUnitFilter?.value||'전체',pf=el.wrongPackFilter?.value||'전체',status=el.wrongStatusFilter?.value||'wrong';let rows=state.wrongRows||[];rows=rows.filter(w=>(sf==='전체'||w.subject===sf)&&(ef==='전체'||w.examSetTitle===ef)&&(uf==='전체'||w.unitTitle===uf)&&(pf==='전체'||w.packTitle===pf));if(status==='wrong')rows=rows.filter(w=>w.status==='wrong');else if(status==='correct')rows=rows.filter(w=>w.status==='correct');else if(status==='bookmarked')rows=rows.filter(w=>w.bookmarked);el.wrongList.innerHTML=rows.length?'':'<div class="sub">조건에 맞는 기록이 없습니다.</div>';for(const w of rows){const d=document.createElement('div');d.className='wrong-card';d.innerHTML=`<div class="wrong-title">${esc(w.questionTitle||w.questionId)}</div><div class="wrong-meta">${esc(progressLabel(w))}<br>상태: ${esc(w.status||'-')} · ${esc(w.updatedAt||'')}</div><button class="small primary">이 문제 열기</button>`;d.querySelector('button').onclick=()=>openWrongProgress(w);el.wrongList.appendChild(d)}}
async function openWrongProgress(w){try{if(w.packSource==='server'||w.serverPackId){await loadServerPack(w.serverPackId||w.packId,false)}else if(w._localPack){state.pack=w._localPack;state.packSource='local';state.serverPackId=''}else{await loadPack(w.packId)}const idx=state.pack?.questions?.findIndex(x=>x.id===w.questionId)??-1;if(idx>=0)state.idx=idx;resetView();await loadStrokes();await renderAll();closeModals()}catch(e){alert('오답 문제 열기 실패: '+(e.message||e))}}
function openModal(m){m.classList.add('show')}
function closeModals(){$$('.modal').forEach(m=>m.classList.remove('show'))}
async function handleImportToken(){const url=new URL(location.href),packId=url.searchParams.get('packId')||url.searchParams.get('pack_id');const server=url.searchParams.get('server');if(server&&el.serverUrl){el.serverUrl.value=server;saveServerSettings()}if(packId){await loadServerPack(packId,false);history.replaceState(null,'',location.pathname);return}}
function download(name,content,type='text/plain'){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
async function exportBackup(){download('solvepad-backup.json',JSON.stringify({version:'solvepad-backup-v5.5',createdAt:new Date().toISOString(),packs:await all('packs'),progress:await all('progress'),strokes:await all('strokes'),assets:await all('assets')},null,2),'application/json')}
async function importBackupFile(f){const b=JSON.parse(await f.text());for(const s of ['packs','progress','strokes','assets'])for(const row of b[s]||[])await put(s,row);await renderLibrary();alert('백업 가져오기 완료')}
function saveCurrentPageImage(){const r=el.paper.getBoundingClientRect(),tmp=document.createElement('canvas');tmp.width=Math.round(r.width);tmp.height=Math.round(r.height);const c=tmp.getContext('2d');c.fillStyle='#fffdf7';c.fillRect(0,0,tmp.width,tmp.height);c.strokeStyle='#e7dfd1';const grid=24*state.zoom;for(let x=state.panX%grid;x<tmp.width;x+=grid){c.beginPath();c.moveTo(x,0);c.lineTo(x,tmp.height);c.stroke()}for(let y=state.panY%grid;y<tmp.height;y+=grid){c.beginPath();c.moveTo(0,y);c.lineTo(tmp.width,y);c.stroke()}c.drawImage(el.canvas,0,0,tmp.width,tmp.height);tmp.toBlob(b=>{const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='solvepad-writing.png';a.click()},'image/png')}
function bindEvents(){/* legacy-null-safe-marker: if($('quickImport'))$('quickImport').onclick */
  el.sidebarToggle.onclick=()=>el.app.classList.toggle('collapsed');
  if($('openImport')) $('openImport').onclick=()=>openModal(el.importModal);
  if($('quickImport')) $('quickImport').onclick=()=>openModal(el.importModal);
  $('openLibrary').onclick=()=>openPackLibrary('server');
  if(el.openLocalPacks)el.openLocalPacks.onclick=()=>openPackLibrary('local');
  if($('quickLibrary'))$('quickLibrary').onclick=()=>openPackLibrary('local');
  $$('.closeModal').forEach(b=>b.addEventListener('click',closeModals));
  $$('.modal').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)closeModals()}));
  if($('addSample')) $('addSample').onclick=()=>savePack(samplePack);
  if($('applyJson')) $('applyJson').onclick=async()=>{try{await savePack(parsePackJson(el.jsonInput.value));closeModals()}catch(e){alert(e.message)}};
  if(el.jsonFile) el.jsonFile.onchange=async()=>{const f=el.jsonFile.files?.[0];if(f)el.jsonInput.value=await f.text()};
  if(el.serverUrl) el.serverUrl.onchange=()=>{saveServerSettings();renderServerPackList()};
  if(el.actionKey)el.actionKey.onchange=()=>{saveServerSettings();renderServerPackList()};
  if(el.libraryServerUrl)el.libraryServerUrl.onchange=()=>{saveServerSettings();renderServerPackList()};
  if(el.libraryActionKey)el.libraryActionKey.onchange=()=>{saveServerSettings();renderServerPackList()};
  if($('refreshServerPacks'))$('refreshServerPacks').onclick=renderLibrary;
  if(el.libraryTabLocal)el.libraryTabLocal.onclick=()=>setLibraryTab('local');
  if(el.libraryTabServer)el.libraryTabServer.onclick=()=>setLibraryTab('server');
  if(el.localPackSearch)el.localPackSearch.oninput=renderPackList;
  if(el.serverPackSearch)el.serverPackSearch.oninput=renderServerPackList;
  $('prevQ').onclick=async()=>{if(!state.pack)return;await saveStrokesNow();state.idx=Math.max(0,state.idx-1);resetView();await loadStrokes();await renderAll()};
  $('nextQ').onclick=async()=>{if(!state.pack)return;await saveStrokesNow();state.idx=Math.min(state.pack.questions.length-1,state.idx+1);resetView();await loadStrokes();await renderAll()};
  el.penBtn.onclick=()=>{state.tool='pen';el.penBtn.classList.add('primary');el.eraserBtn.classList.remove('primary')};
  el.eraserBtn.onclick=()=>{state.tool='eraser';el.eraserBtn.classList.add('primary');el.penBtn.classList.remove('primary')};
  el.undoBtn.onclick=()=>{pageStrokes().pop();drawStrokes();queueSave()};
  el.clearBtn.onclick=()=>{if(confirm('현재 쪽 풀이를 지울까요?')){state.pages[state.pageIdx]=[];drawStrokes();queueSave()}};
  el.saveImageBtn.onclick=saveCurrentPageImage;
  $('railAnswer').onclick=()=>{renderDrawer('answer');el.drawer.classList.add('show')};
  $('railHint').onclick=()=>{renderDrawer('hint');el.drawer.classList.add('show')};
  $('closeDrawer').onclick=()=>el.drawer.classList.remove('show');
  $('railCorrect').onclick=()=>setProgress({status:'correct'});
  $('railWrong').onclick=()=>setProgress({status:'wrong'});
  $('railBook').onclick=toggleBookmark;
  $('railPrevPage').onclick=prevPage;$('railNextPage').onclick=nextPage;$('prevPage').onclick=prevPage;$('nextPage').onclick=nextPage;$('addPage').onclick=addPage;
  $('zoomIn').onclick=()=>setZoom(state.zoom+.15);$('zoomOut').onclick=()=>setZoom(state.zoom-.15);$('zoomReset').onclick=()=>{resetView();drawStrokes()};
  if(el.pageZoomLock)el.pageZoomLock.onclick=togglePageZoomLock;el.penOnly.onchange=()=>state.penOnly=el.penOnly.checked;
  $('filterAll').onclick=()=>{state.filter='all';renderQList()};$('filterWrong').onclick=()=>{state.filter='wrong';renderQList()};$('filterBook').onclick=()=>{state.filter='book';renderQList()};
  $('showWrongAll').onclick=openWrongManager;
  if(el.subjectFilter)el.subjectFilter.onchange=()=>{renderServerPackList();renderPackList()};
  if(el.folderFilter)el.folderFilter.onchange=()=>{renderServerPackList();renderPackList()};
  for(const id of ['wrongSubjectFilter','wrongExamSetFilter','wrongUnitFilter','wrongPackFilter','wrongStatusFilter']){if($(id))$(id).onchange=renderWrongList}
  if($('refreshWrong'))$('refreshWrong').onclick=openWrongManager;
  $('exportBackup').onclick=exportBackup;
  $('importBackup').onclick=()=>{const f=el.backupFile.files?.[0];if(f)importBackupFile(f)};
  window.addEventListener('resize',resizeCanvas)
}
(async function init(){bindEvents();installIOSPencilGuard();await openDB();el.serverUrl.value=localStorage.getItem('solvepad_action_server_url')||location.origin;if(el.libraryServerUrl)el.libraryServerUrl.value=el.serverUrl.value;if(el.actionKey)el.actionKey.value=localStorage.getItem('lecturenote_action_key')||'';if(el.libraryActionKey)el.libraryActionKey.value=el.actionKey?el.actionKey.value:'';try{await handleImportToken()}catch(e){alert('importToken 오류: '+e.message)}state.penOnly=el.penOnly.checked;state.pageZoomLocked=localStorage.getItem('solvepad_page_zoom_locked')!=='0';applyPageZoomLock();await renderAll();await renderLibrary();resizeCanvas()})();
