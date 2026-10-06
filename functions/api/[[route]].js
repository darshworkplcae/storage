// TeleDrive — Cloudflare Pages Function (all /api/* routes)
const UPS_URL='https://driven-yeti-165554.upstash.io';
const UPS_TOK='gQAAAAAAAoayAAIgcDFhMTkwMmY5ZTY0ODY0MDk2YWZmYjMzYjk5YWZkMjk1Nw';
const DEF_ENC='TeleDriveKey2026SecureDefaultXX';
function gUU(e){return e.UPSTASH_URL||UPS_URL;}
function gUT(e){return e.UPSTASH_TOKEN||UPS_TOK;}
function gEK(e){return e.ENCRYPTION_KEY||DEF_ENC;}
function gGC(e){return e.GOOGLE_CLIENT_ID||'';}
function gGS(e){return e.GOOGLE_CLIENT_SECRET||'';}
const COR={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,DELETE,PUT,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization'};
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
  if(!db||!db.drives)return;
  const active=(db.files||[]).filter(f=>!f.trashed);
  db.drives.forEach(d=>{
    const dFiles=active.filter(f=>f.driveId===d.id);
    d.usedBytes=dFiles.reduce((s,f)=>s+(f.size||0),0);
  });
}
async function hDB(req,env){
  const db=await uGet(env,'td:db');
  if(!db)return J(null);
  syncDriveUsage(db);
  const r=await vSes(req,env,null);
  if(r==='admin'){
    return J({
      ...db,
      drives:(db.drives||[]).map(d=>({...d,encToken:undefined})),
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
    const userFiles = (db.files||[]).filter(f => userDriveIds.includes(f.driveId));
    const userFolders = (db.folders||[]).filter(f => userDriveIds.includes(f.driveId));
    const userLogs = (db.activityLog||[]).filter(l => !l.driveId || userDriveIds.includes(l.driveId));
    return J({
      v: db.v,
      openDriveId: db.openDriveId,
      drives: userDrives,
      files: userFiles,
      folders: userFolders,
      activityLog: userLogs,
      users: u ? [{ id: u.id, username: u.username }] : []
    });
  }
  const openId = db.openDriveId;
  const guestDrives = openId ? (db.drives||[]).filter(d => d.id === openId).map(d=>({...d,encToken:undefined})) : (db.drives||[]).slice(0,1).map(d=>({...d,encToken:undefined}));
  const guestDriveIds = guestDrives.map(d => d.id);
  const guestFiles = (db.files||[]).filter(f => guestDriveIds.includes(f.driveId));
  const guestFolders = (db.folders||[]).filter(f => guestDriveIds.includes(f.driveId));
  return J({
    v: db.v,
    openDriveId: db.openDriveId,
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
  const res=await Promise.all(drivesToQuery.map(async d=>{try{const at=await gAT(env,d.encToken);const q=await gDQ(at);return{id:d.id,capacity:parseInt(q.storageQuota&&q.storageQuota.limit)||d.capacity,usedBytes:parseInt(q.storageQuota&&q.storageQuota.usage)||d.usedBytes};}catch(e){return{id:d.id,error:e.message};}}));
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
  db.files.push({id:fileLocalId,googleFileId,driveId,folderId:folderId||null,name,size,mimeType:mimeType||'application/octet-stream',uploadedBy:ses||'guest',date:new Date().toISOString()});
  syncDriveUsage(db);
  if(!db.activityLog) db.activityLog=[];
  const drv=(db.drives||[]).find(d=>d.id===driveId);
  db.activityLog.unshift({id:uid(),type:'upload',name,size,driveId,driveLetter:drv?drv.email:'?',ts:new Date().toISOString()});
  if(db.activityLog.length>500) db.activityLog=db.activityLog.slice(0,500);
  await uSet(env,'td:db',db);
  return J({ok:true});
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
    if(!ses){
    const dIdParam=url.searchParams.get('driveId');
    const dbCheck=await uGet(env,'td:db');
    const isPublicDrive=(dbCheck&&dbCheck.openDriveId&&(dIdParam===dbCheck.openDriveId || !dIdParam));
    if(!isPublicDrive) return J({error:'Sign in required'},401);
  }
  const dId=url.searchParams.get('driveId');
  const db=await uGet(env,'td:db');
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
  const fileObj=(db.files||[]).find(f=>f.googleFileId===gId);
  const fileName=encodeURIComponent(fileObj?fileObj.name:'download');
  const respHeaders=new Headers();
  respHeaders.set('Access-Control-Allow-Origin','*');
  respHeaders.set('Content-Type',gResp.headers.get('Content-Type')||'application/octet-stream');
  if(gResp.headers.get('Content-Length')) respHeaders.set('Content-Length',gResp.headers.get('Content-Length'));
  if(gResp.headers.get('Content-Range')) respHeaders.set('Content-Range',gResp.headers.get('Content-Range'));
  respHeaders.set('Accept-Ranges','bytes');
  const isInline=url.searchParams.get('inline')==='1';
  respHeaders.set('Content-Disposition',`${isInline?'inline':'attachment'}; filename="${fileName}"; filename*=UTF-8''${fileName}`);
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
  if(!db.activityLog) db.activityLog=[];
  db.activityLog.unshift({id:uid(),type:'delete_permanent',name:file.name,driveId:file.driveId,ts:new Date().toISOString()});
  syncDriveUsage(db);
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
  for(const f of toDelete){
    const drv=(db.drives||[]).find(d=>d.id===f.driveId);
    if(drv && f.googleFileId){
      try{
        const at=await gAT(env,drv.encToken);
        await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(f.googleFileId)}?supportsAllDrives=true`,{method:'DELETE',headers:{Authorization:`Bearer ${at}`}});
      }catch(e){}
    }
  }
  const delIds = toDelete.map(x=>x.id).concat(toDelete.map(x=>x.googleFileId));
  db.files=(db.files||[]).filter(f=>!delIds.includes(f.id) && !delIds.includes(f.googleFileId));
  db.folders=(db.folders||[]).filter(f=>!fileIds.includes(f.id));
  syncDriveUsage(db);
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
  for(const f of trashedFiles){
    const drv=(db.drives||[]).find(d=>d.id===f.driveId);
    if(drv && f.googleFileId){
      try{
        const at=await gAT(env,drv.encToken);
        await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(f.googleFileId)}?supportsAllDrives=true`,{method:'DELETE',headers:{Authorization:`Bearer ${at}`}});
      }catch(e){}
    }
  }
  const purgedIds = trashedFiles.map(x=>x.id);
  db.files=(db.files||[]).filter(f=>!purgedIds.includes(f.id));
  if(ses === 'admin') db.folders=(db.folders||[]).filter(f=>!f.trashed);
  else if(allowedList) db.folders=(db.folders||[]).filter(f=>!(f.trashed && allowedList.includes(f.driveId)));
  syncDriveUsage(db);
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
  if(parentFolderId){
    const pf=(db.folders||[]).find(f=>f.id===parentFolderId);
    if(pf&&pf.googleFolderId) gPid=pf.googleFolderId;
  }
  const gFid=await mkDir(at,name.trim(),gPid);
  const fId=uid();
  if(!db.folders) db.folders=[];
  db.folders.push({id:fId,driveId,parentId:parentFolderId||null,name:name.trim(),googleFolderId:gFid,date:new Date().toISOString(),createdBy:ses||'guest'});
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
    if(p==='folders'&&m==='POST')return hMF(request,env);
    if(p.startsWith('folders/')&&m==='DELETE')return hRF(request,env,p.replace('folders/',''));
    if(p==='admin/users'&&m==='POST')return hCU(request,env);
    if(p.startsWith('admin/users/')&&m==='DELETE')return hDU(request,env,p.replace('admin/users/',''));
    if(p==='admin/change-password'&&m==='POST')return hCP(request,env);
    if(p==='admin/open-drive'&&m==='POST')return hOpenDrive(request,env);
    if(p.startsWith('drives/rename/')&&m==='POST')return hRenameDrive(request,env,p.replace('drives/rename/',''));
    if(p==='admin/init'&&m==='POST')return hInit(request,env);
    return J({error:'Not found',path:p},404);
  }catch(e){return J({error:e.message||'Server error'},500);}
}