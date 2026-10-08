function showSignInModal() {
  var lp = $('loginPage');
  if(lp) {
    lp.style.display = 'flex';
    lp.classList.add('modal-mode');
  }
}
function hideSignInModal() {
  var lp = $('loginPage');
  if(lp) {
    if(S.ses && S.ses.token) {
      lp.style.display = 'none';
    } else {
      // If guest, keep appShell visible and close modal
      lp.style.display = 'none';
      showAppShell();
    }
  }
}

// ─── Admin login overlay ──────────────────────────────────────────────────────
function showAdminLogin(e) {
  if(e) e.preventDefault();
  var ov=$('adminLoginOverlay'); if(ov) ov.classList.remove('hidden');
  var inp=$('adminPassInp'); if(inp){inp.value='';inp.focus();}
  history.replaceState(null,'','#/admin');
}
function hideAdminLogin() {
  var ov=$('adminLoginOverlay'); if(ov) ov.classList.add('hidden');
  history.replaceState(null,'','#/');
  var inp=$('adminPassInp'); if(inp) inp.value='';
  var err=$('adminErr'); if(err) err.classList.add('hidden');
}

// ─── Auth UI helpers ──────────────────────────────────────────────────────────
function showLoginPage()  { var lp=$('loginPage');  if(lp) lp.style.display='flex'; var sh=$('appShell'); if(sh) sh.style.display='none'; }
function showAppShell()   { var lp=$('loginPage');  if(lp) lp.style.display='none'; var sh=$('appShell'); if(sh) sh.style.display='flex'; }

function setLpError(id, msg) {
  var el=$(id); if(!el) return;
  el.textContent=msg; el.classList.remove('hidden');
  setTimeout(function(){ el.classList.add('hidden'); }, 5000);
}
function setLpLoading(btnId, on) {
  var btn=$(btnId); if(!btn) return;
  if(!btn.dataset.orig) btn.dataset.orig = btn.innerHTML;
  btn.disabled = on;
  btn.innerHTML = on ? '<i class="fas fa-spinner fa-spin"></i> Please wait…' : btn.dataset.orig;
}

// ─── Login actions ────────────────────────────────────────────────────────────
async function doUserLogin() {
  var u=$('lpUser'), p=$('lpPass');
  var user=(u&&u.value.trim())||'', pass=(p&&p.value.trim())||'';
  if(!user||!pass){setLpError('lpErr','Enter username and password');return;}
  setLpLoading('lpLoginBtn',true);
  var r = await apiUserLogin(user, pass);
  setLpLoading('lpLoginBtn',false);
  if(r.token){
    S.ses={token:r.token,role:'user',userId:r.userId,username:r.username,allowedDrives:r.allowedDrives||'all'};
    saveSes(); await onLoginSuccess();
  } else setLpError('lpErr', r.error||'Login failed');
}

async function doAdminLogin() {
  var p=$('adminPassInp'); var pass=(p&&p.value.trim())||'';
  if(!pass){setLpError('adminErr','Enter admin password');return;}
  setLpLoading('adminLoginBtn',true);
  var r = await apiAdminLogin(pass);
  setLpLoading('adminLoginBtn',false);
  if(r.token){
    S.ses={token:r.token,role:'admin',userId:null,username:'Admin',allowedDrives:'all'};
    saveSes(); hideAdminLogin(); await onLoginSuccess();
  } else setLpError('adminErr', r.error||'Wrong password');
}

function syncLiveQuota() {
  if (!S.ses || !S.ses.token) return;
  apiDriveQuota().then(function(res){
    if (res && res.drives && S.db && S.db.drives) {
      var changed = false;
      res.drives.forEach(function(qd){
        var d = S.db.drives.find(function(x){ return x.id === qd.id; });
        if (d && !qd.error && (d.capacity !== qd.capacity || d.usedBytes !== qd.usedBytes)) {
          d.capacity = qd.capacity;
          d.usedBytes = qd.usedBytes;
          changed = true;
        }
      });
      if (changed) {
        renderSidebarStorage();
        if (_curPage === 'files' && !_driveId) renderFilesPage(null, null);
        if (_curPage === 'quota') renderQuotaPage();
        if (_curPage === 'settings' && typeof renderSettingsPage === 'function') renderSettingsPage();
      }
    }
  }).catch(function(){});
}

async function onLoginSuccess() {
  S.db = await apiFetchDB();
  if(S.db && S.db.files) tmSyncWithServer(S.db.files);
  updateSidebarProfile();
  updateNavVisibility();
  renderSidebarStorage();
  syncLiveQuota();
  showAppShell();
  toast('Welcome'+(S.ses.username?' '+S.ses.username:'')+'!','success');
  // Route to appropriate first page
  var hash = window.location.hash.replace('#/','').split('/')[0];
  var validPages = ['files','quota','recent','starred','trash','activity','settings','apikeys'];
  var startPage = (validPages.indexOf(hash)>=0 && hash!=='admin') ? hash : 'files';
  navTo(startPage);
  renderTM();
}

function doLogout() {
  clearSes();
  S.db = null;
  showLoginPage();
  history.replaceState(null,'','#/');
  toast('Logged out','info');
}

// ─── Sidebar helpers ──────────────────────────────────────────────────────────
function updateSidebarProfile() {
  var isAdmin = S.ses.role==='admin';
  var isUser = S.ses && S.ses.role==='user';
  var $n=$('sbName'),$r=$('sbRole'),$a=$('sbAvatar');
  if($n) $n.textContent = isAdmin?'Admin':(S.ses.username||(isUser?'User':'Guest'));
  if($r) $r.textContent = isAdmin?'Administrator':(isUser?'Private User':'Guest Visitor');
  if($a) $a.textContent = (S.ses.username||(isAdmin?'A':'G'))[0].toUpperCase();
  if($a) $a.style.background = isAdmin?'#4e86f5':(isUser?'#30d158':'#64748b');
}

function updateNavVisibility() {
  var isAdmin = S.ses.role==='admin';
  var isUserOrAdmin = isAdmin || (S.ses && S.ses.role==='user');
  var isAuth = !!(S.ses && S.ses.token && S.ses.role);
  document.querySelectorAll('.admin-only').forEach(function(el){
    el.classList.toggle('hidden',!isAdmin);
  });
  document.querySelectorAll('.user-or-admin').forEach(function(el){
    el.classList.toggle('hidden',!isUserOrAdmin);
  });
  document.querySelectorAll('.guest-only').forEach(function(el){
    el.classList.toggle('hidden', isAuth);
  });
  var sbLogout = $('sbLogout'); if(sbLogout) sbLogout.classList.toggle('hidden', !isAuth);
  var sbLoginBtn = $('sbLoginBtn'); if(sbLoginBtn) sbLoginBtn.classList.toggle('hidden', isAuth);
  var pmenuLogout = $('pmenuLogout'); if(pmenuLogout) pmenuLogout.classList.toggle('hidden', !isAuth);
  var pmenuLogin = $('pmenuLogin'); if(pmenuLogin) pmenuLogin.classList.toggle('hidden', isAuth);
  var adminBtn=$('adminQuickBtn'); if(adminBtn) adminBtn.classList.toggle('hidden',!isAdmin);
}

function updateUploadBtnVisibility() {
  var isOpenTarget = (_driveId && S.db && S.db.openDriveId && _driveId === S.db.openDriveId);
  var canUpload = !!S.ses.token || isOpenTarget;
  var show = canUpload && !!_driveId;
  ['uploadBtn','folderUpBtn','newFolderBtn','syncBtn'].forEach(function(id){
    var el=$(id); if(el) el.classList.toggle('hidden',!show);
  });
  var fab = $('mobileFabWrap');
  if(fab) fab.classList.toggle('hidden', !(show && _curPage === 'files'));
  var guestInBtn = $('guestSignInBtn');
  if(guestInBtn) guestInBtn.classList.toggle('hidden', !!S.ses.token);
}

function toggleMobileSidebar() {
  var sb = $('appSidebar'), bd = $('sidebarBackdrop');
  if (!sb) return;
  var isOpen = sb.classList.contains('open');
  if (isOpen) {
    closeMobileSidebar();
  } else {
    sb.classList.add('open');
    if (bd) bd.classList.add('show');
  }
}

function closeMobileSidebar() {
  var sb = $('appSidebar'), bd = $('sidebarBackdrop');
  if (sb) sb.classList.remove('open');
  if (bd) bd.classList.remove('show');
}

function toggleMobileFab(forceState) {
  var menu = $('mobileFabMenu'), btn = $('mobileFabBtn');
  if (!menu) return;
  var shouldOpen = typeof forceState === 'boolean' ? forceState : menu.classList.contains('hidden');
  menu.classList.toggle('hidden', !shouldOpen);
  if (btn) btn.classList.toggle('active', shouldOpen);
}

function triggerMobileUploadFiles() {
  toggleMobileFab(false);
  var fi = $('fileInput');
  if (fi) fi.click();
}

function triggerMobileUploadFolder() {
  toggleMobileFab(false);
  uploadFolder();
}

// ─── Wire events ─────────────────────────────────────────────────────────────
function wireEvents() {
  // File upload
  var fi=$('fileInput'), upBtn=$('uploadBtn');
  if(upBtn) upBtn.onclick=function(){fi&&fi.click();};
  if(fi) fi.onchange=function(){if(fi.files.length){uploadFiles(fi.files);fi.value='';}};
  // Folder upload
  var folBtn=$('folderUpBtn');
  if(folBtn) folBtn.onclick=uploadFolder;
  // New folder
  var nfBtn=$('newFolderBtn');
  if(nfBtn) nfBtn.onclick=showNewFolderDialog;
  // Cancel upload
  var cancelBtn=$('upCancelBtn');
  if(cancelBtn) cancelBtn.onclick=function(){
    if(typeof _cancelSignal !== 'undefined' && _cancelSignal) {
      _cancelSignal.cancelled = true;
      if(_cancelSignal.resumeResolve) _cancelSignal.resumeResolve();
    }
    S.cancelUpload=true;
    toast('Upload cancelled', 'warning');
  };
  // Sync
  var syncBtn=$('syncBtn');
  if(syncBtn) syncBtn.onclick=async function(){
    S.db=await apiFetchDB();
    syncLiveQuota();
    renderFilesPage(_driveId,_folderId);
    renderSidebarStorage();
    toast('Synced','success');
  };
  // Transfer panel
  var tmBtn=$('tmBtn');
  if(tmBtn){
    tmBtn.onclick=function(e){
      e.stopPropagation();
      toggleTMPanel();
    };
    document.addEventListener('click',function(e){
      var tmPanel=$('tmPanel');
      if(tmPanel && !tmPanel.classList.contains('hidden') && !tmPanel.contains(e.target) && !tmBtn.contains(e.target)) {
        toggleTMPanel(false);
      }
    });
  }
  var tmClear=$('tmClear');
  if(tmClear) tmClear.onclick=function(){tmSave([]);renderTM();};
  // Close mobile FAB when tapping elsewhere
  document.addEventListener('click',function(e){
    var fabWrap=$('mobileFabWrap');
    if(fabWrap && !fabWrap.contains(e.target)){ toggleMobileFab(false); }
  });
  // Search
  var gs=$('globalSearch');
  if(gs) gs.addEventListener('input',debounce(function(){
    if(_driveId||_curPage==='files') renderFilesPage(_driveId,_folderId);
  },300));
  // Drag & drop
  var main=document.querySelector('.main-area');
  if(main){
    main.addEventListener('dragover',function(e){e.preventDefault();main.classList.add('drag-over');});
    main.addEventListener('dragleave',function(){main.classList.remove('drag-over');});
    main.addEventListener('drop',function(e){e.preventDefault();main.classList.remove('drag-over');if(e.dataTransfer.files.length)uploadFiles(e.dataTransfer.files);});
  }
  // Keyboard shortcuts
  document.addEventListener('keydown',function(e){
    if(e.key==='Enter'){
      var adminOv=$('adminLoginOverlay');
      if(adminOv&&!adminOv.classList.contains('hidden')){ doAdminLogin(); return; }
      var lp=$('loginPage');
      if(lp&&lp.style.display!=='none'){ doUserLogin(); return; }
    }
    if((e.ctrlKey||e.metaKey)&&e.key==='k'){e.preventDefault();var gs=$('globalSearch');if(gs)gs.focus();}
  });
}

function debounce(fn,ms){var t;return function(){clearTimeout(t);t=setTimeout(fn,ms);};}

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  if (typeof initTheme === 'function') initTheme();

  // Check hash — if #/admin, show admin login on the login page
  if(window.location.hash==='#/admin'||window.location.hash.startsWith('#/admin/')){
    showAdminLogin(null);
  }

  // Try to restore session from localStorage
  loadSes();
  if(S.ses.token) {
    // Verify session is still valid by fetching DB
    var db = await apiFetchDB().catch(function(){return null;});
    if(db) {
      S.db = db;
      if (S.db && S.db.files) tmSyncWithServer(S.db.files);
      updateSidebarProfile();
      updateNavVisibility();
      renderSidebarStorage();
      syncLiveQuota();
      showAppShell();
      wireEvents();
      renderTM();
      handleInitialHash();
      return;
    } else {
      // Session expired
      clearSes();
    }
  }

  // Not logged in: show Open Drive view (friends photo/video drive) with Sign In button on top!
  S.db = await apiFetchDB().catch(function(){return null;});
  if(S.db && S.db.files) tmSyncWithServer(S.db.files);
  showAppShell();
  updateSidebarProfile();
  updateNavVisibility();
  renderSidebarStorage();
  wireEvents();
  renderTM();
  // Show Drive card on landing page so users can click to open it
  navTo('files');

  // Check if an upload was interrupted before reload
  try {
    var interruptedBatch = localStorage.getItem('td_active_batch');
    var interruptedItems = tmLoad().filter(function(x){ return x.status === 'interrupted'; });
    if (interruptedItems.length > 0) {
      var batchInfo = interruptedBatch ? JSON.parse(interruptedBatch) : null;
      var batchName = (batchInfo && batchInfo.folderName) ? batchInfo.folderName : 'upload';
      setTimeout(function() {
        toast('Previous ' + batchName + ' had ' + interruptedItems.length + ' interrupted item(s). Click "Resume" in Transfers to continue!', 'warning', 7000);
      }, 1500);
    }
  } catch(e){}
}

document.addEventListener('DOMContentLoaded', init);