/** v0.9 course-only library. Source metadata is author-entered, not inferred.
 * OCR inference is performed by ChatGPT via tools, not a paid server-side model.
 */
const fail=(code)=>{const e=new Error(code);e.code=code;throw e;};
const uid=()=>crypto.randomUUID();
const clean=(value,max)=>{if(typeof value!=='string'||!value.trim()||value.length>max)fail('BAD_REQUEST');return value.trim();};
const TYPES=new Set(['lecture_slides','transcript','textbook','past_exam','other']);
const FILE_TYPES={'.txt':'text/plain','.md':'text/markdown','.pdf':'application/pdf','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','.pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation'};
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
 const length=Number(request.headers.get('content-length')||0);if(length>max)fail('BAD_FILE');
 const reader=request.body?.getReader();if(!reader)fail('BAD_FILE');const chunks=[];let n=0;
 try{while(true){const x=await reader.read();if(x.done)break;n+=x.value.byteLength;if(n>max)fail('BAD_FILE');chunks.push(x.value)}}finally{reader.releaseLock()}
 if(!n)fail('BAD_FILE');const buf=new Uint8Array(n);let offset=0;for(const c of chunks){buf.set(c,offset);offset+=c.length}return buf;
}
export function createCourseLibrary(db,bucket){
 if(!db?.prepare||!db?.batch)throw Error('D1 binding required');
 const q=(sql,...args)=>db.prepare(sql).bind(...args);
 const one=(sql,...args)=>q(sql,...args).first();
 const all=async(sql,...args)=>(await q(sql,...args).all()).results||[];
 async function access(user,course_id,write=false){
  if(!user||!course_id)fail('FORBIDDEN');
  const row=await one("SELECT c.id,c.owner_user_id,m.role FROM courses c LEFT JOIN course_members m ON m.course_id=c.id AND m.user_id=? WHERE c.id=? AND (c.owner_user_id=? OR m.user_id=?)",user,course_id,user,user);
  if(!row)fail('NOT_FOUND');
  if(write&&row.owner_user_id!==user&&!['owner','editor'].includes(row.role))fail('FORBIDDEN');
  return row;
 }
 async function source(user,id,write=false){
  const row=await one("SELECT * FROM course_materials WHERE id=?",id);
  if(!row)fail('NOT_FOUND');await access(user,row.course_id,write);return row;
 }
 async function note(user,id,write=false){
  const row=await one("SELECT * FROM course_documents WHERE id=?",id);
  if(!row)fail('NOT_FOUND');await access(user,row.course_id,write);return row;
 }
 async function job(user,id){
  const row=await one("SELECT * FROM course_generation_jobs WHERE id=?",id);
  if(!row)fail('NOT_FOUND');await access(user,row.course_id,true);if(row.user_id!==user)fail('FORBIDDEN');return row;
 }
 return {
  async listMaterials(user,{course_id,type='all'}={}){
   await access(user,course_id);
   const rows=await all("SELECT id,course_id,title,source_type,weeks_json,exam_year,original_filename AS file_name,mime_type,provenance,review_status,page_count,created_at,(SELECT count(*) FROM course_material_page_images p WHERE p.material_id=course_materials.id) AS prepared_pages FROM course_materials WHERE course_id=? ORDER BY created_at DESC,id DESC LIMIT 400",course_id);
   return rows.map(({weeks_json,...r})=>({...r,weeks:JSON.parse(weeks_json||'[]'),extract_status:r.review_status==='reviewed'?'ready':'pending'})).filter(r=>type==='all'||r.source_type===type);
  },
  async upload(user,{course_id,title,source_type,weeks=[],exam_year=null,filename,provenance='',buffer}={}){
   await access(user,course_id,true);
   const data=buffer;if(!(data instanceof Uint8Array)||data.length<4||data.length>8*1024*1024)fail('BAD_FILE');
   const meta=metadata(source_type,weeks,exam_year),name=clean(title,200),file=clean(filename,250);
   if(typeof provenance!=='string'||provenance.length>400)fail('BAD_REQUEST');
   const extension=/\.[^.]+$/.exec(file.toLowerCase())?.[0],mime=FILE_TYPES[extension];
   if(!mime)fail('BAD_FILE');
   if(extension==='.pdf'&&new TextDecoder().decode(data.subarray(0,5))!=='%PDF-')fail('BAD_FILE');
   if(['.png'].includes(extension)&&!(data[0]===137&&data[1]===80&&data[2]===78&&data[3]===71))fail('BAD_FILE');
   if(['.jpg','.jpeg'].includes(extension)&&!(data[0]===255&&data[1]===216&&data[2]===255))fail('BAD_FILE');
   if(['.docx','.pptx'].includes(extension)&&!(data[0]===80&&data[1]===75))fail('BAD_FILE');
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
     const originalText=['text/plain','text/markdown'].includes(mime)?new TextDecoder('utf-8',{fatal:true}).decode(data):null;
     await q("INSERT INTO course_materials(id,course_id,title,source_type,weeks_json,exam_year,original_filename,mime_type,provenance,storage_key,sha256,original_text,review_status,page_count) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'pending_review',?)",
       id,course_id,name,source_type,JSON.stringify(meta.weeks),meta.examYear,file,mime,provenance.trim(),key,hash,originalText,mime==='application/pdf'?0:1).run();
   }catch(e){await bucket.delete(key).catch(()=>{});throw e}
   return {id,review_status:'pending_review'};
  },
  async registerText(user,{course_id,title,source_type='transcript',weeks=[],exam_year=null,provenance='',content}={}){
   await access(user,course_id,true);
   if(typeof provenance!=='string'||provenance.length>400)fail('BAD_REQUEST');
   const meta=metadata(source_type,weeks,exam_year),value=clean(content,950000),id=uid();
   await q("INSERT INTO course_materials(id,course_id,title,source_type,weeks_json,exam_year,provenance,original_text,mime_type,review_status,page_count) VALUES(?,?,?,?,?,?,?,?,'text/plain','pending_review',1)",
     id,course_id,clean(title,200),source_type,JSON.stringify(meta.weeks),meta.examYear,provenance.trim(),value).run();
   return {id,review_status:'pending_review'};
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
   try{await q("INSERT INTO course_material_page_images(material_id,page_num,storage_key,mime_type) VALUES(?,?,?,?)",material_id,page_num,key,mime_type).run();}
   catch(e){await bucket.delete(key).catch(()=>{});throw e}
   return {material_id,page_num,stored:true};
  },
  async savePageText(user,{material_id,page_num,text}={}){
   const m=await source(user,material_id,true);
   if(m.mime_type!=='application/pdf'||!Number.isInteger(page_num)||page_num<1||page_num>m.page_count||
      typeof text!=='string'||text.length>100000)fail('BAD_REQUEST');
   const updated=await q("UPDATE course_material_page_images SET extracted_text=?,updated_at=CURRENT_TIMESTAMP WHERE material_id=? AND page_num=?",text,page_num,material_id).run();
   if(updated.meta.changes!==1)fail('NOT_FOUND');
   return {material_id,page_num,saved:true};
  },
  async pageStatus(user,{material_id}={}){
   const m=await source(user,material_id);
   const [images,reviews]=await Promise.all([
    all("SELECT page_num FROM course_material_page_images WHERE material_id=? ORDER BY page_num",material_id),
    all("SELECT page_num,unresolved_json FROM course_material_pages WHERE material_id=? ORDER BY page_num",material_id)
   ]);
   return {material_id,page_count:m.page_count,prepared_pages:images.map(x=>x.page_num),
    reviewed_pages:reviews.filter(x=>!JSON.parse(x.unresolved_json||'[]').length).map(x=>x.page_num),
    needs_review_pages:reviews.filter(x=>JSON.parse(x.unresolved_json||'[]').length).map(x=>x.page_num),
    review_status:m.review_status};
  },
  async getPageImage(user,{material_id,page_num=1}={}){
   const m=await source(user,material_id);
   if(!Number.isInteger(page_num)||page_num<1||!bucket?.get)fail('BAD_REQUEST');
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
  async getOriginalText(user,{material_id,page_num=1,offset=0,limit=16000}={}){
   const m=await source(user,material_id);
   if(!Number.isInteger(page_num)||page_num<1||page_num>m.page_count||!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>40000)fail('BAD_REQUEST');
   const page=m.mime_type==='application/pdf'
     ?await one("SELECT extracted_text FROM course_material_page_images WHERE material_id=? AND page_num=?",material_id,page_num):null;
   const original=m.mime_type==='application/pdf'?(page?.extracted_text||''):(m.original_text||'');
   const chunk=original.slice(offset,offset+limit),next_offset=offset+chunk.length<original.length?offset+chunk.length:null;
   return {id:m.id,title:m.title,mime_type:m.mime_type,provenance:m.provenance,page_count:m.page_count,
    page_num,original_text:m.mime_type==='application/pdf'?null:chunk,
    pages:m.mime_type==='application/pdf'?[{page_num,extracted_text:chunk}]:[],total_chars:original.length,next_offset,review_status:m.review_status};
  },
  async saveReview(user,{material_id,page_num,raw_text,corrected_text,evidence_ids=[],unresolved=[]}={}){
   const m=await source(user,material_id,true);
   if(!Number.isInteger(page_num)||page_num<1||page_num>m.page_count||!Array.isArray(evidence_ids)||evidence_ids.length>30||!Array.isArray(unresolved)||unresolved.length>60)fail('BAD_REQUEST');
   if(unresolved.some(x=>typeof x!=='string'||x.length>500))fail('BAD_REQUEST');
   for(const id of evidence_ids){const ref=await source(user,id);if(ref.course_id!==m.course_id)fail('FORBIDDEN')}
   await q("INSERT INTO course_material_pages(material_id,page_num,raw_text,corrected_text,evidence_json,unresolved_json) VALUES(?,?,?,?,?,?) ON CONFLICT(material_id,page_num) DO UPDATE SET raw_text=excluded.raw_text,corrected_text=excluded.corrected_text,evidence_json=excluded.evidence_json,unresolved_json=excluded.unresolved_json",
      material_id,page_num,clean(raw_text,100000),clean(corrected_text,100000),JSON.stringify(evidence_ids),JSON.stringify(unresolved)).run();
   await q("UPDATE course_materials SET review_status='pending_review' WHERE id=?",m.id).run();
   return {id:m.id,page_num,review_status:unresolved.length?'needs_review':'review_recorded'};
  },
  async finalizeReview(user,{material_id,page_count}={}){
   const m=await source(user,material_id,true);
   if(!Number.isInteger(page_count)||page_count<1||page_count>1000)fail('BAD_REQUEST');
   const rows=await all("SELECT page_num,unresolved_json FROM course_material_pages WHERE material_id=? ORDER BY page_num",material_id);
   if(m.page_count!==page_count||rows.length!==page_count||rows.some((x,i)=>x.page_num!==i+1||JSON.parse(x.unresolved_json||'[]').length))fail('REVIEW_INCOMPLETE');
   if(m.mime_type==='application/pdf'){
    const images=await all("SELECT page_num FROM course_material_page_images WHERE material_id=? ORDER BY page_num",material_id);
    if(images.length!==page_count||images.some((x,i)=>x.page_num!==i+1))fail('REVIEW_INCOMPLETE');
   }
   await q("UPDATE course_materials SET review_status='reviewed',page_count=? WHERE id=?",page_count,material_id).run();
   return {id:material_id,review_status:'reviewed'};
  },
  async verifiedText(user,{material_id,page_num=1,offset=0,limit=16000}={}){
   const m=await source(user,material_id);if(m.review_status!=='reviewed')fail('REVIEW_INCOMPLETE');
   if(!Number.isInteger(page_num)||page_num<1||page_num>m.page_count||!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>40000)fail('BAD_REQUEST');
   const page=await one("SELECT corrected_text FROM course_material_pages WHERE material_id=? AND page_num=?",material_id,page_num);
   if(!page)fail('REVIEW_INCOMPLETE');
   const text=page.corrected_text,chunk=text.slice(offset,offset+limit);
   return {material_id,title:m.title,provenance:'corrected_ocr_or_transcript_only',page_count:m.page_count,
    pages:[{page_num,corrected_text:chunk}],total_chars:text.length,next_offset:offset+chunk.length<text.length?offset+chunk.length:null};
  },
  async search(user,{course_id,query}={}){
   await access(user,course_id);
   const term=clean(query,180),pattern='%'+term.replace(/[\\%_]/g,x=>'\\'+x)+'%';
   return all("SELECT p.material_id AS source_id,m.title AS source_title,p.page_num,substr(p.corrected_text,1,1400) AS content FROM course_material_pages p JOIN course_materials m ON m.id=p.material_id WHERE m.course_id=? AND m.review_status='reviewed' AND p.corrected_text LIKE ? ESCAPE '\\' ORDER BY m.created_at DESC,p.page_num LIMIT 30",course_id,pattern);
  },
  async listNotes(user,{course_id}={}){await access(user,course_id);return all("SELECT id,title,type,revision,updated_at FROM course_documents WHERE course_id=? ORDER BY updated_at DESC",course_id)},
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
  async savePack(user,{course_id,title,pack}={}){await access(user,course_id,true);if(!pack||typeof pack!=='object'||!Array.isArray(pack.questions)||pack.questions.length>500)fail('BAD_REQUEST');const id=uid();await q("INSERT INTO course_problem_packs(id,course_id,title,pack_json) VALUES(?,?,?,?)",id,course_id,clean(title,200),JSON.stringify(pack)).run();return {id}},
  async getAttempt(user,{pack_id,question_id}={}){await this.getPack(user,{id:pack_id});return one("SELECT data_json FROM course_attempts WHERE user_id=? AND pack_id=? AND question_id=?",user,pack_id,question_id)},
  async listAttempts(user,{pack_id}={}){await this.getPack(user,{id:pack_id});return all("SELECT question_id,data_json,updated_at FROM course_attempts WHERE user_id=? AND pack_id=? ORDER BY updated_at DESC",user,pack_id)},
  async saveAttempt(user,{pack_id,question_id,answer='',strokes=[],result='',bookmarked=false}={}){
   const p=await this.getPack(user,{id:pack_id});const qid=clean(question_id,200);
   if(!p.pack.questions.some(x=>String(x.id)===qid))fail('BAD_REQUEST');
   if(!Array.isArray(strokes)||strokes.length>5000||JSON.stringify(strokes).length>350000||typeof answer!=='string'||answer.length>15000)fail('BAD_REQUEST');
   const val=JSON.stringify({answer,strokes,result,bookmarked:!!bookmarked});
   await q("INSERT INTO course_attempts(user_id,pack_id,question_id,data_json) VALUES(?,?,?,?) ON CONFLICT(user_id,pack_id,question_id) DO UPDATE SET data_json=excluded.data_json,updated_at=CURRENT_TIMESTAMP",user,pack_id,qid,val).run();return {saved:true};
  },
  async listCasio(user,{course_id}={}){await access(user,course_id);return all("SELECT id,title,updated_at FROM course_casio_projects WHERE course_id=? ORDER BY updated_at DESC",course_id)},
  async getCasio(user,{id}={}){const c=await one("SELECT * FROM course_casio_projects WHERE id=?",id);if(!c)fail('NOT_FOUND');await access(user,c.course_id);return c},
  async saveCasio(user,{course_id,id,title,blueprint_json='{}',program_text='',manual_text=''}={}){
   await access(user,course_id,true);const name=clean(title,200);
   if(typeof blueprint_json!=='string'||blueprint_json.length>300000||typeof program_text!=='string'||program_text.length>300000||typeof manual_text!=='string'||manual_text.length>300000)fail('BAD_REQUEST');
   try{JSON.parse(blueprint_json)}catch{fail('BAD_REQUEST')}
   if(id){const prev=await this.getCasio(user,{id});if(prev.course_id!==course_id)fail('FORBIDDEN');await q("UPDATE course_casio_projects SET title=?,blueprint_json=?,program_text=?,manual_text=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",name,blueprint_json,program_text,manual_text,id).run();return {id}}
   const key=uid();await q("INSERT INTO course_casio_projects(id,course_id,title,blueprint_json,program_text,manual_text) VALUES(?,?,?,?,?,?)",key,course_id,name,blueprint_json,program_text,manual_text).run();return {id:key};
  },
  async startJob(user,{course_id,mode,scope='전체',source_ids=[]}={}){
   await access(user,course_id,true);
   if(!['outline','detailed_note','subnote','exam_paper','exam_cram','exam_trends','transcript_fix','errors','calculator'].includes(mode)||!Array.isArray(source_ids)||!source_ids.length||source_ids.length>80||source_ids.length!==new Set(source_ids).size)fail('BAD_REQUEST');
   for(const id of source_ids){const s=await source(user,id);if(s.course_id!==course_id)fail('FORBIDDEN');if(s.review_status!=='reviewed')fail('REVIEW_INCOMPLETE')}
   const id=uid();await q("INSERT INTO course_generation_jobs(id,course_id,user_id,mode,scope,source_ids_json,status) VALUES(?,?,?,?,?,?,'awaiting_outline')",id,course_id,user,mode,String(scope).slice(0,300),JSON.stringify(source_ids)).run();return {id,status:'awaiting_outline'};
  },
  async saveOutline(user,{job_id,sections=[]}={}){
   const run=await job(user,job_id);
   if(run.status!=='awaiting_outline'||!Array.isArray(sections)||!sections.length||sections.length>80||sections.some(x=>!x||typeof x.title!=='string'||!x.title.trim()||x.title.length>200))fail('BAD_REQUEST');
   const outline=sections.map((x,i)=>({index:i+1,title:x.title.trim()}));
   const markdown=outline.map(x=>'## '+x.title+'\n\n[작성 중]').join('\n\n');
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
    const markdown=outline.map(p=>'## '+p.title+'\n\n'+(content.get(p.index)||'[작성 중]')).join('\n\n');
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
   return all("SELECT id,mode,scope,status,document_id FROM course_generation_jobs WHERE course_id=? AND user_id=? ORDER BY rowid DESC LIMIT 100",course_id,user);
  },
  async getJobProgress(user,{job_id}={}){
   const j=await job(user,job_id);
   const parts=await all("SELECT section_index FROM course_generation_parts WHERE job_id=? ORDER BY section_index",job_id);
   return {job_id:j.id,course_id:j.course_id,mode:j.mode,scope:j.scope,status:j.status,document_id:j.document_id,
    source_ids:JSON.parse(j.source_ids_json),outline:JSON.parse(j.outline_json),saved_parts:parts.map(x=>x.section_index)};
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
       weeks,exam_year:year?Number(year):null,buffer:await read(request,8*1024*1024)}),201);
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
   const status={BAD_REQUEST:400,BAD_FILE:400,FORBIDDEN:403,NOT_FOUND:404,REVISION_CONFLICT:409,REVIEW_INCOMPLETE:422,OUTLINE_REQUIRED:422,STORAGE_NOT_CONFIGURED:503}[e?.code]||500;
   return json({error:status===500?'Request failed':e.code},status);
 }
}
