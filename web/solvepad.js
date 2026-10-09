import {renderNoteMarkdown,noteMathReady} from './note-render.js';
/** Native course-owned SolvePad. The server stores each user's answer and ink. */
const $=id=>document.getElementById(id);
const asText=value=>String(value??'');
const answerText=q=>q.answer?.value??q.answer?.text??q.answer??'';
const normalize=value=>asText(value).trim().replace(/\s+/g,' ').toLowerCase();
function questionTitle(q,index){return asText(q.title||q.section||`문제 ${index+1}`);}
function attemptData(row){
  try{return row?.data_json?JSON.parse(row.data_json):{}}catch{return {}}
}
function solutionText(q){
  const s=q.solution;
  if(typeof s==='string')return s;
  if(!s||typeof s!=='object')return '등록된 해설이 없습니다.';
  return [['핵심 개념',s.concepts],['풀이',s.actualSolution],['주의',s.cautions],['팁',s.tips]]
    .filter(([,v])=>v).map(([name,v])=>name+'\n'+(Array.isArray(v)?v.join('\n'):asText(v))).join('\n\n')||'등록된 해설이 없습니다.';
}
async function renderPrompt(target,input){
  target.classList.add('solve-math-content');
  renderNoteMarkdown(target,asText(input),{compactIntroduction:false});
  await noteMathReady();
}
export function createSolvePad({call,json,notify,onError}){
  const canvas=$('solveInk'),ctx=canvas.getContext('2d');
  const s={packId:null,pack:null,questions:[],index:0,pageIndex:0,attempts:new Map(),
    pages:[[]],answer:'',result:'',bookmarked:false,tool:'pen',stroke:null,pointer:null,
    dirty:false,timer:null,saving:Promise.resolve(),writable:false,loadToken:0,hintIndex:0};
  const key=()=>s.questions[s.index]?.id;
  function status(text){$('solveSaveStatus').textContent=text;}
  function snapshot(){return {pack_id:s.packId,question_id:asText(key()),answer:s.answer,
    strokes:s.pages,result:s.result,bookmarked:s.bookmarked};}
  function capture(){s.answer=$('solveAnswer').value;}
  function markDirty(){
    if(!s.writable)return;
    capture();s.dirty=true;status('저장 중…');
    clearTimeout(s.timer);s.timer=setTimeout(()=>{void flush().catch(e=>onError('풀이 저장 실패: '+e.message));},650);
  }
  async function flush(){
    clearTimeout(s.timer);
    if(!s.dirty||!s.packId||!key()||!s.writable)return;
    capture();const payload=snapshot();s.dirty=false;
    s.saving=s.saving.catch(()=>{}).then(()=>call('/api/v2/attempt',json(payload)));
    try{
      await s.saving;
      s.attempts.set(payload.question_id,{...payload});
      if(s.packId===payload.pack_id&&key()===payload.question_id)status('사이트에 저장됨');
    }catch(e){s.dirty=true;status('저장 실패 · 다시 시도');throw e}
  }
  function current(){return s.questions[s.index]}
  function loadAttempt(){
    const a=s.attempts.get(asText(key()))||{};
    s.pages=Array.isArray(a.strokes)&&a.strokes.length&&a.strokes.every(Array.isArray)?a.strokes:[[]];
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
    if(!s.pack||!s.writable||e.button!==0)return;
    e.preventDefault();canvas.setPointerCapture(e.pointerId);s.pointer=e.pointerId;
    const p=position(e);
    if(s.tool==='erase')erase(p);
    else{s.stroke={color:'#263345',width:Number($('solveWidth').value)||4,points:[p]};redraw();}
  });
  canvas.addEventListener('pointermove',e=>{
    if(e.pointerId!==s.pointer)return;e.preventDefault();
    const events=e.getCoalescedEvents?.()||[e];
    for(const event of events){
      const p=position(event);
      if(s.tool==='erase')erase(p);
      else if(s.stroke){const last=s.stroke.points.at(-1);if(Math.hypot((p.x-last.x)*canvas.clientWidth,(p.y-last.y)*canvas.clientHeight)>1)s.stroke.points.push(p);}
    }
    redraw();
  });
  const finish=e=>{
    if(e.pointerId!==s.pointer)return;e.preventDefault();
    if(s.stroke){page().push(s.stroke);s.stroke=null;markDirty();}
    s.pointer=null;redraw();
  };
  canvas.addEventListener('pointerup',finish);canvas.addEventListener('pointercancel',finish);
  new ResizeObserver(redraw).observe(canvas);
  function renderList(){
    const node=$('solveQuestionList'),picker=$('solveQuestionSelect');node.replaceChildren();picker.replaceChildren();
    const filter=$('solveFilter').value;
    s.questions.forEach((q,index)=>{
      const a=s.attempts.get(asText(q.id))||{};
      if(filter==='bookmarked'&&!a.bookmarked&&!(index===s.index&&s.bookmarked))return;
      if(filter==='wrong'&&a.result!=='wrong'&&!(index===s.index&&s.result==='wrong'))return;
      const b=document.createElement('button');b.type='button';
      b.classList.toggle('active',index===s.index);
      b.textContent=`${index+1}. ${questionTitle(q,index)}`;
      const meta=document.createElement('small');
      meta.textContent=[a.bookmarked?'★':'',a.result==='correct'?'정답':a.result==='wrong'?'오답':a.answer?'풀이 중':''].filter(Boolean).join(' · ');
      b.append(meta);b.onclick=()=>{void open(index).catch(e=>onError(e.message))};node.append(b);
      picker.add(new Option(`${index+1}. ${questionTitle(q,index)}`,String(index)));
    });
    if(!node.children.length){const p=document.createElement('p');p.textContent='해당하는 문제가 없습니다.';node.append(p);}
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
      const value=asText(choice.value??choice.id??index+1),label=document.createElement('label'),radio=document.createElement('input');
      radio.type='radio';radio.name='solveChoice';radio.value=value;radio.checked=s.answer===value;radio.disabled=!s.writable;
      radio.onchange=()=>{$('solveAnswer').value=value;markDirty()};
      const content=document.createElement('span');label.append(radio,content);choices.append(label);void renderPrompt(content,choice.text??choice.label??choice);
    });
    $('solveAnswer').value=s.answer;
    $('solveBookmark').textContent=s.bookmarked?'★ 북마크 해제':'☆ 북마크';
    $('solveBookmark').setAttribute('aria-pressed',String(s.bookmarked));
    $('solveFeedback').hidden=!s.result;
    $('solveFeedback').textContent=s.result==='correct'?'정답입니다.':s.result==='wrong'?'오답입니다. 해설을 확인하고 다시 풀어보세요.':'저장한 풀이입니다.';
    $('solveFeedback').className='solve-feedback '+(s.result==='correct'?'correct':s.result==='wrong'?'wrong':'');
    $('solveReveal').hidden=true;$('solveReveal').replaceChildren();
    $('solvePrev').disabled=s.index===0;$('solveNext').disabled=s.index===s.questions.length-1;
    status(s.attempts.has(asText(q.id))?'사이트에 저장됨':'작성하면 자동 저장');
    renderList();redraw();
  }
  async function open(index){
    if(index<0||index>=s.questions.length||index===s.index)return;
    await flush();s.index=index;loadAttempt();await renderQuestion();
  }
  $('solveFilter').onchange=renderList;
  $('solveQuestionSelect').onchange=e=>{if(e.target.value!=='')void open(Number(e.target.value)).catch(err=>onError(err.message));};
  $('solveAnswer').oninput=markDirty;
  $('solvePen').onclick=()=>setTool('pen');
  $('solveErase').onclick=()=>setTool('erase');
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
  $('solvePrev').onclick=()=>{void open(s.index-1).catch(e=>onError(e.message))};
  $('solveNext').onclick=()=>{void open(s.index+1).catch(e=>onError(e.message))};
  $('solveBookmark').onclick=()=>{s.bookmarked=!s.bookmarked;$('solveBookmark').textContent=s.bookmarked?'★ 북마크 해제':'☆ 북마크';$('solveBookmark').setAttribute('aria-pressed',String(s.bookmarked));markDirty();renderList()};
  $('solveCheck').onclick=()=>{
    const q=current();capture();
    if(!s.answer.trim()){onError('답안을 입력하거나 선택해 주세요.');return}
    const expected=q.answer?.acceptable?.length?q.answer.acceptable:[answerText(q)];
    if(expected.every(x=>!asText(x).trim()))s.result='self_review';
    else s.result=expected.some(x=>normalize(x)===normalize(s.answer))?'correct':'wrong';
    $('solveFeedback').hidden=false;
    $('solveFeedback').textContent=s.result==='correct'?'정답입니다.':s.result==='wrong'?'오답입니다. 해설을 확인하고 다시 풀어보세요.':'자동 채점 답이 없어 해설과 비교해 주세요.';
    $('solveFeedback').className='solve-feedback '+(s.result==='correct'?'correct':s.result==='wrong'?'wrong':'');
    markDirty();renderList();
  };
  $('solveHint').onclick=()=>{
    const hints=current().hints||[];
    const box=$('solveReveal');box.hidden=false;box.replaceChildren();
    const h=document.createElement('h3');h.textContent='힌트';box.append(h);
    const p=document.createElement('div');box.append(p);void renderPrompt(p,hints.length?hints[Math.min(s.hintIndex++,hints.length-1)]:'등록된 힌트가 없습니다.');
  };
  $('solveSolution').onclick=()=>{
    const box=$('solveReveal');box.hidden=false;box.replaceChildren();
    const h=document.createElement('h3');h.textContent='해설';box.append(h);
    const q=current(),answer=document.createElement('div'),p=document.createElement('div');box.append(answer,p);void renderPrompt(answer,'**정답**\n\n'+asText(q.answer?.displayMd??answerText(q)));void renderPrompt(p,solutionText(q));
  };
  return {
    async load(id,record){
      await flush();
      if(!record?.pack||!Array.isArray(record.pack.questions)||!record.pack.questions.length)throw Error('문제가 없는 문제팩입니다.');
      s.packId=id;s.pack=record.pack;s.questions=record.pack.questions;s.index=0;
      const attempts=await call('/api/v2/attempts?pack_id='+encodeURIComponent(id));
      s.attempts=new Map(attempts.map(row=>[asText(row.question_id),attemptData(row)]));
      $('solvePackTitle').textContent=record.title||record.pack.title||'문제팩';
      $('solveCount').textContent=s.questions.length+'문제';
      $('solveEmpty').hidden=true;$('solveWorkspace').hidden=false;
      loadAttempt();await renderQuestion();notify('문제팩을 열었습니다.');
    },
    async reset(){
      await flush();s.packId=null;s.pack=null;s.questions=[];s.attempts.clear();s.dirty=false;
      $('solveEmpty').hidden=false;$('solveWorkspace').hidden=true;
    },
    setWritable(value){
      s.writable=!!value;
      for(const id of ['solveAnswer','solveCheck','solveBookmark','solvePen','solveErase','solveWidth','solveUndo','solveClear','solveAddPage'])$(id).disabled=!s.writable;
      for(const input of $('solveChoices').querySelectorAll('input'))input.disabled=!s.writable;
      redraw();
    },
    flush
  };
}
