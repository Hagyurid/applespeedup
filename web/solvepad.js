import {createDraftStore} from './local-drafts.js';
import {renderNoteMarkdown,noteMathReady} from './note-render.js';
import {answerText,questionTitle,solutionText} from '../domain/problem-presentation.mjs';
/** Native course-owned SolvePad. Save results and ink together on navigation. */
const $=id=>document.getElementById(id);
const asText=value=>String(value??'');
function attemptData(row){
  try{return row?.data_json?JSON.parse(row.data_json):{}}catch{return {}}
}
async function renderPrompt(target,input){
  target.classList.add('solve-math-content');
  renderNoteMarkdown(target,asText(input),{compactIntroduction:false,pageBreaks:false});
  await noteMathReady();
}
export function createSolvePad({call,json,notify,onError}){
  const canvas=$('solveInk'),ctx=canvas.getContext('2d');
  const s={packId:null,pack:null,questions:[],index:0,pageIndex:0,attempts:new Map(),
    pages:[[]],answer:'',result:'',bookmarked:false,tool:'pen',penOnly:false,stroke:null,pointer:null,
    dirty:false,timer:null,saving:Promise.resolve(),writable:false,loadToken:0,hintIndex:0,revealMode:null};
  let drafts=createDraftStore(null),pending=null,transitioning=false,change=0,conflicted=false;
  let transitionDone=Promise.resolve();
  const revisions=new Map();
  const draftKey=()=>`ink:${s.packId}:${key()}`;
  const key=()=>s.questions[s.index]?.id;
  function status(text){$('solveSaveStatus').textContent=text;}
  function snapshot(){return {pack_id:s.packId,question_id:asText(key()),answer:s.answer,
    strokes:structuredClone(s.pages),result:s.result,bookmarked:s.bookmarked};}
  function checkpoint(){
    clearTimeout(s.timer);
    if(!s.packId||!key()||!(s.dirty||s.stroke))return;
    const data=snapshot();if(s.stroke)data.strokes[s.pageIndex].push(structuredClone(s.stroke));
    drafts.write(draftKey(),{...data,base_revision:revisions.get(asText(key()))||0});
  }
  function markDirty(){
    if(!s.writable||transitioning)return;
    change++;s.dirty=true;status('문제·화면 이동 시 저장');
    // Recovery copies stay on this device; drawing never sends a server request.
    clearTimeout(s.timer);s.timer=setTimeout(checkpoint,1200);
  }
  async function flush(){
    clearTimeout(s.timer);
    if(pending){await pending;if(s.dirty)return flush();return;}
    if(!s.dirty||!s.packId||!key()||!s.writable)return;
    if(conflicted)throw Error('최신 풀이를 먼저 불러오세요. 기기 초안은 보존됩니다.');
    const payload=snapshot(),version=change;
    checkpoint();status('풀이 저장 중…');
    payload.expected_revision=revisions.get(payload.question_id)||0;
    const task=(async()=>{
      try{
        const saved=await call('/api/v2/attempt',json(payload));
        const revision=saved.revision??payload.expected_revision+1;
        revisions.set(payload.question_id,revision);s.attempts.set(payload.question_id,{...payload});
        if(change===version){s.dirty=false;drafts.remove(draftKey());status('사이트에 저장됨');}
        else drafts.write(draftKey(),{...snapshot(),base_revision:revision});
      }catch(e){s.dirty=true;conflicted=e.status===409;$('solveReload').hidden=!conflicted;status('저장 실패 · 기기 초안 보존');throw e;}
    })();
    pending=task;try{await task;}finally{pending=null;}
  }
  const controls=['solveCorrect','solveWrong','solveUnmarked','solveBookmark','solvePen','solveErase','solvePenOnly','solveWidth','solveUndo','solveClear','solveAddPage','solveRestoreDraft'];
  function updateWritable(){for(const id of controls)$(id).disabled=!s.writable||transitioning;}
  async function transition(fn){
    if(transitioning){await transitionDone;return transition(fn);}
    let unlock;transitionDone=new Promise(resolve=>{unlock=resolve});
    // Commit an active pen stroke before locking the old question.
    if(s.stroke){s.pages[s.pageIndex].push(s.stroke);s.stroke=null;s.pointer=null;markDirty();}
    transitioning=true;updateWritable();
    try{await flush();return await fn();}finally{transitioning=false;updateWritable();unlock();}
  }
  function current(){return s.questions[s.index]}
  function loadAttempt(){
    const a=s.attempts.get(asText(key()))||{};
    s.pages=Array.isArray(a.strokes)&&a.strokes.length&&a.strokes.every(Array.isArray)?structuredClone(a.strokes):[[]];
    $('solveRestoreDraft').hidden=!drafts.read(draftKey());
    s.pageIndex=0;s.answer=asText(a.answer);s.result=asText(a.result);s.bookmarked=!!a.bookmarked;s.dirty=false;s.hintIndex=0;
  }
  function page(){return s.pages[s.pageIndex]}
  function drawStroke(stroke){
    const points=stroke?.points;if(!Array.isArray(points)||!points.length)return;
    const w=canvas.clientWidth,h=canvas.clientHeight;
    ctx.strokeStyle=stroke.color||'#263345';ctx.fillStyle=ctx.strokeStyle;ctx.lineWidth=stroke.width||4;
    ctx.lineCap='round';ctx.lineJoin='round';
    if(points.length===1){ctx.beginPath();ctx.arc(points[0].x*w,points[0].y*h,ctx.lineWidth/2,0,Math.PI*2);ctx.fill();return}
    ctx.beginPath();ctx.moveTo(points[0].x*w,points[0].y*h);
    for(const p of points.slice(1))ctx.lineTo(p.x*w,p.y*h);
    ctx.stroke();
  }
  function redraw(){
    const w=canvas.clientWidth,h=canvas.clientHeight;
    if(!w||!h)return;
    const dpr=Math.min(window.devicePixelRatio||1,2);
    if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){
      canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);
    }
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
    for(const stroke of page()||[])drawStroke(stroke);
    if(s.stroke)drawStroke(s.stroke);
    $('solvePageLabel').textContent=`${s.pageIndex+1} / ${s.pages.length}`;
    $('solvePrevPage').disabled=s.pageIndex===0;
    $('solveNextPage').disabled=s.pageIndex===s.pages.length-1;
    $('solveAddPage').disabled=!s.writable||s.pages.length>=20;
  }
  function position(event){
    const rect=canvas.getBoundingClientRect();
    return {x:Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),
      y:Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height))};
  }
  function near(stroke,p){
    const points=stroke.points||[],w=canvas.clientWidth,h=canvas.clientHeight;
    for(let i=0;i<points.length;i++){
      const a=points[i],b=points[i+1]||a,ax=a.x*w,ay=a.y*h,bx=b.x*w,by=b.y*h;
      const dx=bx-ax,dy=by-ay,t=Math.max(0,Math.min(1,((p.x*w-ax)*dx+(p.y*h-ay)*dy)/(dx*dx+dy*dy||1)));
      if(Math.hypot(p.x*w-ax-t*dx,p.y*h-ay-t*dy)<20)return true;
    }
    return false;
  }
  function erase(p){const before=page().length;s.pages[s.pageIndex]=page().filter(stroke=>!near(stroke,p));if(before!==page().length){redraw();markDirty()}}
  canvas.addEventListener('pointerdown',e=>{
    if(!s.pack||!s.writable||transitioning||e.button!==0||s.pointer!==null||(s.penOnly&&e.pointerType!=='pen'))return;
    e.preventDefault();canvas.setPointerCapture(e.pointerId);s.pointer=e.pointerId;
    const p=position(e);
    if(s.tool==='erase')erase(p);
    else{s.stroke={color:'#263345',width:Number($('solveWidth').value)||4,points:[p]};redraw();}
  });
  canvas.addEventListener('pointermove',e=>{
    if(transitioning||e.pointerId!==s.pointer)return;e.preventDefault();
    const events=e.getCoalescedEvents?.()||[e];
    for(const event of events){
      const p=position(event);
      if(s.tool==='erase')erase(p);
      else if(s.stroke){const last=s.stroke.points.at(-1);if(Math.hypot((p.x-last.x)*canvas.clientWidth,(p.y-last.y)*canvas.clientHeight)>1)s.stroke.points.push(p);}
    }
    redraw();
  });
  const finish=e=>{
    if(transitioning||e.pointerId!==s.pointer)return;e.preventDefault();
    if(s.stroke){page().push(s.stroke);s.stroke=null;markDirty();}
    s.pointer=null;redraw();
  };
  canvas.addEventListener('pointerup',finish);canvas.addEventListener('pointercancel',finish);
  new ResizeObserver(redraw).observe(canvas);
  function renderList(){
    const node=$('solveQuestionList'),picker=$('solveQuestionSelect');node.replaceChildren();picker.replaceChildren();
    const filter=$('solveFilter').value;
    s.questions.forEach((q,index)=>{
      const a=index===s.index?{result:s.result,bookmarked:s.bookmarked}:s.attempts.get(asText(q.id))||{};
      if(filter==='bookmarked'&&!a.bookmarked)return;
      if(filter==='wrong'&&a.result!=='wrong')return;
      const b=document.createElement('button');b.type='button';
      b.classList.toggle('active',index===s.index);
      b.textContent=`${index+1}. ${questionTitle(q,index)}`;
      const meta=document.createElement('small');
      meta.textContent=[a.bookmarked?'★':'',a.result==='correct'?'정답':a.result==='wrong'?'오답':''].filter(Boolean).join(' · ');
      b.append(meta);b.onclick=()=>{void open(index).catch(e=>onError(e.message))};node.append(b);
      picker.add(new Option(`${index+1}. ${questionTitle(q,index)}`,String(index)));
    });
    if(!node.children.length){const p=document.createElement('p');p.textContent='해당하는 문제가 없습니다.';node.append(p);}
    const indices=[...picker.options].map(x=>Number(x.value));
    $('solveSheet').hidden=!indices.includes(s.index);$('solveFilteredEmpty').hidden=indices.includes(s.index);
    $('solvePrev').disabled=!indices.some(x=>x<s.index);$('solveNext').disabled=!indices.some(x=>x>s.index);
    if(picker.options.length)picker.value=String(s.index);
    else picker.add(new Option('해당하는 문제가 없습니다.',''));
  }
  async function renderQuestion(){
    const q=current();if(!q)return;
    const token=++s.loadToken;
    $('solveNumber').textContent=`${s.index+1} / ${s.questions.length}`;
    $('solveQuestionTitle').textContent=questionTitle(q,s.index);
    await renderPrompt($('solvePrompt'),q.promptMd??q.body??q.prompt??'');
    if(token!==s.loadToken)return;
    const choices=$('solveChoices');choices.replaceChildren();
    if(Array.isArray(q.choices))q.choices.forEach((choice,index)=>{
      const label=document.createElement('div'),content=document.createElement('span');
      label.append(document.createTextNode(`${index+1}. `),content);choices.append(label);void renderPrompt(content,choice.text??choice.label??choice);
    });
    $('solveBookmark').textContent=s.bookmarked?'★ 북마크 해제':'☆ 북마크';
    $('solveBookmark').setAttribute('aria-pressed',String(s.bookmarked));
    renderResult();
    closeReveal();

    status(s.dirty?'문제·화면 이동 시 저장':s.attempts.has(asText(q.id))?'사이트에 저장됨':'문제·화면 이동 시 저장');
    renderList();redraw();
  }
  async function open(index){
    if(index<0||index>=s.questions.length||index===s.index)return;
    const packId=s.packId;
    return transition(async()=>{if(s.packId!==packId||index>=s.questions.length)return;s.index=index;loadAttempt();await renderQuestion();});
  }
  const visibleIndices=()=>s.questions.map((q,index)=>({q,index})).filter(({q,index})=>{
    const a=index===s.index?{result:s.result,bookmarked:s.bookmarked}:s.attempts.get(asText(q.id))||{};
    return $('solveFilter').value==='wrong'?a.result==='wrong':$('solveFilter').value==='bookmarked'?a.bookmarked:true;
  }).map(x=>x.index);
  function moveVisible(direction){
    const indices=visibleIndices();
    const index=direction>0?indices.find(x=>x>s.index):indices.findLast(x=>x<s.index);
    if(index!==undefined)void open(index).catch(e=>onError(e.message));
  }
  $('solveFilter').onchange=()=>{
    renderList();const indices=visibleIndices();
    if(indices.length&&!indices.includes(s.index))void open(indices[0]).catch(e=>onError(e.message));
  };
  $('solveQuestionSelect').onchange=e=>{if(e.target.value!=='')void open(Number(e.target.value)).catch(err=>onError(err.message));};
  $('solvePen').onclick=()=>setTool('pen');
  $('solveErase').onclick=()=>setTool('erase');
  $('solvePenOnly').onclick=()=>{
    if(!s.writable||transitioning)return;
    if(s.stroke){page().push(s.stroke);s.stroke=null;markDirty();}
    s.pointer=null;s.penOnly=!s.penOnly;
    $('solvePenOnly').setAttribute('aria-pressed',String(s.penOnly));
    $('solvePenOnly').classList.toggle('active',s.penOnly);
    $('solvePenOnly').textContent=s.penOnly?'펜만 입력 · 켜짐':'펜만 입력';redraw();
  };
  function setTool(name){
    s.tool=name;
    for(const [id,mode] of [['solvePen','pen'],['solveErase','erase']]){
      $(id).classList.toggle('active',name===mode);$(id).setAttribute('aria-pressed',String(name===mode));
    }
    canvas.style.cursor=name==='erase'?'cell':'crosshair';
  }
  $('solveUndo').onclick=()=>{if(page().length){page().pop();redraw();markDirty()}};
  $('solveClear').onclick=()=>{if(page().length&&window.confirm('현재 필기장만 지울까요?')){s.pages[s.pageIndex]=[];redraw();markDirty()}};
  $('solvePrevPage').onclick=()=>{if(s.pageIndex>0){s.pageIndex--;redraw()}};
  $('solveNextPage').onclick=()=>{if(s.pageIndex<s.pages.length-1){s.pageIndex++;redraw()}};
  $('solveAddPage').onclick=()=>{if(s.pages.length<20){s.pages.push([]);s.pageIndex=s.pages.length-1;redraw();markDirty()}};
  $('solvePrev').onclick=()=>{moveVisible(-1)};
  $('solveNext').onclick=()=>{moveVisible(1)};
  $('solveBookmark').onclick=()=>{s.bookmarked=!s.bookmarked;$('solveBookmark').textContent=s.bookmarked?'★ 북마크 해제':'☆ 북마크';$('solveBookmark').setAttribute('aria-pressed',String(s.bookmarked));markDirty();renderList()};
  function renderResult(){
    for(const [id,value] of [['solveCorrect','correct'],['solveWrong','wrong'],['solveUnmarked','']]){
      $(id).setAttribute('aria-pressed',String(s.result===value));
    }
    $('solveFeedback').hidden=!['correct','wrong'].includes(s.result);
    $('solveFeedback').textContent=s.result==='correct'?'정답으로 기록했습니다.':'오답으로 기록했습니다.';
    $('solveFeedback').className='solve-feedback '+s.result;
  }
  function recordResult(result){
    if(!s.writable||transitioning||!current())return;
    s.result=result;markDirty();renderResult();renderList();
  }
  $('solveCorrect').onclick=()=>recordResult('correct');
  $('solveWrong').onclick=()=>recordResult('wrong');
  $('solveUnmarked').onclick=()=>recordResult('');
  function closeReveal(){
    s.revealMode=null;$('solveReveal').hidden=true;$('solveReveal').replaceChildren();
    $('solveHint').setAttribute('aria-expanded','false');$('solveSolution').setAttribute('aria-expanded','false');
    $('solveHint').textContent='힌트';$('solveSolution').textContent='해설 보기';
  }
  function reveal(mode){
    if(s.revealMode===mode){closeReveal();return null;}
    closeReveal();s.revealMode=mode;const box=$('solveReveal');box.hidden=false;
    const id=mode==='hint'?'solveHint':'solveSolution';$(id).setAttribute('aria-expanded','true');$(id).textContent=mode==='hint'?'힌트 닫기':'해설 닫기';
    const close=document.createElement('button');close.type='button';close.className='ghost small';close.textContent='닫기';close.onclick=()=>{closeReveal();$(id).focus?.();};box.append(close);
    return box;
  }
  $('solveHint').setAttribute('aria-controls','solveReveal');$('solveSolution').setAttribute('aria-controls','solveReveal');
  $('solveHint').onclick=()=>{
    const box=reveal('hint');if(!box)return;
    const hints=current().hints||[];
    const h=document.createElement('h3');h.textContent='힌트';box.append(h);
    const p=document.createElement('div');box.append(p);void renderPrompt(p,hints.length?hints[Math.min(s.hintIndex++,hints.length-1)]:'등록된 힌트가 없습니다.');
  };
  $('solveSolution').onclick=()=>{
    const box=reveal('solution');if(!box)return;
    const h=document.createElement('h3');h.textContent='해설';box.append(h);
    const q=current(),answer=document.createElement('div'),p=document.createElement('div');box.append(answer,p);void renderPrompt(answer,'**정답**\n\n'+asText(q.answer?.displayMd??answerText(q)));void renderPrompt(p,solutionText(q));
  };
  $('solveReload').onclick=async()=>{
    if(transitioning||!s.packId)return;
    if(!globalThis.confirm('기기 초안을 보관하고 사이트의 최신 풀이를 불러올까요?'))return;
    const wasDirty=s.dirty;
    s.dirty=false;
    try{await transition(async()=>{
      const rows=await call('/api/v2/attempts?pack_id='+encodeURIComponent(s.packId));
      s.attempts=new Map(rows.map(row=>[asText(row.question_id),attemptData(row)]));revisions.clear();for(const row of rows)revisions.set(asText(row.question_id),row.revision||1);
      conflicted=false;$('solveReload').hidden=true;loadAttempt();await renderQuestion();
    });}catch(e){s.dirty=wasDirty;onError(e.message);}
  };
  $('solveRestoreDraft').onclick=()=>{
    if(!s.writable||transitioning)return;
    const draft=drafts.read(draftKey());if(!draft)return;
    if(!globalThis.confirm('기기에 남은 풀이 초안을 불러올까요? 현재 풀이 대신 초안을 저장하게 됩니다.'))return;
    s.pages=structuredClone(draft.strokes||[[]]);s.pageIndex=0;s.answer=asText(draft.answer);s.result=asText(draft.result);s.bookmarked=!!draft.bookmarked;
    markDirty();void renderQuestion();$('solveRestoreDraft').hidden=true;
  };
  globalThis.window?.addEventListener('pagehide',checkpoint);
  globalThis.document?.addEventListener?.('visibilitychange',()=>{if(document.visibilityState==='hidden')checkpoint();});
  return {
    async load(id,record){
      return transition(async()=>{
        if(!record?.pack||!Array.isArray(record.pack.questions)||!record.pack.questions.length)throw Error('문제가 없는 문제팩입니다.');
        // Do not switch either the visible problem or save target on a failed fetch.
        const attempts=await call('/api/v2/attempts?pack_id='+encodeURIComponent(id));
        const nextAttempts=new Map(attempts.map(row=>[asText(row.question_id),attemptData(row)]));
        revisions.clear();for(const row of attempts)revisions.set(asText(row.question_id),row.revision||1);
        s.packId=id;s.pack=record.pack;s.questions=record.pack.questions;s.index=0;s.attempts=nextAttempts;
        $('solvePackTitle').textContent=record.title||record.pack.title||'문제팩';
        $('solveCount').textContent=s.questions.length+'문제';
        $('solveEmpty').hidden=true;$('solveWorkspace').hidden=false;
        loadAttempt();await renderQuestion();notify('문제팩을 열었습니다.');
      });
    },
    async reset(){return transition(async()=>{
      s.packId=null;s.pack=null;s.questions=[];s.attempts.clear();revisions.clear();s.dirty=false;
      $('solveEmpty').hidden=false;$('solveWorkspace').hidden=true;
    });},
    setStorageUser(userId){drafts=createDraftStore(userId,onError);},
    setWritable(value){s.writable=!!value;updateWritable();redraw();},
    saveCurrent(){return transition(async()=>{});},
    flush
  };
}
