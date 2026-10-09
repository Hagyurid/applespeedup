/** Compact display of legacy generated review introductions; preserve the source text. */
export function compactNoteIntroduction(markdown){
 let text=String(markdown||'');
 text=text.replace(/^## 자료 검토 주의사항\n[\s\S]*?(?=^## |$(?![\s\S]))/m,block=>{
  const issues=block.split('\n').filter(x=>x.startsWith('- '));
  if(!issues.length)return '';
  const summary=issues.slice(0,1).map(x=>x.replace(/^- .*? · /,'- ').slice(0,140));
  if(issues.length>1)summary.push('- 그 외 '+(issues.length-1)+'건은 자료 검수 기록에서 확인하세요.');
  return '## 확인 필요\n\n'+summary.join('\n')+'\n\n';
 });
 // Older generated introductions have an outer section and numbered inner title.
 // Match only their known metadata title, ending at the next numbered main section.
 text=text.replace(/^## 자료 범위·출제 근거·검수 상태 및 확인 필요\n[\s\S]*?(?=^## [^\n]+\n\n# 2[. ]|$(?![\s\S]))/m,block=>{
  const flags=[];
  if(block.includes('과목명 불일치'))flags.push('등록 과목명과 자료 주제가 다릅니다. 선택 자료의 내용을 기준으로 작성했습니다.');
  if(block.includes('올해 실제 시험 범위'))flags.push('실제 시험 범위는 별도 확인이 필요합니다.');
  return flags.length?'- '+flags.join(' ')+'\n\n':'';
 });
 return text;
}
