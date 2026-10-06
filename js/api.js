// TeleDrive — API Client (calls Cloudflare Pages Function at /api/*)
function authHdr(){return S.ses.token?{Authorization:`Bearer ${S.ses.token}`,'Content-Type':'application/json'}:{'Content-Type':'application/json'};}
async function apiFetch(path,opts={}){
  const r=await fetch(`${API}/${path}`,{headers:authHdr(),...opts});
  const ct=r.headers.get('Content-Type')||'';
  if(!ct.includes('application/json'))return {ok:r.ok,status:r.status};
  const d=await r.json();
  return d;
}

// Auth
async function apiAdminLogin(password){return apiFetch('auth/login',{method:'POST',body:JSON.stringify({password})});}
async function apiUserLogin(username,password){return apiFetch('auth/user-login',{method:'POST',body:JSON.stringify({username,password})});}

// DB
async function apiFetchDB(){return apiFetch('db');}

// Drives
async function apiDriveQuota(){return apiFetch('drives/quota');}
async function apiConnectDrive(){
  // Open Google OAuth in popup
  const r=await apiFetch('auth/google',{method:'GET',redirect:'manual'}).catch(()=>null);
  // Actually redirect to oauth url returned by Function
  const d=await fetch(`${API}/auth/google`,{headers:authHdr()});
  const j=await d.json();
  if(j.url){
    const popup=window.open(j.url,'GDrive OAuth','width=560,height=600');
    return new Promise(res=>{
      const handler=e=>{if(e.data==='drive-connected'){window.removeEventListener('message',handler);popup?.close();res(true);}};
      window.addEventListener('message',handler);
      const t=setInterval(()=>{if(popup?.closed){clearInterval(t);window.removeEventListener('message',handler);res(false);}},1000);
    });
  }
  return false;
}
async function apiDisconnectDrive(id){return apiFetch(`drives/${id}`,{method:'DELETE'});}

// Upload
async function apiUploadInit(driveId,folderId,name,size,mimeType){
  return apiFetch('upload/init',{method:'POST',body:JSON.stringify({driveId,folderId,name,size,mimeType})});
}
async function apiUploadComplete(data){return apiFetch('upload/complete',{method:'POST',body:JSON.stringify(data)});}

// Download
async function apiDownload(googleFileId,driveId){return apiFetch(`download/${googleFileId}?driveId=${driveId}`);}

// File delete
async function apiDeleteFile(googleFileId,driveId){return apiFetch(`files/${googleFileId}?driveId=${driveId}`,{method:'DELETE'});}

// Folders
async function apiCreateFolder(driveId,parentFolderId,name){return apiFetch('folders',{method:'POST',body:JSON.stringify({driveId,parentFolderId,name})});}
async function apiDeleteFolder(folderId){return apiFetch(`folders/${folderId}`,{method:'DELETE'});}

// Admin
async function apiCreateUser(username,password,allowedDrives){return apiFetch('admin/users',{method:'POST',body:JSON.stringify({username,password,allowedDrives})});}
async function apiDeleteUser(userId){return apiFetch(`admin/users/${userId}`,{method:'DELETE'});}
async function apiChangeAdminPassword(newPassword){return apiFetch('admin/change-password',{method:'POST',body:JSON.stringify({newPassword})});}
async function apiInit(){return apiFetch('admin/init',{method:'POST',body:JSON.stringify({})});}

// Upload a file with resumable upload directly to Google Drive
// Returns a promise that resolves when done
function uploadFileToGDrive(uploadUrl,file,onProgress,onDone,onError){
  const xhr=new XMLHttpRequest();xhr.open('PUT',uploadUrl);
  xhr.setRequestHeader('Content-Type',file.type||'application/octet-stream');
  let lastLoaded=0,lastTime=Date.now(),speed=0;
  xhr.upload.onprogress=e=>{
    if(!e.lengthComputable)return;
    const now=Date.now();const dt=(now-lastTime)/1000;
    if(dt>=0.5){speed=(e.loaded-lastLoaded)/dt;lastLoaded=e.loaded;lastTime=now;}
    if(onProgress)onProgress(e.loaded,e.total,speed);
  };
  xhr.onload=()=>{
    if(xhr.status>=200&&xhr.status<300){
      try{const d=JSON.parse(xhr.responseText);onDone&&onDone(d);}
      catch{onDone&&onDone({id:null});}
    }else{onError&&onError(new Error(`HTTP ${xhr.status}: ${xhr.statusText}`));}
  };
  xhr.onerror=()=>onError&&onError(new Error('Network error during upload'));
  xhr.onabort=()=>onError&&onError(new Error('Cancelled'));
  xhr.send(file);
  S._xhr=xhr;
  return xhr;
}