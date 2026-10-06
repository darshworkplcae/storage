// TeleDrive — Router & Nav State
let _curPage='files', _driveId=null, _folderId=null, _navHist=[], _navIdx=-1;

function navTo(page, driveId=null, folderId=null){
  // Update sidebar active
  document.querySelectorAll('.sb-nav-item').forEach(el=>{
    el.classList.toggle('active', el.dataset.page===page);
  });
  // Show/hide toolbar buttons based on page
  const isExplorer=(page==='files'||driveId);
  $('uploadBtn')?.classList.toggle('hidden', !isExplorer);
  $('newFolderBtn')?.classList.toggle('hidden', !isExplorer);
  $('syncBtn')?.classList.toggle('hidden', !isExplorer);
  document.querySelector('.view-size-btns')?.classList.toggle('hidden', !isExplorer);

  _curPage=page; _driveId=driveId; _folderId=folderId;
  const pc=$('pageContent'); if(!pc)return;
  pc.innerHTML='<div class="loading-full"><i class="fas fa-spinner fa-spin"></i></div>';

  switch(page){
    case 'files':   renderFilesPage(driveId, folderId); break;
    case 'quota':   renderQuotaPage();  break;
    case 'recent':  renderRecentPage(); break;
    case 'starred': renderPage('Starred','fa-star','#ff9f0a','No starred files yet.'); break;
    case 'trash':   renderPage('Recycle Bin','fa-trash-can','var(--danger)','Recycle bin is empty.'); break;
    case 'activity':renderActivityPage(); break;
    case 'settings':renderSettingsPage(); break;
    case 'apikeys': renderApiKeysPage(); break;
    default: renderFilesPage(null, null);
  }
  updateBreadcrumb(page, driveId, folderId);
  window.history.replaceState({}, '', `#/${page}${driveId?'/'+driveId:''}${folderId?'/'+folderId:''}`);
}

function updateBreadcrumb(page, driveId, folderId){
  const el=$('breadcrumb'); if(!el)return;
  const labels={files:'All Files',quota:'Quota Tracker',recent:'Recent',starred:'Starred',trash:'Recycle Bin',activity:'Activity Log',settings:'Setting',apikeys:'API Keys'};
  let parts=[];
  if(driveId){
    const drive=S.db?.drives?.find(d=>d.id===driveId);
    parts.push(`<span class="bc-item" onclick="navTo('files')" style="color:var(--text2)">All Files</span>`);
    parts.push(`<i class="fas fa-chevron-right bc-sep"></i>`);
    parts.push(`<span class="bc-item ${!folderId?'active':''}" onclick="navTo('files','${esc(driveId)}')" style="color:${esc(drive?.color||'var(--primary)')}">${esc(drive?.name||'Drive')}</span>`);
    if(folderId){
      const chain=getFolderChain(folderId);
      chain.forEach(f=>{
        parts.push(`<i class="fas fa-chevron-right bc-sep"></i>`);
        parts.push(`<span class="bc-item ${f.id===folderId?'active':''}" onclick="navTo('files','${esc(driveId)}','${esc(f.id)}')">${esc(f.name)}</span>`);
      });
    }
  }else{
    parts.push(`<span class="bc-item active">${labels[page]||page}</span>`);
  }
  el.innerHTML=parts.join('');
}

function getFolderChain(folderId){
  const chain=[];let cur=S.db?.folders?.find(f=>f.id===folderId);
  while(cur){chain.unshift(cur);cur=S.db?.folders?.find(f=>f.id===cur.parentId);}
  return chain;
}

function handleInitialHash(){
  const h=window.location.hash.replace('#/','').split('/').filter(Boolean);
  if(!h.length){navTo('files');return;}
  const page=h[0]; const driveId=h[1]||null; const folderId=h[2]||null;
  if(['files','quota','recent','starred','trash','activity','settings','apikeys'].includes(page)){
    navTo(page,driveId,folderId);
  }else navTo('files');
}

function setGridSize(sz){
  S.view=sz;
  document.querySelectorAll('.vsz').forEach(b=>b.classList.toggle('active',b.dataset.sz===sz));
  if(_driveId||_curPage==='files')navTo('files',_driveId,_folderId);
}

function switchTab(mode,btn){
  document.querySelectorAll('#authTabs .seg').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  $('userForm').classList.toggle('hidden', mode==='admin');
  $('adminForm').classList.toggle('hidden', mode==='user');
}

function toggleSbMenu(){
  $('sbMenu').classList.toggle('hidden');
  setTimeout(()=>document.addEventListener('click',()=>$('sbMenu')?.classList.add('hidden'),{once:true}),0);
}