function authHdr() {
  var h = { 'Content-Type': 'application/json' };
  if (S.ses.token) h['Authorization'] = 'Bearer ' + S.ses.token;
  return h;
}

async function apiFetch(path, opts) {
  opts = opts || {};
  try {
    var r = await fetch(API + '/' + path, Object.assign({ headers: authHdr() }, opts));
    var ct = r.headers.get('Content-Type') || '';
    if (!ct.includes('application/json')) return { ok: r.ok, status: r.status };
    return await r.json();
  } catch (e) {
    console.error('apiFetch error:', path, e.message);
    return { error: e.message };
  }
}

function apiFetchDB()              { return apiFetch('db'); }
function apiAdminLogin(pass)       { return apiFetch('auth/login',      { method:'POST', body: JSON.stringify({ password: pass }) }); }
function apiUserLogin(user, pass)  { return apiFetch('auth/user-login', { method:'POST', body: JSON.stringify({ username: user, password: pass }) }); }
function apiInit(pass)             { return apiFetch('admin/init',      { method:'POST', body: JSON.stringify({ adminPassword: pass || 'admin123' }) }); }
function apiDriveQuota()           { return apiFetch('drives/quota'); }
function apiDisconnectDrive(id)    { return apiFetch('drives/'+id,      { method:'DELETE' }); }
function apiUploadInit(body)       { return apiFetch('upload/init',     { method:'POST', body: JSON.stringify(body) }); }
function apiUploadComplete(body)   { return apiFetch('upload/complete', { method:'POST', body: JSON.stringify(body) }); }
function apiDownload(gId, drvId)   { return apiFetch('download/'+gId+'?driveId='+drvId); }
function apiDeleteFile(gId, drvId) { return apiFetch('files/'+gId+'?driveId='+drvId, { method:'DELETE' }); }
function apiCreateFolder(body)     { return apiFetch('folders',         { method:'POST', body: JSON.stringify(body) }); }
function apiDeleteFolder(id)       { return apiFetch('folders/'+id,     { method:'DELETE' }); }
function apiCreateUser(u, p, d)    { return apiFetch('admin/users',     { method:'POST', body: JSON.stringify({ username: u, password: p, allowedDrives: d }) }); }
function apiDeleteUser(id)         { return apiFetch('admin/users/'+id, { method:'DELETE' }); }
function apiChangeAdminPassword(p) { return apiFetch('admin/change-password', { method:'POST', body: JSON.stringify({ newPassword: p }) }); }

async function apiConnectDrive() {
  var r = await apiFetch('auth/google');
  if (!r.url) { toast(r.error || 'Cannot get OAuth URL', 'error'); return false; }
  var popup = window.open(r.url, 'google-auth', 'width=520,height=620,menubar=no,toolbar=no');
  return new Promise(function(resolve) {
    var done = false;
    function onMsg(e) { if (e.data === 'drive-connected') { done = true; window.removeEventListener('message', onMsg); resolve(true); } }
    window.addEventListener('message', onMsg);
    var t = setInterval(function() {
      if (!popup || popup.closed) { clearInterval(t); window.removeEventListener('message', onMsg); resolve(done); }
    }, 800);
    setTimeout(function() { clearInterval(t); window.removeEventListener('message', onMsg); resolve(done); }, 120000);
  });
}

async function uploadFileToGDrive(uploadUrl, file, onProgress) {
  return new Promise(function(resolve, reject) {
    var xhr = new XMLHttpRequest();
    S._xhr = xhr;
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = function(e) { if (e.lengthComputable) onProgress(e.loaded, e.total); };
    xhr.onload = function() {
      S._xhr = null;
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); } catch(e) { resolve({}); }
      } else { reject(new Error('Upload failed: ' + xhr.status)); }
    };
    xhr.onerror = function() { S._xhr = null; reject(new Error('Network error')); };
    xhr.onabort = function() { S._xhr = null; reject(new Error('Cancelled')); };
    xhr.send(file);
  });
}