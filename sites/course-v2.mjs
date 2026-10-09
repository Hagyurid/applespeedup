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
   const rows=await all("SELECT id,course_id,title,source_type,weeks_json,exam_year,original_filename AS file_name,mime_type,review_status,created_at FROM course_materials WHERE course_id=? ORDER BY created_at DESC,id DESC LIMIT 400",course_id);
   return rows.map(({weeks_json,...r})=>({...r,weeks:JSON.parse(weeks_json||'[]'),extract_status:r.review_status==='reviewed'?'ready':'pending'})).filter(r=>type==='all'||r.source_type===type);
  },
  async upload(user,{course_id,title,source_type,weeks=[],exam_year=null,filename,buffer}={}){
   await access(user,course_id,true);
   const data=buffer;if(!(data instanceof Uint8Array)||data.length<4||data.length>8*1024*1024)fail('BAD_FILE');
   const meta=metadata(source_type,weeks,exam_year),name=clean(title,200),file=clean(filename,250);
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
    await q("UPDATE course_materials SET title=?,weeks_json=?,exam_year=? WHERE id=?",name,JSON.stringify(meta.weeks),meta.examYear,duplicate.id).run();
    return {id:duplicate.id,reused:true};
   }
   const id=uid(),key='course-assets/'+course_id+'/'+id;
   await bucket.put(key,data,{httpMetadata:{contentType:mime}});
   try{
     const originalText=['text/plain','text/markdown'].includes(mime)?new TextDecoder('utf-8',{fatal:true}).decode(data):null;
     await q("INSERT INTO course_materials(id,course_id,title,source_type,weeks_json,exam_year,original_filename,mime_type,storage_key,sha256,original_text,review_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,'pending_review')",
       id,course_id,name,source_type,JSON.stringify(meta.weeks),meta.examYear,file,mime,key,hash,originalText).run();
   }catch(e){await bucket.delete(key).catch(()=>{});throw e}
   return {id,review_status:'pending_review'};
  },
  async registerText(user,{course_id,title,source_type='transcript',weeks=[],exam_year=null,content}={}){
   await access(user,course_id,true);
   const meta=metadata(source_type,weeks,exam_year),value=clean(content,950000),id=uid();
   await q("INSERT INTO course_materials(id,course_id,title,source_type,weeks_json,exam_year,original_text,mime_type,review_status,page_count) VALUES(?,?,?,?,?, ?,?,'text/plain','pending_review',1)",
     id,course_id,clean(title,200),source_type,JSON.stringify(meta.weeks),meta.examYear,value).run();
   return {id,review_status:'pending_review'};
  },
  async getPageImage(user,{material_id,page_num=1}={}){
   const m=await source(user,material_id);if(m.mime_type!=='image/jpeg'&&m.mime_type!=='image/png')fail('REVIEW_INCOMPLETE');
   if(page_num!==1||!m.storage_key||!bucket?.get)fail('NOT_FOUND');
   const f=await bucket.get(m.storage_key);if(!f)fail('NOT_FOUND');
   const bytes=new Uint8Array(await new Response(f.body).arrayBuffer());
   if(bytes.length>4*1024*1024)fail('BAD_FILE');
   let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
   return {__mcpImage:true,mimeType:m.mime_type,data:btoa(binary)};
  },
  async getOriginalText(user,{material_id}={}){const m=await source(user,material_id);return {id:m.id,title:m.title,original_text:m.original_text,review_status:m.review_status}},
  async saveReview(user,{material_id,page_num,raw_text,corrected_text,evidence_ids=[],unresolved=[]}={}){
   const m=await source(user,material_id,true);
   if(!Number.isInteger(page_num)||page_num<1||page_num>1000||!Array.isArray(evidence_ids)||evidence_ids.length>30||!Array.isArray(unresolved)||unresolved.length>60)fail('BAD_REQUEST');
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
   if(rows.length!==page_count||rows.some((x,i)=>x.page_num!==i+1||JSON.parse(x.unresolved_json||'[]').length))fail('REVIEW_INCOMPLETE');
   await q("UPDATE course_materials SET review_status='reviewed',page_count=? WHERE id=?",page_count,material_id).run();
   return {id:material_id,review_status:'reviewed'};
  },
  async verifiedText(user,{material_id}={}){
   const m=await source(user,material_id);if(m.review_status!=='reviewed')fail('REVIEW_INCOMPLETE');
   const pages=await all("SELECT page_num,corrected_text FROM course_material_pages WHERE material_id=? ORDER BY page_num",material_id);
   if(pages.length!==m.page_count||!pages.length)fail('REVIEW_INCOMPLETE');
   return {material_id,title:m.title,provenance:'corrected_ocr_or_transcript_only',pages};
  },
  async search(user,{course_id,query}={}){
   await access(user,course_id);
   const term=clean(query,180),pattern='%'+term.replace(/[\\%_]/g,'\\  async listNotes(user,{course_id}={}){')+'%';
   return all("SELECT p.material_id AS source_id,m.title AS source_title,p.page_num,substr(p.corrected_text,1,1400) AS content FROM course_material_pages p JOIN course_materials m ON m.id=p.material_id WHERE m.course_id=? AND m.review_status='reviewed' AND p.corrected_text LIKE ? ESCAPE '\\' ORDER BY m.created_at DESC,p.page_num LIMIT 30",course_id,pattern);
  },
  async listNotes(user,{course_id}={}){await access(user,course_id);return all("SELECT id,title,type,revision,updated_at FROM course_documents WHERE course_id=? ORDER BY updated_at DESC",course_id)},
  async getNote(user,{id}={}){return note(user,id)},
  async saveNote(user,{course_id,id,type='study_note',title,content_markdown='',expected_revision}={}){
   await access(user,course_id,true);
   if(!['study_note','exam_cram'].includes(type)||typeof content_markdown!=='string'||content_markdown.length>950000)fail('BAD_REQUEST');
   const t=clean(title,300);
   if(!id){const newId=uid();await q("INSERT INTO course_documents(id,course_id,type,title,content_markdown) VALUES(?,?,?,?,?)",newId,course_id,type,t,content_markdown).run();return {id:newId,revision:1}}
   const prev=await note(user,id,true);if(prev.course_id!==course_id)fail('FORBIDDEN');
   if(expected_revision!==prev.revision)fail('REVISION_CONFLICT');
   const updated=await q("UPDATE course_documents SET title=?,content_markdown=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND revision=?",t,content_markdown,id,expected_revision).run();
   if(updated.meta.changes!==1)fail('REVISION_CONFLICT');return {id,revision:prev.revision+1};
  },
  async listPacks(user,{course_id}={}){await access(user,course_id);return all("SELECT id,title,created_at FROM course_problem_packs WHERE course_id=? ORDER BY created_at DESC",course_id)},
  async getPack(user,{id}={}){const p=await one("SELECT * FROM course_problem_packs WHERE id=?",id);if(!p)fail('NOT_FOUND');await access(user,p.course_id);return {id:p.id,title:p.title,pack:JSON.parse(p.pack_json)}},
  async savePack(user,{course_id,title,pack}={}){await access(user,course_id,true);if(!pack||typeof pack!=='object'||!Array.isArray(pack.questions)||pack.questions.length>500)fail('BAD_REQUEST');const id=uid();await q("INSERT INTO course_problem_packs(id,course_id,title,pack_json) VALUES(?,?,?,?)",id,course_id,clean(title,200),JSON.stringify(pack)).run();return {id}},
  async getAttempt(user,{pack_id,question_id}={}){await this.getPack(user,{id:pack_id});return one("SELECT data_json FROM course_attempts WHERE user_id=? AND pack_id=? AND question_id=?",user,pack_id,question_id)},
  async saveAttempt(user,{pack_id,question_id,answer='',strokes=[],result='',bookmarked=false}={}){
   await this.getPack(user,{id:pack_id});const qid=clean(question_id,200);
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
   await q("UPDATE course_generation_jobs SET status='outlined',outline_json=? WHERE id=? AND status='awaiting_outline'",JSON.stringify(sections.map((x,i)=>({index:i+1,title:x.title.trim()}))),job_id).run();
   return {job_id,status:'outlined'};
  },
  async savePart(user,{job_id,section_index,content_markdown}={}){
   const run=await job(user,job_id),outline=JSON.parse(run.outline_json||'[]');
   if(run.status==='awaiting_outline'||!outline.length)fail('OUTLINE_REQUIRED');
   if(!Number.isInteger(section_index)||section_index<1||section_index>outline.length)fail('BAD_REQUEST');
   const body=clean(content_markdown,200000),prev=await one("SELECT content_markdown FROM course_generation_parts WHERE job_id=? AND section_index=?",job_id,section_index);
   if(prev&&prev.content_markdown!==body)fail('REVISION_CONFLICT');
   if(!prev)await q("INSERT INTO course_generation_parts(job_id,section_index,content_markdown) VALUES(?,?,?)",job_id,section_index,body).run();
   const parts=await all("SELECT section_index,content_markdown FROM course_generation_parts WHERE job_id=? ORDER BY section_index",job_id);
   const content=new Map(parts.map(p=>[p.section_index,p.content_markdown]));
   const markdown=outline.map(p=>'## '+p.title+'\n\n'+(content.get(p.index)||'[작성 중]')).join('\n\n');
   const doc=run.document_id||uid(),complete=parts.length===outline.length;
   if(!run.document_id)await q("INSERT INTO course_documents(id,course_id,type,title,content_markdown) VALUES(?,?,?,?,?)",doc,run.course_id,'study_note',run.mode+' · '+run.scope,markdown).run();
   else await q("UPDATE course_documents SET content_markdown=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND content_markdown<>?",markdown,doc,markdown).run();
   await q("UPDATE course_generation_jobs SET document_id=?,status=? WHERE id=?",doc,complete?'complete':'generating',run.id).run();
   return {document_id:doc,status:complete?'complete':'generating',saved_parts:parts.length,autosaved:true};
  },
  async getJob(user,{id}={}){const j=await job(user,id);return {...j,source_ids:JSON.parse(j.source_ids_json),outline:JSON.parse(j.outline_json)}},
  async getFile(user,{id}={}){const s=await source(user,id);if(!s.storage_key||!bucket?.get)fail('NOT_FOUND');const file=await bucket.get(s.storage_key);if(!file)fail('NOT_FOUND');return new Response(file.body,{headers:{'content-type':s.mime_type,'content-disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(s.original_filename),'cache-control':'no-store'}})}
 };
}
const json=(obj,status=200)=>new Response(JSON.stringify(obj),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
export async function handleCourseRequest(request,{db,bucket,userId}){
 const repo=createCourseLibrary(db,bucket),url=new URL(request.url),p=url.pathname,method=request.method;
 try{
   const get={'/api/v2/materials':['listMaterials',{course_id:url.searchParams.get('course_id'),type:url.searchParams.get('type')||'all'}],
     '/api/v2/search':['search',{course_id:url.searchParams.get('course_id'),query:url.searchParams.get('query')}],'/api/v2/notes':['listNotes',{course_id:url.searchParams.get('course_id')}],'/api/v2/note':['getNote',{id:url.searchParams.get('id')}],
     '/api/v2/packs':['listPacks',{course_id:url.searchParams.get('course_id')}],'/api/v2/pack':['getPack',{id:url.searchParams.get('id')}],
     '/api/v2/attempt':['getAttempt',{pack_id:url.searchParams.get('pack_id'),question_id:url.searchParams.get('question_id')}],
     '/api/v2/casio':['listCasio',{course_id:url.searchParams.get('course_id')}],'/api/v2/casio-item':['getCasio',{id:url.searchParams.get('id')}],
     '/api/v2/reviewed':['verifiedText',{material_id:url.searchParams.get('id')}],'/api/v2/original':['getOriginalText',{material_id:url.searchParams.get('id')}],
     '/api/v2/job':['getJob',{id:url.searchParams.get('id')}]};
   if(method==='GET'&&get[p])return json(await repo[get[p][0]](userId,get[p][1]));
   if(method==='GET'&&p.startsWith('/api/v2/file/'))return repo.getFile(userId,{id:p.slice('/api/v2/file/'.length)});
   if(method==='POST'&&p==='/api/v2/upload'){
     let weeks;try{weeks=JSON.parse(request.headers.get('x-weeks')||'[]')}catch{fail('BAD_REQUEST')}
     const year=request.headers.get('x-exam-year');
     return json(await repo.upload(userId,{course_id:request.headers.get('x-course-id'),source_type:request.headers.get('x-source-type'),
       title:decodeURIComponent(request.headers.get('x-title')||''),filename:decodeURIComponent(request.headers.get('x-filename')||''),
       weeks,exam_year:year?Number(year):null,buffer:await read(request,8*1024*1024)}),201);
   }
   const post={'/api/v2/text':'registerText','/api/v2/review':'saveReview','/api/v2/finalize':'finalizeReview',
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
