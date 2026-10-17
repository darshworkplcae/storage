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
let _memDBCache = null;
let _memDBCacheVer = 0; // write-version counter; incremented on every uSet('td:db')
let _lastGDriveCheck = 0;
let _lastGDriveSave = 0;
let _globalCtx = null;
let _gdriveDbFileId = '1io5JlFLOzrB2J8UoVIYjGVeRMh3jqNFn';
const _memSesCache = new Map();
const _memThumbCache = new Map();
function getKV(env){return env.TELEDRIVE_KV||env.KV||env.STORAGE||env.DB_KV||null;}

async function makeSignedToken(roleOrUserId, secret) {
  const ts = Date.now().toString(36);
  const data = `${roleOrUserId}.${ts}`;
  const sig = await sha256(`tdses:${data}:${secret}`);
  return `tds_${data}.${sig.slice(0, 32)}`;
}

async function verifySignedToken(token, secret) {
  if (!token || typeof token !== 'string' || !token.startsWith('tds_')) return null;
  const parts = token.slice(4).split('.');
  if (parts.length !== 3) return null;
  const [roleOrId, tsStr, sig] = parts;
  const ts = parseInt(tsStr, 36);
  if (isNaN(ts) || Date.now() - ts > 7 * 86400 * 1000) return null;
  const expectedSig = (await sha256(`tdses:${roleOrId}.${tsStr}:${secret}`)).slice(0, 32);
  if (sig === expectedSig) return roleOrId;
  return null;
}

async function makeDriveToken(driveId, secret) {
  const ts = Date.now().toString(36);
  const data = `${driveId}.${ts}`;
  const sig = await sha256(`tddtk:${data}:${secret}`);
  return `dtk_${data}.${sig.slice(0, 32)}`;
}

async function verifyDriveToken(token, driveId, secret) {
  if (!token || typeof token !== 'string' || !token.startsWith('dtk_')) return false;
  const parts = token.slice(4).split('.');
  if (parts.length !== 3) return false;
  const [tDriveId, tsStr, sig] = parts;
  if (tDriveId !== driveId) return false;
  const ts = parseInt(tsStr, 36);
  if (isNaN(ts) || Date.now() - ts > 30 * 86400 * 1000) return false;
  const expectedSig = (await sha256(`tddtk:${tDriveId}.${tsStr}:${secret}`)).slice(0, 32);
  return sig === expectedSig;
}

async function uGet(env,key){
  const kv=getKV(env);
  if(kv){
    try{
      const raw=await kv.get(key,'text');
      if(raw!==null&&raw!==undefined){
        try{
          let p = JSON.parse(raw);
          if (key==='td:db') {
            const kvVer = p._dbVer || 0;
            // Check edge cache for a newer version (in case KV put was blocked)
            try {
              const edgeCached = await caches.default.match('https://tobichan.pages.dev/api/__internal_db_cache__');
              if (edgeCached) {
                const edb = await edgeCached.json();
                if (edb && (edb._dbVer || 0) > kvVer) {
                  _memDBCache = edb;
                  _memDBCacheVer = edb._dbVer;
                  return edb;
                }
              }
            } catch(e) {}

            // If KV version is older than known GDrive durable backup version (31), load once from GDrive backup
            if (kvVer < 31 && p.drives && p.drives.length) {
              try {
                const gdb = await loadDBFromGDrive(env, p.drives[0]);
                if (gdb && (gdb._dbVer || 0) > kvVer) {
                  _memDBCache = gdb;
                  _memDBCacheVer = gdb._dbVer;
                  try {
                    caches.default.put('https://tobichan.pages.dev/api/__internal_db_cache__', new Response(JSON.stringify(gdb), {
                      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400, s-maxage=86400' }
                    })).catch(()=>{});
                  } catch(e) {}
                  return gdb;
                }
              } catch(e) {}
            }

            if (_memDBCache && _memDBCacheVer >= kvVer) {
              return _memDBCache;
            }
            _memDBCache = p;
            _memDBCacheVer = kvVer;
          }
          return p;
        }catch(e){return raw;}
      }
    }catch(e){console.error('KV get error:',e);}
    return (key==='td:db'&&_memDBCache) ? _memDBCache : null;
  }
  try{
    const r=await fetch(`${gUU(env)}/get/${encodeURIComponent(key)}`,{headers:{Authorization:`Bearer ${gUT(env)}`}});
    const d=await r.json().catch(()=>({}));
    if(d.error){
      if(String(d.error).includes('limit')||r.status===403){
        if(key==='td:db'&&_memDBCache) return _memDBCache;
        throw new Error('ERR_DB_SUSPENDED: '+d.error);
      }
      return (key==='td:db'&&_memDBCache) ? _memDBCache : null;
    }
    if(d.result===null||d.result===undefined) return (key==='td:db'&&_memDBCache) ? _memDBCache : null;
    if(typeof d.result!=='string'){
      if(key==='td:db') _memDBCache = d.result;
      return d.result;
    }
    try{
      const p = JSON.parse(d.result);
      if(key==='td:db') _memDBCache = p;
      return p;
    }catch(e){return d.result;}
  }catch(e){
    if(key==='td:db'&&_memDBCache) return _memDBCache;
    if(String(e.message).includes('ERR_DB_SUSPENDED'))throw e;
    return null;
  }
}
let _lastUSetStatus = 'none';
async function uSet(env,key,val,ttl){
  if(key==='td:db') {
    // Stamp a write-version so uGet can detect in-memory cache is newer than stale KV
    if(val && typeof val === 'object') {
      val._dbVer = Math.max((_memDBCacheVer || 0), (val._dbVer || 0)) + 1;
      _memDBCacheVer = val._dbVer;
    }
    _memDBCache = val;
    try {
      caches.default.put('https://tobichan.pages.dev/api/__internal_db_cache__', new Response(JSON.stringify(val), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400, s-maxage=86400' }
      })).catch(()=>{});
    } catch(e) {}
    // Persist to Google Drive in background — strictly throttled to at most once per 60s
    // to prevent saturating Cloudflare subrequests and memory during batch uploads
    const now = Date.now();
    if (now - _lastGDriveSave > 60000 && !_isGDriveSaving) {
      _lastGDriveSave = now;
      if (_globalCtx && typeof _globalCtx.waitUntil === 'function') {
        _globalCtx.waitUntil(saveDBToGDrive(env, val));
      } else {
        saveDBToGDrive(env, val).catch(() => {});
      }
    }
  }
  const kv=getKV(env);
  if(kv){
    try{
      const opts=(ttl&&ttl>=60)?{expirationTtl:ttl}:undefined;
      await kv.put(key,typeof val==='string'?val:JSON.stringify(val),opts);
      _lastUSetStatus = 'kv_put_success_ver_' + _memDBCacheVer;
      return;
    }catch(e){
      _lastUSetStatus = 'kv_put_error: ' + (e.message||e);
      console.error('KV put error:',e);
    }
  } else {
    _lastUSetStatus = 'no_kv_binding_found';
  }
  try{
    const ur = await fetch(`${gUU(env)}/set/${encodeURIComponent(key)}`,{method:'POST',headers:{Authorization:`Bearer ${gUT(env)}`,'Content-Type':'application/json'},body:JSON.stringify(val)});
    const ud = await ur.json().catch(()=>({}));
    if (ud.error) _lastUSetStatus += ' | upstash_error: ' + ud.error;
    else _lastUSetStatus += ' | upstash_ok';
    if(ttl) await uExp(env,key,ttl);
  }catch(e){ _lastUSetStatus += ' | upstash_fetch_error: ' + e.message; }
}
async function uDel(env,key){
  const kv=getKV(env);
  if(kv){
    try{await kv.delete(key);}catch(e){}
    return;
  }
  try{
    await fetch(`${gUU(env)}/del/${encodeURIComponent(key)}`,{method:'POST',headers:{Authorization:`Bearer ${gUT(env)}`}});
  }catch(e){}
}
async function uExp(env,key,s){
  const kv=getKV(env);
  if(kv)return;
  try{
    await fetch(`${gUU(env)}/expire/${encodeURIComponent(key)}/${s}`,{method:'POST',headers:{Authorization:`Bearer ${gUT(env)}`}});
  }catch(e){}
}
async function sha256(t){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(t));return Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,'0')).join('');}
async function iKey(s){const r=new TextEncoder().encode(s.padEnd(32,'0').slice(0,32));return crypto.subtle.importKey('raw',r,{name:'AES-GCM'},false,['encrypt','decrypt']);}
async function enc(t,s){const k=await iKey(s);const iv=crypto.getRandomValues(new Uint8Array(12));const e=await crypto.subtle.encrypt({name:'AES-GCM',iv},k,new TextEncoder().encode(t));const c=new Uint8Array([...iv,...new Uint8Array(e)]);return btoa(String.fromCharCode(...c));}
async function dec(b64,s){const k=await iKey(s);const c=Uint8Array.from(atob(b64),x=>x.charCodeAt(0));const d=await crypto.subtle.decrypt({name:'AES-GCM',iv:c.slice(0,12)},k,c.slice(12));return new TextDecoder().decode(d);}
function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,7);}
async function vSes(req,env,role){
  const tok=(req.headers.get('Authorization')||'').replace('Bearer ','').trim();
  if(!tok)return role?false:null;
  const signedUser = await verifySignedToken(tok, gEK(env));
  if (signedUser) {
    if (role) return signedUser === role;
    return signedUser;
  }
  if(_memSesCache.has(tok)){
    const c=_memSesCache.get(tok);
    if(role) return c===role;
    return c||null;
  }
  let v=null;
  try{ v=await uGet(env,`td:ses:${tok}`); }catch(e){}
  const c=String(v||'').replace(/^"|"$/g,'');
  if(c) _memSesCache.set(tok,c);
  if(role)return c===role;
  return c||null;
}
async function gAT(env,rt,forceRefresh=false){
  const r=await dec(rt,gEK(env));
  const kHash=await sha256(r);
  if(!forceRefresh){
    const cached=await uGet(env,`td:at:${kHash}`);
    if(cached&&typeof cached==='string'&&cached.length>10) return cached;
  }
  const x=await(await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:gGC(env),client_secret:gGS(env),refresh_token:r,grant_type:'refresh_token'})})).json();
  if(!x.access_token){
    await uDel(env,`td:at:${kHash}`);
    throw new Error(`Token: ${x.error||'fail'}`);
  }
  await uSet(env,`td:at:${kHash}`,x.access_token,3000);
  await uExp(env,`td:at:${kHash}`,3000);
  return x.access_token;
}
async function gDQ(at){return(await fetch('https://www.googleapis.com/drive/v3/about?fields=storageQuota,user',{headers:{Authorization:`Bearer ${at}`}})).json();}
async function mkDir(at,n,pid){const q=`name='${n}' and mimeType='application/vnd.google-apps.folder' and trashed=false${pid?` and '${pid}' in parents`:''}`;const s=await(await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`,{headers:{Authorization:`Bearer ${at}`}})).json();if(s.files&&s.files.length)return s.files[0].id;const c=await(await fetch('https://www.googleapis.com/drive/v3/files',{method:'POST',headers:{Authorization:`Bearer ${at}`,'Content-Type':'application/json'},body:JSON.stringify({name:n,mimeType:'application/vnd.google-apps.folder',...(pid?{parents:[pid]}:{})})})).json();return c.id;}

// ─── Google Drive DB Persistence Backup ───
// When Cloudflare KV exceeds daily put limits, Google Drive is our reliable storage.
let _isGDriveSaving = false;
async function saveDBToGDrive(env, db) {
  if (_isGDriveSaving) return null;
  _isGDriveSaving = true;
  try {
    const drv = (db.drives||[])[0];
    if (!drv || !drv.encToken || !drv.rootFolderId) return null;
    let at = await gAT(env, drv.encToken);
    let fileId = _gdriveDbFileId;
    if (!fileId) {
      const q = `name='__teledrive_db__.json' and trashed=false and '${drv.rootFolderId}' in parents`;
      let sResp = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&supportsAllDrives=true`, {
        headers: { Authorization: `Bearer ${at}` }
      });
      if (sResp.status === 401) {
        at = await gAT(env, drv.encToken, true);
        sResp = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&supportsAllDrives=true`, {
          headers: { Authorization: `Bearer ${at}` }
        });
      }
      const sData = await sResp.json();
      fileId = (sData.files && sData.files[0]) ? sData.files[0].id : null;
      if (fileId) _gdriveDbFileId = fileId;
    }
    const bodyStr = JSON.stringify(db);
    if (fileId) {
      let pResp = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&supportsAllDrives=true`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' },
        body: bodyStr
      });
      if (pResp.status === 401) {
        at = await gAT(env, drv.encToken, true);
        pResp = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&supportsAllDrives=true`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' },
          body: bodyStr
        });
      }
      if (pResp.ok) return fileId;
      console.error('saveDBToGDrive PATCH failed:', pResp.status);
      if (pResp.status === 404) fileId = null;
    }
    if (!fileId) {
      const boundary = 'td_backup_boundary';
      const meta = JSON.stringify({ name: '__teledrive_db__.json', parents: [drv.rootFolderId] });
      const multipart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${bodyStr}\r\n--${boundary}--`;
      const cResp = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true', {
        method: 'POST',
        headers: { Authorization: `Bearer ${at}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
        body: multipart
      });
      const cData = await cResp.json();
      if (cData && cData.id) {
        _gdriveDbFileId = cData.id;
        return cData.id;
      }
    }
  } catch(e) { console.error('saveDBToGDrive error:', e); }
  finally { _isGDriveSaving = false; }
  return null;
}

async function loadDBFromGDrive(env, fallbackDrv) {
  try {
    if (!fallbackDrv || !fallbackDrv.encToken || !fallbackDrv.rootFolderId) return null;
    let at = await gAT(env, fallbackDrv.encToken);
    let fileId = _gdriveDbFileId;
    if (!fileId) {
      const q = `name='__teledrive_db__.json' and trashed=false and '${fallbackDrv.rootFolderId}' in parents`;
      let sResp = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&supportsAllDrives=true`, {
        headers: { Authorization: `Bearer ${at}` }
      });
      if (sResp.status === 401) {
        at = await gAT(env, fallbackDrv.encToken, true);
        sResp = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&supportsAllDrives=true`, {
          headers: { Authorization: `Bearer ${at}` }
        });
      }
      const sData = await sResp.json();
      fileId = (sData.files && sData.files[0]) ? sData.files[0].id : null;
      if (fileId) _gdriveDbFileId = fileId;
    }
    if (!fileId) return null;
    let dlResp = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`, {
      headers: { Authorization: `Bearer ${at}` }
    });
    if (dlResp.status === 401) {
      at = await gAT(env, fallbackDrv.encToken, true);
      dlResp = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`, {
        headers: { Authorization: `Bearer ${at}` }
      });
    }
    if (dlResp.status === 404) {
      _gdriveDbFileId = null;
      return null;
    }
    if (!dlResp.ok) return null;
    return await dlResp.json();
  } catch(e) { console.error('loadDBFromGDrive error:', e); }
  return null;
}


async function hAL(req,env){
  const{password=''}=await req.json().catch(()=>({}));
  let db;
  try{ db=await uGet(env,'td:db'); }catch(e){
    if(_memDBCache) db=_memDBCache;
    else if(String(e.message).includes('ERR_DB_SUSPENDED')) return J({error:'Database suspended on Upstash due to monthly bandwidth limit. Please un-suspend or upgrade in Upstash Console, or bind Cloudflare KV.', isDatabaseSuspended:true},503);
  }
  if(!db){
    if(_memDBCache) db=_memDBCache;
    else {
      db={v:3,adminHash:await sha256('admin123'),drives:[],files:[],folders:[],activityLog:[],users:[]};
      try{ await uSet(env,'td:db',db); }catch(e){}
    }
  }
  if(await sha256(password)!==db.adminHash)return J({error:'Wrong password'},401);
  const t = await makeSignedToken('admin', gEK(env));
  _memSesCache.set(t,'admin');
  try{ await uSet(env,`td:ses:${t}`,'admin',604800); }catch(e){}
  return J({token:t,role:'admin'});
}
async function hUL(req,env){
  const{username='',password=''}=await req.json().catch(()=>({}));
  let db;
  try{ db=await uGet(env,'td:db'); }catch(e){
    if(_memDBCache) db=_memDBCache;
    else if(String(e.message).includes('ERR_DB_SUSPENDED')) return J({error:'Database suspended on Upstash. Please un-suspend in Upstash Console or bind Cloudflare KV.', isDatabaseSuspended:true},503);
  }
  const u=(db&&db.users||[]).find(x=>x.username===username);
  if(!u||await sha256(password)!==u.passwordHash)return J({error:'Wrong username or password'},401);
  const t = await makeSignedToken(u.id, gEK(env));
  _memSesCache.set(t,u.id);
  try{ await uSet(env,`td:ses:${t}`,u.id,604800); }catch(e){}
  return J({token:t,role:'user',userId:u.id,username:u.username,allowedDrives:u.allowedDrives||'all'});
}
async function hAG(req,env){if(!await vSes(req,env,'admin'))return J({error:'Unauthorized'},401);const cid=gGC(env);if(!cid)return J({error:'GOOGLE_CLIENT_ID not set in Cloudflare Pages env vars'},400);const o=new URL(req.url).origin;const u=new URL('https://accounts.google.com/o/oauth2/v2/auth');u.searchParams.set('client_id',cid);u.searchParams.set('redirect_uri',`${o}/api/auth/callback`);u.searchParams.set('response_type','code');u.searchParams.set('scope','https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile');u.searchParams.set('access_type','offline');u.searchParams.set('prompt','consent');return J({url:u.toString()});}
async function hCB(req,env){const url=new URL(req.url),code=url.searchParams.get('code');if(!code)return new Response('Missing code',{status:400});const toks=await(await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code,client_id:gGC(env),client_secret:gGS(env),redirect_uri:`${url.origin}/api/auth/callback`,grant_type:'authorization_code'})})).json();if(!toks.refresh_token)return new Response(`<html><body style="background:#0d0d12;color:#eee;font:16px sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center"><div><h2 style="color:#ff453a">No refresh token</h2><p>Revoke TeleDrive from <a href="https://myaccount.google.com/permissions" style="color:#4e86f5" target="_blank">Google Account permissions</a> then retry.</p><a href="/#/settings" style="color:#4e86f5">Back</a></div></body></html>`,{status:400,headers:{'Content-Type':'text/html'}});const user=await(await fetch('https://www.googleapis.com/oauth2/v2/userinfo',{headers:{Authorization:`Bearer ${toks.access_token}`}})).json();const quota=await gDQ(toks.access_token);const rfId=await mkDir(toks.access_token,'TeleDrive',null);const eT=await enc(toks.refresh_token,gEK(env));let db=await uGet(env,'td:db');if(!db)db={v:3,adminHash:await sha256('admin123'),drives:[],files:[],folders:[],activityLog:[],users:[]};if(!db.drives)db.drives=[];const existingIdx=db.drives.findIndex(d=>d.email===user.email);if(existingIdx>=0){db.drives[existingIdx].encToken=eT;db.drives[existingIdx].rootFolderId=rfId;db.drives[existingIdx].name=user.name||user.email;db.drives[existingIdx].picture=user.picture||db.drives[existingIdx].picture||'';db.drives[existingIdx].capacity=parseInt(quota.storageQuota&&quota.storageQuota.limit)||db.drives[existingIdx].capacity||0;db.drives[existingIdx].usedBytes=parseInt(quota.storageQuota&&quota.storageQuota.usage)||db.drives[existingIdx].usedBytes||0;}else{const cols=['#4e86f5','#30d158','#bf5af2','#ff9f0a','#ff453a','#64d2ff'];db.drives.push({id:uid(),email:user.email,name:user.name||user.email,picture:user.picture||'',color:cols[db.drives.length%cols.length],capacity:parseInt(quota.storageQuota&&quota.storageQuota.limit)||0,usedBytes:parseInt(quota.storageQuota&&quota.storageQuota.usage)||0,rootFolderId:rfId,encToken:eT,createdAt:new Date().toISOString()});}await uSet(env,'td:db',db);return new Response(`<html><head><script>window.opener&&window.opener.postMessage('drive-connected','*');setTimeout(function(){window.close();},1500);<\/script></head><body style="background:#0d0d12;color:#eee;font:16px sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center"><div><h2 style="color:#30d158">Drive Connected!</h2><p>${user.email}</p><p style="opacity:.6">Closing…</p></div></body></html>`,{headers:{'Content-Type':'text/html'}});}
async function hVerifySes(req,env){const r=await vSes(req,env,null);if(!r)return J({valid:false},401);return J({valid:true,role:r==='admin'?'admin':'user',userId:r});}
function syncDriveUsage(db){
  // Preserve real Google Drive quota (do not overwrite with only TeleDrive-uploaded files)
}
function sDrv(d){
  if(!d) return d;
  return {
    ...d,
    encToken: undefined,
    passwordHash: undefined,
    hasPassword: !!d.passwordHash,
    passwordHint: d.passwordHint || null,
    isOpenDrive: !!d.isOpenDrive
  };
}
function sFold(f){
  if(!f) return f;
  const o = {...f};
  delete o.passwordHash;
  delete o.encPassword;
  return o;
}
function getOpenDriveIds(db){
  if(!db) return [];
  const s = new Set();
  if(db.openDriveId) s.add(db.openDriveId);
  if(Array.isArray(db.openDriveIds)) db.openDriveIds.forEach(id => { if(id) s.add(id); });
  (db.drives||[]).forEach(d => { if(d.isOpenDrive) s.add(d.id); });
  return Array.from(s);
}
function isDriveOpen(driveId, db){
  if(!driveId || !db) return false;
  return getOpenDriveIds(db).includes(driveId);
}
async function vDriveToken(req, env, driveId){
  if(!driveId) return false;
  const url = new URL(req.url);
  const singleToken = req.headers.get('x-drive-token') || url.searchParams.get('driveToken');
  const multiTokensHeader = req.headers.get('x-drive-tokens');
  const tokens = [];
  if (singleToken) tokens.push(singleToken);
  if (multiTokensHeader) multiTokensHeader.split(',').map(t=>t.trim()).filter(Boolean).forEach(t=>tokens.push(t));

  for (const token of tokens) {
    if (await verifyDriveToken(token, driveId, gEK(env))) return true;
    if (_memSesCache.has('dtk:' + token)) {
      if (_memSesCache.get('dtk:' + token) === driveId) return true;
    }
    try{
      const storedDriveId = await uGet(env, 'td:dtk:' + token);
      const sid = String(storedDriveId || '').replace(/^"|"$/g, '');
      if (sid) {
        _memSesCache.set('dtk:' + token, sid);
        if (sid === driveId) return true;
      }
    }catch(e){}
  }
  return false;
}
async function hDB(req,env){
  let db;
  try{ db=await uGet(env,'td:db'); }catch(e){
    if(_memDBCache) db=_memDBCache;
    else if(String(e.message).includes('ERR_DB_SUSPENDED')) return J({error:'Database suspended on Upstash due to monthly bandwidth limit. Please un-suspend in Upstash Console or bind Cloudflare KV.', isDatabaseSuspended:true},503);
  }
  if(!db){
    if(_memDBCache) db=_memDBCache;
    else {
      db={v:3,adminHash:await sha256('admin123'),drives:[],files:[],folders:[],activityLog:[],users:[]};
      try{ await uSet(env,'td:db',db); }catch(e){}
    }
  }
  // Only check Google Drive if explicitly requested with ?refresh=gdrive or ?sync=1
  const dbUrl = new URL(req.url);
  if ((dbUrl.searchParams.get('refresh') === 'gdrive' || dbUrl.searchParams.get('sync') === '1') && db && db.drives && db.drives.length) {
    try {
      const gdb = await loadDBFromGDrive(env, db.drives[0]);
      if (gdb && (gdb._dbVer || 0) > (db._dbVer || 0)) {
        db = gdb;
        _memDBCache = gdb;
        _memDBCacheVer = gdb._dbVer || 0;
      }
    } catch(e) {}
  }
  const policy = {
    allowUserDownload: db.policy ? db.policy.allowUserDownload !== false : true,
    allowUserDelete: db.policy ? db.policy.allowUserDelete !== false : true,
    allowUserRename: db.policy ? db.policy.allowUserRename !== false : true,
    folderLockoutEnabled: db.policy ? db.policy.folderLockoutEnabled !== false : true
  };
  db.policy = policy;
  const r=await vSes(req,env,null);
  const openIds = getOpenDriveIds(db);
  if(r==='admin'){
    return J({
      ...db,
      policy,
      openDriveIds: openIds,
      drives:(db.drives||[]).map(sDrv),
      folders:(db.folders||[]).map(sFold),
      activityLog:(db.activityLog||[]),
      users:(db.users||[])
    });
  }
  if(r){
    const u=(db.users||[]).find(x=>x.id===r);
    const allowed = u ? u.allowedDrives : null;
    const allowedList = (allowed && allowed !== 'all') ? (Array.isArray(allowed) ? allowed : [allowed]) : null;
    const userDrives = (db.drives||[]).filter(d => !allowedList || allowedList.includes(d.id)).map(sDrv);
    const userDriveIds = userDrives.map(d => d.id);
    const userFolders = (db.folders||[]).filter(f => userDriveIds.includes(f.driveId) && !f.destroyed && !f.adminOnly && (!f.allowedUsers || !f.allowedUsers.length || f.allowedUsers.includes(r))).map(sFold);
    const visibleFolderIds = new Set(userFolders.map(f => f.id));
    const userFiles = (db.files||[]).filter(f => userDriveIds.includes(f.driveId) && !f.destroyed && !f.adminOnly && (!f.allowedUsers || !f.allowedUsers.length || f.allowedUsers.includes(r)) && (!f.folderId || visibleFolderIds.has(f.folderId)));
    const userLogs = (db.activityLog||[]).filter(l => !l.driveId || userDriveIds.includes(l.driveId));
    return J({
      v: db.v,
      openDriveId: db.openDriveId,
      openDriveIds: openIds,
      policy,
      drives: userDrives,
      files: userFiles,
      folders: userFolders,
      activityLog: userLogs,
      users: u ? [{ id: u.id, username: u.username }] : []
    });
  }

  // Guest visitor: Return all connected drives so mobile visitors can view and unlock them!
  const allDrives = (db.drives||[]).map(sDrv);
  const guestDrives = allDrives;
  const guestDriveIds = guestDrives.map(d => d.id);

  // Check which guest drives are unlocked (either open, have no password, or token valid)
  const unlockedDriveIds = new Set();
  for (const d of guestDrives) {
    if (!d.hasPassword || openIds.includes(d.id)) {
      unlockedDriveIds.add(d.id);
    } else {
      const isUnlocked = await vDriveToken(req, env, d.id);
      if (isUnlocked) unlockedDriveIds.add(d.id);
    }
  }

  const guestFolders = (db.folders||[]).filter(f => unlockedDriveIds.has(f.driveId) && !f.destroyed && !f.adminOnly && (!f.allowedUsers || !f.allowedUsers.length)).map(sFold);
  const visibleFolderIds = new Set(guestFolders.map(f => f.id));
  const guestFiles = (db.files||[]).filter(f => unlockedDriveIds.has(f.driveId) && !f.destroyed && !f.adminOnly && (!f.allowedUsers || !f.allowedUsers.length) && (!f.folderId || visibleFolderIds.has(f.folderId)));

  return J({
    v: db.v,
    openDriveId: db.openDriveId,
    openDriveIds: openIds,
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
async function hScanDrive(req,env,driveId){
  if(!await vSes(req,env,'admin'))return J({error:'Unauthorized'},401);
  const db=await uGet(env,'td:db');
  if(!db)return J({error:'Database not found'},404);
  if(!db.folders)db.folders=[];
  if(!db.files)db.files=[];

  const drivesToScan = (driveId === 'all' || !driveId) ? (db.drives||[]) : (db.drives||[]).filter(d=>d.id===driveId);
  if(!drivesToScan.length)return J({error:'Drive not found'},404);

  let totalAddedFiles = 0;
  let totalAddedFolders = 0;

  try {
    for (const drv of drivesToScan) {
      if (!drv || !drv.encToken) continue;
      const at = await gAT(env, drv.encToken);
      const curDriveId = drv.id;
    // Phase 1: Fetch all folders from Google Drive in bulk (pageSize=1000 uses only 1-2 subrequests!)
    const allGoogleFolders = [];
    let fPageToken = '';
    let folderFetches = 0;
    do {
      const u = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent("mimeType = 'application/vnd.google-apps.folder' and trashed = false")}&fields=nextPageToken,files(id,name,parents,createdTime)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true${fPageToken ? `&pageToken=${fPageToken}` : ''}`;
      const resp = await fetch(u, { headers: { Authorization: `Bearer ${at}` } });
      if (!resp.ok) {
        const err = await resp.json().catch(()=>({}));
        throw new Error((err.error && err.error.message) || `Folder listing failed (${resp.status})`);
      }
      const data = await resp.json();
      if (data.files) allGoogleFolders.push(...data.files);
      fPageToken = data.nextPageToken || '';
      folderFetches++;
    } while (fPageToken && folderFetches < 5);

    // Phase 2: Identify root 'TeleDrive' folders
    let rootId = drv.rootFolderId;
    let rootExists = rootId && allGoogleFolders.some(f => f.id === rootId);
    if (!rootExists) {
      const teleFolder = allGoogleFolders.find(f => (f.name||'').trim().toLowerCase() === 'teledrive');
      if (teleFolder) {
        rootId = teleFolder.id;
      } else {
        rootId = await mkDir(at, 'TeleDrive', null);
        allGoogleFolders.push({ id: rootId, name: 'TeleDrive', parents: [] });
      }
      drv.rootFolderId = rootId;
    }

    // Collect all TeleDrive root Google IDs
    const teleDriveRootGIds = new Set();
    if (rootId) teleDriveRootGIds.add(rootId);
    for (const gf of allGoogleFolders) {
      if ((gf.name || '').trim().toLowerCase() === 'teledrive') {
        teleDriveRootGIds.add(gf.id);
      }
    }

    // Phase 3: In-memory folder tree resolution (0 subrequests!)
    // Map googleFolderId -> local folder ID in db.folders
    const gFolderToLocalId = new Map();
    for (const rGId of teleDriveRootGIds) {
      gFolderToLocalId.set(rGId, null);
    }
    for (const f of db.folders) {
      if (f.driveId === curDriveId && f.googleFolderId) {
        gFolderToLocalId.set(f.googleFolderId, f.id);
      }
    }

    // Build the set of all Google folder IDs that belong to TeleDrive
    const validGoogleFolderIds = new Set(teleDriveRootGIds);
    for (const f of db.folders) {
      if (f.driveId === curDriveId && f.googleFolderId) {
        validGoogleFolderIds.add(f.googleFolderId);
      }
    }

    let addedAny;
    do {
      addedAny = false;
      for (const gf of allGoogleFolders) {
        if (!validGoogleFolderIds.has(gf.id)) {
          const hasValidParent = gf.parents && gf.parents.some(p => validGoogleFolderIds.has(p));
          const isTopLevelInDrive = !gf.parents || !gf.parents.length || !allGoogleFolders.some(other => other.id === gf.parents[0]);
          if (hasValidParent || isTopLevelInDrive) {
            validGoogleFolderIds.add(gf.id);
            addedAny = true;
          }
        }
      }
    } while (addedAny);

    let addedFolders = 0;
    for (const gf of allGoogleFolders) {
      if (teleDriveRootGIds.has(gf.id)) continue;
      if (validGoogleFolderIds.has(gf.id)) {
        let localId = gFolderToLocalId.get(gf.id);
        if (!localId) {
          const parentGoogleId = (gf.parents && gf.parents.find(p => validGoogleFolderIds.has(p))) || null;
          const parentLocalId = (parentGoogleId && !teleDriveRootGIds.has(parentGoogleId)) ? (gFolderToLocalId.get(parentGoogleId) || null) : null;
          const gfName = (gf.name || 'Untitled Folder').trim();
          // Safety: avoid duplicate folders with matching name under the same parent
          const existingByName = db.folders.find(f => f.driveId === curDriveId && f.parentId === parentLocalId && (f.name||'').trim().toLowerCase() === gfName.toLowerCase() && !f.trashed);
          if (existingByName) {
            localId = existingByName.id;
            existingByName.googleFolderId = gf.id;
            gFolderToLocalId.set(gf.id, localId);
          } else {
            localId = uid();
            const newFold = {
              id: localId,
              driveId: curDriveId,
              parentId: parentLocalId,
              name: gfName,
              googleFolderId: gf.id,
              date: gf.createdTime || new Date().toISOString(),
              createdBy: 'admin'
            };
            db.folders.push(newFold);
            gFolderToLocalId.set(gf.id, localId);
            addedFolders++;
          }
        }
      }
    }

    // Update parentId for existing folders if necessary
    for (const gf of allGoogleFolders) {
      if (teleDriveRootGIds.has(gf.id)) continue;
      if (validGoogleFolderIds.has(gf.id)) {
        const curLocalId = gFolderToLocalId.get(gf.id);
        const ef = db.folders.find(f => f.id === curLocalId);
        if (ef) {
          const parentGoogleId = (gf.parents && gf.parents.find(p => validGoogleFolderIds.has(p))) || null;
          const targetParentLocalId = (parentGoogleId && !teleDriveRootGIds.has(parentGoogleId)) ? (gFolderToLocalId.get(parentGoogleId) || null) : null;
          if (ef.parentId !== targetParentLocalId) ef.parentId = targetParentLocalId;
        }
      }
    }

    // Phase 4: Fetch files in bulk pages with strict subrequest safety limit
    const url = new URL(req.url);
    let filePageToken = url.searchParams.get('pageToken') || '';
    let addedFiles = 0;
    let fileFetches = 0;
    const MAX_FILE_FETCHES = 25; // Safely below Cloudflare 50 subrequest limit!

    const existingGoogleFileIds = new Map();
    for (const f of db.files) {
      if (f.googleFileId) {
        existingGoogleFileIds.set(f.googleFileId, f);
      }
    }

    do {
      const u = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent("mimeType != 'application/vnd.google-apps.folder' and trashed = false")}&fields=nextPageToken,files(id,name,mimeType,size,createdTime,parents)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true${filePageToken ? `&pageToken=${filePageToken}` : ''}`;
      const fResp = await fetch(u, { headers: { Authorization: `Bearer ${at}` } });
      if (!fResp.ok) {
        const errJson = await fResp.json().catch(()=>({}));
        throw new Error((errJson.error && errJson.error.message) || `Google API error ${fResp.status}`);
      }
      const res = await fResp.json();
      if (res.files) {
        for (const item of res.files) {
          if (item.name === '__teledrive_db__.json') continue;
          
          let parentLocalId = null;
          let isBelongingToTeleDrive = false;

          if (item.parents && item.parents.length) {
            const matchedParentGId = item.parents.find(p => gFolderToLocalId.has(p));
            if (matchedParentGId) {
              isBelongingToTeleDrive = true;
              parentLocalId = gFolderToLocalId.get(matchedParentGId);
            } else {
              const isUnderOtherGFolder = item.parents.some(p => allGoogleFolders.some(gf => gf.id === p));
              if (!isUnderOtherGFolder) {
                isBelongingToTeleDrive = true;
                parentLocalId = null;
              }
            }
          } else {
            isBelongingToTeleDrive = true;
            parentLocalId = null;
          }

          if (!isBelongingToTeleDrive) continue;

          let eFile = existingGoogleFileIds.get(item.id);
          if (!eFile) {
            eFile = {
              id: uid(),
              googleFileId: item.id,
              driveId: curDriveId,
              folderId: parentLocalId,
              name: item.name || 'Untitled',
              size: parseInt(item.size, 10) || 0,
              mimeType: item.mimeType || 'application/octet-stream',
              uploadedBy: 'admin',
              date: item.createdTime || new Date().toISOString()
            };
            db.files.push(eFile);
            existingGoogleFileIds.set(item.id, eFile);
            addedFiles++;
          } else {
            if (eFile.driveId !== curDriveId) eFile.driveId = curDriveId;
            if (eFile.folderId !== parentLocalId) eFile.folderId = parentLocalId;
            if (typeof item.size === 'string' && !eFile.size) eFile.size = parseInt(item.size, 10) || 0;
          }
        }
      }
      filePageToken = res.nextPageToken || '';
      fileFetches++;
    } while (filePageToken && fileFetches < MAX_FILE_FETCHES);

    const isPartial = !!filePageToken;

    // Refresh quota when complete
    if (!isPartial) {
      try {
        const q = await gDQ(at);
        if (q && q.storageQuota) {
          drv.capacity = parseInt(q.storageQuota.limit) || drv.capacity || 0;
          drv.usedBytes = parseInt(q.storageQuota.usage) || drv.usedBytes || 0;
        }
      } catch(e) {}
    }

    totalAddedFiles += addedFiles;
    totalAddedFolders += addedFolders;
  } // end of drivesToScan loop

  await uSet(env, 'td:db', db);
  return J({
    ok: true,
    addedFiles: totalAddedFiles,
    addedFolders: totalAddedFolders,
    totalFiles: db.files.length,
    totalFolders: db.folders.length
  });
  } catch(err) {
    return J({ error: 'Scan failed: ' + (err.message || 'Google Drive API error') }, 500);
  }
}
async function hBackupDB(req,env){
  if(!await vSes(req,env,'admin'))return J({error:'Unauthorized'},401);
  const db=await uGet(env,'td:db');
  return J(db||{});
}
async function hRestoreDB(req,env){
  if(!await vSes(req,env,'admin'))return J({error:'Unauthorized'},401);
  let imported=await req.json().catch(()=>null);
  if(typeof imported==='string'){
    try{ imported=JSON.parse(imported); }catch(e){}
  }
  if(!imported||typeof imported!=='object')return J({error:'Invalid JSON format'},400);
  if(!imported.v && !imported.adminHash && !imported.drives)return J({error:'Invalid database structure: missing drives or schema'},400);
  await uSet(env,'td:db',imported);
  return J({ok:true,message:'Database restored successfully',totalDrives:(imported.drives||[]).length,totalFiles:(imported.files||[]).length});
}
async function hUI(req,env){
  const body=await req.json().catch(()=>({}));
  let {driveId,folderId,googleFolderId,name,size,mimeType}=body;
  const db=await uGet(env,'td:db');
  if(!driveId && folderId) {
    const f = (db && db.folders || []).find(x => x.id === folderId);
    if(f && f.driveId) driveId = f.driveId;
  }
  if(!driveId && db && db.drives && db.drives.length) {
    driveId = db.drives[0].id;
  }
  const isOpenTarget=isDriveOpen(driveId,db);
  const ses=await vSes(req,env,null);
  if(!ses && !isOpenTarget) return J({error:'Sign in required'},401);
  if(isOpenTarget && !ses){
    const isMedia = (mimeType && (mimeType.startsWith('image/') || mimeType.startsWith('video/'))) || (name && /\.(jpg|jpeg|png|gif|webp|mp4|mov|mkv|webm|avi)$/i.test(name));
    if(!isMedia) return J({error:'Open drive only allows photos and videos'},400);
  }
  const drv=(db&&db.drives||[]).find(d=>d.id===driveId) || (db&&db.drives||[])[0];
  if(!drv) return J({error:'Drive not found'},404);
  if(!ses && drv.passwordHash && !await vDriveToken(req, env, drv.id)){
    return J({error:'Drive is locked by password'},403);
  }
  let at;
  try {
    at=await gAT(env,drv.encToken);
  } catch(e) {
    try {
      at=await gAT(env,drv.encToken,true);
    } catch(e2) {
      return J({error:'Google Drive token error: ' + (e2.message||e.message)}, 500);
    }
  }
  let pid = drv.rootFolderId;
  if (folderId) {
    const allFolders = (db.folders||[]).concat((_memDBCache&&_memDBCache.folders)||[]);
    const f = allFolders.find(x => x.id === folderId || x.googleFolderId === folderId);
    if (f && f.googleFolderId) {
      pid = f.googleFolderId;
    } else if (f && f.name) {
      let parentGId = drv.rootFolderId;
      if (f.parentId) {
        const pf = allFolders.find(x => x.id === f.parentId);
        if (pf && pf.googleFolderId) parentGId = pf.googleFolderId;
      }
      try {
        const newGId = await mkDir(at, f.name, parentGId);
        if (newGId) {
          f.googleFolderId = newGId;
          pid = newGId;
          (db.folders||[]).forEach(x => { if (x.id === f.id) x.googleFolderId = newGId; });
          await uSet(env, 'td:db', db);
        }
      } catch (err) {
        console.error('Failed to create target folder for upload:', err);
      }
    } else if (googleFolderId && googleFolderId.length > 10) {
      pid = googleFolderId;
    } else if (folderId.length > 20 && !folderId.includes('-')) {
      pid = folderId;
    } else {
      return J({ error: 'Target folder is being prepared. Retrying...', retryFolder: true }, 409);
    }
  } else if (googleFolderId && googleFolderId.length > 10) {
    pid = googleFolderId;
  }

  const reqInit = (token, targetPid) => fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name',{
    method:'POST',
    headers:{
      Authorization:`Bearer ${token}`,
      'Content-Type':'application/json',
      'X-Upload-Content-Type':mimeType||'application/octet-stream',
      'X-Upload-Content-Length':String(size),
      'Origin':(new URL(req.url).origin)
    },
    body:JSON.stringify({name,mimeType:mimeType||'application/octet-stream',parents:[targetPid]})
  });
  let ir = await reqInit(at, pid);
  if (ir.status === 401) {
    at = await gAT(env, drv.encToken, true);
    ir = await reqInit(at, pid);
  } else if (ir.status === 429 || ir.status >= 500) {
    await new Promise(r => setTimeout(r, 1200));
    ir = await reqInit(at, pid);
  }
  if (ir.status === 404 && pid !== drv.rootFolderId) {
    // NEVER fall back to rootFolderId! Find folder and recreate it under its proper parent
    const allFolders = (db.folders||[]).concat((_memDBCache&&_memDBCache.folders)||[]);
    const targetF = allFolders.find(x => x.id === folderId || x.googleFolderId === pid);
    if (targetF && targetF.name) {
      let targetParentGId = drv.rootFolderId;
      if (targetF.parentId) {
        const pf = allFolders.find(x => x.id === targetF.parentId);
        if (pf && pf.googleFolderId) targetParentGId = pf.googleFolderId;
      }
      try {
        const newGId = await mkDir(at, targetF.name, targetParentGId);
        if (newGId) {
          targetF.googleFolderId = newGId;
          pid = newGId;
          (db.folders||[]).forEach(x => {
            if (x.id === targetF.id) x.googleFolderId = newGId;
          });
          if (_memDBCache && _memDBCache.folders) {
            _memDBCache.folders.forEach(x => {
              if (x.id === targetF.id) x.googleFolderId = newGId;
            });
          }
          await uSet(env, 'td:db', db);
          ir = await reqInit(at, pid);
        }
      } catch(recreateErr) {
        console.error('Failed to auto-recreate missing folder:', recreateErr);
      }
    }
    if (ir.status === 404) {
      return J({
        error: `Target folder "${targetF ? targetF.name : (folderId || pid)}" not found on Google Drive. Upload halted to protect file destination.`,
        targetFolder: targetF ? targetF.name : folderId
      }, 404);
    }
  }
  const uUrl=ir.headers.get('Location');
  if(!uUrl) {
    const errDetail = await ir.text().catch(()=>'');
    return J({error:'Upload session failed (HTTP ' + ir.status + ')', detail:errDetail}, 500);
  }
  return J({uploadUrl:uUrl,fileLocalId:uid()});
}
async function hUC(req,env){
  const body=await req.json().catch(()=>({}));
  let {fileLocalId,googleFileId,driveId,folderId,name,size,mimeType,thumb}=body;
  const db=await uGet(env,'td:db');
  if(!driveId && folderId) {
    const f = (db && db.folders || []).find(x => x.id === folderId);
    if(f && f.driveId) driveId = f.driveId;
  }
  if(!driveId && db && db.drives && db.drives.length) {
    driveId = db.drives[0].id;
  }
  const isOpenTarget=isDriveOpen(driveId,db);
  const ses=await vSes(req,env,null);
  if(!ses && !isOpenTarget) return J({error:'Unauthorized'},401);
  if(!db) return J({error:'DB error'},500);
  const drv=(db.drives||[]).find(d=>d.id===driveId) || (db.drives||[])[0];
  if(!drv) return J({error:'Drive not found'},404);
  if(!ses && drv.passwordHash && !await vDriveToken(req, env, drv.id)){
    return J({error:'Drive is locked by password'},403);
  }
  if(!db.files) db.files=[];
  const parentFolder = folderId ? (db.folders||[]).find(x=>x.id===folderId) : null;
  const isAdmOnly = parentFolder ? !!parentFolder.adminOnly : false;
  const fAllowedUsers = (parentFolder && Array.isArray(parentFolder.allowedUsers) && parentFolder.allowedUsers.length) ? [...parentFolder.allowedUsers] : undefined;
  const existingFile = db.files.find(f => f.id === fileLocalId || (googleFileId && f.googleFileId === googleFileId));
  if (existingFile) {
    existingFile.name = name;
    existingFile.size = size;
    existingFile.mimeType = mimeType || existingFile.mimeType;
    existingFile.folderId = folderId || null;
    if (googleFileId) existingFile.googleFileId = googleFileId;
    if (fAllowedUsers) existingFile.allowedUsers = fAllowedUsers;
  } else {
    const newFile = {
      id:fileLocalId,
      googleFileId,
      driveId: drv.id,
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
  }
  if(drv && typeof size === 'number') drv.usedBytes = (drv.usedBytes || 0) + size;
  if(!db.activityLog) db.activityLog=[];
  db.activityLog.unshift({id:uid(),type:'upload',name,size,driveId,driveLetter:drv?drv.email:'?',ts:new Date().toISOString()});
  if(db.activityLog.length>100) db.activityLog=db.activityLog.slice(0,100);
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
    const signedUser = await verifySignedToken(tokenParam, gEK(env));
    if (signedUser) {
      ses = signedUser;
    } else {
      const v=await uGet(env,`td:ses:${tokenParam}`);
      ses=String(v||'').replace(/^"|"$/g,'')||null;
    }
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

  if (url.searchParams.get('thumb') === '1') return hThumb(req, env, gId);
  const isInline=url.searchParams.get('inline')==='1';
  if(!isInline && db && db.policy && db.policy.allowUserDownload === false && ses !== 'admin'){
    return J({error:'File downloads are disabled by administrator'}, 403);
  }
  if(!ses){
    const dIdParam=fileObj ? fileObj.driveId : url.searchParams.get('driveId');
    const isPublicDrive=isDriveOpen(dIdParam,db) || (!dIdParam && getOpenDriveIds(db).length > 0);
    if(!isPublicDrive) return J({error:'Sign in required'},401);
  }
  const dId=url.searchParams.get('driveId') || (fileObj ? fileObj.driveId : null);
  const drv=(db&&db.drives||[]).find(d=>d.id===dId)||(db&&db.drives||[])[0];
  if(!drv) return J({error:'Drive not found'},404);
  if(!ses && drv.passwordHash && !await vDriveToken(req, env, drv.id)){
    return J({error:'Drive is locked by password'}, 403);
  }
  let at=await gAT(env,drv.encToken);
  const range=req.headers.get('Range');
  let gResp=await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(gId)}?alt=media&supportsAllDrives=true`,{
    headers:{
      Authorization:`Bearer ${at}`,
      ...(range?{Range:range}:{})
    }
  });

  // If token was expired (401), force refresh and retry immediately!
  if(gResp.status===401){
    try{
      at=await gAT(env,drv.encToken,true);
      gResp=await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(gId)}?alt=media&supportsAllDrives=true`,{
        headers:{
          Authorization:`Bearer ${at}`,
          ...(range?{Range:range}:{})
        }
      });
    }catch(e){}
  }

  const fileName=encodeURIComponent(fileObj?fileObj.name:'download');
  const respHeaders=new Headers();
  respHeaders.set('Access-Control-Allow-Origin','*');
  respHeaders.set('Access-Control-Allow-Headers','Content-Type,Authorization,Range');
  respHeaders.set('Access-Control-Expose-Headers','Content-Range,Content-Length,Accept-Ranges');

  let cType=(fileObj&&fileObj.mimeType)?fileObj.mimeType:(gResp.headers.get('Content-Type')||'application/octet-stream');
  if(cType==='application/octet-stream'&&fileObj&&fileObj.name){
    if(/\.(jpe?g)$/i.test(fileObj.name)) cType='image/jpeg';
    else if(/\.png$/i.test(fileObj.name)) cType='image/png';
    else if(/\.webp$/i.test(fileObj.name)) cType='image/webp';
    else if(/\.gif$/i.test(fileObj.name)) cType='image/gif';
    else if(/\.mp4$/i.test(fileObj.name)) cType='video/mp4';
    else if(/\.mov$/i.test(fileObj.name)) cType='video/quicktime';
  }
  respHeaders.set('Content-Type',cType);
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
async function hThumb(req,env,gId){
  const url=new URL(req.url);
  const reqSz = url.searchParams.get('sz') || 's360';
  const memKey = `${gId}:${reqSz}`;

  // 1. Instant RAM Cache hit (0ms)
  if (_memThumbCache.has(memKey)) {
    const item = _memThumbCache.get(memKey);
    return new Response(item.buf, {
      status: 200,
      headers: {
        ...COR,
        'Content-Type': item.ct,
        'Cache-Control': 'public, max-age=604800, s-maxage=604800, immutable'
      }
    });
  }

  // 2. Cloudflare Edge Cache hit (2ms)
  try {
    const cached = await caches.default.match(req);
    if (cached) return cached;
  } catch(e) {}

  const tokenParam=url.searchParams.get('token');
  let ses=null;
  if(tokenParam){
    const signedUser = await verifySignedToken(tokenParam, gEK(env));
    if (signedUser) {
      ses = signedUser;
    } else {
      const v=await uGet(env,`td:ses:${tokenParam}`);
      ses=String(v||'').replace(/^"|"$/g,'')||null;
    }
  }
  if(!ses) ses=await vSes(req,env,null);
  const db=await uGet(env,'td:db');
  const fileObj=(db&&db.files||[]).find(f=>f.googleFileId===gId);

  // Security checks: file-level and parent/ancestor folder visibility
  if(fileObj){
    if(fileObj.adminOnly && ses !== 'admin') return new Response('Access denied',{status:403,headers:COR});
    if(fileObj.destroyed && ses !== 'admin') return new Response('Access denied',{status:403,headers:COR});
    if(Array.isArray(fileObj.allowedUsers) && fileObj.allowedUsers.length && ses !== 'admin' && (!ses || !fileObj.allowedUsers.includes(ses))){
      return new Response('Access denied',{status:403,headers:COR});
    }
    if(isFolderAccessDenied(fileObj.folderId, db, ses)) return new Response('Access denied',{status:403,headers:COR});
    if(ses && ses !== 'admin'){
      const u=(db.users||[]).find(x=>x.id===ses);
      const allowed = u ? u.allowedDrives : null;
      const allowedList = (allowed && allowed !== 'all') ? (Array.isArray(allowed) ? allowed : [allowed]) : null;
      if(allowedList && !allowedList.includes(fileObj.driveId)) return new Response('Access denied',{status:403,headers:COR});
    }
  }

  if(!ses){
    const dIdParam=fileObj ? fileObj.driveId : url.searchParams.get('driveId');
    const isPublicDrive=isDriveOpen(dIdParam,db) || (!dIdParam && getOpenDriveIds(db).length > 0);
    if(!isPublicDrive) return new Response('Sign in required',{status:401,headers:COR});
  }

  const dId=url.searchParams.get('driveId') || (fileObj ? fileObj.driveId : null);
  const drv=(db&&db.drives||[]).find(d=>d.id===dId)||(db&&db.drives||[])[0];
  if(!drv) return new Response('Drive not found',{status:404,headers:COR});
  if(!ses && drv.passwordHash && !await vDriveToken(req, env, drv.id)){
    return new Response('Drive is locked by password',{status:403,headers:COR});
  }

  let at=await gAT(env,drv.encToken);
  let gResp=await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(gId)}?fields=id,name,mimeType,thumbnailLink,hasThumbnail&supportsAllDrives=true`,{
    headers:{Authorization:`Bearer ${at}`}
  });
  if(gResp.status === 401){
    try {
      at=await gAT(env,drv.encToken,true); // Force refresh token
      gResp=await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(gId)}?fields=id,name,mimeType,thumbnailLink,hasThumbnail&supportsAllDrives=true`,{
        headers:{Authorization:`Bearer ${at}`}
      });
    } catch(e){}
  }

  if(!gResp.ok){
    return new Response('Thumbnail not available',{status:404,headers:{...COR,'Cache-Control':'no-cache, no-store, must-revalidate'}});
  }
  const gData=await gResp.json();

  // Try Google Drive thumbnail link with auth header
  if(gData.thumbnailLink){
    const highResThumb = gData.thumbnailLink.replace(/=s\d+$/, '=' + reqSz);
    const tResp = await fetch(highResThumb, {
      headers: { Authorization: `Bearer ${at}` }
    });
    if(tResp.ok){
      const buf = await tResp.arrayBuffer();
      const ct = tResp.headers.get('Content-Type') || 'image/jpeg';
      if (_memThumbCache.size > 400) {
        const first = _memThumbCache.keys().next().value;
        _memThumbCache.delete(first);
      }
      _memThumbCache.set(memKey, { ct, buf });
      const thumbResp = new Response(buf,{
        status:200,
        headers:{
          ...COR,
          'Content-Type':ct,
          'Cache-Control':'public, max-age=604800, s-maxage=604800, immutable'
        }
      });
      try {
        if (_globalCtx && typeof _globalCtx.waitUntil === 'function') {
          _globalCtx.waitUntil(caches.default.put(req, thumbResp.clone()));
        } else {
          caches.default.put(req, thumbResp.clone()).catch(()=>{});
        }
      } catch(e) {}
      return thumbResp;
    }
  }

  // Fallback for images: if thumbnailLink is not ready or failed, stream directly via alt=media
  const isImageFile = (gData.mimeType && gData.mimeType.startsWith('image/')) || (fileObj && fileObj.mimeType && fileObj.mimeType.startsWith('image/')) || (fileObj && /\.(jpe?g|png|webp|gif)$/i.test(fileObj.name));
  if(isImageFile){
    const imgResp = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(gId)}?alt=media&supportsAllDrives=true`, {
      headers: { Authorization: `Bearer ${at}` }
    });
    if(imgResp.ok){
      const buf = await imgResp.arrayBuffer();
      let ct = imgResp.headers.get('Content-Type') || (fileObj ? fileObj.mimeType : 'image/jpeg');
      if (ct === 'application/octet-stream') ct = 'image/jpeg';
      if (_memThumbCache.size > 400) {
        const first = _memThumbCache.keys().next().value;
        _memThumbCache.delete(first);
      }
      _memThumbCache.set(memKey, { ct, buf });
      const imgThumbResp = new Response(buf, {
        status: 200,
        headers: {
          ...COR,
          'Content-Type': ct,
          'Cache-Control': 'public, max-age=604800, s-maxage=604800, immutable'
        }
      });
      try {
        if (_globalCtx && typeof _globalCtx.waitUntil === 'function') {
          _globalCtx.waitUntil(caches.default.put(req, imgThumbResp.clone()));
        } else {
          caches.default.put(req, imgThumbResp.clone()).catch(()=>{});
        }
      } catch(e) {}
      return imgThumbResp;
    }
  }

  return new Response('Thumbnail not available',{status:404,headers:{...COR,'Cache-Control':'no-cache, no-store, must-revalidate'}});
}

async function hRenameFile(req,env,fileId){
  const ses=await vSes(req,env,null);
  const db=await uGet(env,'td:db');
  if(!db) return J({error:'DB error'},500);
  const file=(db.files||[]).find(f=>f.id===fileId || f.googleFileId===fileId);
  if(!file) return J({error:'File not found'},404);

  const isOpenTarget=isDriveOpen(file.driveId,db);
  if(!ses && !isOpenTarget) return J({error:'Unauthorized'},401);
  if(db.policy && db.policy.allowUserRename === false && ses !== 'admin'){
    return J({error:'Renaming is disabled by administrator'},403);
  }

  if(file.adminOnly && ses !== 'admin') return J({error:'Access denied'},403);
  if(isFolderAccessDenied(file.folderId, db, ses)) return J({error:'Access denied'},403);

  const body=await req.json().catch(()=>({}));
  const newName=(body.name||'').trim();
  if(!newName) return J({error:'New file name is required'},400);

  const drv=(db.drives||[]).find(d=>d.id===file.driveId);
  if(!drv) return J({error:'Drive not found'},404);

  // Update name in Google Drive
  try{
    const at=await gAT(env,drv.encToken);
    await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.googleFileId)}?supportsAllDrives=true`,{
      method:'PATCH',
      headers:{
        Authorization:`Bearer ${at}`,
        'Content-Type':'application/json'
      },
      body:JSON.stringify({name:newName})
    });
  }catch(e){
    console.error('Google Drive rename error:', e);
  }

  const oldName=file.name;
  file.name=newName;

  if(!db.activityLog) db.activityLog=[];
  db.activityLog.unshift({id:uid(),type:'rename',name:newName,oldName,driveId:file.driveId,by:ses||'guest',ts:new Date().toISOString()});
  if(db.activityLog.length>500) db.activityLog=db.activityLog.slice(0,500);

  await uSet(env,'td:db',db);
  return J({ok:true,name:newName});
}

async function hRenameFolder(req,env,folderId){
  const ses=await vSes(req,env,null);
  const db=await uGet(env,'td:db');
  if(!db) return J({error:'DB error'},500);
  const folder=(db.folders||[]).find(f=>f.id===folderId);
  if(!folder) return J({error:'Folder not found'},404);

  const isOpenTarget=isDriveOpen(folder.driveId,db);
  if(!ses && !isOpenTarget) return J({error:'Unauthorized'},401);
  if(db.policy && db.policy.allowUserRename === false && ses !== 'admin'){
    return J({error:'Renaming is disabled by administrator'},403);
  }
  if(folder.adminOnly && ses !== 'admin') return J({error:'Access denied'},403);

  const body=await req.json().catch(()=>({}));
  const newName=(body.name||'').trim();
  if(!newName) return J({error:'New folder name is required'},400);

  const drv=(db.drives||[]).find(d=>d.id===folder.driveId);
  if(drv && folder.googleFolderId){
    try{
      const at=await gAT(env,drv.encToken);
      await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folder.googleFolderId)}?supportsAllDrives=true`,{
        method:'PATCH',
        headers:{
          Authorization:`Bearer ${at}`,
          'Content-Type':'application/json'
        },
        body:JSON.stringify({name:newName})
      });
    }catch(e){
      console.error('Google Drive folder rename error:', e);
    }
  }

  folder.name=newName;
  await uSet(env,'td:db',db);
  return J({ok:true,name:newName});
}

async function hDF(req,env,fileId){
  const db=await uGet(env,'td:db');
  if(!db) return J({error:'DB error'},500);
  const file=(db.files||[]).find(f=>f.id===fileId || f.googleFileId===fileId);
  if(!file) return J({error:'File not found'},404);
  const isOpenTarget=isDriveOpen(file.driveId,db);
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
      const isOpenTarget=isDriveOpen(f.driveId,db);
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
      const isOpenTarget=isDriveOpen(f.driveId,db);
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

async function gDriveBatchDelete(token, googleIds) {
  if (!token || !googleIds || !googleIds.length) return;
  for (let i = 0; i < googleIds.length; i += 50) {
    const chunk = googleIds.slice(i, i + 50);
    const boundary = 'batch_' + Math.random().toString(36).slice(2, 10);
    let body = '';
    chunk.forEach((gId, idx) => {
      body += `--${boundary}\r\nContent-Type: application/http\r\nContent-ID: <item-${idx}>\r\n\r\nDELETE /drive/v3/files/${encodeURIComponent(gId)}?supportsAllDrives=true HTTP/1.1\r\n\r\n`;
    });
    body += `--${boundary}--\r\n`;

    try {
      const resp = await fetch('https://www.googleapis.com/batch/drive/v3', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/mixed; boundary=${boundary}`
        },
        body
      });
      if (!resp.ok) throw new Error('batch delete error');
    } catch(e) {
      await Promise.allSettled(chunk.map(gId =>
        fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(gId)}?supportsAllDrives=true`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` }
        }).catch(()=>{})
      ));
    }
  }
}

// ─── Dedup Folders: merge duplicate folders (same driveId + parentId + name) ───
// Multi-pass approach:
//   Pass 1 dedupes top-level duplicates by (driveId + parentId + name).
//   After each pass, child folders' parentIds are updated to point to winners.
//   Pass 2 now sees children sharing the same winner parentId → correctly identified as dups.
//   Repeats until no more duplicates found (max 20 passes / levels deep).
// NEVER trashes anything on Google Drive — only fixes the DB.
async function hDedupFolders(req, env) {
  if(!await vSes(req, env, 'admin')) return J({error:'Unauthorized'}, 401);
  const body = await req.json().catch(()=>({}));
  const { dryRun = false, driveId: filterDriveId = null } = body;

  const db = await uGet(env, 'td:db');
  if(!db) return J({error:'DB error'}, 500);

  // Work on deep copies so dry-run mutations never touch the real DB objects
  const folders = (db.folders||[]).map(f => ({...f}));
  const files   = (db.files  ||[]).map(f => ({...f}));

  let totalMergedFolders = 0;
  let totalMovedFiles    = 0;
  const mergeLog         = [];
  const allLoserIds      = new Set();

  // Multi-pass loop — each pass resolves one level of the folder tree
  for(let pass = 0; pass < 20; pass++) {
    // Re-compute file counts after each pass (folderId refs may have changed)
    const fileCounts = {};
    for(const fi of files) {
      if(fi.folderId) fileCounts[fi.folderId] = (fileCounts[fi.folderId]||0) + 1;
    }

    // Group by (driveId + parentId + name) — safe: only merges true co-located duplicates
    const groupMap = {};
    for(const f of folders) {
      if(f._remove || f.trashed) continue;
      if(filterDriveId && f.driveId !== filterDriveId) continue;
      const key = (f.driveId||'') + '::' + (f.parentId||'ROOT') + '::' + (f.name||'').toLowerCase().trim();
      if(!groupMap[key]) groupMap[key] = [];
      groupMap[key].push(f);
    }

    const dupGroups = Object.values(groupMap).filter(g => g.length > 1);
    if(dupGroups.length === 0) break; // no more duplicates at any level — done

    for(const group of dupGroups) {
      // Winner = folder with most associated files; tie-break: has googleFolderId, then oldest id
      const sorted = [...group].sort((a, b) => {
        const fc = (fileCounts[b.id]||0) - (fileCounts[a.id]||0);
        if(fc !== 0) return fc;
        if(b.googleFolderId && !a.googleFolderId) return 1;
        if(a.googleFolderId && !b.googleFolderId) return -1;
        return (a.id||'').localeCompare(b.id||'');
      });
      const winner    = sorted[0];
      const loserList = sorted.slice(1);

      // Winner steals googleFolderId from loser if it lacks one
      if(!winner.googleFolderId) {
        const withG = loserList.find(l => l.googleFolderId);
        if(withG) winner.googleFolderId = withG.googleFolderId;
      }

      for(const loser of loserList) {
        let movedFiles = 0;
        // Re-parent all files from loser → winner
        for(const fi of files) {
          if(fi.folderId === loser.id) { fi.folderId = winner.id; movedFiles++; }
        }
        // Re-parent child folders whose parentId pointed to loser → now points to winner
        // This is what makes the NEXT pass work correctly (children now share winner's parentId)
        for(const fo of folders) {
          if(fo.parentId === loser.id && !fo._remove && !fo.trashed) fo.parentId = winner.id;
        }
        loser._remove = true;
        allLoserIds.add(loser.id);
        totalMergedFolders++;
        totalMovedFiles += movedFiles;
        mergeLog.push({pass, kept: winner.name, keptId: winner.id, removedId: loser.id, movedFiles});
      }
    }
  }

  if(totalMergedFolders === 0) {
    return J({ok:true, message:'No duplicate folders found', merged:0, dryRun});
  }

  if(dryRun) {
    return J({ok:true, dryRun:true,
      duplicateGroups: new Set(mergeLog.map(m => m.keptId)).size,
      wouldMergeFolders: totalMergedFolders,
      wouldMoveFiles:    totalMovedFiles,
      log: mergeLog
    });
  }

  // Apply changes to the REAL DB objects (not the copies)
  // Build lookup of working copies by id
  const workingById = {};
  for(const f of folders) workingById[f.id] = f;
  const workingFileById = {};
  for(const fi of files) workingFileById[fi.id] = fi;

  // Update parentId and googleFolderId on real DB folders
  for(const fo of (db.folders||[])) {
    const w = workingById[fo.id];
    if(w) { fo.parentId = w.parentId; fo.googleFolderId = w.googleFolderId; }
  }
  // Update folderId on real DB files
  for(const fi of (db.files||[])) {
    const w = workingFileById[fi.id];
    if(w) fi.folderId = w.folderId;
  }
  // Remove losers from DB
  db.folders = (db.folders||[]).filter(f => !allLoserIds.has(f.id));

  if(!db.activityLog) db.activityLog = [];
  db.activityLog.unshift({id:uid(),type:'dedup_folders',mergedFolders:totalMergedFolders,movedFiles:totalMovedFiles,ts:new Date().toISOString()});
  if(_memDBCache) { _memDBCache.folders = db.folders; _memDBCache.files = db.files; }
  await uSet(env, 'td:db', db);

  return J({ok:true, merged: totalMergedFolders, movedFiles: totalMovedFiles,
    message: `Merged ${totalMergedFolders} duplicate folder(s), moved ${totalMovedFiles} file(s) to winners. No Drive folders were touched.`,
    updatedFolders: db.folders,
    updatedFiles:   db.files
  });
}

// ─── Restore Drive Folders: untrash all folders tracked in DB from Google Drive ───
// Restores any folders accidentally trashed by dedup or manual deletion
async function hRestoreDriveFolders(req, env) {
  if(!await vSes(req, env, 'admin')) return J({error:'Unauthorized'}, 401);
  const body = await req.json().catch(()=>({}));
  const { driveId: filterDriveId = null } = body;

  const db = await uGet(env, 'td:db');
  if(!db) return J({error:'DB error'}, 500);

  const folders = (db.folders||[]).filter(f => f.googleFolderId && (!filterDriveId || f.driveId === filterDriveId));
  if(!folders.length) return J({ok:true, restored:0, message:'No folders with googleFolderId found'});

  // Group by driveId to reuse access tokens
  const byDrive = {};
  for(const f of folders) {
    if(!byDrive[f.driveId]) byDrive[f.driveId] = [];
    byDrive[f.driveId].push(f);
  }

  let totalRestored = 0;
  let totalFailed = 0;
  const errors = [];

  for(const [dId, dFolders] of Object.entries(byDrive)) {
    const drv = (db.drives||[]).find(d => d.id === dId);
    if(!drv) continue;
    let at;
    try { at = await gAT(env, drv.encToken); }
    catch(e) { try { at = await gAT(env, drv.encToken, true); } catch(e2) { errors.push('Token error for drive '+dId); continue; } }

    for(const folder of dFolders) {
      try {
        const res = await fetch(
          `https://www.googleapis.com/drive/v3/files/${folder.googleFolderId}?supportsAllDrives=true`,
          { method:'PATCH', headers:{'Authorization':`Bearer ${at}`,'Content-Type':'application/json'}, body:JSON.stringify({trashed:false}) }
        );
        if(res.ok) { totalRestored++; }
        else { totalFailed++; }
      } catch(e) { totalFailed++; }
    }
  }

  return J({ok:true, restored:totalRestored, failed:totalFailed,
    message:`Restored ${totalRestored} folder(s) from Google Drive Trash. ${totalFailed} failed (may not have been trashed).`
  });
}





// ─── Fix Folder Locations: move Drive folders back to their correct parent ───
// Finds folders tracked in DB but living at the wrong location on Google Drive.
// Uses addParents/removeParents to move them to the correct parent's googleFolderId.
async function hFixFolderLocations(req, env) {
  if(!await vSes(req, env, 'admin')) return J({error:'Unauthorized'}, 401);
  const body = await req.json().catch(()=>({}));
  const { driveId: filterDriveId = null, dryRun = false } = body;

  const db = await uGet(env, 'td:db');
  if(!db) return J({error:'DB error'}, 500);

  const folders = db.folders || [];

  // Build lookup: folderId → googleFolderId
  const idToGoogleId = {};
  for(const f of folders) {
    if(f.id && f.googleFolderId) idToGoogleId[f.id] = f.googleFolderId;
  }

  // Only process folders with googleFolderId AND whose parent also has googleFolderId
  const toFix = folders.filter(f => {
    if(!f.googleFolderId || !f.parentId) return false;
    if(filterDriveId && f.driveId !== filterDriveId) return false;
    return !!idToGoogleId[f.parentId];
  });

  if(!toFix.length) return J({ok:true, fixed:0, dryRun, message:'No folders with known parent Google IDs found'});
  if(dryRun) return J({ok:true, dryRun:true, willCheck:toFix.length, message:`Will verify ${toFix.length} folder(s) on Google Drive`});

  // Group by driveId to reuse access tokens
  const byDrive = {};
  for(const f of toFix) {
    if(!byDrive[f.driveId]) byDrive[f.driveId] = [];
    byDrive[f.driveId].push(f);
  }

  let fixed = 0, skipped = 0, failed = 0;
  for(const [dId, dFolders] of Object.entries(byDrive)) {
    const drv = (db.drives||[]).find(d => d.id === dId);
    if(!drv) continue;
    let at;
    try { at = await gAT(env, drv.encToken); }
    catch(e) { try { at = await gAT(env, drv.encToken, true); } catch(e2) { failed += dFolders.length; continue; } }

    for(const folder of dFolders) {
      const expectedParentGId = idToGoogleId[folder.parentId];
      try {
        // Untrash + check current parents
        const infoRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${folder.googleFolderId}?fields=parents,trashed&supportsAllDrives=true`,
          { headers:{Authorization:`Bearer ${at}`} }
        );
        if(!infoRes.ok) { failed++; continue; }
        const info = await infoRes.json();
        if(info.trashed) {
          await fetch(`https://www.googleapis.com/drive/v3/files/${folder.googleFolderId}?supportsAllDrives=true`,
            { method:'PATCH', headers:{'Authorization':`Bearer ${at}`,'Content-Type':'application/json'}, body:'{"trashed":false}' }
          ).catch(()=>{});
        }
        const curParents = info.parents || [];
        if(curParents.includes(expectedParentGId)) { skipped++; continue; }
        // Move to correct parent
        const removeP = curParents.join(',');
        const url = `https://www.googleapis.com/drive/v3/files/${folder.googleFolderId}?addParents=${expectedParentGId}${removeP?'&removeParents='+removeP:''}&supportsAllDrives=true&fields=id`;
        const moveRes = await fetch(url, { method:'PATCH', headers:{'Authorization':`Bearer ${at}`,'Content-Type':'application/json'}, body:'{}' });
        if(moveRes.ok) fixed++; else failed++;
      } catch(e) { failed++; }
    }
  }
  return J({ok:true, fixed, skipped, failed, message:`Moved ${fixed} folder(s) to correct location on Drive. ${skipped} already correct. ${failed} failed.`});
}

// ─── Debug DB & Auto Clean Tera Endpoint ───
async function hDebugDB(req, env) {
  const url = new URL(req.url);
  if (url.searchParams.get('key') !== 'tobi2026') return J({error:'Unauthorized'}, 401);
  const db = await uGet(env, 'td:db');
  if (!db) return J({error:'No DB'}, 500);

  const action = url.searchParams.get('action') || 'view';

  if (action === 'view') {
    const kv = getKV(env);
    const tera = (db.folders||[]).filter(f => (f.name||'').toLowerCase() === 'tera');
    const teraChildren = (db.folders||[]).filter(f => tera.some(t => t.id === f.parentId));
    const teraFiles = (db.files||[]).filter(f => tera.some(t => t.id === f.folderId));
    return J({
      _dbVer: db._dbVer,
      envKeys: Object.keys(env),
      hasKV: !!kv,
      lastUSetStatus: _lastUSetStatus,
      totalFolders: (db.folders||[]).length,
      totalFiles: (db.files||[]).length,
      drives: (db.drives||[]).map(d => ({id:d.id, name:d.name, email:d.email, rootFolderId:d.rootFolderId})),
      teraFolders: tera,
      teraChildren: teraChildren.map(f => ({id:f.id, name:f.name, parentId:f.parentId, googleFolderId:f.googleFolderId, files:(db.files||[]).filter(x=>x.folderId===f.id).length})),
      teraFiles: teraFiles.map(f => ({id:f.id, name:f.name, size:f.size})),
      allFolders: (db.folders||[]).map(f => ({id:f.id, name:f.name, parentId:f.parentId, googleFolderId:f.googleFolderId}))
    });
  if (action === 'kenjalgad-detail') {
    const kenjFolders = (db.folders||[]).filter(f => (f.name||'').toLowerCase().includes('kenj'));
    const kenjFiles = (db.files||[]).filter(f => kenjFolders.some(k => k.id === f.folderId));
    const allDrive2Files = (db.files||[]).filter(f => f.driveId === 'mv3txae19acz2');
    const allDrive2Folders = (db.folders||[]).filter(f => f.driveId === 'mv3txae19acz2');
    
    // Also fetch files from Google Drive under both Kenjalgad folders to see what GDrive has
    const gdResults = {};
    for (const kf of kenjFolders) {
      const drv = (db.drives||[]).find(d => d.id === kf.driveId) || (db.drives||[])[0];
      if (drv && drv.encToken && kf.googleFolderId) {
        try {
          const at = await gAT(env, drv.encToken);
          const u = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${kf.googleFolderId}' in parents and trashed = false`)}&fields=files(id,name,mimeType,size)&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true`;
          const r = await fetch(u, { headers: { Authorization: `Bearer ${at}` } });
          const d = await r.json();
          gdResults[kf.name + ' (' + kf.googleFolderId + ')'] = d.files || d;
        } catch(e) {
          gdResults[kf.name] = { error: e.message };
        }
      }
    }

    return J({
      kenjFolders,
      kenjFilesCount: kenjFiles.length,
      kenjFilesSample: kenjFiles.slice(0, 10).map(f => ({ id: f.id, name: f.name, folderId: f.folderId, driveId: f.driveId })),
      drive2: {
        id: 'mv3txae19acz2',
        totalFolders: allDrive2Folders.length,
        totalFiles: allDrive2Files.length,
        rootFiles: allDrive2Files.filter(f => !f.folderId).length,
        folders: allDrive2Folders.map(f => ({ id: f.id, name: f.name, parentId: f.parentId, googleFolderId: f.googleFolderId, files: allDrive2Files.filter(fi => fi.folderId === f.id).length }))
      },
      gdResults
    });
  }

  if (action === 'drives-summary') {
    const summary = (db.drives||[]).map(d => {
      const dFolders = (db.folders||[]).filter(f => f.driveId === d.id && !f.trashed);
      const dFiles = (db.files||[]).filter(f => f.driveId === d.id && !f.trashed);
      const rootFiles = dFiles.filter(f => !f.folderId);
      const folderBreakdown = dFolders.map(f => ({
        id: f.id,
        name: f.name,
        parentId: f.parentId,
        googleFolderId: f.googleFolderId,
        filesCount: dFiles.filter(fi => fi.folderId === f.id).length
      }));
      return {
        id: d.id,
        name: d.name,
        email: d.email,
        rootFolderId: d.rootFolderId,
        totalFolders: dFolders.length,
        totalFiles: dFiles.length,
        rootFilesCount: rootFiles.length,
        folders: folderBreakdown
      };
    });
    return J({ drives: summary });
  }

  if (action === 'analyze-tera-status') {
    const drvId = 'mv3st1820rife';
    const tera = (db.folders||[]).find(f => (f.name||'').toLowerCase() === 'tera' && f.driveId === drvId);
    const subtreeFolderIds = new Set();
    if (tera) {
      subtreeFolderIds.add(tera.id);
      let added;
      do {
        added = false;
        for (const sf of (db.folders||[])) {
          if (sf.driveId === drvId && !sf.trashed && sf.parentId && subtreeFolderIds.has(sf.parentId)) {
            if (!subtreeFolderIds.has(sf.id)) {
              subtreeFolderIds.add(sf.id);
              added = true;
            }
          }
        }
      } while (added);
    }

    const folderMap = new Map();
    (db.folders||[]).forEach(f => folderMap.set(f.id, f));

    const folderCounts = {};
    let filesInSubtree = 0;
    let filesNotInSubtree = 0;
    let filesInRoot = 0;
    let aaaaaZip = null;

    for (const f of (db.files||[])) {
      if (f.trashed || f.driveId !== drvId) continue;
      if (f.name && f.name.includes('aaaaa')) {
        aaaaaZip = f;
      }
      if (!f.folderId) {
        filesInRoot++;
      } else if (subtreeFolderIds.has(f.folderId)) {
        filesInSubtree++;
        const fld = folderMap.get(f.folderId);
        const fldName = fld ? fld.name : f.folderId;
        folderCounts[fldName] = (folderCounts[fldName] || 0) + 1;
      } else {
        filesNotInSubtree++;
        const fld = folderMap.get(f.folderId);
        const fldName = fld ? fld.name : f.folderId;
        folderCounts['OTHER: ' + fldName] = (folderCounts['OTHER: ' + fldName] || 0) + 1;
      }
    }

    return J({
      teraFolderId: tera ? tera.id : null,
      teraGoogleFolderId: tera ? tera.googleFolderId : null,
      subtreeFoldersCount: subtreeFolderIds.size,
      totalFilesInDrive: (db.files||[]).filter(f => f.driveId === drvId && !f.trashed).length,
      filesInSubtree,
      filesNotInSubtree,
      filesInRoot,
      folderCounts,
      aaaaaZip,
      allFiles: (db.files||[]).filter(f => f.driveId === drvId && !f.trashed).map(f => ({ name: f.name, size: f.size, folderId: f.folderId }))
    });
  }

  if (action === 'root-files') {
    const rootFiles = (db.files||[]).filter(f => !f.folderId && !f.trashed && f.driveId === 'mv3st1820rife');
    return J({
      count: rootFiles.length,
      files: rootFiles.map(f => ({ id: f.id, googleFileId: f.googleFileId, name: f.name, size: f.size }))
    });
  }

  if (action === 'relocate-root-files') {
    const drv = (db.drives||[]).find(d => d.id === 'mv3st1820rife') || (db.drives||[])[0];
    if (!drv) return J({error:'No drive'}, 400);

    const videoNames = new Set([
      "iphone 1797.MOV", "iphone 1768.MOV", "iphone 1759.MOV", "iphone 1753.MOV",
      "iphone 1752.MOV", "iphone 1750.MOV", "iphone 1648.MP4", "iphone 1647.MOV",
      "iphone 1644.MOV", "iphone 1643.MOV"
    ]);

    const whatsappFolder = (db.folders||[]).find(f => f.name === 'WhatsApp document' && !f.trashed) || { id: 'mvap0ja7l49aw', googleFolderId: '1ifs-Tccb6631E7rw7vrlBRi9G44OPw0e' };
    const videoFolder = (db.folders||[]).find(f => f.name === 'Videos' && !f.trashed) || { id: 'mv7ehyiuz8udd', googleFolderId: '1Ez5Ck-9jo1OdmcoC1BVepKnYTNyinX0I' };

    let toWhatsApp = 0;
    let toVideos = 0;
    let removedDbJson = 0;
    const cleanFiles = [];
    const filesToMoveOnGDrive = [];

    for (const f of (db.files||[])) {
      if (!f) continue;
      if (f.name === '__teledrive_db__.json') {
        removedDbJson++;
        continue;
      }
      if (!f.folderId && !f.trashed && f.driveId === drv.id) {
        if (videoNames.has(f.name)) {
          f.folderId = videoFolder.id;
          toVideos++;
          filesToMoveOnGDrive.push({
            id: f.id,
            googleFileId: f.googleFileId,
            name: f.name,
            targetGoogleFolderId: videoFolder.googleFolderId
          });
        } else {
          f.folderId = whatsappFolder.id;
          toWhatsApp++;
          filesToMoveOnGDrive.push({
            id: f.id,
            googleFileId: f.googleFileId,
            name: f.name,
            targetGoogleFolderId: whatsappFolder.googleFolderId
          });
        }
      }
      cleanFiles.push(f);
    }

    db.files = cleanFiles;
    await uSet(env, 'td:db', db);

    let at = '';
    try { at = await gAT(env, drv.encToken); } catch(e){}

    return J({
      ok: true,
      relocatedToWhatsApp: toWhatsApp,
      relocatedToVideos: toVideos,
      removedDbJson,
      rootFolderId: drv.rootFolderId,
      accessToken: at,
      filesToMoveOnGDrive
    });
  }

  if (action === 'get-whatsapp-files') {
    const drv = (db.drives||[]).find(d => d.id === 'mv3st1820rife') || (db.drives||[])[0];
    const whatsappFolder = (db.folders||[]).find(f => f.name === 'WhatsApp document' && !f.trashed) || { id: 'mvap0ja7l49aw', googleFolderId: '1ifs-Tccb6631E7rw7vrlBRi9G44OPw0e' };
    const wFiles = (db.files||[]).filter(f => f.folderId === whatsappFolder.id && !f.trashed);
    let at = '';
    try { at = await gAT(env, drv.encToken); } catch(e){}
    return J({
      count: wFiles.length,
      targetGoogleFolderId: whatsappFolder.googleFolderId,
      accessToken: at,
      files: wFiles.map(f => ({ id: f.id, googleFileId: f.googleFileId, name: f.name }))
    });
  }

  if (action === 'reconcile-tera-tree') {
    const drv = (db.drives||[]).find(d => d.id === 'mv3st1820rife') || (db.drives||[])[0];
    if (!drv || !drv.encToken) return J({error:'No drive'}, 400);
    const at = await gAT(env, drv.encToken);

    // 1. Fetch all folders from Google Drive
    const allGDFolders = [];
    let fPageToken = '';
    do {
      const u = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent("mimeType = 'application/vnd.google-apps.folder' and trashed = false")}&fields=nextPageToken,files(id,name,parents)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true${fPageToken ? `&pageToken=${fPageToken}` : ''}`;
      const fResp = await fetch(u, { headers: { Authorization: `Bearer ${at}` } });
      const fData = await fResp.json();
      if (fData.files) allGDFolders.push(...fData.files);
      fPageToken = fData.nextPageToken || '';
    } while (fPageToken);

    const teraRootGId = '1okbyFLXY5lhbBp6_WKqntwBZNrIjqERf';
    const teraLocalId = 'mv73d3n3g2wy8';

    // 2. Build map of real Google Drive folder paths under tera
    const gFolderMap = new Map();
    allGDFolders.forEach(gf => gFolderMap.set(gf.id, gf));

    function getGDPath(gId) {
      if (gId === teraRootGId) return 'tera';
      const gf = gFolderMap.get(gId);
      if (!gf || !gf.parents || !gf.parents[0]) return null;
      const parentPath = getGDPath(gf.parents[0]);
      if (!parentPath) return null;
      return parentPath + '/' + gf.name.trim();
    }

    const gdPathToGId = new Map();
    const realSubtreeGIds = new Set([teraRootGId]);
    for (const gf of allGDFolders) {
      const p = getGDPath(gf.id);
      if (p) {
        gdPathToGId.set(p.toLowerCase(), gf.id);
        realSubtreeGIds.add(gf.id);
      }
    }

    // 3. Match and repair db.folders
    function getDBPath(fId) {
      if (fId === teraLocalId) return 'tera';
      const f = (db.folders||[]).find(x => x.id === fId);
      if (!f || !f.parentId) return null;
      const parentPath = getDBPath(f.parentId);
      if (!parentPath) return null;
      return parentPath + '/' + f.name.trim();
    }

    let foldersRepaired = 0;
    const realGIdToLocalId = new Map();
    realGIdToLocalId.set(teraRootGId, teraLocalId);

    for (const f of (db.folders||[])) {
      if (f.id === teraLocalId) {
        f.googleFolderId = teraRootGId;
        continue;
      }
      const p = getDBPath(f.id);
      if (p) {
        const matchingGId = gdPathToGId.get(p.toLowerCase());
        if (matchingGId) {
          if (f.googleFolderId !== matchingGId) {
            f.googleFolderId = matchingGId;
            foldersRepaired++;
          }
          realGIdToLocalId.set(matchingGId, f.id);
        }
      }
    }

    // 4. Fetch all files from Google Drive
    const allGDFiles = [];
    let filePageToken = '';
    let fileFetches = 0;
    do {
      const u = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent("mimeType != 'application/vnd.google-apps.folder' and trashed = false")}&fields=nextPageToken,files(id,name,size,mimeType,parents,createdTime)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true${filePageToken ? `&pageToken=${filePageToken}` : ''}`;
      const resp = await fetch(u, { headers: { Authorization: `Bearer ${at}` } });
      const data = await resp.json();
      if (data.files) allGDFiles.push(...data.files);
      filePageToken = data.nextPageToken || '';
      fileFetches++;
    } while (filePageToken && fileFetches < 10);

    // 5. Reconcile all files in db.files
    const existingFileByGId = new Map();
    for (const f of (db.files||[])) {
      if (f.googleFileId) existingFileByGId.set(f.googleFileId, f);
    }

    let filesReconciled = 0;
    let filesAdded = 0;
    const cleanFiles = [];

    for (const gf of allGDFiles) {
      if (gf.name === '__teledrive_db__.json') continue;
      if (!gf.parents || !gf.parents.some(p => realSubtreeGIds.has(p))) continue;
      const parentGId = gf.parents.find(p => realSubtreeGIds.has(p));
      const targetLocalFolderId = realGIdToLocalId.get(parentGId) || teraLocalId;

      let ef = existingFileByGId.get(gf.id);
      if (ef) {
        if (ef.folderId !== targetLocalFolderId) {
          ef.folderId = targetLocalFolderId;
          filesReconciled++;
        }
        cleanFiles.push(ef);
      } else {
        const newFile = {
          id: uid(),
          googleFileId: gf.id,
          driveId: drv.id,
          folderId: targetLocalFolderId,
          name: gf.name,
          size: parseInt(gf.size) || 0,
          mimeType: gf.mimeType || 'application/octet-stream',
          uploadedBy: 'tree-reconcile',
          date: gf.createdTime || new Date().toISOString()
        };
        cleanFiles.push(newFile);
        existingFileByGId.set(gf.id, newFile);
        filesAdded++;
      }
    }

    // Keep non-tera files as well
    for (const f of (db.files||[])) {
      if (f.name === '__teledrive_db__.json') continue;
      if (f.googleFileId && existingFileByGId.has(f.googleFileId)) continue;
      cleanFiles.push(f);
    }

    db.files = cleanFiles;
    await uSet(env, 'td:db', db);

    return J({
      ok: true,
      totalGDFolders: allGDFolders.length,
      teraRealSubtreeFolders: realSubtreeGIds.size,
      foldersRepaired,
      totalGDFilesInTera: allGDFiles.filter(f => f.parents && f.parents.some(p => realSubtreeGIds.has(p))).length,
      filesReconciled,
      filesAdded,
      totalFilesInDB: db.files.length,
      filesInRootNow: db.files.filter(f => !f.folderId && !f.trashed && f.driveId === drv.id).length
    });
  }



  if (action === 'read-gdrive-db') {
    const drv = (db.drives||[])[0];
    const gdb = await loadDBFromGDrive(env, drv);
    const gTeraFolders = gdb ? (gdb.folders||[]).filter(f => f.parentId === 'mv73d3n3g2wy8') : [];
    const gTeraFiles = gdb ? (gdb.files||[]).filter(f => f.folderId === 'mv73d3n3g2wy8') : [];
    return J({
      ok: !!gdb,
      _dbVer: gdb ? gdb._dbVer : null,
      gDriveFileId: _gdriveDbFileId,
      foldersCount: gTeraFolders.length,
      filesCount: gTeraFiles.length,
      folders: gTeraFolders.map(f => f.name),
      files: gTeraFiles.map(f => f.name)
    });
  }

  if (action === 'scan-gdrive') {
    if (!db.drives || !db.drives.length) return J({error:'No drives connected'}, 400);
    if (!db.files) db.files = [];
    if (!db.folders) db.folders = [];

    let totalFetched = 0;
    let missingImportedCount = 0;
    const existingGIds = new Set((db.files||[]).map(f => f.googleFileId).filter(Boolean));

    for (const drv of db.drives) {
      if (!drv || !drv.encToken) continue;
      try {
        const at = await gAT(env, drv.encToken);
        let pageToken = '';
        const fetchedGoogleFiles = [];
        let pageCount = 0;
        do {
          const u = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent("mimeType != 'application/vnd.google-apps.folder' and trashed = false")}&fields=nextPageToken,files(id,name,size,mimeType,parents,createdTime)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true${pageToken ? `&pageToken=${pageToken}` : ''}`;
          const resp = await fetch(u, { headers: { Authorization: `Bearer ${at}` } });
          if (!resp.ok) break;
          const data = await resp.json();
          if (data.files) fetchedGoogleFiles.push(...data.files);
          pageToken = data.nextPageToken || '';
          pageCount++;
        } while (pageToken && pageCount < 10);

        totalFetched += fetchedGoogleFiles.length;
        const missingInDB = fetchedGoogleFiles.filter(gf => !existingGIds.has(gf.id));

        if (missingInDB.length > 0) {
          const gToLocalFold = new Map();
          (db.folders||[]).forEach(f => { if (f.googleFolderId && f.driveId === drv.id) gToLocalFold.set(f.googleFolderId, f.id); });
          missingInDB.forEach(gf => {
            const parentGId = (gf.parents && gf.parents[0]) || null;
            const localFoldId = parentGId ? (gToLocalFold.get(parentGId) || null) : null;
            const newF = {
              id: uid(),
              googleFileId: gf.id,
              driveId: drv.id,
              folderId: localFoldId,
              name: gf.name,
              size: parseInt(gf.size) || 0,
              mimeType: gf.mimeType || 'application/octet-stream',
              uploadedBy: 'sync-recovery',
              date: gf.createdTime || new Date().toISOString()
            };
            db.files.push(newF);
            existingGIds.add(gf.id);
          });
          missingImportedCount += missingInDB.length;
        }
      } catch(e) {
        console.error('scan-gdrive drive error:', drv.id, e);
      }
    }

    if (missingImportedCount > 0) {
      await uSet(env, 'td:db', db);
    }

    return J({
      totalOnGoogleDrive: totalFetched,
      missingImportedCount: missingImportedCount,
      nowInDB: (db.files||[]).length
    });
  }

  if (action === 'dedup-files') {
    if (!db.files) db.files = [];
    const seenGoogleIds = new Set();
    const seenKeys = new Set();
    const cleanFiles = [];
    let dupsRemoved = 0;

    for (const f of db.files) {
      if (!f) continue;
      if (f.googleFileId) {
        if (seenGoogleIds.has(f.googleFileId)) {
          dupsRemoved++;
          continue;
        }
        seenGoogleIds.add(f.googleFileId);
      }
      const k = (f.folderId || '') + '::' + (f.name || '').toLowerCase().trim() + '::' + (f.size || 0);
      if (seenKeys.has(k)) {
        dupsRemoved++;
        continue;
      }
      seenKeys.add(k);
      cleanFiles.push(f);
    }
    db.files = cleanFiles;
    await uSet(env, 'td:db', db);

    const tera = (db.folders||[]).find(f => (f.name||'').toLowerCase() === 'tera');
    const subtreeFolderIds = new Set(tera ? [tera.id] : []);
    let added = true;
    while(added) {
      added = false;
      (db.folders||[]).forEach(f => {
        if (!subtreeFolderIds.has(f.id) && f.parentId && subtreeFolderIds.has(f.parentId)) {
          subtreeFolderIds.add(f.id);
          added = true;
        }
      });
    }

    const teraSubtreeFiles = cleanFiles.filter(f => subtreeFolderIds.has(f.folderId));
    return J({
      totalFilesBefore: cleanFiles.length + dupsRemoved,
      dupsRemoved,
      totalFilesNow: cleanFiles.length,
      teraSubtreeFoldersCount: subtreeFolderIds.size,
      teraSubtreeFilesCount: teraSubtreeFiles.length
    });
  }

  if (action === 'auto-clean-tera') {
    const drv = (db.drives||[])[0];
    let gdb = null;
    if (drv) {
      try { gdb = await loadDBFromGDrive(env, drv); } catch(e){}
    }
    const targetDb = gdb || db;

    // Step 1: Remove exact duplicate objects by folder ID
    const seenFolderIds = new Set();
    const uniqueFolders = [];
    for (const f of (targetDb.folders || [])) {
      if (f && f.id && !seenFolderIds.has(f.id)) {
        seenFolderIds.add(f.id);
        uniqueFolders.push(f);
      }
    }
    targetDb.folders = uniqueFolders;

    // Step 2: Canonical tera folder is mv73d3n3g2wy8 (or the one named 'tera' at root)
    let canonicalTera = (targetDb.folders||[]).find(f => f.id === 'mv73d3n3g2wy8');
    if (!canonicalTera) {
      canonicalTera = (targetDb.folders||[]).find(f => (f.name||'').toLowerCase() === 'tera' && !f.parentId && !f.trashed);
    }
    if (!canonicalTera) return J({error: 'Canonical tera folder not found'}, 404);

    const teraId = canonicalTera.id;

    // Step 3: Any OTHER folder named 'tera' at root is a duplicate -> merge into canonicalTera
    const duplicateTeras = (targetDb.folders||[]).filter(f => (f.name||'').toLowerCase() === 'tera' && f.id !== teraId);
    for (const dt of duplicateTeras) {
      (targetDb.folders||[]).forEach(f => {
        if (f.parentId === dt.id) f.parentId = teraId;
      });
      (targetDb.files||[]).forEach(f => {
        if (f.folderId === dt.id) f.folderId = teraId;
      });
    }
    const dupTeraIds = new Set(duplicateTeras.map(t => t.id));
    targetDb.folders = (targetDb.folders||[]).filter(f => !dupTeraIds.has(f.id));

    // Step 4: Safely deduplicate children directly inside canonicalTera by name
    const children = (targetDb.folders||[]).filter(f => f.parentId === teraId);
    const byName = {};
    for (const c of children) {
      const k = (c.name||'').toLowerCase().trim();
      if (!byName[k]) byName[k] = [];
      byName[k].push(c);
    }

    const fileCounts = {};
    for (const fi of (targetDb.files||[])) {
      if (fi.folderId) fileCounts[fi.folderId] = (fileCounts[fi.folderId]||0) + 1;
    }

    let mergedCount = 0;
    const toRemoveIds = new Set();

    for (const [k, group] of Object.entries(byName)) {
      if (group.length <= 1) continue;

      // Sort: most files desc, then has googleFolderId, then newest ID (mvap > mv7 > mv3)
      group.sort((a, b) => {
        const fc = (fileCounts[b.id]||0) - (fileCounts[a.id]||0);
        if (fc !== 0) return fc;
        if (b.googleFolderId && !a.googleFolderId) return 1;
        if (a.googleFolderId && !b.googleFolderId) return -1;
        return (b.id||'').localeCompare(a.id||''); // Newest ID wins
      });

      const winner = group[0];
      const losers = group.slice(1);

      if (!winner.googleFolderId) {
        const withG = losers.find(l => l.googleFolderId);
        if (withG) winner.googleFolderId = withG.googleFolderId;
      }

      for (const loser of losers) {
        if (loser.id === winner.id) continue;
        for (const fi of (targetDb.files||[])) {
          if (fi.folderId === loser.id) fi.folderId = winner.id;
        }
        for (const fo of (targetDb.folders||[])) {
          if (fo.parentId === loser.id) fo.parentId = winner.id;
        }
        toRemoveIds.add(loser.id);
        mergedCount++;
      }
    }

    targetDb.folders = (targetDb.folders||[]).filter(f => !toRemoveIds.has(f.id) && !f.trashed);

    targetDb._dbVer = Math.max((_memDBCacheVer || 0), (targetDb._dbVer || 0)) + 10;
    _memDBCacheVer = targetDb._dbVer;
    _memDBCache = targetDb;
    await uSet(env, 'td:db', targetDb);
    const gDriveBackupId = await saveDBToGDrive(env, targetDb);

    const finalTeraFolders = (targetDb.folders||[]).filter(f => f.parentId === teraId && !f.trashed);
    const finalTeraFiles   = (targetDb.files||[]).filter(f => f.folderId === teraId && !f.trashed);

    return J({
      ok: true,
      mergedCount,
      gDriveBackupId,
      teraFolderId: teraId,
      foldersCount: finalTeraFolders.length,
      filesCount: finalTeraFiles.length,
      folders: finalTeraFolders.map(f => ({
        id: f.id,
        name: f.name,
        googleFolderId: f.googleFolderId,
        files: (targetDb.files||[]).filter(x => x.folderId === f.id).length
      })),
      files: finalTeraFiles.map(f => ({ name: f.name, size: f.size }))
    });
  }

  if (action === 'clean-stray-tera-folders') {
    const drv = (db.drives||[])[0];
    let gdb = null;
    if (drv) {
      try { gdb = await loadDBFromGDrive(env, drv); } catch(e){}
    }
    const targetDb = gdb || db;
    const canonicalNames = new Set([
      'act class', 'b.y vlogs', 'build', 'clg crazy videos!',
      'close friends photos', 'days', 'dcim', 'group photos',
      'imagine', 'old backup', 'one plus', 'photos 111',
      'screen recorder', 'singing', 'steaxs filters pack - charlie',
      't', 'trip', 'well its'
    ]);
    const tera = (targetDb.folders||[]).find(f => f.id === 'mv73d3n3g2wy8');
    if (!tera) return J({error:'Tera folder not found'}, 404);

    const strays = (targetDb.folders||[]).filter(f => f.parentId === tera.id && !canonicalNames.has((f.name||'').toLowerCase().trim()));
    const strayIds = new Set(strays.map(s => s.id));

    if (drv && drv.encToken && strays.length > 0) {
      try {
        const at = await gAT(env, drv.encToken);
        for (const s of strays) {
          if (s.googleFolderId) {
            await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(s.googleFolderId)}?supportsAllDrives=true`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${at}` }
            }).catch(()=>{});
          }
        }
      } catch(e){}
    }

    targetDb.folders = (targetDb.folders||[]).filter(f => !strayIds.has(f.id));
    targetDb._dbVer = Math.max((_memDBCacheVer || 0), (targetDb._dbVer || 0)) + 10;
    _memDBCacheVer = targetDb._dbVer;
    _memDBCache = targetDb;
    await uSet(env, 'td:db', targetDb);
    const gDriveBackupId = await saveDBToGDrive(env, targetDb);

    const remainingFolders = (targetDb.folders||[]).filter(f => f.parentId === tera.id && !f.trashed);
    const remainingFiles = (targetDb.files||[]).filter(f => f.folderId === tera.id && !f.trashed);

    return J({
      ok: true,
      removedStrays: strays.map(s => ({ id: s.id, name: s.name, googleFolderId: s.googleFolderId })),
      remainingFoldersCount: remainingFolders.length,
      remainingFilesCount: remainingFiles.length,
      totalTeraItems: remainingFolders.length + remainingFiles.length,
      folders: remainingFolders.map(f => f.name),
      gDriveBackupId
    });
  }

  if (action === 'check-gdrive-file') {
    const fileId = url.searchParams.get('id');
    const drv = (db.drives||[])[0];
    const at = await gAT(env, drv.encToken);
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,parents,trashed,mimeType&supportsAllDrives=true`, {
      headers: { Authorization: `Bearer ${at}` }
    });
    const data = await res.json().catch(()=>({}));
    return J({ status: res.status, data });
  }

  if (action === 'list-root-files') {
    const drv = (db.drives||[])[0];
    const at = await gAT(env, drv.encToken);
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${drv.rootFolderId}' in parents and trashed = false`)}&fields=files(id,name,mimeType,parents,size)&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true`, {
      headers: { Authorization: `Bearer ${at}` }
    });
    const data = await res.json().catch(()=>({}));
    return J(data);
  }

  if (action === 'list-tera-gdrive') {
    const drv = (db.drives||[])[0];
    const at = await gAT(env, drv.encToken);
    const tera = (db.folders||[]).find(f => f.id === 'mv73d3n3g2wy8');
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${tera.googleFolderId}' in parents and trashed = false`)}&fields=files(id,name,mimeType,parents,size)&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true`, {
      headers: { Authorization: `Bearer ${at}` }
    });
    const data = await res.json().catch(()=>({}));
    return J(data);
  }

  if (action === 'inspect-folder') {
    const targetFolderId = url.searchParams.get('folderId');
    const folderFiles = (db.files||[]).filter(f => f.folderId === targetFolderId && !f.trashed);
    const groups = {};
    for (const f of folderFiles) {
      const k = (f.name||'').toLowerCase().trim() + '::' + (f.size||0);
      if (!groups[k]) groups[k] = [];
      groups[k].push({ id: f.id, googleFileId: f.googleFileId, name: f.name, size: f.size, date: f.date });
    }
    const dups = Object.entries(groups).filter(([k, g]) => g.length > 1);
    return J({
      folderId: targetFolderId,
      totalFiles: folderFiles.length,
      duplicateGroups: dups.length,
      duplicates: dups.map(([k, g]) => ({ key: k, count: g.length, files: g }))
    });
  }

  if (action === 'auto-dedup-files') {
    const drv = (db.drives||[])[0];
    let gdb = null;
    if (drv) {
      try { gdb = await loadDBFromGDrive(env, drv); } catch(e){}
    }
    const targetDb = (gdb && (gdb._dbVer || 0) > (db._dbVer || 0)) ? gdb : db;
    if (!targetDb.files) targetDb.files = [];

    // Group all non-trashed files by: folderId::lowercaseName::size
    const groups = new Map();
    for (const f of targetDb.files) {
      if (f.trashed) continue;
      const k = (f.folderId || 'root') + '::' + (f.name || '').toLowerCase().trim() + '::' + (f.size || 0);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(f);
    }

    let duplicateGroupsCount = 0;
    let removedFilesCount = 0;
    const loserIds = new Set();

    for (const [key, group] of groups.entries()) {
      if (group.length <= 1) continue;
      duplicateGroupsCount++;

      // Sort: winner has date, then newest ID (mvap > mv7)
      group.sort((a, b) => {
        const da = a.date ? new Date(a.date).getTime() : 0;
        const db = b.date ? new Date(b.date).getTime() : 0;
        if (db !== da) return db - da; // newest date first
        return (b.id || '').localeCompare(a.id || '');
      });

      const winner = group[0];
      const losers = group.slice(1);

      for (const loser of losers) {
        loserIds.add(loser.id);
        removedFilesCount++;
      }
    }

    const initialCount = targetDb.files.length;
    targetDb.files = targetDb.files.filter(f => !loserIds.has(f.id));
    const finalCount = targetDb.files.length;

    targetDb._dbVer = Math.max((_memDBCacheVer || 0), (targetDb._dbVer || 0)) + 10;
    _memDBCacheVer = targetDb._dbVer;
    _memDBCache = targetDb;
    await uSet(env, 'td:db', targetDb);
    const gDriveBackupId = await saveDBToGDrive(env, targetDb);

    // Get Trip folder file count for user verification
    const tripFiles = targetDb.files.filter(f => f.folderId === 'mvap02cggbjju');

    return J({
      ok: true,
      initialCount,
      finalCount,
      removedFilesCount,
      duplicateGroupsCount,
      tripFilesCount: tripFiles.length,
      gDriveBackupId,
      _dbVer: targetDb._dbVer
    });
  }

  if (action === 'heal-all-folders') {
    const drv = (db.drives||[])[0];
    if (!drv) return J({error:'No drive found'}, 404);
    let at = await gAT(env, drv.encToken);

    let gdb = null;
    try { gdb = await loadDBFromGDrive(env, drv); } catch(e){}
    const targetDb = gdb || db;
    if (!targetDb.folders) targetDb.folders = [];
    if (!targetDb.files) targetDb.files = [];

    // Subrequest 1: Fetch ALL existing folders from Google Drive in ONE single call
    let allGFoldersResp = await fetch('https://www.googleapis.com/drive/v3/files?q=mimeType%3D%27application%2Fvnd.google-apps.folder%27+and+trashed%3Dfalse&fields=files(id,name,parents)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true', {
      headers: { Authorization: `Bearer ${at}` }
    });
    if (allGFoldersResp.status === 401) {
      at = await gAT(env, drv.encToken, true);
      allGFoldersResp = await fetch('https://www.googleapis.com/drive/v3/files?q=mimeType%3D%27application%2Fvnd.google-apps.folder%27+and+trashed%3Dfalse&fields=files(id,name,parents)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true', {
        headers: { Authorization: `Bearer ${at}` }
      });
    }
    const allGFoldersData = await allGFoldersResp.json().catch(()=>({files:[]}));
    const gDriveFolderMap = new Map(); // key: `${parentGId}::${name.toLowerCase()}` -> id
    for (const gf of (allGFoldersData.files || [])) {
      if (gf.parents && gf.parents.length) {
        for (const p of gf.parents) {
          gDriveFolderMap.set(p + '::' + (gf.name||'').toLowerCase().trim(), gf.id);
        }
      }
    }

    async function getOrCreateGF(name, parentGId) {
      const k = parentGId + '::' + name.toLowerCase().trim();
      if (gDriveFolderMap.has(k)) {
        return { id: gDriveFolderMap.get(k), created: false };
      }
      let c = await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true', {
        method: 'POST',
        headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentGId] })
      });
      if (c.status === 401) {
        at = await gAT(env, drv.encToken, true);
        c = await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true', {
          method: 'POST',
          headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentGId] })
        });
      }
      const cData = await c.json().catch(()=>({}));
      if (cData && cData.id) {
        gDriveFolderMap.set(k, cData.id);
        return { id: cData.id, created: true };
      }
      return { id: null, created: false };
    }

    let tera = targetDb.folders.find(f => f.id === 'mv73d3n3g2wy8');
    if (!tera) tera = targetDb.folders.find(f => (f.name||'').toLowerCase() === 'tera' && !f.parentId);
    if (!tera) return J({error:'Tera folder not found in DB'}, 404);

    const teraRes = await getOrCreateGF('tera', drv.rootFolderId);
    if (teraRes.id) tera.googleFolderId = teraRes.id;

    const canonical18Names = [
      'Act Class', 'B.Y Vlogs', 'build', 'Clg Crazy Videos!',
      'Close friends photos', 'Days', 'DCIM', 'Group Photos',
      'Imagine', 'old backup', 'one plus', 'photos 111',
      'Screen recorder', 'Singing', 'STEAXS FILTERS PACK - CHARLIE',
      'T', 'Trip', 'well its'
    ];
    const canonicalSet = new Set(canonical18Names.map(x => x.toLowerCase()));

    // 1. Remove stray folders directly under tera that do not belong
    const toRemoveFolderIds = new Set();
    const teraChildren = targetDb.folders.filter(f => f.parentId === tera.id);
    for (const c of teraChildren) {
      const cNameLow = (c.name||'').toLowerCase().trim();
      if (!canonicalSet.has(cNameLow)) {
        toRemoveFolderIds.add(c.id);
      }
    }
    toRemoveFolderIds.add('mvb97x9sslyph'); // ghost b
    targetDb.folders = targetDb.folders.filter(f => !toRemoveFolderIds.has(f.id));

    // 2. Ensure each of the 18 canonical folders exists in DB & Google Drive
    const healedCanonical = [];
    for (const cName of canonical18Names) {
      let dbFolder = targetDb.folders.find(f => f.parentId === tera.id && (f.name||'').toLowerCase().trim() === cName.toLowerCase());
      if (!dbFolder) {
        dbFolder = {
          id: uid(),
          driveId: drv.id,
          parentId: tera.id,
          name: cName,
          date: new Date().toISOString()
        };
        targetDb.folders.push(dbFolder);
      }
      const res = await getOrCreateGF(cName, tera.googleFolderId);
      if (res.id) {
        if (dbFolder.googleFolderId !== res.id || res.created) {
          healedCanonical.push({ name: cName, googleFolderId: res.id, created: res.created });
        }
        dbFolder.googleFolderId = res.id;
      }
    }

    // 3. Ensure subfolders of the canonical folders exist on Google Drive
    const healedSubfolders = [];
    const directTeraFolderIds = new Set(targetDb.folders.filter(f => f.parentId === tera.id).map(f => f.id));
    for (const sub of targetDb.folders) {
      if (sub.parentId && sub.parentId !== tera.id && directTeraFolderIds.has(sub.parentId)) {
        const parentFolder = targetDb.folders.find(f => f.id === sub.parentId);
        if (parentFolder && parentFolder.googleFolderId) {
          const res = await getOrCreateGF(sub.name, parentFolder.googleFolderId);
          if (res.id) {
            if (sub.googleFolderId !== res.id || res.created) {
              healedSubfolders.push({ name: sub.name, parent: parentFolder.name, googleFolderId: res.id, created: res.created });
            }
            sub.googleFolderId = res.id;
          }
        }
      }
    }

    // 4. Save DB with version 500
    targetDb._dbVer = 500;
    _memDBCacheVer = 500;
    _memDBCache = targetDb;
    await uSet(env, 'td:db', targetDb);
    const gDriveBackupId = await saveDBToGDrive(env, targetDb);

    // 5. Final check of items in tera on Google Drive
    const gTeraRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${tera.googleFolderId}' in parents and trashed = false`)}&fields=files(id,name,mimeType)&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true`, {
      headers: { Authorization: `Bearer ${at}` }
    });
    const gTeraData = await gTeraRes.json().catch(()=>({files:[]}));

    return J({
      ok: true,
      teraGoogleFolderId: tera.googleFolderId,
      healedCanonicalCount: healedCanonical.length,
      healedCanonical,
      healedSubfoldersCount: healedSubfolders.length,
      healedSubfolders,
      removedStraysCount: toRemoveFolderIds.size,
      dbFoldersDirectlyInTera: targetDb.folders.filter(f => f.parentId === tera.id).length,
      gDriveFoldersInTeraCount: (gTeraData.files||[]).length,
      gDriveFoldersInTera: (gTeraData.files||[]).map(f => f.name),
      _dbVer: targetDb._dbVer,
      gDriveBackupId
    });
  }

  if (action === 'move-stray-root-files') {
    const drv = (db.drives||[])[0];
    if (!drv) return J({error:'No drive found'}, 404);
    let at = await gAT(env, drv.encToken);

    let gdb = null;
    try { gdb = await loadDBFromGDrive(env, drv); } catch(e){}
    const targetDb = gdb || db;
    if (!targetDb.files) targetDb.files = [];
    if (!targetDb.folders) targetDb.folders = [];

    // Query files directly in root
    const q = `'${drv.rootFolderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder' and name != '__teledrive_db__.json'`;
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,size,mimeType)&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true`;
    let r = await fetch(url, { headers: { Authorization: `Bearer ${at}` } });
    if (r.status === 401) {
      at = await gAT(env, drv.encToken, true);
      r = await fetch(url, { headers: { Authorization: `Bearer ${at}` } });
    }
    const d = await r.json().catch(()=>({files:[]}));
    const allRootFiles = d.files || [];

    // Move in safe batches of 30 to respect Cloudflare Worker subrequest budget
    const batchToMove = allRootFiles.slice(0, 30);
    const moved = [];
    const failed = [];

    const folderGMap = new Map();
    for (const f of targetDb.folders) {
      if (f.googleFolderId) folderGMap.set(f.id, f.googleFolderId);
    }

    const cameraFolder = targetDb.folders.find(f => (f.name||'').toLowerCase() === 'camera' && targetDb.folders.some(p => p.id === f.parentId && (p.name||'').toLowerCase() === 'dcim'))
      || targetDb.folders.find(f => (f.name||'').toLowerCase() === 'dcim')
      || targetDb.folders.find(f => (f.name||'').toLowerCase() === 'photos 111');

    for (const file of batchToMove) {
      let dbEntry = targetDb.files.find(f => f.googleFileId === file.id);
      if (!dbEntry) {
        dbEntry = targetDb.files.find(f => f.name === file.name && String(f.size) === String(file.size) && !f.trashed);
      }

      let destGId = null;
      let destFolderId = null;

      if (dbEntry && dbEntry.folderId) {
        destFolderId = dbEntry.folderId;
        destGId = folderGMap.get(destFolderId);
      }

      if (!destGId && cameraFolder && cameraFolder.googleFolderId) {
        const isIPhoneMedia = /^(iphone|IMG_|DOC-|Attendance)/i.test(file.name);
        if (isIPhoneMedia) {
          destFolderId = cameraFolder.id;
          destGId = cameraFolder.googleFolderId;
        }
      }

      if (!destGId || destGId === drv.rootFolderId) {
        failed.push({ fileId: file.id, name: file.name, reason: 'Destination folder unknown' });
        continue;
      }

      try {
        let patchR = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?addParents=${encodeURIComponent(destGId)}&removeParents=${encodeURIComponent(drv.rootFolderId)}&supportsAllDrives=true`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${at}` }
        });
        if (patchR.status === 401) {
          at = await gAT(env, drv.encToken, true);
          patchR = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?addParents=${encodeURIComponent(destGId)}&removeParents=${encodeURIComponent(drv.rootFolderId)}&supportsAllDrives=true`, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${at}` }
          });
        }
        if (patchR.ok) {
          moved.push({ fileId: file.id, name: file.name, destFolderId, destGId });
          if (dbEntry) {
            dbEntry.folderId = destFolderId;
            dbEntry.googleFileId = file.id;
          } else {
            targetDb.files.push({
              id: uid(),
              googleFileId: file.id,
              driveId: drv.id,
              folderId: destFolderId,
              name: file.name,
              size: parseInt(file.size) || 0,
              mimeType: file.mimeType || 'application/octet-stream',
              uploadedBy: 'admin',
              date: new Date().toISOString()
            });
          }
        } else {
          failed.push({ fileId: file.id, name: file.name, status: patchR.status });
        }
      } catch(e) {
        failed.push({ fileId: file.id, name: file.name, error: e.message });
      }
    }

    if (moved.length > 0) {
      targetDb._dbVer = 520;
      _memDBCacheVer = 520;
      _memDBCache = targetDb;
      await uSet(env, 'td:db', targetDb);
      await saveDBToGDrive(env, targetDb);
    }

    return J({
      ok: true,
      totalRootFilesFound: allRootFiles.length,
      movedInThisBatch: moved.length,
      remainingInRoot: allRootFiles.length - moved.length,
      failedCount: failed.length,
      moved: moved.slice(0, 15),
      failed: failed.slice(0, 5),
      _dbVer: targetDb._dbVer
    });
  }

  if (action === 'sync-quota') {
    const drv = (db.drives||[]).find(d => d.id === 'mv3st1820rife') || (db.drives||[])[0];
    if (!drv) return J({error:'No drive found'}, 404);
    const at = await gAT(env, drv.encToken);
    const q = await gDQ(at);
    drv.capacity = parseInt(q.storageQuota && q.storageQuota.limit) || drv.capacity || 0;
    drv.usedBytes = parseInt(q.storageQuota && q.storageQuota.usage) || drv.usedBytes || 0;
    await uSet(env, 'td:db', db);
    return J({
      ok: true,
      driveName: drv.name,
      usedGB: (drv.usedBytes / (1024**3)).toFixed(2),
      capacityGB: (drv.capacity / (1024**3)).toFixed(2)
    });
  }

  if (action === 'register-file') {
    const fileId = url.searchParams.get('fileId');
    const name = url.searchParams.get('name') || 'aaaaa.zip';
    const size = parseInt(url.searchParams.get('size')) || 2164651709;
    const folderId = url.searchParams.get('folderId') || 'mv73d3n3g2wy8';
    const drv = (db.drives||[])[0];
    if (!fileId) return J({error:'fileId required'}, 400);

    let existing = (db.files||[]).find(f => f.googleFileId === fileId || (f.name === name && f.folderId === folderId));
    if (existing) {
      existing.googleFileId = fileId;
      existing.size = size;
      existing.folderId = folderId;
      existing.trashed = false;
    } else {
      if (!db.files) db.files = [];
      db.files.push({
        id: uid(),
        googleFileId: fileId,
        driveId: drv.id,
        folderId: folderId,
        name: name,
        size: size,
        mimeType: 'application/zip',
        uploadedBy: 'admin',
        date: new Date().toISOString()
      });
    }
    await uSet(env, 'td:db', db);
    return J({ ok: true, registered: name, fileId, folderId, totalTeraFiles: (db.files||[]).filter(f=>f.folderId===folderId).length });
  }

  if (action === 'batch-register-files') {
    const body = await req.json().catch(() => ({ files: [] }));
    const filesToRegister = body.files || [];
    const drv = (db.drives||[])[0];
    if (!db.files) db.files = [];

    const existingMap = new Map();
    db.files.forEach(f => {
      if (f.googleFileId) existingMap.set(f.googleFileId, f);
      existingMap.set((f.folderId||'') + '::' + (f.name||'').toLowerCase().trim(), f);
    });

    let addedCount = 0;
    let updatedCount = 0;
    for (const item of filesToRegister) {
      const k = (item.folderId||'') + '::' + (item.name||'').toLowerCase().trim();
      const existing = (item.googleFileId && existingMap.get(item.googleFileId)) || existingMap.get(k);
      if (existing) {
        if (item.googleFileId) existing.googleFileId = item.googleFileId;
        if (item.size) existing.size = item.size;
        if (item.folderId) existing.folderId = item.folderId;
        existing.trashed = false;
        updatedCount++;
      } else {
        const newFile = {
          id: uid(),
          googleFileId: item.googleFileId,
          driveId: drv ? drv.id : 'mv3st1820rife',
          folderId: item.folderId || 'mv73d3n3g2wy8',
          name: item.name,
          size: item.size || 0,
          mimeType: item.mimeType || 'application/octet-stream',
          uploadedBy: 'admin',
          date: new Date().toISOString()
        };
        db.files.push(newFile);
        existingMap.set(item.googleFileId, newFile);
        existingMap.set(k, newFile);
        addedCount++;
      }
    }
    await uSet(env, 'td:db', db);
    return J({ ok: true, addedCount, updatedCount, totalFiles: db.files.length });
  }

  if (action === 'register-folder') {
    const name = url.searchParams.get('name');
    const googleFolderId = url.searchParams.get('googleFolderId');
    const parentGoogleId = url.searchParams.get('parentGoogleId');
    const drv = (db.drives||[])[0];
    if (!googleFolderId || !name) return J({error:'Missing params'}, 400);

    let parentDbFolder = (db.folders||[]).find(f => f.googleFolderId === parentGoogleId);
    let existing = (db.folders||[]).find(f => f.googleFolderId === googleFolderId);
    if (!existing) {
      existing = {
        id: uid(),
        driveId: drv ? drv.id : 'mv3st1820rife',
        parentId: parentDbFolder ? parentDbFolder.id : null,
        name: name,
        googleFolderId: googleFolderId,
        date: new Date().toISOString()
      };
      if (!db.folders) db.folders = [];
      db.folders.push(existing);
      await uSet(env, 'td:db', db);
    }
    return J({ ok: true, folderId: existing.id, googleFolderId });
  }

  return J({error: 'Invalid action'}, 400);
}


// ─── Drive Root Purge: list & delete ALL files directly in a drive's root folder on Google Drive ───


// Phase A (action=list): scans Drive, saves IDs to KV job, returns { jobId, total }
// Phase B (action=delete): deletes up to 300 per call, returns { deleted, remaining }
// Phase C (dryRun=true): just list count, no KV storage
async function hDriveRootPurge(req, env) {
  if(!await vSes(req, env, 'admin')) return J({error:'Unauthorized'}, 401);
  const body = await req.json().catch(()=>({}));
  const { driveId, dryRun = false, action = 'list', jobId = null, offset = 0,
          targetGoogleFolderId = null, targetFolderLabel = 'root' } = body;
  if(!driveId) return J({error:'driveId required'}, 400);

  const db = await uGet(env, 'td:db');
  if(!db) return J({error:'DB error'}, 500);

  const drv = (db.drives||[]).find(d => d.id === driveId);
  if(!drv) return J({error:'Drive not found'}, 404);
  if(!drv.rootFolderId) return J({error:'Drive has no rootFolderId'}, 400);

  let at;
  try { at = await gAT(env, drv.encToken); }
  catch(e) {
    try { at = await gAT(env, drv.encToken, true); }
    catch(e2) { return J({error:'Token error: ' + (e2.message||e.message)}, 500); }
  }

  // ── Phase B: delete a chunk using stored job ──
  if (action === 'delete' && jobId) {
    const jobKey = 'td:purge:' + jobId;
    const jobData = await env.TELEDRIVE_KV.get(jobKey, {type:'json'}).catch(()=>null);
    if (!jobData || !jobData.ids) return J({error:'Job not found or expired'}, 404);

    const CHUNK = 300;
    const ids = jobData.ids;
    const chunkIds = ids.slice(offset, offset + CHUNK);
    const remaining = Math.max(0, ids.length - offset - chunkIds.length);

    if (chunkIds.length > 0) {
      await gDriveBatchDelete(at, chunkIds);
      // Also clean from DB
      const gIdSet = new Set(chunkIds);
      db.files = (db.files||[]).filter(f => !gIdSet.has(f.googleFileId));
      if(_memDBCache) _memDBCache.files = db.files;
      await uSet(env, 'td:db', db);
    }

    if (remaining <= 0) {
      // Job complete — remove KV job key
      await env.TELEDRIVE_KV.delete(jobKey).catch(()=>{});
      if(!db.activityLog) db.activityLog = [];
      db.activityLog.unshift({id:uid(),type:'drive_root_purge',driveId,label:jobData.label||'root',deletedFromDrive:ids.length,ts:new Date().toISOString()});
      await uSet(env, 'td:db', db);
    }

    return J({ok:true, deleted:chunkIds.length, remaining, nextOffset: offset + chunkIds.length, total: ids.length});
  }

  // ── Phase A: list all non-folder file IDs in target folder (or drive root if none specified) ──
  const scanFolderId = targetGoogleFolderId || drv.rootFolderId;
  const allGoogleFileIds = [];
  let pageToken = null;
  let pageCount = 0;

  do {
    const q = encodeURIComponent(`'${scanFolderId}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed = false`);
    let url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name,size)&pageSize=1000&supportsAllDrives=true`;
    if(pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${at}` } });
    if(!resp.ok) break;
    const data = await resp.json();
    if(data.files && data.files.length) {
      data.files.forEach(f => allGoogleFileIds.push(f.id));
    }
    pageToken = data.nextPageToken || null;
    pageCount++;
    if(pageCount >= 200) break;
  } while(pageToken);

  const totalFound = allGoogleFileIds.length;
  if(totalFound === 0) return J({ok:true, deleted:0, found:0, message:`No loose files found in "${targetFolderLabel}"`});

  if(dryRun) return J({ok:true, dryRun:true, found:totalFound, message:`Would delete ${totalFound} loose files from "${targetFolderLabel}"`});

  // Store IDs in KV for chunked deletion (TTL 2h)
  const newJobId = uid();
  await env.TELEDRIVE_KV.put('td:purge:' + newJobId, JSON.stringify({ids: allGoogleFileIds, driveId, label: targetFolderLabel, createdAt: Date.now()}), {expirationTtl: 7200});

  return J({ok:true, action:'list', jobId: newJobId, total: totalFound, found: totalFound});
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
  const foldersToDelete=(db.folders||[]).filter(f=>fileIds.includes(f.id) && (!allowedList || allowedList.includes(f.driveId)));

  // Cache access tokens once per drive
  const driveTokens = {};
  for(const drv of (db.drives||[])){
    if(!driveTokens[drv.id] && drv.encToken){
      try {
        driveTokens[drv.id] = await gAT(env, drv.encToken);
      } catch(e){}
    }
  }

  // Delete all selected files and folders on Google Drive
  for(const drv of (db.drives||[])){
    const token = driveTokens[drv.id];
    if(!token) continue;
    const gIds = [];
    toDelete.filter(f => f.driveId === drv.id && f.googleFileId).forEach(f => gIds.push(f.googleFileId));
    foldersToDelete.filter(f => f.driveId === drv.id && f.googleFolderId).forEach(f => gIds.push(f.googleFolderId));
    if(gIds.length) {
      await gDriveBatchDelete(token, gIds);
    }
  }

  // Update drive used bytes
  toDelete.forEach(f => {
    const drv = (db.drives||[]).find(d => d.id === f.driveId);
    if(drv && typeof f.size === 'number') drv.usedBytes = Math.max(0, (drv.usedBytes || 0) - f.size);
  });

  // Build set of file IDs to remove from DB
  const fileDelIds = new Set();
  toDelete.forEach(f => { if(f.id) fileDelIds.add(f.id); if(f.googleFileId) fileDelIds.add(f.googleFileId); });

  // Build set of folder IDs to remove (cascade to child folders)
  const foldDelSet = new Set(foldersToDelete.map(x=>x.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of (db.folders || [])) {
      if (!foldDelSet.has(f.id) && f.parentId && foldDelSet.has(f.parentId)) {
        foldDelSet.add(f.id);
        changed = true;
      }
    }
  }

  db.files=(db.files||[]).filter(f=>!fileDelIds.has(f.id) && !fileDelIds.has(f.googleFileId) && (!f.folderId || !foldDelSet.has(f.folderId)));
  db.folders=(db.folders||[]).filter(f=>!foldDelSet.has(f.id));
  if(_memDBCache) {
    _memDBCache.files = db.files;
    _memDBCache.folders = db.folders;
  }
  if(!db.activityLog) db.activityLog=[];
  db.activityLog.unshift({id:uid(),type:'delete_permanent_batch',count:toDelete.length + foldersToDelete.length,ts:new Date().toISOString()});
  await uSet(env,'td:db',db);
  return J({ok:true,count:toDelete.length + foldersToDelete.length});
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
  const trashedFolders=(db.folders||[]).filter(f=>!!f.trashed && (!allowedList || allowedList.includes(f.driveId)));

  const driveTokens = {};
  for(const drv of (db.drives||[])){
    if(!driveTokens[drv.id] && drv.encToken){
      try {
        driveTokens[drv.id] = await gAT(env, drv.encToken);
      } catch(e){}
    }
  }

  for(const drv of (db.drives||[])){
    const token = driveTokens[drv.id];
    if(!token) continue;
    const gIds = [];
    trashedFiles.filter(f => f.driveId === drv.id && f.googleFileId).forEach(f => gIds.push(f.googleFileId));
    trashedFolders.filter(f => f.driveId === drv.id && f.googleFolderId).forEach(f => gIds.push(f.googleFolderId));
    if(gIds.length) {
      await gDriveBatchDelete(token, gIds);
    }
  }

  trashedFiles.forEach(f => {
    const drv = (db.drives||[]).find(d => d.id === f.driveId);
    if(drv && typeof f.size === 'number') drv.usedBytes = Math.max(0, (drv.usedBytes || 0) - f.size);
  });

  const purgedIds = trashedFiles.map(x=>x.id);
  const foldPurgedIds = trashedFolders.map(x=>x.id);
  db.files=(db.files||[]).filter(f=>!purgedIds.includes(f.id));
  if(ses === 'admin') db.folders=(db.folders||[]).filter(f=>!foldPurgedIds.includes(f.id));
  else if(allowedList) db.folders=(db.folders||[]).filter(f=>!(foldPurgedIds.includes(f.id) && allowedList.includes(f.driveId)));
  if(_memDBCache) {
    _memDBCache.files = db.files;
    _memDBCache.folders = db.folders;
  }
  if(!db.activityLog) db.activityLog=[];
  db.activityLog.unshift({id:uid(),type:'empty_trash',count:trashedFiles.length + trashedFolders.length,ts:new Date().toISOString()});
  await uSet(env,'td:db',db);
  return J({ok:true,count:trashedFiles.length + trashedFolders.length});
}

async function hMF(req,env){
  const body=await req.json().catch(()=>({}));
  let {driveId,parentFolderId,parentGoogleFolderId,name}=body;
  const db=await uGet(env,'td:db');
  if(!driveId && parentFolderId) {
    const f = (db && db.folders || []).find(x => x.id === parentFolderId);
    if(f && f.driveId) driveId = f.driveId;
  }
  if(!driveId && db && db.drives && db.drives.length) {
    driveId = db.drives[0].id;
  }
  const isOpenTarget=isDriveOpen(driveId,db);
  const ses=await vSes(req,env,null);
  if(!ses&&!isOpenTarget) return J({error:'Unauthorized'},401);
  if(!name||!name.trim()) return J({error:'Folder name required'},400);
  const drv=(db&&db.drives||[]).find(d=>d.id===driveId) || (db&&db.drives||[])[0];
  if(!drv) return J({error:'Drive not found'},404);
  if(!ses && drv.passwordHash && !await vDriveToken(req, env, drv.id)){
    return J({error:'Drive is locked by password'},403);
  }
  let at;
  try {
    at=await gAT(env,drv.encToken);
  } catch(e) {
    try {
      at=await gAT(env,drv.encToken,true);
    } catch(e2) {
      return J({error:'Google Drive token error: ' + (e2.message||e.message)}, 500);
    }
  }
  let gPid=drv.rootFolderId;
  let parentAdminOnly = false;
  let parentAllowedUsers = null;
  if(parentGoogleFolderId && parentGoogleFolderId.length > 10){
    gPid = parentGoogleFolderId;
  }
  if(parentFolderId){
    const allFolders = (db.folders||[]).concat((_memDBCache&&_memDBCache.folders)||[]);
    const pf=allFolders.find(f=>f.id===parentFolderId || f.googleFolderId===parentFolderId);
    if(pf&&pf.googleFolderId && (!parentGoogleFolderId || parentGoogleFolderId.length <= 10)) gPid=pf.googleFolderId;
    else if(parentFolderId.length > 20 && !parentFolderId.includes('-') && (!parentGoogleFolderId || parentGoogleFolderId.length <= 10)) gPid=parentFolderId;
    if(pf&&pf.adminOnly) parentAdminOnly = true;
    if(pf&&Array.isArray(pf.allowedUsers)&&pf.allowedUsers.length) parentAllowedUsers = [...pf.allowedUsers];
  }
  let gFid=await mkDir(at,name.trim(),gPid);
  if(!gFid){
    at=await gAT(env,drv.encToken,true);
    gFid=await mkDir(at,name.trim(),gPid);
  }
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
  if(_memDBCache && _memDBCache.folders) {
    _memDBCache.folders.push(newFolder);
  }
  await uSet(env,'td:db',db);
  return J({ok:true,folderId:fId,googleFolderId:gFid,name:name.trim()});
}

async function hRF(req,env,fId){
  const db=await uGet(env,'td:db');
  const folder=(db.folders||[]).find(f=>f.id===fId);
  if(!folder) return J({error:'Folder not found'},404);
  const isOpenTarget=isDriveOpen(folder.driveId,db);
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
  const isOpenTarget=isDriveOpen(folder.driveId,db);
  const ses=await vSes(req,env,null);
  if(!ses&&!isOpenTarget) return J({error:'Unauthorized'},401);
  const{password,hint}=await req.json().catch(()=>({}));
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
  folder.passwordHint=hint ? String(hint).trim().slice(0, 100) : null;
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

  const lockoutEnabled = !(db && db.policy && db.policy.folderLockoutEnabled === false);
  folder.failedAttempts = folder.failedAttempts || 0;

  const testHash=await sha256(password.trim());
  if(testHash!==folder.passwordHash){
    if (!lockoutEnabled) {
      return J({error:'Incorrect password. Please try again.', ok:false, lockoutDisabled:true}, 403);
    }
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
  return J({ok:true, unlocked:true, remainingAttempts: lockoutEnabled ? 5 : null, lockoutDisabled: !lockoutEnabled});
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
  folder.passwordHint=null;
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
      passwordHint:f.passwordHint||null,
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
      passwordHint:f.passwordHint||null,
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
  let db;
  try{ db=await uGet(env,'td:db'); }catch(e){
    if(_memDBCache) db=_memDBCache;
  }
  if(!db) db=_memDBCache || {v:3,policy:{}};
  const policy={
    allowUserDownload: db.policy ? db.policy.allowUserDownload !== false : true,
    allowUserDelete: db.policy ? db.policy.allowUserDelete !== false : true,
    allowUserRename: db.policy ? db.policy.allowUserRename !== false : true,
    folderLockoutEnabled: db.policy ? db.policy.folderLockoutEnabled !== false : true
  };
  return J({ok:true,policy});
}

async function hSetPolicy(req,env){
  if(!await vSes(req,env,'admin')) return J({error:'Unauthorized'},401);
  let db;
  try{ db=await uGet(env,'td:db'); }catch(e){
    if(_memDBCache) db=_memDBCache;
  }
  if(!db) db=_memDBCache || {v:3,policy:{}};
  const body=await req.json().catch(()=>({}));
  db.policy={
    allowUserDownload: body.allowUserDownload !== false,
    allowUserDelete: body.allowUserDelete !== false,
    allowUserRename: body.allowUserRename !== false,
    folderLockoutEnabled: body.folderLockoutEnabled !== false
  };
  _memDBCache = db;
  try{ await uSet(env,'td:db',db); }catch(e){}
  return J({ok:true,policy:db.policy});
}

async function hCU(req,env){if(!await vSes(req,env,'admin'))return J({error:'Unauthorized'},401);const{username,password,allowedDrives}=await req.json().catch(()=>({}));let db=await uGet(env,'td:db');if(!db)db={v:3,adminHash:await sha256('admin123'),drives:[],files:[],folders:[],activityLog:[],users:[]};if(!db.users)db.users=[];if(db.users.find(u=>u.username===username))return J({error:'Username taken'},409);db.users.push({id:uid(),username,passwordHash:await sha256(password),allowedDrives:allowedDrives||'all',createdAt:new Date().toISOString()});await uSet(env,'td:db',db);return J({ok:true});}
async function hDU(req,env,uid2){if(!await vSes(req,env,'admin'))return J({error:'Unauthorized'},401);const db=await uGet(env,'td:db');if(!db)return J({ok:true});db.users=(db.users||[]).filter(u=>u.id!==uid2);await uSet(env,'td:db',db);return J({ok:true});}

async function hStar(req,env,fileId){
  const db=await uGet(env,'td:db');
  const file=(db&&db.files||[]).find(f=>f.id===fileId || f.googleFileId===fileId);
  if(!file) return J({error:'File not found'},404);
  const isOpenTarget=isDriveOpen(file.driveId,db);
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
  const body = await req.json().catch(()=>({}));
  const db = await uGet(env,'td:db');
  if(!db) return J({error:'DB error'},500);

  const driveId = body.driveId || body.openDriveId;
  if (!driveId) return J({error:'driveId required'}, 400);

  const drv = (db.drives||[]).find(d => d.id === driveId);
  if (!drv) return J({error:'Drive not found'}, 404);

  const willBeOpen = (typeof body.isOpen === 'boolean') ? body.isOpen : !drv.isOpenDrive;
  drv.isOpenDrive = willBeOpen;

  const openIds = (db.drives||[]).filter(d => d.isOpenDrive).map(d => d.id);
  db.openDriveIds = openIds;
  db.openDriveId = openIds[0] || null;

  await uSet(env,'td:db',db);
  return J({ok:true, driveId, isOpenDrive: willBeOpen, openDriveIds: db.openDriveIds, openDriveId: db.openDriveId});
}

async function hSetDrivePassword(req,env){
  if(!await vSes(req,env,'admin')) return J({error:'Unauthorized'},401);
  const db=await uGet(env,'td:db');
  if(!db) return J({error:'DB error'},500);
  const body=await req.json().catch(()=>({}));
  const {driveId, password, hint}=body;
  if(!driveId) return J({error:'driveId required'},400);
  const drv=(db.drives||[]).find(d=>d.id===driveId);
  if(!drv) return J({error:'Drive not found'},404);

  if(password && password.trim()){
    drv.passwordHash = await sha256(password.trim());
    drv.encPassword = await enc(password.trim(), gEK(env));
    drv.passwordHint = hint ? String(hint).trim().slice(0, 100) : null;
  } else {
    drv.passwordHash = null;
    drv.encPassword = null;
    drv.passwordHint = null;
  }

  await uSet(env,'td:db',db);
  return J({ok:true, hasPassword: !!drv.passwordHash, passwordHint: drv.passwordHint});
}

async function hUnlockDrive(req,env){
  const db=await uGet(env,'td:db');
  if(!db) return J({error:'DB error'},500);
  const body=await req.json().catch(()=>({}));
  const {driveId, password}=body;
  if(!driveId) return J({error:'driveId required'},400);
  const drv=(db.drives||[]).find(d=>d.id===driveId);
  if(!drv) return J({error:'Drive not found'},404);
  if(!drv.passwordHash) return J({ok:true, unlocked:true});

  if(!password) return J({error:'Password required'},400);
  const testHash = await sha256(password.trim());
  if(testHash !== drv.passwordHash){
    return J({error:'Incorrect drive password', ok:false}, 403);
  }

  // Generate 5-hour signed access token (18,000s)
  const token = await makeDriveToken(driveId, gEK(env));
  _memSesCache.set('dtk:' + token, driveId);
  try { await uSet(env, 'td:dtk:' + token, driveId, 18000); } catch(e){}
  return J({ok:true, unlocked:true, token, expiresIn:18000});
}

async function hCopyFiles(req, env) {
  const ses = await vSes(req, env, null);
  if (!ses) return J({ error: 'Unauthorized' }, 401);
  const body = await req.json().catch(() => ({}));
  const { fileIds, targetFolderId, targetDriveId } = body;
  if (!Array.isArray(fileIds) || fileIds.length === 0) {
    return J({ error: 'No files specified to copy' }, 400);
  }
  const db = await uGet(env, 'td:db');
  if (!db) return J({ error: 'Database not found' }, 500);

  const destDriveId = targetDriveId || (targetFolderId ? (db.folders||[]).find(f=>f.id===targetFolderId)?.driveId : null) || (db.drives||[])[0]?.id;
  const drv = (db.drives||[]).find(d => d.id === destDriveId);
  if (!drv) return J({ error: 'Target drive not found' }, 404);

  let targetParentGoogleId = drv.rootFolderId;
  let isAdmOnly = false;
  let targetAllowedUsers = undefined;
  if (targetFolderId) {
    const tf = (db.folders||[]).find(f => f.id === targetFolderId);
    if (tf && tf.googleFolderId) targetParentGoogleId = tf.googleFolderId;
    if (tf && tf.adminOnly) isAdmOnly = true;
    if (tf && Array.isArray(tf.allowedUsers) && tf.allowedUsers.length) targetAllowedUsers = [...tf.allowedUsers];
  }

  let at;
  try {
    at = await gAT(env, drv.encToken);
  } catch(e) {
    at = await gAT(env, drv.encToken, true);
  }

  let copiedFiles = [];
  for (const fId of fileIds) {
    const f = (db.files||[]).find(x => x.id === fId || x.googleFileId === fId);
    if (!f || !f.googleFileId) continue;

    try {
      let copyResp = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(f.googleFileId)}/copy?supportsAllDrives=true`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${at}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: f.name,
          parents: [targetParentGoogleId]
        })
      });

      if (!copyResp.ok && copyResp.status === 401) {
        at = await gAT(env, drv.encToken, true);
        copyResp = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(f.googleFileId)}/copy?supportsAllDrives=true`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: f.name, parents: [targetParentGoogleId] })
        });
      }

      if (copyResp.ok) {
        const data = await copyResp.json();
        const newFile = {
          id: uid(),
          googleFileId: data.id,
          driveId: destDriveId,
          folderId: targetFolderId || null,
          name: f.name,
          size: f.size,
          mimeType: f.mimeType || 'application/octet-stream',
          uploadedBy: ses || 'admin',
          date: new Date().toISOString(),
          adminOnly: isAdmOnly
        };
        if (targetAllowedUsers) newFile.allowedUsers = targetAllowedUsers;
        if (!db.files) db.files = [];
        db.files.push(newFile);
        copiedFiles.push(newFile);
      }
    } catch(e) {
      console.error('File copy error:', e);
    }
  }

  if (copiedFiles.length > 0) {
    if (!db.activityLog) db.activityLog = [];
    db.activityLog.unshift({
      id: uid(),
      type: 'copy',
      name: `${copiedFiles.length} file(s) copied`,
      driveId: destDriveId,
      ts: new Date().toISOString()
    });
    if (db.activityLog.length > 500) db.activityLog = db.activityLog.slice(0, 500);
    await uSet(env, 'td:db', db);
  }

  return J({ ok: true, copiedCount: copiedFiles.length, files: copiedFiles });
}

async function hUBC(req, env) {
  const body = await req.json().catch(() => ({}));
  const { files } = body;
  if (!Array.isArray(files) || !files.length) return J({ ok: true });
  const db = await uGet(env, 'td:db');
  if (!db) return J({ error: 'DB error' }, 500);
  const ses = await vSes(req, env, null);
  if (!db.files) db.files = [];

  const added = [];
  for (const item of files) {
    const { fileLocalId, googleFileId, driveId, folderId, name, size, mimeType } = item;
    const existingFile = db.files.find(f => f.id === fileLocalId || (googleFileId && f.googleFileId === googleFileId));
    if (existingFile) {
      existingFile.name = name;
      existingFile.size = size;
      existingFile.mimeType = mimeType || existingFile.mimeType;
      existingFile.folderId = folderId || null;
      if (googleFileId) existingFile.googleFileId = googleFileId;
    } else {
      const parentFolder = folderId ? (db.folders||[]).find(x => x.id === folderId) : null;
      const isAdmOnly = parentFolder ? !!parentFolder.adminOnly : false;
      const fAllowedUsers = (parentFolder && Array.isArray(parentFolder.allowedUsers) && parentFolder.allowedUsers.length) ? [...parentFolder.allowedUsers] : undefined;
      const newFile = {
        id: fileLocalId,
        googleFileId,
        driveId,
        folderId: folderId || null,
        name,
        size,
        mimeType: mimeType || 'application/octet-stream',
        uploadedBy: ses || 'guest',
        date: new Date().toISOString(),
        adminOnly: isAdmOnly
      };
      if (fAllowedUsers) newFile.allowedUsers = fAllowedUsers;
      db.files.push(newFile);
      added.push(newFile);
    }
  }

  await uSet(env, 'td:db', db);
  return J({ ok: true, addedCount: added.length });
}

async function hCP(req,env){if(!await vSes(req,env,'admin'))return J({error:'Unauthorized'},401);const{newPassword}=await req.json().catch(()=>({}));if(!newPassword||newPassword.length<4)return J({error:'Min 4 chars'},400);let db=await uGet(env,'td:db');if(!db)db={v:3,adminHash:await sha256('admin123'),drives:[],files:[],folders:[],activityLog:[],users:[]};db.adminHash=await sha256(newPassword);await uSet(env,'td:db',db);return J({ok:true});}
async function hInit(req,env){const url=new URL(req.url),ex=await uGet(env,'td:db');if(ex&&ex.adminHash&&url.searchParams.get('reset')!=='yes')return J({error:'Already initialized. Add ?reset=yes to force.'},409);const{adminPassword='admin123'}=await req.json().catch(()=>({}));await uSet(env,'td:db',{v:3,adminHash:await sha256(adminPassword),drives:[],files:[],folders:[],activityLog:[],users:[]});return J({ok:true,message:`Password set: ${adminPassword}`});}

// TripSplit & Bill Manager Backend Module
const DEFAULT_TRIP_NAMES = ['Amar', 'Darshan', 'Soham', 'Omakr', 'Rohit', 'Nikhil', 'Bhushan'];

async function makeTripToken(username, secret) {
  const ts = Date.now().toString(36);
  const data = `trip_${username.toLowerCase()}.${ts}`;
  const sig = await sha256(`tdtrip:${data}:${secret}`);
  return `ttk_${data}.${sig.slice(0, 32)}`;
}

async function verifyTripToken(token, secret) {
  if (!token || typeof token !== 'string' || !token.startsWith('ttk_trip_')) return null;
  const parts = token.slice(9).split('.');
  if (parts.length !== 3) return null;
  const [username, tsStr, sig] = parts;
  const ts = parseInt(tsStr, 36);
  if (isNaN(ts) || Date.now() - ts > 30 * 86400 * 1000) return null; // 30-day login
  const expectedSig = (await sha256(`tdtrip:trip_${username}.${tsStr}:${secret}`)).slice(0, 32);
  if (sig === expectedSig) return username;
  return null;
}

async function ensureTripUsers(db) {
  if (!db.tripUsers) db.tripUsers = [];
  let changed = false;
  for (const name of DEFAULT_TRIP_NAMES) {
    const un = name.toLowerCase();
    let existing = db.tripUsers.find(u => u.username && u.username.toLowerCase() === un);
    if (!existing) {
      db.tripUsers.push({
        id: uid(),
        name: name,
        username: un,
        passwordHash: await sha256(name.toUpperCase()),
        rawPasswordHint: name.toUpperCase(),
        upiId: '',
        qrDataUrl: '',
        dateCreated: new Date().toISOString()
      });
      changed = true;
    }
  }
  return changed;
}

async function hTripAPI(req, env, subpath, method) {
  let db = await uGet(env, 'td:db');
  if (!db) db = { v: 3, drives: [], files: [], folders: [] };
  const changed = await ensureTripUsers(db);
  if (changed) {
    await uSet(env, 'td:db', db);
  }
  if (!db.tripData) db.tripData = {};

  const url = new URL(req.url);
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '') || url.searchParams.get('token') || '';
  const loggedInUser = await verifyTripToken(token, gEK(env));
  const adminSes = await vSes(req, env, 'admin');

  // 1. GET /api/trip/users — Public list of user profiles (for dropdown and dashboard)
  if (subpath === 'users' && method === 'GET') {
    return J({
      users: (db.tripUsers || []).map(u => ({
        id: u.id,
        name: u.name,
        username: u.username,
        upiId: u.upiId || '',
        hasQr: !!u.qrDataUrl,
        qrDataUrl: u.qrDataUrl || ''
      }))
    });
  }

  // 2. POST /api/trip/login — User selects name from list and enters password
  if (subpath === 'login' && method === 'POST') {
    const body = await req.json().catch(() => ({}));
    const { username, password } = body;
    if (!username || !password) return J({ error: 'Username and password required' }, 400);

    const user = (db.tripUsers || []).find(u => u.username.toLowerCase() === username.toLowerCase().trim());
    if (!user) return J({ error: 'User not found' }, 404);

    const passHash = await sha256(password);
    if (user.passwordHash !== passHash && user.passwordHash !== await sha256(password.toUpperCase())) {
      return J({ error: 'Incorrect password' }, 401);
    }

    const tToken = await makeTripToken(user.username, gEK(env));
    return J({
      ok: true,
      token: tToken,
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        upiId: user.upiId || '',
        qrDataUrl: user.qrDataUrl || ''
      }
    });
  }

  // 3. GET /api/trip/me — Check session
  if (subpath === 'me' && method === 'GET') {
    if (!loggedInUser) return J({ error: 'Not logged in' }, 401);
    const user = (db.tripUsers || []).find(u => u.username === loggedInUser);
    if (!user) return J({ error: 'User not found' }, 404);
    return J({
      ok: true,
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        upiId: user.upiId || '',
        qrDataUrl: user.qrDataUrl || ''
      }
    });
  }

  // 4. POST /api/trip/profile — Update user's UPI ID and QR code
  if (subpath === 'profile' && method === 'POST') {
    if (!loggedInUser) return J({ error: 'Unauthorized — Please login' }, 401);
    const body = await req.json().catch(() => ({}));
    const user = (db.tripUsers || []).find(u => u.username === loggedInUser);
    if (!user) return J({ error: 'User not found' }, 404);

    if (body.upiId !== undefined) user.upiId = String(body.upiId).trim();
    if (body.qrDataUrl !== undefined) user.qrDataUrl = body.qrDataUrl;
    if (body.newPassword && body.newPassword.length >= 3) {
      user.passwordHash = await sha256(body.newPassword);
      user.rawPasswordHint = body.newPassword;
    }

    await uSet(env, 'td:db', db);
    return J({
      ok: true,
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        upiId: user.upiId || '',
        qrDataUrl: user.qrDataUrl || ''
      }
    });
  }

  // 5. GET /api/trip/folders — List folders for trip selection
  if (subpath === 'folders' && method === 'GET') {
    const folders = (db.folders || []).filter(f => !f.trashed && !f.destroyed).map(f => ({
      id: f.id,
      name: f.name,
      parentId: f.parentId,
      driveId: f.driveId
    }));
    return J({ folders });
  }

  // 6. GET /api/trip/data?folderId=... — Trip details, bills, settlements
  if (subpath === 'data' && method === 'GET') {
    const folderId = url.searchParams.get('folderId') || 'general';
    const trip = db.tripData[folderId] || {
      folderId,
      bills: [],
      settlements: [],
      concessions: []
    };

    // Calculate balances
    const balances = {}; // username -> net balance (positive = owed to them, negative = they owe)
    (db.tripUsers || []).forEach(u => balances[u.username] = 0);

    // Sum bills
    let totalExpenses = 0;
    (trip.bills || []).forEach(b => {
      const amt = parseFloat(b.amount) || 0;
      totalExpenses += amt;
      const payer = (b.paidBy || '').toLowerCase();
      const splits = b.splitMembers || (db.tripUsers || []).map(u => u.username);
      const share = splits.length > 0 ? (amt / splits.length) : 0;

      // Payer gets full amount credited
      balances[payer] = (balances[payer] || 0) + amt;
      // Each participant owes their share
      splits.forEach(m => {
        const mu = m.toLowerCase();
        balances[mu] = (balances[mu] || 0) - share;
      });
    });

    // Account for verified settlements
    let totalSettled = 0;
    (trip.settlements || []).forEach(s => {
      if (s.status === 'verified') {
        const amt = parseFloat(s.amount) || 0;
        totalSettled += amt;
        const fromU = (s.fromUser || '').toLowerCase();
        const toU = (s.toUser || '').toLowerCase();
        balances[fromU] = (balances[fromU] || 0) + amt;
        balances[toU] = (balances[toU] || 0) - amt;
      }
    });

    // Account for concessions (instant clear)
    (trip.concessions || []).forEach(c => {
      const amt = parseFloat(c.amount) || 0;
      const forU = (c.forUser || '').toLowerCase();
      const byU = (c.byUser || '').toLowerCase();
      balances[forU] = (balances[forU] || 0) + amt;
      balances[byU] = (balances[byU] || 0) - amt;
    });

    // Compute pairwise settlement suggestions
    const creditors = []; // positive
    const debtors = [];   // negative
    for (const [un, bal] of Object.entries(balances)) {
      if (bal > 1) creditors.push({ username: un, amount: bal });
      else if (bal < -1) debtors.push({ username: un, amount: -bal });
    }
    creditors.sort((a,b) => b.amount - a.amount);
    debtors.sort((a,b) => b.amount - a.amount);

    const suggestions = [];
    let ci = 0, di = 0;
    const credCopy = creditors.map(c => ({ ...c }));
    const debtCopy = debtors.map(d => ({ ...d }));

    while (ci < credCopy.length && di < debtCopy.length) {
      const c = credCopy[ci];
      const d = debtCopy[di];
      const settleAmt = Math.min(c.amount, d.amount);
      if (settleAmt >= 1) {
        const payeeUser = (db.tripUsers || []).find(u => u.username === c.username);
        suggestions.push({
          fromUser: d.username,
          toUser: c.username,
          amount: Math.round(settleAmt),
          payeeName: payeeUser ? payeeUser.name : c.username,
          payeeUpi: payeeUser ? payeeUser.upiId : '',
          payeeQr: payeeUser ? payeeUser.qrDataUrl : ''
        });
      }
      c.amount -= settleAmt;
      d.amount -= settleAmt;
      if (c.amount < 1) ci++;
      if (d.amount < 1) di++;
    }

    const folderObj = (db.folders || []).find(f => f.id === folderId);
    const tripCustomName = (trip && trip.tripName) ? trip.tripName : null;

    const membersSummary = (db.tripUsers || []).map(u => {
      const un = u.username.toLowerCase();
      let paid = 0;
      let share = 0;
      (trip.bills || []).forEach(b => {
        const amt = parseFloat(b.amount) || 0;
        if ((b.paidBy || '').toLowerCase() === un) paid += amt;
        const splits = b.splitMembers || (db.tripUsers || []).map(x => x.username);
        if (splits.map(x => x.toLowerCase()).includes(un)) {
          share += (amt / splits.length);
        }
      });
      let settledDelta = 0;
      (trip.settlements || []).forEach(s => {
        if (s.status === 'verified') {
          const amt = parseFloat(s.amount) || 0;
          if ((s.fromUser || '').toLowerCase() === un) settledDelta += amt;
          if ((s.toUser || '').toLowerCase() === un) settledDelta -= amt;
        }
      });
      (trip.concessions || []).forEach(c => {
        const amt = parseFloat(c.amount) || 0;
        if ((c.forUser || '').toLowerCase() === un) settledDelta += amt;
        if ((c.byUser || '').toLowerCase() === un) settledDelta -= amt;
      });
      const net = (paid - share) + settledDelta;
      return {
        id: u.id,
        name: u.name,
        username: u.username,
        upiId: u.upiId || '',
        qrDataUrl: u.qrDataUrl || '',
        totalPaid: Math.round(paid),
        totalShare: Math.round(share),
        netBalance: Math.round(net),
        status: net > 1 ? 'gets' : (net < -1 ? 'owes' : 'settled'),
        amount: Math.round(Math.abs(net))
      };
    });

    return J({
      folderId,
      folderName: tripCustomName || (folderObj ? folderObj.name : 'Trip Expenses'),
      totalExpenses: Math.round(totalExpenses),
      totalSettled: Math.round(totalSettled),
      remainingDue: Math.max(0, Math.round(totalExpenses - totalSettled)),
      bills: trip.bills || [],
      settlements: trip.settlements || [],
      concessions: trip.concessions || [],
      balances,
      suggestions,
      membersSummary,
      users: (db.tripUsers || []).map(u => ({
        id: u.id,
        name: u.name,
        username: u.username,
        upiId: u.upiId || '',
        qrDataUrl: u.qrDataUrl || ''
      }))
    });
  }

  // 7. POST /api/trip/bill — Add a new bill
  if (subpath === 'bill' && method === 'POST') {
    if (!loggedInUser) return J({ error: 'Unauthorized — Please login to add bill' }, 401);
    const body = await req.json().catch(() => ({}));
    const { folderId, title, amount, splitMembers, receiptImage } = body;
    if (!folderId || !title || !amount) return J({ error: 'Missing required bill fields' }, 400);

    if (!db.tripData[folderId]) {
      db.tripData[folderId] = { folderId, bills: [], settlements: [], concessions: [] };
    }

    const userObj = (db.tripUsers || []).find(u => u.username === loggedInUser);
    const newBill = {
      id: uid(),
      title: String(title).trim(),
      amount: parseFloat(amount),
      paidBy: loggedInUser,
      paidByName: userObj ? userObj.name : loggedInUser,
      splitMembers: Array.isArray(splitMembers) && splitMembers.length ? splitMembers : (db.tripUsers || []).map(u => u.username),
      receiptImage: receiptImage || null,
      date: new Date().toISOString()
    };

    db.tripData[folderId].bills.unshift(newBill);
    await uSet(env, 'td:db', db);
    return J({ ok: true, bill: newBill });
  }

  // 8. POST /api/trip/pay — Submit payment to payee (status: pending)
  if (subpath === 'pay' && method === 'POST') {
    if (!loggedInUser) return J({ error: 'Unauthorized — Please login' }, 401);
    const body = await req.json().catch(() => ({}));
    const { folderId, toUser, amount, note, proofImage } = body;
    if (!folderId || !toUser || !amount) return J({ error: 'Missing payment fields' }, 400);

    if (!db.tripData[folderId]) {
      db.tripData[folderId] = { folderId, bills: [], settlements: [], concessions: [] };
    }

    const fromUserObj = (db.tripUsers || []).find(u => u.username === loggedInUser);
    const toUserObj = (db.tripUsers || []).find(u => u.username.toLowerCase() === toUser.toLowerCase());

    const newPayment = {
      id: uid(),
      folderId,
      fromUser: loggedInUser,
      fromUserName: fromUserObj ? fromUserObj.name : loggedInUser,
      toUser: toUser.toLowerCase(),
      toUserName: toUserObj ? toUserObj.name : toUser,
      amount: parseFloat(amount),
      note: note || 'UPI Payment',
      proofImage: proofImage || null,
      status: 'pending', // Pending Verification
      date: new Date().toISOString()
    };

    db.tripData[folderId].settlements.unshift(newPayment);
    await uSet(env, 'td:db', db);
    return J({ ok: true, payment: newPayment });
  }

  // 9. POST /api/trip/verify-payment — Payee verifies or rejects payment
  if (subpath === 'verify-payment' && method === 'POST') {
    if (!loggedInUser && !adminSes) return J({ error: 'Unauthorized' }, 401);
    const body = await req.json().catch(() => ({}));
    const { folderId, settlementId, action } = body;
    if (!folderId || !settlementId || !action) return J({ error: 'Missing verification fields' }, 400);

    const trip = db.tripData[folderId];
    if (!trip || !trip.settlements) return J({ error: 'Trip not found' }, 404);

    const s = trip.settlements.find(x => x.id === settlementId);
    if (!s) return J({ error: 'Payment record not found' }, 404);

    // Only payee or admin can verify
    if (!adminSes && s.toUser.toLowerCase() !== loggedInUser.toLowerCase()) {
      return J({ error: 'Only the payee can verify this payment' }, 403);
    }

    if (action === 'approve') {
      s.status = 'verified';
      s.verifiedAt = new Date().toISOString();
      s.verifiedBy = loggedInUser || 'admin';
    } else if (action === 'reject') {
      s.status = 'failed';
      s.rejectedAt = new Date().toISOString();
      s.rejectedBy = loggedInUser || 'admin';
    } else {
      return J({ error: 'Invalid action' }, 400);
    }

    await uSet(env, 'td:db', db);
    return J({ ok: true, status: s.status });
  }

  // 10. POST /api/trip/concession — Grant cash or discount concession
  if (subpath === 'concession' && method === 'POST') {
    if (!loggedInUser && !adminSes) return J({ error: 'Unauthorized' }, 401);
    const body = await req.json().catch(() => ({}));
    const { folderId, forUser, amount, note } = body;
    if (!folderId || !forUser || !amount) return J({ error: 'Missing concession fields' }, 400);

    if (!db.tripData[folderId]) {
      db.tripData[folderId] = { folderId, bills: [], settlements: [], concessions: [] };
    }

    const byUserObj = (db.tripUsers || []).find(u => u.username === (loggedInUser || 'admin'));
    const forUserObj = (db.tripUsers || []).find(u => u.username.toLowerCase() === forUser.toLowerCase());

    const newConcession = {
      id: uid(),
      folderId,
      byUser: loggedInUser || 'admin',
      byUserName: byUserObj ? byUserObj.name : 'Admin',
      forUser: forUser.toLowerCase(),
      forUserName: forUserObj ? forUserObj.name : forUser,
      amount: parseFloat(amount),
      note: note || 'Cash / Concession',
      date: new Date().toISOString()
    };

    if (!db.tripData[folderId].concessions) db.tripData[folderId].concessions = [];
    db.tripData[folderId].concessions.unshift(newConcession);
    await uSet(env, 'td:db', db);
    return J({ ok: true, concession: newConcession });
  }

  // Rename trip title
  if (subpath === 'rename' && method === 'POST') {
    if (!loggedInUser && !adminSes) return J({ error: 'Unauthorized' }, 401);
    const body = await req.json().catch(() => ({}));
    const { folderId, newName } = body;
    if (!folderId || !newName) return J({ error: 'Missing fields' }, 400);
    if (!db.tripData[folderId]) db.tripData[folderId] = { folderId, bills: [], settlements: [], concessions: [] };
    db.tripData[folderId].tripName = String(newName).trim();
    await uSet(env, 'td:db', db);
    return J({ ok: true, tripName: db.tripData[folderId].tripName });
  }

  // Delete bill (creator or admin only)
  if (subpath === 'bill/delete' && method === 'POST') {
    if (!loggedInUser && !adminSes) return J({ error: 'Unauthorized' }, 401);
    const body = await req.json().catch(() => ({}));
    const { folderId, billId } = body;
    if (!folderId || !billId) return J({ error: 'Missing fields' }, 400);
    const trip = db.tripData[folderId];
    if (!trip || !trip.bills) return J({ error: 'Trip not found' }, 404);
    const bIdx = trip.bills.findIndex(b => b.id === billId);
    if (bIdx === -1) return J({ error: 'Bill not found' }, 404);
    const bill = trip.bills[bIdx];
    if (!adminSes && bill.paidBy.toLowerCase() !== loggedInUser.toLowerCase()) {
      return J({ error: 'You can only delete your own bills' }, 403);
    }
    trip.bills.splice(bIdx, 1);
    await uSet(env, 'td:db', db);
    return J({ ok: true });
  }

  // Reset password
  if (subpath === 'reset-password' && method === 'POST') {
    if (!loggedInUser) return J({ error: 'Unauthorized — Please login' }, 401);
    const body = await req.json().catch(() => ({}));
    const { oldPassword, newPassword } = body;
    if (!newPassword || newPassword.length < 3) return J({ error: 'Password must be at least 3 characters' }, 400);
    const user = (db.tripUsers || []).find(u => u.username === loggedInUser);
    if (!user) return J({ error: 'User not found' }, 404);
    if (oldPassword) {
      const oldHash = await sha256(oldPassword);
      if (user.passwordHash !== oldHash && user.passwordHash !== await sha256(oldPassword.toUpperCase())) {
        return J({ error: 'Current password incorrect' }, 401);
      }
    }
    user.passwordHash = await sha256(newPassword);
    user.rawPasswordHint = newPassword;
    await uSet(env, 'td:db', db);
    return J({ ok: true, message: 'Password updated successfully' });
  }

    // 11. Admin trip users panel: GET /api/trip/admin-users
  if (subpath === 'admin-users' && method === 'GET') {
    if (!adminSes) return J({ error: 'Admin only' }, 401);

    // Compute lifetime statistics across all trips in db.tripData
    const lifetimeStats = {};
    (db.tripUsers || []).forEach(u => {
      const un = u.username.toLowerCase();
      lifetimeStats[un] = {
        lifetimePaid: 0,
        lifetimeShare: 0,
        lifetimeSettledDelta: 0,
        billsCreatedCount: 0
      };
    });

    const tripFoldersList = [];
    let totalLifetimeExpenses = 0;
    let totalLifetimeSettled = 0;

    Object.keys(db.tripData || {}).forEach(folderId => {
      const trip = db.tripData[folderId];
      if (!trip) return;
      const folderObj = (db.folders || []).find(f => f.id === folderId);
      const tripTitle = trip.tripName || (folderObj ? folderObj.name : 'Trip ' + folderId);
      let tripTotal = 0;
      let tripSettled = 0;

      (trip.bills || []).forEach(b => {
        const amt = parseFloat(b.amount) || 0;
        tripTotal += amt;
        const payerUn = (b.paidBy || '').toLowerCase();
        if (lifetimeStats[payerUn]) {
          lifetimeStats[payerUn].lifetimePaid += amt;
          lifetimeStats[payerUn].billsCreatedCount++;
        }
        const splits = (b.splitMembers || (db.tripUsers || []).map(x => x.username)).map(x => x.toLowerCase());
        const perHead = amt / (splits.length || 1);
        splits.forEach(memberUn => {
          if (lifetimeStats[memberUn]) {
            lifetimeStats[memberUn].lifetimeShare += perHead;
          }
        });
      });

      (trip.settlements || []).forEach(s => {
        if (s.status === 'verified') {
          const amt = parseFloat(s.amount) || 0;
          tripSettled += amt;
          const fromUn = (s.fromUser || '').toLowerCase();
          const toUn = (s.toUser || '').toLowerCase();
          if (lifetimeStats[fromUn]) lifetimeStats[fromUn].lifetimeSettledDelta += amt;
          if (lifetimeStats[toUn]) lifetimeStats[toUn].lifetimeSettledDelta -= amt;
        }
      });

      (trip.concessions || []).forEach(c => {
        const amt = parseFloat(c.amount) || 0;
        const forUn = (c.forUser || '').toLowerCase();
        const byUn = (c.byUser || '').toLowerCase();
        if (lifetimeStats[forUn]) lifetimeStats[forUn].lifetimeSettledDelta += amt;
        if (lifetimeStats[byUn]) lifetimeStats[byUn].lifetimeSettledDelta -= amt;
      });

      totalLifetimeExpenses += tripTotal;
      totalLifetimeSettled += tripSettled;

      tripFoldersList.push({
        folderId,
        name: tripTitle,
        totalExpenses: Math.round(tripTotal),
        totalSettled: Math.round(tripSettled),
        remainingDue: Math.max(0, Math.round(tripTotal - tripSettled)),
        billsCount: (trip.bills || []).length
      });
    });

    const usersWithStats = (db.tripUsers || []).map(u => {
      const un = u.username.toLowerCase();
      const st = lifetimeStats[un] || { lifetimePaid: 0, lifetimeShare: 0, lifetimeSettledDelta: 0, billsCreatedCount: 0 };
      const net = (st.lifetimePaid - st.lifetimeShare) + st.lifetimeSettledDelta;
      return {
        id: u.id,
        name: u.name,
        username: u.username,
        password: u.rawPasswordHint || u.username.toUpperCase(),
        upiId: u.upiId || '',
        hasQr: !!u.qrDataUrl,
        lifetimePaid: Math.round(st.lifetimePaid),
        lifetimeShare: Math.round(st.lifetimeShare),
        lifetimeNet: Math.round(net),
        lifetimeStatus: net > 1 ? 'gets' : (net < -1 ? 'owes' : 'settled'),
        billsCreatedCount: st.billsCreatedCount
      };
    });

    return J({
      users: usersWithStats,
      trips: tripFoldersList,
      summary: {
        totalLifetimeExpenses: Math.round(totalLifetimeExpenses),
        totalLifetimeSettled: Math.round(totalLifetimeSettled),
        totalLifetimeDue: Math.max(0, Math.round(totalLifetimeExpenses - totalLifetimeSettled)),
        usersCount: usersWithStats.length
      }
    });
  }

  // 12. Admin trip users panel: POST /api/trip/admin-users (Create new user or reset pass)
  if (subpath === 'admin-users' && method === 'POST') {
    if (!adminSes) return J({ error: 'Admin only' }, 401);
    const body = await req.json().catch(() => ({}));
    const { name, username, password } = body;
    if (!name || !username || !password) return J({ error: 'Missing fields' }, 400);

    const un = username.toLowerCase().trim();
    let user = (db.tripUsers || []).find(u => u.username === un);
    if (user) {
      user.name = name.trim();
      user.passwordHash = await sha256(password);
      user.rawPasswordHint = password;
    } else {
      user = {
        id: uid(),
        name: name.trim(),
        username: un,
        passwordHash: await sha256(password),
        rawPasswordHint: password,
        upiId: '',
        qrDataUrl: '',
        dateCreated: new Date().toISOString()
      };
      db.tripUsers.push(user);
    }
    await uSet(env, 'td:db', db);
    return J({ ok: true, user });
  }

  return J({ error: 'Unknown trip API route' }, 404);
}


export async function onRequest(ctx){
  _globalCtx = ctx;
  const { request, env } = ctx;
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:COR});
  const url=new URL(request.url),p=url.pathname.replace(/^\/api\/?/,''),m=request.method;
  try{
    if(p.startsWith('trip/'))return hTripAPI(request,env,p.replace(/^trip\//,''),m);
    if(p==='auth/login'&&m==='POST')return hAL(request,env);
    if(p==='auth/user-login'&&m==='POST')return hUL(request,env);
    if(p==='auth/verify'&&m==='GET')return hVerifySes(request,env);
    if(p==='auth/google'&&m==='GET')return hAG(request,env);
    if(p==='auth/callback'&&m==='GET')return hCB(request,env);
    if(p==='db'&&m==='GET')return hDB(request,env);
    if(p==='drives/quota'&&m==='GET')return hQ(request,env);
    if(p.startsWith('drives/scan/')&&m==='POST')return hScanDrive(request,env,p.replace('drives/scan/',''));
    if(p.startsWith('drives/')&&m==='DELETE')return hDD(request,env,p.replace('drives/',''));
    if(p==='upload/init'&&m==='POST')return hUI(request,env);
    if(p==='upload/chunk'&&m==='PUT')return hUChunk(request,env);
    if(p==='upload/complete'&&m==='POST')return hUC(request,env);
    if(p==='upload/batch-complete'&&m==='POST')return hUBC(request,env);
    if(p.startsWith('download/')&&(m==='GET'||m==='HEAD'))return hDL(request,env,p.replace('download/',''));
    if(p.startsWith('thumb/')&&(m==='GET'||m==='HEAD'))return hThumb(request,env,p.replace('thumb/',''));
    if(p.startsWith('files/rename/')&&m==='POST')return hRenameFile(request,env,p.replace('files/rename/',''));
    if(p==='files/copy'&&m==='POST')return hCopyFiles(request,env);
    if(p==='files/batch-trash'&&m==='POST')return hBatchTrash(request,env);
    if(p==='files/trash/empty'&&(m==='POST'||m==='DELETE'))return hEmptyTrash(request,env);
    if(p==='files/trash/batch-request-restore'&&m==='POST')return hBatchRequestRestore(request,env);
    if(p==='files/trash/batch-approve-restore'&&m==='POST')return hBatchApproveRestore(request,env);
    if((p==='files/trash/batch-permanent-delete'||p==='files/batch-permanent-delete')&&(m==='POST'||m==='DELETE'))return hBatchPermanentDelete(request,env);
    if(p.startsWith('files/trash/request-restore/')&&m==='POST')return hRequestRestore(request,env,p.replace('files/trash/request-restore/',''));
    if(p.startsWith('files/trash/approve-restore/')&&m==='POST')return hApproveRestore(request,env,p.replace('files/trash/approve-restore/',''));
    if(p.startsWith('files/trash/permanent-delete/')&&m==='DELETE')return hPermanentDelete(request,env,p.replace('files/trash/permanent-delete/',''));
    if(p.startsWith('files/star/')&&m==='POST')return hStar(request,env,p.replace('files/star/',''));
    if(p.startsWith('files/')&&m==='DELETE')return hDF(request,env,p.replace('files/',''));
    if(p.startsWith('folders/rename/')&&m==='POST')return hRenameFolder(request,env,p.replace('folders/rename/',''));
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
    if(p==='admin/drive-password'&&m==='POST')return hSetDrivePassword(request,env);
    if(p==='drives/unlock-drive'&&m==='POST')return hUnlockDrive(request,env);
    if(p.startsWith('drives/rename/')&&m==='POST')return hRenameDrive(request,env,p.replace('drives/rename/',''));
    if(p==='admin/backup'&&m==='GET')return hBackupDB(request,env);
    if(p==='admin/restore'&&m==='POST')return hRestoreDB(request,env);
    if(p==='admin/init'&&m==='POST')return hInit(request,env);
    if(p==='admin/drive-root-purge'&&m==='POST')return hDriveRootPurge(request,env);
    if(p==='admin/dedup-folders'&&m==='POST')return hDedupFolders(request,env);
    if(p==='admin/restore-drive-folders'&&m==='POST')return hRestoreDriveFolders(request,env);
    if(p==='admin/fix-folder-locations'&&m==='POST')return hFixFolderLocations(request,env);
    if(p==='admin/debug-db')return hDebugDB(request,env);
    return J({error:'Not found',path:p},404);
  }catch(e){return J({error:e.message||'Server error'},500);}
}