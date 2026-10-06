var _uploadQueue = [];

async function uploadFiles(fileList) {
  var files = Array.from(fileList);
  if (!S.ses.token) { toast('Please sign in first', 'warning'); return; }
  if (!_driveId) { toast('Select a drive first', 'warning'); return; }
  _uploadQueue = _uploadQueue.concat(files);
  if (_uploadQueue.length === files.length) processQueue();
}

async function uploadFolder() {
  var inp = document.createElement('input');
  inp.type = 'file'; inp.multiple = true; inp.webkitdirectory = true;
  inp.onchange = function() { if(inp.files.length) uploadFiles(inp.files); };
  inp.click();
}

async function processQueue() {
  while (_uploadQueue.length > 0) {
    if (S.cancelUpload) { _uploadQueue = []; break; }
    var file = _uploadQueue.shift();
    await uploadOne(file);
  }
}

async function uploadOne(file) {
  S.cancelUpload = false;
  var tId = uid();
  var upBar=$('upBar'), upName=$('upName'), upStatus=$('upStatus'), upFill=$('upFill'), upPct=$('upPct');
  if(upBar) upBar.classList.remove('hidden');
  if(upName) upName.textContent = file.name;
  if(upStatus) upStatus.textContent = 'Preparing…';
  tmAdd(tId, file.name, file.size);

  try {
    await uploadFileChunked(_driveId, _folderId, file, function(loaded, total, speed) {
      var pct = total > 0 ? Math.round(loaded/total*100) : 0;
      if(upFill) upFill.style.width = pct+'%';
      if(upPct) upPct.textContent = pct+'%';
      if(upStatus) upStatus.textContent = fmt(loaded)+' / '+fmt(total)+(speed>0?' · '+fmtSpeed(speed):'');
      tmUpdate(tId, pct, speed, loaded);
    });

    S.db = await apiFetchDB();
    tmDone(tId, true);
    toast(file.name + ' uploaded!', 'success');
    renderSidebarStorage();
    renderFilesPage(_driveId, _folderId);
  } catch(e) {
    if(e.message==='Cancelled') toast('Upload cancelled', 'warning');
    else toast('Upload failed: ' + e.message, 'error');
    tmDone(tId, false);
  } finally {
    if(upBar) upBar.classList.add('hidden');
    if(upFill) upFill.style.width='0%';
    if(upPct) upPct.textContent='0%';
  }
}

async function downloadFile(fileLocalId) {
  if(!S.ses.token){toast('Sign in required','warning');return;}
  var f=(S.db&&S.db.files||[]).find(function(x){return x.id===fileLocalId;});
  if(!f)return;
  toast('Getting download link…','info');
  var r=await apiDownload(f.googleFileId,f.driveId);
  if(r.url){var a=document.createElement('a');a.href=r.url;a.download=f.name;a.target='_blank';document.body.appendChild(a);a.click();document.body.removeChild(a);}
  else toast(r.error||'Download failed','error');
}

async function openMedia(fileLocalId) {
  var f=(S.db&&S.db.files||[]).find(function(x){return x.id===fileLocalId;});
  if(!f||!S.ses.token){downloadFile(fileLocalId);return;}
  var r=await apiDownload(f.googleFileId,f.driveId);
  if(!r.url){toast(r.error||'Cannot preview','error');return;}
  var cfg=ftCfg(f.name,f.mimeType);
  var ov=document.createElement('div');ov.className='media-ov';
  ov.innerHTML='<div class="media-hd"><div class="media-title"><i class="fas '+cfg.icon+'" style="color:'+cfg.col+'"></i> '+esc(f.name)+'</div><div style="display:flex;gap:.4rem"><a href="'+r.url+'" download="'+esc(f.name)+'" class="btn-ghost sm"><i class="fas fa-download"></i> Download</a><button class="icon-btn" onclick="this.closest(\'.media-ov\').remove()"><i class="fas fa-times"></i></button></div></div><div class="media-body">'+(cfg.cat==='image'?'<img class="media-img" src="'+r.url+'" alt="'+esc(f.name)+'">':cfg.cat==='video'?'<video class="media-vid" src="'+r.url+'" controls autoplay></video>':cfg.cat==='audio'?'<audio src="'+r.url+'" controls autoplay style="width:80%;max-width:500px"></audio>':'<div style="color:var(--text2);text-align:center"><p>Preview not available.</p><a href="'+r.url+'" class="btn-primary" target="_blank">Open in new tab</a></div>')+'</div>';
  ov.addEventListener('click',function(e){if(e.target===ov)ov.remove();});
  document.body.appendChild(ov);
}

function confirmDeleteFile(fileLocalId, name) {
  if(!confirm('Delete "'+name+'"? This removes it from Google Drive permanently.'))return;
  var f=(S.db&&S.db.files||[]).find(function(x){return x.id===fileLocalId;});
  if(!f)return;
  apiDeleteFile(f.googleFileId,f.driveId).then(async function(r){
    if(r.ok){toast('Deleted "'+name+'"','success');S.db=await apiFetchDB();renderSidebarStorage();renderFilesPage(_driveId,_folderId);}
    else toast(r.error||'Delete failed','error');
  });
}

function confirmDeleteFolder(folderId, name) {
  if(!confirm('Delete folder "'+name+'" and ALL contents?'))return;
  apiDeleteFolder(folderId).then(async function(r){
    if(r.ok){toast('Folder deleted','success');S.db=await apiFetchDB();renderFilesPage(_driveId,_folderId);}
    else toast(r.error||'Delete failed','error');
  });
}

function showNewFolderDialog() {
  if(!S.ses.token){toast('Sign in required','warning');return;}
  if(!_driveId){toast('Select a drive first','warning');return;}
  var name=prompt('Folder name:');
  if(!name||!name.trim())return;
  apiCreateFolder({driveId:_driveId,parentFolderId:_folderId||null,name:name.trim()}).then(async function(r){
    if(r.ok){toast('Folder created','success');S.db=await apiFetchDB();renderFilesPage(_driveId,_folderId);}
    else toast(r.error||'Failed to create folder','error');
  });
}