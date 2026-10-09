import test from 'node:test';
import assert from 'node:assert/strict';
import {createSolvePad} from '../web/solvepad.js';
class Node{
 constructor(){this.childNodes=[];this.value='all';this.style={};this.classList={add(){},toggle(){}};this.clientWidth=0;this.clientHeight=0;this.attrs={};}
 append(...nodes){this.childNodes.push(...nodes)}
 replaceChildren(...nodes){this.childNodes=nodes}
 get children(){return this.childNodes}
 get options(){return this.childNodes}
 add(node){this.append(node)}
 setAttribute(k,v){this.attrs[k]=v}
 addEventListener(){}
 getContext(){return {}}
}
test('manual results save, reset, and filter without answer input or grading',async()=>{
 const savedGlobals={document:globalThis.document,Option:globalThis.Option,ResizeObserver:globalThis.ResizeObserver};
 const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id)};
 globalThis.document={getElementById:node,createElement:()=>new Node(),createTextNode:text=>({textContent:text})};
 globalThis.Option=class extends Node{constructor(label,value){super();this.value=value;this.textContent=label}};
 globalThis.ResizeObserver=class{observe(){}};
 const writes=[];
 try{
  const pad=createSolvePad({call:async(path,payload)=>{if(payload){writes.push(payload);return {saved:true}}return []},json:x=>structuredClone(x),notify(){},onError:e=>{throw Error(e)}});
  pad.setWritable(true);
  await pad.load('pack',{pack:{questions:[{id:'a',promptMd:'첫 문제'},{id:'b',promptMd:'둘 문제'}]}});
  node('solveWrong').onclick();await pad.flush();assert.equal(writes.at(-1).result,'wrong');
  node('solveFilter').value='wrong';node('solveFilter').onchange();assert.equal(node('solveQuestionSelect').options.length,1);
  assert.equal(node('solveNext').disabled,true);
  node('solveCorrect').onclick();await pad.flush();assert.equal(writes.at(-1).result,'correct');
  assert.equal(node('solveSheet').hidden,true);assert.equal(node('solveFilteredEmpty').hidden,false);
  node('solveFilter').value='all';node('solveFilter').onchange();
  node('solveUnmarked').onclick();await pad.flush();assert.equal(writes.at(-1).result,'');
  assert.equal(nodes.has('solveAnswer'),false);assert.equal(nodes.has('solveCheck'),false);
  assert.equal(node('solveCorrect').attrs['aria-pressed'],'false');assert.equal(node('solveUnmarked').attrs['aria-pressed'],'true');
  await pad.reset();
 }finally{Object.assign(globalThis,savedGlobals)}
});
