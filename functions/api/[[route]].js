// TeleDrive — Cloudflare Pages Function (all /api/* routes)
// Upstash credentials hardcoded as fallback — works even before env vars are confirmed active

const UPS_URL = 'https://driven-yeti-165554.upstash.io';
const UPS_TOK = 'gQAAAAAAAoayAAIgcDFhMTkwMmY5ZTY0ODY0MDk2YWZmYjMzYjk5YWZkMjk1Nw';
const DEFAULT_ENC = 'TeleDriveKey2026SecureDefaultXX';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// ─── Upstash ─────────────────────────────────────────
function getUpsUrl(env) { return env.UPSTASH_URL || UPS_URL; }
function getUpsTok(env) { return env.UPSTASH_TOKEN || UPS_TOK; }
function getEncKey(env) { return env.ENCRYPTION_KEY || DEFAULT_ENC; }

async function upsGet(env, key) {
  const r = await fetch(`${getUpsUrl(env)}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${getUpsTok(env)}` },
  });
  const d = await r.json();
  if (d.result === null || d.result === undefined) return null;
  if (typeof d.result === 'object') return d.result;
  try {
    const v = JSON.parse(d.result);
    return typeof v === 'string' ? JSON.parse(v) : v;
  } catch { return d.result; }
}

async function upsSet(env, key, value) {
  await fetch(`${getUpsUrl(env)}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getUpsTok(env)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
}

async function upsExpire(env, key, seconds) {
  await fetch(`${getUpsUrl(env)}/expire/${encodeURIComponent(key)}/${seconds}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getUpsTok(env)}` },
  });
}

// ─── Crypto ──────────────────────────────────────────
async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function importKey(secret) {
  const raw = new TextEncoder().encode(secret.padEnd(32, '0').slice(0, 32));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encrypt(text, secret) {
  const key = await importKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
  const combined = new Uint8Array([...iv, ...new Uint8Array(enc)]);
  return btoa(String.fromCharCode(...combined));
}

async function decrypt(b64, secret) {
  const key = await importKey(secret);
  const combined = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: combined.slice(0, 12) }, key, combined.slice(12));
  return new TextDecoder().decode(dec);
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ─── Session ─────────────────────────────────────────
async function verifyAdminSession(request, env) {
  const token = (request.headers.get('Authorization') || '').replace('Bearer ', '').trim();
  if (!token) return false;
  const val = await upsGet(env, `td:ses:${token}`);
  return val === 'admin';
}

async function verifyAnySession(request, env) {
  const token = (request.headers.get('Authorization') || '').replace('Bearer ', '').trim();
  if (!token) return null;
  const val = await upsGet(env, `td:ses:${token}`);
  return val || null;
}

// ─── Google Drive helpers ─────────────────────────────
async function getAccessToken(env, encryptedRefreshToken) {
  const refreshToken = await decrypt(encryptedRefreshToken, getEncKey(env));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID || '',
      client_secret: env.GOOGLE_CLIENT_SECRET || '',
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const d = await r.json();
  if (!d.access_token) throw new Error(`Token refresh failed: ${d.error_description || d.error || 'unknown'}`);
  return d.access_token;
}

async function getDriveQuota(accessToken) {
  const r = await fetch('https://www.googleapis.com/drive/v3/about?fields=storageQuota,user', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return r.json();
}

async function getOrCreateFolder(accessToken, name, parentId = null) {
  const q = `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false${parentId ? ` and '${parentId}' in parents` : ''}`;
  const sr = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const sd = await sr.json();
  if (sd.files && sd.files.length > 0) return sd.files[0].id;
  const cr = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', ...(parentId ? { parents: [parentId] } : {}) }),
  });
  const cd = await cr.json();
  return cd.id;
}

// ─── Route Handlers ──────────────────────────────────

async function handleAdminLogin(req, env) {
  const body = await req.json().catch(() => ({}));
  const { password = '' } = body;
  const db = await upsGet(env, 'td:db');
  if (!db) return json({ error: 'App not initialized. Visit /api/admin/init to set up.' }, 503);
  const hash = await sha256(password);
  if (hash !== db.adminHash) return json({ error: 'Wrong password' }, 401);
  const token = Array.from(crypto.getRandomValues(new Uint8Array(24))).map(b => b.toString(16).padStart(2, '0')).join('');
  await upsSet(env, `td:ses:${token}`, 'admin');
  await upsExpire(env, `td:ses:${token}`, 86400 * 7);
  return json({ token, role: 'admin' });
}

async function handleUserLogin(req, env) {
  const body = await req.json().catch(() => ({}));
  const { username = '', password = '' } = body;
  const db = await upsGet(env, 'td:db');
  if (!db || !db.users) return json({ error: 'Wrong username or password' }, 401);
  const user = db.users.find(u => u.username === username);
  if (!user) return json({ error: 'Wrong username or password' }, 401);
  const hash = await sha256(password);
  if (hash !== user.passwordHash) return json({ error: 'Wrong username or password' }, 401);
  const token = Array.from(crypto.getRandomValues(new Uint8Array(24))).map(b => b.toString(16).padStart(2, '0')).join('');
  await upsSet(env, `td:ses:${token}`, user.id);
  await upsExpire(env, `td:ses:${token}`, 86400 * 7);
  return json({ token, role: 'user', userId: user.id, username: user.username, allowedDrives: user.allowedDrives || 'all' });
}

async function handleGoogleAuthStart(req, env) {
  if (!await verifyAdminSession(req, env)) return json({ error: 'Unauthorized' }, 401);
  if (!env.GOOGLE_CLIENT_ID) return json({ error: 'GOOGLE_CLIENT_ID env var not set. Add it in Cloudflare Pages → Settings → Environment Variables then redeploy.' }, 400);
  const origin = new URL(req.url).origin;
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', `${origin}/api/auth/callback`);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile');
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');
  return json({ url: authUrl.toString() });
}

async function handleGoogleCallback(req, env) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  if (!code) return new Response('Missing code', { status: 400 });
  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID || '',
      client_secret: env.GOOGLE_CLIENT_SECRET || '',
      redirect_uri: `${url.origin}/api/auth/callback`,
      grant_type: 'authorization_code',
    }),
  });
  const tokens = await tokenResp.json();
  if (!tokens.refresh_token) {
    return new Response(`<html><body style="font:16px/1.5 sans-serif;background:#0d0d12;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center"><div><h2 style="color:#ff453a">⚠️ No refresh token</h2><p>The Google account may already be connected.<br>Try disconnecting first, or use an incognito window.</p><a href="/#/settings" style="color:#4e86f5">← Back to Settings</a></div></body></html>`,
      { status: 400, headers: { 'Content-Type': 'text/html' } });
  }
  const userResp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const user = await userResp.json();
  const quota = await getDriveQuota(tokens.access_token);
  const rootFolderId = await getOrCreateFolder(tokens.access_token, 'TeleDrive');
  const encToken = await encrypt(tokens.refresh_token, getEncKey(env));
  let db = await upsGet(env, 'td:db');
  if (!db) db = { v: 3, adminHash: await sha256('admin123'), drives: [], files: [], folders: [], activityLog: [], users: [] };
  if (!db.drives) db.drives = [];
  const colors = ['#4e86f5', '#30d158', '#bf5af2', '#ff9f0a', '#ff453a', '#64d2ff'];
  db.drives.push({
    id: uid(), email: user.email, name: user.name || user.email,
    picture: user.picture || '', color: colors[db.drives.length % colors.length],
    capacity: parseInt(quota.storageQuota?.limit) || 0,
    usedBytes: parseInt(quota.storageQuota?.usage) || 0,
    rootFolderId, encToken, createdAt: new Date().toISOString(),
  });
  await upsSet(env, 'td:db', db);
  return new Response(
    `<html><head><script>window.opener?.postMessage('drive-connected','*');setTimeout(()=>window.close(),1000);<\/script></head><body style="font:16px/1.5 sans-serif;background:#0d0d12;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center"><div><h2 style="color:#30d158">✅ Drive Connected!</h2><p>${user.email} added successfully.</p><p style="opacity:.6;font-size:.85rem">This window will close…</p></div></body></html>`,
    { headers: { 'Content-Type': 'text/html' } }
  );
}

async function handleGetDB(req, env) {
  const db = await upsGet(env, 'td:db');
  if (!db) return json(null);
  const role = await verifyAnySession(req, env);
  const safe = {
    ...db,
    drives: (db.drives || []).map(d => ({ ...d, encToken: undefined })),
    activityLog: role === 'admin' ? (db.activityLog || []) : [],
    users: role === 'admin' ? (db.users || []) : (db.users || []).map(u => ({ id: u.id, username: u.username })),
  };
  return json(safe);
}

async function handleDriveQuota(req, env) {
  if (!await verifyAdminSession(req, env)) return json({ error: 'Unauthorized' }, 401);
  const db = await upsGet(env, 'td:db');
  if (!db || !db.drives) return json({ drives: [] });
  const results = await Promise.all(db.drives.map(async d => {
    try {
      const at = await getAccessToken(env, d.encToken);
      const q = await getDriveQuota(at);
      return { id: d.id, capacity: parseInt(q.storageQuota?.limit) || d.capacity, usedBytes: parseInt(q.storageQuota?.usage) || d.usedBytes };
    } catch (e) { return { id: d.id, error: e.message }; }
  }));
  return json({ drives: results });
}

async function handleDisconnectDrive(req, env, driveId) {
  if (!await verifyAdminSession(req, env)) return json({ error: 'Unauthorized' }, 401);
  const db = await upsGet(env, 'td:db');
  db.drives = (db.drives || []).filter(d => d.id !== driveId);
  await upsSet(env, 'td:db', db);
  return json({ ok: true });
}

async function handleUploadInit(req, env) {
  const session = await verifyAnySession(req, env);
  if (!session) return json({ error: 'Please sign in to upload' }, 401);
  const body = await req.json().catch(() => ({}));
  const { driveId, folderId, name, size, mimeType } = body;
  const db = await upsGet(env, 'td:db');
  const drive = (db?.drives || []).find(d => d.id === driveId);
  if (!drive) return json({ error: 'Drive not found' }, 404);
  const at = await getAccessToken(env, drive.encToken);
  let parentId = drive.rootFolderId;
  if (folderId) {
    const f = (db.folders || []).find(f => f.id === folderId);
    if (f?.googleFolderId) parentId = f.googleFolderId;
  }
  const initResp = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,mimeType', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${at}`,
      'Content-Type': 'application/json',
      'X-Upload-Content-Type': mimeType || 'application/octet-stream',
      'X-Upload-Content-Length': String(size),
    },
    body: JSON.stringify({ name, mimeType: mimeType || 'application/octet-stream', parents: [parentId] }),
  });
  const uploadUrl = initResp.headers.get('Location');
  if (!uploadUrl) {
    const err = await initResp.text();
    return json({ error: 'Failed to create upload session', detail: err }, 500);
  }
  return json({ uploadUrl, fileLocalId: uid() });
}

async function handleUploadComplete(req, env) {
  const session = await verifyAnySession(req, env);
  if (!session) return json({ error: 'Unauthorized' }, 401);
  const body = await req.json().catch(() => ({}));
  const { fileLocalId, googleFileId, driveId, folderId, name, size, mimeType } = body;
  const db = await upsGet(env, 'td:db');
  if (!db) return json({ error: 'DB error' }, 500);
  if (!db.files) db.files = [];
  db.files.push({ id: fileLocalId, googleFileId, driveId, folderId: folderId || null, name, size, mimeType: mimeType || 'application/octet-stream', uploadedBy: session, date: new Date().toISOString() });
  if (!db.activityLog) db.activityLog = [];
  const drive = (db.drives || []).find(d => d.id === driveId);
  db.activityLog.unshift({ id: uid(), type: 'upload', name, size, driveId, driveLetter: drive?.email || '?', ts: new Date().toISOString() });
  if (db.activityLog.length > 500) db.activityLog = db.activityLog.slice(0, 500);
  await upsSet(env, 'td:db', db);
  return json({ ok: true });
}

async function handleDownload(req, env, googleFileId) {
  const session = await verifyAnySession(req, env);
  if (!session) return json({ error: 'Please sign in to download' }, 401);
  const driveId = new URL(req.url).searchParams.get('driveId');
  const db = await upsGet(env, 'td:db');
  const drive = (db?.drives || []).find(d => d.id === driveId);
  if (!drive) return json({ error: 'Drive not found' }, 404);
  const at = await getAccessToken(env, drive.encToken);
  const url = `https://www.googleapis.com/drive/v3/files/${googleFileId}?alt=media&access_token=${at}`;
  return json({ url });
}

async function handleDeleteFile(req, env, googleFileId) {
  if (!await verifyAdminSession(req, env)) return json({ error: 'Unauthorized' }, 401);
  const driveId = new URL(req.url).searchParams.get('driveId');
  const db = await upsGet(env, 'td:db');
  const drive = (db?.drives || []).find(d => d.id === driveId);
  if (!drive) return json({ error: 'Drive not found' }, 404);
  const at = await getAccessToken(env, drive.encToken);
  await fetch(`https://www.googleapis.com/drive/v3/files/${googleFileId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${at}` } });
  db.files = (db.files || []).filter(f => f.googleFileId !== googleFileId);
  if (db.activityLog) db.activityLog.unshift({ id: uid(), type: 'delete', googleFileId, driveId, ts: new Date().toISOString() });
  await upsSet(env, 'td:db', db);
  return json({ ok: true });
}

async function handleCreateFolder(req, env) {
  const session = await verifyAnySession(req, env);
  if (!session) return json({ error: 'Unauthorized' }, 401);
  const body = await req.json().catch(() => ({}));
  const { driveId, parentFolderId, name } = body;
  const db = await upsGet(env, 'td:db');
  const drive = (db?.drives || []).find(d => d.id === driveId);
  if (!drive) return json({ error: 'Drive not found' }, 404);
  const at = await getAccessToken(env, drive.encToken);
  let googleParentId = drive.rootFolderId;
  if (parentFolderId) {
    const pf = (db.folders || []).find(f => f.id === parentFolderId);
    if (pf?.googleFolderId) googleParentId = pf.googleFolderId;
  }
  const googleFolderId = await getOrCreateFolder(at, name, googleParentId);
  const fId = uid();
  if (!db.folders) db.folders = [];
  db.folders.push({ id: fId, driveId, parentId: parentFolderId || null, name, googleFolderId, date: new Date().toISOString() });
  await upsSet(env, 'td:db', db);
  return json({ ok: true, folderId: fId });
}

async function handleDeleteFolder(req, env, folderId) {
  if (!await verifyAdminSession(req, env)) return json({ error: 'Unauthorized' }, 401);
  const db = await upsGet(env, 'td:db');
  const folder = (db.folders || []).find(f => f.id === folderId);
  if (!folder) return json({ error: 'Folder not found' }, 404);
  if (folder.googleFolderId) {
    const drive = (db.drives || []).find(d => d.id === folder.driveId);
    if (drive) {
      try { const at = await getAccessToken(env, drive.encToken); await fetch(`https://www.googleapis.com/drive/v3/files/${folder.googleFolderId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${at}` } }); } catch {}
    }
  }
  function getAllIds(fid) { const ids = [fid]; (db.folders || []).filter(f => f.parentId === fid).forEach(f => ids.push(...getAllIds(f.id))); return ids; }
  const allIds = getAllIds(folderId);
  db.files = (db.files || []).filter(f => !allIds.includes(f.folderId));
  db.folders = (db.folders || []).filter(f => !allIds.includes(f.id));
  await upsSet(env, 'td:db', db);
  return json({ ok: true });
}

async function handleCreateUser(req, env) {
  if (!await verifyAdminSession(req, env)) return json({ error: 'Unauthorized' }, 401);
  const body = await req.json().catch(() => ({}));
  const { username, password, allowedDrives } = body;
  const db = await upsGet(env, 'td:db');
  if (!db.users) db.users = [];
  if (db.users.find(u => u.username === username)) return json({ error: 'Username already taken' }, 409);
  db.users.push({ id: uid(), username, passwordHash: await sha256(password), allowedDrives: allowedDrives || 'all', createdAt: new Date().toISOString() });
  await upsSet(env, 'td:db', db);
  return json({ ok: true });
}

async function handleDeleteUser(req, env, userId) {
  if (!await verifyAdminSession(req, env)) return json({ error: 'Unauthorized' }, 401);
  const db = await upsGet(env, 'td:db');
  db.users = (db.users || []).filter(u => u.id !== userId);
  await upsSet(env, 'td:db', db);
  return json({ ok: true });
}

async function handleChangePassword(req, env) {
  if (!await verifyAdminSession(req, env)) return json({ error: 'Unauthorized' }, 401);
  const body = await req.json().catch(() => ({}));
  const { newPassword } = body;
  if (!newPassword || newPassword.length < 4) return json({ error: 'Password too short (min 4 chars)' }, 400);
  const db = await upsGet(env, 'td:db');
  db.adminHash = await sha256(newPassword);
  await upsSet(env, 'td:db', db);
  return json({ ok: true });
}

async function handleInit(req, env) {
  const existing = await upsGet(env, 'td:db');
  if (existing && existing.adminHash) {
    // Allow reset via secret param
    const url = new URL(req.url);
    if (url.searchParams.get('reset') !== 'yes') {
      return json({ error: 'Already initialized', adminHash: existing.adminHash.slice(0,8)+'...' }, 409);
    }
  }
  const body = await req.json().catch(() => ({}));
  const pass = body.adminPassword || 'admin123';
  const db = { v: 3, adminHash: await sha256(pass), drives: [], files: [], folders: [], activityLog: [], users: [] };
  await upsSet(env, 'td:db', db);
  return json({ ok: true, message: `Admin password set to: ${pass}` });
}

// ─── Main Router ─────────────────────────────────────
export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const url = new URL(request.url);
  const p = url.pathname.replace(/^\/api\/?/, '');
  const m = request.method;

  try {
    if (p === 'auth/login'        && m === 'POST')   return handleAdminLogin(request, env);
    if (p === 'auth/user-login'   && m === 'POST')   return handleUserLogin(request, env);
    if (p === 'auth/google'       && m === 'GET')    return handleGoogleAuthStart(request, env);
    if (p === 'auth/callback'     && m === 'GET')    return handleGoogleCallback(request, env);
    if (p === 'db'                && m === 'GET')    return handleGetDB(request, env);
    if (p === 'drives/quota'      && m === 'GET')    return handleDriveQuota(request, env);
    if (p.startsWith('drives/')   && m === 'DELETE') return handleDisconnectDrive(request, env, p.replace('drives/', ''));
    if (p === 'upload/init'       && m === 'POST')   return handleUploadInit(request, env);
    if (p === 'upload/complete'   && m === 'POST')   return handleUploadComplete(request, env);
    if (p.startsWith('download/') && m === 'GET')    return handleDownload(request, env, p.replace('download/', ''));
    if (p.startsWith('files/')    && m === 'DELETE') return handleDeleteFile(request, env, p.replace('files/', ''));
    if (p === 'folders'           && m === 'POST')   return handleCreateFolder(request, env);
    if (p.startsWith('folders/')  && m === 'DELETE') return handleDeleteFolder(request, env, p.replace('folders/', ''));
    if (p === 'admin/users'       && m === 'POST')   return handleCreateUser(request, env);
    if (p.startsWith('admin/users/') && m === 'DELETE') return handleDeleteUser(request, env, p.replace('admin/users/', ''));
    if (p === 'admin/change-password' && m === 'POST') return handleChangePassword(request, env);
    if (p === 'admin/init'        && m === 'POST')   return handleInit(request, env);
    return json({ error: 'Not found', path: p }, 404);
  } catch (e) {
    console.error('[API]', e.stack || e.message);
    return json({ error: e.message || 'Internal server error' }, 500);
  }
}
