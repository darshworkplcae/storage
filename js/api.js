var API = '/api';

function authHdr() {
  var h = { 'Content-Type': 'application/json' };
  if (S.ses && S.ses.token) h['Authorization'] = 'Bearer ' + S.ses.token;
  return h;
}

async function apiFetch(path, opts) {
  opts = opts || {};
  try {
    var r = await fetch(API + '/' + path, Object.assign({ headers: authHdr() }, opts));
    var ct = r.headers.get('Content-Type') || '';
    if (!ct.includes('application/json')) {
      return { ok: r.ok, status: r.status, _raw: await r.text().catch(function(){return '';}) };
    }
    return await r.json();
  } catch(e) { return { error: e.message }; }
}

function apiFetchDB()             { return apiFetch('db'); }
function apiAdminLogin(pass)      { return apiFetch('auth/login',       { method:'POST', body: JSON.stringify({ password:pass }) }); }
function apiUserLogin(u, p)       { return apiFetch('auth/user-login',  { method:'POST', body: JSON.stringify({ username:u, password:p }) }); }
function apiDriveQuota()          { return apiFetch('drives/quota'); }
function apiDisconnect(id)        { return apiFetch('drives/'+id,       { method:'DELETE' }); }
function apiDownload(gId, dId)    { return apiFetch('download/'+gId+'?driveId='+dId); }
function getFileDownloadUrl(gId, dId, inline) {
  var tok = (S.ses && S.ses.token) ? S.ses.token : '';
  return API + '/download/' + encodeURIComponent(gId) + '?driveId=' + encodeURIComponent(dId||'') + (inline ? '&inline=1' : '') + (tok ? '&token=' + encodeURIComponent(tok) : '');
}
function apiDeleteFile(gId, dId)  { return apiFetch('files/'+gId+'?driveId='+dId, { method:'DELETE' }); }
function apiCreateFolder(body)    { return apiFetch('folders',          { method:'POST', body:JSON.stringify(body) }); }
function apiDeleteFolder(id)      { return apiFetch('folders/'+id,      { method:'DELETE' }); }
function apiCreateUser(u, p, d)   { return apiFetch('admin/users',      { method:'POST', body:JSON.stringify({username:u,password:p,allowedDrives:d}) }); }
function apiDeleteUser(id)        { return apiFetch('admin/users/'+id,  { method:'DELETE' }); }
function apiChangeAdminPass(p)    { return apiFetch('admin/change-password', { method:'POST', body:JSON.stringify({newPassword:p}) }); }
function apiUploadComplete(body)  { return apiFetch('upload/complete',  { method:'POST', body:JSON.stringify(body) }); }

async function apiConnectDrive() {
  var r = await apiFetch('auth/google');
  if (!r || !r.url) { toast(r ? (r.error||'Cannot get OAuth URL') : 'Network error', 'error'); return false; }
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
async function apiUploadInit(driveId, folderId, name, size, mimeType) {
  return apiFetch('upload/init', {
    method: 'POST',
    body: JSON.stringify({ driveId:driveId, folderId:folderId||null, name:name, size:size, mimeType:mimeType||'application/octet-stream' })
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
      startOffset = await queryGoogleUploadedBytes(uploadUrl, total);
      if (startOffset >= total) {
        onProgress(total, total, 0);
        return { googleFileId: null };
      }
    }

    var chunk = (startOffset === 0) ? file : file.slice(startOffset);
    var endOffset = total - 1;

    var res = await new Promise(function(resolve, reject) {
      var xhr = new XMLHttpRequest();
      if (cancelSignal) cancelSignal.xhr = xhr;
      xhr.open('PUT', uploadUrl);
      if (startOffset > 0) {
        xhr.setRequestHeader('Content-Range', 'bytes ' + startOffset + '-' + endOffset + '/' + total);
      }
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');

      var startTime = Date.now();
      xhr.upload.onprogress = function(e) {
        if (cancelSignal && cancelSignal.cancelled) { xhr.abort(); return; }
        if (e.lengthComputable) {
          var curLoaded = startOffset + e.loaded;
          var elapsed = (Date.now() - startTime) / 1000 || 0.001;
          var speed = e.loaded / elapsed;
          onProgress(curLoaded, total, speed);
        }
      };

      xhr.onload = function() {
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

      xhr.onerror = function() { resolve({ error: 'network' }); };
      xhr.onabort = function() {
        if (cancelSignal && cancelSignal.paused) resolve({ paused: true });
        else reject(new Error('Cancelled'));
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
      retryCount = 0;
    } else if (res.error === 'network') {
      retries++;
      if (retries > 3) throw new Error('Network error — connection dropped after 3 retries');
      await new Promise(function(r){ setTimeout(r, 1500); });
      startOffset = await queryGoogleUploadedBytes(uploadUrl, total);
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
    xhr.onload = function() {
      if (xhr.status === 308) {
        var range = xhr.getResponseHeader('Range');
        if (range) {
          var m = range.match(/bytes=0-(\d+)/);
          if (m) return resolve(parseInt(m[1], 10) + 1);
        }
      }
      resolve(0);
    };
    xhr.onerror = function() { resolve(0); };
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
function apiLockFolder(folderId, password) { return apiFetch('folders/lock/' + encodeURIComponent(folderId), { method: 'POST', body: JSON.stringify({ password: password }) }); }
function apiUnlockFolder(folderId, password) { return apiFetch('folders/unlock/' + encodeURIComponent(folderId), { method: 'POST', body: JSON.stringify({ password: password }) }); }
function apiRemoveFolderLock(folderId, password) { return apiFetch('folders/remove-lock/' + encodeURIComponent(folderId), { method: 'POST', body: JSON.stringify({ password: password }) }); }
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