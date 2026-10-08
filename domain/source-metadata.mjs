/** Validates user-entered catalog metadata. Never infer from original filenames or OCR. */
export const SOURCE_WEEK_MAX = 30;
export function normalizeSourceMetadata({source_type, weeks=[], exam_year=null}={}){
  const isExam = source_type === 'past_exam';
  if(!Array.isArray(weeks) || weeks.length > SOURCE_WEEK_MAX)throw Object.assign(new Error('BAD_REQUEST'),{code:'BAD_REQUEST'});
  const normalized = [];
  for(const v of weeks){
    if(!Number.isInteger(v)||v<1||v>SOURCE_WEEK_MAX || normalized.includes(v))
      throw Object.assign(new Error('BAD_REQUEST'),{code:'BAD_REQUEST'});
    normalized.push(v);
  }
  normalized.sort((a,b)=>a-b);
  const noYear=exam_year===null||exam_year===undefined||exam_year==='';
  let year=null;
  if(!noYear){
    if(!Number.isInteger(exam_year)||exam_year<1900||exam_year>2100)
      throw Object.assign(new Error('BAD_REQUEST'),{code:'BAD_REQUEST'});
    year=exam_year;
  }
  if((isExam&&normalized.length>0)||(!isExam&&year!==null))
    throw Object.assign(new Error('BAD_REQUEST'),{code:'BAD_REQUEST'});
  return {weeks:isExam?[]:normalized,exam_year:isExam?year:null};
}
