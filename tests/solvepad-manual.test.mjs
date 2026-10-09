import test from 'node:test';
import assert from 'node:assert/strict';
import {createSolvePad} from '../web/solvepad.js';
class Node{
 constructor(){this.childNodes=[];this.value='all';this.style={};this.classList={add(){},toggle(){}};this.clientWidth=0;this.clientHeight=0;this.attrs={};this.listeners={};}
 append(...nodes){this.childNodes.push(...nodes)}
 replaceChildren(...nodes){this.childNodes=nodes}
 get children(){return this.childNodes}
 get options(){return this.childNodes}
 add(node){this.append(node)}
 setAttribute(k,v){this.attrs[k]=v}
 addEventListener(name,fn){this.listeners[name]=fn}
 setPointerCapture(){}
 getBoundingClientRect(){return {left:0,top:0,width:100,height:100}}
 getContext(){return {}}
}
test('manual results save, reset, and filter without answer input or grading',async()=>{
 const savedGlobals={document:globalThis.document,Option:globalThis.Option,ResizeObserver:globalThis.ResizeObserver};
 const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id)};
 globalThis.document={getElementById:node,createElement:()=>new Node(),createTextNode:text=>({textContent:text})};
 globalThis.Option=class extends Node{constructor(label,value){super();this.value=value;this.textContent=label}};
 globalThis.ResizeObserver=class{observe(){}};
 const writes=[];let failPack=false,releaseSave=null;
 try{
  const pad=createSolvePad({call:async(path,payload)=>{if(payload){writes.push(payload);if(releaseSave)await releaseSave;return {saved:true}}if(failPack)throw Error('load failed');return []},json:x=>structuredClone(x),notify(){},onError:e=>{throw Error(e)}});
  pad.setWritable(true);
  await pad.load('pack',{pack:{questions:[{id:'a',promptMd:'첫 문제'},{id:'b',promptMd:'둘 문제'}]}});
  node('solveHint').onclick();assert.equal(node('solveReveal').hidden,false);assert.equal(node('solveHint').attrs['aria-expanded'],'true');
  node('solveHint').onclick();assert.equal(node('solveReveal').hidden,true);
  node('solveHint').onclick();node('solveSolution').onclick();assert.equal(node('solveHint').attrs['aria-expanded'],'false');assert.equal(node('solveSolution').attrs['aria-expanded'],'true');
  node('solveReveal').childNodes[0].onclick();assert.equal(node('solveReveal').hidden,true);assert.equal(node('solveSolution').attrs['aria-expanded'],'false');assert.equal(writes.length,0);
  node('solveWrong').onclick();await pad.flush();assert.equal(writes.at(-1).result,'wrong');
  node('solveFilter').value='wrong';node('solveFilter').onchange();assert.equal(node('solveQuestionSelect').options.length,1);
  assert.equal(node('solveNext').disabled,true);
  node('solveCorrect').onclick();await pad.flush();assert.equal(writes.at(-1).result,'correct');
  assert.equal(node('solveSheet').hidden,true);assert.equal(node('solveFilteredEmpty').hidden,false);
  node('solveFilter').value='all';node('solveFilter').onchange();
  node('solveUnmarked').onclick();await pad.flush();assert.equal(writes.at(-1).result,'');
  assert.equal(nodes.has('solveAnswer'),false);assert.equal(nodes.has('solveCheck'),false);
  assert.equal(node('solveCorrect').attrs['aria-pressed'],'false');assert.equal(node('solveUnmarked').attrs['aria-pressed'],'true');
  failPack=true;await assert.rejects(()=>pad.load('other',{pack:{questions:[{id:'other',promptMd:'다른 문제'}]}}),/load failed/);failPack=false;
  node('solveWrong').onclick();await pad.flush();assert.equal(writes.at(-1).pack_id,'pack');
  // Navigation must freeze edits while a slow save is in flight.
  let release;releaseSave=new Promise(resolve=>{release=resolve});
  node('solveCorrect').onclick();node('solveNext').onclick();
  await new Promise(resolve=>setImmediate(resolve));assert.equal(node('solveWrong').disabled,true);
  node('solveWrong').onclick();assert.equal(node('solveCorrect').attrs['aria-pressed'],'true');
  release();releaseSave=null;await new Promise(resolve=>setImmediate(resolve));
  assert.equal(node('solveQuestionTitle').textContent,'문제 2');assert.equal(writes.at(-1).result,'correct');
  assert.equal(node('solveReveal').hidden,true);
  assert.equal(writes.at(-1).expected_revision,4);
  await pad.reset();
 }finally{Object.assign(globalThis,savedGlobals)}
});
test('many strokes stay local and save together once when moving to another problem',async(t)=>{
 const savedGlobals={document:globalThis.document,Option:globalThis.Option,ResizeObserver:globalThis.ResizeObserver,localStorage:globalThis.localStorage,window:globalThis.window};
 const nodes=new Map(),storage=new Map(),lifecycle={};const node=id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id)};
 globalThis.document={getElementById:node,createElement:()=>new Node(),createTextNode:text=>({textContent:text})};
 globalThis.Option=class extends Node{constructor(label,value){super();this.value=value;this.textContent=label}};
 globalThis.ResizeObserver=class{observe(){}};
 globalThis.window={addEventListener:(name,fn)=>{lifecycle[name]=fn}};
 globalThis.localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
 t.mock.timers.enable({apis:['setTimeout']});
 const writes=[],errors=[];let failSave=false;
 try{
  const pad=createSolvePad({call:async(path,payload)=>{if(payload){if(failSave)throw Error('offline');writes.push(payload);return {revision:1}}return []},json:x=>structuredClone(x),notify(){},onError:e=>errors.push(e)});
  pad.setStorageUser('user');pad.setWritable(true);await pad.load('pack',{pack:{questions:[{id:'a'},{id:'b'}]}});
  const event={button:0,pointerId:1,clientX:20,clientY:30,preventDefault(){}};
  for(let i=0;i<20;i++){node('solveInk').listeners.pointerdown(event);node('solveInk').listeners.pointerup(event);t.mock.timers.tick(1300)}
  assert.equal(writes.length,0);assert.equal(JSON.parse([...storage.values()][0]).strokes[0].length,20);
  node('solveNext').onclick();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(writes.length,1);assert.equal(writes[0].question_id,'a');assert.equal(writes[0].strokes[0].length,20);assert.equal(storage.size,0);
  node('solveInk').listeners.pointerdown(event); // An active stroke must be included on leaving.
  failSave=true;await assert.rejects(()=>pad.saveCurrent(),/offline/);assert.equal(writes.length,1);assert.equal(storage.size,1);
  assert.equal(JSON.parse([...storage.values()][0]).question_id,'b');
  failSave=false;await pad.saveCurrent();assert.equal(writes.length,2);assert.equal(writes[1].strokes[0].length,1);
  node('solveWrong').onclick();lifecycle.pagehide();assert.equal(JSON.parse([...storage.values()][0]).result,'wrong');assert.equal(writes.length,2);
  await pad.reset();
 }finally{t.mock.timers.reset();Object.assign(globalThis,savedGlobals)}
});
