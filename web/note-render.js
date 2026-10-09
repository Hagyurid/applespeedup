import {legacyEquationTex} from '../domain/note-math.mjs';
import {compactNoteIntroduction} from '../domain/note-presentation.mjs';
/** Safe study-note preview. Markdown syntax becomes DOM nodes, never raw HTML. */
const katex=import('/vendor/katex/katex.mjs').catch(()=>null);
let mathTasks=[];
export async function noteMathReady(){await Promise.all(mathTasks);}
const el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
function inline(target,text){
  const tokens=/(\$\$([^$]+)\$\$|\$([^$\n]+)\$|\*\*([^*]+)\*\*|==([^=]+)==|`([^`]+)`)/g;
  let cursor=0,match;
  while((match=tokens.exec(text))){
    if(match.index>cursor)target.append(document.createTextNode(text.slice(cursor,match.index)));
    if(match[2]||match[3]){
      const tex=match[2]||match[3],display=!!match[2];
      const span=el('span',tex);span.className=display?'note-math display':'note-math';target.append(span);
      mathTasks.push(katex.then(lib=>{if(lib&&span.isConnected)lib.render(tex,span,{throwOnError:false,trust:false,displayMode:display});}));
    }else if(match[4]){const strong=el('strong');inline(strong,match[4]);target.append(strong);}
    else if(match[5])target.append(el('mark',match[5]));
    else if(legacyEquationTex(match[6])){
      const matchValue=match[6],tex=legacyEquationTex(matchValue);const span=el('span',tex);span.className='note-math';target.append(span);
      mathTasks.push(katex.then(lib=>{if(lib&&span.isConnected){try{lib.render(tex,span,{throwOnError:true,trust:false,displayMode:false});}catch{span.replaceWith(el('code',matchValue));}}}));
    }else target.append(el('code',match[6]));
    cursor=tokens.lastIndex;
  }
  if(cursor<text.length)target.append(document.createTextNode(text.slice(cursor)));
}
export function renderNoteMarkdown(target,markdown,{compactIntroduction=true,pageBreaks=true}={}){
  mathTasks=[];target.replaceChildren();const lines=(compactIntroduction?compactNoteIntroduction(markdown):String(markdown||'')).replace(/\\\(/g,'$').replace(/\\\)/g,'$').replace(/\\\[/g,()=> '$$').replace(/\\\]/g,()=> '$$').replace(/\r\n?/g,'\n').split('\n');
  let i=0;
  while(i<lines.length){
    const line=lines[i];if(!line.trim()){i++;continue}
    if(pageBreaks&&/^\s*<!--\s*pagebreak\s*-->\s*$/.test(line)){
      if(target.childNodes.length&&lines.slice(i+1).some(x=>x.trim()&&!/^\s*<!--\s*pagebreak\s*-->\s*$/.test(x))&&target.lastChild?.className!=='note-page-break'){
        const marker=el('div');marker.className='note-page-break';marker.setAttribute('role','separator');marker.setAttribute('aria-label','인쇄 쪽 나눔');marker.append(el('span','쪽 나눔'));target.append(marker);
      }
      i++;continue;
    }
    if(line.trim()==='$$'){
      const tex=[];i++;while(i<lines.length&&lines[i].trim()!=='$$')tex.push(lines[i++]);if(i<lines.length)i++;
      const block=el('div',tex.join('\n'));block.className='note-math display';target.append(block);
      mathTasks.push(katex.then(lib=>{if(lib)lib.render(tex.join('\n'),block,{throwOnError:false,trust:false,displayMode:true});}));continue;
    }
    if(/^```/.test(line)){
      const code=[];i++;
      while(i<lines.length&&!/^```/.test(lines[i]))code.push(lines[i++]);
      if(i<lines.length)i++;
      const pre=el('pre');pre.append(el('code',code.join('\n')));target.append(pre);continue;
    }
    const heading=/^(#{1,6})\s+(.+)$/.exec(line);
    if(heading){const h=el('h'+heading[1].length);inline(h,heading[2]);target.append(h);i++;continue;}
    if(/^\s*\|/.test(line)&&i+1<lines.length&&/^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i+1])&&lines[i+1].includes('-')){
      const table=el('table'),head=el('thead'),body=el('tbody');
      const cells=row=>row.trim().replace(/^\||\|$/g,'').split('|').map(x=>x.trim());
      const tr=el('tr');for(const value of cells(line)){const th=el('th');inline(th,value);tr.append(th)}head.append(tr);i+=2;
      while(i<lines.length&&/^\s*\|/.test(lines[i])){const row=el('tr');for(const value of cells(lines[i++])){const td=el('td');inline(td,value);row.append(td)}body.append(row)}
      table.append(head,body);const wrap=el('div');wrap.className='note-table-wrap';wrap.append(table);target.append(wrap);continue;
    }
    const list=/^\s*([-*]|\d+\.)\s+(.+)$/.exec(line);
    if(list){const ordered=/\d/.test(list[1]),group=el(ordered?'ol':'ul');
      while(i<lines.length){const item=/^\s*([-*]|\d+\.)\s+(.+)$/.exec(lines[i]);if(!item||/\d/.test(item[1])!==ordered)break;const li=el('li');inline(li,item[2]);group.append(li);i++}target.append(group);continue;
    }
    if(/^>\s?/.test(line)){const quote=el('blockquote');while(i<lines.length&&/^>\s?/.test(lines[i])){const p=el('p');inline(p,lines[i++].replace(/^>\s?/,''));quote.append(p)}target.append(quote);continue;}
    const paragraph=[];
    while(i<lines.length&&lines[i].trim()&&!/^(#{1,6}\s|```|<!--\s*pagebreak\s*-->|\$\$|>\s?|\s*([-*]|\d+\.)\s+)/.test(lines[i]))paragraph.push(lines[i++]);
    if(!paragraph.length){paragraph.push(lines[i++]);}
    const p=el('p');paragraph.forEach((part,index)=>{if(index)p.append(el('br'));inline(p,part)});target.append(p);
  }
  if(!target.childNodes.length)target.append(el('p','정리본을 선택하거나 작성하면 여기에서 문서 형태로 미리 볼 수 있어요.'));
}
