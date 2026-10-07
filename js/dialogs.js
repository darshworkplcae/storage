var _cancelSignal = { cancelled: false, paused: false, resumeResolve: null };
window._isUploading = false;

// Screen Wake Lock API - keeps phone screen & CPU active during uploads so OS doesn't sleep/freeze
var _wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && !_wakeLock) {
      _wakeLock = await navigator.wakeLock.request('screen');
      _wakeLock.addEventListener('release', function () {
        _wakeLock = null;
      });
    }
  } catch (e) {
    console.warn('Wake Lock notice:', e);
  }
}

function releaseWakeLock() {
  if (_wakeLock) {
    try { _wakeLock.release(); } catch (e) { }
    _wakeLock = null;
  }
}

// Re-acquire wake lock if mobile user minimizes and restores browser while uploading
document.addEventListener('visibilitychange', async function () {
  if (document.visibilityState === 'visible' && window._isUploading && !_wakeLock) {
    await requestWakeLock();
  }
});

window.addEventListener('beforeunload', function (e) {
  if (window._isUploading) {
    var msg = 'Upload in progress! Closing the browser will pause active transfers.';
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
      try { _cancelSignal.xhr.abort(); } catch (e) { }
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

function findExistingDriveFile(name, size, driveId, folderId) {
  if (!S.db || !Array.isArray(S.db.files)) return null;
  var targetFolder = folderId || null;
  return S.db.files.find(function (f) {
    return f.driveId === driveId &&
           (f.folderId || null) === targetFolder &&
           f.name === name &&
           f.size === size &&
           !f.trashed;
  });
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

  // Refresh DB to get absolute ground truth on what is currently in Google Drive
  try {
    S.db = await apiFetchDB();
    if (S.db && S.db.files) tmSyncWithServer(S.db.files);
  } catch(e) {}

  // If guest uploading to open drive, only allow photos and videos:
  if (!isAuth && isOpenTarget) {
    var validFiles = files.filter(function (file) {
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

  var targetDrive = _driveId;
  var destFolder = targetFolderId || _folderId || null;

  try {
    localStorage.setItem('td_active_batch', JSON.stringify({
      driveId: targetDrive,
      folderId: destFolder,
      folderName: files.length === 1 ? files[0].name : files.length + ' files',
      total: files.length,
      time: Date.now()
    }));
  } catch (e) { }

  // Smart Deduplication Check:
  var toUpload = [];
  var skippedCount = 0;

  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    var existing = findExistingDriveFile(f.name, f.size, targetDrive, destFolder);
    if (existing) {
      skippedCount++;
      // Mark or add in Transfer Manager as done (100%)
      var matchTm = tmLoad().find(function(x){ return x.name === f.name && x.size === f.size; });
      if (matchTm) {
        tmDone(matchTm.id, true);
      } else {
        var dummyId = uid();
        tmAdd(dummyId, f.name, f.size);
        tmDone(dummyId, true);
      }
    } else {
      toUpload.push(f);
    }
  }

  if (skippedCount > 0) {
    toast('Smart Deduplication: ' + skippedCount + ' already uploaded (skipped). ' + toUpload.length + ' remaining.', 'info', 6000);
  }

  if (toUpload.length === 0) {
    toast('All ' + files.length + ' files are already uploaded in this folder!', 'success');
    try { localStorage.removeItem('td_active_batch'); } catch(e){}
    renderTM();
    return;
  }

  // Pre-queue only the files that genuinely need uploading
  var fileItems = toUpload.map(function (f) {
    return { file: f, tId: uid(), name: f.name, size: f.size };
  });
  tmAddBatchQueued(fileItems.map(function (x) { return { id: x.tId, name: x.name, size: x.size }; }));
  renderTM();

  window._isUploading = true;
  await requestWakeLock();
  var uploadedCount = 0;

  try {
    for (var j = 0; j < fileItems.length; j++) {
      if (_cancelSignal.cancelled) break;
      await uploadOne(fileItems[j].file, destFolder, fileItems[j].tId);
      uploadedCount++;
    }
    if (uploadedCount === fileItems.length) {
      try { localStorage.removeItem('td_active_batch'); } catch (e) { }
    }
  } finally {
    window._isUploading = false;
    releaseWakeLock();
    try {
      S.db = await apiFetchDB();
      if (S.db && S.db.files) tmSyncWithServer(S.db.files);
    } catch(e) {}
    renderSidebarStorage();
    renderFilesPage(_driveId, _folderId);
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

  var folInp = $('folderInput');
  if (folInp) {
    folInp.onchange = function () {
      if (folInp.files.length) {
        processFolderFiles(Array.from(folInp.files));
        folInp.value = '';
      }
    };
    folInp.click();
    return;
  }

  var inp = document.createElement('input');
  inp.type = 'file';
  inp.multiple = true;
  inp.webkitdirectory = true;
  inp.setAttribute('directory', '');
  inp.style.display = 'none';
  document.body.appendChild(inp);

  inp.onchange = function () {
    if (inp.files.length) processFolderFiles(Array.from(inp.files));
    inp.remove();
  };

  inp.click();
}

async function processFolderFiles(files) {
  var isOpenTarget = (_driveId && S.db && S.db.openDriveId && _driveId === S.db.openDriveId);
  var isAuth = (S.ses && S.ses.token);

  if (!files.length) return;

  // Refresh DB to get absolute ground truth from Google Drive
  try {
    S.db = await apiFetchDB();
    if (S.db && S.db.files) tmSyncWithServer(S.db.files);
  } catch(e) {}

  if (!isAuth && isOpenTarget) {
    files = files.filter(function (file) {
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
    localStorage.setItem('td_active_batch', JSON.stringify({
      driveId: _driveId,
      folderId: _folderId || null,
      folderName: rootFolder,
      total: files.length,
      time: Date.now()
    }));
  } catch (e) { }

  window._isUploading = true;
  await requestWakeLock();
  toast('Preparing folder "' + rootFolder + '" (' + files.length + ' files)…', 'info');

  // Pre-queue all folder files upfront in batch
  var fileItems = files.map(function (f) {
    return { file: f, tId: uid(), name: f.name, size: f.size };
  });
  tmAddBatchQueued(fileItems.map(function (x) { return { id: x.tId, name: x.name, size: x.size }; }));
  renderTM();

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
            var existingFolder = (S.db && S.db.folders || []).find(function (f) {
              return f.driveId === _driveId && f.parentId === parentId && f.name.toLowerCase() === folderName.toLowerCase() && !f.trashed;
            });
            if (existingFolder) {
              folderMap[pathAcc] = existingFolder.id;
              parentId = existingFolder.id;
            } else {
              var created = await apiCreateFolder({ driveId: _driveId, parentFolderId: parentId, name: folderName });
              if (created && created.folderId) {
                folderMap[pathAcc] = created.folderId;
                parentId = created.folderId;
                S.db = await apiFetchDB();
                if (S.db && S.db.files) tmSyncWithServer(S.db.files);
              }
            }
          } else {
            parentId = folderMap[pathAcc];
          }
        }
      }

      // Smart Resume & Deduplication:
      var alreadyUploaded = findExistingDriveFile(file.name, file.size, _driveId, parentId);

      if (alreadyUploaded) {
        skippedCount++;
        tmDone(item.tId, true);
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
    releaseWakeLock();
    try { localStorage.removeItem('td_active_batch'); } catch (e) { }
    try {
      S.db = await apiFetchDB();
      if (S.db && S.db.files) tmSyncWithServer(S.db.files);
    } catch(e) {}
    renderSidebarStorage();
    renderFilesPage(_driveId, _folderId);
  }
}

async function uploadOne(file, targetFolderId, existingTid) {
  _cancelSignal = { cancelled: false, paused: false, resumeResolve: null, xhr: null };
  var tId = existingTid || uid();
  var upBar = $('upBar'), upName = $('upName'), upStatus = $('upStatus'), upFill = $('upFill'), upPct = $('upPct'), upPauseBtn = $('upPauseBtn');

  if (upBar) upBar.classList.remove('hidden');
  if (upPauseBtn) {
    upPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
    upPauseBtn.onclick = toggleUploadPause;
  }
  if (upName) upName.textContent = file.name;
  if (upStatus) upStatus.textContent = 'Initializing…';
  tmAdd(tId, file.name, file.size);

  try {
    var destFolder = targetFolderId || _folderId || null;
    // Step 1: Get Google Drive resumable upload URL from backend
    if (upStatus) upStatus.textContent = 'Connecting…';
    var init = await apiUploadInit(_driveId, destFolder, file.name, file.size, file.type || 'application/octet-stream');

    if (!init.uploadUrl) {
      throw new Error(init.error || 'Upload init failed — check that drive is connected');
    }

    // Step 2: Upload directly to Google Drive (with Pause & Resume capability!)
    if (upStatus) upStatus.textContent = 'Uploading…';
    var result = await uploadToGoogleResumable(init.uploadUrl, file, function (loaded, total, speed) {
      var pct = total > 0 ? Math.round(loaded / total * 100) : 0;
      if (upFill) upFill.style.width = pct + '%';
      if (upPct) upPct.textContent = pct + '%';
      var eta = (speed > 0 && total > loaded) ? fmtEta(total - loaded, speed) : '';
      if (upStatus && !_cancelSignal.paused) upStatus.textContent = fmt(loaded) + ' / ' + fmt(total) + (speed > 0 ? ' · ' + fmtSpeed(speed) : '') + (eta ? ' · ' + eta : '');
      tmUpdate(tId, pct, speed, loaded);
    }, _cancelSignal);

    // Step 3: Save metadata to our DB
    if (upStatus) upStatus.textContent = 'Saving…';
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

    // Refresh DB
    try {
      S.db = await apiFetchDB();
      if (S.db && S.db.files) tmSyncWithServer(S.db.files);
    } catch(e) {}
    renderSidebarStorage();
    renderFilesPage(_driveId, _folderId);

  } catch (e) {
    if (e.message === 'Cancelled') toast('Upload cancelled', 'warning');
    else toast('Upload failed: ' + e.message, 'error');
    tmDone(tId, false);
  } finally {
    if (upBar) upBar.classList.add('hidden');
    if (upFill) upFill.style.width = '0%';
    if (upPct) upPct.textContent = '0%';
  }
}

// ─── Folder Security & Lock Dialogs ──────────────────────
function showLockFolderDialog(folderId, folderName) {
  var ov = document.createElement('div');
  ov.className = 'modal-backdrop';
  ov.innerHTML = `
    <div class="modal" style="max-width:440px;text-align:center">
      <div class="modal-hd" style="justify-content:center;position:relative">
        <div class="vault-shield-badge gold-glow">
          <i class="fas fa-shield-halved"></i>
        </div>
        <button class="icon-btn xs" style="position:absolute;right:1rem;top:1rem" onclick="this.closest('.modal-backdrop').remove()"><i class="fas fa-times"></i></button>
      </div>
      <h3 style="margin-bottom:.3rem">Protect Folder</h3>
      <p style="font-size:.84rem;color:var(--text3);margin-bottom:1.2rem">
        Set a password for <strong style="color:var(--text1)">${esc(folderName)}</strong>.<br>
        Only users with this password can view or upload files inside.
      </p>
      <form id="lockFolderForm" onsubmit="return false;" style="text-align:left">
        <div style="margin-bottom:.85rem">
          <label style="font-size:.78rem;font-weight:600;display:block;margin-bottom:.35rem;color:var(--text2)">New Password</label>
          <div style="position:relative">
            <input type="password" id="lockFolderPass" class="inp" placeholder="Enter secure password" required style="width:100%;padding-right:40px">
            <button type="button" class="icon-btn xs" style="position:absolute;right:8px;top:50%;transform:translateY(-50%)" onclick="var p=document.getElementById('lockFolderPass');p.type=p.type==='password'?'text':'password';this.innerHTML='<i class=\\'fas fa-'+(p.type==='password'?'eye':'eye-slash')+'\\'></i>';"><i class="fas fa-eye"></i></button>
          </div>
        </div>
        <div style="margin-bottom:1rem">
          <label style="font-size:.78rem;font-weight:600;display:block;margin-bottom:.35rem;color:var(--text2)">Confirm Password</label>
          <div style="position:relative">
            <input type="password" id="lockFolderPassConfirm" class="inp" placeholder="Re-type password" required style="width:100%;padding-right:40px">
            <button type="button" class="icon-btn xs" style="position:absolute;right:8px;top:50%;transform:translateY(-50%)" onclick="var p=document.getElementById('lockFolderPassConfirm');p.type=p.type==='password'?'text':'password';this.innerHTML='<i class=\\'fas fa-'+(p.type==='password'?'eye':'eye-slash')+'\\'></i>';"><i class="fas fa-eye"></i></button>
          </div>
        </div>
        <div style="background:rgba(255,159,10,0.08);border:1px solid rgba(255,159,10,0.22);border-radius:8px;padding:.65rem .8rem;font-size:.76rem;color:#ff9f0a;margin-bottom:1.2rem;line-height:1.4">
          <i class="fas fa-shield-alt" style="margin-right:4px"></i>
          Encrypted with SHA-256. Cant be recover Make Sure To remmber Password even Tobi Cant Help.
        </div>
        <div style="display:flex;gap:.6rem;justify-content:flex-end">
          <button type="button" class="btn-ghost sm" onclick="this.closest('.modal-backdrop').remove()">Cancel</button>
          <button type="submit" class="btn-primary sm" id="submitLockBtn" style="background:linear-gradient(135deg,#ff9f0a,#ff453a)"><i class="fas fa-lock"></i> Protect Folder</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(ov);
  var passInp = ov.querySelector('#lockFolderPass');
  var passConf = ov.querySelector('#lockFolderPassConfirm');
  if (passInp) passInp.focus();

  ov.querySelector('#lockFolderForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var val = passInp.value.trim();
    var conf = passConf.value.trim();
    if (!val) { toast('Password cannot be empty', 'warning'); return; }
    if (val !== conf) {
      toast('Passwords do not match! Please verify.', 'error');
      passConf.focus();
      return;
    }
    var btn = ov.querySelector('#submitLockBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Protecting…';
    var res = await apiLockFolder(folderId, val);
    if (res && res.ok) {
      toast('Folder protected with password!', 'success');
      ov.remove();
      S.db = await apiFetchDB();
      renderFilesPage(_driveId, _folderId);
    } else {
      toast(res ? (res.error || 'Failed to protect folder') : 'Network error', 'error');
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-lock"></i> Protect Folder';
    }
  });
}

function showUnlockFolderDialog(folder, onUnlocked) {
  var ov = document.createElement('div');
  ov.className = 'modal-backdrop';
  var remainingStarts = Math.max(1, 5 - (folder.failedAttempts || 0));
  ov.innerHTML = `
    <div class="modal" style="max-width:420px;text-align:center">
      <div class="modal-hd" style="justify-content:center;position:relative">
        <div class="vault-shield-badge gold-glow">
          <i class="fas fa-lock"></i>
        </div>
        <button class="icon-btn xs" style="position:absolute;right:1rem;top:1rem" onclick="this.closest('.modal-backdrop').remove()"><i class="fas fa-times"></i></button>
      </div>
      <h3 style="margin-bottom:.3rem">Protected Folder</h3>
      <p style="font-size:.84rem;color:var(--text3);margin-bottom:.8rem">
        <strong style="color:var(--text1)">${esc(folder.name)}</strong> is encrypted.<br>Enter the password to access files inside.
      </p>

      <div style="background:rgba(255,69,58,0.1);border:1px solid rgba(255,69,58,0.3);border-radius:8px;padding:.55rem .75rem;font-size:.76rem;color:#ff453a;margin-bottom:1.1rem;line-height:1.4;text-align:left">
        <div style="font-weight:700;display:flex;align-items:center;gap:6px">
          <i class="fas fa-shield-halved"></i> Security Rule: Max 5 Attempts
        </div>
        <div style="color:var(--text2);margin-top:2px">
          If 5 failed attempts are reached, this folder will be <strong>permanently destroyed Cant Even Tobi Can Help So Remember Pass cant Also Reset</strong>.
        </div>
        <div id="unlockAttemptsCount" style="margin-top:4px;font-weight:700;color:#ff9f0a">
          Attempts remaining: ${remainingStarts} of 5
        </div>
      </div>

      <form id="unlockFolderForm" onsubmit="return false;" style="text-align:left">
        <div style="margin-bottom:.9rem">
          <label style="font-size:.78rem;font-weight:600;display:block;margin-bottom:.35rem;color:var(--text2)">Folder Password</label>
          <div style="position:relative">
            <input type="password" id="unlockFolderPass" class="inp" placeholder="Enter password" required style="width:100%;padding-right:40px">
            <button type="button" class="icon-btn xs" style="position:absolute;right:8px;top:50%;transform:translateY(-50%)" onclick="var p=document.getElementById('unlockFolderPass');p.type=p.type==='password'?'text':'password';this.innerHTML='<i class=\\'fas fa-'+(p.type==='password'?'eye':'eye-slash')+'\\'></i>';"><i class="fas fa-eye"></i></button>
          </div>
        </div>

        <div style="margin-bottom:1.2rem;display:flex;align-items:center;gap:8px">
          <input type="checkbox" id="keepUnlocked5Min" style="width:16px;height:16px;cursor:pointer;accent-color:var(--primary)">
          <label for="keepUnlocked5Min" style="font-size:.78rem;color:var(--text2);cursor:pointer;user-select:none">
            Keep folder unlocked for 5 minutes (Auto-relocks after 5 min)
          </label>
        </div>

        <div style="display:flex;gap:.6rem;justify-content:flex-end">
          <button type="button" class="btn-ghost sm" onclick="this.closest('.modal-backdrop').remove()">Cancel</button>
          <button type="submit" class="btn-primary sm" id="submitUnlockBtn" style="background:linear-gradient(135deg,var(--primary),#7928ca)"><i class="fas fa-lock-open"></i> Unlock & Open</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(ov);
  var passInp = ov.querySelector('#unlockFolderPass');
  if (passInp) passInp.focus();

  ov.querySelector('#unlockFolderForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var val = passInp.value;
    if (!val) return;
    var btn = ov.querySelector('#submitUnlockBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Checking…';
    try {
      var res = await apiUnlockFolder(folder.id, val);
      if (res && res.ok) {
        toast('Folder unlocked successfully!', 'success');
        var keep5 = ov.querySelector('#keepUnlocked5Min') && ov.querySelector('#keepUnlocked5Min').checked;
        if (!S.unlockedFolders || !(S.unlockedFolders instanceof Map)) S.unlockedFolders = new Map();
        if (keep5) {
          var exp = Date.now() + 5 * 60 * 1000;
          S.unlockedFolders.set(folder.id, exp);
          try { sessionStorage.setItem('td_unlocked_' + folder.id, exp); } catch (e) { }
          toast('Folder unlocked for 5 minutes', 'info');
        } else {
          S.unlockedFolders.set(folder.id, 'once');
          try { sessionStorage.removeItem('td_unlocked_' + folder.id); } catch (e) { }
        }
        folder.failedAttempts = 0;
        ov.remove();
        if (typeof onUnlocked === 'function') onUnlocked();
        else navTo('files', _driveId, folder.id);
      } else {
        if (res && res.destroyed) {
          toast('SECURITY BREACH: Folder was destroyed after 5 failed attempts!', 'error');
          ov.remove();
          S.db = await apiFetchDB();
          navTo('files', _driveId, null);
          return;
        }
        var rem = (res && typeof res.remainingAttempts === 'number') ? res.remainingAttempts : (5 - (folder.failedAttempts || 0) - 1);
        var cntEl = ov.querySelector('#unlockAttemptsCount');
        if (cntEl) cntEl.textContent = 'Attempts remaining: ' + Math.max(0, rem) + ' of 5';
        toast(res ? (res.error || 'Incorrect password') : 'Network error', 'error');
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-lock-open"></i> Unlock & Open';
        passInp.value = '';
        passInp.focus();
      }
    } catch(err) {
      console.error('Unlock error:', err);
      toast('Failed to unlock: ' + (err.message || err), 'error');
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-lock-open"></i> Unlock & Open';
    }
  });
}

function showRemoveFolderLockDialog(folderId, folderName) {
  var isAdmin = (S.ses && S.ses.role === 'admin');
  if (isAdmin) {
    if (!confirm('Remove password protection from "' + folderName + '"? The folder will become accessible without a password.')) return;
    toast('Removing lock…', 'info');
    apiRemoveFolderLock(folderId, '').then(async function (r) {
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

  var ov = document.createElement('div');
  ov.className = 'modal-backdrop';
  ov.innerHTML = `
    <div class="modal" style="max-width:400px;text-align:center">
      <div class="modal-hd" style="justify-content:center;position:relative">
        <div class="vault-shield-badge gold-glow">
          <i class="fas fa-unlock-keyhole"></i>
        </div>
        <button class="icon-btn xs" style="position:absolute;right:1rem;top:1rem" onclick="this.closest('.modal-backdrop').remove()"><i class="fas fa-times"></i></button>
      </div>
      <h3 style="margin-bottom:.3rem">Remove Protection</h3>
      <p style="font-size:.84rem;color:var(--text3);margin-bottom:1.2rem">
        Remove password protection from <strong style="color:var(--text1)">${esc(folderName)}</strong>.<br>Enter the current password to confirm:
      </p>
      <form id="removeLockForm" onsubmit="return false;" style="text-align:left">
        <div style="margin-bottom:1.2rem">
          <label style="font-size:.78rem;font-weight:600;display:block;margin-bottom:.35rem;color:var(--text2)">Current Password</label>
          <div style="position:relative">
            <input type="password" id="removeLockPass" class="inp" placeholder="Current folder password" required style="width:100%;padding-right:40px">
            <button type="button" class="icon-btn xs" style="position:absolute;right:8px;top:50%;transform:translateY(-50%)" onclick="var p=document.getElementById('removeLockPass');p.type=p.type==='password'?'text':'password';this.innerHTML='<i class=\\'fas fa-'+(p.type==='password'?'eye':'eye-slash')+'\\'></i>';"><i class="fas fa-eye"></i></button>
          </div>
        </div>
        <div style="display:flex;gap:.6rem;justify-content:flex-end">
          <button type="button" class="btn-ghost sm" onclick="this.closest('.modal-backdrop').remove()">Cancel</button>
          <button type="submit" class="btn-primary sm" id="submitRemoveBtn" style="background:var(--danger)"><i class="fas fa-unlock"></i> Remove Password</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(ov);
  var passInp = ov.querySelector('#removeLockPass');
  if (passInp) passInp.focus();

  ov.querySelector('#removeLockForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var val = passInp.value;
    if (!val) return;
    var btn = ov.querySelector('#submitRemoveBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Removing…';
    var res = await apiRemoveFolderLock(folderId, val);
    if (res && res.ok) {
      toast('Folder protection removed!', 'success');
      S.unlockedFolders.delete(folderId);
      ov.remove();
      S.db = await apiFetchDB();
      renderFilesPage(_driveId, _folderId);
    } else {
      toast(res ? (res.error || 'Incorrect password') : 'Network error', 'error');
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-unlock"></i> Remove Password';
      passInp.value = '';
      passInp.focus();
    }
  });
}

function showFolderVisibilityDialog(folderId) {
  var folder = (S.db && S.db.folders || []).find(function(f){ return f.id === folderId; });
  if (!folder) {
    toast('Folder not found', 'error');
    return;
  }
  var users = (S.db && S.db.users || []);
  var isAdmOnly = !!folder.adminOnly;
  var allowedUsers = Array.isArray(folder.allowedUsers) ? folder.allowedUsers : [];
  var isSpecific = !isAdmOnly && allowedUsers.length > 0;
  var isPublic = !isAdmOnly && !isSpecific;

  var currentMode = isAdmOnly ? 'admin' : (isSpecific ? 'specific' : 'public');

  var ov = document.createElement('div');
  ov.className = 'modal-backdrop';
  ov.innerHTML = `
    <div class="modal" style="max-width:480px;text-align:left">
      <div class="modal-hd" style="display:flex;align-items:center;justify-content:space-between">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:36px;height:36px;border-radius:10px;background:rgba(78,134,245,0.15);display:flex;align-items:center;justify-content:center;color:var(--primary);font-size:1.1rem">
            <i class="fas fa-eye-slash"></i>
          </div>
          <div>
            <h3 style="margin:0;font-size:1.05rem">Folder Privacy & Visibility</h3>
            <span style="font-size:0.75rem;color:var(--text3)">Configure who can see and access this folder</span>
          </div>
        </div>
        <button class="icon-btn xs" onclick="this.closest('.modal-backdrop').remove()"><i class="fas fa-times"></i></button>
      </div>

      <div style="margin:1rem 0;padding:.75rem 1rem;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:10px;display:flex;align-items:center;gap:10px">
        <i class="fas fa-folder" style="color:#ff9f0a;font-size:1.4rem"></i>
        <div style="min-width:0;flex:1">
          <div style="font-weight:600;font-size:.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(folder.name)}</div>
          <div style="font-size:.72rem;color:var(--text3)">Current status: <strong style="color:${isAdmOnly ? 'var(--danger)' : isSpecific ? '#bf5af2' : 'var(--success)'}">${isAdmOnly ? 'Admin Only (Hidden)' : isSpecific ? 'Restricted to Specific Users' : 'Public (All Drive Users)'}</strong></div>
        </div>
      </div>

      <form id="folderVisForm" onsubmit="return false;">
        <div style="display:flex;flex-direction:column;gap:.75rem;margin-bottom:1.2rem">
          <label class="vis-option-card ${currentMode === 'public' ? 'active' : ''}" style="cursor:pointer;display:flex;align-items:flex-start;gap:12px;padding:.8rem 1rem;border-radius:10px;border:1px solid ${currentMode === 'public' ? 'var(--primary)' : 'var(--border)'};background:${currentMode === 'public' ? 'rgba(78,134,245,0.08)' : 'rgba(255,255,255,0.02)'};transition:.15s">
            <input type="radio" name="visMode" value="public" ${currentMode === 'public' ? 'checked' : ''} style="margin-top:3px;accent-color:var(--primary)">
            <div style="flex:1">
              <div style="font-weight:600;font-size:.86rem;display:flex;align-items:center;gap:6px">
                <i class="fas fa-globe" style="color:var(--success)"></i> Public (All Users & Guests)
              </div>
              <div style="font-size:.75rem;color:var(--text3);margin-top:2px">
                Everyone with access to this drive can view, open, and browse this folder.
              </div>
            </div>
          </label>

          <label class="vis-option-card ${currentMode === 'admin' ? 'active' : ''}" style="cursor:pointer;display:flex;align-items:flex-start;gap:12px;padding:.8rem 1rem;border-radius:10px;border:1px solid ${currentMode === 'admin' ? 'var(--danger)' : 'var(--border)'};background:${currentMode === 'admin' ? 'rgba(255,69,58,0.08)' : 'rgba(255,255,255,0.02)'};transition:.15s">
            <input type="radio" name="visMode" value="admin" ${currentMode === 'admin' ? 'checked' : ''} style="margin-top:3px;accent-color:var(--danger)">
            <div style="flex:1">
              <div style="font-weight:600;font-size:.86rem;display:flex;align-items:center;gap:6px">
                <i class="fas fa-user-secret" style="color:var(--danger)"></i> Admin Only (Completely Hidden)
              </div>
              <div style="font-size:.75rem;color:var(--text3);margin-top:2px">
                Strictly hidden from all guest visitors and regular users. Only you (Admin) can view it.
              </div>
            </div>
          </label>

          <label class="vis-option-card ${currentMode === 'specific' ? 'active' : ''}" style="cursor:pointer;display:flex;align-items:flex-start;gap:12px;padding:.8rem 1rem;border-radius:10px;border:1px solid ${currentMode === 'specific' ? '#bf5af2' : 'var(--border)'};background:${currentMode === 'specific' ? 'rgba(191,90,242,0.08)' : 'rgba(255,255,255,0.02)'};transition:.15s">
            <input type="radio" name="visMode" value="specific" ${currentMode === 'specific' ? 'checked' : ''} style="margin-top:3px;accent-color:#bf5af2">
            <div style="flex:1">
              <div style="font-weight:600;font-size:.86rem;display:flex;align-items:center;gap:6px">
                <i class="fas fa-users" style="color:#bf5af2"></i> Specific Users Only
              </div>
              <div style="font-size:.75rem;color:var(--text3);margin-top:2px">
                Hidden from guests and unauthorized accounts. Only selected user accounts can see it.
              </div>
            </div>
          </label>
        </div>

        <div id="visUsersListWrap" style="display:${currentMode === 'specific' ? 'block' : 'none'};margin-bottom:1.2rem;padding:.8rem 1rem;background:rgba(0,0,0,0.25);border:1px solid var(--border);border-radius:10px">
          <div style="font-size:.78rem;font-weight:600;margin-bottom:.5rem;color:var(--text2)">
            Select Authorized Users:
          </div>
          ${users.length === 0 ? `
            <div style="font-size:.76rem;color:var(--text3);font-style:italic">
              No registered user accounts found. Create users in Admin Panel > Users first.
            </div>
          ` : `
            <div style="display:flex;flex-direction:column;gap:.45rem;max-height:160px;overflow-y:auto">
              ${users.map(function(u) {
                var checked = allowedUsers.includes(u.id);
                return `<label style="display:flex;align-items:center;gap:8px;font-size:.82rem;cursor:pointer;user-select:none">
                  <input type="checkbox" class="vis-user-chk" value="${esc(u.id)}" ${checked ? 'checked' : ''} style="accent-color:#bf5af2">
                  <span><i class="fas fa-user" style="color:var(--text3);margin-right:4px"></i>${esc(u.username)}</span>
                </label>`;
              }).join('')}
            </div>
          `}
        </div>

        <div style="display:flex;gap:.6rem;justify-content:flex-end">
          <button type="button" class="btn-ghost sm" onclick="this.closest('.modal-backdrop').remove()">Cancel</button>
          <button type="submit" class="btn-primary sm" id="saveVisBtn"><i class="fas fa-check"></i> Save Visibility</button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(ov);

  var radios = ov.querySelectorAll('input[name="visMode"]');
  var usersWrap = ov.querySelector('#visUsersListWrap');
  radios.forEach(function(r) {
    r.addEventListener('change', function() {
      var selected = ov.querySelector('input[name="visMode"]:checked').value;
      if (usersWrap) usersWrap.style.display = selected === 'specific' ? 'block' : 'none';
      ov.querySelectorAll('.vis-option-card').forEach(function(card) {
        var inp = card.querySelector('input');
        if (inp && inp.checked) {
          card.classList.add('active');
          card.style.background = inp.value === 'public' ? 'rgba(78,134,245,0.08)' : inp.value === 'admin' ? 'rgba(255,69,58,0.08)' : 'rgba(191,90,242,0.08)';
          card.style.borderColor = inp.value === 'public' ? 'var(--primary)' : inp.value === 'admin' ? 'var(--danger)' : '#bf5af2';
        } else {
          card.classList.remove('active');
          card.style.background = 'rgba(255,255,255,0.02)';
          card.style.borderColor = 'var(--border)';
        }
      });
    });
  });

  ov.querySelector('#folderVisForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    var selectedMode = ov.querySelector('input[name="visMode"]:checked').value;
    var btn = ov.querySelector('#saveVisBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';

    var adminOnly = (selectedMode === 'admin');
    var selectedUserIds = [];
    if (selectedMode === 'specific') {
      ov.querySelectorAll('.vis-user-chk:checked').forEach(function(chk) {
        selectedUserIds.push(chk.value);
      });
    }

    try {
      var res = await apiSetFolderVisibility(folderId, adminOnly, selectedUserIds);
      if (res && res.ok) {
        toast('Folder visibility updated successfully', 'success');
        ov.remove();
        S.db = await apiFetchDB();
        renderSidebarStorage();
        if (typeof renderFilesPage === 'function') renderFilesPage(_driveId, _folderId);
        if (typeof renderAdminPage === 'function' && S.view === 'admin') renderAdminPage();
      } else {
        toast(res ? (res.error || 'Failed to update visibility') : 'Network error', 'error');
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-check"></i> Save Visibility';
      }
    } catch(err) {
      toast('Error: ' + (err.message || err), 'error');
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-check"></i> Save Visibility';
    }
  });
}

function promptResumeUpload() {
  var lastBatch = null;
  try {
    var raw = localStorage.getItem('td_active_batch');
    if (raw) lastBatch = JSON.parse(raw);
  } catch (e) { }

  if (lastBatch && lastBatch.driveId) {
    _driveId = lastBatch.driveId;
    if (lastBatch.folderId) _folderId = lastBatch.folderId;
  }

  var interrupted = tmLoad().filter(function(x){ return x.status === 'interrupted'; });
  var interruptedCount = interrupted.length;
  var batchName = lastBatch && lastBatch.folderName ? lastBatch.folderName : 'folder / files';

  var ov = document.createElement('div');
  ov.className = 'modal-backdrop';
  ov.innerHTML = `
    <div class="modal" style="max-width:440px;text-align:center">
      <div class="modal-hd" style="justify-content:center;position:relative">
        <div class="vault-shield-badge" style="background:rgba(78,134,245,0.18);color:#4e86f5;box-shadow:0 0 20px rgba(78,134,245,0.25)">
          <i class="fas fa-rotate-right"></i>
        </div>
        <button class="icon-btn xs" style="position:absolute;right:1rem;top:1rem" onclick="this.closest('.modal-backdrop').remove()"><i class="fas fa-times"></i></button>
      </div>
      <h3 style="margin-bottom:.35rem">Resume Upload</h3>
      <p style="font-size:.84rem;color:var(--text3);margin-bottom:1.1rem">
        Upload stopped when the browser was closed.<br>
        Re-select <strong>${esc(batchName)}</strong> to continue (${interruptedCount > 0 ? interruptedCount + ' remaining' : 'Smart Resume'}).
      </p>
      <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:.85rem;text-align:left;font-size:.8rem;line-height:1.45;margin-bottom:1.2rem">
        <div style="color:var(--success);font-weight:600;margin-bottom:.3rem;display:flex;align-items:center;gap:6px">
          <i class="fas fa-bolt"></i> Smart Deduplication Active
        </div>
        <div style="color:var(--text2)">
          All completed files will be <strong>skipped in 0 seconds</strong> with zero extra data used. Only unfinished items will resume!
        </div>
      </div>
      <div style="display:flex;gap:.6rem;justify-content:center;flex-wrap:wrap">
        <button class="btn-primary sm" onclick="this.closest('.modal-backdrop').remove();uploadFolder();"><i class="fas fa-folder-arrow-up"></i> Resume Folder</button>
        <button class="btn-ghost sm" onclick="this.closest('.modal-backdrop').remove();var fi=document.getElementById('fileInput');if(fi)fi.click();"><i class="fas fa-file-arrow-up"></i> Resume Files</button>
      </div>
    </div>
  `;
  document.body.appendChild(ov);
}

async function downloadFile(fileLocalId) {
  var isAdmin = S.ses && S.ses.role === 'admin';
  if (!isAdmin && S.db && S.db.policy && S.db.policy.allowUserDownload === false) {
    toast('File downloads are disabled by administrator', 'warning');
    return;
  }
  if (!S.ses || !S.ses.token) {
    var fGuest = (S.db && S.db.files || []).find(function (x) { return x.id === fileLocalId; });
    var dGuest = fGuest ? fGuest.driveId : _driveId;
    var isPub = (S.db && S.db.openDriveId && dGuest === S.db.openDriveId);
    if (!isPub) { toast('Sign in required', 'warning'); return; }
  }
  var f = (S.db && S.db.files || []).find(function (x) { return x.id === fileLocalId; });
  if (!f) return;
  var driveId = f.driveId || _driveId || (S.db && S.db.drives && S.db.drives[0] ? S.db.drives[0].id : '');
  var dlUrl = getFileDownloadUrl(f.googleFileId, driveId, false);
  var a = document.createElement('a');
  a.href = dlUrl;
  a.download = f.name;
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { document.body.removeChild(a); }, 1000);
  toast('Starting download for ' + f.name, 'info');
}

async function openMedia(fileLocalId) {
  var f = (S.db && S.db.files || []).find(function (x) { return x.id === fileLocalId; });
  if (!f) return;
  var isAdmin = S.ses && S.ses.role === 'admin';
  var canDownload = isAdmin || !S.db || !S.db.policy || S.db.policy.allowUserDownload !== false;
  var driveId = f.driveId || _driveId || (S.db && S.db.drives && S.db.drives[0] ? S.db.drives[0].id : '');
  var mediaUrl = getFileDownloadUrl(f.googleFileId, driveId, true);
  var dlUrl = getFileDownloadUrl(f.googleFileId, driveId, false);
  var cfg = ftCfg(f.name, f.mimeType);
  var ov = document.createElement('div'); ov.className = 'media-ov';
  var dlBtnHtml = canDownload ? '<a href="' + dlUrl + '" class="icon-btn" title="Download" download><i class="fas fa-download"></i></a>' : '';
  var noDlAttrs = !canDownload ? ' controlsList="nodownload noplaybackrate" disablePictureInPicture oncontextmenu="return false;" ' : ' controlsList="nodownload" ';
  ov.innerHTML = '<div class="media-hd"><div class="media-title"><i class="fas ' + cfg.icon + '" style="color:' + cfg.col + '"></i> ' + esc(f.name) + '</div><div style="display:flex;gap:.5rem">' + dlBtnHtml + '<button class="icon-btn" onclick="this.closest(\'.media-ov\').remove()"><i class="fas fa-times"></i></button></div></div><div class="media-body">' + (cfg.cat === 'image' ? '<img class="media-img" src="' + mediaUrl + '" alt="' + esc(f.name) + '" oncontextmenu="' + (!canDownload ? 'return false;' : '') + '">' : cfg.cat === 'video' ? '<video class="media-vid" src="' + mediaUrl + '" controls' + noDlAttrs + 'autoplay playsinline></video>' : cfg.cat === 'audio' ? '<audio src="' + mediaUrl + '" controls' + noDlAttrs + 'autoplay style="width:80%;max-width:500px"></audio>' : '<div style="text-align:center;padding:2rem"><i class="fas fa-file" style="font-size:3rem;color:var(--text2)"></i><p style="margin:1rem 0">Preview not available for this file type</p>' + (canDownload ? '<a href="' + dlUrl + '" class="btn-primary"><i class="fas fa-download"></i> Download File</a>' : '') + '</div>') + '</div>';
  ov.addEventListener('click', function (e) { if (e.target === ov) ov.remove(); });
  document.body.appendChild(ov);
}

function confirmDeleteFile(fileLocalId, name) {
  var isAdmin = S.ses && S.ses.role === 'admin';
  if (!isAdmin && S.db && S.db.policy && S.db.policy.allowUserDelete === false) {
    toast('File deletions are disabled by administrator', 'warning');
    return;
  }
  if (!confirm('Move "' + name + '" to Recycle Bin?')) return;
  var f = (S.db && S.db.files || []).find(function (x) { return x.id === fileLocalId; });
  if (!f) return;
  apiDeleteFile(f.googleFileId || f.id).then(async function (r) {
    if (r.ok) {
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
  var isAdmin = S.ses && S.ses.role === 'admin';
  if (!isAdmin && S.db && S.db.policy && S.db.policy.allowUserDelete === false) {
    toast('Folder deletions are disabled by administrator', 'warning');
    return;
  }
  if (!confirm('Move folder "' + name + '" to Recycle Bin?')) return;
  apiDeleteFolder(folderId).then(async function (r) {
    if (r.ok) {
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
  apiCreateFolder({ driveId: _driveId, parentFolderId: _folderId || null, name: name.trim() }).then(async function (r) {
    if (r.ok) {
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

// ─── In-App PDF Viewer (Mozilla PDF.js Canvas Reader) ──────────────────────────
function openPdfViewer(fileId) {
  var f = (S.db && S.db.files || []).find(function (x) { return x.id === fileId; });
  if (!f) return;
  var isAdmin = S.ses && S.ses.role === 'admin';
  var canDownload = isAdmin || !S.db || !S.db.policy || S.db.policy.allowUserDownload !== false;
  var driveId = f.driveId || _driveId || (S.db && S.db.drives && S.db.drives[0] ? S.db.drives[0].id : '');
  var previewUrl = getFileDownloadUrl(f.googleFileId, driveId, true);
  var downloadUrl = getFileDownloadUrl(f.googleFileId, driveId, false);

  var ov = document.createElement('div');
  ov.className = 'pdf-viewer-overlay';
  ov.id = 'pdfViewerModal';
  ov.innerHTML = `
    <div class="pdf-viewer-container">
      <div class="pdf-viewer-header">
        <div class="pdf-viewer-title">
          <i class="fas fa-file-pdf" style="color:#ff453a;font-size:1.3rem;flex-shrink:0"></i>
          <div style="min-width:0">
            <div class="pdf-title-text" title="${esc(f.name)}">${esc(f.name)}</div>
            <div class="pdf-sub-text">${fmt(f.size || 0)} · Fast Mobile PDF Reader</div>
          </div>
        </div>
        <div class="pdf-toolbar-controls">
          <button class="icon-btn xs" id="pdfPrevPage" title="Previous Page"><i class="fas fa-chevron-left"></i></button>
          <span class="pdf-page-indicator">Page <strong id="pdfCurrentPage">1</strong> of <strong id="pdfTotalPages">…</strong></span>
          <button class="icon-btn xs" id="pdfNextPage" title="Next Page"><i class="fas fa-chevron-right"></i></button>
          <span class="pdf-tb-sep"></span>
          <button class="icon-btn xs" id="pdfZoomOut" title="Zoom Out"><i class="fas fa-minus"></i></button>
          <span class="pdf-zoom-label" id="pdfZoomLevel">100%</span>
          <button class="icon-btn xs" id="pdfZoomIn" title="Zoom In"><i class="fas fa-plus"></i></button>
          <button class="btn-ghost xs" id="pdfFitWidth" title="Fit to Screen"><i class="fas fa-arrows-left-right-to-line"></i> <span class="hide-xs">Fit</span></button>
        </div>
        <div class="pdf-viewer-actions">
          ${canDownload ? `<a href="${downloadUrl}" download="${esc(f.name)}" class="btn-ghost sm hide-xs" title="Download PDF"><i class="fas fa-download"></i> Download</a>` : ''}
          <a href="${previewUrl}" target="_blank" rel="noopener" class="btn-ghost sm" title="Open in browser tab"><i class="fas fa-arrow-up-right-from-square"></i> <span class="hide-xs">New Tab</span></a>
          <button class="icon-btn sm" onclick="closePdfViewer()" title="Close viewer"><i class="fas fa-times"></i></button>
        </div>
      </div>
      <div class="pdf-viewer-body">
        <div class="pdf-canvas-container" id="pdfCanvasContainer">
          <canvas id="pdfCanvas" style="display:none"></canvas>
          <div id="pdfLoading" class="pdf-loader-state">
            <div class="vault-shield-badge gold-glow" style="width:58px;height:58px;font-size:1.5rem">
              <i class="fas fa-circle-notch fa-spin"></i>
            </div>
            <div id="pdfLoadMsg" style="font-size:.9rem;color:var(--text2);font-weight:600">Loading document…</div>
          </div>
          <div id="pdfPasswordBox" class="pdf-pass-box hidden">
            <div class="vault-shield-badge gold-glow" style="width:54px;height:54px;font-size:1.4rem;margin:0 auto 12px">
              <i class="fas fa-key"></i>
            </div>
            <h3 style="margin-bottom:6px">Protected PDF Document</h3>
            <p style="font-size:.82rem;color:var(--text3);margin-bottom:14px">This PDF is protected by an author password.</p>
            <form onsubmit="return false;" style="display:flex;gap:8px;max-width:320px;margin:0 auto">
              <input type="password" id="pdfDocPass" class="inp" placeholder="Enter PDF password" style="flex:1" required>
              <button type="submit" class="btn-primary sm"><i class="fas fa-lock-open"></i> Unlock</button>
            </form>
          </div>
          <div id="pdfErrorBox" class="pdf-error-box hidden">
            <i class="fas fa-triangle-exclamation" style="font-size:2.4rem;color:var(--warning);margin-bottom:8px"></i>
            <h3 style="margin-bottom:6px">Could Not Preview PDF</h3>
            <p id="pdfErrDetail" style="font-size:.82rem;color:var(--text3);max-width:360px;margin-bottom:14px"></p>
            <div style="display:flex;gap:8px;justify-content:center">
              <a href="${previewUrl}" target="_blank" rel="noopener" class="btn-primary sm"><i class="fas fa-arrow-up-right-from-square"></i> Open in Native Browser</a>
              ${canDownload ? `<a href="${downloadUrl}" download="${esc(f.name)}" class="btn-ghost sm"><i class="fas fa-download"></i> Download</a>` : ''}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(ov);

  var pdfDoc = null;
  var pageNum = 1;
  var pageRendering = false;
  var pageNumPending = null;
  var scale = 1.0;
  var fitWidthMode = true;
  var currentRenderTask = null;

  function queueRenderPage(num) {
    if (pageRendering) {
      pageNumPending = num;
    } else {
      renderPage(num);
    }
  }

  function renderPage(num) {
    pageRendering = true;
    pdfDoc.getPage(num).then(function (page) {
      var container = ov.querySelector('#pdfCanvasContainer');
      if (fitWidthMode && container) {
        var availWidth = container.clientWidth - 48;
        if (availWidth > 180) {
          var unscaledVp = page.getViewport({ scale: 1.0 });
          scale = Math.min(3.0, Math.max(0.4, availWidth / unscaledVp.width));
        }
      }
      var viewport = page.getViewport({ scale: scale });
      var canvas = ov.querySelector('#pdfCanvas');
      var ctx = canvas.getContext('2d');
      var dpr = window.devicePixelRatio || 1;

      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = Math.floor(viewport.width) + 'px';
      canvas.style.height = Math.floor(viewport.height) + 'px';
      canvas.style.display = 'block';

      if (currentRenderTask) {
        try { currentRenderTask.cancel(); } catch (e) { }
      }

      var transform = dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null;
      var renderContext = {
        canvasContext: ctx,
        transform: transform,
        viewport: viewport
      };

      currentRenderTask = page.render(renderContext);
      currentRenderTask.promise.then(function () {
        pageRendering = false;
        if (pageNumPending !== null) {
          renderPage(pageNumPending);
          pageNumPending = null;
        }
      }).catch(function (err) {
        if (err && err.name === 'RenderingCancelledException') return;
        console.error('Page render error:', err);
        pageRendering = false;
      });

      var curEl = ov.querySelector('#pdfCurrentPage');
      if (curEl) curEl.textContent = num;
      var zoomEl = ov.querySelector('#pdfZoomLevel');
      if (zoomEl) zoomEl.textContent = Math.round(scale * 100) + '%';
      var prevBtn = ov.querySelector('#pdfPrevPage');
      if (prevBtn) prevBtn.disabled = (num <= 1);
      var nextBtn = ov.querySelector('#pdfNextPage');
      if (nextBtn) nextBtn.disabled = (num >= pdfDoc.numPages);
    });
  }

  // Wire toolbar buttons
  ov.querySelector('#pdfPrevPage').onclick = function () {
    if (pageNum <= 1) return;
    pageNum--;
    queueRenderPage(pageNum);
  };
  ov.querySelector('#pdfNextPage').onclick = function () {
    if (!pdfDoc || pageNum >= pdfDoc.numPages) return;
    pageNum++;
    queueRenderPage(pageNum);
  };
  ov.querySelector('#pdfZoomIn').onclick = function () {
    fitWidthMode = false;
    scale = Math.min(3.0, scale + 0.2);
    queueRenderPage(pageNum);
  };
  ov.querySelector('#pdfZoomOut').onclick = function () {
    fitWidthMode = false;
    scale = Math.max(0.4, scale - 0.2);
    queueRenderPage(pageNum);
  };
  ov.querySelector('#pdfFitWidth').onclick = function () {
    fitWidthMode = true;
    queueRenderPage(pageNum);
  };

  // Keyboard navigation
  var keyHandler = function (e) {
    if (e.key === 'Escape') closePdfViewer();
    if (e.key === 'ArrowRight' || e.key === 'PageDown') {
      if (pdfDoc && pageNum < pdfDoc.numPages) { pageNum++; queueRenderPage(pageNum); }
    }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      if (pageNum > 1) { pageNum--; queueRenderPage(pageNum); }
    }
  };
  window.addEventListener('keydown', keyHandler);
  ov._keyHandler = keyHandler;

  // Initialize PDF.js loading
  if (typeof pdfjsLib === 'undefined') {
    // If CDN fails, fallback to iframe
    ov.querySelector('.pdf-viewer-body').innerHTML = '<iframe src="' + previewUrl + '#toolbar=1" class="pdf-frame" title="PDF Viewer" allow="fullscreen"></iframe>';
    return;
  }
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  var loadingTask = pdfjsLib.getDocument({
    url: previewUrl,
    withCredentials: false
  });

  loadingTask.onProgress = function (p) {
    if (p.total > 0) {
      var pct = Math.min(99, Math.round((p.loaded / p.total) * 100));
      var msg = ov.querySelector('#pdfLoadMsg');
      if (msg) msg.textContent = 'Loading document… ' + pct + '%';
    }
  };

  loadingTask.onPassword = function (callback, reason) {
    var loadSpin = ov.querySelector('#pdfLoading');
    if (loadSpin) loadSpin.style.display = 'none';
    var passBox = ov.querySelector('#pdfPasswordBox');
    if (passBox) {
      passBox.classList.remove('hidden');
      var inp = passBox.querySelector('#pdfDocPass');
      if (inp) {
        inp.value = '';
        inp.focus();
        passBox.querySelector('form').onsubmit = function (e) {
          e.preventDefault();
          var pwd = inp.value;
          if (!pwd) return;
          passBox.classList.add('hidden');
          if (loadSpin) loadSpin.style.display = 'flex';
          callback(pwd);
        };
      }
    }
  };

  loadingTask.promise.then(function (doc) {
    pdfDoc = doc;
    var loadSpin = ov.querySelector('#pdfLoading');
    if (loadSpin) loadSpin.style.display = 'none';
    var totEl = ov.querySelector('#pdfTotalPages');
    if (totEl) totEl.textContent = doc.numPages;
    renderPage(pageNum);
  }).catch(function (err) {
    console.error('PDF.js loading error:', err);
    var loadSpin = ov.querySelector('#pdfLoading');
    if (loadSpin) loadSpin.style.display = 'none';
    var errBox = ov.querySelector('#pdfErrorBox');
    if (errBox) {
      errBox.classList.remove('hidden');
      var errDetail = errBox.querySelector('#pdfErrDetail');
      if (errDetail) errDetail.textContent = err.message || 'The PDF stream could not be decoded.';
    }
  });
}

function closePdfViewer() {
  var ov = document.getElementById('pdfViewerModal');
  if (ov) {
    if (ov._keyHandler) window.removeEventListener('keydown', ov._keyHandler);
    ov.remove();
  }
}

// ─── In-App ZIP / RAR Archive Inspector (High-Speed HTTP Range Parser) ───
async function fastReadZipHeaders(downloadUrl, fileSize, onStatus) {
  if (onStatus) onStatus('Probing archive header…');

  // If fileSize is missing or 0, probe via Range 0-0 or Content-Range
  if (!fileSize || fileSize <= 0) {
    try {
      var probeResp = await fetch(downloadUrl, { headers: { 'Range': 'bytes=0-0' } });
      var cr = probeResp.headers.get('Content-Range');
      if (cr) {
        var m = cr.match(/\/(\d+)$/);
        if (m) fileSize = parseInt(m[1], 10);
      }
      if (!fileSize) {
        var cl = probeResp.headers.get('Content-Length');
        if (cl) fileSize = parseInt(cl, 10);
      }
    } catch(e) {}
  }

  if (!fileSize || fileSize <= 0) {
    throw new Error('Cannot determine archive file size for streaming inspection');
  }

  // Step 1: Read the tail chunk (256 KB) of the archive
  var tailChunk = Math.min(fileSize, 262144);
  var tailStart = fileSize - tailChunk;
  if (onStatus) onStatus('Locating Central Directory index…');

  var tailResp = await fetch(downloadUrl, {
    headers: { 'Range': 'bytes=' + tailStart + '-' + (fileSize - 1) }
  });

  if (!tailResp.ok && tailResp.status !== 206) {
    throw new Error('Range request returned status ' + tailResp.status);
  }

  var tailBuf = await tailResp.arrayBuffer();
  var tailBytes = new Uint8Array(tailBuf);
  var tailDv = new DataView(tailBuf);

  // Step 2: Locate End of Central Directory (EOCD signature: 0x06054b50 -> 0x50, 0x4b, 0x05, 0x06)
  var eocdOffsetInTail = -1;
  for (var i = tailBytes.length - 22; i >= 0; i--) {
    if (tailBytes[i] === 0x50 && tailBytes[i + 1] === 0x4b && tailBytes[i + 2] === 0x05 && tailBytes[i + 3] === 0x06) {
      eocdOffsetInTail = i;
      break;
    }
  }

  if (eocdOffsetInTail === -1) {
    throw new Error('Could not locate ZIP End-of-Central-Directory record');
  }

  var totalEntries = tailDv.getUint16(eocdOffsetInTail + 10, true);
  var cdSize = tailDv.getUint32(eocdOffsetInTail + 12, true);
  var cdOffset = tailDv.getUint32(eocdOffsetInTail + 16, true);

  // Step 3: Check for ZIP64 (standard in archives > 4GB or > 65535 files, like Google Takeout)
  var isZip64 = false;
  var zip64LocInTail = -1;
  for (var j = Math.max(0, eocdOffsetInTail - 40); j < eocdOffsetInTail; j++) {
    if (tailBytes[j] === 0x50 && tailBytes[j + 1] === 0x4b && tailBytes[j + 2] === 0x06 && tailBytes[j + 3] === 0x07) {
      zip64LocInTail = j;
      break;
    }
  }

  if (zip64LocInTail !== -1 || cdOffset === 0xFFFFFFFF || cdSize === 0xFFFFFFFF || totalEntries === 0xFFFF) {
    isZip64 = true;
    var zip64EocdOffset = 0;
    if (zip64LocInTail !== -1) {
      zip64EocdOffset = Number(tailDv.getBigUint64(zip64LocInTail + 8, true));
    }

    var z64Buf = null;
    var z64Pos = 0;
    var z64OffsetInTail = zip64EocdOffset - tailStart;

    if (z64OffsetInTail >= 0 && z64OffsetInTail + 56 <= tailBytes.length) {
      z64Buf = tailBuf;
      z64Pos = z64OffsetInTail;
    } else {
      var z64Resp = await fetch(downloadUrl, {
        headers: { 'Range': 'bytes=' + zip64EocdOffset + '-' + (zip64EocdOffset + 127) }
      });
      z64Buf = await z64Resp.arrayBuffer();
      z64Pos = 0;
    }

    var z64Dv = new DataView(z64Buf);
    if (z64Dv.getUint32(z64Pos, true) === 0x06064b50) {
      totalEntries = Number(z64Dv.getBigUint64(z64Pos + 32, true));
      cdSize = Number(z64Dv.getBigUint64(z64Pos + 40, true));
      cdOffset = Number(z64Dv.getBigUint64(z64Pos + 48, true));
    }
  }

  // Step 4: Obtain the Central Directory bytes
  var cdBytes = null;
  var cdDv = null;
  var cdStartInTail = cdOffset - tailStart;

  if (cdStartInTail >= 0 && (cdStartInTail + cdSize) <= tailBytes.length) {
    // Central directory was already loaded in our tail chunk! 0 extra network calls!
    cdBytes = tailBytes.subarray(cdStartInTail, cdStartInTail + cdSize);
    cdDv = new DataView(tailBuf, cdStartInTail, cdSize);
  } else {
    // Fetch only the Central Directory range (fast 1-request load)
    if (onStatus) onStatus('Reading file directory index (' + fmt(cdSize) + ')…');
    var cdResp = await fetch(downloadUrl, {
      headers: { 'Range': 'bytes=' + cdOffset + '-' + (cdOffset + cdSize - 1) }
    });
    if (!cdResp.ok && cdResp.status !== 206) {
      throw new Error('Failed to fetch Central Directory range (Status ' + cdResp.status + ')');
    }
    var fullCdBuf = await cdResp.arrayBuffer();
    cdBytes = new Uint8Array(fullCdBuf);
    cdDv = new DataView(fullCdBuf);
  }

  // Step 5: Parse Central Directory Headers
  if (onStatus) onStatus('Parsing entries…');
  var entries = [];
  var p = 0;
  var maxP = cdBytes.length;
  var textDecoder = new TextDecoder('utf-8');

  while (p + 46 <= maxP) {
    var sig = cdDv.getUint32(p, true);
    if (sig !== 0x02014b50) break;

    var flags = cdDv.getUint16(p + 8, true);
    var modTime = cdDv.getUint16(p + 12, true);
    var modDate = cdDv.getUint16(p + 14, true);
    var compSize = cdDv.getUint32(p + 20, true);
    var uncompSize = cdDv.getUint32(p + 24, true);
    var fnLen = cdDv.getUint16(p + 28, true);
    var extraLen = cdDv.getUint16(p + 30, true);
    var commLen = cdDv.getUint16(p + 32, true);
    var extAttr = cdDv.getUint32(p + 38, true);

    var isEncrypted = (flags & 1) !== 0;
    var filename = textDecoder.decode(cdBytes.subarray(p + 46, p + 46 + fnLen));

    // Handle ZIP64 extra field for large files (> 4GB)
    if (uncompSize === 0xFFFFFFFF || compSize === 0xFFFFFFFF) {
      var ep = p + 46 + fnLen;
      var epEnd = ep + extraLen;
      while (ep + 4 <= epEnd) {
        var hId = cdDv.getUint16(ep, true);
        var dSize = cdDv.getUint16(ep + 2, true);
        if (hId === 0x0001) {
          var o = ep + 4;
          if (uncompSize === 0xFFFFFFFF && o + 8 <= epEnd) {
            uncompSize = Number(cdDv.getBigUint64(o, true));
            o += 8;
          }
          if (compSize === 0xFFFFFFFF && o + 8 <= epEnd) {
            compSize = Number(cdDv.getBigUint64(o, true));
            o += 8;
          }
          break;
        }
        ep += 4 + dSize;
      }
    }

    var year = ((modDate >> 9) & 0x7F) + 1980;
    var month = (modDate >> 5) & 0x0F;
    var day = modDate & 0x1F;
    var hour = (modTime >> 11) & 0x1F;
    var min = (modTime >> 5) & 0x3F;
    var dateFormatted = year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0') + ' ' + String(hour).padStart(2, '0') + ':' + String(min).padStart(2, '0');

    var isDir = filename.endsWith('/') || (extAttr & 0x10) !== 0;

    entries.push({
      path: filename,
      dir: isDir,
      size: uncompSize,
      compressedSize: compSize,
      date: dateFormatted,
      encrypted: isEncrypted
    });

    p += 46 + fnLen + extraLen + commLen;
  }

  return entries;
}

async function openArchiveViewer(fileId) {
  var f = (S.db && S.db.files || []).find(function (x) { return x.id === fileId; });
  if (!f) return;
  var driveId = f.driveId || _driveId || (S.db && S.db.drives && S.db.drives[0] ? S.db.drives[0].id : '');
  var downloadUrl = getFileDownloadUrl(f.googleFileId, driveId, false);
  var isZip = f.name.toLowerCase().endsWith('.zip');
  var isRar = f.name.toLowerCase().endsWith('.rar');

  var ov = document.createElement('div');
  ov.className = 'modal-backdrop';
  ov.id = 'archiveViewerModal';
  ov.innerHTML = `
    <div class="modal" style="width:95vw;max-width:680px;max-height:88vh;display:flex;flex-direction:column;padding:1.2rem;background:rgba(14,16,28,0.98);border:1px solid rgba(255,255,255,0.14);border-radius:18px;box-shadow:0 24px 60px rgba(0,0,0,0.9),0 0 0 1px rgba(0,229,255,0.15)">
      <div class="modal-hd" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.8rem;padding-bottom:.65rem;border-bottom:1px solid rgba(255,255,255,0.08)">
        <div style="display:flex;align-items:center;gap:12px;min-width:0;flex:1">
          <div style="width:40px;height:40px;border-radius:12px;background:rgba(255,159,10,0.15);border:1px solid rgba(255,159,10,0.3);display:flex;align-items:center;justify-content:center;color:#ff9f0a;font-size:1.3rem;flex-shrink:0">
            <i class="fas fa-file-zipper"></i>
          </div>
          <div style="min-width:0;flex:1">
            <h3 style="font-size:1rem;margin:0;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.name)}</h3>
            <div style="font-size:.74rem;color:var(--text3);display:flex;align-items:center;gap:8px;margin-top:2px">
              <span>${fmt(f.size || 0)}</span>
              <span>·</span>
              <span style="color:#00e5ff;font-weight:600"><i class="fas fa-bolt" style="font-size:.7rem"></i> Instant Inspector</span>
            </div>
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-shrink:0;margin-left:12px">
          <a href="${downloadUrl}" download="${esc(f.name)}" class="btn-primary xs" style="background:linear-gradient(135deg,var(--primary),#00e5ff)"><i class="fas fa-download"></i> Download</a>
          <button class="icon-btn xs tm-close-btn" onclick="this.closest('.modal-backdrop').remove()" title="Close inspector"><i class="fas fa-times"></i></button>
        </div>
      </div>

      <div id="archiveToolbar" style="display:none;margin-bottom:.75rem">
        <div style="display:flex;gap:10px;align-items:center">
          <div style="position:relative;flex:1">
            <i class="fas fa-search" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--text3);font-size:.8rem"></i>
            <input type="text" id="archiveSearchInput" class="inp xs" placeholder="Search files inside archive…" style="width:100%;padding-left:32px;background:rgba(255,255,255,0.04);border-color:rgba(255,255,255,0.1);border-radius:8px">
          </div>
          <span id="archiveItemsCount" style="font-size:.74rem;color:var(--text3);white-space:nowrap;flex-shrink:0"></span>
        </div>
      </div>

      <div id="archiveContentArea" style="flex:1;overflow-y:auto;min-height:260px;border-radius:12px;background:rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.06);padding:0.75rem">
        <div id="archiveLoadingState" style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:220px;gap:12px;color:var(--text3)">
          <div style="width:48px;height:48px;border-radius:50%;border:3px solid rgba(0,229,255,0.2);border-top-color:#00e5ff;animation:spin 0.8s linear infinite"></div>
          <span id="archiveLoadingMsg" style="font-size:.85rem;color:var(--text2);font-weight:600">Reading archive contents…</span>
          <span style="font-size:.72rem;color:var(--text3)">Using high-speed Range streaming (zero whole-file download)</span>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(ov);

  var area = ov.querySelector('#archiveContentArea');
  var loadingMsg = ov.querySelector('#archiveLoadingMsg');
  var toolbar = ov.querySelector('#archiveToolbar');
  var countEl = ov.querySelector('#archiveItemsCount');
  var searchInp = ov.querySelector('#archiveSearchInput');

  if (isRar) {
    area.innerHTML = `
      <div style="text-align:center;padding:2.5rem 1rem">
        <div style="font-size:2.4rem;color:#ff9f0a;margin-bottom:.5rem"><i class="fas fa-box-archive"></i></div>
        <h4 style="margin-bottom:.4rem">RAR Archive Container</h4>
        <p style="font-size:.82rem;color:var(--text3);max-width:380px;margin:0 auto 1.2rem;line-height:1.45">
          This is a compressed RAR archive (${fmt(f.size)}). RAR archives require proprietary unrar decompression algorithms.
        </p>
        <a href="${downloadUrl}" download="${esc(f.name)}" class="btn-primary sm"><i class="fas fa-download"></i> Download & Extract</a>
      </div>
    `;
    return;
  }

  var allEntries = [];

  function renderList(filter) {
    var query = (filter || '').toLowerCase().trim();
    var filtered = query ? allEntries.filter(function (e) { return e.path.toLowerCase().includes(query); }) : allEntries;

    if (countEl) {
      countEl.innerHTML = `<strong>${filtered.length}</strong> / ${allEntries.length} items`;
    }

    if (!filtered.length) {
      area.innerHTML = `<div style="text-align:center;padding:2.5rem 1rem;color:var(--text3);font-size:.84rem"><i class="fas fa-folder-open" style="font-size:2rem;opacity:.3;margin-bottom:.5rem;display:block"></i>No matching files found inside archive</div>`;
      return;
    }

    var hasEncrypted = filtered.some(function (e) { return e.encrypted; });

    area.innerHTML = `
      ${hasEncrypted ? `<div style="background:rgba(255,215,0,0.12);border:1px solid rgba(255,215,0,0.35);border-radius:10px;padding:.55rem .85rem;margin-bottom:.75rem;font-size:.78rem;color:#ffd700;display:flex;align-items:center;gap:8px"><i class="fas fa-shield-halved"></i> <span>This archive contains password-protected / encrypted items.</span></div>` : ''}
      <div style="display:flex;flex-direction:column;gap:4px">
        ${filtered.map(function (item) {
          var isImage = /\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i.test(item.path);
          var isPdf = /\.pdf$/i.test(item.path);
          var isVid = /\.(mp4|mkv|mov|avi|webm)$/i.test(item.path);
          var isAud = /\.(mp3|wav|ogg|flac|m4a)$/i.test(item.path);
          var icon = item.dir ? 'fa-folder' : isPdf ? 'fa-file-pdf' : isImage ? 'fa-file-image' : isVid ? 'fa-file-video' : isAud ? 'fa-file-audio' : 'fa-file';
          var col = item.dir ? '#ff9f0a' : isPdf ? '#ff453a' : isImage ? '#30d158' : isVid ? '#bf5af2' : isAud ? '#00e5ff' : 'var(--text2)';
          return `<div style="display:flex;align-items:center;justify-content:space-between;padding:.45rem .65rem;border-radius:8px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.04);font-size:.78rem;transition:background 0.15s">
            <div style="display:flex;align-items:center;gap:10px;min-width:0;flex:1">
              <i class="fas ${icon}" style="color:${col};font-size:.9rem;flex-shrink:0"></i>
              <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text1)" title="${esc(item.path)}">${esc(item.path)}</span>
              ${item.encrypted ? `<span style="display:inline-flex;align-items:center;gap:3px;font-size:.62rem;padding:1px 5px;border-radius:4px;background:rgba(255,215,0,0.18);color:#ffd700;border:1px solid rgba(255,215,0,0.35);font-weight:700;flex-shrink:0"><i class="fas fa-lock"></i> Encrypted</span>` : ''}
            </div>
            <div style="color:var(--text3);font-size:.72rem;margin-left:14px;flex-shrink:0;text-align:right">
              ${item.dir ? '<span style="color:var(--text3);font-style:italic">Directory</span>' : fmt(item.size)}
            </div>
          </div>`;
        }).join('')}
      </div>
    `;
  }

  // Fast HTTP Range Reader execution:
  try {
    allEntries = await fastReadZipHeaders(downloadUrl, f.size, function (status) {
      if (loadingMsg) loadingMsg.textContent = status;
    });

    if (!allEntries || !allEntries.length) {
      area.innerHTML = `<div style="text-align:center;padding:2.5rem;color:var(--text3)">Archive is empty (0 files).</div>`;
      return;
    }

    allEntries.sort(function (a, b) {
      if (a.dir && !b.dir) return -1;
      if (!a.dir && b.dir) return 1;
      return a.path.localeCompare(b.path);
    });

    if (toolbar) toolbar.style.display = 'block';
    renderList('');

    if (searchInp) {
      searchInp.addEventListener('input', function () {
        renderList(this.value);
      });
      searchInp.focus();
    }
  } catch (err) {
    console.warn('Fast Range ZIP reader failed, attempting fallback…', err);

    // Fallback: If file is smaller than 35 MB, fallback to JSZip
    if ((f.size || 0) < 36700160) {
      try {
        if (loadingMsg) loadingMsg.textContent = 'Loading fallback ZIP parser…';
        if (typeof JSZip === 'undefined') {
          await loadScript('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js');
        }
        var resp = await fetch(downloadUrl);
        if (!resp.ok) throw new Error('Could not fetch file content');
        var blob = await resp.blob();
        var zip = await JSZip.loadAsync(blob);

        allEntries = [];
        zip.forEach(function (relativePath, zipEntry) {
          allEntries.push({
            path: relativePath,
            dir: zipEntry.dir,
            date: zipEntry.date ? zipEntry.date.toISOString().replace('T', ' ').slice(0, 16) : '—',
            size: zipEntry._data ? (zipEntry._data.uncompressedSize || 0) : 0,
            encrypted: !!(zipEntry._data && zipEntry._data.encrypted)
          });
        });

        allEntries.sort(function (a, b) {
          if (a.dir && !b.dir) return -1;
          if (!a.dir && b.dir) return 1;
          return a.path.localeCompare(b.path);
        });

        if (toolbar) toolbar.style.display = 'block';
        renderList('');
        return;
      } catch (fallbackErr) {
        console.error('Fallback also failed:', fallbackErr);
      }
    }

    area.innerHTML = `
      <div style="text-align:center;padding:2.5rem 1rem">
        <i class="fas fa-triangle-exclamation" style="color:var(--warning);font-size:2.2rem;margin-bottom:.8rem"></i>
        <h4 style="margin-bottom:.4rem">Cannot Inspect Archive Online</h4>
        <p style="font-size:.82rem;color:var(--text3);max-width:380px;margin:0 auto 1.2rem;line-height:1.45">
          ${esc(err.message || 'Direct byte-range streaming is not supported or file format is corrupted.')}
        </p>
        <a href="${downloadUrl}" download="${esc(f.name)}" class="btn-primary sm"><i class="fas fa-download"></i> Download Archive (${fmt(f.size)})</a>
      </div>
    `;
  }
}

function loadScript(src) {
  return new Promise(function (resolve, reject) {
    if (document.querySelector('script[src="' + src + '"]')) return resolve();
    var s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}