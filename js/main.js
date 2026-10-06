// TeleDrive — Init & Events
async function init(){
  loadSes();
  // Auto-init DB if not setup
  if(!S.ses.token){
    // Try to load DB anonymously to check if setup
    S.db=await apiFetchDB();
    if(!S.db){
      // First time — init with admin123
      await apiInit();
      S.db=await apiFetchDB();
    }
  }else{
    S.db=await apiFetchDB();
    if(!S.db){clearSes();}
  }
  syncAdminUI();
  renderTM();
  wireEvents();
  handleHash();
}

function wireEvents(){
  // Hash change
  window.addEventListener('hashchange',handleHash);

  // Search
  const gs=$('globalSearch');
  if(gs){
    gs.addEventListener('input',()=>{
      if(S.driveId)renderExplorer();
      else renderHome();
    });
    gs.addEventListener('keydown',e=>{if(e.key==='Escape'){gs.value='';if(S.driveId)renderExplorer();else renderHome();}});
  }

  // Upload button
  $('uploadBtn')?.addEventListener('click',()=>$('fileInput')?.click());
  $('fileInput')?.addEventListener('change',e=>{if(e.target.files?.length)uploadFiles(e.target.files);});

  // Upload cancel
  $('upCancelBtn')?.addEventListener('click',()=>{S.cancelUpload=true;S._xhr?.abort();toast('Cancelling…','warning');});

  // Transfer panel toggle
  $('tmBtn')?.addEventListener('click',()=>{
    const panel=$('tmPanel');if(!panel)return;
    panel.classList.toggle('open');renderTM();
  });
  $('tmClear')?.addEventListener('click',()=>{localStorage.removeItem('td:tm');renderTM();});

  // Nav buttons
  $('navBack')?.addEventListener('click',navBack);
  $('navFwd')?.addEventListener('click',navFwd);
  $('navUp')?.addEventListener('click',navUp);
  $('homeBreadBtn')?.addEventListener('click',goHome);

  // Filter tabs
  document.querySelectorAll('[data-filter]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.querySelectorAll('[data-filter]').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      S.filter=btn.dataset.filter;S.filterExt='';
      if(S.driveId)renderExplorer();
    });
  });

  // Ext filter
  $('extInput')?.addEventListener('keydown',e=>{if(e.key==='Enter'){S.filterExt=e.target.value.trim();S.filter='all';if(S.driveId)renderExplorer();}});

  // View toggle
  $('viewGrid')?.addEventListener('click',()=>{S.view='grid';$('viewGrid').classList.add('active');$('viewList').classList.remove('active');renderExplorer();});
  $('viewList')?.addEventListener('click',()=>{S.view='list';$('viewList').classList.add('active');$('viewGrid').classList.remove('active');renderExplorer();});

  // Sort
  $('sortSelect')?.addEventListener('change',e=>{S.sort=e.target.value;if(S.driveId)renderExplorer();});

  // New folder
  $('newFolderBtn')?.addEventListener('click',showNewFolderDialog);

  // Admin button
  $('adminFab')?.addEventListener('click',showAdminScreen);

  // Logout
  $('logoutBtn')?.addEventListener('click',doLogout);

  // Drag & drop
  const app=document.querySelector('.app-body');
  if(app){
    app.addEventListener('dragover',e=>{e.preventDefault();if(S.driveId)document.querySelector('.ex-content')?.classList.add('drag-over');});
    app.addEventListener('dragleave',()=>document.querySelector('.ex-content')?.classList.remove('drag-over'));
    app.addEventListener('drop',e=>{
      e.preventDefault();document.querySelector('.ex-content')?.classList.remove('drag-over');
      if(S.driveId&&e.dataTransfer.files.length)uploadFiles(e.dataTransfer.files);
      else if(!S.driveId)toast('Open a drive first to upload','warning');
    });
  }

  // Keyboard shortcuts
  document.addEventListener('keydown',e=>{
    if((e.ctrlKey||e.metaKey)&&e.key==='k'){e.preventDefault();$('globalSearch')?.focus();}
    if(e.key==='Escape'){document.querySelectorAll('.media-ov,.ctx-menu').forEach(el=>el.remove());$('globalSearch')&&($('globalSearch').value='');}
  });
}

window.addEventListener('DOMContentLoaded',init);