import test from 'node:test';
import assert from 'node:assert/strict';
import {renderNoteMarkdown} from '../web/note-render.js';
class Node{
 constructor(tag,text=''){this.tagName=tag;this.textContent=text;this.childNodes=[];this.className='';}
 append(...nodes){this.childNodes.push(...nodes);}
 replaceChildren(...nodes){this.childNodes=nodes;}
 setAttribute(key,value){this[key]=value;}
 get lastChild(){return this.childNodes.at(-1);}
}
test('print breaks preserve content, avoid empty pages and stay literal inside code blocks',()=>{
 const previous=globalThis.document;
 globalThis.document={createElement:tag=>new Node(tag),createTextNode:text=>new Node('#text',text)};
 try{
  const target=new Node('article');
  renderNoteMarkdown(target,'<!-- pagebreak -->\n\n첫 문단\n<!-- pagebreak -->\n<!-- pagebreak -->\n## 다음 단원\n\n둘째 문단\n\n<!-- pagebreak -->',{compactIntroduction:false});
  assert.deepEqual(target.childNodes.map(x=>x.className||x.tagName),['p','note-page-break','h2','p']);
  assert.equal(target.childNodes[0].childNodes[0].textContent,'첫 문단');
  assert.equal(target.childNodes[3].childNodes[0].textContent,'둘째 문단');
  renderNoteMarkdown(target,'```\n<!-- pagebreak -->\n```',{compactIntroduction:false});
  assert.equal(target.childNodes[0].tagName,'pre');assert.equal(target.childNodes[0].childNodes[0].textContent,'<!-- pagebreak -->');
 }finally{globalThis.document=previous;}
});

test('table math and escaped pipes stay in their cells and numbered lists retain start',()=>{
 const previous=globalThis.document;globalThis.document={createElement:tag=>new Node(tag),createTextNode:text=>new Node('#text',text)};
 try{const target=new Node('article');renderNoteMarkdown(target,'| 식 | 설명 |\n| --- | --- |\n| $|x|$ | a\\|b |\n\n5. 다섯째\n6. 여섯째',{compactIntroduction:false});
 const row=target.childNodes[0].childNodes[0].childNodes[1].childNodes[0];assert.equal(row.childNodes.length,2);assert.equal(row.childNodes[0].childNodes[0].textContent,'|x|');assert.equal(row.childNodes[1].childNodes[0].textContent,'a|b');assert.equal(target.childNodes[1].start,'5');
 }finally{globalThis.document=previous}
});
