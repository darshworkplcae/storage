// TeleDrive — Cloudflare Pages Function (all /api/* routes)
const UPS_URL='https://driven-yeti-165554.upstash.io';
const UPS_TOK='gQAAAAAAAoayAAIgcDFhMTkwMmY5ZTY0ODY0MDk2YWZmYjMzYjk5YWZkMjk1Nw';
const DEF_ENC='TeleDriveKey2026SecureDefaultXX';
function gUU(e){return e.UPSTASH_URL||UPS_URL;}
function gUT(e){return e.UPSTASH_TOKEN||UPS_TOK;}
function gEK(e){return e.ENCRYPTION_KEY||DEF_ENC;}
function gGC(e){return e.GOOGLE_CLIENT_ID||'';}
function gGS(e){return e.GOOGLE_CLIENT_SECRET||'';}
const COR={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,DELETE,PUT,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization,Range','Access-Control-Expose-Headers':'Content-Range,Content-Length,Accept-Ranges'};
function J(d,s){return new Response(JSON.stringify(d),{status:s||200,headers:{...COR,'Content-Type':'application/json'}});}
async function uGet(env,key){const r=await fetch(`${gUU(env)}/get/${encodeURIComponent(key)}`,{headers:{Authorization:`Bearer ${gUT(env)}`}});const d=await r.json();if(d.result===null||d.result===undefined)return null;if(typeof d.result!=='string')return d.result;try{return JSON.parse(d.result);}catch(e){return d.result;}}
async function uSet(env,key,val){await fetch(`${gUU(env)}/set/${encodeURIComponent(key)}`,{method:'POST',headers:{Authorization:`Bearer ${gUT(env)}`,'Content-Type':'application/json'},body:JSON.stringify(val)});}
async function uExp(env,key,s){await fetch(`${gUU(env)}/expire/${encodeURIComponent(key)}/${s}`,{method:'POST',headers:{Authorization:`Bearer ${gUT(env)}`}});}
async function sha256(t){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(t));return Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,'0')).join('');}
async function iKey(s){const r=new TextEncoder().encode(s.padEnd(32,'0').slice(0,32));return crypto.subtle.importKey('raw',r,{name:'AES-GCM'},false,['encrypt','decrypt']);}
async function enc(t,s){const k=await iKey(s);const iv=crypto.getRandomValues(new Uint8Array(12));const e=await crypto.subtle.encrypt({name:'AES-GCM',iv},k,new TextEncoder().encode(t));const c=new Uint8Array([...iv,...new Uint8Array(e)]);return btoa(String.fromCharCode(...c));}
async function dec(b64,s){const k=await iKey(s);const c=Uint8Array.from(atob(b64),x=>x.charCodeAt(0));const d=await crypto.subtle.decrypt({name:'AES-GCM',iv:c.slice(0,12)},k,c.slice(12));return new TextDecoder().decode(d);}
function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,7);}
async function vSes(req,env,role){const tok=(req.headers.get('Authorization')||'').replace('Bearer ','').trim();if(!tok)return role?false:null;const v=await uGet(env,`td:ses:${tok}`);const c=String(v||'').replace(/^"|"$/g,'');if(role)return c===role;return c||null;}
async function gAT(env,rt){
  const r=await dec(rt,gEK(env));
  const kHash=await sha256(r);
  const cached=await uGet(env,`td:at:${kHash}`);
  if(cached&&typeof cached==='string'&&cached.length>10) return cached;
  const x=await(await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:gGC(env),client_secret:gGS(env),refresh_token:r,grant_type:'refresh_token'})})).json();
  if(!x.access_token)throw new Error(`Token: ${x.error||'fail'}`);
  await uSet(env,`td:at:${kHash}`,x.access_token);
  await uExp(env,`td:at:${kHash}`,3000);
  return x.access_token;
}
async function gDQ(at){return(await fetch('https://www.googleapis.com/drive/v3/about?fields=storageQuota,user',{headers:{Authorization:`Bearer ${at}`}})).json();}
async function mkDir(at,n,pid){const q=`name='${n}' and mimeType='application/vnd.google-apps.folder' and trashed=false${pid?` and '${pid}' in parents`:''}`;const s=await(await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`,{headers:{Authorization:`Bearer ${at}`}})).json();if(s.files&&s.files.length)return s.files[0].id;const c=await(await fetch('https://www.googleapis.com/drive/v3/files',{method:'POST',headers:{Authorization:`Bearer ${at}`,'Content-Type':'application/json'},body:JSON.stringify({name:n,mimeType:'application/vnd.google-apps.folder',...(pid?{parents:[pid]}:{})})})).json();return c.id;}

async function hAL(req,env){const{password=''}=await req.json().catch(()=>({}));const db=await uGet(env,'td:db');if(!db)return J({error:'Not initialized. POST /api/admin/init first.'},503);if(await sha256(password)!==db.adminHash)return J({error:'Wrong password'},401);const t=Array.from(crypto.getRandomValues(new Uint8Array(24))).map(b=>b.toString(16).padStart(2,'0')).join('');await uSet(env,`td:ses:${t}`,'admin');await uExp(env,`td:ses:${t}`,604800);return J({token:t,role:'admin'});}
async function hUL(req,env){const{username='',password=''}=await req.json().catch(()=>({}));const db=await uGet(env,'td:db');const u=(db&&db.users||[]).find(x=>x.username===username);if(!u||await sha256(password)!==u.passwordHash)return J({error:'Wrong username or password'},401);const t=Array.from(crypto.getRandomValues(new Uint8Array(24))).map(b=>b.toString(16).padStart(2,'0')).join('');await uSet(env,`td:ses:${t}`,u.id);await uExp(env,`td:ses:${t}`,604800);return J({token:t,role:'user',userId:u.id,username:u.username,allowedDrives:u.allowedDrives||'all'});}
async function hAG(req,env){if(!await vSes(req,env,'admin'))return J({error:'Unauthorized'},401);const cid=gGC(env);if(!cid)return J({error:'GOOGLE_CLIENT_ID not set in Cloudflare Pages env vars'},400);const o=new URL(req.url).origin;const u=new URL('https://accounts.google.com/o/oauth2/v2/auth');u.searchParams.set('client_id',cid);u.searchParams.set('redirect_uri',`${o}/api/auth/callback`);u.searchParams.set('response_type','code');u.searchParams.set('scope','https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile');u.searchParams.set('access_type','offline');u.searchParams.set('prompt','consent');return J({url:u.toString()});}
async function hCB(req,env){const url=new URL(req.url),code=url.searchParams.get('code');if(!code)return new Response('Missing code',{status:400});const toks=await(await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code,client_id:gGC(env),client_secret:gGS(env),redirect_uri:`${url.origin}/api/auth/callback`,grant_type:'authorization_code'})})).json();if(!toks.refresh_token)return new Response(`<html><body style="background:#0d0d12;color:#eee;font:16px sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center"><div><h2 style="color:#ff453a">No refresh token</h2><p>Revoke TeleDrive from <a href="https://myaccount.google.com/permissions" style="color:#4e86f5" target="_blank">Google Account permissions</a> then retry.</p><a href="/#/settings" style="color:#4e86f5">Back</a></div></body></html>`,{status:400,headers:{'Content-Type':'text/html'}});const user=await(await fetch('https://www.googleapis.com/oauth2/v2/userinfo',{headers:{Authorization:`Bearer ${toks.access_token}`}})).json();const quota=await gDQ(toks.access_token);const rfId=await mkDir(toks.access_token,'TeleDrive',null);const eT=await enc(toks.refresh_token,gEK(env));let db=await uGet(env,'td:db');if(!db)db={v:3,adminHash:await sha256('admin123'),drives:[],files:[],folders:[],activityLog:[],users:[]};if(!db.drives)db.drives=[];const cols=['#4e86f5','#30d158','#bf5af2','#ff9f0a','#ff453a','#64d2ff'];db.drives.push({id:uid(),email:user.email,name:user.name||user.email,picture:user.picture||'',color:cols[db.drives.length%cols.length],capacity:parseInt(quota.storageQuota&&quota.storageQuota.limit)||0,usedBytes:parseInt(quota.storageQuota&&quota.storageQuota.usage)||0,rootFolderId:rfId,encToken:eT,createdAt:new Date().toISOString()});await uSet(env,'td:db',db);return new Response(`<html><head><script>window.opener&&window.opener.postMessage('drive-connected','*');setTimeout(function(){window.close();},1500);<\/script></head><body style="background:#0d0d12;color:#eee;font:16px sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center"><div><h2 style="color:#30d158">Drive Connected!</h2><p>${user.email}</p><p style="opacity:.6">Closing…</p></div></body></html>`,{headers:{'Content-Type':'text/html'}});}
function syncDriveUsage(db){
  // Preserve real Google Drive quota (do not overwrite with only TeleDrive-uploaded files)
}
function sFold(f){
  if(!f) return f;
  const o = {...f};
  delete o.passwordHash;
  delete o.encPassword;
  return o;
}
async function hDB(req,env){
  const db=await uGet(env,'td:db');
  if(!db)return J(null);
  const policy = db.policy || { allowUserDownload: true, allowUserDelete: true };
  const r=await vSes(req,env,null);
  if(r==='admin'){
    return J({
      ...db,
      policy,
      drives:(db.drives||[]).map(d=>({...d,encToken:undefined})),
      folders:(db.folders||[]).map(sFold),
      activityLog:(db.activityLog||[]),
      users:(db.users||[])
    });
  }
  if(r){
    const u=(db.users||[]).find(x=>x.id===r);
    const allowed = u ? u.allowedDrives : null;
    const allowedList = (allowed && allowed !== 'all') ? (Array.isArray(allowed) ? allowed : [allowed]) : null;
    const userDrives = (db.drives||[]).filter(d => !allowedList || allowedList.includes(d.id)).map(d=>({...d,encToken:undefined}));
    const userDriveIds = userDrives.map(d => d.id);
    const userFolders = (db.folders||[]).filter(f => userDriveIds.includes(f.driveId) && !f.destroyed && !f.adminOnly && (!f.allowedUsers || !f.allowedUsers.length || f.allowedUsers.includes(r))).map(sFold);
    const visibleFolderIds = new Set(userFolders.map(f => f.id));
    const userFiles = (db.files||[]).filter(f => userDriveIds.includes(f.driveId) && !f.destroyed && !f.adminOnly && (!f.allowedUsers || !f.allowedUsers.length || f.allowedUsers.includes(r)) && (!f.folderId || visibleFolderIds.has(f.folderId)));
    const userLogs = (db.activityLog||[]).filter(l => !l.driveId || userDriveIds.includes(l.driveId));
    return J({
      v: db.v,
      openDriveId: db.openDriveId,
      policy,
      drives: userDrives,
      files: userFiles,
      folders: userFolders,
      activityLog: userLogs,
      users: u ? [{ id: u.id, username: u.username }] : []
    });
  }
  // Guest visitor: Strictly ONLY the open drive!
  const openId = db.openDriveId;
  const guestDrives = openId ? (db.drives||[]).filter(d => d.id === openId).map(d=>({...d,encToken:undefined})) : [];
  const guestDriveIds = guestDrives.map(d => d.id);
  const guestFolders = (db.folders||[]).filter(f => guestDriveIds.includes(f.driveId) && !f.destroyed && !f.adminOnly && (!f.allowedUsers || !f.allowedUsers.length)).map(sFold);
  const visibleFolderIds = new Set(guestFolders.map(f => f.id));
  const guestFiles = (db.files||[]).filter(f => guestDriveIds.includes(f.driveId) && !f.destroyed && !f.adminOnly && (!f.allowedUsers || !f.allowedUsers.length) && (!f.folderId || visibleFolderIds.has(f.folderId)));
  return J({
    v: db.v,
    openDriveId: db.openDriveId,
    policy,
    drives: guestDrives,
    files: guestFiles,
    folders: guestFolders,
    activityLog: [],
    users: []
  });
}
async function hQ(req,env){
  const ses=await vSes(req,env,null);
  if(!ses) return J({error:'Unauthorized'},401);
  const db=await uGet(env,'td:db');
  if(!db||!db.drives)return J({drives:[]});
  let drivesToQuery = db.drives;
  if(ses !== 'admin'){
    const u = (db.users||[]).find(x => x.id === ses);
    const allowed = u ? u.allowedDrives : null;
    const allowedList = (allowed && allowed !== 'all') ? (Array.isArray(allowed) ? allowed : [allowed]) : null;
    if(allowedList) drivesToQuery = drivesToQuery.filter(d => allowedList.includes(d.id));
  }
  let dbChanged = false;
  const res=await Promise.all(drivesToQuery.map(async d=>{
    try{
      const at=await gAT(env,d.encToken);
      const q=await gDQ(at);
      const cap = parseInt(q.storageQuota && q.storageQuota.limit) || d.capacity || 0;
      const used = parseInt(q.storageQuota && q.storageQuota.usage) || d.usedBytes || 0;
      if(d.capacity !== cap || d.usedBytes !== used){
        d.capacity = cap;
        d.usedBytes = used;
        dbChanged = true;
      }
      return { id:d.id, capacity:cap, usedBytes:used };
    }catch(e){
      return { id:d.id, capacity:d.capacity||0, usedBytes:d.usedBytes||0, error:e.message };
    }
  }));
  if(dbChanged){
    await uSet(env,'td:db',db);
  }
  return J({drives:res});
}
async function hDD(req,env,id){if(!await vSes(req,env,'admin'))return J({error:'Unauthorized'},401);const db=await uGet(env,'td:db');db.drives=(db.drives||[]).filter(d=>d.id!==id);await uSet(env,'td:db',db);return J({ok:true});}
async function hUI(req,env){
  const body=await req.json().catch(()=>({}));
  const{driveId,folderId,name,size,mimeType}=body;
  const db=await uGet(env,'td:db');
  const isOpenTarget=(db&&db.openDriveId&&driveId===db.openDriveId);
  const ses=await vSes(req,env,null);
  if(!ses && !isOpenTarget) return J({error:'Sign in required'},401);
  if(isOpenTarget && !ses){
    const isMedia = (mimeType && (mimeType.startsWith('image/') || mimeType.startsWith('video/'))) || (name && /\.(jpg|jpeg|png|gif|webp|mp4|mov|mkv|webm|avi)$/i.test(name));
    if(!isMedia) return J({error:'Open drive only allows photos and videos'},400);
  }
  const drv=(db&&db.drives||[]).find(d=>d.id===driveId);
  if(!drv) return J({error:'Drive not found'},404);
  const at=await gAT(env,drv.encToken);
  let pid=drv.rootFolderId;
  if(folderId){
    const f=(db.folders||[]).find(x=>x.id===folderId);
    if(f&&f.googleFolderId) pid=f.googleFolderId;
  }
  const ir=await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name',{
    method:'POST',
    headers:{
      Authorization:`Bearer ${at}`,
      'Content-Type':'application/json',
      'X-Upload-Content-Type':mimeType||'application/octet-stream',
      'X-Upload-Content-Length':String(size),
      'Origin':(new URL(req.url).origin)
    },
    body:JSON.stringify({name,mimeType:mimeType||'application/octet-stream',parents:[pid]})
  });
  const uUrl=ir.headers.get('Location');
  if(!uUrl) return J({error:'Upload session failed',detail:await ir.text()},500);
  return J({uploadUrl:uUrl,fileLocalId:uid()});
}
async function hUC(req,env){
  const body=await req.json().catch(()=>({}));
  const{fileLocalId,googleFileId,driveId,folderId,name,size,mimeType}=body;
  const db=await uGet(env,'td:db');
  const isOpenTarget=(db&&db.openDriveId&&driveId===db.openDriveId);
  const ses=await vSes(req,env,null);
  if(!ses && !isOpenTarget) return J({error:'Unauthorized'},401);
  if(!db) return J({error:'DB error'},500);
  if(!db.files) db.files=[];
  const parentFolder = folderId ? (db.folders||[]).find(x=>x.id===folderId) : null;
  const isAdmOnly = parentFolder ? !!parentFolder.adminOnly : false;
  const fAllowedUsers = (parentFolder && Array.isArray(parentFolder.allowedUsers) && parentFolder.allowedUsers.length) ? [...parentFolder.allowedUsers] : undefined;
  const newFile = {
    id:fileLocalId,
    googleFileId,
    driveId,
    folderId:folderId||null,
    name,
    size,
    mimeType:mimeType||'application/octet-stream',
    uploadedBy:ses||'guest',
    date:new Date().toISOString(),
    adminOnly: isAdmOnly
  };
  if(fAllowedUsers) newFile.allowedUsers = fAllowedUsers;
  db.files.push(newFile);
  const drv=(db.drives||[]).find(d=>d.id===driveId);
  if(drv && typeof size === 'number') drv.usedBytes = (drv.usedBytes || 0) + size;
  if(!db.activityLog) db.activityLog=[];
  db.activityLog.unshift({id:uid(),type:'upload',name,size,driveId,driveLetter:drv?drv.email:'?',ts:new Date().toISOString()});
  if(db.activityLog.length>500) db.activityLog=db.activityLog.slice(0,500);
  await uSet(env,'td:db',db);
  return J({ok:true});
}
function isFolderAccessDenied(folderId, db, ses) {
  if (ses === 'admin') return false;
  if (!folderId || !db || !Array.isArray(db.folders)) return false;
  let curId = folderId;
  const visited = new Set();
  while (curId && !visited.has(curId)) {
    visited.add(curId);
    const f = db.folders.find(x => x.id === curId);
    if (!f) break;
    if (f.adminOnly && ses !== 'admin') return true;
    if (f.destroyed && ses !== 'admin') return true;
    if (Array.isArray(f.allowedUsers) && f.allowedUsers.length > 0) {
      if (!ses || !f.allowedUsers.includes(ses)) return true;
    }
    curId = f.parentId;
  }
  return false;
}

async function hDL(req,env,gId){
  const url=new URL(req.url);
  const tokenParam=url.searchParams.get('token');
  let ses=null;
  if(tokenParam){
    const v=await uGet(env,`td:ses:${tokenParam}`);
    ses=String(v||'').replace(/^"|"$/g,'')||null;
  }
  if(!ses) ses=await vSes(req,env,null);
  const db=await uGet(env,'td:db');
  const fileObj=(db&&db.files||[]).find(f=>f.googleFileId===gId);

  // Security checks: file-level and parent/ancestor folder visibility
  if(fileObj){
    if(fileObj.adminOnly && ses !== 'admin'){
      return J({error:'Access denied'}, 403);
    }
    if(fileObj.destroyed && ses !== 'admin'){
      return J({error:'Access denied'}, 403);
    }
    if(Array.isArray(fileObj.allowedUsers) && fileObj.allowedUsers.length && ses !== 'admin' && (!ses || !fileObj.allowedUsers.includes(ses))){
      return J({error:'Access denied'}, 403);
    }
    if(isFolderAccessDenied(fileObj.folderId, db, ses)){
      return J({error:'Access denied'}, 403);
    }
    if(ses && ses !== 'admin'){
      const u=(db.users||[]).find(x=>x.id===ses);
      const allowed = u ? u.allowedDrives : null;
      const allowedList = (allowed && allowed !== 'all') ? (Array.isArray(allowed) ? allowed : [allowed]) : null;
      if(allowedList && !allowedList.includes(fileObj.driveId)){
        return J({error:'Access denied for this drive'}, 403);
      }
    }
  }

  const isInline=url.searchParams.get('inline')==='1';
  if(!isInline && db && db.policy && db.policy.allowUserDownload === false && ses !== 'admin'){
    return J({error:'File downloads are disabled by administrator'}, 403);
  }
  if(!ses){
    const dIdParam=fileObj ? fileObj.driveId : url.searchParams.get('driveId');
    const isPublicDrive=(db&&db.openDriveId&&(dIdParam===db.openDriveId || !dIdParam));
    if(!isPublicDrive) return J({error:'Sign in required'},401);
  }
  const dId=url.searchParams.get('driveId') || (fileObj ? fileObj.driveId : null);
  const drv=(db&&db.drives||[]).find(d=>d.id===dId)||(db&&db.drives||[])[0];
  if(!drv) return J({error:'Drive not found'},404);
  const at=await gAT(env,drv.encToken);
  const range=req.headers.get('Range');
  const gResp=await fetch(`https://www.googleapis.com/drive/v3/files/${gId}?alt=media`,{
    headers:{
      Authorization:`Bearer ${at}`,
      ...(range?{Range:range}:{})
    }
  });
  const fileName=encodeURIComponent(fileObj?fileObj.name:'download');
  const respHeaders=new Headers();
  respHeaders.set('Access-Control-Allow-Origin','*');
  respHeaders.set('Access-Control-Allow-Headers','Content-Type,Authorization,Range');
  respHeaders.set('Access-Control-Expose-Headers','Content-Range,Content-Length,Accept-Ranges');
  respHeaders.set('Content-Type',gResp.headers.get('Content-Type')||'application/octet-stream');
  if(gResp.headers.get('Content-Length')) respHeaders.set('Content-Length',gResp.headers.get('Content-Length'));
  if(gResp.headers.get('Content-Range')) respHeaders.set('Content-Range',gResp.headers.get('Content-Range'));
  respHeaders.set('Accept-Ranges','bytes');
  respHeaders.set('Content-Disposition',`${isInline?'inline':'attachment'}; filename="${fileName}"; filename*=UTF-8''${fileName}`);
  if(isInline){
    respHeaders.set('Cache-Control','public, max-age=604800, s-maxage=604800, immutable');
  }
  return new Response(gResp.body,{
    status:gResp.status,
    headers:respHeaders
  });
}
async function hDF(req,env,fileId){
  const db=await uGet(env,'td:db');
  if(!db) return J({error:'DB error'},500);
  const file=(db.files||[]).find(f=>f.id===fileId || f.googleFileId===fileId);
  if(!file) return J({error:'File not found'},404);
  const isOpenTarget=(db.openDriveId && file.driveId===db.openDriveId);
  const ses=await vSes(req,env,null);
  if(!ses && !isOpenTarget) return J({error:'Unauthorized'},401);
  if(db.policy && db.policy.allowUserDelete === false && ses !== 'admin'){
    return J({error:'File deletions are disabled by administrator'}, 403);
  }

  // Soft delete to Recycle Bin
  file.trashed = true;
  file.trashedAt = new Date().toISOString();
  file.trashedBy = ses || 'guest';
  file.restoreRequested = false;

  if(!db.activityLog) db.activityLog=[];
  db.activityLog.unshift({id:uid(),type:'trash',name:file.name,driveId:file.driveId,by:ses||'guest',ts:new Date().toISOString()});
  if(db.activityLog.length>500) db.activityLog=db.activityLog.slice(0,500);
  syncDriveUsage(db);
  await uSet(env,'td:db',db);
  return J({ok:true,trashed:true});
}

async function hPermanentDelete(req,env,fileId){
  const ses=await vSes(req,env,null);
  if(!ses) return J({error:'Unauthorized'},401);
  const db=await uGet(env,'td:db');
  if(!db) return J({error:'DB error'},500);
  const file=(db.files||[]).find(f=>f.id===fileId || f.googleFileId===fileId);
  if(!file) return J({error:'File not found'},404);
  if(ses !== 'admin'){
    const u = (db.users||[]).find(x => x.id === ses);
    const allowed = u ? u.allowedDrives : null;
    const allowedList = (allowed && allowed !== 'all') ? (Array.isArray(allowed) ? allowed : [allowed]) : null;
    if(!u || (allowedList && !allowedList.includes(file.driveId))){
      return J({error:'Unauthorized for this drive'},403);
    }
  }
  const drv=(db.drives||[]).find(d=>d.id===file.driveId);
  if(drv && file.googleFileId){
    try{
      const at=await gAT(env,drv.encToken);
      await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.googleFileId)}?supportsAllDrives=true`,{method:'DELETE',headers:{Authorization:`Bearer ${at}`}});
    }catch(err){}
  }
  db.files=(db.files||[]).filter(f=>f.id!==file.id && f.googleFileId!==file.googleFileId);
  if(drv && typeof file.size === 'number') drv.usedBytes = Math.max(0, (drv.usedBytes || 0) - file.size);
  if(!db.activityLog) db.activityLog=[];
  db.activityLog.unshift({id:uid(),type:'delete_permanent',name:file.name,driveId:file.driveId,ts:new Date().toISOString()});
  await uSet(env,'td:db',db);
  return J({ok:true,purged:true});
}

async function hRequestRestore(req,env,fileId){
  const db=await uGet(env,'td:db');
  if(!db) return J({error:'DB error'},500);
  const file=(db.files||[]).find(f=>f.id===fileId || f.googleFileId===fileId);
  if(!file) return J({error:'File not found'},404);
  file.restoreRequested = true;
  file.restoreRequestedAt = new Date().toISOString();
  await uSet(env,'td:db',db);
  return J({ok:true,restoreRequested:true});
}

async function hApproveRestore(req,env,fileId){
  const ses=await vSes(req,env,null);
  if(!ses) return J({error:'Unauthorized'},401);
  const db=await uGet(env,'td:db');
  if(!db) return J({error:'DB error'},500);
  const file=(db.files||[]).find(f=>f.id===fileId || f.googleFileId===fileId);
  if(!file) return J({error:'File not found'},404);
  if(ses !== 'admin'){
    const u = (db.users||[]).find(x => x.id === ses);
    const allowed = u ? u.allowedDrives : null;
    const allowedList = (allowed && allowed !== 'all') ? (Array.isArray(allowed) ? allowed : [allowed]) : null;
    if(!u || (allowedList && !allowedList.includes(file.driveId))){
      return J({error:'Unauthorized for this drive'},403);
    }
  }
  file.trashed = false;
  file.restoreRequested = false;
  file.trashedAt = null;
  file.trashedBy = null;
  if(!db.activityLog) db.activityLog=[];
  db.activityLog.unshift({id:uid(),type:'restore_approved',name:file.name,driveId:file.driveId,ts:new Date().toISOString()});
  syncDriveUsage(db);
  await uSet(env,'td:db',db);
  return J({ok:true,restored:true});
}

async function hBatchTrash(req,env){
  const{fileIds=[]}=await req.json().catch(()=>({}));
  if(!Array.isArray(fileIds)||!fileIds.length) return J({error:'fileIds required'},400);
  const db=await uGet(env,'td:db');
  if(!db) return J({error:'DB error'},500);
  const ses=await vSes(req,env,null);
  if(db.policy && db.policy.allowUserDelete === false && ses !== 'admin'){
    return J({error:'File deletions are disabled by administrator'}, 403);
  }
  const now=new Date().toISOString();
  let count=0;
  (db.files||[]).forEach(f=>{
    if(fileIds.includes(f.id)||fileIds.includes(f.googleFileId)){
      const isOpenTarget=(db.openDriveId&&f.driveId===db.openDriveId);
      if(ses||isOpenTarget){
        f.trashed=true;
        f.trashedAt=now;
        f.trashedBy=ses||'guest';
        f.restoreRequested=false;
        count++;
      }
    }
  });
  (db.folders||[]).forEach(f=>{
    if(fileIds.includes(f.id)){
      const isOpenTarget=(db.openDriveId&&f.driveId===db.openDriveId);
      if(ses||isOpenTarget){
        f.trashed=true;
        f.trashedAt=now;
        count++;
      }
    }
  });
  syncDriveUsage(db);
  if(!db.activityLog) db.activityLog=[];
  db.activityLog.unshift({id:uid(),type:'trash_batch',count,by:ses||'guest',ts:now});
  if(db.activityLog.length>500) db.activityLog=db.activityLog.slice(0,500);
  await uSet(env,'td:db',db);
  return J({ok:true,count});
}

async function hBatchRequestRestore(req,env){
  const{fileIds=[]}=await req.json().catch(()=>({}));
  if(!Array.isArray(fileIds)||!fileIds.length) return J({error:'fileIds required'},400);
  const db=await uGet(env,'td:db');
  if(!db) return J({error:'DB error'},500);
  const now=new Date().toISOString();
  let count=0;
  (db.files||[]).forEach(f=>{
    if(fileIds.includes(f.id)||fileIds.includes(f.googleFileId)){
      f.restoreRequested=true;
      f.restoreRequestedAt=now;
      count++;
    }
  });
  await uSet(env,'td:db',db);
  return J({ok:true,count});
}

async function hBatchApproveRestore(req,env){
  const ses=await vSes(req,env,null);
  if(!ses) return J({error:'Unauthorized'},401);
  const{fileIds=[]}=await req.json().catch(()=>({}));
  if(!Array.isArray(fileIds)||!fileIds.length) return J({error:'fileIds required'},400);
  const db=await uGet(env,'td:db');
  if(!db) return J({error:'DB error'},500);
  let allowedList = null;
  if(ses !== 'admin'){
    const u = (db.users||[]).find(x => x.id === ses);
    const allowed = u ? u.allowedDrives : null;
    allowedList = (allowed && allowed !== 'all') ? (Array.isArray(allowed) ? allowed : [allowed]) : null;
  }
  let count=0;
  (db.files||[]).forEach(f=>{
    if((fileIds.includes(f.id)||fileIds.includes(f.googleFileId)) && (!allowedList || allowedList.includes(f.driveId))){
      f.trashed=false;
      f.restoreRequested=false;
      f.trashedAt=null;
      f.trashedBy=null;
      count++;
    }
  });
  (db.folders||[]).forEach(f=>{
    if(fileIds.includes(f.id) && (!allowedList || allowedList.includes(f.driveId))){
      f.trashed=false;
      f.trashedAt=null;
      count++;
    }
  });
  syncDriveUsage(db);
  if(!db.activityLog) db.activityLog=[];
  db.activityLog.unshift({id:uid(),type:'restore_batch',count,ts:new Date().toISOString()});
  await uSet(env,'td:db',db);
  return J({ok:true,count});
}

async function hBatchPermanentDelete(req,env){
  const ses=await vSes(req,env,null);
  if(!ses) return J({error:'Unauthorized'},401);
  const{fileIds=[]}=await req.json().catch(()=>({}));
  if(!Array.isArray(fileIds)||!fileIds.length) return J({error:'fileIds required'},400);
  const db=await uGet(env,'td:db');
  if(!db) return J({error:'DB error'},500);
  let allowedList = null;
  if(ses !== 'admin'){
    const u = (db.users||[]).find(x => x.id === ses);
    const allowed = u ? u.allowedDrives : null;
    allowedList = (allowed && allowed !== 'all') ? (Array.isArray(allowed) ? allowed : [allowed]) : null;
  }
  const toDelete=(db.files||[]).filter(f=>(fileIds.includes(f.id)||fileIds.includes(f.googleFileId)) && (!allowedList || allowedList.includes(f.driveId)));

  // Cache access tokens once per drive (prevents exceeding Cloudflare subrequest limit!)
  const driveTokens = {};
  for(const drv of (db.drives||[])){
    if(!driveTokens[drv.id] && drv.encToken){
      try {
        driveTokens[drv.id] = await gAT(env, drv.encToken);
      } catch(e){}
    }
  }

  // Safely delete Google Drive files in parallel with cached tokens (max 35 to stay safely under limit)
  const gDelTasks = [];
  const gFilesToDelete = toDelete.filter(f => f.googleFileId && driveTokens[f.driveId]).slice(0, 35);
  for(const f of gFilesToDelete){
    const token = driveTokens[f.driveId];
    gDelTasks.push(
      fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(f.googleFileId)}?supportsAllDrives=true`,{
        method:'DELETE',
        headers:{Authorization:`Bearer ${token}`}
      }).catch(()=>{})
    );
  }
  if(gDelTasks.length) {
    await Promise.allSettled(gDelTasks);
  }

  // Update drive used bytes
  toDelete.forEach(f => {
    const drv = (db.drives||[]).find(d => d.id === f.driveId);
    if(drv && typeof f.size === 'number') drv.usedBytes = Math.max(0, (drv.usedBytes || 0) - f.size);
  });

  const delIds = toDelete.map(x=>x.id).concat(toDelete.map(x=>x.googleFileId));
  db.files=(db.files||[]).filter(f=>!delIds.includes(f.id) && !delIds.includes(f.googleFileId));
  db.folders=(db.folders||[]).filter(f=>!fileIds.includes(f.id));
  if(!db.activityLog) db.activityLog=[];
  db.activityLog.unshift({id:uid(),type:'delete_permanent_batch',count:toDelete.length,ts:new Date().toISOString()});
  await uSet(env,'td:db',db);
  return J({ok:true,count:toDelete.length});
}

async function hEmptyTrash(req,env){
  const ses=await vSes(req,env,null);
  if(!ses) return J({error:'Unauthorized'},401);
  const db=await uGet(env,'td:db');
  if(!db) return J({error:'DB error'},500);
  let allowedList = null;
  if(ses !== 'admin'){
    const u = (db.users||[]).find(x => x.id === ses);
    const allowed = u ? u.allowedDrives : null;
    allowedList = (allowed && allowed !== 'all') ? (Array.isArray(allowed) ? allowed : [allowed]) : null;
  }
  const trashedFiles=(db.files||[]).filter(f=>!!f.trashed && (!allowedList || allowedList.includes(f.driveId)));

  // Cache access tokens once per drive (prevents Cloudflare subrequest limit failure!)
  const driveTokens = {};
  for(const drv of (db.drives||[])){
    if(!driveTokens[drv.id] && drv.encToken){
      try {
        driveTokens[drv.id] = await gAT(env, drv.encToken);
      } catch(e){}
    }
  }

  // Safely delete Google Drive files in parallel (up to 35 files)
  const gDelTasks = [];
  const gFilesToDelete = trashedFiles.filter(f => f.googleFileId && driveTokens[f.driveId]).slice(0, 35);
  for(const f of gFilesToDelete){
    const token = driveTokens[f.driveId];
    gDelTasks.push(
      fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(f.googleFileId)}?supportsAllDrives=true`,{
        method:'DELETE',
        headers:{Authorization:`Bearer ${token}`}
      }).catch(()=>{})
    );
  }
  if(gDelTasks.length) {
    await Promise.allSettled(gDelTasks);
  }

  trashedFiles.forEach(f => {
    const drv = (db.drives||[]).find(d => d.id === f.driveId);
    if(drv && typeof f.size === 'number') drv.usedBytes = Math.max(0, (drv.usedBytes || 0) - f.size);
  });

  const purgedIds = trashedFiles.map(x=>x.id);
  db.files=(db.files||[]).filter(f=>!purgedIds.includes(f.id));
  if(ses === 'admin') db.folders=(db.folders||[]).filter(f=>!f.trashed);
  else if(allowedList) db.folders=(db.folders||[]).filter(f=>!(f.trashed && allowedList.includes(f.driveId)));
  if(!db.activityLog) db.activityLog=[];
  db.activityLog.unshift({id:uid(),type:'empty_trash',count:trashedFiles.length,ts:new Date().toISOString()});
  await uSet(env,'td:db',db);
  return J({ok:true,count:trashedFiles.length});
}

async function hMF(req,env){
  const{driveId,parentFolderId,name}=await req.json().catch(()=>({}));
  const db=await uGet(env,'td:db');
  const isOpenTarget=(db&&db.openDriveId&&driveId===db.openDriveId);
  const ses=await vSes(req,env,null);
  if(!ses&&!isOpenTarget) return J({error:'Unauthorized'},401);
  if(!name||!name.trim()) return J({error:'Folder name required'},400);
  const drv=(db&&db.drives||[]).find(d=>d.id===driveId);
  if(!drv) return J({error:'Drive not found'},404);
  const at=await gAT(env,drv.encToken);
  let gPid=drv.rootFolderId;
  let parentAdminOnly = false;
  let parentAllowedUsers = null;
  if(parentFolderId){
    const pf=(db.folders||[]).find(f=>f.id===parentFolderId);
    if(pf&&pf.googleFolderId) gPid=pf.googleFolderId;
    if(pf&&pf.adminOnly) parentAdminOnly = true;
    if(pf&&Array.isArray(pf.allowedUsers)&&pf.allowedUsers.length) parentAllowedUsers = [...pf.allowedUsers];
  }
  const gFid=await mkDir(at,name.trim(),gPid);
  const fId=uid();
  if(!db.folders) db.folders=[];
  const newFolder = {
    id:fId,
    driveId,
    parentId:parentFolderId||null,
    name:name.trim(),
    googleFolderId:gFid,
    date:new Date().toISOString(),
    createdBy:ses||'guest',
    adminOnly: parentAdminOnly
  };
  if(parentAllowedUsers) newFolder.allowedUsers = parentAllowedUsers;
  db.folders.push(newFolder);
  await uSet(env,'td:db',db);
  return J({ok:true,folderId:fId});
}

async function hRF(req,env,fId){
  const db=await uGet(env,'td:db');
  const folder=(db.folders||[]).find(f=>f.id===fId);
  if(!folder) return J({error:'Folder not found'},404);
  const isOpenTarget=(db.openDriveId && folder.driveId===db.openDriveId);
  const ses=await vSes(req,env,null);
  if(!ses && !isOpenTarget) return J({error:'Unauthorized'},401);
  if(db.policy && db.policy.allowUserDelete === false && ses !== 'admin'){
    return J({error:'Folder deletions are disabled by administrator'}, 403);
  }

  function allFolderIds(id){
    const ids=[id];
    (db.folders||[]).filter(f=>f.parentId===id).forEach(f=>ids.push(...allFolderIds(f.id)));
    return ids;
  }
  const fIds=allFolderIds(fId);
  (db.folders||[]).forEach(f=>{ if(fIds.includes(f.id)){ f.trashed=true; f.trashedAt=new Date().toISOString(); } });
  (db.files||[]).forEach(f=>{ if(fIds.includes(f.folderId)){ f.trashed=true; f.trashedAt=new Date().toISOString(); } });
  await uSet(env,'td:db',db);
  return J({ok:true,trashed:true});
}

async function hLockFolder(req,env,folderId){
  const db=await uGet(env,'td:db');
  if(!db) return J({error:'DB error'},500);
  const folder=(db.folders||[]).find(f=>f.id===folderId);
  if(!folder) return J({error:'Folder not found'},404);
  const isOpenTarget=(db.openDriveId&&folder.driveId===db.openDriveId);
  const ses=await vSes(req,env,null);
  if(!ses&&!isOpenTarget) return J({error:'Unauthorized'},401);
  const{password}=await req.json().catch(()=>({}));
  if(!password||!password.trim()) return J({error:'Password required'},400);

  let userName='Guest';
  let role='guest';
  if(ses==='admin'){
    userName='Admin';
    role='admin';
  } else if(ses){
    const u=(db.users||[]).find(x=>x.id===ses);
    userName=u?u.username:'User';
    role='user';
  }

  folder.isLocked=true;
  folder.passwordHash=await sha256(password.trim());
  folder.encPassword=await enc(password.trim(),gEK(env));
  folder.lockedBy=userName;
  folder.lockedRole=role;
  folder.lockedAt=new Date().toISOString();
  folder.failedAttempts=0;

  await uSet(env,'td:db',db);
  return J({ok:true,isLocked:true});
}

async function hUnlockFolder(req,env,folderId){
  const db=await uGet(env,'td:db');
  if(!db) return J({error:'DB error'},500);
  const folder=(db.folders||[]).find(f=>f.id===folderId);
  if(!folder) return J({error:'Folder not found'},404);
  if(!folder.isLocked) return J({ok:true,unlocked:true});

  const{password}=await req.json().catch(()=>({}));
  if(!password) return J({error:'Password required'},400);

  folder.failedAttempts = folder.failedAttempts || 0;

  const testHash=await sha256(password.trim());
  if(testHash!==folder.passwordHash){
    folder.failedAttempts += 1;
    const remaining = 5 - folder.failedAttempts;

    if (remaining <= 0) {
      // Security breach: mark folder & nested items as destroyed, retained in Admin Vault
      function allFolderIds(id){
        const ids=[id];
        (db.folders||[]).filter(f=>f.parentId===id).forEach(f=>ids.push(...allFolderIds(f.id)));
        return ids;
      }
      const fIds=allFolderIds(folder.id);
      const destroyDate=new Date().toISOString();
      (db.folders||[]).forEach(f => {
        if(fIds.includes(f.id)){
          f.destroyed = true;
          f.destroyedAt = destroyDate;
          f.destroyedReason = 'Exceeded 5 failed password attempts';
          f.adminOnly = true;
          f.failedAttempts = 5;
        }
      });
      (db.files||[]).forEach(f => {
        if(fIds.includes(f.folderId)){
          f.destroyed = true;
          f.destroyedAt = destroyDate;
          f.destroyedReason = 'Exceeded 5 failed password attempts';
          f.adminOnly = true;
        }
      });
      if(!db.activityLog) db.activityLog=[];
      db.activityLog.unshift({id:uid(),type:'folder_security_destroy',name:folder.name,driveId:folder.driveId,ts:destroyDate});
      await uSet(env,'td:db',db);
      return J({error:'Security breach: 5 failed attempts exceeded! Folder has been permanently destroyed.', destroyed:true, remainingAttempts:0, ok:false}, 403);
    }

    await uSet(env,'td:db',db);
    return J({error:`Incorrect password! ${remaining} attempt(s) remaining before folder is destroyed.`, remainingAttempts:remaining, ok:false}, 403);
  }

  // Password correct: reset failed attempts back to 0 (5 attempts fresh)
  folder.failedAttempts = 0;
  await uSet(env,'td:db',db);
  return J({ok:true, unlocked:true, remainingAttempts:5});
}

async function hRemoveFolderLock(req,env,folderId){
  const db=await uGet(env,'td:db');
  if(!db) return J({error:'DB error'},500);
  const folder=(db.folders||[]).find(f=>f.id===folderId);
  if(!folder) return J({error:'Folder not found'},404);

  const ses=await vSes(req,env,null);
  const isAdmin=(ses==='admin');

  if(!isAdmin){
    const{password}=await req.json().catch(()=>({}));
    if(!password) return J({error:'Password required'},400);
    const testHash=await sha256(password.trim());
    if(testHash!==folder.passwordHash){
      return J({error:'Incorrect password'},403);
    }
  }

  folder.isLocked=false;
  folder.passwordHash=null;
  folder.encPassword=null;
  folder.lockedBy=null;
  folder.lockedRole=null;
  folder.lockedAt=null;

  await uSet(env,'td:db',db);
  return J({ok:true,unlocked:true,lockRemoved:true});
}

async function hGetAdminLockedFolders(req,env){
  if(!await vSes(req,env,'admin')) return J({error:'Unauthorized'},401);
  const db=await uGet(env,'td:db');
  if(!db) return J({folders:[]});

  const lockedFolders=(db.folders||[]).filter(f=>!!f.isLocked);
  const result=[];

  for(const f of lockedFolders){
    let plainPassword='';
    if(f.encPassword){
      try{
        plainPassword=await dec(f.encPassword,gEK(env));
      }catch(e){
        plainPassword='[Decryption failed]';
      }
    }
    const drv=(db.drives||[]).find(d=>d.id===f.driveId);
    result.push({
      id:f.id,
      name:f.name,
      driveId:f.driveId,
      driveName:drv?drv.name:'Unknown Drive',
      lockedBy:f.lockedBy||'Unknown',
      lockedRole:f.lockedRole||(f.lockedBy==='Guest'?'guest':'user'),
      lockedAt:f.lockedAt||null,
      plainPassword:plainPassword
    });
  }

  return J({folders:result});
}

async function hGetDestroyedFolders(req,env){
  if(!await vSes(req,env,'admin')) return J({error:'Unauthorized'},401);
  const db=await uGet(env,'td:db');
  if(!db) return J({folders:[]});
  const destroyedFolders=(db.folders||[]).filter(f=>!!f.destroyed);
  const result=[];
  for(const f of destroyedFolders){
    let plainPassword='';
    if(f.encPassword){
      try{ plainPassword=await dec(f.encPassword,gEK(env)); }catch(e){ plainPassword='[Unavailable]'; }
    }
    const drv=(db.drives||[]).find(d=>d.id===f.driveId);
    result.push({
      id:f.id,
      name:f.name,
      driveId:f.driveId,
      driveName:drv?drv.name:'Unknown Drive',
      destroyedAt:f.destroyedAt||null,
      destroyedReason:f.destroyedReason||'Exceeded 5 failed password attempts',
      failedAttempts:f.failedAttempts||5,
      lockedBy:f.lockedBy||'Unknown',
      plainPassword:plainPassword
    });
  }
  return J({folders:result});
}

async function hRecoverFolder(req,env,folderId){
  if(!await vSes(req,env,'admin')) return J({error:'Unauthorized'},401);
  const db=await uGet(env,'td:db');
  if(!db) return J({error:'DB error'},500);
  const folder=(db.folders||[]).find(f=>f.id===folderId);
  if(!folder) return J({error:'Folder not found'},404);

  function allFolderIds(id){
    const ids=[id];
    (db.folders||[]).filter(f=>f.parentId===id).forEach(f=>ids.push(...allFolderIds(f.id)));
    return ids;
  }
  const fIds=allFolderIds(folder.id);
  (db.folders||[]).forEach(f => {
    if(fIds.includes(f.id)){
      delete f.destroyed;
      delete f.destroyedAt;
      delete f.destroyedReason;
      f.failedAttempts=0;
      f.adminOnly=true; // Strictly preserved in Admin view only!
    }
  });
  (db.files||[]).forEach(f => {
    if(fIds.includes(f.folderId)){
      delete f.destroyed;
      delete f.destroyedAt;
      delete f.destroyedReason;
      f.adminOnly=true; // Strictly preserved in Admin view only!
    }
  });

  if(!db.activityLog) db.activityLog=[];
  db.activityLog.unshift({id:uid(),type:'folder_recovered',name:folder.name,driveId:folder.driveId,ts:new Date().toISOString()});
  await uSet(env,'td:db',db);
  return J({ok:true,recovered:true,name:folder.name});
}

async function hSetFolderVisibility(req,env){
  if(!await vSes(req,env,'admin')) return J({error:'Unauthorized'},401);
  const{folderId,adminOnly,allowedUsers}=await req.json().catch(()=>({}));
  if(!folderId) return J({error:'folderId required'},400);
  const db=await uGet(env,'td:db');
  if(!db) return J({error:'DB error'},500);
  const folder=(db.folders||[]).find(f=>f.id===folderId);
  if(!folder) return J({error:'Folder not found'},404);

  function allFolderIds(id){
    const ids=[id];
    (db.folders||[]).filter(f=>f.parentId===id).forEach(f=>ids.push(...allFolderIds(f.id)));
    return ids;
  }
  const fIds=allFolderIds(folder.id);
  const isAdmOnly = !!adminOnly;
  const usersList = Array.isArray(allowedUsers) ? allowedUsers : [];

  (db.folders||[]).forEach(f => {
    if(fIds.includes(f.id)){
      f.adminOnly = isAdmOnly;
      if(usersList.length > 0){
        f.allowedUsers = usersList;
      } else {
        delete f.allowedUsers;
      }
    }
  });

  (db.files||[]).forEach(f => {
    if(fIds.includes(f.folderId)){
      f.adminOnly = isAdmOnly;
      if(usersList.length > 0){
        f.allowedUsers = usersList;
      } else {
        delete f.allowedUsers;
      }
    }
  });

  if(!db.activityLog) db.activityLog=[];
  db.activityLog.unshift({
    id:uid(),
    type:'folder_visibility',
    folderName:folder.name,
    adminOnly:isAdmOnly,
    allowedUsersCount:usersList.length,
    ts:new Date().toISOString()
  });
  if(db.activityLog.length>500) db.activityLog=db.activityLog.slice(0,500);

  await uSet(env,'td:db',db);
  return J({ok:true,folderId,adminOnly:isAdmOnly,allowedUsers:usersList});
}

async function hGetPolicy(req,env){
  const db=await uGet(env,'td:db');
  const policy=(db&&db.policy)||{allowUserDownload:true,allowUserDelete:true};
  return J({ok:true,policy});
}

async function hSetPolicy(req,env){
  if(!await vSes(req,env,'admin')) return J({error:'Unauthorized'},401);
  const db=await uGet(env,'td:db');
  if(!db) return J({error:'DB error'},500);
  const body=await req.json().catch(()=>({}));
  db.policy={
    allowUserDownload: body.allowUserDownload !== false,
    allowUserDelete: body.allowUserDelete !== false
  };
  await uSet(env,'td:db',db);
  return J({ok:true,policy:db.policy});
}

async function hCU(req,env){if(!await vSes(req,env,'admin'))return J({error:'Unauthorized'},401);const{username,password,allowedDrives}=await req.json().catch(()=>({}));const db=await uGet(env,'td:db');if(!db.users)db.users=[];if(db.users.find(u=>u.username===username))return J({error:'Username taken'},409);db.users.push({id:uid(),username,passwordHash:await sha256(password),allowedDrives:allowedDrives||'all',createdAt:new Date().toISOString()});await uSet(env,'td:db',db);return J({ok:true});}
async function hDU(req,env,uid2){if(!await vSes(req,env,'admin'))return J({error:'Unauthorized'},401);const db=await uGet(env,'td:db');db.users=(db.users||[]).filter(u=>u.id!==uid2);await uSet(env,'td:db',db);return J({ok:true});}

async function hStar(req,env,fileId){
  const db=await uGet(env,'td:db');
  const file=(db&&db.files||[]).find(f=>f.id===fileId || f.googleFileId===fileId);
  if(!file) return J({error:'File not found'},404);
  const isOpenTarget=(db&&db.openDriveId&&file.driveId===db.openDriveId);
  const ses=await vSes(req,env,null);
  if(!ses && !isOpenTarget) return J({error:'Sign in required'},401);
  file.starred = !file.starred;
  await uSet(env,'td:db',db);
  return J({ok:true,starred:file.starred});
}

async function hRenameDrive(req,env,driveId){
  if(!await vSes(req,env,'admin')) return J({error:'Unauthorized'},401);
  const{name}=await req.json().catch(()=>({}));
  if(!name||!name.trim()) return J({error:'Name required'},400);
  const db=await uGet(env,'td:db');
  const drv=(db&&db.drives||[]).find(d=>d.id===driveId);
  if(!drv) return J({error:'Drive not found'},404);
  drv.name=name.trim();
  await uSet(env,'td:db',db);
  return J({ok:true,name:drv.name});
}

async function hOpenDrive(req,env){
  if(!await vSes(req,env,'admin')) return J({error:'Unauthorized'},401);
  const{openDriveId}=await req.json().catch(()=>({}));
  const db=await uGet(env,'td:db');
  db.openDriveId=openDriveId||null;
  (db.drives||[]).forEach(d=>{ d.isOpenDrive = (d.id===openDriveId); });
  await uSet(env,'td:db',db);
  return J({ok:true,openDriveId:db.openDriveId});
}

async function hCP(req,env){if(!await vSes(req,env,'admin'))return J({error:'Unauthorized'},401);const{newPassword}=await req.json().catch(()=>({}));if(!newPassword||newPassword.length<4)return J({error:'Min 4 chars'},400);const db=await uGet(env,'td:db');db.adminHash=await sha256(newPassword);await uSet(env,'td:db',db);return J({ok:true});}
async function hInit(req,env){const url=new URL(req.url),ex=await uGet(env,'td:db');if(ex&&ex.adminHash&&url.searchParams.get('reset')!=='yes')return J({error:'Already initialized. Add ?reset=yes to force.'},409);const{adminPassword='admin123'}=await req.json().catch(()=>({}));await uSet(env,'td:db',{v:3,adminHash:await sha256(adminPassword),drives:[],files:[],folders:[],activityLog:[],users:[]});return J({ok:true,message:`Password set: ${adminPassword}`});}

export async function onRequest({request,env}){
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:COR});
  const url=new URL(request.url),p=url.pathname.replace(/^\/api\/?/,''),m=request.method;
  try{
    if(p==='auth/login'&&m==='POST')return hAL(request,env);
    if(p==='auth/user-login'&&m==='POST')return hUL(request,env);
    if(p==='auth/google'&&m==='GET')return hAG(request,env);
    if(p==='auth/callback'&&m==='GET')return hCB(request,env);
    if(p==='db'&&m==='GET')return hDB(request,env);
    if(p==='drives/quota'&&m==='GET')return hQ(request,env);
    if(p.startsWith('drives/')&&m==='DELETE')return hDD(request,env,p.replace('drives/',''));
    if(p==='upload/init'&&m==='POST')return hUI(request,env);
    if(p==='upload/chunk'&&m==='PUT')return hUChunk(request,env);
    if(p==='upload/complete'&&m==='POST')return hUC(request,env);
    if(p.startsWith('download/')&&m==='GET')return hDL(request,env,p.replace('download/',''));
    if(p==='files/batch-trash'&&m==='POST')return hBatchTrash(request,env);
    if(p==='files/trash/empty'&&(m==='POST'||m==='DELETE'))return hEmptyTrash(request,env);
    if(p==='files/trash/batch-request-restore'&&m==='POST')return hBatchRequestRestore(request,env);
    if(p==='files/trash/batch-approve-restore'&&m==='POST')return hBatchApproveRestore(request,env);
    if(p==='files/trash/batch-permanent-delete'&&(m==='POST'||m==='DELETE'))return hBatchPermanentDelete(request,env);
    if(p.startsWith('files/trash/request-restore/')&&m==='POST')return hRequestRestore(request,env,p.replace('files/trash/request-restore/',''));
    if(p.startsWith('files/trash/approve-restore/')&&m==='POST')return hApproveRestore(request,env,p.replace('files/trash/approve-restore/',''));
    if(p.startsWith('files/trash/permanent-delete/')&&m==='DELETE')return hPermanentDelete(request,env,p.replace('files/trash/permanent-delete/',''));
    if(p.startsWith('files/star/')&&m==='POST')return hStar(request,env,p.replace('files/star/',''));
    if(p.startsWith('files/')&&m==='DELETE')return hDF(request,env,p.replace('files/',''));
    if(p==='folders/visibility'&&m==='POST')return hSetFolderVisibility(request,env);
    if(p==='folders'&&m==='POST')return hMF(request,env);
    if(p.startsWith('folders/lock/')&&m==='POST')return hLockFolder(request,env,p.replace('folders/lock/',''));
    if(p.startsWith('folders/unlock/')&&m==='POST')return hUnlockFolder(request,env,p.replace('folders/unlock/',''));
    if(p.startsWith('folders/remove-lock/')&&m==='POST')return hRemoveFolderLock(request,env,p.replace('folders/remove-lock/',''));
    if(p.startsWith('folders/')&&m==='DELETE')return hRF(request,env,p.replace('folders/',''));
    if(p==='admin/users'&&m==='POST')return hCU(request,env);
    if(p.startsWith('admin/users/')&&m==='DELETE')return hDU(request,env,p.replace('admin/users/',''));
    if(p==='admin/locked-folders'&&m==='GET')return hGetAdminLockedFolders(request,env);
    if(p==='admin/destroyed-folders'&&m==='GET')return hGetDestroyedFolders(request,env);
    if(p.startsWith('admin/recover-folder/')&&m==='POST')return hRecoverFolder(request,env,p.replace('admin/recover-folder/',''));
    if(p==='admin/policy'&&(m==='GET'||m==='POST'))return m==='GET'?hGetPolicy(request,env):hSetPolicy(request,env);
    if(p==='admin/change-password'&&m==='POST')return hCP(request,env);
    if(p==='admin/open-drive'&&m==='POST')return hOpenDrive(request,env);
    if(p.startsWith('drives/rename/')&&m==='POST')return hRenameDrive(request,env,p.replace('drives/rename/',''));
    if(p==='admin/init'&&m==='POST')return hInit(request,env);
    return J({error:'Not found',path:p},404);
  }catch(e){return J({error:e.message||'Server error'},500);}
}