// Global helpers — must be available even before init()
function showSignIn() {
  var g = $('authGate'); if(g) g.classList.remove('hidden');
  var af = $('adminForm'), uf = $('userForm'), t=$('authTabs');
  if(af) af.classList.add('hidden');
  if(uf) uf.classList.remove('hidden');
  if(t) { t.querySelectorAll('.seg').forEach(function(b,i){ b.classList.toggle('active',i===0); }); }
}
function hideSignIn() { var g=$('authGate'); if(g) g.classList.add('hidden'); }
function showSignInAdmin() {
  var g=$('authGate'); if(g) g.classList.remove('hidden');
  var af=$('adminForm'), uf=$('userForm'), t=$('authTabs');
  if(uf) uf.classList.add('hidden');
  if(af) af.classList.remove('hidden');
  if(t) { t.querySelectorAll('.seg').forEach(function(b,i){ b.classList.toggle('active',i===1); }); }
}

function updateAuthUI() {
  var isLoggedIn = !!S.ses.token;
  var isAdmin = S.ses.role === 'admin';

  // Sign In button — hide when logged in
  var signinBtn = $('signinBtn');
  if(signinBtn) signinBtn.classList.toggle('hidden', isLoggedIn);

  // Admin quick button — only for admins
  var adminBtn = $('adminQuickBtn');
  if(adminBtn) adminBtn.classList.toggle('hidden', !isAdmin);

  // Sidebar profile
  var sbName=$('sbName'), sbRole=$('sbRole'), sbAvatar=$('sbAvatar');
  if(sbName) sbName.textContent = isAdmin ? 'Admin' : (S.ses.username || 'Guest');
  if(sbRole) sbRole.textContent = isAdmin ? 'Administrator' : (isLoggedIn ? 'User' : 'Browse only');
  if(sbAvatar) sbAvatar.textContent = isAdmin ? 'A' : (S.ses.username ? S.ses.username[0].toUpperCase() : '?');

  // Log Out button — only when logged in
  var logoutBtn = $('sbLogout');
  if(logoutBtn) logoutBtn.classList.toggle('hidden', !isLoggedIn);

  // Upload/folder buttons — only for logged in users
  ['uploadBtn','newFolderBtn','folderUpBtn'].forEach(function(id){
    var el=$(id); if(el) el.classList.toggle('hidden', !isLoggedIn || !_driveId);
  });

  // Nav items — hide admin-only items for users
  document.querySelectorAll('.admin-only').forEach(function(el){
    el.classList.toggle('hidden', !isAdmin);
  });
}

async function doAdminLogin() {
  var btn = document.querySelector('#adminForm .btn-primary');
  var passEl = $('adminPass');
  if(!passEl) return;
  var pass = passEl.value.trim();
  if(!pass) { showAuthErr('Enter admin password'); return; }

  setAuthLoading(true);
  var r = await apiAdminLogin(pass);
  setAuthLoading(false);

  if(r.token) {
    S.ses = { token:r.token, role:'admin', userId:null, username:'Admin', allowedDrives:'all' };
    saveSes();
    hideSignIn();
    S.db = await apiFetchDB();
    updateAuthUI();
    renderSidebarStorage();
    navTo(_curPage || 'files');
    toast('Welcome, Admin!', 'success');
    passEl.value = '';
  } else {
    showAuthErr(r.error || 'Login failed');
  }
}

async function doLogin() {
  var userEl=$('authUser'), passEl=$('authPass');
  if(!userEl||!passEl) return;
  var user=userEl.value.trim(), pass=passEl.value.trim();
  if(!user||!pass){showAuthErr('Enter username and password');return;}

  setAuthLoading(true);
  var r = await apiUserLogin(user, pass);
  setAuthLoading(false);

  if(r.token) {
    S.ses = { token:r.token, role:'user', userId:r.userId, username:r.username, allowedDrives:r.allowedDrives||'all' };
    saveSes();
    hideSignIn();
    S.db = await apiFetchDB();
    updateAuthUI();
    renderSidebarStorage();
    navTo('files');
    toast('Welcome, ' + r.username + '!', 'success');
    userEl.value=''; passEl.value='';
  } else {
    showAuthErr(r.error || 'Login failed');
  }
}

function doLogout() {
  clearSes();
  S.db = null;
  updateAuthUI();
  renderSidebarStorage();
  navTo('files');
  toast('Logged out', 'info');
}

function showAuthErr(msg) {
  var el=$('authErr');
  if(!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(function(){ el.classList.add('hidden'); }, 4000);
}
function setAuthLoading(on) {
  var btns = document.querySelectorAll('#authGate .btn-primary');
  btns.forEach(function(b){ b.disabled=on; b.innerHTML=on?'<i class="fas fa-spinner fa-spin"></i> Please wait…':b.dataset.orig||(b.dataset.orig=b.innerHTML); });
}

function debounce(fn, ms) {
  var t; return function(){ clearTimeout(t); t=setTimeout(fn, ms); };
}

function wireEvents() {
  // Upload button
  var fi=$('fileInput'), upBtn=$('uploadBtn');
  if(upBtn) upBtn.onclick = function(){ fi && fi.click(); };
  if(fi) fi.onchange = function(){ if(fi.files.length){ uploadFiles(fi.files); fi.value=''; } };

  // Folder upload
  var folBtn=$('folderUpBtn');
  if(folBtn) folBtn.onclick = uploadFolder;

  // New folder
  var nfBtn=$('newFolderBtn');
  if(nfBtn) nfBtn.onclick = showNewFolderDialog;

  // Cancel upload
  var cancelBtn=$('upCancelBtn');
  if(cancelBtn) cancelBtn.onclick = function(){ S.cancelUpload=true; };

  // Sync
  var syncBtn=$('syncBtn');
  if(syncBtn) syncBtn.onclick = async function(){
    S.db = await apiFetchDB();
    renderFilesPage(_driveId, _folderId);
    renderSidebarStorage();
    toast('Synced','success');
  };

  // Transfer panel
  var tmBtn=$('tmBtn'), tmPanel=$('tmPanel');
  if(tmBtn && tmPanel) {
    tmBtn.onclick = function(e){ e.stopPropagation(); tmPanel.classList.toggle('hidden'); };
    document.addEventListener('click', function(e){ if(!tmPanel.contains(e.target)&&e.target!==tmBtn) tmPanel.classList.add('hidden'); });
  }
  var tmClear=$('tmClear');
  if(tmClear) tmClear.onclick = function(){ tmSave([]); renderTM(); };

  // Search
  var gs=$('globalSearch');
  if(gs) gs.addEventListener('input', debounce(function(){
    S.filter=gs.value;
    if(_driveId||_curPage==='files') renderFilesPage(_driveId,_folderId);
  },300));

  // Drag & drop
  var main=document.querySelector('.main-area');
  if(main){
    main.addEventListener('dragover',function(e){e.preventDefault();main.classList.add('drag-over');});
    main.addEventListener('dragleave',function(){main.classList.remove('drag-over');});
    main.addEventListener('drop',function(e){e.preventDefault();main.classList.remove('drag-over');if(e.dataTransfer.files.length)uploadFiles(e.dataTransfer.files);});
  }

  // Enter key for login forms
  document.addEventListener('keydown',function(e){
    if(e.key==='Enter'&&$('authGate')&&!$('authGate').classList.contains('hidden')){
      if(!$('adminForm').classList.contains('hidden')) doAdminLogin();
      else doLogin();
    }
    if((e.ctrlKey||e.metaKey)&&e.key==='k'){e.preventDefault();var gs=$('globalSearch');if(gs)gs.focus();}
  });
}

async function showApp() {
  var shell=$('appShell');
  if(shell) shell.style.display='flex';
  updateAuthUI();
  renderSidebarStorage();
}

async function init() {
  try {
    // Load persisted session
    loadSes();

    // Fetch DB (always, even as guest)
    S.db = await apiFetchDB();

    // If session token saved but DB fetch failed auth, clear it
    if(S.ses.token && !S.db) {
      clearSes();
    }

    showApp();
    wireEvents();
    renderTM();
    handleInitialHash();
  } catch(e) {
    console.error('Init error:', e);
    showApp();
    var pc=$('pageContent');
    if(pc) pc.innerHTML='<div class="empty-state"><div class="empty-icon"><i class="fas fa-triangle-exclamation" style="color:var(--danger)"></i></div><h3>Init error: '+e.message+'</h3><button class="btn-primary" onclick="location.reload()">Reload</button></div>';
  }
}

document.addEventListener('DOMContentLoaded', init);