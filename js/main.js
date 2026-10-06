// TeleDrive — Init & Events

async function init(){
  try {
    loadSes();
    // Show app immediately (never blank)
    showApp();

    // Load DB
    S.db = await apiFetchDB().catch(()=>null);
    if(!S.db || S.db.error){
      // Try to init DB
      await apiInit().catch(()=>null);
      S.db = await apiFetchDB().catch(()=>null);
    }

    renderSidebarProfile();
    renderSidebarStorage();
    renderTM();
    wireEvents();
    handleInitialHash();
  } catch(e) {
    console.error('TeleDrive init error:', e);
    showApp(); // Always show app even on error
    const pc = $('pageContent');
    if(pc) pc.innerHTML = `<div class="loading-full" style="flex-direction:column;gap:1rem;color:var(--danger)">
      <i class="fas fa-exclamation-triangle" style="font-size:2rem"></i>
      <div>Init error: ${e.message || 'unknown'}</div>
      <button class="btn-primary" onclick="location.reload()">Reload</button>
    </div>`;
  }
}

function showApp(){
  const gate = $('authGate');
  const shell = $('appShell');
  if(gate) gate.classList.add('hidden');
  if(shell) shell.classList.remove('hidden');
}

function showLoginOverlay(cb){
  const ov = document.createElement('div');
  ov.id = 'loginOverlay';
  ov.className = 'login-overlay';
  ov.innerHTML = `<div class="auth-card">
    <div class="auth-logo"><i class="fas fa-hard-drive"></i></div>
    <h2 class="auth-title">Sign In</h2>
    <p class="auth-sub">Access TeleDrive</p>
    <div id="authErr2" class="auth-err hidden"></div>
    <div class="seg-tabs"><button class="seg active" onclick="switchTab2('user',this)">User</button><button class="seg" onclick="switchTab2('admin',this)">Admin</button></div>
    <div id="userForm2">
      <input class="inp" id="authUser2" type="text" placeholder="Username" autocomplete="username">
      <input class="inp" id="authPass2" type="password" placeholder="Password" autocomplete="current-password">
      <button class="btn-primary w100" onclick="doLogin2()"><i class="fas fa-sign-in-alt"></i> Sign In</button>
    </div>
    <div id="adminForm2" class="hidden">
      <input class="inp" id="adminPass2" type="password" placeholder="Admin password" autocomplete="current-password">
      <button class="btn-primary w100" onclick="doAdminLogin2()"><i class="fas fa-shield-halved"></i> Admin Login</button>
    </div>
    <button class="btn-ghost w100" style="margin-top:.5rem" onclick="closeLoginOverlay()">Cancel</button>
  </div>`;
  ov.addEventListener('click', e => { if(e.target === ov) closeLoginOverlay(); });
  document.body.appendChild(ov);
  window._loginCb = cb;
}

function closeLoginOverlay(){
  document.getElementById('loginOverlay')?.remove();
  window._loginCb = null;
}

function switchTab(mode,btn){
  document.querySelectorAll('#authTabs .seg').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  $('userForm').classList.toggle('hidden', mode==='admin');
  $('adminForm').classList.toggle('hidden', mode==='user');
}

function switchTab2(mode,btn){
  btn.parentElement.querySelectorAll('.seg').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  $('userForm2').classList.toggle('hidden', mode==='admin');
  $('adminForm2').classList.toggle('hidden', mode==='user');
}

function wireEvents(){
  $('uploadBtn')?.addEventListener('click', ()=>$('fileInput')?.click());
  $('fileInput')?.addEventListener('change', e=>{ if(e.target.files?.length) uploadFiles(e.target.files); });
  $('upCancelBtn')?.addEventListener('click', ()=>{ S.cancelUpload=true; S._xhr?.abort(); });
  $('newFolderBtn')?.addEventListener('click', showNewFolderDialog);
  $('syncBtn')?.addEventListener('click', doSync);
  $('tmBtn')?.addEventListener('click', ()=>{ $('tmPanel')?.classList.toggle('open'); renderTM(); });
  $('tmClear')?.addEventListener('click', ()=>{ localStorage.removeItem('td:tm'); renderTM(); });
  document.addEventListener('click', e=>{ if(!e.target.closest('.tm-btn-wrap')) $('tmPanel')?.classList.remove('open'); });
  $('globalSearch')?.addEventListener('input', debounce(()=>{
    if(_driveId || _curPage==='files') renderFilesPage(_driveId, _folderId);
    else navTo(_curPage);
  }, 200));
  $('globalSearch')?.addEventListener('keydown', e=>{ if(e.key==='Escape') $('globalSearch').value=''; });
  $('signinBtn')?.addEventListener('click', ()=> showLoginOverlay());
  document.addEventListener('keydown', e=>{
    if((e.ctrlKey||e.metaKey) && e.key==='k'){ e.preventDefault(); $('globalSearch')?.focus(); }
    if(e.key==='Escape'){ document.querySelectorAll('.media-ov,.ctx-menu').forEach(el=>el.remove()); }
  });
}

async function doSync(){
  toast('Syncing…','info');
  const r = await apiDriveQuota().catch(()=>null);
  if(r?.drives){
    r.drives.forEach(qd=>{ const d=S.db?.drives?.find(x=>x.id===qd.id); if(d&&!qd.error){d.capacity=qd.capacity;d.usedBytes=qd.usedBytes;} });
    renderSidebarStorage();
    toast('Synced!','success');
  } else toast('Sync failed — check drive credentials','error');
}

function debounce(fn, ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; }

// Auth
async function doLogin(){
  const u=($('authUser')?.value||'').trim(), p=$('authPass')?.value||'';
  if(!u||!p){ showAuthErr('authErr','Please fill all fields'); return; }
  const r = await apiUserLogin(u,p);
  if(r.token){ finishLogin(r,'user'); }
  else showAuthErr('authErr', r.error||'Login failed');
}
async function doAdminLogin(){
  const p = $('adminPass')?.value||'';
  if(!p){ showAuthErr('authErr','Enter admin password'); return; }
  const r = await apiAdminLogin(p);
  if(r.token){ finishLogin(r,'admin'); }
  else showAuthErr('authErr', r.error||'Wrong password');
}
async function doLogin2(){
  const u=($('authUser2')?.value||'').trim(), p=$('authPass2')?.value||'';
  if(!u||!p){ showAuthErr('authErr2','Please fill all fields'); return; }
  const r = await apiUserLogin(u,p);
  if(r.token){ finishLogin(r,'user'); closeLoginOverlay(); }
  else showAuthErr('authErr2', r.error||'Login failed');
}
async function doAdminLogin2(){
  const p = $('adminPass2')?.value||'';
  if(!p){ showAuthErr('authErr2','Enter admin password'); return; }
  const r = await apiAdminLogin(p);
  if(r.token){ finishLogin(r,'admin'); closeLoginOverlay(); }
  else showAuthErr('authErr2', r.error||'Wrong password');
}
async function finishLogin(r, role){
  Object.assign(S.ses,{token:r.token,role:r.role||role,userId:r.userId,username:r.username||'Admin',allowedDrives:r.allowedDrives||'all'});
  saveSes();
  S.db = await apiFetchDB();
  renderSidebarProfile();
  renderSidebarStorage();
  navTo('files');
  toast('Welcome!','success');
}
function showAuthErr(elId, msg){ const el=$(elId); if(el){el.textContent=msg;el.classList.remove('hidden');} }
function doLogout(){ clearSes(); S.ses={token:null,role:null,userId:null,username:null,allowedDrives:'all'}; renderSidebarProfile(); renderSidebarStorage(); navTo('files'); toast('Logged out','info'); }

window.addEventListener('DOMContentLoaded', init);