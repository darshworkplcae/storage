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

async function onLoginSuccess() {
  S.db = await apiFetchDB();
  updateSidebarProfile();
  updateNavVisibility();
  renderSidebarStorage();
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
  var $n=$('sbName'),$r=$('sbRole'),$a=$('sbAvatar');
  if($n) $n.textContent = isAdmin?'Admin':(S.ses.username||'User');
  if($r) $r.textContent = isAdmin?'Administrator':'User';
  if($a) $a.textContent = (S.ses.username||'U')[0].toUpperCase();
  if($a) $a.style.background = isAdmin?'#4e86f5':'#30d158';
}

function updateNavVisibility() {
  var isAdmin = S.ses.role==='admin';
  document.querySelectorAll('.admin-only').forEach(function(el){
    el.classList.toggle('hidden',!isAdmin);
  });
  var adminBtn=$('adminQuickBtn'); if(adminBtn) adminBtn.classList.toggle('hidden',!isAdmin);
}

function updateUploadBtnVisibility() {
  var show = !!S.ses.token && !!_driveId;
  ['uploadBtn','folderUpBtn','newFolderBtn','syncBtn'].forEach(function(id){
    var el=$(id); if(el) el.classList.toggle('hidden',!show);
  });
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
  if(cancelBtn) cancelBtn.onclick=function(){S.cancelUpload=true;};
  // Sync
  var syncBtn=$('syncBtn');
  if(syncBtn) syncBtn.onclick=async function(){
    S.db=await apiFetchDB();
    renderFilesPage(_driveId,_folderId);
    renderSidebarStorage();
    toast('Synced','success');
  };
  // Transfer panel
  var tmBtn=$('tmBtn'),tmPanel=$('tmPanel');
  if(tmBtn&&tmPanel){
    tmBtn.onclick=function(e){e.stopPropagation();tmPanel.classList.toggle('hidden');};
    document.addEventListener('click',function(e){if(tmPanel&&!tmPanel.contains(e.target)&&e.target!==tmBtn)tmPanel.classList.add('hidden');});
  }
  var tmClear=$('tmClear');
  if(tmClear) tmClear.onclick=function(){tmSave([]);renderTM();};
  // Search
  var gs=$('globalSearch');
  if(gs) gs.addEventListener('input',debounce(function(){S.filter=gs.value;if(_driveId||_curPage==='files')renderFilesPage(_driveId,_folderId);},300));
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
      updateSidebarProfile();
      updateNavVisibility();
      renderSidebarStorage();
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

  // Not logged in — show login page
  showLoginPage();
  wireEvents();
}

document.addEventListener('DOMContentLoaded', init);