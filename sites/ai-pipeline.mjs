/**
 * A+ AI pipeline: strict server-side review → saved outline → saved sections.
 * Transitional adapter: existing sources/notes still use offering_id internally.
 * ChatGPT inference is NOT performed on this server; it must call MCP tools.
 */
import {splitTranscript} from '../domain/core.mjs';
const reject=code=>{const e=new Error(code);e.code=code;throw e;};
const uuid=()=>crypto.randomUUID();
const nonblank=(v,n)=>typeof v==='string'&&v.trim()&&v.length<=n;
const jsonValue=v=>JSON.stringify(v);
const parse=v=>JSON.parse(v||'[]');
const VALID_MODES=new Set(['outline','detailed_note','subnote','exam_paper','exam_cram','exam_trends','transcript_fix','errors','calculator']);

export function createAiPipeline(db){
  if(!db?.prepare||!db?.batch)throw Error('D1 database required');
  const q=(sql,...p)=>db.prepare(sql).bind(...p);
  const first=(sql,...p)=>q(sql,...p).first();
  const all=async(sql,...p)=>(await q(sql,...p).all()).results||[];
  const course=async(user,courseId,write=false)=>{
    if(!user||!courseId)reject('FORBIDDEN');
    const row=await first(`SELECT c.id,c.name,c.owner_user_id,m.role FROM courses c
      LEFT JOIN course_members m ON m.course_id=c.id AND m.user_id=?
      WHERE c.id=? AND (c.owner_user_id=? OR m.user_id=?)`,user,courseId,user,user);
    if(!row)reject('NOT_FOUND');
    if(write&&row.owner_user_id!==user&&!['owner','editor'].includes(row.role))reject('FORBIDDEN');
    return row;
  };
  const source=async(user,sourceId,write=false)=>{
    const s=await first(`SELECT s.id,s.title,s.source_type,s.offering_id,s.extract_status,o.course_id
      FROM source_assets s JOIN offerings o ON o.id=s.offering_id WHERE s.id=?`,sourceId);
    if(!s)reject('NOT_FOUND');
    await course(user,s.course_id,write);
    return s;
  };
  async function ownedRun(user,runId,write=false){
    const run=await first('SELECT * FROM ai_generation_runs WHERE id=?',runId);
    if(!run)reject('NOT_FOUND');
    await course(user,run.course_id,write);
    if(run.created_by_user_id!==user)reject('FORBIDDEN');
    return run;
  }
  return {
    async saveReviewedPage(user,{source_id,page_num,recognized_text,corrected_text,evidence_source_ids=[],unresolved=[]}={}){
      const src=await source(user,source_id,true);
      if(!Number.isInteger(page_num)||page_num<1||page_num>1000||
         !nonblank(recognized_text,100000)||!nonblank(corrected_text,100000)||
         !Array.isArray(evidence_source_ids)||evidence_source_ids.length>15||!Array.isArray(unresolved)||unresolved.length>50||
         unresolved.some(x=>!nonblank(x,500)))reject('BAD_REQUEST');
      if(new Set(evidence_source_ids).size!==evidence_source_ids.length)reject('BAD_REQUEST');
      for(const id of evidence_source_ids){
        if(typeof id!=='string')reject('BAD_REQUEST');
        const other=await source(user,id);
        if(other.course_id!==src.course_id)reject('FORBIDDEN');
      }
      // A model may request 'verified', but the server does not accept that
      // assertion if unresolved flags remain. Keep evidence and raw OCR intact.
      const status=unresolved.length?'needs_review':'reviewed';
      await q(`INSERT INTO source_review_pages(source_id,page_num,recognized_text,corrected_text,evidence_source_ids_json,unresolved_json,review_status)
        VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(source_id,page_num) DO UPDATE SET recognized_text=excluded.recognized_text,
        corrected_text=excluded.corrected_text,evidence_source_ids_json=excluded.evidence_source_ids_json,
        unresolved_json=excluded.unresolved_json,review_status=excluded.review_status,updated_at=CURRENT_TIMESTAMP`,
        source_id,page_num,recognized_text,corrected_text,jsonValue(evidence_source_ids),jsonValue(unresolved),status).run();
      await q("UPDATE source_assets SET extract_status='pending' WHERE id=?",source_id).run();
      return {source_id,page_num,review_status:status,unresolved_count:unresolved.length};
    },
    async finalizeSourceReview(user,{source_id,total_pages}={}){
      await source(user,source_id,true);
      if(!Number.isInteger(total_pages)||total_pages<1||total_pages>1000)reject('BAD_REQUEST');
      const pages=await all('SELECT * FROM source_review_pages WHERE source_id=? ORDER BY page_num',source_id);
      // Cannot silently omit a page or accept a flagged mathematical ambiguity.
      if(pages.length!==total_pages||pages.some((p,i)=>p.page_num!==i+1||p.review_status!=='reviewed'))reject('REVIEW_INCOMPLETE');
      const statements=[q('DELETE FROM source_chunks WHERE source_id=?',source_id)];
      let index=0;
      for(const p of pages)for(const text of splitTranscript(p.corrected_text,1600)){
        statements.push(q('INSERT INTO source_chunks(id,source_id,page_num,chunk_index,text_content) VALUES(?,?,?,?,?)',
          uuid(),source_id,p.page_num,index++,text));
      }
      if(index===0)reject('REVIEW_INCOMPLETE');
      statements.push(q("UPDATE source_assets SET extract_status='ready' WHERE id=?",source_id));
      await db.batch(statements);
      return {source_id,review_status:'reviewed',pages:pages.length,chunks:index};
    },
    async beginGeneration(user,{course_id,mode,scope='',source_ids=[]}={}){
      await course(user,course_id,true);
      if(!VALID_MODES.has(mode)||!nonblank(scope||'전체',500)||
         !Array.isArray(source_ids)||!source_ids.length||source_ids.length>80||
         source_ids.some(x=>typeof x!=='string')||new Set(source_ids).size!==source_ids.length)reject('BAD_REQUEST');
      let offeringId=null;
      for(const id of source_ids){
        const src=await source(user,id);
        if(src.course_id!==course_id)reject('FORBIDDEN');
        if(src.extract_status!=='ready')reject('REVIEW_INCOMPLETE');
        const status=await first(`SELECT count(*) AS total,
          sum(CASE WHEN review_status='reviewed' THEN 1 ELSE 0 END) AS reviewed
          FROM source_review_pages WHERE source_id=?`,id);
        if(!status?.total||status.reviewed!==status.total)reject('REVIEW_INCOMPLETE');
        // Transitional Notes schema still requires an offering_id.
        if(offeringId===null)offeringId=src.offering_id;
        else if(offeringId!==src.offering_id)reject('BAD_REQUEST');
      }
      const id=uuid();
      await q(`INSERT INTO ai_generation_runs(id,course_id,offering_id,created_by_user_id,mode,scope,source_ids_json,status)
        VALUES(?,?,?,?,?,?,?,'awaiting_outline')`,id,course_id,offeringId,user,mode,scope||'전체',jsonValue(source_ids)).run();
      return {run_id:id,status:'awaiting_outline',source_ids,required_next_action:'save_generation_outline'};
    },
    async saveGenerationOutline(user,{run_id,sections=[]}={}){
      const run=await ownedRun(user,run_id,true);
      if(run.status!=='awaiting_outline'||!Array.isArray(sections)||!sections.length||sections.length>80||
         sections.some(s=>!s||!nonblank(s.title,300)))reject('BAD_REQUEST');
      const plan=sections.map((s,i)=>({index:i+1,title:s.title.trim()}));
      await q(`UPDATE ai_generation_runs SET outline_json=?,status='outlined',updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND status='awaiting_outline'`,jsonValue(plan),run_id).run();
      return {run_id,outline_saved:true,section_count:plan.length,status:'outlined'};
    },
    async saveGeneratedSection(user,{run_id,section_index,content_markdown}={}){
      const run=await ownedRun(user,run_id,true);
      const outline=parse(run.outline_json);
      if(!['outlined','generating','complete'].includes(run.status)||!outline.length||
         !Number.isInteger(section_index)||section_index<1||section_index>outline.length||
         !nonblank(content_markdown,200000))reject('OUTLINE_REQUIRED');
      const old=await first('SELECT content_markdown FROM ai_generation_sections WHERE run_id=? AND section_index=?',run_id,section_index);
      if(old){
        if(old.content_markdown!==content_markdown)reject('REVISION_CONFLICT');
      }else{
        await q('INSERT INTO ai_generation_sections(run_id,section_index,content_markdown) VALUES(?,?,?)',run_id,section_index,content_markdown).run();
      }
      const saved=await all('SELECT section_index,content_markdown FROM ai_generation_sections WHERE run_id=? ORDER BY section_index',run_id);
      const parts=new Map(saved.map(x=>[x.section_index,x.content_markdown]));
      const text=outline.map(s=>`## ${s.title}\n\n${parts.get(s.index)||'[작성 대기]'}`).join('\n\n');
      const title=`${run.mode} · ${run.scope}`;
      const isComplete=parts.size===outline.length;
      const now=new Date().toISOString();
      let noteId=run.note_id,revision=1;
      if(!noteId){
        noteId=uuid();
        await db.batch([
          q(`INSERT INTO notes(id,offering_id,title,content_markdown,revision,created_by_user_id,creation_key,created_at,updated_at)
             VALUES(?,?,?,?,1,?,?,?,?)`,noteId,run.offering_id,title,text,user,`ai-run:${run_id}`,now,now),
          q('INSERT INTO note_versions(note_id,revision,title,content_markdown,created_at) VALUES(?,1,?,?,?)',noteId,title,text,now),
          q("UPDATE ai_generation_runs SET note_id=?,status=?,updated_at=? WHERE id=?",noteId,isComplete?'complete':'generating',now,run_id)
        ]);
      }else{
        const existing=await first('SELECT revision,content_markdown FROM notes WHERE id=? AND offering_id=?',noteId,run.offering_id);
        if(!existing)reject('NOT_FOUND');
        revision=existing.revision;
        if(existing.content_markdown!==text){
          revision++;
          const done=await db.batch([
            q('UPDATE notes SET content_markdown=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?',text,now,noteId,existing.revision),
            q('INSERT INTO note_versions(note_id,revision,title,content_markdown,created_at) SELECT id,revision,title,content_markdown,? FROM notes WHERE id=? AND revision=? AND changes()=1',now,noteId,revision),
            q("UPDATE ai_generation_runs SET status=?,updated_at=? WHERE id=?",isComplete?'complete':'generating',now,run_id)
          ]);
          if(done[0]?.meta?.changes!==1)reject('REVISION_CONFLICT');
        }else if(run.status!==(isComplete?'complete':'generating')){
          await q('UPDATE ai_generation_runs SET status=?,updated_at=? WHERE id=?',isComplete?'complete':'generating',now,run_id).run();
        }
      }
      return {run_id,note_id:noteId,revision,saved_sections:parts.size,total_sections:outline.length,status:isComplete?'complete':'generating',autosaved:true};
    },
    async getGenerationProgress(user,{run_id}={}){
      const run=await ownedRun(user,run_id);
      const rows=await all('SELECT section_index FROM ai_generation_sections WHERE run_id=? ORDER BY section_index',run_id);
      return {run_id,status:run.status,outline:parse(run.outline_json),saved_sections:rows.map(x=>x.section_index),note_id:run.note_id,source_ids:parse(run.source_ids_json)};
    },
    async getReviewedPage(user,{source_id,page_num}={}){
      await source(user,source_id);
      if(!Number.isInteger(page_num)||page_num<1)reject('BAD_REQUEST');
      const row=await first('SELECT source_id,page_num,recognized_text,corrected_text,evidence_source_ids_json,unresolved_json,review_status FROM source_review_pages WHERE source_id=? AND page_num=?',source_id,page_num);
      if(!row)reject('NOT_FOUND');
      return {...row,evidence_source_ids:parse(row.evidence_source_ids_json),unresolved:parse(row.unresolved_json)};
    }
  };
}
