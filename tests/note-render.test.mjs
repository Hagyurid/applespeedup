import test from 'node:test';
import assert from 'node:assert/strict';
import katex from 'katex';
import {renderNoteMarkdown,noteMathReady} from '../web/note-render.js';
class Node{
 constructor(tag,text=''){this.tagName=tag;this.textContent=text;this.childNodes=[];this.className='';}
 append(...nodes){this.childNodes.push(...nodes)}
 replaceChildren(...nodes){this.childNodes=nodes}
}
const walk=node=>[node,...node.childNodes.flatMap(walk)];
function withDocument(fn){const old=globalThis.document;globalThis.document={createElement:tag=>new Node(tag),createTextNode:text=>new Node('#text',text)};try{fn(new Node('article'))}finally{globalThis.document=old}}
test('screenshot equations spanning lines render as whole valid KaTeX expressions',async()=>{
 withDocument(target=>{
  renderNoteMarkdown(target,String.raw`$$C(x,t)=\frac{C_1+C_2}{2}-\frac{C_1-C_2}{2}

\operatorname{erf}\left(\frac{x}{2\sqrt{Dt}}\right),$$
여기서 왼쪽이 $C_1$, 오른쪽이 $C_2$이다.

**Nonsteady State**는 $C=C(x,t)$이다.
$$\frac{\partial C}{\partial t}

=-\frac{\partial J}{\partial x}.$$
이는 **Conservation Equation**이다.`,{compactIntroduction:false});
  const nodes=walk(target),math=nodes.filter(n=>n.className.startsWith('note-math'));
  assert.equal(math.length,5);assert.equal(math.filter(n=>n.className.includes('display')).length,2);
  for(const n of math)assert.match(katex.renderToString(n.textContent,{throwOnError:true,displayMode:n.className.includes('display')}),/katex/);
  assert.equal(nodes.some(n=>n.tagName==='#text'&&n.textContent.includes('$$')),false);
  assert.equal(nodes.filter(n=>n.tagName==='strong').length,2);
 });
 await noteMathReady();
});
test('triple emphasis, emphasis across lines and math inside emphasis retain formatting',()=>withDocument(target=>{
 renderNoteMarkdown(target,'***중요 $x_1$***\n\n**첫 줄\n둘째 줄**와 *기울임*',{compactIntroduction:false});
 const nodes=walk(target);assert.equal(nodes.filter(n=>n.tagName==='strong').length,2);assert.equal(nodes.filter(n=>n.tagName==='em').length,2);
 assert.equal(nodes.some(n=>n.className==='note-math'&&n.textContent==='x_1'),true);
 assert.equal(nodes.some(n=>n.tagName==='#text'&&n.textContent.includes('*')),false);
}));
test('code stays literal; bracket equations and aligned row breaks remain valid; unmatched math does not eat text',()=>withDocument(target=>{
 renderNoteMarkdown(target,String.raw`\[
\begin{aligned}a&=1\\b&=2\end{aligned}
\]`+'\n\n`$x$ **literal**`\n\n```tex\n'+String.raw`\[ **code** $$x
$$ \]`+'\n```\n\n$$\n끝 문단',{compactIntroduction:false});
 const nodes=walk(target),math=nodes.filter(n=>n.className==='note-math display');assert.equal(math.length,1);
 assert.match(math[0].textContent,/a&=1\\\\b&=2/);assert.doesNotThrow(()=>katex.renderToString(math[0].textContent,{throwOnError:true}));
 const code=nodes.filter(n=>n.tagName==='code');assert.equal(code[0].textContent,'$x$ **literal**');assert.match(code[1].textContent,/\*\*code\*\*/);
 assert.equal(nodes.some(n=>n.textContent==='끝 문단'),true);
}));
