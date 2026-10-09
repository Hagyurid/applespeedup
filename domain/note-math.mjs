/** Mechanical notation conversion for legacy code-formatted equations. No value inference. */
export function legacyEquationTex(value){
 const source=String(value);
 if(!/[=∝√]|^[A-Za-z]+_[A-Za-z0-9{]/.test(source)||/[가-힣]/.test(source))return null;
 if(/\\(?:frac|sqrt|sum|int|mathrm)/.test(source))return source;
 const sub='₀₁₂₃₄₅₆₇₈₉',sup='⁰¹²³⁴⁵⁶⁷⁸⁹';
 let text=source.replace(/_([A-Za-z]+[₀-₉]+[A-Za-z]*)/g,'_{$1}').replace(/_((?:rms|total|dry|ideal|air|eq))(?=[^A-Za-z]|$)/g,'_{\\mathrm{$1}}').replace(/[₀-₉]+/g,s=>'_{'+[...s].map(c=>sub.indexOf(c)).join('')+'}')
  .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]+/g,s=>'^{'+[...s].map(c=>sup.includes(c)?sup.indexOf(c):c==='⁻'?'-':'+').join('')+'}')
  .replace(/½/g,'\\frac{1}{2}').replace(/ū/g,'\\bar{u}').replace(/[⁠]/g,'');
 for(let at=text.lastIndexOf('√');at>=0;at=text.lastIndexOf('√',at-1)){
  let end=at+1,body='';
  if(text[end]==='('){let depth=1;const start=++end;while(end<text.length&&depth){if(text[end]==='(')depth++;if(text[end]===')')depth--;if(depth)end++;}if(depth)return null;body=text.slice(start,end);end++;}
  else{const match=/^[A-Za-z0-9]+(?:[_^]\{[^{}]+\})*/.exec(text.slice(end));if(!match)return null;body=match[0];end+=body.length;}
  text=text.slice(0,at)+'\\sqrt{'+body+'}'+text.slice(end);if(at===0)break;
 }
 text=text.replace(/〈/g,'\\langle ').replace(/〉/g,'\\rangle ');
 const atom='[A-Za-z0-9α-ωΑ-Ω]+(?:[_^](?:\\{[^{}]+\\}|[A-Za-z0-9]+))*';
 text=text.replace(new RegExp('('+atom+')/\\(([^()]+)\\)','g'),'\\frac{$1}{$2}')
  .replace(new RegExp('\\(([^()]+)\\)/('+atom+')','g'),'\\frac{$1}{$2}')
  .replace(new RegExp('('+atom+')/('+atom+')','g'),'\\frac{$1}{$2}');
 const symbols={'ρ':'rho','α':'alpha','β':'beta','γ':'gamma','δ':'delta','Δ':'Delta','λ':'lambda','μ':'mu','π':'pi','σ':'sigma','τ':'tau','θ':'theta','ε':'epsilon','η':'eta','ω':'omega','∝':'propto','≈':'approx','×':'times','·':'cdot','∞':'infty'};
 text=text.replace(/[ραβγδΔλμπστθεηω∝≈×·∞]/g,c=>'\\'+symbols[c]+' ');
 return text;
}
