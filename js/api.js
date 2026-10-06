var API = '/api';
var CHUNK_SIZE = 8 * 1024 * 1024; // 8MB chunks

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
  } catch(e) { return { error: e.message }; }
}

function apiFetchDB()             { return apiFetch('db'); }
function apiAdminLogin(pass)      { return apiFetch('auth/login',         { method:'POST', body: JSON.stringify({ password:pass }) }); }
function apiUserLogin(user, pass) { return apiFetch('auth/user-login',    { method:'POST', body: JSON.stringify({ username:user, password:pass }) }); }
function apiDriveQuota()          { return apiFetch('drives/quota'); }
function apiDisconnect(id)        { return apiFetch('drives/'+id,         { method:'DELETE' }); }
function apiDownload(gId, drvId)  { return apiFetch('download/'+gId+'?driveId='+drvId); }
function apiDeleteFile(gId,drvId) { return apiFetch('files/'+gId+'?driveId='+drvId, { method:'DELETE' }); }
function apiCreateFolder(body)    { return apiFetch('folders',            { method:'POST', body:JSON.stringify(body) }); }
function apiDeleteFolder(id)      { return apiFetch('folders/'+id,        { method:'DELETE' }); }
function apiCreateUser(u,p,d)     { return apiFetch('admin/users',        { method:'POST', body:JSON.stringify({username:u,password:p,allowedDrives:d}) }); }
function apiDeleteUser(id)        { return apiFetch('admin/users/'+id,    { method:'DELETE' }); }
function apiChangeAdminPass(p)    { return apiFetch('admin/change-password',{ method:'POST', body:JSON.stringify({newPassword:p}) }); }

async function apiConnectDrive() {
  var r = await apiFetch('auth/google');
  if (!r.url) { toast(r.error || 'Cannot get OAuth URL', 'error'); return false; }
  var popup = window.open(r.url, 'google-auth', 'width=520,height=620,menubar=no,toolbar=no');
  return new Promise(function(resolve) {
    var done = false;
    function onMsg(e) { if(e.data==='drive-connected'){ done=true; window.removeEventListener('message',onMsg); resolve(true); } }
    window.addEventListener('message', onMsg);
    var t = setInterval(function(){ if(!popup||popup.closed){ clearInterval(t); window.removeEventListener('message',onMsg); resolve(done); } }, 800);
    setTimeout(function(){ clearInterval(t); window.removeEventListener('message',onMsg); resolve(done); }, 120000);
  });
}

// Chunked upload through our CF proxy — avoids CORS issues with Google Drive
async function uploadFileChunked(driveId, folderId, file, onProgress) {
  // Step 1: Init session
  var initResp = await apiFetch('upload/init', {
    method: 'POST',
    body: JSON.stringify({ driveId:driveId, folderId:folderId||null, name:file.name, size:file.size, mimeType:file.type||'application/octet-stream' })
  });
  if (!initResp.sessionId) throw new Error(initResp.error || 'Upload init failed');

  var sessionId = initResp.sessionId;
  var fileLocalId = initResp.fileLocalId;
  var total = file.size;
  var offset = 0;
  var startTime = Date.now();
  var googleFileId = null;

  // Step 2: Upload chunks
  while (offset < total) {
    if (S.cancelUpload) throw new Error('Cancelled');
    var end = Math.min(offset + CHUNK_SIZE, total);
    var chunk = file.slice(offset, end);

    var r = await fetch(API + '/upload/chunk', {
      method: 'PUT',
      headers: {
        'Authorization': 'Bearer ' + (S.ses.token || ''),
        'X-Session-Id': sessionId,
        'X-Upload-Offset': String(offset),
        'X-Upload-Total': String(total),
        'Content-Type': file.type || 'application/octet-stream'
      },
      body: chunk
    });
    var result = await r.json().catch(function(){ return { error: 'Bad response' }; });
    if (result.error) throw new Error(result.error);

    offset = result.uploaded || (offset + chunk.size);
    if (result.googleFileId) googleFileId = result.googleFileId;

    var elapsed = (Date.now() - startTime) / 1000;
    var speed = elapsed > 0 ? offset / elapsed : 0;
    onProgress(offset, total, speed);

    if (result.complete) break;
  }

  if (!googleFileId) throw new Error('No Google file ID returned');

  // Step 3: Save metadata
  await apiFetch('upload/complete', {
    method: 'POST',
    body: JSON.stringify({ fileLocalId:fileLocalId, googleFileId:googleFileId, driveId:driveId, folderId:folderId||null, name:file.name, size:file.size, mimeType:file.type||'application/octet-stream' })
  });

  return { googleFileId:googleFileId, fileLocalId:fileLocalId };
}