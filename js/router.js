var _curPage = 'files';
var _driveId = null;
var _folderId = null;

function navTo(page, driveId, folderId) {
  if(typeof updateUploadBtnVisibility === "function") updateUploadBtnVisibility();
  driveId = driveId || null; folderId = folderId || null;
  _curPage = page; _driveId = driveId; _folderId = folderId;

  // Update URL hash
  var hash = '#/' + page;
  if (driveId) hash += '/' + driveId;
  if (folderId) hash += '/' + folderId;
  if (window.location.hash !== hash) history.replaceState(null, '', hash);

  document.querySelectorAll('.sb-nav-item').forEach(function(el) {
    el.classList.toggle('active', el.dataset.page === page);
  });
  var explorer = (page === 'files' && driveId);
  ['uploadBtn','newFolderBtn','syncBtn'].forEach(function(id) {
    var el = $(id); if(el) el.classList.toggle('hidden', !explorer);
  });
  updateBreadcrumb(page, driveId, folderId);

  var pc = $('pageContent');
  if(pc) pc.innerHTML = '<div class="loading-full"><i class="fas fa-spinner fa-spin"></i></div>';

  if      (page==='files')    renderFilesPage(driveId, folderId);
  else if (page==='quota')    renderQuotaPage();
  else if (page==='recent')   renderRecentPage();
  else if (page==='activity') renderActivityPage();
  else if (page==='settings') renderSettingsPage();
  else if (page==='apikeys')  renderApiKeysPage();
  else if (page==='starred')  renderSimplePage('Starred','fa-star','#ff9f0a','No starred files yet.');
  else if (page==='trash')    renderSimplePage('Recycle Bin','fa-trash-can','var(--danger)','Recycle bin is empty.');
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

function setGridSize(sz) {
  S.view = sz;
  document.querySelectorAll('.vsz').forEach(function(b){ b.classList.toggle('active', b.dataset.sz===sz); });
  if(_driveId||_curPage==='files') renderFilesPage(_driveId, _folderId);
}

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