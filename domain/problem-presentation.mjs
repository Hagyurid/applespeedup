/** Shared display only; no grading or modification of problem-pack records. */
export const answerText=q=>q.answer?.displayMd??q.answer?.value??q.answer?.text??q.answer??'';
export function questionTitle(q,index){return String(q.title||q.section||`문제 ${index+1}`);}
export function solutionText(q){
 const s=q.solution;
 if(typeof s==='string')return s;
 if(!s||typeof s!=='object')return '등록된 해설이 없습니다.';
 return [['핵심 개념',s.concepts],['풀이',s.actualSolution],['주의',s.cautions],['팁',s.tips]]
  .filter(([,v])=>v).map(([name,v])=>'### '+name+'\n\n'+(Array.isArray(v)?v.join('\n'):String(v))).join('\n\n')||'등록된 해설이 없습니다.';
}
