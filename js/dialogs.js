var _cancelSignal = { cancelled: false, paused: false, resumeResolve: null };
window._isUploading = false;
window._uploadFilePool = window._uploadFilePool || new Map();

function poolUploadFiles(items, targetDrive, targetFolder) {
  if (!window._uploadFilePool) window._uploadFilePool = new Map();
  if (!Array.isArray(items)) return;
  items.forEach(function(item) {
    var file = item.file || item;
    var tId = item.tId || item.id;
    var info = {
      file: file,
      tId: tId,
      driveId: targetDrive || _driveId,
      folderId: targetFolder || _folderId || null,
      name: file.name,
      size: file.size,
      time: Date.now()
    };
    if (tId) window._uploadFilePool.set(tId, info);
    var key = (file.name || '') + '::' + (file.size || 0);
    window._uploadFilePool.set(key, info);
  });
}

function getPooledUploadFile(tId, name, size) {
  if (!window._uploadFilePool) return null;
  if (tId && window._uploadFilePool.has(tId)) return window._uploadFilePool.get(tId);
  var key = (name || '') + '::' + (size || 0);
  if (window._uploadFilePool.has(key)) return window._uploadFilePool.get(key);
  return null;
}

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
  var isOpenTarget = (_driveId && S.db && isDriveOpen(_driveId, S.db));
  var isAuth = (S.ses && S.ses.token);

  if (!isAuth && !isOpenTarget) {
    showSignInModal();
    toast('Please sign in or select an open drive', 'warning');
    return;
  }
  if (!_driveId) {
    var openIds = (typeof getOpenDriveIds === 'function') ? getOpenDriveIds(S.db) : [];
    if (openIds.length === 1) {
      _driveId = openIds[0];
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

  // Smart Deduplication Check in O(1) time
  var toUpload = [];
  var skippedCount = 0;
  var existingFileSet = new Set();
  if (S.db && Array.isArray(S.db.files)) {
    S.db.files.forEach(function(f) {
      if (!f.trashed && f.driveId === targetDrive && (f.folderId || null) === destFolder) {
        existingFileSet.add(f.name + '::' + f.size);
      }
    });
  }

  var tmList = tmLoad();
  var tmKeyMap = new Map();
  tmList.forEach(function(item) {
    tmKeyMap.set((item.name || '') + '::' + (item.size || 0), item);
  });
  var markedDoneIds = [];

  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    var isExisting = existingFileSet.has(f.name + '::' + f.size);
    if (isExisting) {
      skippedCount++;
      var matchTm = tmKeyMap.get(f.name + '::' + f.size);
      if (matchTm) {
        markedDoneIds.push(matchTm.id);
      }
    } else {
      toUpload.push(f);
    }
  }

  if (markedDoneIds.length > 0) {
    tmBatchDone(markedDoneIds);
  }

  if (skippedCount > 0) {
    toast('Smart Deduplication: ' + skippedCount + ' already uploaded (skipped). ' + toUpload.length + ' remaining.', 'info', 5000);
  }

  if (toUpload.length === 0) {
    toast('All ' + files.length + ' files are already uploaded in this folder!', 'success');
    try { localStorage.removeItem('td_active_batch'); } catch(e){}
    return;
  }

  // Pre-queue only the files that genuinely need uploading
  var fileItems = toUpload.map(function (f) {
    return { file: f, tId: uid(), name: f.name, size: f.size };
  });
  poolUploadFiles(fileItems, targetDrive, destFolder);
  tmAddBatchQueued(fileItems.map(function (x) { return { id: x.tId, name: x.name, size: x.size }; }));

  window._isUploading = true;
  window._isBatchUploading = true;
  await requestWakeLock();
  if (window.TeleDriveMobileBg) window.TeleDriveMobileBg.startKeepAlive();
  var uploadedCount = 0;

  try {
    for (var j = 0; j < fileItems.length; j++) {
      if (_cancelSignal.cancelled) break;
      if (j > 0 && j % 15 === 0) {
        await new Promise(function(r) { setTimeout(r, 0); });
      }
      var res = await uploadOne(fileItems[j].file, destFolder, fileItems[j].tId, null, targetDrive);
      if (res && res.ok) uploadedCount++;
      if (window.TeleDriveMobileBg) {
        var pct = Math.round((j + 1) / fileItems.length * 100);
        window.TeleDriveMobileBg.updateProgress({
          percent: pct,
          fileIndex: j + 1,
          totalFiles: fileItems.length,
          batchLoaded: j + 1,
          batchTotal: fileItems.length,
          speed: (res && res._speed) || 0,
          etaSec: 0,
          fileName: fileItems[j].file.name
        });
      }
    }
    if (uploadedCount === fileItems.length) {
      try { localStorage.removeItem('td_active_batch'); } catch (e) { }
    } else {
      var failedCount = fileItems.length - uploadedCount;
      if (failedCount > 0 && !_cancelSignal.cancelled) {
        toast(failedCount + ' file' + (failedCount > 1 ? 's' : '') + ' failed to upload. Check Transfers to retry!', 'warning', 7000);
        toggleTMPanel(true);
      }
    }
    if (window.TeleDriveMobileBg) {
      window.TeleDriveMobileBg.finishUpload(uploadedCount + ' file(s) uploaded successfully');
    }
  } finally {
    window._isUploading = false;
    window._isBatchUploading = false;
    releaseWakeLock();
    if (window.TeleDriveMobileBg) window.TeleDriveMobileBg.stopKeepAlive();
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
  var isOpenTarget = (_driveId && S.db && isDriveOpen(_driveId, S.db));
  var isAuth = (S.ses && S.ses.token);

  if (!isAuth && !isOpenTarget) {
    showSignInModal();
    toast('Please sign in or select an open drive', 'warning');
    return;
  }
  if (!_driveId) {
    var openIds = (typeof getOpenDriveIds === 'function') ? getOpenDriveIds(S.db) : [];
    if (openIds.length === 1) {
      _driveId = openIds[0];
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
  var batchDriveId = _driveId || (S.db && S.db.drives && S.db.drives[0] ? S.db.drives[0].id : null);
  var batchFolderId = _folderId || null;
  var isOpenTarget = (batchDriveId && S.db && isDriveOpen(batchDriveId, S.db));
  var isAuth = (S.ses && S.ses.token);

  if (!files.length) return;
  if (window.TeleDriveMobileBg) window.TeleDriveMobileBg.startKeepAlive();

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

  // ─── Smart Duplicate Folder Detection ───
  // Check if a folder with this exact name already exists in the target location
  var _existingRootFolder = (S.db && S.db.folders || []).find(function(f) {
    return f.driveId === batchDriveId &&
      (f.parentId || null) === (batchFolderId || null) &&
      f.name.toLowerCase() === rootFolder.toLowerCase() &&
      !f.trashed;
  });

  var _dupAction = null; // 'skip' | 'replace' | 'new' | null (folder didn't exist)

  if (_existingRootFolder) {
    // Count how many of these files are likely already uploaded (by name+size in that subtree)
    var _subtreeSet = new Set();
    if (S.db && Array.isArray(S.db.files)) {
      // Collect all folderId's in the existing folder subtree
      var _subtreeFolderIds = new Set([_existingRootFolder.id]);
      (function collectSubtree(parentId) {
        (S.db.folders || []).forEach(function(sf) {
          if (sf.parentId === parentId && !sf.trashed && sf.driveId === batchDriveId) {
            _subtreeFolderIds.add(sf.id);
            collectSubtree(sf.id);
          }
        });
      })(_existingRootFolder.id);
      S.db.files.forEach(function(ff) {
        if (!ff.trashed && ff.driveId === batchDriveId && _subtreeFolderIds.has(ff.folderId)) {
          _subtreeSet.add(ff.name + '::' + ff.size);
        }
      });
    }
    var _alreadyCount = files.filter(function(f) { return _subtreeSet.has(f.name + '::' + f.size); }).length;

    // Find next available [2], [3], etc. name
    var _newSuffix = 2;
    var _newRootName = rootFolder + ' [' + _newSuffix + ']';
    while ((S.db && S.db.folders || []).find(function(f) {
      return f.driveId === _driveId && (f.parentId || null) === (_folderId || null) && f.name === _newRootName && !f.trashed;
    })) {
      _newSuffix++;
      _newRootName = rootFolder + ' [' + _newSuffix + ']';
    }

    _dupAction = await new Promise(function(resolve) {
      // Build modal
      var ov = document.createElement('div');
      ov.className = 'modal-overlay';
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);backdrop-filter:blur(8px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
      var pct = files.length > 0 ? Math.round(_alreadyCount / files.length * 100) : 0;
      ov.innerHTML =
        '<div style="background:var(--surface,#13152a);border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:1.6rem;max-width:420px;width:100%;box-shadow:0 24px 60px rgba(0,0,0,.75);">' +
          '<div style="display:flex;align-items:center;gap:.8rem;margin-bottom:1.2rem;">' +
            '<div style="width:42px;height:42px;border-radius:12px;background:rgba(255,159,10,.15);color:#ff9f0a;display:flex;align-items:center;justify-content:center;font-size:1.2rem;flex-shrink:0;"><i class="fas fa-folder-open"></i></div>' +
            '<div>' +
              '<div style="font-size:1rem;font-weight:700;color:var(--text1,#e8eaf6);">Folder already exists</div>' +
              '<div style="font-size:.8rem;color:var(--text2,#8c90b0);margin-top:.15rem;">"<strong>' + esc(rootFolder) + '</strong>" · ' + files.length + ' files · ' + _alreadyCount + ' already uploaded (' + pct + '%)</div>' +
            '</div>' +
          '</div>' +
          '<div style="display:flex;flex-direction:column;gap:.5rem;">' +
            '<button id="dupSkipBtn" style="background:rgba(78,134,245,.15);border:1px solid rgba(78,134,245,.35);color:#4e86f5;border-radius:10px;padding:.7rem 1rem;cursor:pointer;text-align:left;font-size:.87rem;transition:background .18s;">' +
              '<i class="fas fa-forward-step" style="width:18px"></i> <strong>Skip existing</strong> — upload only new files' +
            '</button>' +
            '<button id="dupReplaceBtn" style="background:rgba(255,69,58,.1);border:1px solid rgba(255,69,58,.3);color:#ff453a;border-radius:10px;padding:.7rem 1rem;cursor:pointer;text-align:left;font-size:.87rem;transition:background .18s;">' +
              '<i class="fas fa-arrows-rotate" style="width:18px"></i> <strong>Re-upload all</strong> — overwrite everything' +
            '</button>' +
            '<button id="dupNewBtn" style="background:rgba(48,209,88,.1);border:1px solid rgba(48,209,88,.3);color:#30d158;border-radius:10px;padding:.7rem 1rem;cursor:pointer;text-align:left;font-size:.87rem;transition:background .18s;">' +
              '<i class="fas fa-folder-plus" style="width:18px"></i> <strong>Upload as "' + esc(_newRootName) + '"</strong> — keep both' +
            '</button>' +
            '<button id="dupCancelBtn" style="background:transparent;border:1px solid rgba(255,255,255,.1);color:var(--text2,#8c90b0);border-radius:10px;padding:.55rem 1rem;cursor:pointer;text-align:left;font-size:.84rem;">' +
              '<i class="fas fa-xmark" style="width:18px"></i> Cancel upload' +
            '</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(ov);
      function cleanup(val) { if (ov.parentNode) ov.parentNode.removeChild(ov); resolve(val); }
      ov.querySelector('#dupSkipBtn').onclick = function() { cleanup('skip'); };
      ov.querySelector('#dupReplaceBtn').onclick = function() { cleanup('replace'); };
      ov.querySelector('#dupNewBtn').onclick = function() { cleanup(_newRootName); };
      ov.querySelector('#dupCancelBtn').onclick = function() { cleanup('cancel'); };
      ov.addEventListener('mousedown', function(e) { if (e.target === ov) cleanup('cancel'); });
    });

    if (_dupAction === 'cancel') return;
    // If user chose a new name like "tera [2]", update rootFolder
    if (_dupAction !== 'skip' && _dupAction !== 'replace') {
      rootFolder = _dupAction; // e.g. "tera [2]"
      _dupAction = 'new'; // just flag it
    }
  }

  try {
    localStorage.setItem('td_active_batch', JSON.stringify({
      driveId: batchDriveId,
      folderId: batchFolderId,
      folderName: rootFolder,
      total: files.length,
      time: Date.now()
    }));
  } catch (e) { }



  window._isUploading = true;
  window._isBatchUploading = true;
  await requestWakeLock();
  toast('Preparing folder "' + rootFolder + '" (' + files.length + ' files)…', 'info');


  // ── Batch progress tracking ──
  var _batchTotal = files.length;          // all files (for overall %)
  var _batchDone = 0;                       // total processed (uploaded + skipped + failed)
  var _batchUploaded = 0;                   // actually uploaded this session
  var _batchSkipped = 0;                    // skipped (already existed)
  var _batchStartTs = Date.now();
  var _uploadedBatchBytes = 0;
  var _estUploadBytes = 0;

  // Show overall progress bar
  var upOverall = $('upOverall'), upOverallFill = $('upOverallFill'), upOverallLabel = $('upOverallLabel');
  if (upOverall) upOverall.classList.remove('hidden');

  // type: 'upload' | 'skip' | 'fail'
  function updateOverallBar(type, bytes) {
    _batchDone++;
    if (type === 'upload') {
      _batchUploaded++;
      _uploadedBatchBytes += (bytes || 0);
    } else if (type === 'skip') {
      _batchSkipped++;
    }
    // Progress % based on total files processed
    var pct = _batchTotal > 0 ? Math.round(_batchDone / _batchTotal * 100) : 0;
    if (upOverallFill) upOverallFill.style.width = pct + '%';
    if (upOverallLabel) {
      var uploadsLeft = Math.max(0, _estUploads - _batchUploaded);
      var parts = [];
      parts.push('\u2191 ' + _batchUploaded + ' / ' + _estUploads + ' uploaded');
      if (_batchSkipped > 0) parts.push('\u26a1 ' + _batchSkipped + ' skipped');

      // Realistic ETA based on sustained file rate and batch byte throughput
      var remBytes = Math.max(0, _estUploadBytes - _uploadedBatchBytes);
      var etaStr = '';
      if (_batchUploaded >= 3 && uploadsLeft > 0) {
        var elapsed = (Date.now() - _batchStartTs) / 1000;
        var secPerUpload = elapsed / _batchUploaded;
        var fileEtaSec = Math.round(secPerUpload * uploadsLeft);

        var sustainedByteRate = elapsed > 0 ? (_uploadedBatchBytes / elapsed) : 0;
        var byteEtaSec = (sustainedByteRate > 20480 && remBytes > 0) ? Math.round(remBytes / sustainedByteRate) : 0;

        var etaSec = (byteEtaSec > 0 && Math.abs(byteEtaSec - fileEtaSec) < fileEtaSec * 2.5)
          ? Math.round(byteEtaSec * 0.45 + fileEtaSec * 0.55)
          : fileEtaSec;

        if (etaSec > 0 && etaSec < 86400 * 2) {
          etaStr = ' · ~' + fmtEtaSec(etaSec);
        }
      }
      var remSizeStr = remBytes > 0 && uploadsLeft > 0 ? ' (' + fmt(remBytes) + ')' : '';
      upOverallLabel.textContent = parts.join(' · ') + (uploadsLeft > 0 ? ' · ' + uploadsLeft + ' left' + remSizeStr : ' · Done!') + etaStr;

      if (window.TeleDriveMobileBg) {
        window.TeleDriveMobileBg.updateProgress({
          percent: pct,
          fileIndex: _batchDone,
          totalFiles: _batchTotal,
          batchLoaded: _uploadedBatchBytes,
          batchTotal: _estUploadBytes || _uploadedBatchBytes,
          speed: (typeof sustainedByteRate !== 'undefined' ? sustainedByteRate : 0),
          etaSec: (typeof etaSec !== 'undefined' ? etaSec : 0),
          fileName: (files && files[_batchDone - 1] ? files[_batchDone - 1].name : rootFolder)
        });
      }
    }
  }


  // Pre-queue all folder files upfront in batch
  var fileItems = files.map(function (f) {
    return { file: f, tId: uid(), name: f.name, size: f.size };
  });
  poolUploadFiles(fileItems, batchDriveId, null);
  tmAddBatchQueued(fileItems.map(function (x) { return { id: x.tId, name: x.name, size: x.size }; }));
  renderTM();


  // Build fast O(1) lookup set for existing files
  var existingFileSet = new Set();
  // Also build a simpler name::size set for fast pre-scan (no folderId needed)
  var existingNameSizeSet = new Set();
  // If user chose 'replace' or 'new folder', skip dedup — re-upload all files
  if (_dupAction !== 'replace' && _dupAction !== 'new') {
    if (S.db && Array.isArray(S.db.files)) {
      S.db.files.forEach(function(f) {
        if (!f.trashed && f.driveId === batchDriveId) {
          existingFileSet.add((f.folderId || '') + '::' + f.name + '::' + f.size);
          existingFileSet.add((f.folderId || '') + '::' + (f.name || '').toLowerCase().trim() + '::' + f.size);
          existingNameSizeSet.add(f.name + '::' + f.size);
          existingNameSizeSet.add((f.name || '').toLowerCase().trim() + '::' + f.size);
        }
      });
    }
  }

  // ── Pre-scan: estimate how many files will be skipped vs uploaded ──
  var _estSkips = 0;
  _estUploadBytes = 0;
  fileItems.forEach(function(item) {
    var isSkip = existingNameSizeSet.has(item.file.name + '::' + item.file.size) ||
                 existingNameSizeSet.has((item.file.name || '').toLowerCase().trim() + '::' + item.file.size);
    if (isSkip) {
      _estSkips++;
    } else {
      _estUploadBytes += (item.file.size || 0);
    }
  });
  var _estUploads = fileItems.length - _estSkips; // files that will actually be uploaded


  // ─── Phase 1: Pre-create ALL folder structures upfront in seconds ───
  var folderMap = {}; // relative path -> folderId
  var folderGoogleMap = {}; // relative path -> googleFolderId
  var uniquePaths = new Set();

  // If user is currently browsing inside a folder whose name matches rootFolder, avoid redundant nesting!
  var curFolderObj = batchFolderId && S.db && S.db.folders ? S.db.folders.find(function(f){ return f.id === batchFolderId; }) : null;
  if (curFolderObj && curFolderObj.name.toLowerCase() === rootFolder.toLowerCase()) {
    folderMap[rootFolder] = batchFolderId;
    if (curFolderObj.googleFolderId) folderGoogleMap[rootFolder] = curFolderObj.googleFolderId;
  } else if (_existingRootFolder && !folderMap[rootFolder]) {
    folderMap[rootFolder] = _existingRootFolder.id;
    if (_existingRootFolder.googleFolderId) folderGoogleMap[rootFolder] = _existingRootFolder.googleFolderId;
  }

  files.forEach(function (f) {
    var relPath = f.webkitRelativePath || f.name;
    var parts = relPath.split('/');
    if (parts.length > 1) {
      var pathAcc = '';
      for (var p = 0; p < parts.length - 1; p++) {
        pathAcc += (pathAcc ? '/' : '') + parts[p];
        uniquePaths.add(pathAcc);
      }
    }
  });

  // Sort paths by depth (shallowest first, e.g. "tera", then "tera/Act Class")
  var sortedPaths = Array.from(uniquePaths).sort(function (a, b) {
    return a.split('/').length - b.split('/').length;
  });

  if (sortedPaths.length > 0) {
    var upStatus = $('upStatus');
    if (upStatus) upStatus.textContent = 'Pre-creating ' + sortedPaths.length + ' folder(s) on Google Drive…';
    for (var sp = 0; sp < sortedPaths.length; sp++) {
      if (_cancelSignal && _cancelSignal.cancelled) break;
      var currentPath = sortedPaths[sp];
      if (currentPath === rootFolder && folderMap[rootFolder]) {
        continue;
      }
      var pParts = currentPath.split('/');
      var parentAcc = pParts.slice(0, -1).join('/');
      var fName = pParts[pParts.length - 1];

      // Safely resolve parentAcc hierarchy from S.db.folders if not yet mapped
      if (parentAcc && !folderMap[parentAcc] && S.db && Array.isArray(S.db.folders)) {
        var accParts = parentAcc.split('/');
        var walkParent = batchFolderId || null;
        for (var ap = 0; ap < accParts.length; ap++) {
          var pName = accParts[ap];
          var walkedPath = accParts.slice(0, ap + 1).join('/');
          if (folderMap[walkedPath]) {
            walkParent = folderMap[walkedPath];
            continue;
          }
          var match = S.db.folders.find(function(f) {
            return f.driveId === batchDriveId && f.parentId === walkParent && f.name.toLowerCase() === pName.toLowerCase() && !f.trashed;
          });
          if (match) {
            walkParent = match.id;
            folderMap[walkedPath] = match.id;
            if (match.googleFolderId) folderGoogleMap[walkedPath] = match.googleFolderId;
          }
        }
      }

      var curParentId = parentAcc ? folderMap[parentAcc] : (batchFolderId || null);
      var curParentGoogleId = parentAcc ? folderGoogleMap[parentAcc] : (curFolderObj ? curFolderObj.googleFolderId : null);

      // Safety: Never dump subfolders into root if parentAcc failed to resolve
      if (parentAcc && !curParentId) {
        console.warn('Skipping orphan folder creation for unresolved parent:', currentPath);
        continue;
      }

      var existing = (S.db && S.db.folders || []).find(function (f) {
        return f.driveId === batchDriveId && f.parentId === curParentId && f.name.toLowerCase() === fName.toLowerCase() && !f.trashed;
      });

      if (existing) {
        folderMap[currentPath] = existing.id;
        if (existing.googleFolderId) folderGoogleMap[currentPath] = existing.googleFolderId;
      } else {
        try {
          var created = await apiCreateFolder({
            driveId: batchDriveId,
            parentFolderId: curParentId,
            parentGoogleFolderId: curParentGoogleId,
            name: fName
          });
          if (created && created.folderId) {
            folderMap[currentPath] = created.folderId;
            if (created.googleFolderId) folderGoogleMap[currentPath] = created.googleFolderId;
            if (!S.db.folders) S.db.folders = [];
            S.db.folders.push({
              id: created.folderId,
              googleFolderId: created.googleFolderId,
              driveId: batchDriveId,
              parentId: curParentId,
              name: fName
            });
          }
        } catch (e) {
          console.warn('Folder pre-creation error:', fName, e);
          // Recovery: the folder may have been created on Google Drive but the response timed out.
          // Check S.db.folders in case it was pushed by a previous attempt — prevents duplicates on resume.
          var recovered = (S.db && S.db.folders || []).find(function(r) {
            return r.driveId === batchDriveId && r.parentId === curParentId
              && r.name.toLowerCase() === fName.toLowerCase() && !r.trashed;
          });
          if (recovered) {
            folderMap[currentPath] = recovered.id;
            if (recovered.googleFolderId) folderGoogleMap[currentPath] = recovered.googleFolderId;
          }
          // If still not found, file uploads for this path will be safely skipped below.
        }
      }
    }

    // Instantly refresh files grid so ALL folders appear immediately in the UI!
    if (typeof cacheDBLocally === 'function' && S.db) cacheDBLocally(S.db);
    renderSidebarStorage();
    renderFilesPage(_driveId, _folderId);
  }

  // ─── Phase 2: Upload files into pre-created folders ───
  var skippedCount = 0;
  var uploadedCount = 0;
  var skippedIds = [];

  try {
    for (var i = 0; i < fileItems.length; i++) {
      if (_cancelSignal.cancelled) break;
      if (i > 0 && i % 15 === 0) {
        // Yield to browser event loop so UI stays completely fluid
        await new Promise(function(r) { setTimeout(r, 0); });
      }
      var item = fileItems[i];
      var file = item.file;
      var relPath = file.webkitRelativePath || file.name;
      var parts = relPath.split('/');
      var parentAcc = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
      // Resolve parentId — if parentAcc is set but the folder wasn't created, skip this file
      // rather than dumping it into the wrong parent (tera root or browse folder).
      var parentId = null;
      if (parentAcc) {
        parentId = folderMap[parentAcc] || null;
        if (!parentId) {
          // Folder creation failed and recovery also failed — skip this file.
          updateOverallBar('fail', 0);
          tmDone(item.tId, false);
          continue;
        }
      } else {
        parentId = _folderId || null;
      }

      // Resolve parentGoogleId — look up in map, then DB, but NEVER fall back to curFolderObj
      // (that would put the file in the wrong Google Drive folder).
      var parentGoogleId = null;
      if (parentAcc) {
        if (folderGoogleMap[parentAcc]) {
          parentGoogleId = folderGoogleMap[parentAcc];
        } else {
          // Try to recover from DB using our local folderId
          var _pf = (S.db && S.db.folders || []).find(function(f) { return f.id === parentId; });
          if (_pf && _pf.googleFolderId) parentGoogleId = _pf.googleFolderId;
        }
        // If still null, pass null — backend will use its own rootFolderId fallback (safer than wrong folder).
      } else {
        parentGoogleId = curFolderObj ? curFolderObj.googleFolderId : null;
      }

      // Smart Resume & Deduplication in O(1) time
      var isAlreadyUploaded = existingFileSet.has((parentId || '') + '::' + file.name + '::' + file.size) ||
                              existingFileSet.has((parentId || '') + '::' + (file.name || '').toLowerCase().trim() + '::' + file.size);

      if (isAlreadyUploaded) {
        skippedCount++;
        skippedIds.push(item.tId);
        updateOverallBar('skip', 0); // count skips toward total progress
        if (skippedIds.length >= 25) {
          tmBatchDone(skippedIds);
          skippedIds = [];
          var st = $('upStatus');
          if (st) st.textContent = 'Skipping already uploaded (' + skippedCount + ' skipped)…';
          await new Promise(function(r) { setTimeout(r, 0); });
        }
        continue;
      }

      if (skippedIds.length > 0) {
        tmBatchDone(skippedIds);
        skippedIds = [];
      }

      var res = await uploadOne(file, parentId, item.tId, parentGoogleId, batchDriveId);
      if (res && res.ok) {
        uploadedCount++;
        updateOverallBar('upload', file.size);
      } else {
        updateOverallBar('fail', 0); // failed — still count toward progress
      }
    }

    if (skippedIds.length > 0) {
      tmBatchDone(skippedIds);
      skippedIds = [];
    }

    var failedCount = fileItems.length - skippedCount - uploadedCount;
    if (failedCount > 0 && !_cancelSignal.cancelled) {
      toast(failedCount + ' folder file' + (failedCount > 1 ? 's' : '') + ' failed to upload. Check Transfers to retry!', 'warning', 7000);
      toggleTMPanel(true);
    } else if (skippedCount > 0) {
      toast('Folder upload complete! ' + uploadedCount + ' uploaded, ' + skippedCount + ' existing skipped.', 'success');
    } else {
      toast('Folder upload complete (' + uploadedCount + ' files)', 'success');
    }
  } finally {
    window._isUploading = false;
    window._isBatchUploading = false;
    releaseWakeLock();
    if (window.TeleDriveMobileBg) {
      window.TeleDriveMobileBg.finishUpload(uploadedCount + ' folder file(s) uploaded');
      window.TeleDriveMobileBg.stopKeepAlive();
    }
    // Hide overall progress bar
    if (upOverall) upOverall.classList.add('hidden');
    if (upOverallFill) upOverallFill.style.width = '0%';
    try { localStorage.removeItem('td_active_batch'); } catch (e) { }
    try {
      S.db = await apiFetchDB();
      if (S.db && S.db.files) tmSyncWithServer(S.db.files);
    } catch(e) {}
    renderSidebarStorage();
    renderFilesPage(_driveId, _folderId);
  }
}

async function generateLocalVideoThumbnail(file) {
  return new Promise(function (resolve) {
    if (!file) return resolve(null);
    var isVid = (file.type && file.type.startsWith('video/')) || /\.(mp4|mov|webm|m4v|mkv|avi)$/i.test(file.name);
    if (!isVid) return resolve(null);
    try {
      var video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      var objUrl = URL.createObjectURL(file);
      video.src = objUrl;

      var done = false;
      var timer = setTimeout(function () {
        if (!done) {
          done = true;
          URL.revokeObjectURL(objUrl);
          resolve(null);
        }
      }, 5000);

      video.onloadedmetadata = function () {
        var seekTime = 1;
        if (video.duration && video.duration > 0) {
          seekTime = Math.min(2, video.duration * 0.15);
        }
        video.currentTime = seekTime;
      };

      video.onseeked = function () {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try {
          var canvas = document.createElement('canvas');
          var w = video.videoWidth || 360;
          var h = video.videoHeight || 200;
          var maxDim = 360;
          var scale = Math.min(1, maxDim / Math.max(w, h));
          canvas.width = Math.round(w * scale);
          canvas.height = Math.round(h * scale);
          var ctx = canvas.getContext('2d');
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          var dataUrl = canvas.toDataURL('image/jpeg', 0.8);
          URL.revokeObjectURL(objUrl);
          resolve(dataUrl);
        } catch (e) {
          URL.revokeObjectURL(objUrl);
          resolve(null);
        }
      };

      video.onerror = function () {
        if (done) return;
        done = true;
        clearTimeout(timer);
        URL.revokeObjectURL(objUrl);
        resolve(null);
      };
    } catch (e) {
      resolve(null);
    }
  });
}

async function generateLocalImageThumbnail(file) {
  return new Promise(function (resolve) {
    if (!file) return resolve(null);
    var isImg = (file.type && file.type.startsWith('image/')) || /\.(jpg|jpeg|png|webp|gif|bmp|heic|heif|avif)$/i.test(file.name);
    if (!isImg) return resolve(null);
    if (window.createImageBitmap) {
      createImageBitmap(file).then(function (bmp) {
        var canvas = document.createElement('canvas');
        var maxDim = 360;
        var scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
        canvas.width = Math.round(bmp.width * scale);
        canvas.height = Math.round(bmp.height * scale);
        var ctx = canvas.getContext('2d');
        ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
        var dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        resolve(dataUrl);
      }).catch(function () {
        resolve(null);
      });
      return;
    }
    resolve(null);
  });
}

async function uploadOne(file, targetFolderId, existingTid, targetGoogleFolderId, targetDriveId) {
  _cancelSignal = { cancelled: false, paused: false, resumeResolve: null, xhr: null };
  var tId = existingTid || uid();
  var upBar = $('upBar'), upName = $('upName'), upStatus = $('upStatus'), upFill = $('upFill'), upPct = $('upPct'), upPauseBtn = $('upPauseBtn');

  // Resolve target drive reliably: parameter > folder's driveId > current _driveId > default drive in db
  var targetFolderObj = targetFolderId && S.db && Array.isArray(S.db.folders) ? S.db.folders.find(function(f){ return f.id === targetFolderId || f.googleFolderId === targetFolderId; }) : null;
  var resolvedDriveId = targetDriveId || (targetFolderObj ? targetFolderObj.driveId : null) || _driveId || (S.db && S.db.drives && S.db.drives[0] ? S.db.drives[0].id : null);

  if (upBar) {
    upBar.classList.remove('hidden');
    document.body.classList.add('has-active-upload');
  }
  if (upPauseBtn) {
    upPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
    upPauseBtn.onclick = toggleUploadPause;
  }
  if (upName) upName.textContent = file.name;
  if (upStatus) upStatus.textContent = 'Initializing…';
  if (!window._isBatchUploading && window.TeleDriveMobileBg) {
    window.TeleDriveMobileBg.startKeepAlive();
  }
  tmAdd(tId, file.name, file.size);
  poolUploadFiles([{ file: file, tId: tId }], resolvedDriveId, targetFolderId);

  var maxRetries = 2;
  var lastErr = null;

  try {
    for (var attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (_cancelSignal && _cancelSignal.cancelled) throw new Error('Cancelled');
        var destFolder = targetFolderId || _folderId || null;
        var destGoogleFolder = targetGoogleFolderId || null;
        if (!destGoogleFolder && destFolder && S.db && Array.isArray(S.db.folders)) {
          var matchedF = S.db.folders.find(function(f){ return f.id === destFolder || f.googleFolderId === destFolder; });
          if (matchedF && matchedF.googleFolderId) destGoogleFolder = matchedF.googleFolderId;
          else if (destFolder.length > 20 && !destFolder.includes('-')) destGoogleFolder = destFolder;
        }
        var isVid = (file.type && file.type.startsWith('video/')) || /\.(mp4|mov|webm|m4v|mkv|avi)$/i.test(file.name);
        var isImg = (file.type && file.type.startsWith('image/')) || /\.(jpg|jpeg|png|webp|gif|bmp|heic|heif|avif)$/i.test(file.name);
        var localThumbPromise = isVid ? generateLocalVideoThumbnail(file) : isImg ? generateLocalImageThumbnail(file) : Promise.resolve(null);

        // Step 1: Get Google Drive resumable upload URL from backend
        if (upStatus) upStatus.textContent = (attempt > 1 ? 'Auto-retrying (' + attempt + '/' + maxRetries + ')… ' : '') + 'Connecting…';
        var init = await apiUploadInit(resolvedDriveId, destFolder, file.name, file.size, file.type || 'application/octet-stream', destGoogleFolder);

        if (!init || !init.uploadUrl) {
          throw new Error(init ? (init.error || 'Upload init failed — check that drive is connected') : 'Upload init response empty');
        }

        // Step 2: Upload directly to Google Drive (with Pause & Resume capability!)
        if (upStatus) upStatus.textContent = (attempt > 1 ? 'Auto-retrying (' + attempt + '/' + maxRetries + ')… ' : '') + 'Uploading…';
        var _lastSpeed = 0;
        var result = await uploadToGoogleResumable(init.uploadUrl, file, function (loaded, total, speed) {
          _lastSpeed = speed || _lastSpeed;
          var pct = total > 0 ? Math.round(loaded / total * 100) : 0;
          if (upFill) upFill.style.width = pct + '%';
          if (upPct) upPct.textContent = pct + '%';
          var eta = (speed > 0 && total > loaded) ? fmtEta(total - loaded, speed) : '';
          if (upStatus && !_cancelSignal.paused) upStatus.textContent = fmt(loaded) + ' / ' + fmt(total) + (speed > 0 ? ' · ' + fmtSpeed(speed) : '') + (eta ? ' · ' + eta : '');
          tmUpdate(tId, pct, speed, loaded);
          if (!window._isBatchUploading && window.TeleDriveMobileBg) {
            var singleEta = (speed > 0 && total > loaded) ? Math.round((total - loaded) / speed) : 0;
            window.TeleDriveMobileBg.updateProgress({
              percent: pct,
              fileIndex: 1,
              totalFiles: 1,
              batchLoaded: loaded,
              batchTotal: total,
              speed: speed,
              etaSec: singleEta,
              fileName: file.name
            });
          }
        }, _cancelSignal);

        if (!result || !result.googleFileId) {
          throw new Error('Upload completed but Google did not return a valid file ID');
        }

        var localThumb = await localThumbPromise;
        if (localThumb) {
          try {
            var prefix = isVid ? 'td_vthumb_' : 'td_ithumb_';
            var thumbKeys = [];
            for (var tk = 0; tk < localStorage.length; tk++) {
              var k = localStorage.key(tk);
              if (k && (k.startsWith('td_vthumb_') || k.startsWith('td_ithumb_'))) thumbKeys.push(k);
            }
            if (thumbKeys.length > 25) {
              thumbKeys.slice(0, thumbKeys.length - 20).forEach(function(k){ try{ localStorage.removeItem(k); }catch(e){} });
            }
            localStorage.setItem(prefix + result.googleFileId, localThumb);
          } catch(e) {}
        }

        // Step 3: Save metadata to our DB
        if (upStatus) upStatus.textContent = 'Saving…';
        var activeDriveId = resolvedDriveId || (S.db && S.db.drives && S.db.drives[0] ? S.db.drives[0].id : null);
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

        // Update DB state locally in memory (instant 0ms, 0 bytes bandwidth!)
        if (S.db && S.db.files) {
          S.db.files.push({
            id: init.fileLocalId,
            googleFileId: result.googleFileId,
            driveId: activeDriveId,
            folderId: destFolder || null,
            name: file.name,
            size: file.size,
            mimeType: file.type || 'application/octet-stream',
            date: new Date().toISOString()
          });
          tmSyncWithServer(S.db.files);
        }
        renderSidebarStorage();
        if (!window._isBatchUploading) {
          renderFilesPage(_driveId, _folderId);
        }
        lastErr = null;
        return { ok: true, _speed: _lastSpeed };

      } catch (e) {
        lastErr = e;
        if (_cancelSignal && _cancelSignal.cancelled || e.message === 'Cancelled') break;
        if (attempt < maxRetries) {
          if (upStatus) upStatus.textContent = 'Connection glitch · Auto-retrying (' + attempt + '/' + maxRetries + ') in 1.5s…';
          await new Promise(function(r){ setTimeout(r, 1500); });
        }
      }
    }
  } finally {
    if (upBar) upBar.classList.add('hidden');
    document.body.classList.remove('has-active-upload');
    if (upFill) upFill.style.width = '0%';
    if (upPct) upPct.textContent = '0%';
    if (!window._isBatchUploading && window.TeleDriveMobileBg) {
      window.TeleDriveMobileBg.finishUpload();
      window.TeleDriveMobileBg.stopKeepAlive();
    }
  }

  if (lastErr) {
    if (lastErr.message === 'Cancelled') toast('Upload cancelled', 'warning');
    else toast('Upload failed: ' + lastErr.message, 'error');
    tmDone(tId, false, lastErr.message);
    return { ok: false, error: lastErr.message };
  }
  return { ok: false, error: 'Upload interrupted' };
}

// ─── Failed Upload Retry Handlers ──────────────────────────────────────────
async function retrySingleUpload(tId) {
  var transfers = tmLoad();
  var item = transfers.find(function(x) { return x.id === tId; });
  if (!item) {
    item = transfers.find(function(x) { return (x.name + '::' + x.size) === tId; });
  }
  if (!item) {
    toast('Transfer item not found', 'warning');
    return;
  }

  if (window._isUploading) {
    toast('Another upload is currently in progress. Please wait for it to complete.', 'warning');
    return;
  }

  var pooled = getPooledUploadFile(item.id, item.name, item.size);
  if (!pooled || !pooled.file) {
    promptFileForRetry(item);
    return;
  }

  toast('Retrying upload for "' + item.name + '"…', 'info');
  item.status = 'queued';
  item.pct = 0;
  item.uploaded = 0;
  item.speed = 0;
  delete item.error;
  tmSave(transfers, true);
  renderTM();

  window._isUploading = true;
  await requestWakeLock();
  var prevDrive = _driveId;

  try {
    var destFolder = pooled.folderId || _folderId || null;
    var retryDriveId = pooled.driveId || (destFolder && S.db && Array.isArray(S.db.folders) ? (S.db.folders.find(function(f){ return f.id === destFolder; })||{}).driveId : null) || _driveId || (S.db && S.db.drives && S.db.drives[0] ? S.db.drives[0].id : null);
    var res = await uploadOne(pooled.file, destFolder, item.id, null, retryDriveId);
    if (res && res.ok) {
      toast('"' + item.name + '" uploaded successfully!', 'success');
    }
  } finally {
    _driveId = prevDrive;
    window._isUploading = false;
    releaseWakeLock();
    try {
      S.db = await apiFetchDB();
      if (S.db && S.db.files) tmSyncWithServer(S.db.files);
    } catch(e) {}
    renderSidebarStorage();
    renderFilesPage(_driveId, _folderId);
    renderTM();
  }
}

async function retryAllFailedUploads() {
  var transfers = tmLoad();
  var failedItems = transfers.filter(function(x) { return x.status === 'failed'; });
  if (failedItems.length === 0) {
    toast('No failed uploads found', 'info');
    return;
  }

  if (window._isUploading) {
    toast('Another upload is in progress. Please wait for it to complete.', 'warning');
    return;
  }

  var canRetry = [];
  var missingFiles = [];

  failedItems.forEach(function(item) {
    var pooled = getPooledUploadFile(item.id, item.name, item.size);
    if (pooled && pooled.file) {
      canRetry.push({ item: item, pooled: pooled });
    } else {
      missingFiles.push(item);
    }
  });

  if (canRetry.length === 0 && missingFiles.length > 0) {
    promptResumeFailedUploads(missingFiles);
    return;
  }

  toast('Retrying ' + canRetry.length + ' failed upload' + (canRetry.length > 1 ? 's' : '') + '…', 'info');

  canRetry.forEach(function(pair) {
    pair.item.status = 'queued';
    pair.item.pct = 0;
    pair.item.uploaded = 0;
    pair.item.speed = 0;
    delete pair.item.error;
  });
  tmSave(transfers, true);
  renderTM();

  window._isUploading = true;
  window._isBatchUploading = true;
  await requestWakeLock();
  if (window.TeleDriveMobileBg) window.TeleDriveMobileBg.startKeepAlive();
  var prevDrive = _driveId;
  var successCount = 0;

  try {
    for (var i = 0; i < canRetry.length; i++) {
      if (_cancelSignal && _cancelSignal.cancelled) break;
      var pair = canRetry[i];
      var destFolder = pair.pooled.folderId || _folderId || null;
      var retryDriveId = pair.pooled.driveId || (destFolder && S.db && Array.isArray(S.db.folders) ? (S.db.folders.find(function(f){ return f.id === destFolder; })||{}).driveId : null) || _driveId || (S.db && S.db.drives && S.db.drives[0] ? S.db.drives[0].id : null);
      var res = await uploadOne(pair.pooled.file, destFolder, pair.item.id, null, retryDriveId);
      if (res && res.ok) successCount++;
      if (window.TeleDriveMobileBg) {
        var pct = Math.round((i + 1) / canRetry.length * 100);
        window.TeleDriveMobileBg.updateProgress({
          percent: pct,
          fileIndex: i + 1,
          totalFiles: canRetry.length,
          batchLoaded: i + 1,
          batchTotal: canRetry.length,
          speed: (res && res._speed) || 0,
          etaSec: 0,
          fileName: pair.item.name
        });
      }
    }
  } finally {
    _driveId = prevDrive;
    window._isUploading = false;
    window._isBatchUploading = false;
    releaseWakeLock();
    if (window.TeleDriveMobileBg) {
      window.TeleDriveMobileBg.finishUpload();
      window.TeleDriveMobileBg.stopKeepAlive();
    }
    try {
      S.db = await apiFetchDB();
      if (S.db && S.db.files) tmSyncWithServer(S.db.files);
    } catch(e) {}
    renderSidebarStorage();
    renderFilesPage(_driveId, _folderId);
    renderTM();
  }

  if (successCount > 0) {
    toast('Successfully uploaded ' + successCount + ' retry file' + (successCount > 1 ? 's' : '') + '!', 'success');
  }
  if (missingFiles.length > 0) {
    toast(missingFiles.length + ' file(s) require re-selecting because browser was refreshed.', 'warning', 6000);
  }
}

function promptFileForRetry(item) {
  var inp = document.createElement('input');
  inp.type = 'file';
  inp.style.display = 'none';
  document.body.appendChild(inp);
  inp.onchange = function() {
    if (inp.files && inp.files.length) {
      var f = inp.files[0];
      poolUploadFiles([{ file: f, tId: item.id }], _driveId, _folderId);
      retrySingleUpload(item.id);
    }
    inp.remove();
  };
  inp.click();
  toast('Page was reloaded. Select "' + item.name + '" to retry', 'info', 6000);
}

function promptResumeFailedUploads(missingItems) {
  var ov = document.createElement('div');
  ov.className = 'modal-backdrop';
  ov.innerHTML = '<div class="modal" style="max-width:440px;text-align:center;padding:2rem 1.6rem">' +
    '<div class="modal-ico" style="background:rgba(255,69,58,0.15);color:#ff453a;font-size:2rem;width:60px;height:60px;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 1.2rem"><i class="fas fa-rotate-right"></i></div>' +
    '<h3 style="margin-bottom:.5rem">Retry ' + missingItems.length + ' Failed File' + (missingItems.length > 1 ? 's' : '') + '</h3>' +
    '<p style="color:var(--text2);font-size:.85rem;line-height:1.5;margin-bottom:1.5rem">The browser was reloaded, so file access needs to be granted. Select your folder or files to grant access. Already uploaded files will be skipped automatically with Smart Deduplication!</p>' +
    '<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">' +
      '<button class="btn-primary sm" id="retrySelFilesBtn"><i class="fas fa-file-arrow-up"></i> Select Files</button>' +
      '<button class="btn-primary sm" id="retrySelFolderBtn" style="background:linear-gradient(135deg,#ff9f0a,#ff6a00)"><i class="fas fa-folder-arrow-up"></i> Select Folder</button>' +
      '<button class="btn-ghost sm" id="retryCancelBtn">Cancel</button>' +
    '</div>' +
  '</div>';
  document.body.appendChild(ov);

  ov.querySelector('#retryCancelBtn').onclick = function() { ov.remove(); };
  ov.querySelector('#retrySelFilesBtn').onclick = function() {
    ov.remove();
    var fi = $('fileInput');
    if (fi) fi.click();
    else {
      var inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true; inp.style.display = 'none';
      document.body.appendChild(inp);
      inp.onchange = function() { if (inp.files.length) uploadFiles(inp.files); inp.remove(); };
      inp.click();
    }
  };
  ov.querySelector('#retrySelFolderBtn').onclick = function() {
    ov.remove();
    uploadFolder();
  };
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
        <div style="margin-bottom:.85rem">
          <label style="font-size:.78rem;font-weight:600;display:block;margin-bottom:.35rem;color:var(--text2)">Confirm Password</label>
          <div style="position:relative">
            <input type="password" id="lockFolderPassConfirm" class="inp" placeholder="Re-type password" required style="width:100%;padding-right:40px">
            <button type="button" class="icon-btn xs" style="position:absolute;right:8px;top:50%;transform:translateY(-50%)" onclick="var p=document.getElementById('lockFolderPassConfirm');p.type=p.type==='password'?'text':'password';this.innerHTML='<i class=\\'fas fa-'+(p.type==='password'?'eye':'eye-slash')+'\\'></i>';"><i class="fas fa-eye"></i></button>
          </div>
        </div>
        <div style="margin-bottom:1rem">
          <label style="font-size:.78rem;font-weight:600;display:block;margin-bottom:.35rem;color:var(--text2)">Password Hint <span style="font-weight:400;color:var(--text3)">(Optional)</span></label>
          <input type="text" id="lockFolderHint" class="inp" placeholder="e.g. My favorite pet or childhood street" maxlength="100" style="width:100%">
          <div style="font-size:.72rem;color:var(--text3);margin-top:3px">Displayed when unlocking to help you remember your password.</div>
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
  var hintInp = ov.querySelector('#lockFolderHint');
  if (passInp) passInp.focus();

  ov.querySelector('#lockFolderForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var val = passInp.value.trim();
    var conf = passConf.value.trim();
    var hint = hintInp ? hintInp.value.trim() : '';
    if (!val) { toast('Password cannot be empty', 'warning'); return; }
    if (val !== conf) {
      toast('Passwords do not match! Please verify.', 'error');
      passConf.focus();
      return;
    }
    var btn = ov.querySelector('#submitLockBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Protecting…';
    var res = await apiLockFolder(folderId, val, hint);
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
  var lockoutEnabled = !(S.db && S.db.policy && S.db.policy.folderLockoutEnabled === false);
  try {
    var rawP = localStorage.getItem('td_policy');
    if (rawP) {
      var parsedP = JSON.parse(rawP);
      if (parsedP && parsedP.folderLockoutEnabled === false) lockoutEnabled = false;
    }
  } catch(e){}

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

      ${folder.passwordHint ? `
        <div style="background:rgba(10,132,255,0.08);border:1px solid rgba(10,132,255,0.25);border-radius:8px;padding:.55rem .75rem;font-size:.78rem;color:#0a84ff;margin-bottom:1rem;line-height:1.4;text-align:left;display:flex;align-items:flex-start;gap:8px">
          <i class="fas fa-lightbulb" style="margin-top:2px;font-size:.9rem;color:#ffd60a"></i>
          <div>
            <div style="font-weight:600;font-size:.72rem;text-transform:uppercase;letter-spacing:.5px;color:var(--text3)">Password Hint</div>
            <div style="color:var(--text1);font-weight:600;margin-top:2px;word-break:break-word">${esc(folder.passwordHint)}</div>
          </div>
        </div>
      ` : ''}

      ${lockoutEnabled ? `
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
      ` : `
        <div style="background:rgba(78,134,245,0.08);border:1px solid rgba(78,134,245,0.25);border-radius:8px;padding:.55rem .75rem;font-size:.76rem;color:var(--text2);margin-bottom:1.1rem;line-height:1.4;text-align:left">
          <div style="font-weight:700;color:#4e86f5;display:flex;align-items:center;gap:6px">
            <i class="fas fa-shield-halved"></i> Password Protection Active
          </div>
          <div style="color:var(--text2);margin-top:2px">
            Enter the password to open this folder. (Attempt lockout limit is disabled by Admin).
          </div>
        </div>
      `}

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
        if (cntEl && lockoutEnabled) cntEl.textContent = 'Attempts remaining: ' + Math.max(0, rem) + ' of 5';
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

function showSetDrivePasswordDialog(driveId, hasPassword, driveName, currentHint) {
  var ov = document.createElement('div');
  ov.className = 'modal-backdrop';
  ov.innerHTML = `
    <div class="modal" style="max-width:440px;text-align:center">
      <div class="modal-hd" style="justify-content:center;position:relative">
        <div class="vault-shield-badge gold-glow">
          <i class="fas fa-key"></i>
        </div>
        <button class="icon-btn xs" style="position:absolute;right:1rem;top:1rem" onclick="this.closest('.modal-backdrop').remove()"><i class="fas fa-times"></i></button>
      </div>
      <h3 style="margin-bottom:.3rem">${hasPassword ? 'Edit Drive Password' : 'Set Drive Password'}</h3>
      <p style="font-size:.84rem;color:var(--text3);margin-bottom:1.1rem">
        Guest password protection for <strong style="color:var(--text1)">${esc(driveName)}</strong>.<br>
        Guests must enter this password to open the drive. Once unlocked, access stays active for <strong>5 hours</strong>.
      </p>

      <form id="drivePassForm" onsubmit="return false;" style="text-align:left">
        <div style="margin-bottom:.85rem">
          <label style="font-size:.78rem;font-weight:600;display:block;margin-bottom:.35rem;color:var(--text2)">
            ${hasPassword ? 'New Password' : 'Drive Password'}
          </label>
          <div style="position:relative">
            <input type="password" id="drivePasswordInput" class="inp" placeholder="Enter drive password" required style="width:100%;padding-right:40px">
            <button type="button" class="icon-btn xs" style="position:absolute;right:8px;top:50%;transform:translateY(-50%)" onclick="var p=document.getElementById('drivePasswordInput');p.type=p.type==='password'?'text':'password';this.innerHTML='<i class=\\'fas fa-'+(p.type==='password'?'eye':'eye-slash')+'\\'></i>';"><i class="fas fa-eye"></i></button>
          </div>
        </div>

        <div style="margin-bottom:.85rem">
          <label style="font-size:.78rem;font-weight:600;display:block;margin-bottom:.35rem;color:var(--text2)">Confirm Password</label>
          <div style="position:relative">
            <input type="password" id="drivePasswordConfirm" class="inp" placeholder="Re-type password" required style="width:100%;padding-right:40px">
            <button type="button" class="icon-btn xs" style="position:absolute;right:8px;top:50%;transform:translateY(-50%)" onclick="var p=document.getElementById('drivePasswordConfirm');p.type=p.type==='password'?'text':'password';this.innerHTML='<i class=\\'fas fa-'+(p.type==='password'?'eye':'eye-slash')+'\\'></i>';"><i class="fas fa-eye"></i></button>
          </div>
        </div>

        <div style="margin-bottom:1rem">
          <label style="font-size:.78rem;font-weight:600;display:block;margin-bottom:.35rem;color:var(--text2)">Password Hint <span style="font-weight:400;color:var(--text3)">(Optional)</span></label>
          <input type="text" id="drivePasswordHint" class="inp" placeholder="e.g. Secret trip password for friends" maxlength="100" value="${esc(currentHint || '')}" style="width:100%">
          <div style="font-size:.72rem;color:var(--text3);margin-top:3px">Displayed to guests on the drive unlock screen to help them remember.</div>
        </div>

        <div style="background:rgba(0,229,255,0.08);border:1px solid rgba(0,229,255,0.22);border-radius:8px;padding:.65rem .8rem;font-size:.76rem;color:#00e5ff;margin-bottom:1.2rem;line-height:1.4">
          <i class="fas fa-clock" style="margin-right:4px"></i>
          Unlocking grants <strong>5-hour persistent access</strong> per visitor browser. Individual folder passwords remain separately protected.
        </div>

        <div style="display:flex;gap:.6rem;justify-content:space-between;align-items:center">
          ${hasPassword ? `
            <button type="button" class="btn-ghost sm danger" id="removeDrivePassBtn" style="color:#ff453a;border-color:rgba(255,69,58,0.4)">
              <i class="fas fa-lock-open"></i> Remove Password
            </button>
          ` : `<div></div>`}
          <div style="display:flex;gap:.6rem">
            <button type="button" class="btn-ghost sm" onclick="this.closest('.modal-backdrop').remove()">Cancel</button>
            <button type="submit" class="btn-primary sm" id="saveDrivePassBtn" style="background:linear-gradient(135deg,#007aff,#5856d6)">
              <i class="fas fa-shield-halved"></i> Save Password
            </button>
          </div>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(ov);
  var passInp = ov.querySelector('#drivePasswordInput');
  var confInp = ov.querySelector('#drivePasswordConfirm');
  var hintInp = ov.querySelector('#drivePasswordHint');
  if (passInp) passInp.focus();

  if (hasPassword) {
    var remBtn = ov.querySelector('#removeDrivePassBtn');
    if (remBtn) {
      remBtn.addEventListener('click', async function() {
        if (!confirm('Are you sure you want to remove the password from this drive? Guests will be able to browse without a password.')) return;
        remBtn.disabled = true;
        remBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Removing…';
        var res = await apiSetDrivePassword(driveId, '', '');
        if (res && res.ok) {
          toast('Drive password removed! Drive is now open without password.', 'success');
          ov.remove();
          S.db = await apiFetchDB();
          if (typeof renderSettingsPage === 'function') renderSettingsPage();
          if (typeof renderSidebarStorage === 'function') renderSidebarStorage();
        } else {
          toast(res ? (res.error || 'Failed to remove password') : 'Network error', 'error');
          remBtn.disabled = false;
          remBtn.innerHTML = '<i class="fas fa-lock-open"></i> Remove Password';
        }
      });
    }
  }

  ov.querySelector('#drivePassForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    var p = passInp.value.trim();
    var c = confInp.value.trim();
    var h = hintInp ? hintInp.value.trim() : '';
    if (!p) { toast('Please enter a password', 'warning'); return; }
    if (p !== c) { toast('Passwords do not match! Please check.', 'error'); confInp.focus(); return; }

    var saveBtn = ov.querySelector('#saveDrivePassBtn');
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
    var res = await apiSetDrivePassword(driveId, p, h);
    if (res && res.ok) {
      toast('Drive password saved! Guests now need this password to open the drive.', 'success');
      ov.remove();
      S.db = await apiFetchDB();
      if (typeof renderSettingsPage === 'function') renderSettingsPage();
      if (typeof renderSidebarStorage === 'function') renderSidebarStorage();
    } else {
      toast(res ? (res.error || 'Failed to save drive password') : 'Network error', 'error');
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="fas fa-shield-halved"></i> Save Password';
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
        <button class="btn-ghost sm danger" onclick="this.closest('.modal-backdrop').remove();tmClearInterrupted();" style="color:var(--danger)"><i class="fas fa-trash"></i> Dismiss</button>
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
    var isPub = (S.db && isDriveOpen(dGuest, S.db));
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
  var isHeic = /\.(heic|heif)$/i.test(f.name) || (f.mimeType && f.mimeType.toLowerCase().includes('heic'));
  var displayImgUrl = isHeic ? (mediaUrl + '&thumb=1&sz=s2048') : mediaUrl;
  var ov = document.createElement('div'); ov.className = 'media-ov';
  var dlBtnHtml = canDownload ? '<a href="' + dlUrl + '" class="icon-btn" title="Download" download><i class="fas fa-download"></i></a>' : '';
  var noDlAttrs = !canDownload ? ' controlsList="nodownload noplaybackrate" disablePictureInPicture oncontextmenu="return false;" ' : ' controlsList="nodownload" ';
  ov.innerHTML = '<div class="media-hd"><div class="media-title"><i class="fas ' + cfg.icon + '" style="color:' + cfg.col + '"></i> ' + esc(f.name) + '</div><div style="display:flex;gap:.5rem">' + dlBtnHtml + '<button class="icon-btn" onclick="this.closest(\'.media-ov\').remove()"><i class="fas fa-times"></i></button></div></div><div class="media-body">' + (cfg.cat === 'image' ? '<img class="media-img" src="' + displayImgUrl + '" alt="' + esc(f.name) + '" data-fallback="' + mediaUrl + '" onerror="if(this.src!==this.dataset.fallback&&!this.dataset.triedFallback){this.dataset.triedFallback=\'1\';this.src=this.dataset.fallback;}" oncontextmenu="' + (!canDownload ? 'return false;' : '') + '">' : cfg.cat === 'video' ? '<video class="media-vid" src="' + mediaUrl + '" controls' + noDlAttrs + 'autoplay playsinline></video>' : cfg.cat === 'audio' ? '<audio src="' + mediaUrl + '" controls' + noDlAttrs + 'autoplay style="width:80%;max-width:500px"></audio>' : '<div style="text-align:center;padding:2rem"><i class="fas fa-file" style="font-size:3rem;color:var(--text2)"></i><p style="margin:1rem 0">Preview not available for this file type</p>' + (canDownload ? '<a href="' + dlUrl + '" class="btn-primary"><i class="fas fa-download"></i> Download File</a>' : '') + '</div>') + '</div>';
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
  var isOpenTarget = (_driveId && S.db && isDriveOpen(_driveId, S.db));
  var isAuth = (S.ses && S.ses.token);
  if (!isAuth && !isOpenTarget) {
    toast('Sign in required or open the public trip drive', 'warning');
    return;
  }
  if (!_driveId) {
    var openIds = (typeof getOpenDriveIds === 'function') ? getOpenDriveIds(S.db) : [];
    if (openIds.length === 1) _driveId = openIds[0];
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

async function promptRenameFile(fileId, currentName) {
  var isAdmin = S.ses && S.ses.role === 'admin';
  if (!isAdmin && S.db && S.db.policy && S.db.policy.allowUserRename === false) {
    toast('File renaming is disabled by administrator', 'warning');
    return;
  }
  var newName = prompt('Enter new file name:', currentName || '');
  if (!newName || !newName.trim() || newName.trim() === currentName) return;
  toast('Renaming file…', 'info');
  var res = await apiRenameFile(fileId, newName.trim());
  if (res && res.ok) {
    toast('File renamed to: ' + res.name, 'success');
    if (S.db && Array.isArray(S.db.files)) {
      var f = S.db.files.find(function(x){ return x.id === fileId || x.googleFileId === fileId; });
      if (f) f.name = res.name;
    }
    renderFilesPage(_driveId, _folderId);
  } else {
    toast(res ? (res.error || 'Failed to rename file') : 'Network error', 'error');
  }
}

async function promptRenameFolder(folderId, currentName) {
  var isAdmin = S.ses && S.ses.role === 'admin';
  if (!isAdmin && S.db && S.db.policy && S.db.policy.allowUserRename === false) {
    toast('Folder renaming is disabled by administrator', 'warning');
    return;
  }
  var newName = prompt('Enter new folder name:', currentName || '');
  if (!newName || !newName.trim() || newName.trim() === currentName) return;
  toast('Renaming folder…', 'info');
  var res = await apiRenameFolder(folderId, newName.trim());
  if (res && res.ok) {
    toast('Folder renamed to: ' + res.name, 'success');
    if (S.db && Array.isArray(S.db.folders)) {
      var f = S.db.folders.find(function(x){ return x.id === folderId; });
      if (f) f.name = res.name;
    }
    renderFilesPage(_driveId, _folderId);
  } else {
    toast(res ? (res.error || 'Failed to rename folder') : 'Network error', 'error');
  }
}

function showIPhoneFastUploadTip() {
  if (typeof toggleMobileFab === 'function') toggleMobileFab(false);
  var html = `
    <div class="modal-backdrop" id="iphoneTipModal" onclick="if(event.target===this)this.remove()">
      <div class="modal-card" style="max-width:460px">
        <div class="modal-hd">
          <div style="display:flex;align-items:center;gap:10px">
            <div style="width:36px;height:36px;border-radius:10px;background:rgba(255,215,0,0.15);color:#ffd700;display:flex;align-items:center;justify-content:center;font-size:1.1rem">
              <i class="fas fa-bolt"></i>
            </div>
            <div>
              <h3 style="margin:0;font-size:1rem;color:var(--text1)">iPhone Fast Upload Guide</h3>
              <p style="margin:0;font-size:.75rem;color:var(--text3)">Fix the white round spinner & upload instantly</p>
            </div>
          </div>
          <button class="icon-btn xs" onclick="this.closest('.modal-backdrop').remove()"><i class="fas fa-times"></i></button>
        </div>
        <div class="modal-body" style="font-size:.85rem;color:var(--text2);line-height:1.55;display:flex;flex-direction:column;gap:12px;max-height:75vh;overflow-y:auto">
          <div style="background:rgba(255,69,58,0.12);border:1px solid rgba(255,69,58,0.3);border-radius:10px;padding:10px 12px;color:#ff8585;font-size:.8rem">
            <i class="fas fa-circle-exclamation" style="margin-right:6px"></i> <strong>Why the white round circle appears:</strong>
            <p style="margin:4px 0 0;color:var(--text2)">Your video is actually stored in <strong>iCloud</strong>, not on your iPhone's local storage. When you pick it from "Photo Library", iOS has to <strong>download the entire video from Apple iCloud servers</strong> first! That white circle is the iCloud download progress bar.</p>
          </div>

          <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:12px">
            <div style="font-weight:600;color:#ffd700;margin-bottom:6px;display:flex;align-items:center;gap:6px">
              <span style="background:#ffd700;color:#000;width:20px;height:20px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:.72rem;font-weight:700">⚡</span>
              The 0-Second Bypass: "Save to Files" (100% Instant!)
            </div>
            <ol style="margin:4px 0 0;padding-left:18px;font-size:.8rem;color:var(--text2);display:flex;flex-direction:column;gap:4px">
              <li>Open the <strong>Photos</strong> app on your iPhone and select the video.</li>
              <li>Tap the <strong>Share</strong> icon (square with arrow pointing up).</li>
              <li>Tap <strong>"Save to Files"</strong> → select <strong>"On My iPhone"</strong> (or Downloads) → tap <strong>Save</strong>.</li>
              <li>In TeleDrive, tap <strong>Upload Files</strong> below.</li>
              <li>When iOS asks, tap <strong>"Choose Files"</strong> (NOT "Photo Library")!</li>
            </ol>
            <div style="margin-top:6px;font-size:.76rem;color:#30d158;font-weight:600"><i class="fas fa-check-circle"></i> Bypasses all Apple processing & verification instantly!</div>
          </div>

          <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:12px">
            <div style="font-weight:600;color:var(--text1);margin-bottom:6px;display:flex;align-items:center;gap:6px">
              <span style="background:var(--primary);color:#fff;width:20px;height:20px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:.72rem">1</span>
              Fix iCloud Setting: Stop Offloading Videos
            </div>
            <p style="margin:0;font-size:.8rem;color:var(--text2)">Open iPhone <strong>Settings → Photos</strong> (or Settings → Your Apple ID → iCloud → Photos):<br>
            Change from <strong>"Optimize iPhone Storage"</strong> to <strong>"Download and Keep Originals"</strong>.<br>
            <span style="font-size:.74rem;color:var(--text3)">This keeps full original videos locally on your phone so iOS never has to download them from iCloud.</span></p>
          </div>

          <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:12px">
            <div style="font-weight:600;color:var(--text1);margin-bottom:6px;display:flex;align-items:center;gap:6px">
              <span style="background:var(--primary);color:#fff;width:20px;height:20px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:.72rem">2</span>
              Camera Settings: Keep Raw Format
            </div>
            <p style="margin:0;font-size:.8rem;color:var(--text2)">Open iPhone <strong>Settings → Camera → Formats</strong>: Choose <strong>Most Compatible</strong> (H.264) or keep High Efficiency (HEVC) with "Keep Originals" in Photos.</p>
          </div>
        </div>
        <div class="modal-ft" style="display:flex;justify-content:flex-end;gap:8px">
          <button class="btn-primary sm" onclick="this.closest('.modal-backdrop').remove();triggerMobileUploadFiles()"><i class="fas fa-cloud-arrow-up"></i> Upload Now</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
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

// ─── In-App Office & Document Viewer (Word, Excel, PowerPoint, Text) ─────────
function closeDocViewer() {
  var ov = document.getElementById('docViewerModal');
  if (ov) {
    if (ov._keyHandler) window.removeEventListener('keydown', ov._keyHandler);
    ov.remove();
  }
}

async function openDocViewer(fileId) {
  var f = (S.db && S.db.files || []).find(function (x) { return x.id === fileId; });
  if (!f) return;

  // Delegate if file belongs to another specialized viewer
  if (/\.pdf$/i.test(f.name) || f.mimeType === 'application/pdf') {
    return openPdfViewer(fileId);
  }
  if (/\.(zip|rar|7z|tar|gz|bz2)$/i.test(f.name)) {
    return openArchiveViewer(fileId);
  }
  var cat = ftCfg(f.name, f.mimeType).cat;
  if (['image', 'video', 'audio'].includes(cat)) {
    return openMedia(fileId);
  }

  var isAdmin = S.ses && S.ses.role === 'admin';
  var canDownload = isAdmin || !S.db || !S.db.policy || S.db.policy.allowUserDownload !== false;
  var driveId = f.driveId || _driveId || (S.db && S.db.drives && S.db.drives[0] ? S.db.drives[0].id : '');
  var previewUrl = getFileDownloadUrl(f.googleFileId, driveId, true);
  var downloadUrl = getFileDownloadUrl(f.googleFileId, driveId, false);
  var googleEmbedUrl = 'https://drive.google.com/file/d/' + encodeURIComponent(f.googleFileId) + '/preview';

  var ext = (f.name || '').split('.').pop().toLowerCase();
  var isDocx = ext === 'docx';
  var isExcel = ['xlsx', 'xls', 'csv', 'tsv', 'ods'].includes(ext);
  var isPpt = ['pptx', 'ppt'].includes(ext);
  var isLegacyDoc = ext === 'doc';
  var isText = ['txt', 'md', 'log', 'json', 'xml', 'yaml', 'yml', 'ini', 'cfg', 'html', 'css', 'js', 'py', 'sql', 'sh', 'bat'].includes(ext);
  var cfg = ftCfg(f.name, f.mimeType);

  var typeLabel = isDocx ? 'Microsoft Word Document' :
    isExcel ? 'Microsoft Excel Spreadsheet' :
    isPpt ? 'PowerPoint Presentation' :
    isLegacyDoc ? 'Word Document (97-2003)' :
    isText ? 'Text / Source Document' : 'Document';

  var ov = document.createElement('div');
  ov.className = 'doc-viewer-overlay';
  ov.id = 'docViewerModal';
  ov.innerHTML = `
    <div class="doc-viewer-container">
      <div class="doc-viewer-header">
        <div class="doc-viewer-title">
          <div style="width:38px;height:38px;border-radius:10px;background:${cfg.col}22;border:1px solid ${cfg.col}44;display:flex;align-items:center;justify-content:center;color:${cfg.col};font-size:1.25rem;flex-shrink:0">
            <i class="fas ${cfg.icon}"></i>
          </div>
          <div style="min-width:0;flex:1">
            <div class="doc-title-text" title="${esc(f.name)}">${esc(f.name)}</div>
            <div class="doc-sub-text">
              <span>${fmt(f.size || 0)}</span>
              <span>·</span>
              <span style="color:${cfg.col};font-weight:600">${typeLabel}</span>
            </div>
          </div>
        </div>
        <div class="doc-toolbar-controls" id="docToolbarControls"></div>
        <div class="doc-viewer-actions">
          ${canDownload ? `<a href="${downloadUrl}" download="${esc(f.name)}" class="btn-ghost sm hide-xs" title="Download Document"><i class="fas fa-download"></i> Download</a>` : ''}
          <a href="${previewUrl}" target="_blank" rel="noopener" class="btn-ghost sm" title="Open in New Tab"><i class="fas fa-arrow-up-right-from-square"></i> <span class="hide-xs">New Tab</span></a>
          <button class="icon-btn sm" onclick="closeDocViewer()" title="Close Viewer"><i class="fas fa-times"></i></button>
        </div>
      </div>
      <div class="sheet-tabs-bar hidden" id="docSheetTabsBar"></div>
      <div class="doc-viewer-body" id="docViewerBody">
        <div id="docLoading" class="pdf-loader-state" style="margin:auto;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:4rem 1rem">
          <div class="vault-shield-badge gold-glow" style="width:58px;height:58px;font-size:1.5rem;margin-bottom:12px">
            <i class="fas fa-circle-notch fa-spin"></i>
          </div>
          <div id="docLoadMsg" style="font-size:.9rem;color:var(--text2);font-weight:600">Loading document…</div>
        </div>
        <div id="docContentWrap" style="flex:1;width:100%;height:100%;display:none;position:relative;overflow:auto"></div>
        <div id="docErrorBox" class="pdf-error-box hidden" style="margin:auto;padding:3rem 1.5rem;text-align:center">
          <i class="fas fa-triangle-exclamation" style="font-size:2.4rem;color:var(--warning);margin-bottom:8px"></i>
          <h3 style="margin-bottom:6px">Could Not Display Document In-App</h3>
          <p id="docErrDetail" style="font-size:.82rem;color:var(--text3);max-width:380px;margin:0 auto 16px"></p>
          <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
            <a href="${googleEmbedUrl}" target="_blank" rel="noopener" class="btn-primary sm"><i class="fab fa-google-drive"></i> Open in Google Drive</a>
            <a href="${previewUrl}" target="_blank" rel="noopener" class="btn-ghost sm"><i class="fas fa-arrow-up-right-from-square"></i> Open Native File</a>
            ${canDownload ? `<a href="${downloadUrl}" download="${esc(f.name)}" class="btn-ghost sm"><i class="fas fa-download"></i> Download</a>` : ''}
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(ov);

  var keyHandler = function (e) {
    if (e.key === 'Escape') closeDocViewer();
  };
  window.addEventListener('keydown', keyHandler);
  ov._keyHandler = keyHandler;
  ov.addEventListener('click', function(e) {
    if (e.target === ov) closeDocViewer();
  });

  function showDocError(err) {
    console.error('Document preview error:', err);
    var loadSpin = ov.querySelector('#docLoading');
    if (loadSpin) loadSpin.style.display = 'none';
    var errBox = ov.querySelector('#docErrorBox');
    if (errBox) {
      errBox.classList.remove('hidden');
      var detail = errBox.querySelector('#docErrDetail');
      if (detail) detail.textContent = (err && err.message) ? err.message : 'Could not decode document.';
    }
  }

  // 1. WORD (.docx)
  if (isDocx) {
    var tb = ov.querySelector('#docToolbarControls');
    tb.innerHTML = `
      <button class="icon-btn xs" id="docxZoomOut" title="Zoom Out"><i class="fas fa-minus"></i></button>
      <span class="pdf-zoom-label" id="docxZoomVal">100%</span>
      <button class="icon-btn xs" id="docxZoomIn" title="Zoom In"><i class="fas fa-plus"></i></button>
      <button class="btn-ghost xs" id="docxFitBtn" title="Fit to Screen"><i class="fas fa-arrows-left-right-to-line"></i> <span class="hide-xs">Fit</span></button>
      <span class="pdf-tb-sep"></span>
      <button class="icon-btn xs" id="docxPrintBtn" title="Print Document"><i class="fas fa-print"></i></button>
    `;

    var zoomLevel = 1.0;
    function applyDocxZoom() {
      var valEl = ov.querySelector('#docxZoomVal');
      if (valEl) valEl.textContent = Math.round(zoomLevel * 100) + '%';
      var sections = ov.querySelectorAll('.docx-wrapper > section.docx');
      sections.forEach(function(s) {
        s.style.transform = zoomLevel === 1.0 ? '' : 'scale(' + zoomLevel + ')';
        s.style.transformOrigin = 'top center';
      });
    }

    ov.querySelector('#docxZoomOut').onclick = function() {
      zoomLevel = Math.max(0.4, zoomLevel - 0.15);
      applyDocxZoom();
    };
    ov.querySelector('#docxZoomIn').onclick = function() {
      zoomLevel = Math.min(2.2, zoomLevel + 0.15);
      applyDocxZoom();
    };
    ov.querySelector('#docxFitBtn').onclick = function() {
      var wrap = ov.querySelector('#docContentWrap');
      var firstSec = ov.querySelector('.docx-wrapper > section.docx');
      if (wrap && firstSec) {
        var avail = wrap.clientWidth - 48;
        var secW = firstSec.offsetWidth || 800;
        zoomLevel = Math.min(1.2, Math.max(0.4, avail / secW));
        applyDocxZoom();
      }
    };
    ov.querySelector('#docxPrintBtn').onclick = function() {
      window.print();
    };

    fetch(previewUrl).then(function(r) {
      if (!r.ok) throw new Error('HTTP error ' + r.status);
      return r.arrayBuffer();
    }).then(function(ab) {
      if (typeof docx !== 'undefined' && docx.renderAsync) {
        var contentWrap = ov.querySelector('#docContentWrap');
        contentWrap.style.display = 'block';
        contentWrap.innerHTML = '';
        docx.renderAsync(ab, contentWrap, null, {
          inWrapper: true,
          breakPages: true,
          ignoreHeight: false,
          ignoreWidth: false
        }).then(function() {
          var loadSpin = ov.querySelector('#docLoading');
          if (loadSpin) loadSpin.style.display = 'none';
        }).catch(function(err) {
          showDocError(err);
        });
      } else {
        showDocError(new Error('Word document parser not loaded'));
      }
    }).catch(function(err) {
      showDocError(err);
    });
  }

  // 2. EXCEL & SPREADSHEETS (.xlsx, .xls, .csv, .tsv, .ods)
  else if (isExcel) {
    var tb = ov.querySelector('#docToolbarControls');
    tb.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px">
        <i class="fas fa-search" style="font-size:.74rem;color:var(--text3)"></i>
        <input type="text" id="excelSearchInp" placeholder="Search cells…" class="inp" style="height:26px;font-size:.76rem;padding:2px 8px;width:130px;background:rgba(255,255,255,0.06);border-radius:12px;border:1px solid rgba(255,255,255,0.1)">
      </div>
      <span class="pdf-tb-sep hide-xs"></span>
      <span id="excelStats" style="font-size:.72rem;color:var(--text3);font-weight:600" class="hide-xs">Loading…</span>
    `;

    fetch(previewUrl).then(function(r) {
      if (!r.ok) throw new Error('HTTP error ' + r.status);
      return r.arrayBuffer();
    }).then(function(ab) {
      if (typeof XLSX !== 'undefined' && XLSX.read) {
        var wb = XLSX.read(new Uint8Array(ab), { type: 'array' });
        var loadSpin = ov.querySelector('#docLoading');
        if (loadSpin) loadSpin.style.display = 'none';

        var contentWrap = ov.querySelector('#docContentWrap');
        contentWrap.style.display = 'block';
        contentWrap.innerHTML = '<div class="excel-table-wrap" id="excelTableWrap"></div>';

        var tabsBar = ov.querySelector('#docSheetTabsBar');
        var sheetNames = wb.SheetNames || [];
        if (sheetNames.length > 0) {
          tabsBar.classList.remove('hidden');
          tabsBar.innerHTML = sheetNames.map(function(name, idx) {
            return '<button class="sheet-tab-btn ' + (idx === 0 ? 'active' : '') + '" data-sheet="' + esc(name) + '"><i class="fas fa-table-cells" style="font-size:.72rem"></i> ' + esc(name) + '</button>';
          }).join('');

          tabsBar.querySelectorAll('.sheet-tab-btn').forEach(function(btn) {
            btn.onclick = function() {
              tabsBar.querySelectorAll('.sheet-tab-btn').forEach(function(b){ b.classList.remove('active'); });
              btn.classList.add('active');
              renderSheet(btn.dataset.sheet);
            };
          });
        }

        var currentRows = [];
        function renderSheet(sheetName) {
          var ws = wb.Sheets[sheetName];
          if (!ws) return;
          var data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
          currentRows = data;
          updateExcelTable(data);
        }

        function updateExcelTable(data, filterQuery) {
          var container = ov.querySelector('#excelTableWrap');
          if (!container) return;
          var q = (filterQuery || '').toLowerCase().trim();
          var maxCols = 0;
          data.forEach(function(r){ if (Array.isArray(r) && r.length > maxCols) maxCols = r.length; });
          if (maxCols === 0) maxCols = 1;

          var html = '<table class="excel-table"><thead><tr><th class="col-corner">#</th>';
          for (var c = 0; c < maxCols; c++) {
            var colLetter = String.fromCharCode(65 + (c % 26));
            if (c >= 26) colLetter = String.fromCharCode(64 + Math.floor(c / 26)) + colLetter;
            html += '<th>' + colLetter + '</th>';
          }
          html += '</tr></thead><tbody>';

          var matchCount = 0;
          data.forEach(function(row, rIdx) {
            var rowMatches = true;
            if (q) {
              rowMatches = Array.isArray(row) && row.some(function(cell){ return String(cell).toLowerCase().includes(q); });
            }
            if (!rowMatches) return;
            matchCount++;
            html += '<tr><td class="row-num">' + (rIdx + 1) + '</td>';
            for (var c = 0; c < maxCols; c++) {
              var val = (row && row[c] !== undefined && row[c] !== null) ? String(row[c]) : '';
              var isHit = q && val.toLowerCase().includes(q);
              html += '<td class="' + (isHit ? 'highlight-match' : '') + '" title="' + esc(val) + '">' + esc(val) + '</td>';
            }
            html += '</tr>';
          });
          html += '</tbody></table>';
          container.innerHTML = html;

          var statsEl = ov.querySelector('#excelStats');
          if (statsEl) {
            statsEl.textContent = data.length + ' rows · ' + maxCols + ' cols' + (q ? ' (' + matchCount + ' matches)' : '');
          }
        }

        var searchInp = ov.querySelector('#excelSearchInp');
        if (searchInp) {
          searchInp.oninput = debounce(function() {
            updateExcelTable(currentRows, searchInp.value);
          }, 200);
        }

        if (sheetNames.length > 0) renderSheet(sheetNames[0]);
      } else {
        showDocError(new Error('Excel spreadsheet parser not ready'));
      }
    }).catch(function(err) {
      showDocError(err);
    });
  }

  // 3. POWERPOINT (.pptx, .ppt) & LEGACY WORD (.doc)
  else if (isPpt || isLegacyDoc) {
    var tb = ov.querySelector('#docToolbarControls');
    tb.innerHTML = `
      <a href="${googleEmbedUrl}" target="_blank" rel="noopener" class="btn-ghost xs" title="Open Fullscreen"><i class="fas fa-expand"></i> Fullscreen</a>
    `;

    var contentWrap = ov.querySelector('#docContentWrap');
    contentWrap.style.display = 'block';
    contentWrap.innerHTML = `
      <iframe src="${googleEmbedUrl}" style="width:100%;height:100%;border:none;background:#0d0d12" allowfullscreen></iframe>
    `;
    var loadSpin = ov.querySelector('#docLoading');
    if (loadSpin) loadSpin.style.display = 'none';
  }

  // 4. TEXT & SOURCE FILES (.txt, .md, .json, etc.)
  else {
    var tb = ov.querySelector('#docToolbarControls');
    tb.innerHTML = `
      <button class="btn-ghost xs" id="textWrapBtn" title="Toggle Word Wrap"><i class="fas fa-text-width"></i> <span class="hide-xs">Wrap</span></button>
      <button class="btn-ghost xs" id="textCopyBtn" title="Copy Content"><i class="fas fa-copy"></i> <span class="hide-xs">Copy</span></button>
    `;

    fetch(previewUrl).then(function(r) {
      if (!r.ok) throw new Error('HTTP error ' + r.status);
      return r.text();
    }).then(function(txt) {
      var loadSpin = ov.querySelector('#docLoading');
      if (loadSpin) loadSpin.style.display = 'none';

      var contentWrap = ov.querySelector('#docContentWrap');
      contentWrap.style.display = 'block';
      contentWrap.innerHTML = '<pre class="text-doc-body" id="textDocBody"><code>' + esc(txt) + '</code></pre>';

      var isWrapped = false;
      ov.querySelector('#textWrapBtn').onclick = function() {
        isWrapped = !isWrapped;
        var body = ov.querySelector('#textDocBody');
        if (body) body.classList.toggle('wrap', isWrapped);
      };
      ov.querySelector('#textCopyBtn').onclick = function() {
        navigator.clipboard.writeText(txt).then(function() {
          toast('Text copied to clipboard!', 'success');
        }).catch(function() {
          toast('Failed to copy', 'error');
        });
      };
    }).catch(function(err) {
      showDocError(err);
    });
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

function showCloudflareKVGuideModal() {
  var existing = document.getElementById('cfKvGuideModal');
  if (existing) existing.remove();
  var ov = document.createElement('div');
  ov.className = 'overlay';
  ov.id = 'cfKvGuideModal';
  ov.innerHTML = `
    <div class="modal" style="max-width:540px;padding:1.8rem;box-shadow:0 24px 60px rgba(0,0,0,0.85);border:1px solid rgba(255,159,10,0.4)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.2rem">
        <h3 style="display:flex;align-items:center;gap:8px;font-size:1.15rem;margin:0">
          <i class="fas fa-bolt" style="color:#ff9f0a"></i> Connect Free Cloudflare KV
        </h3>
        <button class="icon-btn sm" onclick="var m=document.getElementById('cfKvGuideModal');if(m)m.remove();"><i class="fas fa-times"></i></button>
      </div>

      <div style="background:rgba(255,159,10,0.08);border:1px solid rgba(255,159,10,0.25);border-radius:10px;padding:12px 14px;font-size:.82rem;line-height:1.5;margin-bottom:1.2rem">
        <strong>100% Free Forever & Unlimited Bandwidth:</strong><br>
        No credit card needed! Cloudflare KV has zero bandwidth fees and will never suspend your database again.
      </div>

      <div style="display:flex;flex-direction:column;gap:12px;font-size:.84rem;line-height:1.55;color:var(--text2)">
        <div style="display:flex;gap:10px">
          <span style="background:var(--primary);color:#fff;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.75rem;flex-shrink:0">1</span>
          <div>
            Go to <strong>Cloudflare Dashboard</strong> (<a href="https://dash.cloudflare.com/" target="_blank" style="color:var(--primary);text-decoration:underline">dash.cloudflare.com</a>).
          </div>
        </div>

        <div style="display:flex;gap:10px">
          <span style="background:var(--primary);color:#fff;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.75rem;flex-shrink:0">2</span>
          <div>
            In left menu, click <strong>Storage & Databases</strong> ➔ <strong>KV</strong> ➔ Click <strong>Create Namespace</strong>.<br>
            Name it: <code style="background:var(--bg4);padding:2px 6px;border-radius:4px;color:var(--text1)">TELEDRIVE_KV</code> and click <strong>Add</strong>.
          </div>
        </div>

        <div style="display:flex;gap:10px">
          <span style="background:var(--primary);color:#fff;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.75rem;flex-shrink:0">3</span>
          <div>
            In left menu, click <strong>Workers & Pages</strong> ➔ click your project <strong>storage</strong>.<br>
            Click <strong>Settings</strong> ➔ <strong>Functions</strong> (left submenu) ➔ scroll to <strong>KV namespace bindings</strong>.<br>
            Click <strong>Add binding</strong>:
            <ul style="margin:4px 0 0 16px;padding:0">
              <li>Variable name: <code style="background:var(--bg4);padding:2px 6px;border-radius:4px;color:var(--text1)">KV</code></li>
              <li>KV namespace: select <code style="background:var(--bg4);padding:2px 6px;border-radius:4px;color:var(--text1)">TELEDRIVE_KV</code></li>
            </ul>
            Click <strong>Save</strong>.
          </div>
        </div>

        <div style="display:flex;gap:10px">
          <span style="background:var(--primary);color:#fff;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.75rem;flex-shrink:0">4</span>
          <div>
            Go to <strong>Deployments</strong> tab ➔ click <strong>...</strong> on the latest deployment ➔ <strong>Retry deployment</strong>.<br>
            Once completed, refresh this page and log in as admin (<code style="background:var(--bg4);padding:2px 6px;border-radius:4px;color:var(--text1)">admin123</code>)!
          </div>
        </div>
      </div>

      <div style="margin-top:1.4rem;display:flex;justify-content:flex-end;gap:10px">
        <button class="btn-ghost sm" onclick="var m=document.getElementById('cfKvGuideModal');if(m)m.remove();">Close</button>
        <a href="https://dash.cloudflare.com/" target="_blank" class="btn-primary sm"><i class="fas fa-arrow-up-right-from-square"></i> Open Cloudflare</a>
      </div>
    </div>
  `;
  document.body.appendChild(ov);
}

// ─── File Copy Modal (Single or Multi-select) ─────────────────────────────
async function showCopyDialog(fileIds) {
  if (!fileIds || !fileIds.length) {
    toast('No files selected to copy', 'warning');
    return;
  }
  var isAuth = S.ses && S.ses.token;
  if (!isAuth) {
    showSignInModal();
    toast('Sign in required to copy files', 'warning');
    return;
  }

  var db = S.db || {};
  var drives = db.drives || [];
  if (!drives.length) {
    toast('No connected drives found', 'warning');
    return;
  }

  var activeDrive = drives.find(function(d){ return d.id === _driveId; }) || drives[0];
  var selectedDriveId = activeDrive.id;
  var selectedTargetFolderId = null;

  var filesToCopy = (db.files || []).filter(function(f){ return fileIds.includes(f.id); });
  var count = filesToCopy.length || fileIds.length;

  var ov = document.createElement('div');
  ov.className = 'modal-backdrop';
  ov.id = 'copyFileModalBackdrop';

  function renderFolderSelector() {
    var folders = (db.folders || []).filter(function(f){ return f.driveId === selectedDriveId && !f.trashed && !f.destroyed; });

    var html = '<div class="copy-folder-item ' + (selectedTargetFolderId === null ? 'selected' : '') + '" data-fid="root" style="padding:8px 12px;cursor:pointer;display:flex;align-items:center;border-radius:6px;margin:2px 4px">' +
      '<i class="fas fa-hard-drive" style="color:var(--primary);margin-right:8px"></i> <strong>Drive Root</strong>' +
    '</div>';

    function buildTree(parentId, depth) {
      var children = folders.filter(function(f){ return (f.parentId || null) === parentId; });
      children.forEach(function(f) {
        var indent = depth * 14;
        var isSel = selectedTargetFolderId === f.id;
        html += '<div class="copy-folder-item ' + (isSel ? 'selected' : '') + '" data-fid="' + f.id + '" style="padding:7px 12px 7px ' + (12 + indent) + 'px;cursor:pointer;display:flex;align-items:center;border-radius:6px;margin:2px 4px">' +
          '<i class="fas fa-folder" style="color:#ffcc00;margin-right:8px"></i> ' + esc(f.name) +
        '</div>';
        buildTree(f.id, depth + 1);
      });
    }
    buildTree(null, 1);
    return html;
  }

  ov.innerHTML = `
    <div class="modal" style="max-width:460px;text-align:left">
      <div class="modal-hd">
        <div style="display:flex;align-items:center;gap:10px">
          <div class="vault-shield-badge" style="background:rgba(78,134,245,0.18);color:#4e86f5;width:38px;height:38px;font-size:1.1rem;margin:0">
            <i class="fas fa-copy"></i>
          </div>
          <div>
            <h3 style="margin:0;font-size:1.05rem">Copy ${count} Item${count > 1 ? 's' : ''}</h3>
            <p style="margin:0;font-size:.78rem;color:var(--text3)">Duplicate to another folder on Google Drive</p>
          </div>
        </div>
        <button class="icon-btn xs" onclick="this.closest('.modal-backdrop').remove()"><i class="fas fa-times"></i></button>
      </div>

      <div style="margin:1rem 0 .5rem">
        <label style="font-size:.78rem;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:.4rem;display:block">Select Destination Folder:</label>
        <div id="copyFolderTreeList" style="max-height:220px;overflow-y:auto;border:1px solid rgba(255,255,255,0.08);border-radius:10px;background:rgba(255,255,255,0.02);padding:6px 0">
          ${renderFolderSelector()}
        </div>
      </div>

      <div class="modal-ft" style="display:flex;justify-content:flex-end;gap:8px;margin-top:1.2rem">
        <button class="btn-ghost sm" onclick="this.closest('.modal-backdrop').remove()">Cancel</button>
        <button class="btn-primary sm" id="confirmCopyBtn"><i class="fas fa-copy"></i> Copy Here</button>
      </div>
    </div>
  `;
  document.body.appendChild(ov);

  var listEl = ov.querySelector('#copyFolderTreeList');
  listEl.addEventListener('click', function(e) {
    var item = e.target.closest('.copy-folder-item');
    if (!item) return;
    listEl.querySelectorAll('.copy-folder-item').forEach(function(el){ el.classList.remove('selected'); });
    item.classList.add('selected');
    var fid = item.getAttribute('data-fid');
    selectedTargetFolderId = (fid === 'root') ? null : fid;
  });

  var btn = ov.querySelector('#confirmCopyBtn');
  btn.onclick = async function() {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Copying…';
    try {
      var r = await apiCopyFiles(fileIds, selectedTargetFolderId, selectedDriveId);
      if (r && r.ok) {
        toast('Successfully copied ' + (r.copiedCount || count) + ' file(s)!', 'success');
        ov.remove();
        if (typeof clearFileSelection === 'function') clearFileSelection();
        try {
          S.db = await apiFetchDB();
          if (S.db && S.db.files) {
            if (typeof cacheDBLocally === 'function') cacheDBLocally(S.db);
            tmSyncWithServer(S.db.files);
          }
        } catch(e){}
        renderSidebarStorage();
        renderFilesPage(_driveId, _folderId);
      } else {
        toast('Copy failed: ' + (r ? (r.error || 'Server error') : 'Network error'), 'error');
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-copy"></i> Copy Here';
      }
    } catch(err) {
      toast('Error copying files: ' + (err.message || err), 'error');
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-copy"></i> Copy Here';
    }
  };
}