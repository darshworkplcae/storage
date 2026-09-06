// TELEDRIVE — Main
async function init(){
  loadCfg(); loadSes();
  $('homeScreen').classList.remove('hidden');
  const overlay=$('loadingOverlay');
  if(overlay)overlay.style.display='flex';
  let dbStatus='error';
  try{
    dbStatus=await Promise.race([loadDB(),new Promise(r=>setTimeout(()=>r('error'),15000))]);
  }catch{dbStatus='error';}
  if(overlay)overlay.style.display='none';
  if(dbStatus==='error'){
    // Network error — show app with warning, don't overwrite data
    if(overlay){overlay.style.display='flex';overlay.innerHTML=`<i class="fas fa-exclamation-triangle" style="font-size:2.5rem;color:var(--warning);margin-bottom:1rem"></i><h3>Database Unreachable</h3><p style="color:var(--text2);margin:.5rem 0 1.5rem;text-align:center">Could not reach Upstash.<br>Check your connection.</p><div style="display:flex;gap:.8rem"><button class="btn-p" onclick="location.reload()"><i class="fas fa-redo"></i> Retry</button></div>`;}
    return;
  }
  if(dbStatus==='empty'){
    // Genuine first run — create default DB
    await autoSetup();
  }
  // dbStatus==='ok' — data loaded, nothing more to do
  // Patch: ensure activityLog exists on old DBs
  if(!S.db.activityLog)S.db.activityLog=[];
  syncAdminUI(); renderTransferPanel(); wireEvents();
  if(window.location.hash&&window.location.hash!=='#'&&window.location.hash!=='#/')
    handleHash();
  else goHome();
}

function wireEvents(){
  $('logoutBtn').onclick=()=>{S.ses.isAdmin=false;saveSes();syncAdminUI();window.location.hash='#/';goHome();toast('Logged out','info');};
  $('navBack').onclick=navBack; $('navFwd').onclick=navFwd; $('navUp').onclick=navUp;
  $('uploadBtn').onclick=()=>$('fileInput').click();
  $('newFolderBtn').onclick=newFolderDlg;
  $('fileInput').onchange=e=>{if(e.target.files.length)uploadFiles(e.target.files);};
  $('globalSearch').oninput=()=>{if(S.driveId)renderContent();else renderHome();};
  $('viewToggleBtn').onclick=()=>{S.view=S.view==='grid'?'list':'grid';$('viewToggleBtn').innerHTML=S.view==='grid'?'<i class="fas fa-th"></i>':'<i class="fas fa-list"></i>';renderContent();};
  $('sortSel').onchange=e=>{S.sort=e.target.value;renderContent();};
  document.querySelectorAll('.filter-btn').forEach(btn=>{
    btn.onclick=()=>{document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');S.filter=btn.dataset.f;S.filterExt='';$('filterExt').value='';renderContent();};
  });
  $('filterExt').oninput=e=>{const v=e.target.value.trim();if(v){S.filter='ext';S.filterExt=v;document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));}else{S.filter='all';S.filterExt='';document.querySelector('.filter-btn[data-f="all"]')?.classList.add('active');}renderContent();};
  window.addEventListener('hashchange',handleHash);
  // Transfer manager toggle
  $('tmToggle').onclick=()=>{const p=$('tmPanel');p.classList.toggle('open');if(p.classList.contains('open'))renderTransferPanel();};
  $('tmClearBtn').onclick=()=>{localStorage.removeItem('td:transfers');renderTransferPanel();};
  document.addEventListener('keydown',e=>{
    if(e.altKey&&e.key==='ArrowLeft')navBack();
    if(e.altKey&&e.key==='ArrowRight')navFwd();
    if((e.ctrlKey||e.metaKey)&&e.key==='k'){e.preventDefault();$('globalSearch').focus();}
    if(e.key==='Backspace'&&document.activeElement===document.body)navUp();
  });
  setInterval(async()=>{if(!S.uploading&&S.driveId){const ok=await loadDB();if(ok==='ok')renderExplorer();}},120000);
}

document.addEventListener('DOMContentLoaded',init);