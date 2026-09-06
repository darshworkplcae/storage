// TELEDRIVE — Telegram Bot API
function tgUrl(ep){return `${LOCAL_API}/bot${S.cfg.botToken}/${ep}`;}

function uploadChunkXhr(blob,name,onProgress){
  return new Promise((res,rej)=>{
    const fd=new FormData();fd.append('chat_id',S.cfg.chatId);fd.append('document',blob,name);
    const xhr=new XMLHttpRequest();xhr.open('POST',tgUrl('sendDocument'));xhr.timeout=0;
    let _lastLoaded=0,_lastTime=Date.now(),_speed=0;
    xhr.upload.onprogress=e=>{
      if(!e.lengthComputable)return;
      const now=Date.now();const dt=(now-_lastTime)/1000;
      if(dt>=0.4){_speed=(e.loaded-_lastLoaded)/dt;_lastLoaded=e.loaded;_lastTime=now;}
      if(onProgress)onProgress(e.loaded,e.total,_speed);
    };
    xhr.onload=()=>{try{const d=JSON.parse(xhr.responseText);if(d.ok)res(d.result);else rej(new Error(d.description||'Telegram API error'));}catch(e){rej(e);}};
    xhr.onerror=()=>rej(new Error('Network error — is laptop on? Check Tailscale Funnel'));
    xhr.onabort=()=>rej(new Error('Cancelled'));
    xhr.send(fd);S._xhr=xhr;
  });
}

async function uploadFiles(files){
  if(S.uploading){toast('Upload in progress','warning');return;}
  if(!S.cfg.botToken||!S.cfg.chatId){toast('Bot not configured','error');return;}
  if(!S.driveId){toast('Open a drive first','error');return;}
  S.uploading=true;S.cancelUpload=false;
  const bar=$('upBar');bar.classList.remove('hidden');
  $('upCancelBtn').onclick=()=>{S.cancelUpload=true;S._xhr?.abort();toast('Cancelling...','warning');};
  for(const file of Array.from(files)){
    if(S.cancelUpload)break;
    try{await uploadOne(file);}
    catch(e){if(e.message!=='Cancelled')toast(`Failed: ${file.name} — ${e.message}`,'error');}
  }
  S.uploading=false;bar.classList.add('hidden');$('fileInput').value='';
  await saveDB();renderExplorer();
}

async function uploadOne(file){
  const tid=uid();
  const fid=uid();const isChunked=file.size>CHUNK_B;const totalChunks=isChunked?Math.ceil(file.size/CHUNK_B):1;const chunks=[];
  $('upName').textContent=file.name;$('upStatus').textContent='Starting...';$('upPct').textContent='0%';$('upFill').style.width='0%';
  tmAdd(tid,file.name,file.size);
  let totalUploaded=0;
  for(let i=0;i<totalChunks;i++){
    if(S.cancelUpload){tmDone(tid,false);throw new Error('Cancelled');}
    const start=i*CHUNK_B;const blob=file.slice(start,Math.min(start+CHUNK_B,file.size));
    const cname=isChunked?`${file.name}.part${String(i+1).padStart(3,'0')}of${totalChunks}`:file.name;
    const result=await uploadChunkXhr(blob,cname,(loaded,total,speed)=>{
      // Overall progress across all chunks
      const overallLoaded=totalUploaded+loaded;
      const overallPct=Math.round((overallLoaded/file.size)*100);
      const uploadedMB=(overallLoaded/(1024*1024)).toFixed(1);
      const totalMB=(file.size/(1024*1024)).toFixed(1);
      const speedMBs=(speed/(1024*1024)).toFixed(1);
      // Bottom bar
      const chunkLabel=isChunked?` (Part ${i+1}/${totalChunks})`:'';
      $('upName').textContent=file.name;
      $('upStatus').textContent=`${uploadedMB}/${totalMB} MB${chunkLabel} · ${speedMBs} MB/s`;
      $('upPct').textContent=overallPct+'%';
      $('upFill').style.width=overallPct+'%';
      // Transfer panel
      tmUpdate(tid,overallPct,speed,overallLoaded,file.size);
    });
    totalUploaded+=blob.size;
    const doc=result.document||result.video||result.audio||(result.photo?result.photo[result.photo.length-1]:null);
    chunks.push({idx:i,msgId:result.message_id,fileId:doc?.file_id||'',size:blob.size});
  }
  S.db.files.push({id:fid,driveId:S.driveId,folderId:S.folderId,name:file.name,size:file.size,type:file.type||'application/octet-stream',date:new Date().toISOString(),isChunked,chunks});
  logActivity('upload',file.name,{size:file.size});
  tmDone(tid,true);
  toast(`✓ ${file.name} uploaded`,'success');
}

async function tgFileUrl(fileId){
  try{const r=await fetch(tgUrl(`getFile?file_id=${fileId}`));const d=await r.json();if(d.ok&&d.result.file_path)return `${LOCAL_API}/file/bot${S.cfg.botToken}/${d.result.file_path}`;}catch{}return null;
}
async function tgDelete(msgId){try{const r=await fetch(tgUrl(`deleteMessage?chat_id=${S.cfg.chatId}&message_id=${msgId}`));const d=await r.json();return d.ok;}catch{return false;}}
async function downloadFile(f){
  logActivity('download',f.name,{driveId:f.driveId,size:f.size});
  if(!f.isChunked){const url=await tgFileUrl(f.chunks[0].fileId);if(url){dlLink(url,f.name);toast(`↓ ${f.name}`,'success');return;}toast('Could not get URL','error');return;}
  toast(`Merging ${f.chunks.length} chunks...`,'info');
  try{const blobs=[];for(const c of f.chunks){const u=await tgFileUrl(c.fileId);if(!u)throw new Error('No URL');const r=await fetch(u);blobs.push(await r.blob());}
    const url=URL.createObjectURL(new Blob(blobs,{type:f.type}));dlLink(url,f.name);setTimeout(()=>URL.revokeObjectURL(url),8000);toast(`↓ ${f.name}`,'success');
  }catch(e){toast(`Download failed: ${e.message}`,'error');}
}
async function deleteFile(f){
  logActivity('delete_file',f.name,{driveId:f.driveId,size:f.size});
  for(const c of f.chunks)await tgDelete(c.msgId);
  S.db.files=S.db.files.filter(x=>x.id!==f.id);await saveDB();renderExplorer();toast(`${f.name} deleted`,'success');
}
async function deleteFolder(folder){
  logActivity('delete_folder',folder.name,{driveId:folder.driveId});
  const ids=getAllFolderIds(folder.id);const toDelete=S.db.files.filter(f=>ids.includes(f.folderId));
  for(const f of toDelete)for(const c of f.chunks)await tgDelete(c.msgId);
  S.db.files=S.db.files.filter(f=>!ids.includes(f.folderId));S.db.folders=S.db.folders.filter(f=>!ids.includes(f.id));
  await saveDB();renderExplorer();toast(`${folder.name} deleted`,'success');
}
function getAllFolderIds(fid){const ids=[fid];S.db.folders.filter(f=>f.parentId===fid).forEach(f=>ids.push(...getAllFolderIds(f.id)));return ids;}
async function openMedia(f){
  const t=f.type||'';const isImg=t.startsWith('image/');const isVid=t.startsWith('video/');const isAud=t.startsWith('audio/');
  if(!isImg&&!isVid&&!isAud){toast('No preview for this type','info');return;}
  logActivity('view',f.name,{driveId:f.driveId,size:f.size});
  let url=null;if(!f.isChunked)url=await tgFileUrl(f.chunks[0].fileId);
  const ov=document.createElement('div');ov.className='media-ov';
  ov.innerHTML=`<div class="media-hd"><div class="media-hd-title">${esc(f.name)}</div><div class="media-hd-acts"><button class="icon-btn" id="mdlDl"><i class="fas fa-download"></i></button><button class="icon-btn" id="mdlCls"><i class="fas fa-times"></i></button></div></div><div class="media-body" id="mediaBody">${url?'':'<i class="fas fa-spinner spin" style="font-size:2rem;color:var(--primary)"></i>'}</div><div class="media-ft"><span>${esc(f.name)}</span><span>·</span><span>${fmt(f.size)}</span>${f.isChunked?'<span style="color:var(--warning)">⚡ Chunked</span>':''}</div>`;
  document.body.appendChild(ov);
  const body=ov.querySelector('#mediaBody');
  if(url){if(isImg){const img=document.createElement('img');img.className='media-img';img.src=url;let z=false;img.onclick=()=>{z=!z;img.style.transform=z?'scale(2.2)':'';};body.innerHTML='';body.appendChild(img);}
    else if(isVid){const v=document.createElement('video');v.className='media-vid';v.controls=v.autoplay=true;v.src=url;body.innerHTML='';body.appendChild(v);}
    else if(isAud){body.innerHTML=`<div style="text-align:center;padding:2rem"><i class="fas fa-music" style="font-size:4rem;color:var(--primary);display:block;margin-bottom:1.5rem"></i><audio controls style="width:80%;max-width:400px" src="${url}"></audio></div>`;}}
  ov.querySelector('#mdlCls').onclick=()=>ov.remove();ov.querySelector('#mdlDl').onclick=()=>downloadFile(f);
  ov.addEventListener('keydown',e=>{if(e.key==='Escape')ov.remove();});ov.tabIndex=0;ov.focus();
}