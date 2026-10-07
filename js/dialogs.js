var _cancelSignal = { cancelled: false, paused: false, resumeResolve: null };
window._isUploading = false;

window.addEventListener('beforeunload', function(e) {
  if (window._isUploading) {
    var msg = 'Upload in progress! Leaving or refreshing will stop your upload.';
    e.preventDefault();
    e.returnValue = msg;
    return msg;
  }
});

function toggleUploadPause() {
  var btn = $('upPauseBtn');
  if (!_cancelSignal) return;
  if (!_cancelSignal.paused) {
    _cancelSignal.paused = true;
    if (_cancelSignal.xhr) {
      try { _cancelSignal.xhr.abort(); } catch(e){}
    }
    if (btn) btn.innerHTML = '<i class="fas fa-play"></i>';
    var st = $('upStatus');
    if (st) st.textContent = 'Paused';
    toast('Upload paused', 'info');
    if (typeof renderTM === 'function') renderTM();
  } else {
    _cancelSignal.paused = false;
    if (btn) btn.innerHTML = '<i class="fas fa-pause"></i>';
    if (_cancelSignal.resumeResolve) {
      _cancelSignal.resumeResolve();
      _cancelSignal.resumeResolve = null;
    }
    toast('Upload resumed', 'info');
    if (typeof renderTM === 'function') renderTM();
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

  // Pre-queue all files in Transfers Manager upfront so user sees the full queue!
  var fileItems = files.map(function(f) {
    var tId = uid();
    tmAddQueued(tId, f.name, f.size);
    return { file: f, tId: tId };
  });
  renderTM();

  window._isUploading = true;
  try {
    for(var i=0; i<fileItems.length; i++) {
      if(_cancelSignal.cancelled) break;
      await uploadOne(fileItems[i].file, targetFolderId || _folderId, fileItems[i].tId);
    }
  } finally {
    window._isUploading = false;
  }
}

// ─── Direct Folder Upload with folder hierarchy recreation & Smart Deduplication ───
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

    var rootFolder = files[0].webkitRelativePath ? files[0].webkitRelativePath.split('/')[0] : 'Folder';
    try {
      localStorage.setItem('td_active_batch', JSON.stringify({ folderName: rootFolder, total: files.length, time: Date.now() }));
    } catch(e){}

    window._isUploading = true;
    toast('Preparing folder "' + rootFolder + '" (' + files.length + ' files)…', 'info');

    // Pre-queue all folder files upfront so user sees the complete 75-item queue in Transfers!
    var fileItems = files.map(function(f) {
      var tId = uid();
      tmAddQueued(tId, f.name, f.size);
      return { file: f, tId: tId };
    });
    renderTM();

    window._isUploading = true;
    toast('Preparing folder "' + rootFolder + '" (' + files.length + ' files)…', 'info');

    // Build directory tree in Google Drive
    var folderMap = {}; // relative path -> folderId
    var skippedCount = 0;
    var uploadedCount = 0;

    try {
      for (var i = 0; i < fileItems.length; i++) {
        if (_cancelSignal.cancelled) break;
        var item = fileItems[i];
        var file = item.file;
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
                return f.driveId === _driveId && f.parentId === parentId && f.name.toLowerCase() === folderName.toLowerCase() && !f.trashed;
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

        // Smart Resume & Deduplication:
        // Check if file with identical name and size already exists in target folder
        var alreadyUploaded = (S.db && S.db.files || []).find(function(f){
          return f.driveId === _driveId && f.folderId === (parentId || null) && f.name === file.name && f.size === file.size && !f.trashed;
        });

        if (alreadyUploaded) {
          skippedCount++;
          tmDone(item.tId, true); // Mark as done/skipped in TM
          var st = $('upStatus');
          if (st) st.textContent = 'Skipping already uploaded (' + skippedCount + ' skipped): ' + file.name;
          continue;
        }

        await uploadOne(file, parentId, item.tId);
        uploadedCount++;
      }

      if (skippedCount > 0) {
        toast('Folder upload complete! ' + uploadedCount + ' uploaded, ' + skippedCount + ' existing skipped.', 'success');
      } else {
        toast('Folder upload complete (' + uploadedCount + ' files)', 'success');
      }
    } finally {
      window._isUploading = false;
      try { localStorage.removeItem('td_active_batch'); } catch(e){}
      S.db = await apiFetchDB();
      renderSidebarStorage();
      renderFilesPage(_driveId, _folderId);
    }
  };

  inp.click();
}

async function uploadOne(file, targetFolderId, existingTid) {
  _cancelSignal = { cancelled: false, paused: false, resumeResolve: null, xhr: null };
  var tId = existingTid || uid();
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

// ─── Folder Security & Lock Dialogs ──────────────────────
function showLockFolderDialog(folderId, folderName) {
  var ov = document.createElement('div');
  ov.className = 'modal-backdrop';
  ov.innerHTML = `
    <div class="modal" style="max-width:420px;text-align:center">
      <div class="modal-hd" style="justify-content:center;position:relative">
        <div style="width:48px;height:48px;border-radius:50%;background:rgba(255,159,10,0.15);color:#ff9f0a;display:flex;align-items:center;justify-content:center;font-size:1.4rem;margin:0 auto .5rem">
          <i class="fas fa-lock"></i>
        </div>
        <button class="icon-btn xs" style="position:absolute;right:1rem;top:1rem" onclick="this.closest('.modal-backdrop').remove()"><i class="fas fa-times"></i></button>
      </div>
      <h3 style="margin-bottom:.3rem">Lock Folder</h3>
      <p style="font-size:.84rem;color:var(--text3);margin-bottom:1.2rem">Set a password for <strong>${esc(folderName)}</strong>. The folder will be encrypted and inaccessible without this password.</p>
      <form id="lockFolderForm" onsubmit="return false;" style="text-align:left">
        <div style="margin-bottom:1rem">
          <label style="font-size:.78rem;font-weight:600;display:block;margin-bottom:.35rem">Folder Password</label>
          <div style="position:relative">
            <input type="password" id="lockFolderPass" class="inp" placeholder="Enter password (e.g. secret123)" required style="width:100%;padding-right:40px">
            <button type="button" class="icon-btn xs" style="position:absolute;right:8px;top:50%;transform:translateY(-50%)" onclick="var p=document.getElementById('lockFolderPass');p.type=p.type==='password'?'text':'password';this.innerHTML='<i class=\\'fas fa-'+(p.type==='password'?'eye':'eye-slash')+'\\'></i>';"><i class="fas fa-eye"></i></button>
          </div>
        </div>
        <div style="display:flex;gap:.6rem;justify-content:flex-end;margin-top:1.4rem">
          <button type="button" class="btn-ghost sm" onclick="this.closest('.modal-backdrop').remove()">Cancel</button>
          <button type="submit" class="btn-primary sm" id="submitLockBtn" style="background:linear-gradient(135deg,#ff9f0a,#ff453a)"><i class="fas fa-lock"></i> Lock Folder</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(ov);
  var passInp = ov.querySelector('#lockFolderPass');
  if (passInp) passInp.focus();

  ov.querySelector('#lockFolderForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    var val = passInp.value.trim();
    if (!val) return;
    var btn = ov.querySelector('#submitLockBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Locking…';
    var res = await apiLockFolder(folderId, val);
    if (res && res.ok) {
      toast('Folder locked! Protected with password.', 'success');
      ov.remove();
      S.db = await apiFetchDB();
      renderFilesPage(_driveId, _folderId);
    } else {
      toast(res ? (res.error || 'Failed to lock folder') : 'Network error', 'error');
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-lock"></i> Lock Folder';
    }
  });
}

function showUnlockFolderDialog(folder, onUnlocked) {
  var ov = document.createElement('div');
  ov.className = 'modal-backdrop';
  ov.innerHTML = `
    <div class="modal" style="max-width:400px;text-align:center">
      <div class="modal-hd" style="justify-content:center;position:relative">
        <div style="width:52px;height:52px;border-radius:50%;background:rgba(255,215,0,0.18);color:#ffd700;display:flex;align-items:center;justify-content:center;font-size:1.5rem;margin:0 auto .5rem;box-shadow:0 0 20px rgba(255,215,0,0.25)">
          <i class="fas fa-lock"></i>
        </div>
        <button class="icon-btn xs" style="position:absolute;right:1rem;top:1rem" onclick="this.closest('.modal-backdrop').remove()"><i class="fas fa-times"></i></button>
      </div>
      <h3 style="margin-bottom:.3rem">Protected Folder</h3>
      <p style="font-size:.84rem;color:var(--text3);margin-bottom:1.2rem"><strong>${esc(folder.name)}</strong> is encrypted. Enter the password to view and upload files inside.</p>
      <form id="unlockFolderForm" onsubmit="return false;" style="text-align:left">
        <div style="margin-bottom:1rem">
          <label style="font-size:.78rem;font-weight:600;display:block;margin-bottom:.35rem">Enter Folder Password</label>
          <div style="position:relative">
            <input type="password" id="unlockFolderPass" class="inp" placeholder="Password" required style="width:100%;padding-right:40px">
            <button type="button" class="icon-btn xs" style="position:absolute;right:8px;top:50%;transform:translateY(-50%)" onclick="var p=document.getElementById('unlockFolderPass');p.type=p.type==='password'?'text':'password';this.innerHTML='<i class=\\'fas fa-'+(p.type==='password'?'eye':'eye-slash')+'\\'></i>';"><i class="fas fa-eye"></i></button>
          </div>
        </div>
        <div style="display:flex;gap:.6rem;justify-content:flex-end;margin-top:1.4rem">
          <button type="button" class="btn-ghost sm" onclick="this.closest('.modal-backdrop').remove()">Cancel</button>
          <button type="submit" class="btn-primary sm" id="submitUnlockBtn" style="background:linear-gradient(135deg,var(--primary),#7928ca)"><i class="fas fa-lock-open"></i> Unlock & Open</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(ov);
  var passInp = ov.querySelector('#unlockFolderPass');
  if (passInp) passInp.focus();

  ov.querySelector('#unlockFolderForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    var val = passInp.value;
    if (!val) return;
    var btn = ov.querySelector('#submitUnlockBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Checking…';
    var res = await apiUnlockFolder(folder.id, val);
    if (res && res.ok) {
      toast('Folder unlocked successfully!', 'success');
      S.unlockedFolders.add(folder.id);
      ov.remove();
      if (typeof onUnlocked === 'function') onUnlocked();
      else renderFilesPage(_driveId, folder.id);
    } else {
      toast(res ? (res.error || 'Incorrect password') : 'Network error', 'error');
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-lock-open"></i> Unlock & Open';
      passInp.value = '';
      passInp.focus();
    }
  });
}

function showRemoveFolderLockDialog(folderId, folderName) {
  var isAdmin = (S.ses && S.ses.role === 'admin');
  if (isAdmin) {
    if (!confirm('Remove password protection from "' + folderName + '"? The folder will become accessible without a password.')) return;
    toast('Removing lock…', 'info');
    apiRemoveFolderLock(folderId, '').then(async function(r) {
      if (r && r.ok) {
        toast('Folder protection removed!', 'success');
        S.unlockedFolders.delete(folderId);
        S.db = await apiFetchDB();
        renderFilesPage(_driveId, _folderId);
      } else {
        toast(r ? (r.error || 'Failed to remove lock') : 'Error', 'error');
      }
    });
    return;
  }

  var pass = prompt('Enter folder password to remove protection from "' + folderName + '":');
  if (!pass) return;
  toast('Removing lock…', 'info');
  apiRemoveFolderLock(folderId, pass).then(async function(r) {
    if (r && r.ok) {
      toast('Folder protection removed!', 'success');
      S.unlockedFolders.delete(folderId);
      S.db = await apiFetchDB();
      renderFilesPage(_driveId, _folderId);
    } else {
      toast(r ? (r.error || 'Incorrect password') : 'Error', 'error');
    }
  });
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