import {DEFAULT_PRESETS,makeRequest} from '../domain/core.mjs';
const $=id=>document.getElementById(id);
const state={courses:[],offerings:[],sources:[],notes:[],facts:[],editingNote:null};
const setStatus=(msg)=>{$('status').textContent=msg;};
const fail=(msg)=>{$('error').textContent=msg;$('error').hidden=false;};
const clear=()=>{$('error').hidden=true;};
const course=()=>state.courses.find(x=>x.id===$('course').value);
const offering=()=>state.offerings.find(x=>x.id===$('offering').value);
async function call(path,options={}){
  const r=await fetch(path,{credentials:'same-origin',...options});
  if(!r.ok){let msg='요청 실패';try{msg=(await r.json()).error||msg;}catch{}throw Error(`${msg} (HTTP ${r.status})`);}
  return r.json();
}
const json=(data)=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
const opt=(select,items,getLabel)=>{select.replaceChildren();for(const x of items){const o=new Option(getLabel(x),x.id);select.add(o);}};
const empty=(text)=>{const li=document.createElement('li');li.textContent=text;return li;};
function renderSources(){
  const node=$('sourceList');node.replaceChildren();
  if(!state.sources.length){node.append(empty('등록된 자료가 없습니다.'));return;}
  for(const src of state.sources){
    const li=document.createElement('li');const text=document.createElement('span');text.textContent=`${src.title} · ${src.source_type} · ${src.extract_status==='ready'?'검색 가능':'원문 추출 대기'}`;li.append(text);
    if(src.file_name){const button=document.createElement('button');button.type='button';button.className='ghost small';button.textContent='원본 다운로드';button.onclick=()=>location.assign(`/api/files/${encodeURIComponent(src.id)}`);li.append(button);}node.append(li);
  }
}
function renderFacts(){const node=$('factsList');node.replaceChildren();if(!state.facts.length){node.append(empty('등록된 특성이 없습니다.'));return;}
  for(const f of state.facts){const li=document.createElement('li');li.textContent=`${f.fact_key}: ${f.fact_value} (${f.confidence} · ${f.provenance||'출처 없음'})`;node.append(li);}
}
function renderNotes(){const node=$('noteList');node.replaceChildren();if(!state.notes.length){node.append(empty('저장된 정리본이 없습니다.'));return;}
  for(const note of state.notes){const li=document.createElement('li');const b=document.createElement('button');b.type='button';b.className='ghost small';b.textContent=`${note.title} · v${note.revision}`;b.onclick=async()=>{
    try{const n=await call(`/api/notes?note_id=${encodeURIComponent(note.id)}`);$('noteTitle').value=n.title;$('noteBody').value=n.content_markdown;state.editingNote={id:n.id,revision:n.revision};$('noteSave').textContent='기존 정리본 수정 저장';setStatus('정리본 수정 중 (버전 '+n.revision+')');}catch(e){fail(e.message);}
  };li.append(b);node.append(li);}
}
function refreshPrompt(){const c=course(),o=offering();if(!c||!o){$('prompt').value='과목과 학년도별 강의를 먼저 등록하세요.';return;}
  const src=state.sources.map(x=>({id:x.id,type:x.source_type,offeringId:x.offering_id,extractStatus:x.extract_status}));
  $('prompt').value=makeRequest({course:c,offering:{...o,id:o.id,notes:o.notes},sources:src,mode:$('mode').value,scope:$('scope').value,preset:DEFAULT_PRESETS[$('mode').value]}).text;
}
async function refreshCourses(){state.courses=await call('/api/courses');const selected=$('course').value;opt($('course'),state.courses,x=>x.name);
  if(state.courses.some(x=>x.id===selected))$('course').value=selected;await refreshOfferings();}
async function refreshOfferings(){const id=$('course').value,selected=$('offering').value;state.offerings=id?await call(`/api/offerings?course_id=${encodeURIComponent(id)}`):[];
  opt($('offering'),state.offerings,x=>`${x.year}-${x.term} ${x.professor||'교수 미지정'}`);
  if(state.offerings.some(x=>x.id===selected))$('offering').value=selected;await refreshOfferingData();}
async function refreshOfferingData(){state.editingNote=null;$('noteSave').textContent='새 정리본 저장';const id=$('offering').value;state.sources=id?await call(`/api/sources?offering_id=${encodeURIComponent(id)}`):[];
  state.notes=id?await call(`/api/notes-list?offering_id=${encodeURIComponent(id)}`):[];
  state.facts=id?(await call(`/api/course-context?offering_id=${encodeURIComponent(id)}`)).facts:[];
  renderSources();renderNotes();renderFacts();refreshPrompt();}
const run=async(fn)=>{clear();try{await fn();setStatus('서버 데이터 동기화됨');}catch(e){fail(e.message);setStatus('작업 실패');}};
$('fact-form').onsubmit=e=>{e.preventDefault();run(async()=>{
  const o=offering();if(!o)throw Error('강의를 먼저 선택하세요.');
  await call('/api/facts',json({offering_id:o.id,fact_key:$('factKey').value,fact_value:$('factValue').value,
    provenance:$('factProvenance').value,confidence:$('factConfidence').value}));
  $('fact-form').reset();await refreshOfferingData();
});};
$('course').onchange=()=>run(refreshOfferings);$('offering').onchange=()=>run(refreshOfferingData);
$('mode').onchange=refreshPrompt;$('scope').oninput=refreshPrompt;
$('course-form').onsubmit=e=>{e.preventDefault();run(async()=>{await call('/api/courses',json({name:$('courseName').value,characteristics:$('characteristics').value}));$('course-form').reset();await refreshCourses();});};
$('offering-form').onsubmit=e=>{e.preventDefault();run(async()=>{if(!course())throw Error('과목을 먼저 선택하세요.');await call('/api/offerings',json({course_id:course().id,year:Number($('year').value),term:$('term').value,professor:$('professor').value}));await refreshOfferings();});};
$('source-form').onsubmit=e=>{e.preventDefault();run(async()=>{
  const o=offering();if(!o)throw Error('학년도별 강의를 선택하세요.');
  const file=$('sourceFile').files[0],name=$('sourceTitle').value,provenance=$('provenance').value,type=$('sourceType').value;
  if(file){const headers={'Content-Type':'application/octet-stream','X-Offering-Id':o.id,
    'X-Source-Type':type,'X-Source-Title':encodeURIComponent(name),'X-Source-Provenance':encodeURIComponent(provenance),'X-File-Name':encodeURIComponent(file.name)};
    await call('/api/assets',{method:'POST',headers,body:file});
  }else{if(type!=='transcript')throw Error('전사본 직접 입력 외에는 원본 파일을 선택하세요.');
    await call('/api/transcripts',json({offering_id:o.id,title:name,text:$('transcript').value,provenance}));}
  $('source-form').reset();await refreshOfferingData();
});};
$('note-form').onsubmit=e=>{e.preventDefault();run(async()=>{if(!offering())throw Error('강의를 선택하세요.');
  const body={offering_id:offering().id,title:$('noteTitle').value,content_markdown:$('noteBody').value};
  if(state.editingNote){body.note_id=state.editingNote.id;body.expected_revision=state.editingNote.revision;}
  await call('/api/notes',json(body));
  $('note-form').reset();await refreshOfferingData();
});};
$('copyPrompt').onclick=()=>run(async()=>{await navigator.clipboard.writeText($('prompt').value);setStatus('GPT 요청문 복사 완료');});
run(refreshCourses);
