import {DEFAULT_PRESETS,makeRequest} from '../domain/core.mjs';
const $=id=>document.getElementById(id);
const state={courses:[],offerings:[],sources:[],notes:[],editingNote:null,activeOffering:null,busy:false,writesEnabled:false,noteRequest:null,drafts:new Map()};
const pageNames={courses:'강의 관리',sources:'강의자료',gpt:'GPT 작업',notes:'정리본'};
const setStatus=msg=>{$('status').textContent=msg;const side=$('sidebarStatus');if(side)side.textContent=msg;};
const fail=msg=>{$('error').textContent=msg;$('error').hidden=false;};
const clear=()=>{$('error').hidden=true;};
const course=()=>state.courses.find(x=>x.id===$('course').value);
const offering=()=>state.offerings.find(x=>x.id===$('offering').value);
function pageFromLocation(){const page=location.hash.slice(1);return pageNames[page]?page:'courses';}
function showPage(page,{push=false,focus=false}={}){
  const active=pageNames[page]?page:'courses';
  for(const panel of document.querySelectorAll('[data-page-panel]'))panel.hidden=panel.dataset.pagePanel!==active;
  for(const button of document.querySelectorAll('[data-page-target]')){
    const selected=button.dataset.pageTarget===active;button.classList.toggle('active',selected);
    if(selected)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
  }
  if(push&&location.hash!==`#${active}`)history.pushState({page:active},'',`#${active}`);
  else if(!location.hash)history.replaceState({page:active},'',`#${active}`);
  document.title=`${pageNames[active]} | 에쁠가속기`;
  $('pageAnnouncement').textContent=`${pageNames[active]} 화면`;
  window.scrollTo({top:0,behavior:'auto'});
  if(focus){const heading=document.querySelector(`[data-page-panel="${active}"] h1`);heading?.setAttribute('tabindex','-1');heading?.focus({preventScroll:true});}
}
function bindNavigation(){
  for(const button of document.querySelectorAll('[data-page-target]'))button.addEventListener('click',()=>showPage(button.dataset.pageTarget,{push:true,focus:true}));
  window.addEventListener('popstate',()=>showPage(pageFromLocation()));showPage(pageFromLocation());
}
async function call(path,options={}){
  const r=await fetch(path,{credentials:'same-origin',cache:'no-store',...options});
  if(!r.ok){
    const messages={401:'ChatGPT 로그인이 필요합니다.',403:'이 자료를 변경할 권한이 없습니다.',404:'자료를 찾을 수 없거나 접근 권한이 없습니다.',409:'다른 수정본이 먼저 저장됐습니다. 작성 내용은 유지됩니다. 최신 정리본을 확인하세요.',413:'파일이 너무 큽니다. 최대 8 MiB까지 등록할 수 있습니다.',423:'로그인 검증이 끝날 때까지 자료 변경이 잠겨 있습니다.',503:'저장소에 연결하지 못했습니다. 작성 내용을 유지하고 다시 시도하세요.'};
    throw Error(messages[r.status]||`요청을 처리하지 못했습니다. (HTTP ${r.status})`);
  }
  return r.json();
}
const json=data=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
const opt=(select,items,label)=>{select.replaceChildren();for(const x of items)select.add(new Option(label(x),x.id));};
const empty=text=>{const li=document.createElement('li');li.textContent=text;return li;};
const types={transcript:'전사본',lecture_slides:'강의자료',past_exam:'기출·시험자료',textbook:'교재·참고자료',exam_trend:'기출 경향',syllabus:'강의계획서',other:'기타'};
const sourceWeeks=()=>[...document.querySelectorAll('#weeksGrid input:checked')].map(el=>Number(el.value));
const updateWeeksSummary=()=>{$('weeksSummary').textContent=sourceWeeks().length?`선택: ${sourceWeeks().join(', ')}주차`:'주차 미지정 · 선택해서 변경';};
function syncSourceMetadataFields(){
  const exam=$('sourceType').value==='past_exam';
  $('weeksField').hidden=exam;
  $('examYearField').hidden=!exam;
  if(!exam)$('examYear').value='';
  updateWeeksSummary();
}
for(let w=1;w<=30;w++){
  const lab=document.createElement('label'),ck=document.createElement('input');
  lab.className='week-option';ck.type='checkbox';ck.value=String(w);
  ck.addEventListener('change',updateWeeksSummary);
  lab.append(ck,document.createTextNode(`${w}주차`));$('weeksGrid').append(lab);
}
$('sourceType').addEventListener('change',syncSourceMetadataFields);
syncSourceMetadataFields();
function rememberDraft(){if(state.activeOffering)state.drafts.set(state.activeOffering,{title:$('noteTitle').value,body:$('noteBody').value,editing:state.editingNote,request:state.noteRequest,
  source:{title:$('sourceTitle').value,text:$('transcript').value,type:$('sourceType').value,provenance:$('provenance').value,file:$('sourceFile').files[0],weeks:sourceWeeks(),examYear:$('examYear').value}});}
function restoreDraft(id){const d=state.drafts.get(id);$('noteTitle').value=d?.title||'';$('noteBody').value=d?.body||'';state.editingNote=d?.editing||null;state.noteRequest=d?.request||null;
  $('source-form').reset();if(d?.source){$('sourceTitle').value=d.source.title;$('transcript').value=d.source.text;$('sourceType').value=d.source.type;$('provenance').value=d.source.provenance;
    if(d.source.file&&typeof DataTransfer!=='undefined'){const files=new DataTransfer();files.items.add(d.source.file);$('sourceFile').files=files.files;}
    $('examYear').value=d.source.examYear||'';for(const el of $('weeksGrid').querySelectorAll('input'))el.checked=(d.source.weeks||[]).includes(Number(el.value));}
  syncSourceMetadataFields();renderNoteSave();}
function renderNoteSave(){$('noteSave').textContent=state.editingNote?`정리본 수정 저장 · v${state.editingNote.revision}`:'새 정리본 저장';}
function renderSources(){
  const node=$('sourceList');node.replaceChildren();
  if(!state.sources.length){node.append(empty('선택한 강의에 등록된 자료가 없습니다.'));return;}
  for(const src of state.sources){
    const li=document.createElement('li'),text=document.createElement('span');
    const loc=src.source_type==='past_exam'?(src.exam_year?`${src.exam_year}년`:'연도 미지정'):(src.weeks?.length?`${src.weeks.join(', ')}주차`:'주차 미지정');
    text.textContent=`${src.title} · ${types[src.source_type]||src.source_type} · ${loc} · ${src.extract_status==='ready'?'검색 가능':src.extract_status==='failed'?'추출 실패':'원문 추출 대기'}`;li.append(text);
    if(src.file_name){const b=document.createElement('button');b.type='button';b.className='ghost small';b.textContent='원본 다운로드';b.onclick=()=>{const a=document.createElement('a');a.href=`/api/files/${encodeURIComponent(src.id)}`;a.click();};li.append(b);}
    node.append(li);
  }
}
function renderNotes(){const node=$('noteList');node.replaceChildren();if(!state.notes.length){node.append(empty('저장된 정리본이 없습니다.'));return;}
  for(const note of state.notes){const li=document.createElement('li'),b=document.createElement('button');b.type='button';b.className='ghost small';b.textContent=`${note.title} · v${note.revision}`;
    b.onclick=()=>run(async()=>{
      const n=await call(`/api/notes?note_id=${encodeURIComponent(note.id)}`);
      if(n.offering_id!==state.activeOffering)throw Error('다른 학년도 강의의 정리본입니다.');
      $('noteTitle').value=n.title;$('noteBody').value=n.content_markdown;state.editingNote={id:n.id,revision:n.revision,offeringId:n.offering_id};state.noteRequest=null;renderNoteSave();rememberDraft();
    },'정리본을 불러왔습니다.');li.append(b);node.append(li);
  }
}
function refreshPrompt(){const c=course(),o=offering();if(!c||!o){$('prompt').value='과목을 등록하면 제작 요청을 준비할 수 있어요.';return;}
  const src=state.sources.map(x=>({id:x.id,type:x.source_type,offeringId:x.offering_id,extractStatus:x.extract_status}));
  $('prompt').value=makeRequest({course:c,offering:o,sources:src,mode:$('mode').value,scope:$('scope').value,preset:DEFAULT_PRESETS[$('mode').value]}).text;
  $('lectureContext').textContent=c.name;
}
async function refreshCourses(selected=$('course').value){state.courses=await call('/api/courses');opt($('course'),state.courses,x=>x.name);
  if(state.courses.some(x=>x.id===selected))$('course').value=selected;await refreshOfferings();}
// The UI is course-only. Keep a private offering ID because the existing D1
// schema and MCP tools scope source/notes to an offering. Never create one for
// another person's course unless the current session can write.
async function refreshOfferings(selected=$('offering').value){
  const id=$('course').value;
  state.offerings=id?await call(`/api/offerings?course_id=${encodeURIComponent(id)}`):[];
  if(id&&!state.offerings.length&&state.writesEnabled){
    const date=new Date();
    const year=date.getFullYear(),term=date.getMonth()<6?'1':'2';
    const created=await call('/api/offerings',json({course_id:id,year,term,professor:'',section:''}));
    state.offerings=await call(`/api/offerings?course_id=${encodeURIComponent(id)}`);
    selected=created.id;
  }
  opt($('offering'),state.offerings,x=>x.id);
  if(state.offerings.some(x=>x.id===selected))$('offering').value=selected;
  await refreshOfferingData();
}
async function refreshOfferingData(){
  const id=$('offering').value;
  if(id!==state.activeOffering){rememberDraft();state.activeOffering=id;restoreDraft(id);state.sources=[];state.notes=[];
    renderSources();renderNotes();refreshPrompt();$('searchResults').replaceChildren();$('searchQuery').value='';if(!id)$('lectureContext').textContent='과목을 선택하세요.';}
  if(id){const [sources,notes]=await Promise.all([call(`/api/sources?offering_id=${encodeURIComponent(id)}`),call(`/api/notes-list?offering_id=${encodeURIComponent(id)}`)]);state.sources=sources;state.notes=notes;}
  else{state.sources=[];state.notes=[];}
  renderSources();renderNotes();refreshPrompt();
}
async function run(fn,success='저장된 자료를 확인했습니다.'){
  if(state.busy)return;state.busy=true;clear();setStatus('처리 중…');
  const controls=[...document.querySelectorAll('button,input,select,textarea')].map(el=>[el,el.disabled]);controls.forEach(([el])=>el.disabled=true);
  try{await fn();setStatus(success);}catch(e){fail(e.message);setStatus('확인이 필요합니다.');}
  finally{state.busy=false;controls.forEach(([el,disabled])=>{if(el.isConnected)el.disabled=disabled;});applyWriteLock();}
}
function applyWriteLock(){document.querySelectorAll('#course-form button,#source-form button,#note-form button,#noteNew').forEach(el=>el.disabled=!state.writesEnabled);}
$('course').onchange=()=>run(refreshOfferings);$('offering').onchange=()=>run(refreshOfferingData);
$('mode').onchange=refreshPrompt;$('scope').oninput=refreshPrompt;
$('course-form').onsubmit=e=>{e.preventDefault();run(async()=>{const r=await call('/api/courses',json({name:$('courseName').value,characteristics:$('characteristics').value}));$('course-form').reset();await refreshCourses(r.id);});};
$('source-form').onsubmit=e=>{e.preventDefault();run(async()=>{
  const o=offering();if(!o)throw Error('과목을 먼저 등록하세요.');
  const file=$('sourceFile').files[0],name=$('sourceTitle').value.trim(),provenance=$('provenance').value,type=$('sourceType').value;
  if(!name)throw Error('등록할 자료 제목을 직접 입력하세요.');
  const weeks=type==='past_exam'?[]:sourceWeeks();
  const exam_year=type==='past_exam'&&$('examYear').value!==''?Number($('examYear').value):null;let r;
  if(file){if(file.size>8*1024*1024)throw Error('최대 8 MiB까지 등록할 수 있습니다.');
    const headers={'Content-Type':'application/octet-stream','X-Offering-Id':o.id,'X-Source-Type':type,'X-Source-Title':encodeURIComponent(name),'X-Source-Provenance':encodeURIComponent(provenance),'X-File-Name':encodeURIComponent(file.name),'X-Source-Weeks':JSON.stringify(weeks),...(exam_year!==null?{'X-Exam-Year':String(exam_year)}:{})};
    r=await call('/api/assets',{method:'POST',headers,body:file});
  }else{if(type!=='transcript')throw Error('전사본 직접 입력 외에는 원본 파일을 선택하세요.');
    r=await call('/api/transcripts',json({offering_id:o.id,title:name,text:$('transcript').value,provenance,weeks,exam_year}));}
  $('source-form').reset();for(const el of $('weeksGrid').querySelectorAll('input'))el.checked=false;syncSourceMetadataFields();await refreshOfferingData();if(r.metadata_updated)fail('동일 파일이 있어 기존 자료의 제목·주차/연도 정보를 입력한 값으로 갱신했습니다.');else if(r.reused)fail('동일 내용의 기존 자료를 재사용했습니다.');
});};
$('search-form').onsubmit=e=>{e.preventDefault();run(async()=>{
  const o=offering();if(!o)throw Error('과목을 먼저 선택하세요.');
  const matches=await call(`/api/search?offering_id=${encodeURIComponent(o.id)}&query=${encodeURIComponent($('searchQuery').value)}`);
  $('searchResults').replaceChildren(...(matches.length?matches.map(m=>empty(`${m.source_title}${m.page_num?' · '+m.page_num+'쪽':''}\n${m.content}`)):[empty('선택한 강의에서 검색 결과를 찾지 못했습니다.')]));
});};
$('noteNew').onclick=()=>{state.editingNote=null;state.noteRequest=null;$('note-form').reset();renderNoteSave();rememberDraft();};
$('note-form').onsubmit=e=>{e.preventDefault();run(async()=>{
  const o=offering();if(!o||o.id!==state.activeOffering)throw Error('강의를 선택하세요.');
  const body={offering_id:o.id,title:$('noteTitle').value,content_markdown:$('noteBody').value};
  if(state.editingNote){if(state.editingNote.offeringId!==o.id)throw Error('다른 강의의 정리본을 변경할 수 없습니다.');body.note_id=state.editingNote.id;body.expected_revision=state.editingNote.revision;}
  else{const fingerprint=JSON.stringify(body);if(state.noteRequest?.fingerprint!==fingerprint)state.noteRequest={fingerprint,id:crypto.randomUUID()};body.request_id=state.noteRequest.id;}
  const saved=await call('/api/notes',json(body));state.editingNote={id:saved.id,revision:saved.revision,offeringId:o.id};state.noteRequest=null;renderNoteSave();rememberDraft();await refreshOfferingData();
},'정리본을 저장했습니다.');};
$('copyPrompt').onclick=()=>run(async()=>{if(!offering())throw Error('강의를 선택하세요.');await navigator.clipboard.writeText($('prompt').value);},'GPT 요청문을 복사했습니다.');
run(async()=>{const user=await call('/api/session');$('accountName').textContent=user.display_name;state.writesEnabled=user.mutations_enabled===true;$('readOnlyNotice').hidden=state.writesEnabled;await refreshCourses();});

// Browser tools use the visible, authenticated workspace. This is separate from the Site MCP plugin.
const modelContext=document.modelContext;
if(modelContext?.registerTool){
  const lifecycle=new AbortController();
  const tools=[{
    name:'get_selected_lecture',title:'선택한 강의 확인',description:'현재 화면에서 선택한 과목·학년도·분반과 자료 목록을 읽습니다.',
    inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},
    execute(input){if(!input||typeof input!=='object'||Object.keys(input).length)throw Error('빈 객체가 필요합니다.');if(state.busy||!offering())throw Error('과목 선택과 자료 로딩을 먼저 완료하세요.');return {course:course(),offering:offering(),sources:state.sources};}
  },{
    name:'search_selected_lecture',title:'선택한 강의자료 검색',description:'현재 선택한 강의의 등록된 텍스트를 검색하고 화면에 결과를 표시합니다.',
    inputSchema:{type:'object',properties:{query:{type:'string',minLength:1,maxLength:180}},required:['query'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},
    async execute(input){
      if(!input||typeof input!=='object'||Object.keys(input).some(k=>k!=='query')||typeof input.query!=='string'||!input.query.trim()||input.query.length>180)throw Error('검색어는 1–180자여야 합니다.');
      if(state.busy||!offering())throw Error('강의 선택과 자료 로딩을 먼저 완료하세요.');
      const id=offering().id;const matches=await call(`/api/search?offering_id=${encodeURIComponent(id)}&query=${encodeURIComponent(input.query)}`);
      if(id!==offering()?.id)throw Error('선택한 강의가 바뀌었습니다. 다시 검색하세요.');
      $('searchQuery').value=input.query;$('searchResults').replaceChildren(...(matches.length?matches.map(m=>empty(`${m.source_title}\n${m.content}`)):[empty('검색 결과가 없습니다.')]));showPage('sources',{push:true});return {offering_id:id,matches};
    }
  }];
  for(const tool of tools){try{Promise.resolve(modelContext.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}}
  window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
}

bindNavigation();
