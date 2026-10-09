import {renderNoteMarkdown,noteMathReady} from './note-render.js';
import {answerText,questionTitle,solutionText} from '../domain/problem-presentation.mjs';
const el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
/** Render only the selected pack. Question printing never reads answer/solution fields. */
export function renderProblemPrint(target,record,mode,courseName=''){
 if(!['problems','solutions'].includes(mode))throw Error('알 수 없는 인쇄 유형입니다.');
 const questions=record?.pack?.questions;
 if(!Array.isArray(questions)||!questions.length)throw Error('인쇄할 문제가 없습니다.');
 target.replaceChildren();target.className='note-preview pack-print';
 target.append(el('h1',record.title||record.pack.title||'문제팩'));
 target.append(el('p',[courseName,mode==='problems'?'문제 · 풀이 여백 포함':'정답·해설',`${questions.length}문제`].filter(Boolean).join(' · ')));
 for(const [index,q] of questions.entries()){
  const section=el('section');section.className=mode==='problems'?'pack-print-problem':'pack-print-solution';
  section.append(el('h2',`${index+1}. ${questionTitle(q,index)}`));
  const body=el('div');section.append(body);
  if(mode==='problems'){
   renderNoteMarkdown(body,String(q.promptMd??q.body??q.prompt??''),{compactIntroduction:false,pageBreaks:false});
   if(Array.isArray(q.choices)){
    const list=el('ol');for(const choice of q.choices){const item=el('li');renderNoteMarkdown(item,String(choice.text??choice.label??choice),{compactIntroduction:false,pageBreaks:false});list.append(item);}section.append(list);
   }
   const space=el('div');space.className='pack-answer-space';space.setAttribute('aria-label','풀이 공간');space.append(el('small','풀이'));section.append(space);
  }else{
   const answer=String(answerText(q));
   renderNoteMarkdown(body,'**정답**\n\n'+(answer.trim()?answer:'등록된 정답이 없습니다.')+'\n\n'+solutionText(q),{compactIntroduction:false,pageBreaks:false});
  }
  target.append(section);
 }
}
let activePrint=null;
export function clearProblemPrint(){activePrint?.();}
export async function printProblemPack(record,mode,courseName=''){
 activePrint?.();
 const target=el('article');target.id='packPrint';
 renderProblemPrint(target,record,mode,courseName);document.body.append(target);
 const oldTitle=document.title,printTitle=(record.title||record.pack.title||'문제팩')+(mode==='problems'?' - 문제':' - 정답과 해설');
 let cleaned=false;
 const cleanup=()=>{if(cleaned)return;cleaned=true;window.removeEventListener('afterprint',cleanup);target.remove();delete document.body.dataset.printMode;if(document.title===printTitle)document.title=oldTitle;activePrint=null;};
 activePrint=cleanup;
 try{
  await noteMathReady();target.getBoundingClientRect?.();await document.fonts.ready;
  document.body.dataset.printMode=mode;document.title=printTitle;
  window.addEventListener('afterprint',cleanup,{once:true});
  await new Promise(resolve=>window.requestAnimationFrame(resolve));window.print();
 }catch(error){cleanup();throw error;}
}
