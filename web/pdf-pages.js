/** Render PDF pages locally. No model call runs during upload. */
let library;
async function pdfjs(){
  if(!library){
    library=await import('/vendor/pdfjs/pdf.mjs');
    library.GlobalWorkerOptions.workerSrc='/vendor/pdfjs/pdf.worker.mjs';
  }
  return library;
}
async function jpeg(canvas){
  let width=canvas.width,height=canvas.height;
  for(let attempt=0;attempt<6;attempt++){
    const output=document.createElement('canvas');
    output.width=width;output.height=height;
    output.getContext('2d',{alpha:false}).drawImage(canvas,0,0,width,height);
    const blob=await new Promise(resolve=>output.toBlob(resolve,'image/jpeg',.82));
    output.width=0;output.height=0;
    if(blob&&blob.size>=50&&blob.size<=1024*1024)return blob;
    width=Math.max(1,Math.floor(width*.78));height=Math.max(1,Math.floor(height*.78));
  }
  throw Error('페이지 이미지를 1 MiB 이하로 변환하지 못했습니다.');
}
export async function preparePdfPages({materialId,file,call,json,onProgress,cancelled,loadPdf=pdfjs}){
  const lib=await loadPdf();
  const bytes=new Uint8Array(await file.arrayBuffer());
  const loading=lib.getDocument({data:bytes,isEvalSupported:false,useSystemFonts:true});
  let pdf;
  try{
    pdf=await loading.promise;
    if(pdf.numPages<1||pdf.numPages>1000)throw Error('PDF 페이지 수가 지원 범위를 벗어났습니다.');
    await call('/api/v2/pdf-pages',json({material_id:materialId,page_count:pdf.numPages}));
    const status=await call('/api/v2/page-status?id='+encodeURIComponent(materialId));
    const images=new Set(status.prepared_pages),textReady=new Set(status.text_ready_pages||[]);
    const ready=new Set([...images].filter(number=>textReady.has(number)));
    let stopped=false;
    // Keep at most three PDF.js render/upload jobs in flight to limit canvas memory.
    // A finished page is counted only after both image and text are stored.
    let next=1, completed=0;
    const concurrency=Math.min(3,pdf.numPages);
    async function worker(){
      while(next<=pdf.numPages&&!cancelled()&&!stopped){
        const number=next++;
        if(ready.has(number)){completed++;onProgress(completed,pdf.numPages);continue;}
        let canvas,page;
        try{
          page=await pdf.getPage(number);
          if(!images.has(number)){
            const bounds=page.getViewport({scale:1});
            const viewport=page.getViewport({scale:Math.min(2,1600/Math.max(bounds.width,bounds.height))});
            canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(viewport.width));canvas.height=Math.max(1,Math.round(viewport.height));
            const ctx=canvas.getContext('2d',{alpha:false});if(!ctx)throw Error('이 기기에서 PDF 페이지를 그릴 수 없습니다.');
            ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
            await page.render({canvasContext:ctx,viewport,canvas}).promise;
            const preview=await jpeg(canvas);
            await call('/api/v2/page-image',{method:'POST',headers:{'Content-Type':'image/jpeg','X-Material-Id':materialId,'X-Page-Num':String(number)},body:preview});
          }
          const content=await page.getTextContent();
          const text=content.items.map(item=>item.str||'').join(' ').slice(0,100000);
          await call('/api/v2/page-text',json({material_id:materialId,page_num:number,text}));
          completed++;onProgress(completed,pdf.numPages);
        }catch(e){stopped=true;throw e;}finally{if(canvas){canvas.width=0;canvas.height=0;}page?.cleanup();}
      }
    }
    const results=await Promise.allSettled(Array.from({length:concurrency},()=>worker()));
    const failure=results.find(x=>x.status==='rejected');if(failure)throw failure.reason;
    return {pageCount:pdf.numPages,paused:cancelled()};
  }finally{
    if(pdf)await pdf.destroy();
    else await loading.destroy();
  }
}
