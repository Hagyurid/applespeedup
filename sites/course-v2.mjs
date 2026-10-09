/** v0.9 course-only library. Source metadata is author-entered, not inferred.
 * OCR inference is performed by ChatGPT via tools, not a paid server-side model.
 */
import {extractOriginal,unzip} from './office-original.mjs';
const fail=(code)=>{const e=new Error(code);e.code=code;throw e;};
const uid=()=>crypto.randomUUID();
const clean=(value,max)=>{if(typeof value!=='string'||!value.trim()||value.length>max)fail('BAD_REQUEST');return value.trim();};
const TYPES=new Set(['lecture_slides','transcript','textbook','past_exam','other']);
const FILE_TYPES={'.txt':'text/plain','.md':'text/markdown','.pdf':'application/pdf','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','.doc':'application/msword','.hwp':'application/x-hwp','.hwpx':'application/vnd.hancom.hwpx','.pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation'};
export const MAX_COURSE_UPLOAD_BYTES=50*1024*1024;
const OLE_HEADER=[208,207,17,224,161,177,26,225];
const isZip=data=>data[0]===80&&data[1]===75&&data[2]===3&&data[3]===4;
const isOle=data=>OLE_HEADER.every((value,index)=>data[index]===value);
const VISUAL=new Set(['application/pdf','image/png','image/jpeg','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.ms-powerpoint']);
const DIRECT=new Set(['text/plain','text/markdown','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/x-hwp','application/vnd.hancom.hwpx']);
const useOriginal=m=>DIRECT.has(m.mime_type)&&m.source_type!=='transcript';
function metadata(type,weeks=[],examYear=null){
 if(!TYPES.has(type)||!Array.isArray(weeks)||weeks.length>30||weeks.some(x=>!Number.isInteger(x)||x<1||x>30))fail('BAD_REQUEST');
 if(type==='past_exam'){
   if(weeks.length||examYear!==null&&(!Number.isInteger(examYear)||examYear<1900||examYear>2100))fail('BAD_REQUEST');
   return {weeks:[],examYear};
 }
 if(examYear!==null)fail('BAD_REQUEST');
 return {weeks:[...new Set(weeks)].sort((a,b)=>a-b),examYear:null};
}
async function read(request,max){
 const length=Number(request.headers.get('content-length')||request.headers.get('x-upload-size')||0);
 if(!Number.isSafeInteger(length)||length<0)fail('BAD_FILE');
 if(length>max)fail('FILE_TOO_LARGE');
 const reader=request.body?.getReader();if(!reader)fail('BAD_FILE');
 // Known-size file uploads fill one buffer instead of retaining chunks plus a second full copy.
 const buffer=length?new Uint8Array(length):null,chunks=[];let n=0;
 try{while(true){const x=await reader.read();if(x.done)break;const offset=n;n+=x.value.byteLength;
   if(n>max){await reader.cancel();fail('FILE_TOO_LARGE');}
   if(buffer){if(n>length){await reader.cancel();fail('BAD_FILE');}buffer.set(x.value,offset);}else chunks.push(x.value);
 }}finally{reader.releaseLock();}
 if(!n||buffer&&n!==length)fail('BAD_FILE');if(buffer)return buffer;
 const result=new Uint8Array(n);let offset=0;for(const c of chunks){result.set(c,offset);offset+=c.length;}return result;
}

export function createCourseLibrary(db,bucket){
 if(!db?.prepare||!db?.batch)throw Error('D1 binding required');
 const originalCache=new Map();
 const q=(sql,...args)=>db.prepare(sql).bind(...args);
 const one=(sql,...args)=>q(sql,...args).first();
 const all=async(sql,...args)=>(await q(sql,...args).all()).results||[];
 async function access(user,course_id,write=false){
  if(!user||!course_id)fail('FORBIDDEN');
  const row=await one("SELECT c.id,c.owner_user_id,m.role FROM courses c LEFT JOIN course_members m ON m.course_id=c.id AND m.user_id=? WHERE c.id=? AND c.deletion_pending=0 AND (c.owner_user_id=? OR m.user_id=?)",user,course_id,user,user);
  if(!row)fail('NOT_FOUND');
  if(write&&row.owner_user_id!==user&&!['owner','editor'].includes(row.role))fail('FORBIDDEN');
  return row;
 }
 async function source(user,id,write=false){
  if(typeof id==='string'&&id.startsWith('generated:')){
   if(write)fail('FORBIDDEN');
   const kind=/^generated:(pack|casio):(.+)$/.exec(id);
   if(kind){
    const row=await one(kind[1]==='pack'?"SELECT * FROM course_problem_packs WHERE id=?":"SELECT * FROM course_casio_projects WHERE id=?",kind[2]);
    if(!row)fail('NOT_FOUND');await access(user,row.course_id);
    const original_text=kind[1]==='pack'?row.pack_json:[row.blueprint_json,row.program_text,row.manual_text].join('\n\n');
    const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(original_text)));
    const revision=parseInt([...hash.subarray(0,6)].map(n=>n.toString(16).padStart(2,'0')).join(''),16);
    return {...row,id,original_text,revision,mime_type:'text/plain',source_type:'generated_'+kind[1],page_count:1};
   }
   const document=await one("SELECT d.* FROM course_documents d WHERE d.id=? AND EXISTS(SELECT 1 FROM course_generation_jobs j WHERE j.document_id=d.id AND j.mode NOT IN ('exam_paper','calculator') AND EXISTS(SELECT 1 FROM course_generation_parts p WHERE p.job_id=j.id))",id.slice(10));
   if(!document)fail('NOT_FOUND');await access(user,document.course_id);
   return {...document,id,document_id:document.id,original_text:document.content_markdown,mime_type:'text/markdown',source_type:'generated_note',page_count:1};
  }
  const row=await one("SELECT * FROM course_materials WHERE id=?",id);
  if(!row)fail('NOT_FOUND');await access(user,row.course_id,write);if(row.review_status==='deletion_pending')fail('STORAGE_DELETE_FAILED');return row;
 }
 async function note(user,id,write=false){
  const row=await one("SELECT * FROM course_documents WHERE id=?",id);
  if(!row)fail('NOT_FOUND');await access(user,row.course_id,write);return row;
 }
 async function job(user,id){
  const row=await one("SELECT * FROM course_generation_jobs WHERE id=?",id);
  if(!row)fail('NOT_FOUND');await access(user,row.course_id,true);if(row.user_id!==user)fail('FORBIDDEN');return row;
 }
 const reviewState=m=>m.review_status==='deletion_pending'?'deletion_pending':useOriginal(m)?'original_ready':m.page_count>0&&m.recorded_pages===m.page_count&&(m.mime_type!=='application/pdf'||m.prepared_pages===m.page_count)
   ?(m.issue_pages?'reviewed_with_issues':'reviewed'):'pending_review';
 async function reviewSummary(m){
  const [pages,images]=await Promise.all([
   all("SELECT page_num,evidence_json,unresolved_json FROM course_material_pages WHERE material_id=? ORDER BY page_num",m.id),
   all("SELECT page_num,CASE WHEN text_ready=1 OR extracted_text<>'' THEN 1 ELSE 0 END AS text_ready FROM course_material_page_images WHERE material_id=? ORDER BY page_num",m.id)
  ]);
  const recorded=pages.filter(p=>p.page_num>=1&&p.page_num<=m.page_count);
  const concerns=recorded.filter(p=>JSON.parse(p.unresolved_json||'[]').length).map(p=>({material_id:m.id,title:m.title,page_num:p.page_num,
    unresolved:JSON.parse(p.unresolved_json),evidence_ids:JSON.parse(p.evidence_json||'[]')}));
  const review_status=reviewState({...m,recorded_pages:recorded.length,issue_pages:concerns.length,prepared_pages:images.length});
  const summary={review_status,available_for_generation:['reviewed','reviewed_with_issues','original_ready'].includes(review_status),recorded_pages:recorded.map(p=>p.page_num),review_concerns:concerns,
   prepared_pages:images.map(p=>p.page_num),text_ready_pages:images.filter(p=>p.text_ready).map(p=>p.page_num)};
  return summary;
 }
 async function originalContent(m){
  if(originalCache.has(m.id))return originalCache.get(m.id);
  if(m.original_text!==null&&m.original_text!==undefined){if(!m.original_text.trim())fail('ORIGINAL_UNREADABLE');return m.original_text;}
  if(!m.storage_key||!bucket?.get)fail('ORIGINAL_UNREADABLE');
  const file=await bucket.get(m.storage_key);if(!file)fail('NOT_FOUND');
  const parsed=extractOriginal(new Uint8Array(await new Response(file.body).arrayBuffer()),m.mime_type);
  if(!parsed.text)fail('ORIGINAL_UNREADABLE');originalCache.set(m.id,parsed.text);return parsed.text;
 }
 async function sourceConcerns(user,ids,originalIds=[],documentRevisions={}){
  const concerns=[];
  for(const id of ids){const m=await source(user,id);
   if(m.source_type.startsWith('generated_')){
    if(documentRevisions[id]!==undefined&&documentRevisions[id]!==m.revision)fail('REVISION_CONFLICT');
    concerns.push({material_id:id,title:m.title,page_num:1,unresolved:['GPT 생성 자료는 보조 자료입니다. 원래 강의 범위와 자료 검토 주의사항을 우선 확인하세요.'],evidence_ids:[]});continue;
   }
   if(useOriginal(m)){
    if(!DIRECT.has(m.mime_type)||(!useOriginal(m)&&m.source_type!=='transcript'))fail('BAD_REQUEST');
    await originalContent(m);
    if(!['text/plain','text/markdown'].includes(m.mime_type))concerns.push({material_id:id,title:m.title,page_num:1,unresolved:['교정 없이 원문 본문을 사용합니다. 이미지·수식·배치 등 텍스트 밖의 개체는 원본 파일에서 추가 확인이 필요합니다.'],evidence_ids:[]});
    continue;
   }
   const review=await reviewSummary(m);if(!review.available_for_generation)fail('REVIEW_INCOMPLETE');concerns.push(...review.review_concerns);
  }
  return concerns;
 }
 async function reviewNotice(user,run){
  const concerns=await sourceConcerns(user,JSON.parse(run.source_ids_json),[],JSON.parse(run.generation_options_json||'{}').document_revisions||{});
  if(['exam_paper','calculator'].includes(run.mode)||!concerns.length)return '';
  const escape=s=>String(s).replace(/[\\`*_{}\[\]<>#|]/g,'\\$&').replace(/[\r\n]+/g,' ');
  const items=[...new Set(concerns.flatMap(p=>p.unresolved.map(issue=>p.page_num+'쪽: '+String(issue).replace(/[\r\n]+/g,' ').slice(0,110))))];
  return '## 확인 필요\n\n'+items.slice(0,2).map(x=>'- '+escape(x)).join('\n')+(items.length>2?'\n- 그 외 '+(items.length-2)+'건은 자료 검수 기록에서 확인하세요.':'')+'\n\n';
 }
 return {
  async listMaterials(user,{course_id,type='all'}={}){
   await access(user,course_id);
   const rows=await all("SELECT id,course_id,title,source_type,weeks_json,exam_year,original_filename AS file_name,mime_type,provenance,review_status,page_count,created_at,(SELECT count(*) FROM course_material_page_images p WHERE p.material_id=course_materials.id) AS prepared_pages,(SELECT count(*) FROM course_material_pages p WHERE p.material_id=course_materials.id AND p.page_num BETWEEN 1 AND course_materials.page_count) AS recorded_pages,(SELECT count(*) FROM course_material_pages p WHERE p.material_id=course_materials.id AND p.page_num BETWEEN 1 AND course_materials.page_count AND json_array_length(p.unresolved_json)>0) AS issue_pages FROM course_materials WHERE course_id=? ORDER BY created_at DESC,id DESC LIMIT 400",course_id);
   const generated=await all("SELECT d.id AS document_id,d.title,d.revision,d.type,d.updated_at FROM course_documents d WHERE d.course_id=? AND EXISTS(SELECT 1 FROM course_generation_jobs j WHERE j.document_id=d.id AND j.mode NOT IN ('exam_paper','calculator') AND EXISTS(SELECT 1 FROM course_generation_parts p WHERE p.job_id=j.id)) ORDER BY d.updated_at DESC LIMIT 400",course_id);
   const catalog=rows.map(({weeks_json,...r})=>{const review_status=reviewState(r);return {...r,review_status,processing_mode:useOriginal(r)?'original':r.source_type==='transcript'&&!VISUAL.has(r.mime_type)?'transcript':'review',can_use_original:useOriginal(r),available_for_generation:['reviewed','reviewed_with_issues','original_ready'].includes(review_status),weeks:JSON.parse(weeks_json||'[]'),extract_status:review_status!=='pending_review'?'ready':'pending'};});
   catalog.push(...generated.map(d=>({...d,id:'generated:'+d.document_id,course_id,source_type:'generated_note',mime_type:'text/markdown',processing_mode:'generated',review_status:'generated_ready',available_for_generation:true,weeks:[],page_count:1})));
   const [packs,casio]=await Promise.all([
    all("SELECT id,title FROM course_problem_packs WHERE course_id=? ORDER BY created_at DESC LIMIT 400",course_id),
    all("SELECT id,title FROM course_casio_projects WHERE course_id=? ORDER BY updated_at DESC LIMIT 400",course_id)
   ]);
   for(const [kind,items] of [['pack',packs],['casio',casio]])catalog.push(...items.map(d=>({...d,id:'generated:'+kind+':'+d.id,course_id,source_type:'generated_'+kind,mime_type:'text/plain',processing_mode:'generated',review_status:'generated_ready',available_for_generation:true,weeks:[],page_count:1})));
   return catalog.filter(r=>type==='all'||r.source_type===type);
  },
  async upload(user,{course_id,title,source_type,weeks=[],exam_year=null,filename,provenance='',buffer}={}){
   await access(user,course_id,true);
   const data=buffer;if(!(data instanceof Uint8Array)||data.length<4||data.length>MAX_COURSE_UPLOAD_BYTES)fail(data?.length>MAX_COURSE_UPLOAD_BYTES?'FILE_TOO_LARGE':'BAD_FILE');
   const meta=metadata(source_type,weeks,exam_year),file=clean(filename,250),name=clean(title||file,250);
   if(typeof provenance!=='string'||provenance.length>400)fail('BAD_REQUEST');
   const extension=/\.[^.]+$/.exec(file.toLowerCase())?.[0],mime=FILE_TYPES[extension];
   if(!mime)fail('BAD_FILE');
   if(extension==='.pdf'&&new TextDecoder().decode(data.subarray(0,5))!=='%PDF-')fail('BAD_FILE');
   if(['.png'].includes(extension)&&!(data[0]===137&&data[1]===80&&data[2]===78&&data[3]===71))fail('BAD_FILE');
   if(['.jpg','.jpeg'].includes(extension)&&!(data[0]===255&&data[1]===216&&data[2]===255))fail('BAD_FILE');
   if(['.docx','.pptx','.hwpx'].includes(extension)&&!isZip(data))fail('BAD_FILE');
   if(['.doc','.hwp'].includes(extension)&&!isOle(data))fail('BAD_FILE');
   if(!bucket?.put)fail('STORAGE_NOT_CONFIGURED');
   const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(x=>x.toString(16).padStart(2,'0')).join('');
   const duplicate=await one("SELECT id FROM course_materials WHERE course_id=? AND source_type=? AND sha256=?",course_id,source_type,hash);
   if(duplicate){
    await q("UPDATE course_materials SET title=?,weeks_json=?,exam_year=?,provenance=? WHERE id=?",name,JSON.stringify(meta.weeks),meta.examYear,provenance.trim(),duplicate.id).run();
    return {id:duplicate.id,reused:true};
   }
   const id=uid(),key='course-assets/'+course_id+'/'+id;
   await bucket.put(key,data,{httpMetadata:{contentType:mime}});
   try{
     const parsed=DIRECT.has(mime)||mime.endsWith('presentationml.presentation')?extractOriginal(data,mime):{};
     const originalText=['text/plain','text/markdown'].includes(mime)?new TextDecoder('utf-8',{fatal:true}).decode(data):parsed.text??null;
     const stored=await q("INSERT INTO course_materials(id,course_id,title,source_type,weeks_json,exam_year,original_filename,mime_type,provenance,storage_key,sha256,original_text,review_status,page_count) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,'pending_review',? WHERE EXISTS(SELECT 1 FROM courses WHERE id=? AND deletion_pending=0)",
       id,course_id,name,source_type,JSON.stringify(meta.weeks),meta.examYear,file,mime,provenance.trim(),key,hash,originalText,mime==='application/pdf'?0:parsed.pages?.length||1,course_id).run();
     if(stored.meta.changes!==1)fail('NOT_FOUND');
   }catch(e){await bucket.delete(key).catch(()=>{});throw e}
   return {id,review_status:'pending_review'};
  },
  async registerText(user,{course_id,title,source_type='transcript',weeks=[],exam_year=null,provenance='',content}={}){
   await access(user,course_id,true);
   if(typeof provenance!=='string'||provenance.length>400)fail('BAD_REQUEST');
   const meta=metadata(source_type,weeks,exam_year),value=clean(content,950000);
   const hash='pasted:'+ [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');
   const name=clean(title||('전사본 · '+new Date().toISOString().replace('T',' ').slice(0,16)),200);
   // Exact-text fallback also recognizes transcripts registered before hashing was added.
   const duplicate=await one("SELECT id FROM course_materials WHERE course_id=? AND source_type=? AND (sha256=? OR (sha256 IS NULL AND original_text=?)) LIMIT 1",course_id,source_type,hash,value);
   if(duplicate){await q("UPDATE course_materials SET title=?,weeks_json=?,exam_year=?,provenance=?,sha256=? WHERE id=?",name,JSON.stringify(meta.weeks),meta.examYear,provenance.trim(),hash,duplicate.id).run();return {id:duplicate.id,reused:true};}
   const id=uid();
   await q("INSERT OR IGNORE INTO course_materials(id,course_id,title,source_type,weeks_json,exam_year,provenance,original_text,sha256,mime_type,review_status,page_count) VALUES(?,?,?,?,?,?,?,?,?,'text/plain','pending_review',1)",
     id,course_id,name,source_type,JSON.stringify(meta.weeks),meta.examYear,provenance.trim(),value,hash).run();
   const stored=await one("SELECT id FROM course_materials WHERE course_id=? AND source_type=? AND sha256=?",course_id,source_type,hash);
   return {id:stored.id,reused:stored.id!==id,review_status:'pending_review'};
  },
  async deleteMaterial(user,{id}={}){
   const material=await one("SELECT * FROM course_materials WHERE id=?",id);
   if(!material)fail('NOT_FOUND');await access(user,material.course_id,true);
   await q("UPDATE course_materials SET review_status='deletion_pending' WHERE id=?",id).run();
   const images=await all('SELECT storage_key FROM course_material_page_images WHERE material_id=?',id);
   const keys=[material.storage_key,...images.map(image=>image.storage_key)].filter(Boolean);
   if(keys.length&&!bucket?.delete)fail('STORAGE_NOT_CONFIGURED');
   for(let i=0;i<keys.length;i+=20){const results=await Promise.allSettled(keys.slice(i,i+20).map(key=>bucket.delete(key)));if(results.some(x=>x.status==='rejected'))fail('STORAGE_DELETE_FAILED');}
   await q('DELETE FROM course_materials WHERE id=? AND course_id=?',id,material.course_id).run();
   return {id,deleted:true};
  },
  async deleteCourse(user,{id}={}){
   if(!user||!id)fail('BAD_REQUEST');
   const owned=await one('SELECT id FROM courses WHERE id=? AND owner_user_id=?',id,user);
   if(!owned)fail('NOT_FOUND');
   await q('UPDATE courses SET deletion_pending=1 WHERE id=? AND owner_user_id=?',id,user).run();
   const [materials,images,legacy,legacyImages]=await Promise.all([
    all('SELECT storage_key FROM course_materials WHERE course_id=?',id),
    all('SELECT p.storage_key FROM course_material_page_images p JOIN course_materials m ON m.id=p.material_id WHERE m.course_id=?',id),
    all('SELECT s.storage_key FROM source_assets s JOIN offerings o ON o.id=s.offering_id WHERE o.course_id=?',id),
    all('SELECT p.storage_key FROM source_page_images p JOIN source_assets s ON s.id=p.source_id JOIN offerings o ON o.id=s.offering_id WHERE o.course_id=?',id)
   ]);
   const keys=[...materials,...images,...legacy,...legacyImages].map(row=>row.storage_key).filter(Boolean);
   if(keys.length&&!bucket?.delete)fail('STORAGE_NOT_CONFIGURED');
   for(let i=0;i<keys.length;i+=20){const results=await Promise.allSettled(keys.slice(i,i+20).map(key=>bucket.delete(key)));if(results.some(x=>x.status==='rejected'))fail('STORAGE_DELETE_FAILED');}
   // These references have NO ACTION foreign keys and must be removed before their parents.
   await db.batch([
    q('DELETE FROM private_attempts WHERE pack_id IN (SELECT p.id FROM problem_packs p JOIN offerings o ON o.id=p.offering_id WHERE o.course_id=?)',id),
    q('DELETE FROM ai_generation_runs WHERE course_id=?',id),
    q('DELETE FROM course_generation_jobs WHERE course_id=?',id),
    q('DELETE FROM course_facts WHERE course_id=?',id),
    q('DELETE FROM courses WHERE id=? AND owner_user_id=?',id,user)
   ]);
   return {id,deleted:true};
  },
  async setPdfPageCount(user,{material_id,page_count}={}){
   const m=await source(user,material_id,true);
   if(m.mime_type!=='application/pdf'||!Number.isInteger(page_count)||page_count<1||page_count>1000)fail('BAD_REQUEST');
   if(m.page_count&&m.page_count!==page_count)fail('REVISION_CONFLICT');
   await q("UPDATE course_materials SET page_count=? WHERE id=?",page_count,material_id).run();
   return {material_id,page_count};
  },
  async uploadPageImage(user,{material_id,page_num,mime_type,bytes}={}){
   const m=await source(user,material_id,true);
   if(!['application/pdf','image/jpeg','image/png'].includes(m.mime_type)||!m.page_count||
      !Number.isInteger(page_num)||page_num<1||page_num>m.page_count||
      !['image/jpeg','image/png'].includes(mime_type)||!(bytes instanceof Uint8Array)||bytes.length<50||bytes.length>1024*1024||
      (mime_type==='image/jpeg'&&!(bytes[0]===255&&bytes[1]===216&&bytes[2]===255))||
      (mime_type==='image/png'&&!(bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71)))fail('BAD_FILE');
   if(!bucket?.put||!bucket?.delete)fail('STORAGE_NOT_CONFIGURED');
   const old=await one("SELECT storage_key FROM course_material_page_images WHERE material_id=? AND page_num=?",material_id,page_num);
   if(old)return {material_id,page_num,reused:true};
   const key='course-pages/'+m.course_id+'/'+material_id+'/'+page_num+'/'+uid();
   await bucket.put(key,bytes,{httpMetadata:{contentType:mime_type}});
   try{const stored=await q("INSERT INTO course_material_page_images(material_id,page_num,storage_key,mime_type) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM course_materials m JOIN courses c ON c.id=m.course_id WHERE m.id=? AND m.review_status<>'deletion_pending' AND c.deletion_pending=0)",material_id,page_num,key,mime_type,material_id).run();if(stored.meta.changes!==1)fail('NOT_FOUND');}
   catch(e){await bucket.delete(key).catch(()=>{});throw e}
   return {material_id,page_num,stored:true};
  },
  async savePageText(user,{material_id,page_num,text}={}){
   const m=await source(user,material_id,true);
   if(m.mime_type!=='application/pdf'||!Number.isInteger(page_num)||page_num<1||page_num>m.page_count||
      typeof text!=='string'||text.length>100000)fail('BAD_REQUEST');
   const updated=await q("UPDATE course_material_page_images SET extracted_text=?,text_ready=1,updated_at=CURRENT_TIMESTAMP WHERE material_id=? AND page_num=?",text,material_id,page_num).run();
   if(updated.meta.changes!==1)fail('NOT_FOUND');
   return {material_id,page_num,saved:true};
  },
  async pageStatus(user,{material_id}={}){
   const m=await source(user,material_id);
   const summary=await reviewSummary(m);
   const issues=new Set(summary.review_concerns.map(x=>x.page_num));
   return {material_id,page_count:m.page_count,...summary,
    reviewed_pages:summary.recorded_pages.filter(n=>!issues.has(n)),needs_review_pages:[...issues]};
  },
  async getPageImage(user,{material_id,page_num=1}={}){
   const m=await source(user,material_id);
   if(!Number.isInteger(page_num)||page_num<1||!bucket?.get)fail('BAD_REQUEST');
   if(m.mime_type.endsWith('presentationml.presentation')){
    if(page_num>m.page_count)fail('BAD_REQUEST');
    const original=await bucket.get(m.storage_key);if(!original)fail('NOT_FOUND');
    const files=unzip(new Uint8Array(await new Response(original.body).arrayBuffer()));
    const slide=JSON.parse(await originalContent(m))[page_num-1];
    const rel=files.get(slide.name.replace('slides/','slides/_rels/')+'.rels');
    const xml=rel?new TextDecoder().decode(rel):'',images=[];let size=0;
    for(const match of xml.matchAll(/<Relationship\b[^>]*\bTarget=["']([^"']+)["'][^>]*>/g)){
     const target=match[1],name='ppt/'+target.replace(/^\.\.\//,'');
     if(!/^ppt\/media\/[^/]+\.(png|jpe?g)$/i.test(name))continue;
     const bytes=files.get(name);if(!bytes)continue;size+=bytes.length;if(size>4*1024*1024||images.length>=8)fail('BAD_FILE');
     let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
     images.push({page_num,mimeType:/\.png$/i.test(name)?'image/png':'image/jpeg',data:btoa(binary)});
    }
    return {__mcpImages:true,images,notice:'PPTX 슬라이드에 포함된 원본 그림입니다. 전체 슬라이드 렌더링은 아닙니다. get_course_original_text의 해당 슬라이드 원문도 읽고, 미지원 도형·수식·배치는 unresolved에 남기세요.'};
   }
   const stored=await one("SELECT storage_key,mime_type FROM course_material_page_images WHERE material_id=? AND page_num=?",material_id,page_num);
   const page=stored||(page_num===1&&['image/jpeg','image/png'].includes(m.mime_type)
     ?{storage_key:m.storage_key,mime_type:m.mime_type}:null);
   if(!page?.storage_key)fail('NOT_FOUND');
   const f=await bucket.get(page.storage_key);if(!f)fail('NOT_FOUND');
   const bytes=new Uint8Array(await new Response(f.body).arrayBuffer());
   if(bytes.length>4*1024*1024)fail('BAD_FILE');
   let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
   return {__mcpImage:true,mimeType:page.mime_type,data:btoa(binary)};
  },
  async getPageImages(user,{material_id,start_page=1,count=5}={}){
   const m=await source(user,material_id);
   if(!Number.isInteger(start_page)||start_page<1||!Number.isInteger(count)||count<1||count>8||start_page+count-1>m.page_count)fail('BAD_REQUEST');
   const images=[];
   for(let number=start_page;number<start_page+count;number++){
    const image=await this.getPageImage(user,{material_id,page_num:number});
    if(image.__mcpImages){images.push(...image.images);continue;}
    images.push({page_num:number,mimeType:image.mimeType,data:image.data});
   }
   return {__mcpImages:true,material_id,images};
  },
  async getOriginalText(user,{material_id,page_num=1,offset=0,limit=16000}={}){
   const m=await source(user,material_id);
   if(!Number.isInteger(page_num)||page_num<1||page_num>m.page_count||!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>40000)fail('BAD_REQUEST');
   const page=m.mime_type==='application/pdf'
     ?await one("SELECT extracted_text FROM course_material_page_images WHERE material_id=? AND page_num=?",material_id,page_num):null;
   let original=m.mime_type==='application/pdf'?(page?.extracted_text||''):await originalContent(m);
   if(m.mime_type.endsWith('presentationml.presentation'))original=JSON.parse(original)[page_num-1]?.text||'';
   const chunk=original.slice(offset,offset+limit),next_offset=offset+chunk.length<original.length?offset+chunk.length:null;
   return {id:m.id,title:m.title,mime_type:m.mime_type,provenance:m.provenance,page_count:m.page_count,
    page_num,original_text:m.mime_type==='application/pdf'?null:chunk,
    pages:m.mime_type==='application/pdf'?[{page_num,extracted_text:chunk}]:[],limitations:m.mime_type.endsWith('presentationml.presentation')?['슬라이드 원문 텍스트와 삽입 그림을 제공합니다. 전체 배치·도형·수식의 렌더링 검증은 별도 PDF가 필요하며 확인하지 못한 부분은 unresolved에 저장하세요.']:[],total_chars:original.length,next_offset,review_status:m.review_status};
  },
  async saveReview(user,{material_id,page_num,raw_text,corrected_text,evidence_ids=[],unresolved=[]}={}){
   const m=await source(user,material_id,true);
   if(!Number.isInteger(page_num)||page_num<1||page_num>m.page_count||!Array.isArray(evidence_ids)||evidence_ids.length>30||!Array.isArray(unresolved)||unresolved.length>60)fail('BAD_REQUEST');
   if(unresolved.some(x=>typeof x!=='string'||!x.trim()||x.length>500))fail('BAD_REQUEST');
   if(m.mime_type==='application/pdf'&&!await one("SELECT page_num FROM course_material_page_images WHERE material_id=? AND page_num=?",m.id,page_num))fail('REVIEW_INCOMPLETE');
   for(const id of evidence_ids){const ref=await source(user,id);if(ref.course_id!==m.course_id)fail('FORBIDDEN')}
   await q("INSERT INTO course_material_pages(material_id,page_num,raw_text,corrected_text,evidence_json,unresolved_json) VALUES(?,?,?,?,?,?) ON CONFLICT(material_id,page_num) DO UPDATE SET raw_text=excluded.raw_text,corrected_text=excluded.corrected_text,evidence_json=excluded.evidence_json,unresolved_json=excluded.unresolved_json",
      material_id,page_num,clean(raw_text,100000),clean(corrected_text,100000),JSON.stringify(evidence_ids),JSON.stringify(unresolved)).run();
   const summary=await reviewSummary(m);
   await q("UPDATE course_materials SET review_status=? WHERE id=?",summary.review_status,m.id).run();
   return {id:m.id,page_num,page_review_status:unresolved.length?'needs_review':'reviewed',...summary};
  },
  async finalizeReview(user,{material_id,page_count}={}){
   const m=await source(user,material_id,true);
   if(!Number.isInteger(page_count)||page_count<1||page_count>1000)fail('BAD_REQUEST');
   // Compatibility for older HTTP clients; review saves already make material usable.
   const summary=await reviewSummary(m);
   if(m.page_count!==page_count||!summary.available_for_generation)fail('REVIEW_INCOMPLETE');
   return {id:material_id,...summary};
  },
  async verifiedText(user,{material_id,page_num=1,offset=0,limit=16000}={}){
   const m=await source(user,material_id);
   if(useOriginal(m))return this.generationSource(user,{material_id,page_num,offset,limit});
   if(!Number.isInteger(page_num)||page_num<1||page_num>m.page_count||!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>40000)fail('BAD_REQUEST');
   const page=await one("SELECT corrected_text,evidence_json,unresolved_json FROM course_material_pages WHERE material_id=? AND page_num=?",material_id,page_num);
   if(!page)fail('REVIEW_INCOMPLETE');
   const text=page.corrected_text,chunk=text.slice(offset,offset+limit);
   return {material_id,title:m.title,provenance:'corrected_ocr_or_transcript_only',page_count:m.page_count,
    pages:[{page_num,corrected_text:chunk,evidence_ids:JSON.parse(page.evidence_json||'[]'),unresolved:JSON.parse(page.unresolved_json||'[]')}],
    ...await reviewSummary(m),total_chars:text.length,next_offset:offset+chunk.length<text.length?offset+chunk.length:null};
  },
  async generationSource(user,{material_id,page_num=1,offset=0,limit=16000,use_original=false,expected_revision}={}){
   const m=await source(user,material_id);
   if(typeof use_original!=='boolean'||use_original)fail('BAD_REQUEST');
   if(expected_revision!==undefined&&(!Number.isInteger(expected_revision)||m.revision!==expected_revision))fail('REVISION_CONFLICT');
   if(useOriginal(m)){
    if(!DIRECT.has(m.mime_type)||(!useOriginal(m)&&m.source_type!=='transcript'))fail('BAD_REQUEST');
    const text=await this.getOriginalText(user,{material_id,page_num,offset,limit});
    return {...text,revision:m.revision,provenance:m.source_type.startsWith('generated_')?'gpt_generated_reference':'uncorrected_original',used_original:!m.source_type.startsWith('generated_'),review_concerns:await sourceConcerns(user,[material_id])};
   }
   return {...await this.verifiedText(user,{material_id,page_num,offset,limit}),used_original:false};
  },
  async search(user,{course_id,query}={}){
   await access(user,course_id);
   const term=clean(query,180),pattern='%'+term.replace(/[\\%_]/g,x=>'\\'+x)+'%';
   const rows=await all("SELECT p.material_id AS source_id,m.title AS source_title,p.page_num,substr(p.corrected_text,max(1,instr(lower(p.corrected_text),lower(?))-100),1400) AS content,p.unresolved_json,p.evidence_json,m.created_at AS sort_time FROM course_material_pages p JOIN course_materials m ON m.id=p.material_id WHERE m.course_id=? AND m.review_status<>'deletion_pending' AND p.corrected_text LIKE ? ESCAPE '\\' UNION ALL SELECT id,title,1,substr(original_text,max(1,instr(lower(original_text),lower(?))-100),1400),'[]','[]',created_at FROM course_materials WHERE course_id=? AND source_type<>'transcript' AND mime_type IN ('text/plain','text/markdown','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/x-hwp','application/vnd.hancom.hwpx') AND review_status<>'deletion_pending' AND original_text LIKE ? ESCAPE '\\' ORDER BY sort_time DESC,page_num LIMIT 30",term,course_id,pattern,term,course_id,pattern);
   return rows.map(({unresolved_json,evidence_json,sort_time,...row})=>({...row,unresolved:JSON.parse(unresolved_json||'[]'),evidence_ids:JSON.parse(evidence_json||'[]')}));
  },
  async listNotes(user,{course_id}={}){await access(user,course_id);return all("SELECT id,title,type,revision,updated_at FROM course_documents WHERE course_id=? AND NOT EXISTS(SELECT 1 FROM course_generation_jobs j WHERE j.document_id=course_documents.id AND j.mode IN ('exam_paper','calculator')) ORDER BY updated_at DESC",course_id)},
  async getNote(user,{id}={}){return note(user,id)},
  async listNoteVersions(user,{id}={}){
   await note(user,id);
   return all("SELECT revision,title,created_at FROM course_document_versions WHERE document_id=? ORDER BY revision DESC LIMIT 100",id);
  },
  async getNoteVersion(user,{id,revision}={}){
   await note(user,id);
   if(!Number.isInteger(revision)||revision<1)fail('BAD_REQUEST');
   const row=await one("SELECT revision,title,content_markdown,created_at FROM course_document_versions WHERE document_id=? AND revision=?",id,revision);
   if(!row)fail('NOT_FOUND');return row;
  },
  async saveNote(user,{course_id,id,type='study_note',title,content_markdown='',expected_revision,request_id}={}){
   await access(user,course_id,true);
   if(!['study_note','exam_cram'].includes(type)||typeof content_markdown!=='string'||content_markdown.length>950000)fail('BAD_REQUEST');
   const t=clean(title,300);
   if(!id){
    if(request_id!==undefined&&(typeof request_id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request_id)))fail('BAD_REQUEST');
    const newId=request_id||uid();
    try{await db.batch([
      q("INSERT INTO course_documents(id,course_id,type,title,content_markdown) VALUES(?,?,?,?,?)",newId,course_id,type,t,content_markdown),
      q("INSERT INTO course_document_versions(document_id,revision,title,content_markdown) VALUES(?,1,?,?)",newId,t,content_markdown)
    ]);}catch(e){
      if(!request_id)throw e;
      const existing=await one("SELECT course_id,type,title,content_markdown,revision FROM course_documents WHERE id=?",newId);
      if(existing?.course_id===course_id&&existing.type===type&&existing.title===t&&existing.content_markdown===content_markdown&&existing.revision===1)return {id:newId,revision:1,reused:true};
      fail('REVISION_CONFLICT');
    }
    return {id:newId,revision:1};
   }
   const prev=await note(user,id,true);if(prev.course_id!==course_id)fail('FORBIDDEN');
   if(expected_revision!==prev.revision)fail('REVISION_CONFLICT');
   let updated;
   try{[updated]=await db.batch([
      q("UPDATE course_documents SET title=?,content_markdown=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND revision=?",t,content_markdown,id,expected_revision),
      q("INSERT INTO course_document_versions(document_id,revision,title,content_markdown) SELECT id,revision,title,content_markdown FROM course_documents WHERE id=? AND revision=?",id,expected_revision+1)
   ]);}catch{fail('REVISION_CONFLICT')}
   if(updated.meta.changes!==1)fail('REVISION_CONFLICT');return {id,revision:prev.revision+1};
  },
  async listPacks(user,{course_id}={}){await access(user,course_id);return all("SELECT id,title,created_at FROM course_problem_packs WHERE course_id=? ORDER BY created_at DESC",course_id)},
  async getPack(user,{id}={}){const p=await one("SELECT * FROM course_problem_packs WHERE id=?",id);if(!p)fail('NOT_FOUND');await access(user,p.course_id);return {id:p.id,title:p.title,pack:JSON.parse(p.pack_json)}},
  async savePack(user,{course_id,title,pack,job_id=pack?.generation_job_id}={}){
   await access(user,course_id,true);
   if(!pack||typeof pack!=='object'||!Array.isArray(pack.questions)||!pack.questions.length||pack.questions.length>500||pack.questions.some(x=>!x||typeof x.id!=='string'||!x.id.trim()||typeof x.promptMd!=='string'||!x.promptMd.trim()||x.answer===undefined||x.answer===null||!x.solution)||new Set(pack.questions.map(x=>x.id)).size!==pack.questions.length)fail('BAD_REQUEST');
   const run=job_id?await job(user,job_id):null;
   if(run&&(run.course_id!==course_id||run.mode!=='exam_paper'||!JSON.parse(run.outline_json||'[]').length))fail('BAD_REQUEST');
   const id=run?.id||uid(),name=clean(title,200),payload=JSON.stringify(pack);
   const prev=await one("SELECT pack_json FROM course_problem_packs WHERE id=?",id);
   if(prev&&prev.pack_json!==payload)fail('REVISION_CONFLICT');
   const statements=[q("INSERT OR IGNORE INTO course_problem_packs(id,course_id,title,pack_json) VALUES(?,?,?,?)",id,course_id,name,payload)];
   if(run)statements.push(q("UPDATE course_generation_jobs SET document_id=NULL,status='complete' WHERE id=?",id),q("DELETE FROM course_documents WHERE id=?",run.document_id||id));
   await db.batch(statements);return {id,job_id:run?.id,status:'complete',output_type:'problem_pack'};
  },
  async getAttempt(user,{pack_id,question_id}={}){await this.getPack(user,{id:pack_id});return one("SELECT data_json FROM course_attempts WHERE user_id=? AND pack_id=? AND question_id=?",user,pack_id,question_id)},
  async listAttempts(user,{pack_id}={}){await this.getPack(user,{id:pack_id});return all("SELECT question_id,data_json,revision,updated_at FROM course_attempts WHERE user_id=? AND pack_id=? ORDER BY updated_at DESC",user,pack_id)},
  async saveAttempt(user,{pack_id,question_id,expected_revision=0,answer='',strokes=[],result='',bookmarked=false}={}){
   const p=await this.getPack(user,{id:pack_id});const qid=clean(question_id,200);
   if(!p.pack.questions.some(x=>String(x.id)===qid))fail('BAD_REQUEST');
   if(!Array.isArray(strokes)||strokes.length>5000||JSON.stringify(strokes).length>350000||typeof answer!=='string'||answer.length>15000)fail('BAD_REQUEST');
   const val=JSON.stringify({answer,strokes,result,bookmarked:!!bookmarked});
   if(!Number.isInteger(expected_revision)||expected_revision<0)fail('BAD_REQUEST');
   let updated;
   if(expected_revision===0)updated=await q("INSERT OR IGNORE INTO course_attempts(user_id,pack_id,question_id,data_json,revision) VALUES(?,?,?,?,1)",user,pack_id,qid,val).run();
   else updated=await q("UPDATE course_attempts SET data_json=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND pack_id=? AND question_id=? AND revision=?",val,user,pack_id,qid,expected_revision).run();
   if(updated.meta.changes!==1)fail('REVISION_CONFLICT');
   return {saved:true,revision:expected_revision+1};
  },
  async listCasio(user,{course_id}={}){await access(user,course_id);return all("SELECT id,title,updated_at FROM course_casio_projects WHERE course_id=? ORDER BY updated_at DESC",course_id)},
  async getCasio(user,{id}={}){const c=await one("SELECT * FROM course_casio_projects WHERE id=?",id);if(!c)fail('NOT_FOUND');await access(user,c.course_id);return c},
  async saveCasio(user,{course_id,id,job_id,title,blueprint_json='{}',program_text='',manual_text=''}={}){
   await access(user,course_id,true);const name=clean(title,200);
   if(typeof blueprint_json!=='string'||blueprint_json.length>300000||typeof program_text!=='string'||program_text.length>300000||typeof manual_text!=='string'||manual_text.length>300000)fail('BAD_REQUEST');
   try{JSON.parse(blueprint_json)}catch{fail('BAD_REQUEST')}
   if(job_id){
    const run=await job(user,job_id);
    if(run.course_id!==course_id||run.mode!=='calculator'||!JSON.parse(run.outline_json||'[]').length||!program_text.trim())fail('BAD_REQUEST');
    const prev=await one("SELECT * FROM course_casio_projects WHERE id=?",job_id);
    if(prev&&(prev.program_text!==program_text||prev.blueprint_json!==blueprint_json||prev.manual_text!==manual_text))fail('REVISION_CONFLICT');
    await db.batch([q("INSERT OR IGNORE INTO course_casio_projects(id,course_id,title,blueprint_json,program_text,manual_text) VALUES(?,?,?,?,?,?)",job_id,course_id,name,blueprint_json,program_text,manual_text),q("UPDATE course_generation_jobs SET document_id=NULL,status='complete' WHERE id=?",job_id),q("DELETE FROM course_documents WHERE id=?",run.document_id||job_id)]);
    return {id:job_id,job_id,status:'complete',output_type:'casio'};
   }
   if(id){const prev=await this.getCasio(user,{id});if(prev.course_id!==course_id)fail('FORBIDDEN');await q("UPDATE course_casio_projects SET title=?,blueprint_json=?,program_text=?,manual_text=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",name,blueprint_json,program_text,manual_text,id).run();return {id}}
   const key=uid();await q("INSERT INTO course_casio_projects(id,course_id,title,blueprint_json,program_text,manual_text) VALUES(?,?,?,?,?,?)",key,course_id,name,blueprint_json,program_text,manual_text).run();return {id:key};
  },
  async startJob(user,{course_id,mode,scope='전체',source_ids=[],original_source_ids=[],additional_requests=''}={}){
   await access(user,course_id,true);
   if(!['outline','detailed_note','subnote','exam_paper','exam_cram','exam_trends','transcript_fix','errors','calculator'].includes(mode)||!Array.isArray(source_ids)||!source_ids.length||source_ids.length>80||source_ids.length!==new Set(source_ids).size)fail('BAD_REQUEST');
   const document_revisions={};
   for(const id of source_ids){const s=await source(user,id);if(s.course_id!==course_id)fail('FORBIDDEN');if(s.source_type.startsWith('generated_'))document_revisions[id]=s.revision;}
   if(!Array.isArray(original_source_ids)||original_source_ids.length>80||new Set(original_source_ids).size!==original_source_ids.length||original_source_ids.some(id=>!source_ids.includes(id))||typeof additional_requests!=='string'||additional_requests.length>4000)fail('BAD_REQUEST');
   if(original_source_ids.length)fail('BAD_REQUEST');
   const review_concerns=await sourceConcerns(user,source_ids);
   const options={document_revisions,additional_requests:additional_requests.trim()};
   const id=uid();await q("INSERT INTO course_generation_jobs(id,course_id,user_id,mode,scope,source_ids_json,generation_options_json,status) VALUES(?,?,?,?,?,?,?,'awaiting_outline')",id,course_id,user,mode,String(scope).slice(0,300),JSON.stringify(source_ids),JSON.stringify(options)).run();return {id,status:'awaiting_outline',review_concerns,...options};
  },
  async saveOutline(user,{job_id,sections=[]}={}){
   const run=await job(user,job_id);
   if(run.status!=='awaiting_outline'||!Array.isArray(sections)||!sections.length||sections.length>80||sections.some(x=>!x||typeof x.title!=='string'||!x.title.trim()||x.title.length>200))fail('BAD_REQUEST');
   const outline=sections.map((x,i)=>({index:i+1,title:x.title.trim()}));
   if(['exam_paper','calculator'].includes(run.mode)){
    await q("UPDATE course_generation_jobs SET status='outlined',outline_json=? WHERE id=? AND status='awaiting_outline'",JSON.stringify(outline),job_id).run();
    return {job_id,status:'outlined',output_type:run.mode==='exam_paper'?'problem_pack':'casio'};
   }
   const markdown=await reviewNotice(user,run)+outline.map(x=>'## '+x.title+'\n\n[작성 중]').join('\n\n');
   const [,updated]=await db.batch([
    q("INSERT OR IGNORE INTO course_documents(id,course_id,type,title,content_markdown) SELECT id,course_id,'study_note',mode||' · '||scope,? FROM course_generation_jobs WHERE id=? AND status='awaiting_outline'",markdown,job_id),
    q("UPDATE course_generation_jobs SET status='outlined',outline_json=?,document_id=id,document_revision=1 WHERE id=? AND status='awaiting_outline'",JSON.stringify(outline),job_id),
    q("INSERT OR IGNORE INTO course_document_versions(document_id,revision,title,content_markdown) SELECT id,revision,title,content_markdown FROM course_documents WHERE id=?",job_id)
   ]);
   if(updated.meta.changes!==1)fail('REVISION_CONFLICT');
   return {job_id,status:'outlined',document_id:job_id};
  },
  async savePart(user,{job_id,section_index,content_markdown}={}){
   const run=await job(user,job_id),outline=JSON.parse(run.outline_json||'[]');
   if(run.status==='awaiting_outline'||!outline.length)fail('OUTLINE_REQUIRED');
   if(!Number.isInteger(section_index)||section_index<1||section_index>outline.length)fail('BAD_REQUEST');
   if(['exam_paper','calculator'].includes(run.mode)){
    const body=clean(content_markdown,200000);
    await q("INSERT OR IGNORE INTO course_generation_parts(job_id,section_index,content_markdown) VALUES(?,?,?)",job_id,section_index,body).run();
    const stored=await one("SELECT content_markdown FROM course_generation_parts WHERE job_id=? AND section_index=?",job_id,section_index);
    if(stored.content_markdown!==body)fail('REVISION_CONFLICT');
    if(run.status!=='complete')await q("UPDATE course_generation_jobs SET status='awaiting_artifact' WHERE id=?",job_id).run();
    return {job_id,status:run.status==='complete'?'complete':'awaiting_artifact',next_tool:run.mode==='exam_paper'?'save_course_problem_pack':'save_course_casio_project'};
   }
   if(run.document_id){
    const current=await one("SELECT revision FROM course_documents WHERE id=?",run.document_id);
    if(!current||current.revision!==run.document_revision)fail('REVISION_CONFLICT');
   }
   const body=clean(content_markdown,200000);
   await q("INSERT OR IGNORE INTO course_generation_parts(job_id,section_index,content_markdown) VALUES(?,?,?)",job_id,section_index,body).run();
   const stored=await one("SELECT content_markdown FROM course_generation_parts WHERE job_id=? AND section_index=?",job_id,section_index);
   if(stored?.content_markdown!==body)fail('REVISION_CONFLICT');
   const doc=run.document_id||run.id;
   // Older jobs can have an outline without a document. Reuse their stable job ID.
   await q("INSERT OR IGNORE INTO course_documents(id,course_id,type,title,content_markdown) VALUES(?,?,?,?,?)",doc,run.course_id,'study_note',run.mode+' · '+run.scope,'').run();
   if(!run.document_id)await db.batch([
    q("UPDATE course_generation_jobs SET document_id=?,document_revision=1 WHERE id=? AND document_id IS NULL",doc,job_id),
    q("INSERT OR IGNORE INTO course_document_versions(document_id,revision,title,content_markdown) SELECT id,revision,title,content_markdown FROM course_documents WHERE id=?",doc)
   ]);
   for(let retry=0;retry<5;retry++){
    const parts=await all("SELECT section_index,content_markdown FROM course_generation_parts WHERE job_id=? ORDER BY section_index",job_id);
    const content=new Map(parts.map(p=>[p.section_index,p.content_markdown]));
    const markdown=await reviewNotice(user,run)+outline.map(p=>'## '+p.title+'\n\n'+(content.get(p.index)||'[작성 중]')).join('\n\n');
    const current=await one("SELECT revision,title,content_markdown FROM course_documents WHERE id=?",doc);
    if(!current)fail('NOT_FOUND');
    const fresh=await job(user,job_id);
    if(current.revision!==fresh.document_revision){if(retry<4)continue;fail('REVISION_CONFLICT');}
    if(current.content_markdown!==markdown){
     const [updated,claimed]=await db.batch([
      q("UPDATE course_documents SET content_markdown=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND revision=?",markdown,doc,current.revision),
      q("UPDATE course_generation_jobs SET document_revision=document_revision+1 WHERE id=? AND document_revision=?",job_id,current.revision),
      q("INSERT OR IGNORE INTO course_document_versions(document_id,revision,title,content_markdown) SELECT id,revision,title,content_markdown FROM course_documents WHERE id=? AND revision=?",doc,current.revision+1)
     ]);
     if(updated.meta.changes!==1||claimed.meta.changes!==1)continue;
    }
    await q("UPDATE course_generation_jobs SET document_id=?,status=CASE WHEN (SELECT count(*) FROM course_generation_parts WHERE job_id=?)=json_array_length(outline_json) THEN 'complete' ELSE 'generating' END WHERE id=?",doc,job_id,job_id).run();
    const progress=await this.getJobProgress(user,{job_id});
    return {document_id:doc,status:progress.status,saved_parts:progress.saved_parts.length,autosaved:true};
   }
   fail('REVISION_CONFLICT');
  },
  async listJobs(user,{course_id}={}){
   await access(user,course_id);
   return all("SELECT id,mode,scope,CASE WHEN status='complete' AND ((mode='exam_paper' AND NOT EXISTS(SELECT 1 FROM course_problem_packs p WHERE p.id=course_generation_jobs.id)) OR (mode='calculator' AND NOT EXISTS(SELECT 1 FROM course_casio_projects p WHERE p.id=course_generation_jobs.id))) THEN 'awaiting_artifact' ELSE status END AS status,document_id FROM course_generation_jobs WHERE course_id=? AND user_id=? ORDER BY rowid DESC LIMIT 100",course_id,user);
  },
  async getJobProgress(user,{job_id}={}){
   const j=await job(user,job_id);
   const parts=await all("SELECT section_index FROM course_generation_parts WHERE job_id=? ORDER BY section_index",job_id);
   const specialized=['exam_paper','calculator'].includes(j.mode);
   const artifact=specialized?await one(j.mode==='exam_paper'?"SELECT id FROM course_problem_packs WHERE id=?":"SELECT id FROM course_casio_projects WHERE id=?",j.id):null;
   const status=specialized&&j.status==='complete'&&!artifact?'awaiting_artifact':j.status;
   return {job_id:j.id,course_id:j.course_id,mode:j.mode,scope:j.scope,status,document_id:j.document_id,output_type:j.mode==='exam_paper'?'problem_pack':j.mode==='calculator'?'casio':'study_note',output_id:artifact?.id||null,
    source_ids:JSON.parse(j.source_ids_json),...JSON.parse(j.generation_options_json||'{}'),original_source_ids:[],review_concerns:await sourceConcerns(user,JSON.parse(j.source_ids_json),[],JSON.parse(j.generation_options_json||'{}').document_revisions||{}),outline:JSON.parse(j.outline_json),saved_parts:parts.map(x=>x.section_index)};
  },
  async getJob(user,{id}={}){return this.getJobProgress(user,{job_id:id})},
  async getFile(user,{id}={}){const s=await source(user,id);if(!s.storage_key||!bucket?.get)fail('NOT_FOUND');const file=await bucket.get(s.storage_key);if(!file)fail('NOT_FOUND');return new Response(file.body,{headers:{'content-type':s.mime_type,'content-disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(s.original_filename),'cache-control':'no-store'}})}
 };
}
const json=(obj,status=200)=>new Response(JSON.stringify(obj),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
export async function handleCourseRequest(request,{db,bucket,userId}){
 const repo=createCourseLibrary(db,bucket),url=new URL(request.url),p=url.pathname,method=request.method;
 try{
   const get={'/api/v2/materials':['listMaterials',{course_id:url.searchParams.get('course_id'),type:url.searchParams.get('type')||'all'}],
     '/api/v2/search':['search',{course_id:url.searchParams.get('course_id'),query:url.searchParams.get('query')}],'/api/v2/notes':['listNotes',{course_id:url.searchParams.get('course_id')}],'/api/v2/note':['getNote',{id:url.searchParams.get('id')}],
     '/api/v2/note-versions':['listNoteVersions',{id:url.searchParams.get('id')}],
     '/api/v2/note-version':['getNoteVersion',{id:url.searchParams.get('id'),revision:Number(url.searchParams.get('revision'))}],
     '/api/v2/packs':['listPacks',{course_id:url.searchParams.get('course_id')}],'/api/v2/pack':['getPack',{id:url.searchParams.get('id')}],
     '/api/v2/attempt':['getAttempt',{pack_id:url.searchParams.get('pack_id'),question_id:url.searchParams.get('question_id')}],
     '/api/v2/attempts':['listAttempts',{pack_id:url.searchParams.get('pack_id')}],
     '/api/v2/page-status':['pageStatus',{material_id:url.searchParams.get('id')}],
     '/api/v2/casio':['listCasio',{course_id:url.searchParams.get('course_id')}],'/api/v2/casio-item':['getCasio',{id:url.searchParams.get('id')}],
     '/api/v2/reviewed':['verifiedText',{material_id:url.searchParams.get('id')}],'/api/v2/original':['getOriginalText',{material_id:url.searchParams.get('id')}],
     '/api/v2/jobs':['listJobs',{course_id:url.searchParams.get('course_id')}],
     '/api/v2/job':['getJob',{id:url.searchParams.get('id')}]};
   if(method==='GET'&&get[p])return json(await repo[get[p][0]](userId,get[p][1]));
   if(method==='GET'&&p.startsWith('/api/v2/file/'))return repo.getFile(userId,{id:p.slice('/api/v2/file/'.length)});
   if(method==='DELETE'&&p.startsWith('/api/v2/material/'))return json(await repo.deleteMaterial(userId,{id:p.slice('/api/v2/material/'.length)}));
   if(method==='DELETE'&&p.startsWith('/api/v2/course/'))return json(await repo.deleteCourse(userId,{id:p.slice('/api/v2/course/'.length)}));
   if(method==='POST'&&p==='/api/v2/page-image'){
     return json(await repo.uploadPageImage(userId,{material_id:request.headers.get('x-material-id'),
       page_num:Number(request.headers.get('x-page-num')),mime_type:request.headers.get('content-type'),
       bytes:await read(request,1024*1024)}),201);
   }
   if(method==='POST'&&p==='/api/v2/upload'){
     let weeks;try{weeks=JSON.parse(request.headers.get('x-weeks')||'[]')}catch{fail('BAD_REQUEST')}
     const year=request.headers.get('x-exam-year');
     return json(await repo.upload(userId,{course_id:request.headers.get('x-course-id'),source_type:request.headers.get('x-source-type'),
       title:decodeURIComponent(request.headers.get('x-title')||''),filename:decodeURIComponent(request.headers.get('x-filename')||''),
       provenance:decodeURIComponent(request.headers.get('x-provenance')||''),
       weeks,exam_year:year?Number(year):null,buffer:await read(request,MAX_COURSE_UPLOAD_BYTES)}),201);
   }
   const post={'/api/v2/text':'registerText','/api/v2/pdf-pages':'setPdfPageCount','/api/v2/page-text':'savePageText',
     '/api/v2/review':'saveReview','/api/v2/finalize':'finalizeReview',
     '/api/v2/note':'saveNote','/api/v2/pack':'savePack','/api/v2/attempt':'saveAttempt','/api/v2/casio':'saveCasio',
     '/api/v2/job':'startJob','/api/v2/outline':'saveOutline','/api/v2/part':'savePart'};
   if(method==='POST'&&post[p]){
     if(!request.headers.get('content-type')?.startsWith('application/json'))fail('BAD_REQUEST');
     let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await read(request,1024*1024)))}catch{fail('BAD_REQUEST')}
     return json(await repo[post[p]](userId,body),201);
   }
   return json({error:'NOT_FOUND'},404);
 }catch(e){
   const status={BAD_REQUEST:400,BAD_FILE:400,FILE_TOO_LARGE:413,FORBIDDEN:403,NOT_FOUND:404,REVISION_CONFLICT:409,REVIEW_INCOMPLETE:422,OUTLINE_REQUIRED:422,STORAGE_NOT_CONFIGURED:503,STORAGE_DELETE_FAILED:503}[e?.code]||500;
   return json({error:status===500?'Request failed':e.code},status);
 }
}
