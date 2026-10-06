// TeleDrive — Init & Events
async function init(){
  loadSes();
  S.db=await apiFetchDB();
  if(!S.db){
    await apiInit();
    S.db=await apiFetchDB();
  }

  const isAuth=S.ses.token && S.ses.role;
  // Show auth gate only if no session AND site requires login (drives exist but no public access)
  // For simplicity: always show app shell, require login for upload/admin
  showApp();
  renderSidebarProfile();
  renderSidebarStorage();
  renderTM();
  wireEvents();
  handleInitialHash();
}

function showApp(){
  $('authGate')?.classList.add('hidden');
  $('appShell')?.classList.remove('hidden');
}

function showAuthGate(){
  $('authGate')?.classList.remove('hidden');
  $('appShell')?.classList.add('hidden');
}

function wireEvents(){
  // Upload btn
  $('uploadBtn')?.addEventListener('click',()=>$('fileInput')?.click());
  $('fileInput')?.addEventListener('change',e=>{if(e.target.files?.length)uploadFiles(e.target.files);});
  $('upCancelBtn')?.addEventListener('click',()=>{S.cancelUpload=true;S._xhr?.abort();});

  // New folder
  $('newFolderBtn')?.addEventListener('click',showNewFolderDialog);

  // Sync
  $('syncBtn')?.addEventListener('click',async()=>{
    toast('Syncing…','info');
    const r=await apiDriveQuota().catch(()=>null);
    if(r?.drives){r.drives.forEach(qd=>{const d=S.db?.drives?.find(x=>x.id===qd.id);if(d&&!qd.error){d.capacity=qd.capacity;d.usedBytes=qd.usedBytes;}});renderSidebarStorage();toast('Synced!','success');}
    else toast('Sync failed','error');
  });

  // Transfer panel
  $('tmBtn')?.addEventListener('click',()=>{$('tmPanel')?.classList.toggle('open');renderTM();});
  $('tmClear')?.addEventListener('click',()=>{localStorage.removeItem('td:tm');renderTM();});
  document.addEventListener('click',e=>{if(!e.target.closest('.tm-btn-wrap'))$('tmPanel')?.classList.remove('open');});

  // Search
  $('globalSearch')?.addEventListener('input',()=>{
    if(_driveId||_curPage==='files')renderFilesPage(_driveId,_folderId);
    else navTo(_curPage);
  });
  $('globalSearch')?.addEventListener('keydown',e=>{if(e.key==='Escape')$('globalSearch').value='';});

  // Keyboard shortcuts
  document.addEventListener('keydown',e=>{
    if((e.ctrlKey||e.metaKey)&&e.key==='k'){e.preventDefault();$('globalSearch')?.focus();}
    if(e.key==='Escape'){document.querySelectorAll('.media-ov,.ctx-menu').forEach(el=>el.remove());}
  });
}

// Auth
async function doLogin(){
  const u=($('authUser')?.value||'').trim(),p=$('authPass')?.value||'';
  if(!u||!p){showAuthErr('Please fill all fields');return;}
  const r=await apiUserLogin(u,p);
  if(r.token){
    Object.assign(S.ses,{token:r.token,role:r.role,userId:r.userId,username:r.username,allowedDrives:r.allowedDrives||'all'});
    saveSes();S.db=await apiFetchDB();
    showApp();renderSidebarProfile();renderSidebarStorage();
    navTo('files');toast('Welcome, '+u+'!','success');
  }else showAuthErr(r.error||'Login failed');
}

async function doAdminLogin(){
  const p=$('adminPass')?.value||'';
  if(!p){showAuthErr('Enter admin password');return;}
  const r=await apiAdminLogin(p);
  if(r.token){
    Object.assign(S.ses,{token:r.token,role:'admin',userId:null,username:'Admin',allowedDrives:'all'});
    saveSes();S.db=await apiFetchDB();
    showApp();renderSidebarProfile();renderSidebarStorage();
    navTo('files');toast('Admin access granted','success');
  }else showAuthErr(r.error||'Wrong password');
}

function showAuthErr(msg){const el=$('authErr');if(el){el.textContent=msg;el.classList.remove('hidden');}}
function doLogout(){clearSes();S.ses={token:null,role:null,userId:null,username:null,allowedDrives:'all'};renderSidebarProfile();renderSidebarStorage();navTo('files');toast('Logged out','info');}

// Sign In button in header
document.addEventListener('DOMContentLoaded',()=>{
  // Remove old sign-in btn from topbar if no auth
});

window.addEventListener('DOMContentLoaded',init);