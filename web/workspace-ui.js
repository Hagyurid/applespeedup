/** Local view controls stay usable while server requests run. */
export function bindWorkspaceUI({document,window}){
 const shell=document.querySelector('.workspace-shell');
 const bindings=[
  ['toggleWorkspace','workspaceSidebar',shell,'sidebar-collapsed','메뉴'],
  ['toggleNoteList','noteListPanel',document.querySelector('.notes-layout'),'list-collapsed','목록'],
  ['toggleProblemList','solveIndex',document.getElementById('solveWorkspace'),'list-collapsed','목록'],
  ['toggleProblemView','solveQuestionPanel',document.getElementById('solveSheet'),'question-collapsed','문제']
 ];
 for(const [id,targetId,container,cls,label] of bindings){
  const button=document.getElementById(id),target=document.getElementById(targetId);
  if(!button||!target||!container)throw Error('화면 조작 요소가 없습니다: '+id);
  button.dataset.uiOnly='true';
  button.addEventListener('click',()=>{
   const collapsed=!target.hidden;
   target.hidden=collapsed;container.classList.toggle(cls,collapsed);
   button.setAttribute('aria-expanded',String(!collapsed));button.textContent=label+(collapsed?' 펼치기':' 접기');
  });
 }
 const resize=()=>{const height=window.visualViewport?.height||window.innerHeight;
  if(height>0)document.documentElement.style.setProperty('--workspace-height',Math.floor(height)+'px');
 };
 window.addEventListener('resize',resize);window.visualViewport?.addEventListener('resize',resize);resize();
 return {setPage(page){
  shell.classList.toggle('is-study-workspace',page==='notes'||page==='solvepad');
  document.body.dataset.workspacePage=page;
  document.getElementById('toggleNoteList').hidden=page!=='notes';
  document.getElementById('toggleProblemList').hidden=page!=='solvepad';
  resize();
 }};
}
