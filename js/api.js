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