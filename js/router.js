var _curPage = 'files';
var _driveId = null;
var _folderId = null;

function navTo(page, driveId, folderId) {
  if(typeof closeMobileSidebar === "function") closeMobileSidebar();
  if(S.selectedFiles) S.selectedFiles.clear();
  if(typeof updateSelectionUI === "function") updateSelectionUI();
  if(typeof updateUploadBtnVisibility === "function") updateUploadBtnVisibility();
  driveId = driveId || null; folderId = folderId || null;
  _curPage = page; _driveId = driveId; _folderId = folderId;

  // Update URL hash (create browser history record so back button navigates folders!)
  var hash = '#/' + page;
  if (driveId) hash += '/' + driveId;
  if (folderId) hash += '/' + folderId;
  if (window.location.hash !== hash) {
    window.location.hash = hash;
  }

  // Auto-relock any 'once' unlocked folders if user navigated away from them
  if (S.unlockedFolders && (S.unlockedFolders instanceof Map)) {
    try {
      Array.from(S.unlockedFolders.entries()).forEach(function(entry) {
        var fId = entry[0], exp = entry[1];
        if (exp === 'once' && folderId !== fId) {
          S.unlockedFolders.delete(fId);
        } else if (typeof exp === 'number' && Date.now() >= exp) {
          S.unlockedFolders.delete(fId);
          try { sessionStorage.removeItem('td_unlocked_' + fId); } catch(e){}
        }
      });
    } catch(e){}
  }

  document.querySelectorAll('.sb-nav-item').forEach(function(el) {
    el.classList.toggle('active', el.dataset.page === page);
  });
  var explorer = (page === 'files' && driveId);
  ['uploadBtn','folderUpBtn','newFolderBtn','syncBtn'].forEach(function(id) {
    var el = $(id); if(el) el.classList.toggle('hidden', !explorer);
  });
  var fab = $('mobileFabWrap');
  if (fab) {
    var isOpenTarget = (driveId && S.db && S.db.openDriveId && driveId === S.db.openDriveId);
    var canUpload = !!S.ses.token || isOpenTarget;
    var showFab = canUpload && !!driveId && page === 'files';
    fab.classList.toggle('hidden', !showFab);
  }
  updateBreadcrumb(page, driveId, folderId);

  var pc = $('pageContent');
  if(pc) pc.innerHTML = '<div class="loading-full"><i class="fas fa-spinner fa-spin"></i></div>';

  if      (page==='files')    renderFilesPage(driveId, folderId);
  else if (page==='quota')    { if(S.ses.role==='admin'||S.ses.role==='user') renderQuotaPage(); else navTo('files'); }
  else if (page==='recent')   renderRecentPage();
  else if (page==='activity') { if(S.ses.role==='admin') renderActivityPage(); else navTo('files'); }
  else if (page==='settings') { if(S.ses.role==='admin') renderSettingsPage(); else navTo('files'); }
  else if (page==='apikeys')  { if(S.ses.role==='admin') renderApiKeysPage(); else navTo('files'); }
  else if (page==='starred')  renderStarredPage();
  else if (page==='trash')    renderTrashPage();
  else renderFilesPage(null, null);
}

function updateBreadcrumb(page, driveId, folderId) {
  var el = $('breadcrumb'); if(!el) return;
  var labels = {files:'All Files',quota:'Quota Tracker',recent:'Recent',starred:'Starred',trash:'Recycle Bin',activity:'Activity Log',settings:'Setting',apikeys:'API Keys'};
  var parts = [];
  if(driveId) {
    var drive = (S.db&&S.db.drives||[]).find(function(d){return d.id===driveId;});
    parts.push('<span class="bc-item" onclick="navTo(\'files\')" style="color:var(--text2)">All Files</span>');
    parts.push('<i class="fas fa-chevron-right bc-sep"></i>');
    parts.push('<span class="bc-item'+(folderId?'':' active')+'" onclick="navTo(\'files\',\''+esc(driveId)+'\')" style="color:'+(drive?drive.color:'var(--primary)')+'">'+esc(drive?drive.name:'Drive')+'</span>');
    if(folderId) {
      getFolderChain(folderId).forEach(function(f) {
        parts.push('<i class="fas fa-chevron-right bc-sep"></i>');
        parts.push('<span class="bc-item'+(f.id===folderId?' active':'')+'" onclick="navTo(\'files\',\''+esc(driveId)+'\',\''+esc(f.id)+'\')">'+esc(f.name)+'</span>');
      });
    }
  } else { parts.push('<span class="bc-item active">'+(labels[page]||page)+'</span>'); }
  el.innerHTML = parts.join('');
}

function getFolderChain(folderId) {
  var chain = [], cur = (S.db&&S.db.folders||[]).find(function(f){return f.id===folderId;});
  while(cur) { chain.unshift(cur); var pid = cur.parentId; cur = pid?(S.db&&S.db.folders||[]).find(function(f){return f.id===pid;}):null; }
  return chain;
}

function handleInitialHash() {
  var h = window.location.hash.replace('#/','').split('/').filter(Boolean);
  if(!h.length||h[0]==='') { navTo('files'); return; }
  var valid = ['files','quota','recent','starred','trash','activity','settings','apikeys'];
  var page = h[0], driveId = h[1]||null, folderId = h[2]||null;
  navTo(valid.indexOf(page)>=0?page:'files', driveId, folderId);
}

function setLayoutMode(isList) {
  S.listMode = !!isList;
  var btnGrid = $('btnGridView');
  var btnList = $('btnListView');
  if(btnGrid) btnGrid.classList.toggle('active', !S.listMode);
  if(btnList) btnList.classList.toggle('active', !!S.listMode);
  if(_driveId||_curPage==='files') renderFilesPage(_driveId, _folderId);
}
function setGridSize(sz) { setLayoutMode(sz === 'list'); }

function switchTab(mode, btn) {
  btn.parentElement.querySelectorAll('.seg').forEach(function(b){ b.classList.remove('active'); });
  btn.classList.add('active');
  var uf=$('userForm'), af=$('adminForm');
  if(uf) uf.classList.toggle('hidden', mode==='admin');
  if(af) af.classList.toggle('hidden', mode==='user');
}

function toggleSbMenu() {
  var m=$('sbMenu'); if(!m) return;
  m.classList.toggle('hidden');
  setTimeout(function(){ document.addEventListener('click', function fn(){ m.classList.add('hidden'); document.removeEventListener('click',fn); }); }, 0);
}

function renderSimplePage(title, icon, color, msg) {
  var pc=$('pageContent'); if(!pc) return;
  pc.innerHTML = '<div class="inner-page"><div class="page-hd"><h2>'+title+'</h2></div><div class="empty-state" style="min-height:300px"><div class="empty-icon"><i class="fas '+icon+'" style="color:'+color+'"></i></div><h3>'+msg+'</h3><p>Coming soon</p></div></div>';
}
window.addEventListener('hashchange', function() {
  handleInitialHash();
});