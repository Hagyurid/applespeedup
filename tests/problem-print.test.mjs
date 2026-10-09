import test from 'node:test';
import assert from 'node:assert/strict';
import katex from 'katex';
import {renderProblemPrint,printProblemPack} from '../web/problem-print.js';
class Node{
 constructor(tag,text=''){this.tagName=tag;this.textContent=text;this.childNodes=[];this.attrs={};this.dataset={};}
 append(...nodes){this.childNodes.push(...nodes)}
 replaceChildren(...nodes){this.childNodes=nodes}
 setAttribute(k,v){this.attrs[k]=v}
 remove(){this.removed=true}
}
const walk=node=>[node,...node.childNodes.flatMap(walk)];
const text=node=>walk(node).map(n=>n.textContent).join(' ');
const record={title:'확산 문제팩',pack:{questions:[{id:'a',title:'확산',promptMd:'**농도** $C_1$를 구하라.',choices:[{text:'$x_1$'},{text:'둘째'}],answer:{displayMd:'$C_1=2$'},solution:{concepts:['Fick law'],actualSolution:'$$J=-D\\frac{dC}{dx}$$'}},{id:'b',promptMd:'둘째 문항',answer:'둘째 정답',solution:'둘째 해설'}]}};
function fixture(){const old=globalThis.document;globalThis.document={createElement:tag=>new Node(tag),createTextNode:value=>new Node('#text',value),body:new Node('body'),fonts:{ready:Promise.resolve()},title:'작업 공간'};return ()=>{globalThis.document=old};}
test('question PDF contains all prompts, choices, valid formulas and individual writing spaces, never answers',()=>{
 const restore=fixture();try{
  const target=new Node('article');const secret={...record,pack:{questions:record.pack.questions.map(q=>({...q,get answer(){throw Error('answer leak')},get solution(){throw Error('solution leak')}}))}};
  renderProblemPrint(target,secret,'problems','상평형');const nodes=walk(target);
  assert.equal(nodes.filter(n=>n.className==='pack-answer-space').length,2);assert.match(text(target),/둘째 문항/);assert.match(text(target),/상평형/);
  assert.equal(nodes.filter(n=>n.tagName==='li').length,2);assert.equal(nodes.some(n=>n.tagName==='strong'),true);
  for(const n of nodes.filter(n=>n.className?.includes('note-math')))assert.doesNotThrow(()=>katex.renderToString(n.textContent,{throwOnError:true}));
 }finally{restore()}
});
test('solution PDF preserves question numbering, structured explanations and math without writing blanks',()=>{
 const restore=fixture();try{
  const target=new Node('article');renderProblemPrint(target,record,'solutions');const nodes=walk(target);
  assert.equal(nodes.filter(n=>n.className==='pack-answer-space').length,0);assert.match(text(target),/둘째 정답/);assert.match(text(target),/둘째 해설/);assert.match(text(target),/Fick law/);
  assert.equal(nodes.filter(n=>n.tagName==='h2').length,2);assert.doesNotMatch(text(target),/구하라/);
  assert.throws(()=>renderProblemPrint(target,record,'bad'),/인쇄 유형/);
 }finally{restore()}
});
test('print waits for preparation, isolates the document and cleans up on print or cancel',async()=>{
 const restore=fixture(),oldWindow=globalThis.window;const events={};let printed=false;
 globalThis.window={addEventListener:(name,fn)=>{events[name]=fn},removeEventListener:name=>{delete events[name]},requestAnimationFrame:fn=>fn(),print(){printed=true;assert.equal(document.body.dataset.printMode,'problems');assert.match(document.title,/문제$/)}};
 try{await printProblemPack(record,'problems');assert.equal(printed,true);const article=document.body.childNodes[0];assert.equal(article.id,'packPrint');assert.equal(article.removed,undefined);events.afterprint();assert.equal(article.removed,true);assert.equal(document.body.dataset.printMode,undefined);assert.equal(document.title,'작업 공간');}
 finally{globalThis.window=oldWindow;restore()}
});
