var _cancelSignal = { cancelled: false, paused: false, resumeResolve: null };

function toggleUploadPause() {
  var btn = $('upPauseBtn');
  if (!_cancelSignal) return;
  if (!_cancelSignal.paused) {
    _cancelSignal.paused = true;
    if (btn) btn.innerHTML = '<i class="fas fa-play"></i>';
    var st = $('upStatus');
    if (st) st.textContent = 'Paused';
    toast('Upload paused', 'info');
  } else {
    _cancelSignal.paused = false;
    if (btn) btn.innerHTML = '<i class="fas fa-pause"></i>';
    if (_cancelSignal.resumeResolve) {
      _cancelSignal.resumeResolve();
      _cancelSignal.resumeResolve = null;
    }
    toast('Upload resumed', 'info');
  }
}

async function uploadFiles(fileList, targetFolderId) {
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
    await uploadOne(files[i], targetFolderId || _folderId);
  }
}

// ─── Direct Folder Upload with folder hierarchy recreation ───────────────────
async function uploadFolder() {
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
      toast('Open a drive first, then upload folder', 'warning');
      return;
    }
  }

  var inp = document.createElement('input');
  inp.type = 'file';
  inp.multiple = true;
  inp.webkitdirectory = true;
  inp.setAttribute('directory', '');

  inp.onchange = async function() {
    var files = Array.from(inp.files);
    if (!files.length) return;

    if (!isAuth && isOpenTarget) {
      files = files.filter(function(file) {
        return (file.type && (file.type.startsWith('image/') || file.type.startsWith('video/'))) ||
               /\.(jpg|jpeg|png|gif|webp|mp4|mov|mkv|webm|avi)$/i.test(file.name);
      });
      if (!files.length) {
        toast('No photos or videos found in the selected folder', 'warning');
        return;
      }
    }

    toast('Preparing folder upload: ' + files.length + ' files…', 'info');

    // Build directory tree in Google Drive
    var folderMap = {}; // relative path -> folderId
    for (var i = 0; i < files.length; i++) {
      if (_cancelSignal.cancelled) break;
      var file = files[i];
      var relPath = file.webkitRelativePath || file.name;
      var parts = relPath.split('/');
      var parentId = _folderId || null;

      // If file is inside subfolders, create/find them
      if (parts.length > 1) {
        var pathAcc = '';
        for (var p = 0; p < parts.length - 1; p++) {
          var folderName = parts[p];
          pathAcc += (pathAcc ? '/' : '') + folderName;
          if (!folderMap[pathAcc]) {
            // Find existing or create new folder
            var existing = (S.db && S.db.folders || []).find(function(f){
              return f.driveId === _driveId && f.parentId === parentId && f.name === folderName;
            });
            if (existing) {
              folderMap[pathAcc] = existing.id;
              parentId = existing.id;
            } else {
              var created = await apiCreateFolder({ driveId: _driveId, parentFolderId: parentId, name: folderName });
              if (created && created.folderId) {
                folderMap[pathAcc] = created.folderId;
                parentId = created.folderId;
                S.db = await apiFetchDB();
              }
            }
          } else {
            parentId = folderMap[pathAcc];
          }
        }
      }

      await uploadOne(file, parentId);
    }

    S.db = await apiFetchDB();
    renderSidebarStorage();
    renderFilesPage(_driveId, _folderId);
  };

  inp.click();
}

async function uploadOne(file, targetFolderId) {
  _cancelSignal = { cancelled: false, paused: false, resumeResolve: null };
  var tId = uid();
  var upBar=$('upBar'), upName=$('upName'), upStatus=$('upStatus'), upFill=$('upFill'), upPct=$('upPct'), upPauseBtn=$('upPauseBtn');

  if(upBar) upBar.classList.remove('hidden');
  if(upPauseBtn) {
    upPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
    upPauseBtn.onclick = toggleUploadPause;
  }
  if(upName) upName.textContent = file.name;
  if(upStatus) upStatus.textContent = 'Initializing…';
  tmAdd(tId, file.name, file.size);

  try {
    var destFolder = targetFolderId || _folderId || null;
    // Step 1: Get Google Drive resumable upload URL from backend
    if(upStatus) upStatus.textContent = 'Connecting…';
    var init = await apiUploadInit(_driveId, destFolder, file.name, file.size, file.type||'application/octet-stream');

    if(!init.uploadUrl) {
      throw new Error(init.error || 'Upload init failed — check that drive is connected');
    }

    // Step 2: Upload directly to Google Drive (with Pause & Resume capability!)
    if(upStatus) upStatus.textContent = 'Uploading…';
    var result = await uploadToGoogleResumable(init.uploadUrl, file, function(loaded, total, speed) {
      var pct = total>0 ? Math.round(loaded/total*100) : 0;
      if(upFill) upFill.style.width = pct + '%';
      if(upPct) upPct.textContent = pct + '%';
      if(upStatus && !_cancelSignal.paused) upStatus.textContent = fmt(loaded) + ' / ' + fmt(total) + (speed>0 ? ' · ' + fmtSpeed(speed) : '');
      tmUpdate(tId, pct, speed, loaded);
    }, _cancelSignal);

    // Step 3: Save metadata to our DB
    if(upStatus) upStatus.textContent = 'Saving…';
    var activeDriveId = _driveId || (S.db && S.db.drives && S.db.drives[0] ? S.db.drives[0].id : null);
    await apiUploadComplete({
      fileLocalId: init.fileLocalId,
      googleFileId: result.googleFileId,
      driveId: activeDriveId,
      folderId: destFolder,
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
  if(!S.ses||!S.ses.token){
    var fGuest = (S.db&&S.db.files||[]).find(function(x){return x.id===fileLocalId;});
    var dGuest = fGuest?fGuest.driveId:_driveId;
    var isPub = (S.db && S.db.openDriveId && dGuest === S.db.openDriveId);
    if (!isPub) { toast('Sign in required','warning'); return; }
  }
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
  if(!f) return;
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
  if(!confirm('Move "' + name + '" to Recycle Bin?')) return;
  var f = (S.db && S.db.files || []).find(function(x){ return x.id === fileLocalId; });
  if(!f) return;
  apiDeleteFile(f.googleFileId || f.id).then(async function(r){
    if(r.ok){
      toast('Moved to Recycle Bin', 'info');
      f.trashed = true;
      S.db = await apiFetchDB();
      renderSidebarStorage();
      renderFilesPage(_driveId, _folderId);
    } else {
      toast(r.error || 'Delete failed', 'error');
    }
  });
}

function confirmDeleteFolder(folderId, name) {
  if(!confirm('Move folder "' + name + '" to Recycle Bin?')) return;
  apiDeleteFolder(folderId).then(async function(r){
    if(r.ok){
      toast('Folder moved to Recycle Bin', 'info');
      S.db = await apiFetchDB();
      renderFilesPage(_driveId, _folderId);
    } else {
      toast(r.error || 'Delete failed', 'error');
    }
  });
}

function showNewFolderDialog() {
  var isOpenTarget = (_driveId && S.db && S.db.openDriveId && _driveId === S.db.openDriveId);
  var isAuth = (S.ses && S.ses.token);
  if (!isAuth && !isOpenTarget) {
    toast('Sign in required or open the public trip drive', 'warning');
    return;
  }
  if (!_driveId) {
    if (S.db && S.db.openDriveId) _driveId = S.db.openDriveId;
    else { toast('Open a drive first', 'warning'); return; }
  }
  var name = prompt('Enter folder name:');
  if (!name || !name.trim()) return;
  toast('Creating folder…', 'info');
  apiCreateFolder({ driveId: _driveId, parentFolderId: _folderId || null, name: name.trim() }).then(async function(r){
    if(r.ok){
      toast('Folder created!', 'success');
      S.db = await apiFetchDB();
      renderFilesPage(_driveId, _folderId);
    } else {
      toast(r.error || 'Failed to create folder', 'error');
    }
  });
}

async function requestRestoreFile(fileId) {
  toast('Requesting restore…', 'info');
  var r = await apiRequestRestore(fileId);
  if (r.ok) {
    toast('Restore requested! Admin can now approve it.', 'success');
    S.db = await apiFetchDB();
    if (typeof renderTrashPage === 'function') renderTrashPage();
  } else {
    toast(r.error || 'Failed to request restore', 'error');
  }
}

async function adminApproveRestore(fileId) {
  toast('Restoring file…', 'info');
  var r = await apiApproveRestore(fileId);
  if (r.ok) {
    toast('File restored!', 'success');
    S.db = await apiFetchDB();
    if (typeof renderTrashPage === 'function') renderTrashPage();
    renderSidebarStorage();
  } else {
    toast(r.error || 'Failed to restore file', 'error');
  }
}

async function adminPermanentDelete(fileId, name) {
  if (!confirm('PERMANENTLY DELETE "' + name + '"? This will delete it from Google Drive forever.')) return;
  toast('Permanently deleting…', 'info');
  var r = await apiPermanentDelete(fileId);
  if (r.ok) {
    toast('Permanently deleted from Google Drive', 'success');
    S.db = await apiFetchDB();
    if (typeof renderTrashPage === 'function') renderTrashPage();
    renderSidebarStorage();
  } else {
    toast(r.error || 'Failed to delete permanently', 'error');
  }
}