var _cancelSignal = { cancelled: false };

async function uploadFiles(fileList) {
  var files = Array.from(fileList);
  var isOpenTarget = (_driveId && S.db && S.db.openDriveId && _driveId === S.db.openDriveId);
  var isAuth = (S.ses && S.ses.token);

  if (!isAuth && !isOpenTarget) {
    showSignInModal();
    toast('Please sign in or select the open drive', 'warning');
    return;
  }
  if (!_driveId) {
    if (S.db && S.db.openDriveId) {
      _driveId = S.db.openDriveId;
    } else {
      toast('Open a drive first, then upload', 'warning');
      return;
    }
  }

  // If guest uploading to open drive, only allow photos and videos:
  if (!isAuth && isOpenTarget) {
    var validFiles = files.filter(function(file) {
      var isMedia = (file.type && (file.type.startsWith('image/') || file.type.startsWith('video/'))) ||
                    /\.(jpg|jpeg|png|gif|webp|mp4|mov|mkv|webm|avi)$/i.test(file.name);
      return isMedia;
    });
    if (validFiles.length < files.length) {
      toast('Open drive only accepts photos and videos!', 'warning');
    }
    files = validFiles;
  }

  if (files.length === 0) return;

  for(var i=0; i<files.length; i++) {
    if(_cancelSignal.cancelled) break;
    await uploadOne(files[i]);
  }
}

async function uploadFolder() {
  var inp = document.createElement('input');
  inp.type='file'; inp.multiple=true; inp.webkitdirectory=true;
  inp.onchange=function(){if(inp.files.length)uploadFiles(inp.files);};
  inp.click();
}

async function uploadOne(file) {
  _cancelSignal = { cancelled: false };
  var tId = uid();
  var upBar=$('upBar'), upName=$('upName'), upStatus=$('upStatus'), upFill=$('upFill'), upPct=$('upPct');

  if(upBar) upBar.classList.remove('hidden');
  if(upName) upName.textContent = file.name;
  if(upStatus) upStatus.textContent = 'Initializing…';
  tmAdd(tId, file.name, file.size);

  try {
    // Step 1: Get Google Drive resumable upload URL from our backend
    if(upStatus) upStatus.textContent = 'Getting upload URL…';
    var init = await apiUploadInit(_driveId, _folderId, file.name, file.size, file.type||'application/octet-stream');

    if(!init.uploadUrl) {
      throw new Error(init.error || 'Upload init failed — check that drive is connected');
    }

    // Step 2: Upload directly to Google Drive (XHR with progress)
    if(upStatus) upStatus.textContent = 'Uploading…';
    var result = await uploadToGoogle(init.uploadUrl, file, function(loaded, total, speed) {
      var pct = total>0 ? Math.round(loaded/total*100) : 0;
      if(upFill) upFill.style.width = pct + '%';
      if(upPct) upPct.textContent = pct + '%';
      if(upStatus) upStatus.textContent = fmt(loaded) + ' / ' + fmt(total) + (speed>0 ? ' · ' + fmtSpeed(speed) : '');
      tmUpdate(tId, pct, speed, loaded);
    }, _cancelSignal);

    // Step 3: Save metadata to our DB
    if(upStatus) upStatus.textContent = 'Saving…';
    var activeDriveId = _driveId || (S.db && S.db.drives && S.db.drives[0] ? S.db.drives[0].id : null);
    await apiUploadComplete({
      fileLocalId: init.fileLocalId,
      googleFileId: result.googleFileId,
      driveId: activeDriveId,
      folderId: _folderId || null,
      name: file.name,
      size: file.size,
      mimeType: file.type || 'application/octet-stream'
    });

    tmDone(tId, true);
    toast(file.name + ' uploaded!', 'success');

    // Refresh
    S.db = await apiFetchDB();
    renderSidebarStorage();
    renderFilesPage(_driveId, _folderId);

  } catch(e) {
    if(e.message === 'Cancelled') toast('Upload cancelled', 'warning');
    else toast('Upload failed: ' + e.message, 'error');
    tmDone(tId, false);
  } finally {
    if(upBar) upBar.classList.add('hidden');
    if(upFill) upFill.style.width = '0%';
    if(upPct) upPct.textContent = '0%';
  }
}

async function downloadFile(fileLocalId) {
  if(!S.ses||!S.ses.token){toast('Sign in required','warning');return;}
  var f=(S.db&&S.db.files||[]).find(function(x){return x.id===fileLocalId;});
  if(!f)return;
  var driveId = f.driveId || _driveId || (S.db&&S.db.drives&&S.db.drives[0]?S.db.drives[0].id:'');
  var dlUrl = getFileDownloadUrl(f.googleFileId, driveId, false);
  var a = document.createElement('a');
  a.href = dlUrl;
  a.download = f.name;
  document.body.appendChild(a);
  a.click();
  setTimeout(function(){ document.body.removeChild(a); }, 1000);
  toast('Starting download for ' + f.name, 'info');
}

async function openMedia(fileLocalId) {
  var f=(S.db&&S.db.files||[]).find(function(x){return x.id===fileLocalId;});
  if(!f||!S.ses||!S.ses.token){downloadFile(fileLocalId);return;}
  var driveId = f.driveId || _driveId || (S.db&&S.db.drives&&S.db.drives[0]?S.db.drives[0].id:'');
  var mediaUrl = getFileDownloadUrl(f.googleFileId, driveId, true);
  var dlUrl = getFileDownloadUrl(f.googleFileId, driveId, false);
  var cfg = ftCfg(f.name, f.mimeType);
  var ov = document.createElement('div'); ov.className = 'media-ov';
  ov.innerHTML = '<div class="media-hd"><div class="media-title"><i class="fas '+cfg.icon+'" style="color:'+cfg.col+'"></i> '+esc(f.name)+'</div><div style="display:flex;gap:.5rem"><a href="'+dlUrl+'" download="'+esc(f.name)+'" class="btn-primary sm"><i class="fas fa-download"></i> Download</a><button class="icon-btn" onclick="this.closest(\'.media-ov\').remove()"><i class="fas fa-times"></i></button></div></div><div class="media-body">'+(cfg.cat==='image'?'<img class="media-img" src="'+mediaUrl+'" alt="'+esc(f.name)+'">':cfg.cat==='video'?'<video class="media-vid" src="'+mediaUrl+'" controls autoplay playsinline></video>':cfg.cat==='audio'?'<audio src="'+mediaUrl+'" controls autoplay style="width:80%;max-width:500px"></audio>':'<div style="text-align:center;padding:2rem"><i class="fas fa-file" style="font-size:3rem;color:var(--text2)"></i><p style="margin:1rem 0">Preview not available for this file type</p><a href="'+dlUrl+'" class="btn-primary"><i class="fas fa-download"></i> Download File</a></div>')+'</div>';
  ov.addEventListener('click', function(e){ if(e.target===ov) ov.remove(); });
  document.body.appendChild(ov);
}

function confirmDeleteFile(fileLocalId, name) {
  if(!confirm('Delete "'+name+'"? This removes it from Google Drive permanently.'))return;
  var f=(S.db&&S.db.files||[]).find(function(x){return x.id===fileLocalId;});if(!f)return;
  apiDeleteFile(f.googleFileId,f.driveId).then(async function(r){
    if(r.ok){toast('Deleted','success');S.db=await apiFetchDB();renderSidebarStorage();renderFilesPage(_driveId,_folderId);}
    else toast(r.error||'Delete failed','error');
  });
}

function confirmDeleteFolder(folderId, name) {
  if(!confirm('Delete folder "'+name+'" and ALL its contents?'))return;
  apiDeleteFolder(folderId).then(async function(r){
    if(r.ok){toast('Folder deleted','success');S.db=await apiFetchDB();renderFilesPage(_driveId,_folderId);}
    else toast(r.error||'Delete failed','error');
  });
}

function showNewFolderDialog() {
  if(!S.ses||!S.ses.token){toast('Sign in required','warning');return;}
  if(!_driveId){toast('Open a drive first','warning');return;}
  var name=prompt('Folder name:');
  if(!name||!name.trim())return;
  apiCreateFolder({driveId:_driveId,parentFolderId:_folderId||null,name:name.trim()}).then(async function(r){
    if(r.ok){toast('Folder created','success');S.db=await apiFetchDB();renderFilesPage(_driveId,_folderId);}
    else toast(r.error||'Failed to create folder','error');
  });
}