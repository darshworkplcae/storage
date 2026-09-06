// TELEDRIVE — Telegram Bot API (via your laptop, 2GB support)
function tgUrl(ep){return `${LOCAL_API}/bot${S.cfg.botToken}/${ep}`;}

function uploadChunk(blob,name,onProgress){
  return new Promise((res,rej)=>{
    const fd=new FormData();fd.append('chat_id',S.cfg.chatId);fd.append('document',blob,name);
    const xhr=new XMLHttpRequest();xhr.open('POST',tgUrl('sendDocument'));xhr.timeout=0;
    xhr.upload.onprogress=e=>{if(e.lengthComputable&&onProgress)onProgress(e.loaded,e.total);};
    xhr.onload=()=>{try{const d=JSON.parse(xhr.responseText);if(d.ok)res(d.result);else rej(new Error(d.description||'Telegram error'));}catch(e){rej(e);}};
    xhr.onerror=()=>rej(new Error('Network error — is your laptop online?'));
    xhr.send(fd);S._xhr=xhr;
  });
}

async function uploadFiles(files){
  if(S.uploading){toast('Upload already in progress','warning');return;}
  if(!S.cfg.botToken||!S.cfg.chatId){toast('Bot not configured','error');return;}
  if(!S.driveId){toast('Open a drive first','error');return;}
  S.uploading=true;S.cancelUpload=false;
  const bar=$('upBar');bar.classList.remove('hidden');
  $('upCancelBtn').onclick=()=>{S.cancelUpload=true;S._xhr?.abort();toast('Cancelling...','warning');};
  for(const file of Array.from(files)){if(S.cancelUpload)break;try{await uploadOne(file);}catch(e){toast(`Failed: ${file.name} — ${e.message}`,'error');}}
  S.uploading=false;bar.classList.add('hidden');$('fileInput').value='';
  await saveDB();renderExplorer();
}

async function uploadOne(file){
  const setUI=(name,status,pct)=>{$('upName').textContent=name;$('upStatus').textContent=status;$('upPct').textContent=pct+'%';$('upFill').style.width=pct+'%';};
  const fid=uid();const isChunked=file.size>CHUNK_B;const totalChunks=isChunked?Math.ceil(file.size/CHUNK_B):1;const chunks=[];
  for(let i=0;i<totalChunks;i++){
    if(S.cancelUpload)throw new Error('Cancelled');
    const start=i*CHUNK_B;const blob=file.slice(start,Math.min(start+CHUNK_B,file.size));
    const cname=isChunked?`${file.name}.part${String(i+1).padStart(3,'0')}of${totalChunks}`:file.name;
    const result=await uploadChunk(blob,cname,(loaded,total)=>{
      const cp=loaded/total,overall=((i+cp)/totalChunks)*100;
      const mb=(loaded/(1024*1024)).toFixed(1),tmb=(total/(1024*1024)).toFixed(1);
      setUI(file.name,`${isChunked?`Chunk ${i+1}/${totalChunks} · `:''}${mb}/${tmb} MB`,Math.round(overall));
    });
    const doc=result.document||result.video||result.audio||(result.photo?result.photo[result.photo.length-1]:null);
    chunks.push({idx:i,msgId:result.message_id,fileId:doc?.file_id||'',size:blob.size});
  }
  S.db.files.push({id:fid,driveId:S.driveId,folderId:S.folderId,name:file.name,size:file.size,type:file.type||'application/octet-stream',date:new Date().toISOString(),isChunked,chunks});
  toast(`${file.name} uploaded${isChunked?` (${totalChunks} chunks)`:''}`,'success');
}

async function tgFileUrl(fileId){
  try{const r=await fetch(tgUrl(`getFile?file_id=${fileId}`));const d=await r.json();if(d.ok&&d.result.file_path)return `${LOCAL_API}/file/bot${S.cfg.botToken}/${d.result.file_path}`;}catch{}return null;
}
async function tgDelete(msgId){
  try{const r=await fetch(tgUrl(`deleteMessage?chat_id=${S.cfg.chatId}&message_id=${msgId}`));const d=await r.json();return d.ok;}catch{return false;}
}
async function downloadFile(f){
  if(!f.isChunked){const url=await tgFileUrl(f.chunks[0].fileId);if(url){dlLink(url,f.name);return;}toast('Could not get download URL','error');return;}
  toast(`Merging ${f.chunks.length} chunks...`,'info');
  try{
    const blobs=[];
    for(let i=0;i<f.chunks.length;i++){toast(`Fetching chunk ${i+1}/${f.chunks.length}...`,'info');const url=await tgFileUrl(f.chunks[i].fileId);if(!url)throw new Error(`No URL for chunk ${i+1}`);const r=await fetch(url);if(!r.ok)throw new Error(`Chunk ${i+1} failed`);blobs.push(await r.blob());}
    const merged=new Blob(blobs,{type:f.type});const url=URL.createObjectURL(merged);dlLink(url,f.name);setTimeout(()=>URL.revokeObjectURL(url),8000);toast(`${f.name} downloaded`,'success');
  }catch(e){toast(`Download failed: ${e.message}`,'error');}
}
async function deleteFile(f){for(const c of f.chunks)await tgDelete(c.msgId);S.db.files=S.db.files.filter(x=>x.id!==f.id);await saveDB();renderExplorer();toast(`${f.name} deleted`,'success');}
async function deleteFolder(folder){
  const ids=getAllFolderIds(folder.id);const toDelete=S.db.files.filter(f=>ids.includes(f.folderId));
  for(const f of toDelete)for(const c of f.chunks)await tgDelete(c.msgId);
  S.db.files=S.db.files.filter(f=>!ids.includes(f.folderId));S.db.folders=S.db.folders.filter(f=>!ids.includes(f.id));
  await saveDB();renderExplorer();toast(`${folder.name} deleted`,'success');
}
function getAllFolderIds(fid){const ids=[fid];S.db.folders.filter(f=>f.parentId===fid).forEach(f=>ids.push(...getAllFolderIds(f.id)));return ids;}

async function openMedia(f){
  const t=f.type||'';const isImg=t.startsWith('image/');const isVid=t.startsWith('video/');const isAud=t.startsWith('audio/');
  if(!isImg&&!isVid&&!isAud){toast('No preview for this file type','info');return;}
  let url=null;if(!f.isChunked)url=await tgFileUrl(f.chunks[0].fileId);
  const ov=document.createElement('div');ov.className='media-ov';
  ov.innerHTML=`<div class="media-hd"><div class="media-hd-title">${esc(f.name)}</div><div class="media-hd-acts"><button class="icon-btn" id="mdlDl" title="Download"><i class="fas fa-download"></i></button><button class="icon-btn" id="mdlCls" title="Close"><i class="fas fa-times"></i></button></div></div><div class="media-body" id="mediaBody">${url?'':`<div style="color:var(--text2)"><i class="fas fa-spinner spin" style="font-size:2rem;color:var(--primary)"></i></div>`}</div><div class="media-ft"><span>${esc(f.name)}</span><span>·</span><span>${fmt(f.size)}</span>${f.isChunked?'<span style="color:var(--warning)">⚡ Chunked</span>':''}</div>`;
  document.body.appendChild(ov);
  const body=ov.querySelector('#mediaBody');
  if(url){
    if(isImg){const img=document.createElement('img');img.className='media-img';img.src=url;img.alt=f.name;let z=false;img.onclick=()=>{z=!z;img.classList.toggle('zoomed',z);img.style.transform=z?'scale(2.2)':'';};body.innerHTML='';body.appendChild(img);}
    else if(isVid){const v=document.createElement('video');v.className='media-vid';v.controls=v.autoplay=true;v.src=url;body.innerHTML='';body.appendChild(v);}
    else if(isAud){body.innerHTML=`<div style="text-align:center;padding:2rem"><i class="fas fa-music" style="font-size:4rem;color:var(--primary);margin-bottom:1.5rem;display:block"></i><audio controls style="width:80%;max-width:400px" src="${url}"></audio></div>`;}
  }
  ov.querySelector('#mdlCls').onclick=()=>ov.remove();ov.querySelector('#mdlDl').onclick=()=>downloadFile(f);
  ov.addEventListener('keydown',e=>{if(e.key==='Escape')ov.remove();});ov.tabIndex=0;ov.focus();
}