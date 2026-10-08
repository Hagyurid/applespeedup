/** D1-backed MCP repository for 에쁠가속기.
 * Host MUST authenticate the caller and pass the verified user ID.
 * This module never trusts user IDs, course IDs or offering IDs supplied by a model.
 */

const fail=(code)=>{const e=new Error(code);e.code=code;throw e;};
const writeRoles=new Set(['owner','editor']);
const trim=(value,limit)=>String(value??'').trim().slice(0,limit);
const uuid=()=>globalThis.crypto.randomUUID();
const now=()=>new Date().toISOString();

export function createD1Repository(db){
  if(!db?.prepare || !db?.batch)throw new Error('D1 database binding required');
  const q=(sql,...params)=>db.prepare(sql).bind(...params);
  const first=(sql,...params)=>q(sql,...params).first();
  const all=async(sql,...params)=>(await q(sql,...params).all()).results||[];
  async function authorizeOffering(userId,offeringId,write=false){
    if(!userId || !offeringId)fail('FORBIDDEN');
    const row=await first(`SELECT o.id, o.course_id, o.year, o.term, o.professor, o.notes,
      c.name, c.characteristics, c.owner_user_id, m.role
      FROM offerings o JOIN courses c ON c.id=o.course_id
      LEFT JOIN course_members m ON m.course_id=c.id AND m.user_id=?
      WHERE o.id=? AND (c.owner_user_id=? OR m.user_id=?)`,userId,offeringId,userId,userId);
    if(!row)fail('NOT_FOUND');
    if(write && row.owner_user_id!==userId && !writeRoles.has(row.role))fail('FORBIDDEN');
    return row;
  }
  async function authorizeSource(userId,sourceId){
    const source=await first('SELECT id,offering_id FROM source_assets WHERE id=?',sourceId);
    if(!source)fail('NOT_FOUND');
    await authorizeOffering(userId,source.offering_id);
    return source;
  }
  return {
    async getCourseContext(userId,{offering_id}){
      const o=await authorizeOffering(userId,offering_id);
      const facts=await all(`SELECT fact_key, fact_value, provenance, confidence, offering_id
        FROM course_facts WHERE course_id=? AND (offering_id IS NULL OR offering_id=?)
        ORDER BY created_at DESC LIMIT 100`,o.course_id,offering_id);
      return {course:{id:o.course_id,name:o.name,characteristics:o.characteristics},
        offering:{id:o.id,year:o.year,term:o.term,professor:o.professor,notes:o.notes},facts};
    },
    async listSources(userId,{offering_id}){
      await authorizeOffering(userId,offering_id);
      return all(`SELECT id,offering_id,source_type,title,file_name,mime_type,extract_status,
        provenance,year_reference,created_at FROM source_assets WHERE offering_id=?
        ORDER BY created_at DESC,id DESC LIMIT 300`,offering_id);
    },
    async searchSourceContent(userId,{offering_id,query,limit=8}){
      await authorizeOffering(userId,offering_id);
      const term=trim(query,180);
      if(!term)fail('BAD_REQUEST');
      const n=Number.isInteger(limit)?Math.min(10,Math.max(1,limit)):8;
      const escaped=term.replace(/[\\%_]/g,'\\$&');
      const pattern=`%${escaped}%`;
      return all(`SELECT c.source_id, s.title AS source_title, s.source_type,
          s.provenance, s.year_reference, c.page_num, c.chunk_index,
          substr(c.text_content,1,1400) AS content
        FROM source_chunks c JOIN source_assets s ON s.id=c.source_id
        WHERE s.offering_id=? AND s.extract_status='ready'
          AND (c.text_content LIKE ? ESCAPE '\\' OR s.title LIKE ? ESCAPE '\\')
        ORDER BY CASE WHEN s.source_type='lecture_slides' THEN 0 WHEN s.source_type='transcript' THEN 1
                      WHEN s.source_type='textbook' THEN 2 ELSE 3 END, c.chunk_index LIMIT ?`,
        offering_id,pattern,pattern,n);
    },
    async getNote(userId,{note_id}){
      const n=await first('SELECT * FROM notes WHERE id=?',note_id);
      if(!n)fail('NOT_FOUND');
      await authorizeOffering(userId,n.offering_id);
      return {id:n.id,offering_id:n.offering_id,title:n.title,content_markdown:n.content_markdown,revision:n.revision,updated_at:n.updated_at};
    },
    async saveNote(userId,{offering_id,note_id,expected_revision,title,content_markdown}){
      await authorizeOffering(userId,offering_id,true);
      const t=trim(title,300),content=String(content_markdown??'');
      if(!t || !content.trim() || content.length>400000)fail('BAD_REQUEST');
      const timestamp=now();
      if(note_id){
        if(!Number.isInteger(expected_revision)||expected_revision<1)fail('REVISION_CONFLICT');
        const prev=await first('SELECT id,offering_id,revision FROM notes WHERE id=?',note_id);
        if(!prev)fail('NOT_FOUND');
        if(prev.offering_id!==offering_id)fail('FORBIDDEN');
        if(prev.revision!==expected_revision)fail('REVISION_CONFLICT');
        const next=expected_revision+1;
        const results=await db.batch([
          q(`UPDATE notes SET title=?,content_markdown=?,revision=revision+1,updated_at=?
            WHERE id=? AND offering_id=? AND revision=?`,t,content,timestamp,note_id,offering_id,expected_revision),
          q(`INSERT INTO note_versions(note_id,revision,title,content_markdown,created_at)
            SELECT id,revision,title,content_markdown,? FROM notes WHERE id=? AND revision=? AND changes()=1`,timestamp,note_id,next)
        ]);
        if(results[0]?.meta?.changes!==1)fail('REVISION_CONFLICT');
        return {id:note_id,revision:next,updated_at:timestamp};
      }
      const newId=uuid();
      await db.batch([
        q(`INSERT INTO notes(id,offering_id,title,content_markdown,revision,created_by_user_id,created_at,updated_at)
           VALUES(?,?,?,?,1,?,?,?)`,newId,offering_id,t,content,userId,timestamp,timestamp),
        q('INSERT INTO note_versions(note_id,revision,title,content_markdown,created_at) VALUES(?,1,?,?,?)',newId,t,content,timestamp)
      ]);
      return {id:newId,revision:1,updated_at:timestamp};
    },
    async saveCheckpoint(userId,{job_id,step,status,result_ref=''}){
      const job=await first('SELECT id,offering_id,created_by_user_id,completed_steps_json FROM jobs WHERE id=?',job_id);
      if(!job)fail('NOT_FOUND');
      await authorizeOffering(userId,job.offering_id,true);
      if(job.created_by_user_id!==userId)fail('FORBIDDEN');
      const valid=['context','sources','outline','generate','verify','save'];
      if(!valid.includes(step)||!['done','needs_review','failed'].includes(status))fail('BAD_REQUEST');
      const done=new Set(JSON.parse(job.completed_steps_json||'[]'));
      if(status==='done')done.add(step);
      const steps=valid.filter(x=>done.has(x));
      const newStatus=status==='failed'?'failed':status==='needs_review'?'needs_review':steps.length===valid.length?'complete':'partial';
      await db.batch([
        q(`INSERT INTO job_checkpoints(id,job_id,step,status,result_ref) VALUES(?,?,?,?,?)
          ON CONFLICT(job_id,step) DO UPDATE SET status=excluded.status,result_ref=excluded.result_ref,created_at=CURRENT_TIMESTAMP`,uuid(),job_id,step,status,trim(result_ref,400)),
        q('UPDATE jobs SET completed_steps_json=?,status=?,updated_at=? WHERE id=?',JSON.stringify(steps),newStatus,now(),job_id)
      ]);
      return {job_id,completed_steps:steps,status:newStatus};
    },
    async createJob(userId,{offering_id,mode,scope='전체'}){
      await authorizeOffering(userId,offering_id,true);
      const allowed=['outline','detailed_note','subnote','exam_paper','exam_cram','exam_trends','transcript_fix','errors','calculator'];
      if(!allowed.includes(mode))fail('BAD_REQUEST');
      const jid=uuid();
      await q(`INSERT INTO jobs(id,offering_id,created_by_user_id,mode,scope)
        VALUES(?,?,?,?,?)`,jid,offering_id,userId,mode,trim(scope,200)).run();
      return {job_id:jid,offering_id,mode,scope,status:'pending',completed_steps:[]};
    },
    async getJob(userId,{job_id}){
      const job=await first('SELECT * FROM jobs WHERE id=?',job_id);
      if(!job)fail('NOT_FOUND');
      await authorizeOffering(userId,job.offering_id);
      if(job.created_by_user_id!==userId)fail('FORBIDDEN');
      return {job_id:job.id,offering_id:job.offering_id,mode:job.mode,scope:job.scope,
        status:job.status,completed_steps:JSON.parse(job.completed_steps_json||'[]')};
    },
    async ingestTranscript(userId,{offering_id,title,text,provenance=''}){
      await authorizeOffering(userId,offering_id,true);
      const value=String(text??''),t=trim(title,200);
      if(!t || !value.trim() || value.length>1500000)fail('BAD_REQUEST');
      const sourceId=uuid(),chunks=[];const max=1600;
      const paragraphs=value.replace(/\r\n?/g,'\n').split(/\n\s*\n/);
      let buf='';
      function flush(){if(buf){chunks.push(buf);buf='';}}
      for(const para of paragraphs){
        const p=para.trim();if(!p)continue;
        if(p.length>max){flush();for(let i=0;i<p.length;i+=max)chunks.push(p.slice(i,i+max));continue;}
        if(buf && buf.length+p.length+2>max)flush();
        buf=buf?buf+'\n\n'+p:p;
      }
      flush();
      const statements=[q(`INSERT INTO source_assets(id,offering_id,source_type,title,file_name,mime_type,extract_status,provenance)
        VALUES(?,?,'transcript',?,'','text/plain','ready',?)`,sourceId,offering_id,t,trim(provenance,400))];
      for(let i=0;i<chunks.length;i++)statements.push(q(`INSERT INTO source_chunks(id,source_id,page_num,chunk_index,text_content)
        VALUES(?,?,NULL,?,?)`,uuid(),sourceId,i,chunks[i]));
      await db.batch(statements);
      return {source_id:sourceId,chunks:chunks.length,extract_status:'ready'};
    },
    async getSourceContent(userId,{source_id,page_num,offset=0,limit=10}){
      await authorizeSource(userId,source_id);
      const start=Math.max(0,Math.floor(offset));
      const n=Math.min(20,Math.max(1,Math.floor(limit)));
      return all(`SELECT source_id,page_num,chunk_index,substr(text_content,1,2200) AS content
        FROM source_chunks WHERE source_id=? AND (? IS NULL OR page_num=?)
        ORDER BY chunk_index LIMIT ? OFFSET ?`,source_id,page_num??null,page_num??null,n,start);
    }
  };
}
