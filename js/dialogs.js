// TeleDrive — Dialogs + Upload + Download + Media Preview

// ─── Upload Queue ─────────────────────────────────────────
const _Q=[];let _Qrunning=false;
async function uploadFiles(files){
  if(!S.driveId){toast('Open a drive first','warning');return;}
  if(!S.db?.drives?.find(d=>d.id===S.driveId)){toast('Drive not found','error');return;}
  Array.from(files).forEach(f=>_Q.push(f));
  $('fileInput').value='';
  toast(`${files.length} file${files.length>1?'s':''} queued`,'info');
  _processQueue();
}
async function _processQueue(){
  if(_Qrunning||!_Q.length)return;
  _Qrunning=true;S.uploading=true;S.cancelUpload=false;
  $('upBar').classList.remove('hidden');
  while(_Q.length){
    const f=_Q[0];
    try{await uploadOne(f);}
    catch(e){if(e.message!=='Cancelled')toast(`Failed: ${f.name} — ${e.message}`,'error');}
    _Q.shift();S.cancelUpload=false;
    // Refresh DB
    S.db=await apiFetchDB();renderExplorer();renderHome();renderTM();
  }
  _Qrunning=false;S.uploading=false;$('upBar').classList.add('hidden');
}
async function uploadOne(file){
  const tid=uid();
  const name=file.name;const size=file.size;const mimeType=file.type||'application/octet-stream';
  $('upName').textContent=name;$('upPct').textContent='0%';$('upFill').style.width='0%';$('upStatus').textContent='Starting…';
  tmAdd(tid,name,size);
  // Get resumable upload URL
  const init=await apiUploadInit(S.driveId,S.folderId||null,name,size,mimeType);
  if(!init.uploadUrl)throw new Error(init.error||'Could not init upload');
  // Upload directly to Google Drive
  const googleFile=await new Promise((res,rej)=>{
    uploadFileToGDrive(init.uploadUrl,file,(loaded,total,speed)=>{
      if(S.cancelUpload){S._xhr?.abort();return;}
      const pct=Math.round(loaded/total*100);
      const uMB=(loaded/1048576).toFixed(1);const tMB=(total/1048576).toFixed(1);
      $('upStatus').textContent=`${uMB} / ${tMB} MB · ${fmtSpeed(speed)}`;
      $('upPct').textContent=pct+'%';$('upFill').style.width=pct+'%';
      tmUpdate(tid,pct,speed,loaded);
    },res,rej);
  });
  if(S.cancelUpload){tmDone(tid,false);throw new Error('Cancelled');}
  const googleFileId=googleFile.id;
  if(!googleFileId)throw new Error('Upload completed but no file ID returned');
  // Save metadata
  await apiUploadComplete({fileLocalId:init.fileLocalId,googleFileId,driveId:S.driveId,folderId:S.folderId||null,name,size,mimeType});
  tmDone(tid,true);
  toast(`✓ ${name}`,'success');
}

// ─── Download ─────────────────────────────────────────────
async function downloadFile(fileId){
  const f=S.db?.files?.find(x=>x.id===fileId);if(!f)return;
  toast(`Preparing download…`,'info');
  const r=await apiDownload(f.googleFileId,f.driveId);
  if(r.url){dlLink(r.url,f.name);toast(`↓ ${f.name}`,'success');}
  else toast('Download failed','error');
}

// ─── Media Preview ────────────────────────────────────────
async function openMedia(fileId){
  const f=S.db?.files?.find(x=>x.id===fileId);if(!f)return;
  const cfg=ftCfg(f.name,f.mimeType);
  const r=await apiDownload(f.googleFileId,f.driveId);
  if(!r.url){toast('Cannot preview','error');return;}
  const ov=document.createElement('div');ov.className='media-ov';ov.tabIndex=0;
  const isImg=cfg.cat==='image',isVid=cfg.cat==='video',isAud=cfg.cat==='audio';
  let body='';
  if(isImg)body=`<img class="media-img" src="${esc(r.url)}" alt="${esc(f.name)}">`;
  else if(isVid)body=`<video class="media-vid" src="${esc(r.url)}" controls autoplay></video>`;
  else if(isAud)body=`<div style="text-align:center;padding:3rem 2rem"><i class="fas fa-music" style="font-size:5rem;color:var(--primary);display:block;margin-bottom:2rem"></i><audio src="${esc(r.url)}" controls style="width:80%;max-width:420px"></audio></div>`;
  ov.innerHTML=`<div class="media-hd"><div class="media-title"><i class="fas ${cfg.icon}" style="color:${cfg.col}"></i>${esc(f.name)}</div><div style="display:flex;gap:.5rem"><button class="icon-btn" onclick="downloadFile('${esc(f.id)}')"><i class="fas fa-download"></i></button><button class="icon-btn" onclick="this.closest('.media-ov').remove()"><i class="fas fa-times"></i></button></div></div><div class="media-body">${body}</div>`;
  document.body.appendChild(ov);ov.focus();
  ov.addEventListener('keydown',e=>{if(e.key==='Escape')ov.remove();});
}

// ─── Delete ───────────────────────────────────────────────
function confirmDeleteFile(fileId,name){
  if(!confirm(`Delete "${name}"?\nThis will permanently delete from Google Drive.`))return;
  const f=S.db?.files?.find(x=>x.id===fileId);if(!f)return;
  apiDeleteFile(f.googleFileId,f.driveId).then(async r=>{
    if(r.ok){toast(`${name} deleted`,'success');S.db=await apiFetchDB();renderExplorer();}
    else toast(r.error||'Delete failed','error');
  });
}
function confirmDeleteFolder(folderId,name){
  if(!confirm(`Delete folder "${name}" and ALL its contents?\nThis cannot be undone.`))return;
  apiDeleteFolder(folderId).then(async r=>{
    if(r.ok){toast(`Folder deleted`,'success');S.db=await apiFetchDB();renderExplorer();}
    else toast(r.error||'Delete failed','error');
  });
}

// ─── New Folder ───────────────────────────────────────────
function showNewFolderDialog(){
  const name=prompt('New folder name:');if(!name?.trim())return;
  apiCreateFolder(S.driveId,S.folderId||null,name.trim()).then(async r=>{
    if(r.ok){S.db=await apiFetchDB();renderExplorer();toast(`Folder created`,'success');}
    else toast(r.error||'Failed','error');
  });
}

// ─── Drive Menu ───────────────────────────────────────────
function showDriveMenu(driveId,btn){
  document.querySelectorAll('.ctx-menu').forEach(m=>m.remove());
  const m=document.createElement('div');m.className='ctx-menu';
  m.innerHTML=`<div class="ctx-item danger" onclick="disconnectDrive('${esc(driveId)}')"><i class="fas fa-unlink"></i>Disconnect Drive</div>`;
  btn.appendChild(m);
  setTimeout(()=>document.addEventListener('click',()=>m.remove(),{once:true}),0);
}
async function disconnectDrive(driveId){
  if(!confirm('Disconnect this Google Drive?\nFiles already uploaded will remain in Google Drive but won\'t appear here.'))return;
  const r=await apiDisconnectDrive(driveId);
  if(r.ok){toast('Drive disconnected','success');S.db=await apiFetchDB();renderHome();}
  else toast(r.error||'Failed','error');
}

// ─── Auth actions ─────────────────────────────────────────
async function doLogin(){
  const u=($('authUsername')?.value||'').trim();const p=$('authPassword')?.value||'';
  if(!u||!p){showAuthErr('Please fill in all fields');return;}
  const btn=$('authLoginBtn');if(btn){btn.disabled=true;btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> Signing in…';}
  const r=await apiUserLogin(u,p);
  if(r.token){
    Object.assign(S.ses,{token:r.token,role:r.role,userId:r.userId,username:r.username,allowedDrives:r.allowedDrives||'all'});
    saveSes();S.db=await apiFetchDB();syncAdminUI();goHome();
  }else{showAuthErr(r.error||'Login failed');}
  if(btn){btn.disabled=false;btn.innerHTML='<i class="fas fa-sign-in-alt"></i> Sign In';}
}
async function doAdminLogin(){
  const p=$('authAdminPass')?.value||'';
  if(!p){showAuthErr('Enter admin password');return;}
  const r=await apiAdminLogin(p);
  if(r.token){
    Object.assign(S.ses,{token:r.token,role:'admin',userId:null,username:'admin',allowedDrives:'all'});
    saveSes();S.db=await apiFetchDB();syncAdminUI();goHome();toast('Admin access granted','success');
  }else showAuthErr(r.error||'Wrong password');
}
function showAuthErr(msg){const el=$('authError');if(el){el.textContent=msg;el.classList.remove('hidden');}}
function doLogout(){clearSes();S.ses={token:null,role:null,userId:null,username:null,allowedDrives:'all'};syncAdminUI();goHome();toast('Logged out','info');}