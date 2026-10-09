import {DEFAULT_PRESETS} from '../domain/core.mjs';
import {createSolvePad} from './solvepad.js';
import {preparePdfPages} from './pdf-pages.js';
import {renderNoteMarkdown} from './note-render.js';
const $=id=>document.getElementById(id);
const state={courses:[],offerings:[],sources:[],notes:[],jobs:[],editingNote:null,activeOffering:null,busy:false,writesEnabled:false,noteRequest:null,drafts:new Map(),selectedIds:new Set(),pdfTask:null,showNotePreview:true};
const pageNames={courses:'강의 관리',sources:'강의자료',gpt:'GPT 제작실',notes:'정리본',solvepad:'SolvePad 문제풀이',casio:'CASIO Studio'};
const setStatus=msg=>{$('status').textContent=msg;const side=$('sidebarStatus');if(side)side.textContent=msg;};
const fail=msg=>{$('error').textContent=msg;$('error').hidden=false;};
const clear=()=>{$('error').hidden=true;};
const course=()=>state.courses.find(x=>x.id===$('course').value);
const offering=()=>course()?{id:course().id}:null;
const selectedSources=()=>state.sources.filter(x=>state.selectedIds.has(x.id));
const isReviewed=src=>src.review_status==='reviewed';
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
const pad=createSolvePad({call,json,notify:setStatus,onError:fail});
const opt=(select,items,label)=>{select.replaceChildren();for(const x of items)select.add(new Option(label(x),x.id));};
const empty=text=>{const li=document.createElement('li');li.textContent=text;return li;};
const types={transcript:'전사본',lecture_slides:'강의자료',past_exam:'기출·시험자료',textbook:'교재·참고자료',exam_trend:'기출 경향',syllabus:'강의계획서',other:'기타'};
async function createPagePreview(file){
  if(!['image/png','image/jpeg'].includes(file.type))return null;
  const url=URL.createObjectURL(file),image=new Image();
  try{
    image.src=url;
    await image.decode();
    const ratio=Math.min(1,1600/Math.max(image.naturalWidth,image.naturalHeight));
    let width=Math.max(1,Math.round(image.naturalWidth*ratio));
    let height=Math.max(1,Math.round(image.naturalHeight*ratio));
    const canvas=document.createElement('canvas');
    for(let attempt=0;attempt<5;attempt++){
      canvas.width=width;canvas.height=height;
      const ctx=canvas.getContext('2d');if(!ctx)throw Error('이미지 미리보기를 만들 수 없습니다.');
      ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);
      ctx.drawImage(image,0,0,width,height);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.83));
      if(blob&&blob.size>=50&&blob.size<=1024*1024)return blob;
      width=Math.max(1,Math.floor(width*.8));height=Math.max(1,Math.floor(height*.8));
    }
    throw Error('이미지를 OCR 전송용으로 압축하지 못했습니다.');
  }finally{URL.revokeObjectURL(url);}
}
async function prepareStoredPdf(materialId,file){
  if(state.pdfTask)throw Error('다른 PDF의 페이지를 준비 중입니다.');
  const task={cancelled:false};state.pdfTask=task;
  $('pdfProgress').hidden=false;$('cancelPdf').hidden=false;
  $('cancelPdf').onclick=()=>{task.cancelled=true;$('pdfProgress').textContent='현재 페이지가 끝나면 일시정지합니다.';};
  try{
    let selected=file;
    if(!selected){
      const response=await fetch('/api/v2/file/'+encodeURIComponent(materialId),{credentials:'same-origin',cache:'no-store'});
      if(!response.ok)throw Error('PDF 원본을 다시 읽지 못했습니다.');
      selected=await response.blob();
    }
    const result=await preparePdfPages({materialId,file:selected,call,json,cancelled:()=>task.cancelled,
      onProgress:(page,total)=>{$('pdfProgress').textContent=`PDF 페이지 준비 ${page}/${total} · 저장 완료`;}});
    $('pdfProgress').textContent=result.paused
      ?`페이지 준비 일시정지 · 자료 목록에서 이어할 수 있습니다.`
      :`${result.pageCount}페이지 준비 완료 · ChatGPT에서 OCR 검토를 시작하세요.`;
    await refreshOfferingData();
  }catch(e){$('pdfProgress').textContent='페이지 준비 중단 · 자료 목록에서 다시 시작하세요.';fail(e.message);}
  finally{state.pdfTask=null;$('cancelPdf').hidden=true;}
}
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
  if(!state.sources.length){node.append(empty('등록된 자료가 없습니다.'));return;}
  for(const src of state.sources){
    const li=document.createElement('li'),text=document.createElement('span');
    const loc=src.source_type==='past_exam'?(src.exam_year?`${src.exam_year}년`:'연도 미지정'):(src.weeks?.length?`${src.weeks.join(', ')}주차`:'주차 미지정');
    const review=src.review_status==='reviewed'?'교정 완료':src.mime_type==='application/pdf'
      ?`페이지 준비 ${src.prepared_pages||0}/${src.page_count||'?'} · GPT 검토 대기`:'GPT 교정 대기';
    text.textContent=`${src.title} · ${types[src.source_type]||src.source_type} · ${loc} · ${review}`;li.append(text);
    if(src.file_name){const b=document.createElement('button');b.type='button';b.className='ghost small';b.textContent='원본 다운로드';b.onclick=()=>{const a=document.createElement('a');a.href=`/api/v2/file/${encodeURIComponent(src.id)}`;a.click();};li.append(b);}
    if(src.mime_type==='application/pdf'&&src.review_status!=='reviewed'){
      const b=document.createElement('button');b.type='button';b.className='ghost small';
      b.textContent=src.page_count?'페이지 준비 이어하기':'PDF 페이지 준비';
      b.disabled=!state.writesEnabled||!!state.pdfTask;
      b.onclick=()=>{void prepareStoredPdf(src.id).catch(e=>fail(e.message));};li.append(b);
    }
    if(!isReviewed(src)){
      const button=document.createElement('button');button.type='button';button.className='ghost small';
      button.textContent='GPT 원문 검토 요청';
      button.onclick=async()=>{
        const c=course();if(!c)return fail('과목을 선택하세요.');
        const msg=[
          '@에쁠가속기 아래 자료를 검토해줘. 아직 생성 본문에는 사용하지 마.',
          '과목: '+c.name+' (course_id='+c.id+')',
          '자료 ID: '+src.id+' / 제목: '+src.title+' / 유형: '+src.source_type,
          'get_course_page_status로 PDF 페이지 수와 준비 상태를 확인해. 모든 PDF 페이지는 get_course_page_image로 실제 이미지를 보고 판독해.',
          'TXT/MD 전사본은 get_course_original_text로 원문을 읽어. PDF 텍스트 추출본도 참고하되 이미지를 우선 확인해.',
          '같은 과목의 강의자료와 공신력 있는 자료를 대조한 후 save_course_review_page로 원문/교정본/근거/불명확 항목을 기록해.',
          '모든 페이지가 검증된 경우에만 finalize_course_review를 수행하고, 완료 전에는 본문 생성에 사용하지 마.'
        ].join('\n');
        try{await navigator.clipboard.writeText(msg);setStatus('OCR·전사본 검토 요청문을 복사했습니다. ChatGPT에 붙여넣어 실행하세요.');}
        catch{fail('요청문 복사가 차단되었습니다. 브라우저 권한을 확인하세요.');}
      };
      li.append(button);
    }
    const remove=document.createElement('button');remove.type='button';remove.className='ghost small danger-action';remove.textContent='자료 삭제';
    remove.disabled=!state.writesEnabled;
    remove.onclick=()=>{
      const current=course();if(!current||!window.confirm(`「${src.title}」 자료를 삭제할까요? 원본 파일과 교정 내용도 함께 삭제됩니다.`))return;
      run(async()=>{
        if(current.id!==course()?.id)throw Error('과목이 바뀌었습니다. 다시 확인하세요.');
        await call('/api/v2/material/'+encodeURIComponent(src.id),{method:'DELETE'});
        state.selectedIds.delete(src.id);await refreshOfferingData();
      },'자료를 삭제했습니다.');
    };li.append(remove);
    node.append(li);
  }
}
function renderNotes(){const node=$('noteList');node.replaceChildren();if(!state.notes.length){node.append(empty('저장된 정리본이 없습니다.'));return;}
  for(const note of state.notes){const li=document.createElement('li'),b=document.createElement('button');b.type='button';b.className='ghost small';b.textContent=`${note.title} · v${note.revision}`;
    b.onclick=()=>run(async()=>{
      const [n,versions]=await Promise.all([call(`/api/v2/note?id=${encodeURIComponent(note.id)}`),call(`/api/v2/note-versions?id=${encodeURIComponent(note.id)}`)]);
      if(n.course_id!==state.activeOffering)throw Error('다른 과목의 정리본입니다.');
      $('noteTitle').value=n.title;$('noteBody').value=n.content_markdown;state.editingNote={id:n.id,revision:n.revision,offeringId:n.course_id};state.noteRequest=null;
      opt($('noteVersion'),versions,x=>`v${x.revision} · ${x.title}`);$('noteVersion').value=String(n.revision);
      state.showNotePreview=false;renderNoteSave();renderNotePreview();rememberDraft();
    },'정리본을 불러왔습니다.');li.append(b);node.append(li);
  }
}
function renderPicker(){
  const box=$('sourcePicker');box.replaceChildren();
  const type=$('pickerType').value,search=$('pickerSearch').value.trim().toLowerCase();
  const visible=state.sources.filter(s=>(type==='all'||s.source_type===type)&&(!search||s.title.toLowerCase().includes(search)));
  $('selectedCount').textContent=state.selectedIds.size+'개 선택';
  if(!visible.length){box.append(empty('이 과목에 해당하는 자료가 없습니다.'));return;}
  const groups=new Map();
  for(const item of visible){
    const names=item.source_type==='past_exam'?[item.exam_year?item.exam_year+'년 기출':'기출 연도 미지정']:
      (item.weeks?.length?item.weeks.map(x=>x+'주차'):['주차 미지정']);
    for(const name of names){if(!groups.has(name))groups.set(name,[]);groups.get(name).push(item);}
  }
  for(const [name,items] of groups){
    const group=document.createElement('div');group.className='picker-group';
    const head=document.createElement('label');head.className='picker-group-title';
    const checkbox=document.createElement('input');checkbox.type='checkbox';
    const ready=items.filter(isReviewed);
    checkbox.checked=ready.length>0&&ready.every(x=>state.selectedIds.has(x.id));
    checkbox.indeterminate=ready.some(x=>state.selectedIds.has(x.id))&&!checkbox.checked;
    checkbox.disabled=!ready.length;
    checkbox.onchange=()=>{for(const s of ready){if(checkbox.checked)state.selectedIds.add(s.id);else state.selectedIds.delete(s.id);}renderPicker();refreshPrompt();};
    head.append(checkbox,document.createTextNode(name+' · '+items.length+'개'));group.append(head);
    for(const item of items){
      const row=document.createElement('label');row.className='picker-row';
      const check=document.createElement('input');check.type='checkbox';check.checked=state.selectedIds.has(item.id);
      check.disabled=!isReviewed(item);check.onchange=()=>{if(check.checked)state.selectedIds.add(item.id);else state.selectedIds.delete(item.id);renderPicker();refreshPrompt();};
      const title=document.createElement('span');title.textContent=item.title+' · '+(types[item.source_type]||item.source_type)+(isReviewed(item)?' · 교정 검토본':' · 검토 대기');
      row.append(check,title);group.append(row);
    }box.append(group);
  }
}
function refreshPrompt(){
  const c=course();if(!c){$('prompt').value='과목을 먼저 등록해 주세요.';return;}
  const picked=selectedSources().filter(isReviewed);
  const mode=$('mode').value,scope=$('scope').value;
  const preset=DEFAULT_PRESETS[mode]||DEFAULT_PRESETS.detailed_note;
  $('prompt').value=[
    '@에쁠가속기 선택한 자료로 학습 결과물을 생성하고 사이트에 자동 저장해.',
    '과목: '+c.name+' (course_id='+c.id+')',
    '과목 특성: '+(c.characteristics||'미입력'),
    '모드: '+mode+', 범위: '+scope,
    '명시적으로 선택한 자료 ID ('+picked.length+'개): '+picked.map(x=>x.id).join(', '),
    '사용자가 체크하지 않은 자료는 본문 근거로 사용하지 마.',
    'PDF·이미지·전사본은 get_course_verified_text MCP 도구로 검토된 교정본만 읽어. 원본 PDF/미검토 텍스트를 본문 생성 근거로 사용하지 마.',
    '검토되지 않은 페이지가 있으면 먼저 원본과 같은 과목 자료를 교차 대조하고 미확인 내용은 확인 필요로 남겨.',
    '반드시 목차를 먼저 만들고 save_course_outline로 저장한 뒤에 본문을 작성해.',
    '이후 각 절마다 save_course_part를 호출해 정리본/버전을 자동 저장해. 별도 저장 지시를 요구하지 마.',
    '파일의 사용자 지정 제목, 주차, 기출 연도는 원본 이름/OCR에서 유추해 덮어쓰지 마.',
    ...preset.rules.map(x=>'· '+x)
  ].join('\n');
  $('lectureContext').textContent=c.name;
}
async function refreshCourses(selected=$('course').value){state.courses=await call('/api/courses');opt($('course'),state.courses,x=>x.name);opt($('globalCourse'),state.courses,x=>x.name);
  if(state.courses.some(x=>x.id===selected))$('course').value=selected;$('globalCourse').value=$('course').value;await refreshOfferings();}
// The UI is course-only. Keep a private offering ID because the existing D1
// schema and MCP tools scope source/notes to an offering. Never create one for
// another person's course unless the current session can write.
// The course itself is the only persistent classification owner.
async function refreshOfferings(){
  const id=$('course').value;
  $('offering').replaceChildren();
  if(id)$('offering').add(new Option('과목 자료',id));
  await refreshOfferingData();
}
async function refreshOfferingData(){
  const id=$('course').value;
  if(id!==state.activeOffering){await pad.reset();rememberDraft();state.activeOffering=id;restoreDraft(id);$('noteVersion').replaceChildren();state.sources=[];state.notes=[];state.selectedIds.clear();
    renderSources();renderNotes();refreshPrompt();$('searchResults').replaceChildren();$('searchQuery').value='';if(!id)$('lectureContext').textContent='과목을 선택하세요.';}
  if(id){const [sources,notes,jobs]=await Promise.all([call(`/api/v2/materials?course_id=${encodeURIComponent(id)}`),call(`/api/v2/notes?course_id=${encodeURIComponent(id)}`),call(`/api/v2/jobs?course_id=${encodeURIComponent(id)}`)]);state.sources=sources;state.notes=notes;state.jobs=jobs;}
  else{state.sources=[];state.notes=[];state.jobs=[];}
  const selectedJob=$('jobSelect').value;opt($('jobSelect'),state.jobs,x=>`${x.mode} · ${x.scope} · ${x.status}`);
  if(state.jobs.some(x=>x.id===selectedJob))$('jobSelect').value=selectedJob;
  $('jobProgress').textContent=state.jobs.length?`${state.jobs.length}개 작업이 저장돼 있습니다.`:'저장된 GPT 작업이 없습니다.';
  renderSources();renderNotes();renderPicker();refreshPrompt();await listRefreshed();
}
function renderNotePreview(){
  const node=$('notePreview');renderNoteMarkdown(node,$('noteBody').value);
  node.hidden=!state.showNotePreview;
  $('note-form').hidden=state.showNotePreview;
}
$('previewNote').onclick=()=>{state.showNotePreview=true;renderNotePreview();};
$('editNote').onclick=()=>{state.showNotePreview=false;renderNotePreview();};
function insertNote(before,after=''){
  state.showNotePreview=false;renderNotePreview();
  const field=$('noteBody'),start=field.selectionStart,end=field.selectionEnd;
  field.setRangeText(before+field.value.slice(start,end)+after,start,end,'select');
  field.focus();rememberDraft();
}
$('noteHeading').onclick=()=>insertNote('## ');
$('noteBold').onclick=()=>insertNote('**','**');
$('printNote').onclick=()=>{state.showNotePreview=true;renderNotePreview();window.print();};
$('noteBody').addEventListener('input',()=>{if(state.showNotePreview)renderNotePreview();});
$('pickerSearch').oninput=renderPicker;$('pickerType').onchange=renderPicker;
$('clearSelected').onclick=()=>{state.selectedIds.clear();renderPicker();refreshPrompt();};
$('selectVisible').onclick=()=>{const type=$('pickerType').value,term=$('pickerSearch').value.trim().toLowerCase();for(const x of state.sources){if(isReviewed(x)&&(type==='all'||x.source_type===type)&&(!term||x.title.toLowerCase().includes(term)))state.selectedIds.add(x.id);}renderPicker();refreshPrompt();};
$('refreshJobs').onclick=()=>run(async()=>{await refreshOfferingData();},'작업 목록을 갱신했습니다.');
$('jobSelect').onchange=()=>run(async()=>{
 const id=$('jobSelect').value;if(!id)return;
 const p=await call('/api/v2/job?id='+encodeURIComponent(id));
 $('jobProgress').textContent=`${p.status} · 목차 ${p.outline.length}절 · 저장 ${p.saved_parts.length}절 · 문서 ${p.document_id||'없음'}`;
},'저장된 진행 상태를 확인했습니다.');
$('copyResume').onclick=()=>run(async()=>{
 const id=$('jobSelect').value;if(!id)throw Error('이어갈 GPT 작업이 없습니다.');
 const p=await call('/api/v2/job?id='+encodeURIComponent(id));
 if(p.course_id!==course()?.id)throw Error('현재 과목의 작업이 아닙니다.');
 const msg=['@에쁠가속기 저장한 작업을 이어서 진행해줘.',`과목 ID: ${p.course_id}`,`작업 ID: ${p.job_id}`,`모드: ${p.mode} / 범위: ${p.scope}`,
  `선택된 교정 자료 ID: ${p.source_ids.join(', ')}`,`저장된 절: ${p.saved_parts.join(', ')||'없음'}`,
  '먼저 get_course_generation_progress로 실제 저장 상태를 다시 확인하고, 저장된 목차와 교정본을 사용해 빠진 절만 save_course_part로 저장해.',
  '기존 절을 덮어쓰거나 미검토 원문을 생성 근거로 사용하지 마. 수정 충돌이 있으면 멈추고 보고해.'].join('\n');
 await navigator.clipboard.writeText(msg);
 $('jobProgress').textContent=`${p.status} · 목차 ${p.outline.length}절 · 저장 ${p.saved_parts.length}절 · 요청문 복사 완료`;
},'작업 이어하기 요청문을 복사했습니다.');
renderNotePreview();
const listRefreshed=async()=>{
 const id=course()?.id;
 if(!id){$('packSelect').replaceChildren();$('casioSelect').replaceChildren();return;}
 const [packs,casio]=await Promise.all([call('/api/v2/packs?course_id='+encodeURIComponent(id)),call('/api/v2/casio?course_id='+encodeURIComponent(id))]);
 const selectedPack=$('packSelect').value,selectedCasio=$('casioSelect').value;
 opt($('packSelect'),packs,x=>x.title);opt($('casioSelect'),casio,x=>x.title);
 if(packs.some(x=>x.id===selectedPack))$('packSelect').value=selectedPack;
 if(casio.some(x=>x.id===selectedCasio))$('casioSelect').value=selectedCasio;
};
$('refreshPacks').onclick=()=>run(listRefreshed,'문제팩 목록을 갱신했습니다.');
$('refreshCasio').onclick=()=>run(listRefreshed,'프로젝트 목록을 갱신했습니다.');
$('loadPack').onclick=()=>run(async()=>{
 const id=$('packSelect').value;if(!id)throw Error('과목별 문제팩이 없습니다. GPT에서 문제팩을 저장하거나 JSON을 등록하세요.');
 const record=await call('/api/v2/pack?id='+encodeURIComponent(id));
 if(!course()||!record.pack?.questions?.length)throw Error('문제팩 내용이 올바르지 않습니다.');
 await pad.load(id,record);
},'문제팩을 열었습니다.');
$('packUpload').onchange=e=>run(async()=>{
 const file=e.target.files?.[0];if(!file)return;
 if(file.size>1024*1024)throw Error('문제팩 JSON 파일은 최대 1 MiB입니다.');
 let pack;try{pack=JSON.parse(await file.text());}catch{throw Error('올바른 문제팩 JSON이 아닙니다.');}
 if(!pack||!Array.isArray(pack.questions)||!pack.questions.length)throw Error('문제가 없는 파일입니다.');
 const saved=await call('/api/v2/pack',json({course_id:course().id,title:pack.title||file.name,pack}));
 await listRefreshed();$('packSelect').value=saved.id;e.target.value='';
},'문제팩을 현재 과목에 저장했습니다.');
$('loadCasio').onclick=()=>run(async()=>{
 const id=$('casioSelect').value;if(!id)throw Error('저장된 CASIO 프로젝트가 없습니다.');
 const record=await call('/api/v2/casio-item?id='+encodeURIComponent(id));
 $('casioForm').dataset.id=record.id;$('casioTitle').value=record.title;
 $('casioBlueprint').value=record.blueprint_json;$('casioProgram').value=record.program_text;$('casioManual').value=record.manual_text;
},'CASIO 프로젝트를 불러왔습니다.');
$('casioForm').onsubmit=e=>{e.preventDefault();run(async()=>{
 const c=course();if(!c)throw Error('과목을 선택하세요.');
 const data={course_id:c.id,title:$('casioTitle').value,blueprint_json:$('casioBlueprint').value,
  program_text:$('casioProgram').value,manual_text:$('casioManual').value};
 if($('casioForm').dataset.id)data.id=$('casioForm').dataset.id;
 const saved=await call('/api/v2/casio',json(data));$('casioForm').dataset.id=saved.id;await listRefreshed();
},'CASIO 프로젝트를 과목에 저장했습니다.');};
$('downloadCasio').onclick=()=>{
 const text=$('casioProgram').value;if(!text.trim())return fail('다운로드할 PRGM 코드가 없습니다.');
 const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));
 const a=document.createElement('a');a.href=url;a.download=($('casioTitle').value||'CASIO')+'.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
async function run(fn,success='저장된 자료를 확인했습니다.'){
  if(state.busy)return;state.busy=true;clear();setStatus('처리 중…');
  const controls=[...document.querySelectorAll('button,input,select,textarea')].map(el=>[el,el.disabled]);controls.forEach(([el])=>el.disabled=true);
  try{await fn();setStatus(success);}catch(e){fail(e.message);setStatus('확인이 필요합니다.');}
  finally{state.busy=false;controls.forEach(([el,disabled])=>{if(el.isConnected)el.disabled=disabled;});applyWriteLock();}
}
function applyWriteLock(){
 document.querySelectorAll('#course-form button,#deleteCourse,#source-form button,#note-form button,#noteNew,#packUpload,#casioForm button').forEach(el=>el.disabled=!state.writesEnabled);
 pad.setWritable(state.writesEnabled);
}
$('globalCourse').onchange=()=>run(async()=>{const target=$('globalCourse').value;$('course').value=target;state.selectedIds.clear();await refreshOfferings();});$('course').onchange=()=>run(async()=>{$('globalCourse').value=$('course').value;state.selectedIds.clear();await refreshOfferings();});$('offering').onchange=()=>run(refreshOfferingData);
$('mode').onchange=refreshPrompt;$('scope').oninput=refreshPrompt;
$('course-form').onsubmit=e=>{e.preventDefault();run(async()=>{const r=await call('/api/courses',json({name:$('courseName').value,characteristics:$('characteristics').value}));$('course-form').reset();await refreshCourses(r.id);});};
$('deleteCourse').onclick=()=>{
 const current=course();if(!current)return fail('삭제할 과목을 선택하세요.');
 const typed=window.prompt(`「${current.name}」 과목과 자료·정리본·작업을 모두 삭제합니다. 확인하려면 과목 이름을 그대로 입력하세요.`);
 if(typed!==current.name)return;
 run(async()=>{
   if(current.id!==course()?.id)throw Error('선택 과목이 바뀌었습니다. 다시 확인하세요.');
   await call('/api/v2/course/'+encodeURIComponent(current.id),{method:'DELETE'});
   state.drafts.delete(current.id);state.activeOffering=null;await refreshCourses();
 },'과목과 연결된 자료를 삭제했습니다.');
};
$('source-form').onsubmit=e=>{e.preventDefault();run(async()=>{
  const o=offering();if(!o)throw Error('과목을 먼저 등록하세요.');
  const file=$('sourceFile').files[0],name=$('sourceTitle').value.trim(),provenance=$('provenance').value,type=$('sourceType').value;
  if(!name)throw Error('등록할 자료 제목을 직접 입력하세요.');
  const weeks=type==='past_exam'?[]:sourceWeeks();
  const exam_year=type==='past_exam'&&$('examYear').value!==''?Number($('examYear').value):null;let r;
  if(file){if(file.size>8*1024*1024)throw Error('최대 8 MiB까지 등록할 수 있습니다.');
    const headers={'Content-Type':'application/octet-stream','X-Course-Id':o.id,'X-Source-Type':type,'X-Title':encodeURIComponent(name),'X-Filename':encodeURIComponent(file.name),'X-Provenance':encodeURIComponent(provenance),'X-Weeks':JSON.stringify(weeks),...(exam_year!==null?{'X-Exam-Year':String(exam_year)}:{})};
    r=await call('/api/v2/upload',{method:'POST',headers,body:file});
  }else{if(type!=='transcript')throw Error('전사본 직접 입력 외에는 원본 파일을 선택하세요.');
    r=await call('/api/v2/text',json({course_id:o.id,title:name,source_type:type,content:$('transcript').value,weeks,exam_year,provenance}));}
  $('source-form').reset();for(const el of $('weeksGrid').querySelectorAll('input'))el.checked=false;syncSourceMetadataFields();await refreshOfferingData();if(r.reused)fail('동일 파일이 있어 사용자가 입력한 제목·분류로 정보만 갱신했습니다.');
  if(file&&/\.pdf$/i.test(file.name))setTimeout(()=>{void prepareStoredPdf(r.id,file).catch(e=>fail(e.message));},0);
  if(file&&/\.(png|jpe?g)$/i.test(file.name)){
    const preview=await createPagePreview(file);
    if(preview)await call('/api/v2/page-image',{method:'POST',headers:{'Content-Type':'image/jpeg','X-Material-Id':r.id,'X-Page-Num':'1'},body:preview});
  }
});};
$('search-form').onsubmit=e=>{e.preventDefault();run(async()=>{
  const o=offering();if(!o)throw Error('과목을 먼저 선택하세요.');
  const matches=await call(`/api/v2/search?course_id=${encodeURIComponent(o.id)}&query=${encodeURIComponent($('searchQuery').value)}`);
  $('searchResults').replaceChildren(...(matches.length?matches.map(m=>empty(`${m.source_title}${m.page_num?' · '+m.page_num+'쪽':''}\n${m.content}`)):[empty('선택한 강의에서 검색 결과를 찾지 못했습니다.')]));
});};
$('noteNew').onclick=()=>{state.editingNote=null;state.noteRequest=null;$('note-form').reset();$('noteVersion').replaceChildren();state.showNotePreview=false;renderNotePreview();renderNoteSave();rememberDraft();};
$('restoreNoteVersion').onclick=()=>run(async()=>{
 const id=state.editingNote?.id,revision=Number($('noteVersion').value);
 if(!id||!revision)throw Error('정리본과 버전을 선택하세요.');
 const version=await call(`/api/v2/note-version?id=${encodeURIComponent(id)}&revision=${revision}`);
 $('noteTitle').value=version.title;$('noteBody').value=version.content_markdown;
 state.showNotePreview=false;renderNotePreview();rememberDraft();
},'선택한 버전을 편집기로 가져왔습니다. 확인 후 저장하면 새 버전이 됩니다.');
$('note-form').onsubmit=e=>{e.preventDefault();run(async()=>{
  const o=offering();if(!o||o.id!==state.activeOffering)throw Error('강의를 선택하세요.');
  const body={course_id:o.id,title:$('noteTitle').value,content_markdown:$('noteBody').value};
  if(state.editingNote){if(state.editingNote.offeringId!==o.id)throw Error('다른 과목의 정리본을 변경할 수 없습니다.');body.id=state.editingNote.id;body.expected_revision=state.editingNote.revision;}
  else{const fingerprint=JSON.stringify(body);if(state.noteRequest?.fingerprint!==fingerprint)state.noteRequest={fingerprint,id:crypto.randomUUID()};body.request_id=state.noteRequest.id;}
  const saved=await call('/api/v2/note',json(body));state.editingNote={id:saved.id,revision:saved.revision,offeringId:o.id};state.noteRequest=null;renderNoteSave();rememberDraft();await refreshOfferingData();
 const versions=await call('/api/v2/note-versions?id='+encodeURIComponent(saved.id));opt($('noteVersion'),versions,x=>`v${x.revision} · ${x.title}`);$('noteVersion').value=String(saved.revision);
},'정리본을 저장했습니다.');};
$('copyPrompt').onclick=()=>run(async()=>{if(!offering())throw Error('과목을 선택하세요.');if(!state.selectedIds.size)throw Error('사용할 자료를 1개 이상 선택하세요.');if(selectedSources().some(x=>!isReviewed(x)))throw Error('검토 전 자료를 사용할 수 없습니다.');await navigator.clipboard.writeText($('prompt').value);},'선택 자료와 교정본 우선 원칙을 포함한 GPT 요청문을 복사했습니다.');
run(async()=>{const user=await call('/api/session');$('accountName').textContent=user.display_name;state.writesEnabled=user.mutations_enabled===true;$('readOnlyNotice').hidden=state.writesEnabled;await refreshCourses();});

// Browser tools use the visible, authenticated workspace. This is separate from the Site MCP plugin.
const modelContext=document.modelContext;
if(modelContext?.registerTool){
  const lifecycle=new AbortController();
  const tools=[{
    name:'get_selected_lecture',title:'선택한 과목 확인',description:'현재 과목과 검토 상태별 자료 목록을 읽습니다.',
    inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},
    execute(input){if(!input||typeof input!=='object'||Object.keys(input).length)throw Error('빈 객체가 필요합니다.');if(state.busy||!offering())throw Error('과목 선택과 자료 로딩을 먼저 완료하세요.');return {course:course(),offering:offering(),sources:state.sources};}
  },{
    name:'search_selected_lecture',title:'선택한 강의자료 검색',description:'현재 선택한 강의의 등록된 텍스트를 검색하고 화면에 결과를 표시합니다.',
    inputSchema:{type:'object',properties:{query:{type:'string',minLength:1,maxLength:180}},required:['query'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},
    async execute(input){
      if(!input||typeof input!=='object'||Object.keys(input).some(k=>k!=='query')||typeof input.query!=='string'||!input.query.trim()||input.query.length>180)throw Error('검색어는 1–180자여야 합니다.');
      if(state.busy||!offering())throw Error('강의 선택과 자료 로딩을 먼저 완료하세요.');
      const id=offering().id;const matches=await call(`/api/v2/search?course_id=${encodeURIComponent(id)}&query=${encodeURIComponent(input.query)}`);
      if(id!==offering()?.id)throw Error('선택한 강의가 바뀌었습니다. 다시 검색하세요.');
      $('searchQuery').value=input.query;$('searchResults').replaceChildren(...(matches.length?matches.map(m=>empty(`${m.source_title}\n${m.content}`)):[empty('검색 결과가 없습니다.')]));showPage('sources',{push:true});return {offering_id:id,matches};
    }
  }];
  for(const tool of tools){try{Promise.resolve(modelContext.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}}
  window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
}

bindNavigation();
