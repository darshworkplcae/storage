var API = '/api';

function getOpenDriveIds(db) {
  if (!db) {
    if (typeof S !== 'undefined' && S.db) db = S.db;
    else return [];
  }
  var s = new Set();
  if (db.openDriveId) s.add(db.openDriveId);
  if (Array.isArray(db.openDriveIds)) db.openDriveIds.forEach(function(id){ if(id) s.add(id); });
  (db.drives || []).forEach(function(d){ if(d.isOpenDrive) s.add(d.id); });
  return Array.from(s);
}

function isDriveOpen(driveId, db) {
  if (!driveId) return false;
  return getOpenDriveIds(db).includes(driveId);
}

function getAllActiveDriveTokens() {
  var tokens = [];
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.startsWith('td_dtk_')) {
        var raw = localStorage.getItem(k);
        if (raw) {
          var data = JSON.parse(raw);
          if (data && data.token && data.expiresAt && Date.now() < data.expiresAt) {
            tokens.push(data.token);
          }
        }
      }
    }
  } catch(e) {}
  return tokens;
}

function getDriveUnlockToken(driveId) {
  if (!driveId) driveId = (typeof S !== 'undefined' && S.curDriveId) ? S.curDriveId : null;
  if (!driveId && typeof S !== 'undefined' && S.db) {
    var openIds = getOpenDriveIds(S.db);
    if (openIds.length === 1) driveId = openIds[0];
  }
  if (!driveId) return null;
  try {
    var raw = localStorage.getItem('td_dtk_' + driveId);
    if (!raw) return null;
    var data = JSON.parse(raw);
    if (data && data.token && data.expiresAt && Date.now() < data.expiresAt) {
      return data.token;
    }
    localStorage.removeItem('td_dtk_' + driveId);
  } catch(e) {}
  return null;
}

function saveDriveUnlockToken(driveId, token, expiresInSec) {
  try {
    var expiresAt = Date.now() + ((expiresInSec || 18000) * 1000);
    localStorage.setItem('td_dtk_' + driveId, JSON.stringify({ token: token, expiresAt: expiresAt }));
  } catch(e) {}
}

function isDriveUnlocked(driveId, drive) {
  if (typeof S !== 'undefined' && S.ses && (S.ses.role === 'admin' || S.ses.role === 'user')) return true;
  if (!drive) {
    if (typeof S !== 'undefined' && S.db && S.db.drives) {
      drive = S.db.drives.find(function(d){ return d.id === driveId; });
    }
  }
  if (!drive || !drive.hasPassword) return true;
  if (isDriveOpen(driveId, (typeof S !== 'undefined' && S.db) ? S.db : null)) return true;
  return !!getDriveUnlockToken(driveId || (drive ? drive.id : null));
}

function getActiveDriveToken() {
  if (typeof S !== 'undefined') {
    if (S.curDriveId) return getDriveUnlockToken(S.curDriveId);
    if (S.db) {
      var openIds = getOpenDriveIds(S.db);
      if (openIds.length === 1) return getDriveUnlockToken(openIds[0]);
    }
  }
  return null;
}

function authHdr() {
  var h = { 'Content-Type': 'application/json' };
  if (S.ses && S.ses.token) h['Authorization'] = 'Bearer ' + S.ses.token;
  var dTok = getActiveDriveToken();
  if (dTok) h['X-Drive-Token'] = dTok;
  var allToks = getAllActiveDriveTokens();
  if (allToks.length) h['X-Drive-Tokens'] = allToks.join(',');
  return h;
}

async function apiFetch(path, opts) {
  opts = opts || {};
  try {
    var r = await fetch(API + '/' + path, Object.assign({ headers: authHdr() }, opts));
    var ct = r.headers.get('Content-Type') || '';
    if (!ct.includes('application/json')) {
      var raw = await r.text().catch(function(){return '';});
      var errMsg = 'Server temporarily busy (HTTP ' + r.status + ')';
      if (r.status === 503) errMsg = 'Server busy / rate limit (503) — cooling down';
      else if (r.status === 429) errMsg = 'Rate limit (429) — cooling down';
      else if (raw && !raw.includes('<html') && !raw.includes('<!DOCTYPE')) errMsg = 'Server error (' + r.status + '): ' + raw.slice(0, 120);
      return { ok: r.ok, status: r.status, error: r.ok ? null : errMsg, _raw: raw };
    }
    return await r.json();
  } catch(e) { return { error: e.message }; }
}

try { sessionStorage.removeItem('_td_db_override'); } catch(e) {}
function saveFreshDBOverride(folders, files) {}
function clearFreshDBOverride() {
  try { sessionStorage.removeItem('_td_db_override'); } catch(e) {}
}

async function apiFetchDB() {
  try { sessionStorage.removeItem('_td_db_override'); } catch(e) {}
  return await apiFetch('db');
}

function apiAdminLogin(pass)      { return apiFetch('auth/login',       { method:'POST', body: JSON.stringify({ password:pass }) }); }
function apiUserLogin(u, p)       { return apiFetch('auth/user-login',  { method:'POST', body: JSON.stringify({ username:u, password:p }) }); }
function apiDriveQuota()          { return apiFetch('drives/quota'); }
function apiDisconnect(id)        { return apiFetch('drives/'+id,       { method:'DELETE' }); }
function apiDownload(gId, dId)    { return apiFetch('download/'+gId+'?driveId='+dId); }
function getFileDownloadUrl(gId, dId, inline) {
  var tok = (S.ses && S.ses.token) ? S.ses.token : '';
  var dTok = getDriveUnlockToken(dId);
  return API + '/download/' + encodeURIComponent(gId) + '?driveId=' + encodeURIComponent(dId||'') + (inline ? '&inline=1' : '') + (tok ? '&token=' + encodeURIComponent(tok) : '') + (dTok ? '&driveToken=' + encodeURIComponent(dTok) : '');
}
function getFileThumbUrl(gId, dId) {
  var tok = (S.ses && S.ses.token) ? S.ses.token : '';
  var dTok = getDriveUnlockToken(dId);
  return API + '/thumb/' + encodeURIComponent(gId) + '?driveId=' + encodeURIComponent(dId||'') + (tok ? '&token=' + encodeURIComponent(tok) : '') + (dTok ? '&driveToken=' + encodeURIComponent(dTok) : '');
}
function apiRenameFile(fileId, newName) {
  return apiFetch('files/rename/' + encodeURIComponent(fileId), { method: 'POST', body: JSON.stringify({ name: newName }) });
}
function apiRenameFolder(folderId, newName) {
  return apiFetch('folders/rename/' + encodeURIComponent(folderId), { method: 'POST', body: JSON.stringify({ name: newName }) });
}
function apiDeleteFile(gId, dId)  { return apiFetch('files/'+gId+'?driveId='+dId, { method:'DELETE' }); }
function apiCreateFolder(body)    { return apiFetch('folders',          { method:'POST', body:JSON.stringify(body) }); }
function apiDeleteFolder(id)      { return apiFetch('folders/'+id,      { method:'DELETE' }); }
function apiCreateUser(u, p, d)   { return apiFetch('admin/users',      { method:'POST', body:JSON.stringify({username:u,password:p,allowedDrives:d}) }); }
function apiDeleteUser(id)        { return apiFetch('admin/users/'+id,  { method:'DELETE' }); }
function apiChangeAdminPass(p)    { return apiFetch('admin/change-password', { method:'POST', body:JSON.stringify({newPassword:p}) }); }
function apiUploadComplete(body)      { return apiFetch('upload/complete',  { method:'POST', body:JSON.stringify(body) }); }
function apiBatchUploadComplete(files){ return apiFetch('upload/batch-complete', { method:'POST', body:JSON.stringify({ files: files }) }); }
function apiCopyFiles(fileIds, targetFolderId, targetDriveId) {
  return apiFetch('files/copy', { method:'POST', body: JSON.stringify({ fileIds: fileIds, targetFolderId: targetFolderId || null, targetDriveId: targetDriveId || null }) });
}

async function apiConnectDrive() {
  var r = await apiFetch('auth/google');
  if (!r || !r.url) {
    if (r && (r.error === 'Unauthorized' || r.status === 401)) {
      toast('Admin session expired. Please enter admin password to authenticate.', 'warning', 6000);
      if (typeof showAdminLogin === 'function') showAdminLogin(null);
      return false;
    }
    toast(r ? (r.error||'Cannot get OAuth URL') : 'Network error', 'error');
    return false;
  }
  var popup = window.open(r.url, 'google-auth', 'width=520,height=620,menubar=no,toolbar=no');
  return new Promise(function(resolve) {
    var done = false;
    function onMsg(e) { if(e.data==='drive-connected'){ done=true; window.removeEventListener('message',onMsg); resolve(true); } }
    window.addEventListener('message', onMsg);
    var t = setInterval(function(){ if(!popup||popup.closed){ clearInterval(t); window.removeEventListener('message',onMsg); resolve(done); } }, 800);
    setTimeout(function(){ clearInterval(t); window.removeEventListener('message',onMsg); resolve(done); }, 120000);
  });
}

// ─── Upload: Step 1 — get Google resumable URL from our backend ───────────────
async function apiUploadInit(driveId, folderId, name, size, mimeType, googleFolderId) {
  return apiFetch('upload/init', {
    method: 'POST',
    body: JSON.stringify({
      driveId: driveId,
      folderId: folderId || null,
      googleFolderId: googleFolderId || null,
      name: name,
      size: size,
      mimeType: mimeType || 'application/octet-stream'
    })
  });
}

// ─── Upload: Step 2 — XHR directly to Google's resumable URL ─────────────────
// Returns a Promise with { googleFileId } on success
function uploadToGoogle(uploadUrl, file, onProgress, cancelSignal) {
  return new Promise(function(resolve, reject) {
    var xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');

    var startTime = Date.now();
    xhr.upload.onprogress = function(e) {
      if(cancelSignal && cancelSignal.cancelled) { xhr.abort(); return; }
      if(e.lengthComputable) {
        var elapsed = (Date.now() - startTime) / 1000 || 0.001;
        var speed = e.loaded / elapsed;
        onProgress(e.loaded, e.total, speed);
      }
    };

    xhr.onload = function() {
      // 200, 201 means completed file created
      if(xhr.status === 200 || xhr.status === 201) {
        try {
          var resp = JSON.parse(xhr.responseText || '{}');
          resolve({ googleFileId: resp.id });
        } catch(e) {
          resolve({ googleFileId: null });
        }
      } else if (xhr.status === 308) {
        // Resumable incomplete, but for single-shot upload this shouldn't happen unless chunked
        resolve({ googleFileId: null, status: 308 });
      } else {
        var msg = 'Upload error (HTTP ' + xhr.status + ')';
        try {
          var errObj = JSON.parse(xhr.responseText);
          if (errObj && errObj.error && errObj.error.message) msg += ': ' + errObj.error.message;
        } catch(e) {}
        reject(new Error(msg));
      }
    };

    xhr.onerror = function(err) {
      // Detailed error if possible
      reject(new Error('Network error — upload interrupted or blocked by browser'));
    };
    xhr.onabort = function() { reject(new Error('Cancelled')); };

    xhr.send(file);
  });
}
// ─── Resumable Chunk Upload with Pause / Resume Support ───────────────────────
// ─── Resumable Single-Stream Fast Upload with Pause / Resume Support ────────
async function uploadToGoogleResumable(uploadUrl, file, onProgress, cancelSignal) {
  var total = file.size;
  var startOffset = 0;
  var retries = 0;

  while (startOffset < total) {
    if (cancelSignal && cancelSignal.cancelled) throw new Error('Cancelled');

    if (cancelSignal && cancelSignal.paused) {
      await new Promise(function(resolve) { cancelSignal.resumeResolve = resolve; });
      if (cancelSignal && cancelSignal.cancelled) throw new Error('Cancelled');
      // Query Google for uploaded bytes
      var queryRes = await queryGoogleUploadedBytes(uploadUrl, total);
      if (queryRes.complete || queryRes.offset >= total) {
        onProgress(total, total, 0);
        return { googleFileId: queryRes.googleFileId || null };
      }
      startOffset = queryRes.offset;
    }

    var chunk = (startOffset === 0) ? file : file.slice(startOffset);
    var endOffset = total - 1;

    var res = await new Promise(function(resolve, reject) {
      var xhr = new XMLHttpRequest();
      if (cancelSignal) cancelSignal.xhr = xhr;
      xhr.open('PUT', uploadUrl);
      xhr.setRequestHeader('Content-Range', 'bytes ' + startOffset + '-' + endOffset + '/' + total);
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');

      var startTime = Date.now();
      var lastProgressTime = 0;
      var lastActivityTime = Date.now();
      var lastLoaded = startOffset;
      var stalled = false;

      // Watchdog interval to detect stalled sockets (e.g. stalled at 100% or dead TCP connection)
      var watchdog = setInterval(function() {
        if (cancelSignal && cancelSignal.cancelled) {
          clearInterval(watchdog);
          try { xhr.abort(); } catch(e){}
          return;
        }
        var elapsed = Date.now() - lastActivityTime;
        var isAtFinalizing = (lastLoaded >= total);
        var stallThreshold = isAtFinalizing ? 18000 : 35000;

        if (elapsed > stallThreshold) {
          clearInterval(watchdog);
          stalled = true;
          try { xhr.abort(); } catch(e){}
        }
      }, 2500);

      xhr.upload.onprogress = function(e) {
        lastActivityTime = Date.now();
        if (cancelSignal && cancelSignal.cancelled) {
          clearInterval(watchdog);
          try { xhr.abort(); } catch(e){}
          return;
        }
        if (e.lengthComputable) {
          var curLoaded = startOffset + e.loaded;
          lastLoaded = curLoaded;
          var now = Date.now();
          if (curLoaded === total || now - lastProgressTime >= 100) {
            lastProgressTime = now;
            var elSec = (now - startTime) / 1000 || 0.001;
            var speed = e.loaded / elSec;
            onProgress(curLoaded, total, speed);
          }
        }
      };

      xhr.onload = function() {
        clearInterval(watchdog);
        if (xhr.status === 200 || xhr.status === 201) {
          var id = null;
          try { id = JSON.parse(xhr.responseText).id; } catch(e){}
          resolve({ ok: true, googleFileId: id });
        } else if (xhr.status === 308) {
          var range = xhr.getResponseHeader('Range');
          var next = startOffset;
          if (range) {
            var m = range.match(/bytes=0-(\d+)/);
            if (m) next = parseInt(m[1], 10) + 1;
          }
          resolve({ ok: false, status: 308, nextOffset: next });
        } else {
          var msg = 'Upload failed HTTP ' + xhr.status;
          try { var j = JSON.parse(xhr.responseText); if (j.error && j.error.message) msg += ': ' + j.error.message; } catch(e){}
          reject(new Error(msg));
        }
      };

      xhr.onerror = function() {
        clearInterval(watchdog);
        resolve({ error: 'network' });
      };

      xhr.onabort = function() {
        clearInterval(watchdog);
        if (cancelSignal && cancelSignal.paused) {
          resolve({ paused: true });
        } else if (stalled) {
          resolve({ error: 'stalled' });
        } else {
          reject(new Error('Cancelled'));
        }
      };

      xhr.send(chunk);
    });

    if (res.ok) {
      onProgress(total, total, 0);
      return { googleFileId: res.googleFileId };
    } else if (res.paused) {
      continue;
    } else if (res.status === 308) {
      startOffset = res.nextOffset;
      retries = 0;
    } else if (res.error === 'network' || res.error === 'stalled') {
      retries++;
      if (retries > 4) throw new Error('Upload connection stalled after retries');
      await new Promise(function(r){ setTimeout(r, 1200); });
      var queryCheck = await queryGoogleUploadedBytes(uploadUrl, total);
      if (queryCheck.complete || queryCheck.offset >= total) {
        onProgress(total, total, 0);
        return { googleFileId: queryCheck.googleFileId || null };
      }
      startOffset = queryCheck.offset;
      continue;
    } else {
      break;
    }
  }

  return { googleFileId: null };
}

function queryGoogleUploadedBytes(uploadUrl, total) {
  return new Promise(function(resolve) {
    var xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Range', 'bytes */' + total);
    var timer = setTimeout(function() {
      try { xhr.abort(); } catch(e){}
      resolve({ offset: 0 });
    }, 12000);

    xhr.onload = function() {
      clearTimeout(timer);
      if (xhr.status === 308) {
        var range = xhr.getResponseHeader('Range');
        if (range) {
          var m = range.match(/bytes=0-(\d+)/);
          if (m) return resolve({ offset: parseInt(m[1], 10) + 1 });
        }
        return resolve({ offset: 0 });
      } else if (xhr.status === 200 || xhr.status === 201) {
        try {
          var data = JSON.parse(xhr.responseText);
          return resolve({ offset: total, googleFileId: data.id, complete: true });
        } catch(e) {
          return resolve({ offset: total, complete: true });
        }
      }
      resolve({ offset: 0 });
    };
    xhr.onerror = function() {
      clearTimeout(timer);
      resolve({ offset: 0 });
    };
    xhr.onabort = function() {
      clearTimeout(timer);
      resolve({ offset: 0 });
    };
    xhr.send();
  });
}

function apiToggleStar(fileId) { return apiFetch('files/star/' + encodeURIComponent(fileId), { method: 'POST' }); }
function apiRenameDrive(driveId, newName) { return apiFetch('drives/rename/' + encodeURIComponent(driveId), { method: 'POST', body: JSON.stringify({ name: newName }) }); }
function apiRequestRestore(fileId) { return apiFetch('files/trash/request-restore/' + encodeURIComponent(fileId), { method: 'POST' }); }
function apiApproveRestore(fileId) { return apiFetch('files/trash/approve-restore/' + encodeURIComponent(fileId), { method: 'POST' }); }
function apiPermanentDelete(fileId) { return apiFetch('files/trash/permanent-delete/' + encodeURIComponent(fileId), { method: 'DELETE' }); }
function apiBatchTrash(fileIds) { return apiFetch('files/batch-trash', { method: 'POST', body: JSON.stringify({ fileIds: fileIds }) }); }
function apiBatchRequestRestore(fileIds) { return apiFetch('files/trash/batch-request-restore', { method: 'POST', body: JSON.stringify({ fileIds: fileIds }) }); }
function apiBatchApproveRestore(fileIds) { return apiFetch('files/trash/batch-approve-restore', { method: 'POST', body: JSON.stringify({ fileIds: fileIds }) }); }
function apiBatchPermanentDelete(fileIds) { return apiFetch('files/trash/batch-permanent-delete', { method: 'POST', body: JSON.stringify({ fileIds: fileIds }) }); }
function apiEmptyTrash() { return apiFetch('files/trash/empty', { method: 'POST' }); }
function apiLockFolder(folderId, password, hint) { return apiFetch('folders/lock/' + encodeURIComponent(folderId), { method: 'POST', body: JSON.stringify({ password: password, hint: hint || '' }) }); }
function apiUnlockFolder(folderId, password) { return apiFetch('folders/unlock/' + encodeURIComponent(folderId), { method: 'POST', body: JSON.stringify({ password: password }) }); }
function apiRemoveFolderLock(folderId, password) { return apiFetch('folders/remove-lock/' + encodeURIComponent(folderId), { method: 'POST', body: JSON.stringify({ password: password }) }); }
function apiSetDrivePassword(driveId, password, hint) { return apiFetch('admin/drive-password', { method: 'POST', body: JSON.stringify({ driveId: driveId, password: password, hint: hint || '' }) }); }
function apiUnlockDrive(driveId, password) { return apiFetch('drives/unlock-drive', { method: 'POST', body: JSON.stringify({ driveId: driveId, password: password }) }); }
function apiGetAdminLockedFolders() { return apiFetch('admin/locked-folders'); }
function apiGetDestroyedFolders() { return apiFetch('admin/destroyed-folders'); }
function apiRecoverFolder(folderId) { return apiFetch('admin/recover-folder/' + encodeURIComponent(folderId), { method: 'POST' }); }
function apiGetPolicy() { return apiFetch('admin/policy'); }
function apiSetPolicy(policy) { return apiFetch('admin/policy', { method: 'POST', body: JSON.stringify(policy) }); }
function apiSetFolderVisibility(folderId, adminOnly, allowedUsers) {
  return apiFetch('folders/visibility', {
    method: 'POST',
    body: JSON.stringify({ folderId: folderId, adminOnly: !!adminOnly, allowedUsers: allowedUsers || [] })
  });
}