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
export async function preparePdfPages({materialId,file,call,json,onProgress,cancelled}){
  const lib=await pdfjs();
  const bytes=new Uint8Array(await file.arrayBuffer());
  const loading=lib.getDocument({data:bytes,isEvalSupported:false,useSystemFonts:true});
  let pdf;
  try{
    pdf=await loading.promise;
    if(pdf.numPages<1||pdf.numPages>1000)throw Error('PDF 페이지 수가 지원 범위를 벗어났습니다.');
    await call('/api/v2/pdf-pages',json({material_id:materialId,page_count:pdf.numPages}));
    const status=await call('/api/v2/page-status?id='+encodeURIComponent(materialId));
    const ready=new Set(status.prepared_pages);
    for(let number=1;number<=pdf.numPages;number++){
      if(cancelled())break;
      const page=await pdf.getPage(number);
      if(ready.has(number)){
        try{
          let content;try{content=await page.getTextContent();}catch{content={items:[]};}
          await call('/api/v2/page-text',json({material_id:materialId,page_num:number,
            text:content.items.map(item=>item.str||'').join(' ').slice(0,100000)}));
          onProgress(number,pdf.numPages);
        }finally{page.cleanup();}
        continue;
      }
      const bounds=page.getViewport({scale:1});
      const scale=Math.min(2,1600/Math.max(bounds.width,bounds.height));
      const viewport=page.getViewport({scale});
      const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(viewport.width));
      canvas.height=Math.max(1,Math.round(viewport.height));
      try{
        const ctx=canvas.getContext('2d',{alpha:false});
        if(!ctx)throw Error('이 기기에서 PDF 페이지를 그릴 수 없습니다.');
        ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
        await page.render({canvasContext:ctx,viewport,canvas}).promise;
        const preview=await jpeg(canvas);
        await call('/api/v2/page-image',{method:'POST',headers:{'Content-Type':'image/jpeg','X-Material-Id':materialId,'X-Page-Num':String(number)},body:preview});
        let content;
        try{content=await page.getTextContent();}catch{content={items:[]};}
        const text=content.items.map(item=>item.str||'').join(' ').slice(0,100000);
        await call('/api/v2/page-text',json({material_id:materialId,page_num:number,text}));
        onProgress(number,pdf.numPages);
      }finally{canvas.width=0;canvas.height=0;page.cleanup();}
    }
    return {pageCount:pdf.numPages,paused:cancelled()};
  }finally{
    if(pdf)await pdf.destroy();
    else await loading.destroy();
  }
}
