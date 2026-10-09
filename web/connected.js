import {bindSourceUpload} from './source-upload.js';
import {createDraftStore} from './local-drafts.js';
import {DEFAULT_PRESETS} from '../domain/core.mjs';
import {createSolvePad} from './solvepad.js';
import {preparePdfPages} from './pdf-pages.js';
import {renderNoteMarkdown,noteMathReady} from './note-render.js';
const $=id=>document.getElementById(id);
const state={courses:[],offerings:[],sources:[],notes:[],jobs:[],editingNote:null,activeOffering:null,busy:false,writesEnabled:false,noteRequest:null,drafts:new Map(),selectedIds:new Set(),pdfTask:null,showNotePreview:true};
let drafts=createDraftStore(null),draftTimer;
const pageNames={courses:'강의 관리',sources:'강의자료',gpt:'GPT 제작실',notes:'정리본',solvepad:'SolvePad 문제풀이',casio:'CASIO Studio'};
let visiblePage=null;
const setStatus=msg=>{$('status').textContent=msg;const side=$('sidebarStatus');if(side)side.textContent=msg;};
const fail=msg=>{$('error').textContent=msg;$('error').hidden=false;};
const clear=()=>{$('error').hidden=true;};
const course=()=>state.courses.find(x=>x.id===$('course').value);
const offering=()=>course()?{id:course().id}:null;
const selectedSources=()=>state.sources.filter(x=>state.selectedIds.has(x.id));
const isReviewed=src=>['reviewed','reviewed_with_issues','original_ready','generated_ready'].includes(src.review_status);
const materialLabel=src=>src.file_name||src.title;
const usesOriginal=src=>src.processing_mode==='original';
function pageFromLocation(){const page=location.hash.slice(1);return pageNames[page]?page:'courses';}
function showPage(page,{push=false,focus=false}={}){
  const active=pageNames[page]?page:'courses';
  if(visiblePage==='solvepad'&&active!=='solvepad')void pad.saveCurrent().catch(e=>fail('풀이 저장 실패: '+e.message));
  visiblePage=active;
  document.body.dataset.workspacePage=active;
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
    const messages={401:'ChatGPT 로그인이 필요합니다.',403:'이 자료를 변경할 권한이 없습니다.',404:'자료를 찾을 수 없거나 접근 권한이 없습니다.',409:'다른 수정본이 먼저 저장됐습니다. 작성 내용은 유지됩니다. 최신 정리본을 확인하세요.',413:'파일이 너무 큽니다. 최대 50 MiB까지 등록할 수 있습니다.',423:'로그인 검증이 끝날 때까지 자료 변경이 잠겨 있습니다.',503:'저장소에 연결하지 못했습니다. 작성 내용을 유지하고 다시 시도하세요.'};
    const e=Error(messages[r.status]||`요청을 처리하지 못했습니다. (HTTP ${r.status})`);e.status=r.status;
    if(r.status===409&&path.includes('/attempt'))e.message='다른 기기에서 풀이를 먼저 저장했습니다. 기기 초안은 보존됩니다. 최신 풀이를 불러온 뒤 초안을 복구하세요.';
    if(r.status===503){const body=await r.json().catch(()=>({}));if(body.error==='STORAGE_DELETE_FAILED')e.message='파일 삭제가 완료되지 않았습니다. 같은 삭제를 다시 실행해 주세요.';}
    throw e;
  }
  return r.json();
}
const json=data=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
const pad=createSolvePad({call,json,notify:setStatus,onError:fail});
function bindCollapse(buttonId,targetId,container,collapsedClass,label){
 const button=$(buttonId),target=$(targetId);
 button.onclick=()=>{const collapsed=button.getAttribute('aria-expanded')==='true';
  target.hidden=collapsed;container.classList.toggle(collapsedClass,collapsed);
  button.setAttribute('aria-expanded',String(!collapsed));button.textContent=label+(collapsed?' 펼치기':' 접기');
 };
}
bindCollapse('toggleWorkspace','workspaceSidebar',document.querySelector('.workspace-shell'),'sidebar-collapsed','메뉴');
bindCollapse('toggleNoteList','noteListPanel',document.querySelector('.notes-layout'),'list-collapsed','목록');
bindCollapse('toggleProblemList','solveIndex',$('solveWorkspace'),'list-collapsed','목록');
bindCollapse('toggleProblemView','solveQuestionPanel',$('solveSheet'),'question-collapsed','문제');
const opt=(select,items,label)=>{select.replaceChildren();for(const x of items)select.add(new Option(label(x),x.id));};
const empty=text=>{const li=document.createElement('li');li.textContent=text;return li;};
const types={generated_note:'GPT 생성 자료',generated_pack:'GPT 생성 자료',generated_casio:'GPT 생성 자료',transcript:'전사본',lecture_slides:'강의자료',past_exam:'기출·시험자료',textbook:'교재·참고자료',exam_trend:'기출 경향',syllabus:'강의계획서',other:'기타'};
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
  }catch(e){$('pdfProgress').textContent='페이지 준비 중단 · 자료 목록에서 이어하기를 누르세요.';fail(e.message);
    try{await refreshOfferingData();}catch{/* Keep the original preparation error visible. */}}
  finally{state.pdfTask=null;$('cancelPdf').hidden=true;renderSources();}
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
function rememberDraft(){if(state.activeOffering){state.drafts.set(state.activeOffering,{title:$('noteTitle').value,body:$('noteBody').value,editing:state.editingNote,request:state.noteRequest,
  gpt:{additional:$('additionalRequests').value,mode:$('mode').value,scope:$('scope').value},source:{text:$('transcript').value,type:$('sourceType').value,provenance:$('provenance').value,file:$('sourceFile').files[0],weeks:sourceWeeks(),examYear:$('examYear').value},casio:{id:$('casioForm').dataset.id||'',title:$('casioTitle').value,blueprint:$('casioBlueprint').value,program:$('casioProgram').value,manual:$('casioManual').value}});
  const data=state.drafts.get(state.activeOffering);drafts.write('course:'+state.activeOffering,{...data,source:{...data.source,file:null}});
  if(data.editing)drafts.write('note:'+data.editing.id,{title:data.title,body:data.body});
  else if(data.body||data.title)drafts.write('new-note:'+state.activeOffering,{title:data.title,body:data.body});
}}
function restoreDraft(id){const d=state.drafts.get(id)||drafts.read('course:'+id);$('additionalRequests').value=d?.gpt?.additional||'';if(d?.gpt){$('mode').value=d.gpt.mode;$('scope').value=d.gpt.scope;}$('noteTitle').value=d?.title||'';$('noteBody').value=d?.body||'';state.editingNote=d?.editing||null;state.noteRequest=d?.request||null;
  $('source-form').reset();if(d?.source){$('transcript').value=d.source.text;$('sourceType').value=d.source.type;$('provenance').value=d.source.provenance;
    if(d.source.file&&typeof DataTransfer!=='undefined'){const files=new DataTransfer();files.items.add(d.source.file);$('sourceFile').files=files.files;}
    $('examYear').value=d.source.examYear||'';for(const el of $('weeksGrid').querySelectorAll('input'))el.checked=(d.source.weeks||[]).includes(Number(el.value));}
  $('casioForm').dataset.id=d?.casio?.id||'';$('casioTitle').value=d?.casio?.title||'';$('casioBlueprint').value=d?.casio?.blueprint||'{}';$('casioProgram').value=d?.casio?.program||'';$('casioManual').value=d?.casio?.manual||'';
  syncSourceMetadataFields();renderNoteSave();renderNotePreview();}
function renderNoteSave(){$('noteRestoreDraft').hidden=!drafts.read('new-note:'+state.activeOffering);$('noteSave').textContent=state.editingNote?`정리본 수정 저장 · v${state.editingNote.revision}`:'새 정리본 저장';}
function renderSources(){
  const node=$('sourceList');node.replaceChildren();
  const registered=state.sources.filter(x=>!x.source_type.startsWith('generated_'));
  if(!registered.length){node.append(empty('등록된 자료가 없습니다.'));return;}
  for(const {name,items} of materialGroups(registered)){
    const group=document.createElement('li');group.className='material-group';const heading=document.createElement('h3');heading.textContent=name;const list=document.createElement('ul');list.className='material-items';group.append(heading,list);node.append(group);
  for(const src of items){
    const li=document.createElement('li'),text=document.createElement('span');
    const loc=src.source_type==='past_exam'?(src.exam_year?`${src.exam_year}년`:'연도 미지정'):(src.weeks?.length?`${src.weeks.join(', ')}주차`:'주차 미지정');
    const needsConversion=src.mime_type==='application/msword';
    const deleting=src.review_status==='deletion_pending';
    const review=deleting?'삭제 미완료 · 삭제를 다시 실행하세요':src.processing_mode==='original'?'원문 사용 · 검수 불필요':isReviewed(src)?(src.review_status==='reviewed_with_issues'?`검토 저장 · 주의 ${src.issue_pages}쪽`:'검토 저장'):src.mime_type==='application/pdf'
      ?`페이지 준비 ${src.prepared_pages||0}/${src.page_count||'?'} · GPT 검토 대기`:needsConversion?'원본 보관 · PDF/TXT 변환 필요':'GPT 교정 대기';
    if(src.mime_type?.endsWith('presentationml.presentation'))li.append(document.createTextNode(' · PPTX: 텍스트·포함 그림 검수. 전체 슬라이드 도형·배치는 미지원'));
    li.className='material-row';const title=document.createElement('strong'),meta=document.createElement('small');title.className='material-name';title.textContent=materialLabel(src);meta.className='material-meta';meta.textContent=loc+' · '+review;text.append(title,meta);li.append(text);
    if(src.file_name&&!deleting){const b=document.createElement('button');b.type='button';b.className='ghost small';b.textContent='원본 다운로드';b.onclick=()=>{const a=document.createElement('a');a.href=`/api/v2/file/${encodeURIComponent(src.id)}`;a.click();};li.append(b);}
    if(src.mime_type==='application/pdf'&&!isReviewed(src)&&!deleting){
      const b=document.createElement('button');b.type='button';b.className='ghost small';
      b.textContent=src.page_count?'페이지 준비 이어하기':'PDF 페이지 준비';
      b.disabled=!state.writesEnabled||!!state.pdfTask;
      b.onclick=()=>{void prepareStoredPdf(src.id).catch(e=>fail(e.message));};li.append(b);
    }
    if(!isReviewed(src)&&!needsConversion&&!deleting){
      const button=document.createElement('button');button.type='button';button.className='ghost small';
      button.textContent='GPT 원문 검토 요청';
      button.onclick=async()=>{
        const c=course();if(!c)return fail('과목을 선택하세요.');
        const msg=[
          '@에쁠가속기 아래 자료를 검수하고 저장해줘.',
          '과목: '+c.name+' (course_id='+c.id+')',
          '자료 ID: '+src.id+' / 제목: '+src.title+' / 유형: '+src.source_type,
          'get_course_page_status로 PDF 페이지 수와 준비 상태를 확인해. 모든 PDF 페이지는 get_course_page_image로 실제 이미지를 보고 판독해.',
          'TXT/MD 전사본은 get_course_original_text로 원문을 읽어. PDF 텍스트 추출본도 참고하되 이미지를 우선 확인해.',
          '같은 과목의 강의자료와 공신력 있는 자료를 대조한 후 save_course_review_page로 원문/교정본/근거/불명확 항목을 기록해.',
          '검토 결과를 저장하면 바로 제작에 사용할 수 있게 해줘. 불명확한 항목은 지우지 말고 unresolved에 페이지별로 기록해서 이후 제작할 때도 확인하게 해줘. 이번 요청에서는 본문을 만들지 마.'
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
    list.append(li);
  }
  }
}
function renderNotes(){const node=$('noteList');node.replaceChildren();if(!state.notes.length){node.append(empty('저장된 정리본이 없습니다.'));return;}
  for(const note of state.notes){const li=document.createElement('li'),b=document.createElement('button');b.type='button';b.className='ghost small';b.textContent=`${note.title} · v${note.revision}`;
    b.onclick=()=>run(async()=>{
      rememberDraft();
      const [n,versions]=await Promise.all([call(`/api/v2/note?id=${encodeURIComponent(note.id)}`),call(`/api/v2/note-versions?id=${encodeURIComponent(note.id)}`)]);
      if(n.course_id!==state.activeOffering)throw Error('다른 과목의 정리본입니다.');
      const local=drafts.read('note:'+n.id);
      const recover=local&&local.body!==n.content_markdown&&window.confirm('이 정리본의 기기 초안이 있습니다. 초안을 불러올까요?');
      $('noteTitle').value=recover?local.title:n.title;$('noteBody').value=recover?local.body:n.content_markdown;state.editingNote={id:n.id,revision:n.revision,offeringId:n.course_id};state.noteRequest=null;
      opt($('noteVersion'),versions,x=>`v${x.revision} · ${x.title}`);$('noteVersion').value=String(n.revision);
      state.showNotePreview=false;renderNoteSave();renderNotePreview();rememberDraft();
    },'정리본을 불러왔습니다.');li.append(b);node.append(li);
  }
}
function materialGroups(items){
  const groups=new Map();
  const format=x=>x.source_type==='generated_note'?'정리본':x.source_type==='generated_pack'?'문제팩':x.source_type==='generated_casio'?'CASIO 자료':x.mime_type==='application/pdf'?'PDF':x.mime_type?.includes('presentation')?'PPTX':x.mime_type?.startsWith('image/')?'이미지':x.mime_type?.includes('word')?'Word':x.mime_type?.includes('hwp')?'한글':'TXT·MD';
  const order=['lecture_slides','transcript','textbook','past_exam','generated_note','generated_pack','generated_casio','other'];
  for(const item of items){const label=item.source_type.startsWith('generated_')?format(item):item.source_type==='past_exam'?(item.exam_year?item.exam_year+'년':'연도 미지정'):item.weeks?.length?item.weeks.map(w=>w+'주차').join('·'):'주차 미지정';const key=item.source_type+'|'+label;if(!groups.has(key))groups.set(key,{key,name:(types[item.source_type]||item.source_type)+' · '+label,items:[]});groups.get(key).items.push(item);}
  return [...groups.values()].sort((a,b)=>order.indexOf(a.items[0].source_type)-order.indexOf(b.items[0].source_type)||a.name.localeCompare(b.name,'ko'));
}
function sourceDetails(item){
  const scope=item.source_type==='past_exam'?(item.exam_year?item.exam_year+'년':'연도 미지정'):(item.weeks?.length?item.weeks.join(', ')+'주차':'주차 미지정');
  const status=item.source_type.startsWith('generated_')?('GPT 생성본'+(item.source_type==='generated_note'?' · v'+item.revision:'')):usesOriginal(item)?'원문 사용':isReviewed(item)?(item.review_status==='reviewed_with_issues'?'검수 저장 · 주의 '+item.issue_pages+'쪽':'검수 저장'):'검수 대기';
  return (item.source_type.startsWith('generated_')?'':scope+' · ')+status;
}
function renderPicker(){
  const box=$('sourcePicker');box.replaceChildren();
  const type=$('pickerType').value,search=$('pickerSearch').value.trim().toLowerCase();
  const visible=state.sources.filter(s=>(type==='all'||s.source_type===type||(type==='generated_note'&&s.source_type.startsWith('generated_')))&&(!search||materialLabel(s).toLowerCase().includes(search)));
  $('selectedCount').textContent=state.selectedIds.size+'개 선택';
  if(!visible.length){box.append(empty('이 과목에 해당하는 자료가 없습니다.'));return;}
  for(const {name,items} of materialGroups(visible)){
    const group=document.createElement('section');group.className='picker-group';
    const head=document.createElement('label');head.className='picker-group-title';
    const checkbox=document.createElement('input');checkbox.type='checkbox';const ready=items.filter(isReviewed);
    checkbox.checked=ready.length>0&&ready.every(x=>state.selectedIds.has(x.id));checkbox.indeterminate=ready.some(x=>state.selectedIds.has(x.id))&&!checkbox.checked;checkbox.disabled=!ready.length;
    checkbox.onchange=()=>{for(const x of ready){if(checkbox.checked)state.selectedIds.add(x.id);else state.selectedIds.delete(x.id);}renderPicker();refreshPrompt();};
    head.append(checkbox,document.createTextNode(name));group.append(head);
    for(const item of items){const row=document.createElement('label');row.className='picker-row';const check=document.createElement('input');check.type='checkbox';check.checked=state.selectedIds.has(item.id);check.disabled=!isReviewed(item);
      check.onchange=()=>{if(check.checked)state.selectedIds.add(item.id);else state.selectedIds.delete(item.id);renderPicker();refreshPrompt();};
      const text=document.createElement('span'),title=document.createElement('strong'),meta=document.createElement('small');title.className='material-name';title.textContent=materialLabel(item);meta.className='material-meta';meta.textContent=sourceDetails(item);text.append(title,meta);row.append(check,text);group.append(row);
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
    'get_course_generation_source로 자료를 읽어. PDF·PPT·이미지는 검수 저장본, DOCX·HWP·HWPX·일반 TXT/MD는 교정 없이 원문을 사용해.',
    '전사본은 반드시 검수 저장본만 사용해. 원문 사용으로 우회하지 마.',
    'generated:로 시작하는 ID는 GPT 생성 자료야. get_course_generation_source로 읽고 원래 강의자료보다 우선하지 마. 작업의 document_revisions에 맞춰 expected_revision으로 읽어.',
    '추가 요청사항: '+($('additionalRequests').value.trim()||'없음')+' · start_course_generation의 additional_requests에 그대로 저장해.',
    '교정본의 unresolved와 작업의 review_concerns를 함께 읽고, 불명확한 수치·수식·주장은 확정하지 마. 해당 절에 확인 필요를 표시하고 확인된 내용으로 제작을 계속해.',
    '반드시 목차를 먼저 만들고 save_course_outline로 저장한 뒤에 본문을 작성해.',
    ...(mode==='exam_paper'?['목차 저장 후 문제·정답·해설을 구조화하고 save_course_problem_pack에 job_id, course_id, title, pack을 전달해 바로 저장해. pack은 solvepad.problemPack.v5 형식이며 questions마다 고유 id, promptMd, answer, solution을 포함해. 문서형 정리본은 만들지 마.']:mode==='calculator'?['목차 저장 후 save_course_casio_project에 job_id, course_id, title, blueprint_json, program_text, manual_text를 전달해 바로 저장해. 정리본은 만들지 마.']:['각 절마다 save_course_part로 정리본을 저장해.']),
    ...(mode==='exam_paper'?['문제팩의 promptMd, choices[].text, answer.displayMd, solution, hints[]에는 Markdown+LaTeX를 사용해. 수식은 $...$ 또는 별도 줄 $$...$$로 감싸고, 코드 표시로 감싸지 마. answer.value와 acceptable은 자동 채점용 일반 문자열로 따로 저장해. JSON의 LaTeX 역슬래시는 올바르게 이스케이프하고 아래첨자 전체를 _{...}로 묶어. 긴 유도식은 별도 줄 수식으로 나눠.']:[]),
    '수식은 인라인 $...$ 또는 별도 줄의 $$...$$ LaTeX로 작성해. 아래첨자는 _{...}, 분수는 \\frac{...}{...}를 사용하고 수식을 코드 표시로 감싸지 마.',
    '자료 ID·검수 과정·과목 메타데이터를 본문에 길게 나열하지 마. 정리본의 확인 필요 항목은 핵심만 1~3줄로 요약하고 없으면 생략해. 문제팩과 CASIO 코드·설명서에는 검수 주의사항을 넣지 마.',
    '파일의 사용자 지정 제목, 주차, 기출 연도는 원본 이름/OCR에서 유추해 덮어쓰지 마.',
    ...preset.rules.map(x=>'· '+x)
  ].join('\n');
  $('lectureContext').textContent=c.name;
}
async function refreshCourses(selected=$('course').value){state.courses=await call('/api/courses');opt($('course'),state.courses,x=>x.name+(x.deletion_pending?' · 삭제 미완료':''));opt($('globalCourse'),state.courses,x=>x.name+(x.deletion_pending?' · 삭제 미완료':''));
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
let refreshToken=0;
async function refreshOfferingData(){
  const token=++refreshToken;
  const id=$('course').value;
  if(id!==state.activeOffering){await pad.reset();if(token!==refreshToken||id!==$('course').value)return;rememberDraft();state.activeOffering=id;restoreDraft(id);$('noteVersion').replaceChildren();state.sources=[];state.notes=[];state.selectedIds.clear();
    renderSources();renderNotes();refreshPrompt();$('searchResults').replaceChildren();$('searchQuery').value='';if(!id)$('lectureContext').textContent='과목을 선택하세요.';}
  if(id){const [sources,notes,jobs]=await Promise.all([call(`/api/v2/materials?course_id=${encodeURIComponent(id)}`),call(`/api/v2/notes?course_id=${encodeURIComponent(id)}`),call(`/api/v2/jobs?course_id=${encodeURIComponent(id)}`)]);if(token!==refreshToken||id!==$('course').value)return;state.sources=sources;state.notes=notes;state.jobs=jobs;}
  else{state.sources=[];state.notes=[];state.jobs=[];}
  for(const id of state.selectedIds)if(!state.sources.some(x=>x.id===id))state.selectedIds.delete(id);
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
$('notePageBreak').onclick=()=>insertNote('\n\n<!-- pagebreak -->\n\n');
$('printNote').onclick=async()=>{state.showNotePreview=true;renderNotePreview();await noteMathReady();await document.fonts.ready;window.print();};
$('noteBody').addEventListener('input',()=>{if(state.showNotePreview)renderNotePreview();});
$('pickerSearch').oninput=renderPicker;$('pickerType').onchange=renderPicker;
$('clearSelected').onclick=()=>{state.selectedIds.clear();renderPicker();refreshPrompt();};
$('selectVisible').onclick=()=>{const type=$('pickerType').value,term=$('pickerSearch').value.trim().toLowerCase();for(const x of state.sources){if(isReviewed(x)&&(type==='all'||x.source_type===type||(type==='generated_note'&&x.source_type.startsWith('generated_')))&&(!term||materialLabel(x).toLowerCase().includes(term)))state.selectedIds.add(x.id);}renderPicker();refreshPrompt();};
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
 const msg=['@에쁠가속기 저장한 작업을 이어서 진행해줘.',`과목 ID: ${p.course_id}`,`작업 ID: ${p.job_id}`,`모드: ${p.mode} / 범위: ${p.scope}`,`저장된 추가 요청사항: ${p.additional_requests||'없음'}`,`생성 자료 버전: ${JSON.stringify(p.document_revisions||{})}`,
  `선택된 교정 자료 ID: ${p.source_ids.join(', ')}`,`저장된 절: ${p.saved_parts.join(', ')||'없음'}`,
  p.mode==='exam_paper'?'진행 상태를 확인하고 저장된 문항·정답·해설을 save_course_problem_pack에 job_id와 함께 구조화해 바로 저장해.':p.mode==='calculator'?'진행 상태를 확인하고 save_course_casio_project에 job_id와 함께 코드를 바로 저장해.':'먼저 진행 상태를 확인하고 저장된 목차와 자료를 사용해 빠진 절만 save_course_part로 저장해.',
  'get_course_generation_progress의 파일 사용 방식과 추가 요청사항을 유지해. 기존 절을 덮어쓰지 마. 수정 충돌이 있으면 멈추고 보고해.'].join('\n');
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
 const id=$('packSelect').value;if(!id)throw Error('과목별 문제팩이 없습니다. GPT 제작실에서 시험형 문제집을 생성하세요.');
 const record=await call('/api/v2/pack?id='+encodeURIComponent(id));
 if(!course()||!record.pack?.questions?.length)throw Error('문제팩 내용이 올바르지 않습니다.');
 await pad.load(id,record);
},'문제팩을 열었습니다.');
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
 document.querySelectorAll('#course-form button,#deleteCourse,#source-form button,#note-form button,#noteNew,#casioForm button').forEach(el=>el.disabled=!state.writesEnabled);
 pad.setWritable(state.writesEnabled);
}
$('globalCourse').onchange=()=>run(async()=>{const target=$('globalCourse').value;$('course').value=target;state.selectedIds.clear();await refreshOfferings();});$('course').onchange=()=>run(async()=>{$('globalCourse').value=$('course').value;state.selectedIds.clear();await refreshOfferings();});$('offering').onchange=()=>run(refreshOfferingData);
$('mode').onchange=refreshPrompt;$('scope').oninput=refreshPrompt;$('additionalRequests').oninput=()=>{refreshPrompt();rememberDraft();};
$('course-form').onsubmit=e=>{e.preventDefault();run(async()=>{const r=await call('/api/courses',json({name:$('courseName').value,characteristics:$('characteristics').value}));$('course-form').reset();await refreshCourses(r.id);});};
$('deleteCourse').onclick=()=>{
 const current=course();if(!current)return fail('삭제할 과목을 선택하세요.');
 const typed=window.prompt(`「${current.name}」 과목과 모든 파일·정리본·문제팩·CASIO 코드·풀이 기록·작업을 영구 삭제합니다. 확인하려면 과목 이름을 그대로 입력하세요.`);
 if(typed!==current.name)return;
 run(async()=>{
   if(current.id!==course()?.id)throw Error('선택 과목이 바뀌었습니다. 다시 확인하세요.');
   await pad.reset();
   await call('/api/v2/course/'+encodeURIComponent(current.id),{method:'DELETE'});
   drafts.remove('course:'+current.id);drafts.remove('new-note:'+current.id);for(const note of state.notes)drafts.remove('note:'+note.id);
   state.drafts.delete(current.id);state.activeOffering=null;await refreshCourses();
 },'과목과 연결된 자료를 삭제했습니다.');
};
function sourceFeedback(message,kind='progress'){
 const node=$('sourceSaveStatus');node.hidden=false;node.textContent=message;
 node.className=kind==='error'?'notice error-notice':'hint';
}
async function registerSource(){
 let saved=false;
 try{
  const o=offering();if(!o)throw Error('과목을 먼저 등록하세요.');
  const file=$('sourceFile').files[0],name=file?.name||'',provenance=$('provenance').value,type=$('sourceType').value;
  const weeks=type==='past_exam'?[]:sourceWeeks();
  const exam_year=type==='past_exam'&&$('examYear').value!==''?Number($('examYear').value):null;let r;
  if(exam_year!==null&&(!Number.isInteger(exam_year)||exam_year<1900||exam_year>2100))throw Error('기출 연도는 1900–2100 사이의 정수로 입력하세요.');
  if(file){if(file.size>50*1024*1024)throw Error('최대 50 MiB까지 등록할 수 있습니다.');
    const headers={'Content-Type':'application/octet-stream','X-Upload-Size':String(file.size),'X-Course-Id':o.id,'X-Source-Type':type,'X-Title':encodeURIComponent(name),'X-Filename':encodeURIComponent(file.name),'X-Provenance':encodeURIComponent(provenance),'X-Weeks':JSON.stringify(weeks),...(exam_year!==null?{'X-Exam-Year':String(exam_year)}:{})};
    r=await call('/api/v2/upload',{method:'POST',headers,body:file});
  }else{if(type!=='transcript')throw Error('원본 파일을 선택하세요. 텍스트를 직접 입력했다면 자료 유형을 전사본으로 선택해 주세요.');
    if(!$('transcript').value.trim())throw Error('전사본 내용을 입력하거나 원본 파일을 선택하세요.');
    r=await call('/api/v2/text',json({course_id:o.id,title:name,source_type:type,content:$('transcript').value,weeks,exam_year,provenance}));}
  saved=true;sourceFeedback(r.reused?'이미 등록된 자료입니다. 분류 정보를 갱신했습니다.':'원본 저장 완료 · 자료 목록을 갱신합니다.');
  $('source-form').reset();for(const el of $('weeksGrid').querySelectorAll('input'))el.checked=false;syncSourceMetadataFields();rememberDraft();await refreshOfferingData();
  if(file&&/\.pdf$/i.test(file.name))setTimeout(()=>{void prepareStoredPdf(r.id,file).catch(e=>fail(e.message));},0);
  if(file&&/\.(png|jpe?g)$/i.test(file.name)){
    const preview=await createPagePreview(file);
    if(preview)await call('/api/v2/page-image',{method:'POST',headers:{'Content-Type':'image/jpeg','X-Material-Id':r.id,'X-Page-Num':'1'},body:preview});
  }
  sourceFeedback(r.reused?'기존 자료의 분류 정보를 갱신했습니다.':'자료 저장 완료 · 등록 자료 목록에서 확인할 수 있습니다.');
 }catch(e){sourceFeedback(saved?'원본은 저장됐지만 목록 갱신 또는 페이지 준비에 실패했습니다. '+e.message:e.message,'error');throw e;}
}
bindSourceUpload({form:$('source-form'),button:$('sourceSave'),submit:()=>run(registerSource,'자료 등록 처리를 마쳤습니다.'),feedback:sourceFeedback,canWrite:()=>state.writesEnabled,isBusy:()=>state.busy});
$('search-form').onsubmit=e=>{e.preventDefault();run(async()=>{
  const o=offering();if(!o)throw Error('과목을 먼저 선택하세요.');
  const matches=await call(`/api/v2/search?course_id=${encodeURIComponent(o.id)}&query=${encodeURIComponent($('searchQuery').value)}`);
  $('searchResults').replaceChildren(...(matches.length?matches.map(m=>empty(`${m.source_title}${m.page_num?' · '+m.page_num+'쪽':''}\n${m.content}`)):[empty('선택한 강의에서 검색 결과를 찾지 못했습니다.')]));
});};
$('noteNew').onclick=()=>{rememberDraft();if(($('noteTitle').value||$('noteBody').value)&&!window.confirm('기기 초안을 보관하고 새 정리본을 열까요?'))return;state.editingNote=null;state.noteRequest=null;$('note-form').reset();$('noteVersion').replaceChildren();state.showNotePreview=false;renderNotePreview();renderNoteSave();rememberDraft();};
$('restoreNoteVersion').onclick=()=>run(async()=>{
 const id=state.editingNote?.id,revision=Number($('noteVersion').value);
 if(!id||!revision)throw Error('정리본과 버전을 선택하세요.');
 rememberDraft();
 const version=await call(`/api/v2/note-version?id=${encodeURIComponent(id)}&revision=${revision}`);
 $('noteTitle').value=version.title;$('noteBody').value=version.content_markdown;
 state.showNotePreview=false;renderNotePreview();rememberDraft();
},'선택한 버전을 편집기로 가져왔습니다. 확인 후 저장하면 새 버전이 됩니다.');
$('note-form').onsubmit=e=>{e.preventDefault();run(async()=>{
  const o=offering();if(!o||o.id!==state.activeOffering)throw Error('강의를 선택하세요.');
  const body={course_id:o.id,title:$('noteTitle').value,content_markdown:$('noteBody').value};
  if(state.editingNote){if(state.editingNote.offeringId!==o.id)throw Error('다른 과목의 정리본을 변경할 수 없습니다.');body.id=state.editingNote.id;body.expected_revision=state.editingNote.revision;}
  else{const fingerprint=JSON.stringify(body);if(state.noteRequest?.fingerprint!==fingerprint)state.noteRequest={fingerprint,id:crypto.randomUUID()};body.request_id=state.noteRequest.id;}
  const saved=await call('/api/v2/note',json(body));if(!state.editingNote)drafts.remove('new-note:'+o.id);state.editingNote={id:saved.id,revision:saved.revision,offeringId:o.id};state.noteRequest=null;renderNoteSave();rememberDraft();await refreshOfferingData();
 const versions=await call('/api/v2/note-versions?id='+encodeURIComponent(saved.id));opt($('noteVersion'),versions,x=>`v${x.revision} · ${x.title}`);$('noteVersion').value=String(saved.revision);
},'정리본을 저장했습니다.');};
$('copyPrompt').onclick=()=>run(async()=>{if(!offering())throw Error('과목을 선택하세요.');if(!state.selectedIds.size)throw Error('사용할 자료를 1개 이상 선택하세요.');if(selectedSources().some(x=>!isReviewed(x)))throw Error('검토 전 자료를 사용할 수 없습니다.');await navigator.clipboard.writeText($('prompt').value);},'선택 자료와 교정본 우선 원칙을 포함한 GPT 요청문을 복사했습니다.');
run(async()=>{const user=await call('/api/session');drafts=createDraftStore(user.user_id,fail);pad.setStorageUser(user.user_id);$('accountName').textContent=user.display_name;state.writesEnabled=user.mutations_enabled===true;$('readOnlyNotice').hidden=state.writesEnabled;await refreshCourses();});

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

for(const id of ['noteTitle','noteBody','transcript','sourceType','provenance','examYear','mode','scope','additionalRequests','casioTitle','casioBlueprint','casioProgram','casioManual'])$(id).addEventListener('input',()=>{clearTimeout(draftTimer);draftTimer=setTimeout(rememberDraft,300)});
window.addEventListener('pagehide',()=>{clearTimeout(draftTimer);rememberDraft();});

$('noteRestoreDraft').onclick=()=>{const d=drafts.read('new-note:'+state.activeOffering);if(!d)return;if(!window.confirm('기기에 남은 새 정리본 초안을 불러올까요?'))return;rememberDraft();state.editingNote=null;state.noteRequest=null;$('noteTitle').value=d.title;$('noteBody').value=d.body;state.showNotePreview=false;renderNoteSave();renderNotePreview();rememberDraft();};
