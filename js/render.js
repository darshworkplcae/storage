// TeleDrive — Page Renderers

// ─── Sidebar storage stats ──────────────────────────────
function renderSidebarProfile(){
  const role=S.ses.role, name=S.ses.username||'Guest';
  $('sbName').textContent=role==='admin'?'Admin':name;
  $('sbRole').textContent=role==='admin'?'Administrator':role==='user'?'User':'Not signed in';
  $('sbAvatar').textContent=(name[0]||'?').toUpperCase();
  $('sbAvatar').style.background=role==='admin'?'var(--primary)':role==='user'?'var(--purple)':'var(--bg5)';
  $('adminQuickBtn').classList.toggle('hidden', role!=='admin');
  $('sbLogout').classList.toggle('hidden', !role);
  // Sync button
  const syncBtn=$('syncBtn');
  if(syncBtn)syncBtn.classList.toggle('hidden',true); // hidden unless in explorer
}

function getDriveUsedBytes(driveId){
  const db = S.db;
  if (!db || !db.files) return 0;
  const activeFiles = db.files.filter(f => f.driveId === driveId && !f.trashed);
  return activeFiles.reduce((sum, f) => sum + (f.size || 0), 0);
}

function renderSidebarStorage(){
  const db=S.db; if(!db)return;
  const drives=db.drives||[], files=(db.files||[]).filter(f => !f.trashed);
  const byType={image:0,video:0,audio:0,doc:0,other:0};
  files.forEach(f=>{const c=ftCfg(f.name,f.mimeType).cat;byType[c]=(byType[c]||0)+(f.size||0);});
  const types=[
    {lbl:'Photo',  col:'#30d158', val:byType.image},
    {lbl:'Video',  col:'#ff9f0a', val:byType.video},
    {lbl:'Document',col:'#4e86f5',val:byType.doc},
    {lbl:'Other',  col:'#8f91a8', val:byType.other},
  ];
  const totalCap=drives.reduce((s,d)=>s+(d.capacity||0),0);
  const totalUsed=files.reduce((s,f)=>s+(f.size||0),0);
  const pct=totalCap?Math.min(100,Math.round(totalUsed/totalCap*100)):0;
  const freeBytes=Math.max(0,totalCap-totalUsed);

  const rows=$('sbStorageRows'); if(rows){
    rows.innerHTML=types.map(t=>`
      <div class="sb-storage-row">
        <span class="sb-storage-lbl"><span class="sb-storage-dot" style="background:${t.col}"></span>${t.lbl}</span>
        <span class="sb-storage-val">${fmt(t.val)}</span>
      </div>`).join('');
  }
  const fill=$('sbQuotaFill'); if(fill)fill.style.width=pct+'%';
  const txt=$('sbQuotaTxt'); if(txt)txt.innerHTML=`<span>${fmt(totalUsed)} used</span><span>${fmt(totalCap)||'—'}</span>`;
}

// ─── All Files / Explorer ───────────────────────────────
function renderFilesPage(driveId, folderId){
  const pc=$('pageContent'); if(!pc)return;
  const db=S.db||{drives:[],files:[],folders:[]};
  const drives=db.drives||[];
  const sz=S.view||'md';

  // If no driveId: show drive cards (home)
  if(!driveId){
    $('uploadBtn')?.classList.add('hidden');
    $('newFolderBtn')?.classList.add('hidden');
    $('syncBtn')?.classList.add('hidden');
    document.querySelector('.view-size-btns')?.classList.add('hidden');

    const isAdmin=S.ses.role==='admin';
    if(!drives.length){
      pc.innerHTML=`<div class="inner-page"><div class="empty-state" style="min-height:400px">
        <div class="empty-icon"><i class="fas fa-hard-drive"></i></div>
        <h3>No Drives Connected</h3>
        <p>${isAdmin?'Connect a Google Drive account from Settings':'Ask your admin to connect a drive'}</p>
        ${isAdmin?`<button class="btn-primary" onclick="navTo('settings')"><i class="fas fa-plus"></i> Add Drive</button>`:''}
      </div></div>`;
      return;
    }
    const search=($('globalSearch')?.value||'').toLowerCase();
    const allowed=S.ses.allowedDrives==='all'?null:S.ses.allowedDrives;
    const visible=drives.filter(d=>(!allowed||allowed.includes(d.id))&&(!search||d.name?.toLowerCase().includes(search)||d.email?.toLowerCase().includes(search)));

    pc.innerHTML=`<div class="inner-page">
      <div class="page-hd"><h2>All Files</h2><p>Browse your connected Google Drive accounts</p></div>
      <div class="file-grid ${sz}">${visible.map(d=>driveCard(d)).join('')}</div>
    </div>`;
    return;
  }

  // Inside a drive
  $('uploadBtn')?.classList.remove('hidden');
  $('newFolderBtn')?.classList.remove('hidden');
  document.querySelector('.view-size-btns')?.classList.remove('hidden');

  const drive=drives.find(d=>d.id===driveId);
  const search=($('globalSearch')?.value||'').toLowerCase();
  let folders=(db.folders||[]).filter(f=>f.driveId===driveId&&f.parentId===(folderId||null)&&!f.trashed);
  let files=(db.files||[]).filter(f=>f.driveId===driveId&&f.folderId===(folderId||null)&&!f.trashed);
if(S.filter && S.filter!=='all'){
  folders = [];
  files = files.filter(function(f){
    return ftCfg(f.name, f.mimeType).cat === S.filter;
  });
}
  if(search){folders=folders.filter(f=>f.name.toLowerCase().includes(search));files=files.filter(f=>f.name.toLowerCase().includes(search));}

  const sortKey=S.sort||'name';
  const sortFn=(a,b)=>sortKey==='size'?(b.size||0)-(a.size||0):sortKey==='date'?new Date(b.date)-new Date(a.date):(a.name||'').localeCompare(b.name||'');
  folders.sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  files.sort(sortFn);

  const isAdmin=S.ses.role==='admin';
  const total=files.reduce((s,f)=>s+(f.size||0),0);

  if(!folders.length&&!files.length){
    pc.innerHTML=`<div class="explorer-page">
      <div class="ex-toolbar">${toolbarHtml(driveId,folderId)}</div>
      <div class="ex-content">
        <div class="empty-state"><div class="empty-icon"><i class="fas fa-folder-open"></i></div><h3>Empty folder</h3><p>Upload files or create a folder</p></div>
      </div>
      <div class="ex-statusbar"><span>0 items</span><span></span></div>
    </div>`;
    wireToolbar();
    setupDragDrop();
    return;
  }

  const gridView=S.listMode!==true;
  const html=gridView
    ?`<div class="file-grid ${sz}">${folders.map(f=>folderCard(f)).join('')}${files.map(f=>fileCard(f)).join('')}</div>`
    :`<div class="file-list"><div class="fl-hdr"><span>Name</span><span>Size</span><span>Date</span><span></span></div>${folders.map(f=>folderRow(f)).join('')}${files.map(f=>fileRow(f)).join('')}</div>`;

  pc.innerHTML=`<div class="explorer-page">
    <div class="ex-toolbar">${toolbarHtml(driveId,folderId)}</div>
    <div class="ex-content" id="exContent">${html}</div>
    <div class="ex-statusbar"><span>${folders.length+files.length} items${folders.length?', '+folders.length+' folders':''}</span><span>${total?fmt(total):''}</span></div>
  </div>`;
  wireToolbar();
  setupDragDrop();
}

function toolbarHtml(driveId,folderId){
  return `<div class="nav-btns">
    <button class="icon-btn" onclick="history.back()" title="Back"><i class="fas fa-chevron-left"></i></button>
    <button class="icon-btn" onclick="goUp()" title="Up"><i class="fas fa-arrow-up"></i></button>
  </div>
  <div class="filter-tabs">
    <button class="ftab ${(!S.filter||S.filter==='all')?'active':''}" data-filter="all">All</button>
    <button class="ftab ${S.filter==='image'?'active':''}" data-filter="image" title="Photos"><i class="fas fa-image"></i> Photos</button>
    <button class="ftab ${S.filter==='video'?'active':''}" data-filter="video" title="Videos"><i class="fas fa-film"></i> Videos</button>
    <button class="ftab ${S.filter==='audio'?'active':''}" data-filter="audio" title="Audio"><i class="fas fa-music"></i> Audio</button>
    <button class="ftab ${S.filter==='doc'?'active':''}" data-filter="doc" title="Documents"><i class="fas fa-file-lines"></i> Docs</button>
  </div>
  <div style="display:flex;gap:.4rem;margin-left:auto">
    <select class="inp" style="width:auto;font-size:.78rem" id="sortSel">
      <option value="name">Name</option><option value="date">Date</option><option value="size">Size</option>
    </select>
    <button class="icon-btn" id="toggleViewBtn" title="Toggle view"><i class="fas fa-list"></i></button>
  </div>`;
}

function wireToolbar(){
  document.querySelectorAll('[data-filter]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.querySelectorAll('[data-filter]').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      S.filter=btn.dataset.filter;
      if(_driveId)navTo('files',_driveId,_folderId);
    });
  });
  $('sortSel')?.addEventListener('change',e=>{S.sort=e.target.value;navTo('files',_driveId,_folderId);});
  $('toggleViewBtn')?.addEventListener('click',()=>{S.listMode=!S.listMode;navTo('files',_driveId,_folderId);});
}

function setupDragDrop(){
  const ec=$('exContent');if(!ec)return;
  ec.addEventListener('dragover',e=>{e.preventDefault();ec.classList.add('drag-over');});
  ec.addEventListener('dragleave',()=>ec.classList.remove('drag-over'));
  ec.addEventListener('drop',e=>{e.preventDefault();ec.classList.remove('drag-over');if(e.dataTransfer.files.length)uploadFiles(e.dataTransfer.files);});
}

function goUp(){
  if(_folderId){
    const parent=S.db?.folders?.find(f=>f.id===_folderId)?.parentId||null;
    navTo('files',_driveId,parent);
  }else if(_driveId){navTo('files');}
}

// ─── Drive card ────────────────────────────────────────
function driveCard(d){
  const dynamicUsed = getDriveUsedBytes(d.id);
  const used = dynamicUsed > 0 ? dynamicUsed : (d.usedBytes || 0);
  const cap = d.capacity || 0;
  const pct = cap ? Math.min(100, Math.round(used / cap * 100)) : 0;
  const files = (S.db?.files || []).filter(f => f.driveId === d.id && !f.trashed).length;
  const isAdmin = S.ses.role === 'admin';
  return `<div class="fg-card drive-card-item" onclick="navTo('files','${esc(d.id)}')" title="${esc(d.email)}">
    <div class="fg-icon xl" style="color:${esc(d.color)}"><i class="fab fa-google-drive"></i></div>
    <div class="fg-name" style="font-weight:600;font-size:.95rem">${esc(d.name)}</div>
    <div class="fg-meta">${fmt(used)} / ${cap?fmt(cap):'∞'} · ${pct}%</div>
    <div class="fg-acts">
      ${isAdmin?`<button class="icon-btn xs" onclick="event.stopPropagation();promptRenameDrive('${esc(d.id)}','${esc(d.name).replace(/'/g,"\\'")}')" title="Rename"><i class="fas fa-pen"></i></button>`:''}
      ${isAdmin?`<button class="icon-btn xs danger" onclick="event.stopPropagation();disconnectDrive('${esc(d.id)}')" title="Disconnect"><i class="fas fa-unlink"></i></button>`:''}
      <button class="icon-btn xs" onclick="event.stopPropagation();navTo('files','${esc(d.id)}')" title="Open"><i class="fas fa-folder-open"></i></button>
    </div>
  </div>`;
}

// ─── Folder / File cards ───────────────────────────────
function folderCard(f){
  const isSelected = S.selectedFiles && S.selectedFiles.has(f.id);
  return `<div class="fg-card ${isSelected ? 'is-selected' : ''}" data-item-id="${esc(f.id)}" ondblclick="navTo('files','${esc(f.driveId)}','${esc(f.id)}')" onclick="handleCardClick('${esc(f.id)}', event)">
    <div class="card-select-btn ${isSelected ? 'selected' : ''}" onclick="event.stopPropagation(); toggleFileSelect('${esc(f.id)}')" title="Select folder">
      <i class="fas fa-check"></i>
    </div>
    <div class="fg-icon xl"><i class="fas fa-folder" style="color:#ff9f0a"></i></div>
    <div class="fg-name">${esc(f.name)}</div>
    <div class="fg-acts">
      <button class="icon-btn xs danger" onclick="event.stopPropagation();confirmDeleteFolder('${esc(f.id)}','${esc(f.name)}')" title="Delete folder"><i class="fas fa-trash-alt"></i></button>
    </div>
  </div>`;
}
function fileCard(f){
  const cfg=ftCfg(f.name,f.mimeType);
  const isMedia=['image','video','audio'].includes(cfg.cat);
  const isImage=cfg.cat==='image';
  const isVideo=cfg.cat==='video';
  const driveId=f.driveId||_driveId||(S.db&&S.db.drives&&S.db.drives[0]?S.db.drives[0].id:'');
  const previewUrl=getFileDownloadUrl(f.googleFileId, driveId, true);
  const isSelected = S.selectedFiles && S.selectedFiles.has(f.id);

  return `<div class="fg-card ${isImage?'is-image':isVideo?'is-video':''} ${isSelected ? 'is-selected' : ''}" data-item-id="${esc(f.id)}" ondblclick="${isMedia?`openMedia('${esc(f.id)}')`:`downloadFile('${esc(f.id)}')`}" onclick="handleCardClick('${esc(f.id)}', event)">
    <div class="card-select-btn ${isSelected ? 'selected' : ''}" onclick="event.stopPropagation(); toggleFileSelect('${esc(f.id)}')" title="Select file">
      <i class="fas fa-check"></i>
    </div>
    ${isImage ? `
      <div class="fg-thumb-wrap">
        <img class="fg-thumb" src="${previewUrl}" alt="${esc(f.name)}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\'fg-icon\' style=\'color:${cfg.col}\'><i class=\'fas ${cfg.icon}\'></i></div>'">
        <div class="thumb-hover-overlay"><i class="fas fa-eye"></i></div>
      </div>
    ` : isVideo ? `
      <div class="fg-thumb-wrap video-thumb-wrap">
        <video class="fg-thumb-vid" src="${previewUrl}#t=0.5" preload="metadata" muted playsinline></video>
        <div class="video-play-badge"><i class="fas fa-play"></i></div>
      </div>
    ` : `
      <div class="fg-icon" style="color:${cfg.col}"><i class="fas ${cfg.icon}"></i></div>
    `}
    <div class="fg-name" title="${esc(f.name)}">${esc(f.name)}</div>
    <div class="fg-meta">${fmt(f.size||0)}</div>
    <div class="fg-acts">
      <button class="icon-btn xs star-btn ${f.starred?'starred':''}" data-star-id="${esc(f.id)}" onclick="event.stopPropagation();toggleStar('${esc(f.id)}')" title="${f.starred?'Unstar':'Star'}"><i class="fas fa-star" style="${f.starred?'color:#ffcc00':''}"></i></button>
      ${isMedia?`<button class="icon-btn xs" onclick="event.stopPropagation();openMedia('${esc(f.id)}')"><i class="fas fa-eye"></i></button>`:''}
      <button class="icon-btn xs" onclick="event.stopPropagation();downloadFile('${esc(f.id)}')"><i class="fas fa-download"></i></button>
      <button class="icon-btn xs danger" onclick="event.stopPropagation();confirmDeleteFile('${esc(f.id)}','${esc(f.name)}')" title="Delete"><i class="fas fa-trash-alt"></i></button>
    </div>
  </div>`;
}
function folderRow(f){
  const isSelected = S.selectedFiles && S.selectedFiles.has(f.id);
  return `<div class="fl-row ${isSelected ? 'is-selected' : ''}" data-item-id="${esc(f.id)}" ondblclick="navTo('files','${esc(f.driveId)}','${esc(f.id)}')">
    <span style="display:flex;align-items:center;gap:8px">
      <input type="checkbox" class="row-select-check" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation(); toggleFileSelect('${esc(f.id)}')">
      <i class="fas fa-folder" style="color:#ff9f0a;margin-right:.4rem"></i>${esc(f.name)}
    </span>
    <span>—</span><span>${fmtDate(f.date)}</span>
    <span><button class="icon-btn xs danger" onclick="confirmDeleteFolder('${esc(f.id)}','${esc(f.name)}')" title="Delete"><i class="fas fa-trash-alt"></i></button></span>
  </div>`;
}
function fileRow(f){
  const cfg = ftCfg(f.name, f.mimeType);
  const isMedia = ['image','video','audio'].includes(cfg.cat);
  const isSelected = S.selectedFiles && S.selectedFiles.has(f.id);
  return `<div class="fl-row ${isSelected ? 'is-selected' : ''}" data-item-id="${esc(f.id)}" ondblclick="${isMedia?`openMedia('${esc(f.id)}')`:`downloadFile('${esc(f.id)}')`}">
    <span style="display:flex;align-items:center;gap:8px">
      <input type="checkbox" class="row-select-check" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation(); toggleFileSelect('${esc(f.id)}')">
      <i class="fas ${cfg.icon}" style="color:${cfg.col};margin-right:.4rem"></i>${esc(f.name)}
    </span>
    <span>${fmt(f.size||0)}</span><span>${fmtDate(f.date)}</span>
    <span style="display:flex;gap:.2rem">
      <button class="icon-btn xs star-btn ${f.starred?'starred':''}" data-star-id="${esc(f.id)}" onclick="event.stopPropagation();toggleStar('${esc(f.id)}')" title="${f.starred?'Unstar':'Star'}"><i class="fas fa-star" style="${f.starred?'color:#ffcc00':''}"></i></button>
      ${isMedia?`<button class="icon-btn xs" onclick="event.stopPropagation();openMedia('${esc(f.id)}')"><i class="fas fa-eye"></i></button>`:''}
      <button class="icon-btn xs" onclick="event.stopPropagation();downloadFile('${esc(f.id)}')"><i class="fas fa-download"></i></button>
      <button class="icon-btn xs danger" onclick="event.stopPropagation();confirmDeleteFile('${esc(f.id)}','${esc(f.name)}')" title="Delete"><i class="fas fa-trash-alt"></i></button>
    </span>
  </div>`;
}

function selectCard(el){
  document.querySelectorAll('.fg-card.selected').forEach(e=>e.classList.remove('selected'));
  if(el) el.classList.add('selected');
}

function handleCardClick(id, event) {
  if (event.ctrlKey || event.metaKey || event.shiftKey) {
    toggleFileSelect(id);
    return;
  }
  if (S.selectedFiles && S.selectedFiles.size > 0) {
    toggleFileSelect(id);
    return;
  }
  const el = document.querySelector(`[data-item-id="${id}"]`);
  if (el) selectCard(el);
}

function toggleFileSelect(id) {
  if (!S.selectedFiles) S.selectedFiles = new Set();
  if (S.selectedFiles.has(id)) S.selectedFiles.delete(id);
  else S.selectedFiles.add(id);
  updateSelectionUI();
}

function selectAllCurrentFiles() {
  if (!S.selectedFiles) S.selectedFiles = new Set();
  const db = S.db || {};
  const currentFolders = (db.folders || []).filter(f => f.driveId === _driveId && f.parentId === (_folderId || null) && !f.trashed);
  const currentFiles = (db.files || []).filter(f => f.driveId === _driveId && f.folderId === (_folderId || null) && !f.trashed);
  currentFolders.forEach(f => S.selectedFiles.add(f.id));
  currentFiles.forEach(f => S.selectedFiles.add(f.id));
  updateSelectionUI();
}

function clearFileSelection() {
  if (S.selectedFiles) S.selectedFiles.clear();
  updateSelectionUI();
}

function updateSelectionUI() {
  const count = S.selectedFiles ? S.selectedFiles.size : 0;
  const bar = $('multiSelectBar');
  const countEl = $('msCount');
  if (countEl) countEl.textContent = count;
  if (bar) bar.classList.toggle('hidden', count === 0);

  document.querySelectorAll('.fg-card, .fl-row').forEach(el => {
    const id = el.getAttribute('data-item-id');
    const isSelected = id && S.selectedFiles && S.selectedFiles.has(id);
    el.classList.toggle('is-selected', !!isSelected);
    const btn = el.querySelector('.card-select-btn');
    if (btn) btn.classList.toggle('selected', !!isSelected);
    const chk = el.querySelector('.row-select-check');
    if (chk) chk.checked = !!isSelected;
  });
}

async function deleteSelectedFiles() {
  if (!S.selectedFiles || S.selectedFiles.size === 0) return;
  const count = S.selectedFiles.size;
  if (!confirm(`Move ${count} selected item(s) to Recycle Bin?`)) return;

  const ids = Array.from(S.selectedFiles);
  toast(`Moving ${count} item(s) to Recycle Bin…`, 'info');
  const res = await apiBatchTrash(ids);
  if (res && res.ok) {
    toast(`${res.count || count} item(s) moved to Recycle Bin`, 'success');
    clearFileSelection();
    S.db = await apiFetchDB();
    renderSidebarStorage();
    renderFilesPage(_driveId, _folderId);
  } else {
    toast(res ? (res.error || 'Failed to move items to trash') : 'Network error', 'error');
  }
}

// ─── Quota Tracker ─────────────────────────────────────
async function renderQuotaPage(){
  const pc=$('pageContent');if(!pc)return;
  const drives=S.db?.drives||[];
  pc.innerHTML=`<div class="inner-page">
    <div class="page-hd"><h2>Quota Tracker</h2><p>Live storage usage across all connected drives</p></div>
    <div class="quota-grid" id="quotaGrid">
      ${drives.length?drives.map(d=>{const dynamicUsed=getDriveUsedBytes(d.id);const used=dynamicUsed>0?dynamicUsed:(d.usedBytes||0);const cap=d.capacity||0,pct=cap?Math.min(100,Math.round(used/cap*100)):0;const free=Math.max(0,cap-used);return`<div class="quota-card">
        <div class="quota-card-top">
          <div class="qc-avatar" style="background:${d.color}22;color:${d.color}">${(d.name||'?')[0].toUpperCase()}</div>
          <div><div class="qc-name">${esc(d.name)}</div><div class="qc-email">${esc(d.email)}</div></div>
        </div>
        <div class="qc-usage">${pct}%</div>
        <div class="qc-bar"><div class="qc-fill" style="width:${pct}%;background:${d.color}"></div></div>
        <div class="qc-meta"><span>${fmt(used)} used</span><span>${fmt(free)} free</span><span>${fmt(cap)} total</span></div>
      </div>`}).join(''):`<div class="empty-state"><div class="empty-icon"><i class="fas fa-chart-pie"></i></div><h3>No drives connected</h3></div>`}
    </div>
  </div>`;
  // Refresh live quota
  if(S.ses.role==='admin'&&drives.length){
    const r=await apiDriveQuota().catch(()=>null);
    if(r?.drives){r.drives.forEach(qd=>{const d=S.db?.drives?.find(x=>x.id===qd.id);if(d&&!qd.error){d.capacity=qd.capacity;d.usedBytes=qd.usedBytes;}});renderSidebarStorage();}
  }
}

// ─── Recent Page ───────────────────────────────────────
function renderRecentPage(){
  const pc=$('pageContent');if(!pc)return;
  const files=[...(S.db?.files||[])].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,50);
  pc.innerHTML=`<div class="inner-page">
    <div class="page-hd"><h2>Recent</h2><p>Recently uploaded files</p></div>
    ${files.length?`<div class="file-grid ${S.view||'md'}">${files.map(f=>fileCard(f)).join('')}</div>`:`<div class="empty-state"><div class="empty-icon"><i class="fas fa-clock-rotate-left"></i></div><h3>No files yet</h3></div>`}
  </div>`;
}

// ─── Activity Log ──────────────────────────────────────
function renderActivityPage(){
  const pc=$('pageContent');if(!pc)return;
  const log=S.db?.activityLog||[];
  const icons={upload:'fa-upload',download:'fa-download',delete:'fa-trash-alt',view:'fa-eye'};
  const colors={upload:['rgba(46,209,88,.12)','var(--success)'],download:['rgba(78,134,245,.12)','var(--primary)'],delete:['rgba(255,69,58,.12)','var(--danger)'],view:['rgba(143,145,168,.1)','var(--text2)']};
  pc.innerHTML=`<div class="inner-page">
    <div class="page-hd"><h2>Activity Log</h2><p>Recent file operations across all drives</p></div>
    <div class="card">
      <div class="activity-list">
        ${log.length?log.slice(0,100).map(l=>{const c=colors[l.type]||colors.view;return`<div class="act-row">
          <div class="act-ico" style="background:${c[0]};color:${c[1]}"><i class="fas ${icons[l.type]||'fa-circle'}"></i></div>
          <div class="act-info"><div class="act-name">${esc(l.name||'Unknown')}</div><div class="act-meta">${l.type} · ${fmt(l.size||0)}</div></div>
          <div class="act-time">${fmtDate(l.ts)}</div>
        </div>`}).join(''):`<div class="empty-state" style="min-height:200px"><div class="empty-icon"><i class="fas fa-list-ul"></i></div><h3>No activity yet</h3></div>`}
      </div>
    </div>
  </div>`;
}

// ─── Generic empty page ────────────────────────────────
function renderPage(title,icon,color,msg){
  $('pageContent').innerHTML=`<div class="inner-page">
    <div class="page-hd"><h2>${title}</h2></div>
    <div class="empty-state" style="min-height:300px">
      <div class="empty-icon"><i class="fas ${icon}" style="color:${color}"></i></div>
      <h3>${msg}</h3>
      <p>This feature is coming soon</p>
    </div>
  </div>`;
}

// ─── TM Panel ─────────────────────────────────────────
function renderTM(){
  const badge=$('tmBadge'),list=$('tmList');
  const transfers=tmLoad();
  const active=transfers.filter(t=>t.status==='uploading');
  if(badge){badge.textContent=active.length||'';badge.classList.toggle('show',active.length>0);}
  if(!list)return;
  if(!transfers.length){list.innerHTML=`<div class="tm-empty"><i class="fas fa-inbox"></i><span>No active transfers</span></div>`;return;}
  list.innerHTML=transfers.map(t=>{
    const isPaused = t.status === 'uploading' && (typeof _cancelSignal !== 'undefined' && _cancelSignal && _cancelSignal.paused);
    const col=t.status==='done'?'var(--success)':t.status==='failed'?'var(--danger)':isPaused?'#ff9f0a':'var(--primary)';
    const ico=t.status==='done'?'fa-check-circle':t.status==='failed'?'fa-times-circle':isPaused?'fa-circle-pause':'fa-spinner fa-spin';
    const uMB=(t.uploaded/1048576||0).toFixed(1),tMB=(t.size/1048576||0).toFixed(1),spd=t.speed?` · ${fmtSpeed(t.speed)}`:'';
    const sub=t.status==='uploading'?(isPaused?`Paused · ${uMB}/${tMB} MB`:`${uMB}/${tMB} MB${spd}`):t.status==='done'?`Done · ${fmt(t.size||0)}`:'Failed';
    return `<div class="tm-item">
      <div class="tm-ico" style="color:${col}"><i class="fas ${ico}"></i></div>
      <div class="tm-info"><div class="tm-name" title="${esc(t.name)}">${esc(t.name)}</div><div class="tm-sub">${sub}</div>
        ${t.status==='uploading'?`<div class="tm-bar"><div class="tm-fill" style="width:${t.pct||0}%"></div></div>`:''}
      </div>
      ${t.status==='uploading'?`
        <div style="display:flex;gap:4px">
          <button class="icon-btn xs" onclick="toggleUploadPause()" title="Pause / Resume"><i class="fas ${isPaused?'fa-play':'fa-pause'}"></i></button>
          <button class="icon-btn xs danger" onclick="_cancelSignal.cancelled=true;if(_cancelSignal.resumeResolve)_cancelSignal.resumeResolve();S.cancelUpload=true;" title="Cancel"><i class="fas fa-times"></i></button>
        </div>
      `:''}
    </div>`;
  }).join('');
}

function renderStarredPage() {
  const pc = $('pageContent'); if(!pc) return;
  const starred = (S.db&&S.db.files||[]).filter(f => !!f.starred && !f.trashed);
  pc.innerHTML = `<div class="inner-page">
    <div class="page-hd"><h2><i class="fas fa-star" style="color:#ffcc00"></i> Starred Files</h2><p>Quick access to your favorite files</p></div>
    ${starred.length ? `<div class="file-grid md">${starred.map(f => fileCard(f)).join('')}</div>` : `<div class="empty-state"><div class="empty-icon"><i class="fas fa-star" style="color:#ffcc00"></i></div><h3>No starred files</h3><p>Click the star icon on any file to bookmark it here.</p></div>`}
  </div>`;
}

function renderTrashPage() {
  const pc = $('pageContent'); if(!pc) return;
  const allTrashed = (S.db&&S.db.files||[]).filter(f => !!f.trashed);
  const isAdmin = (S.ses && S.ses.role === 'admin');
  const flt = S.trashFilter || 'all';
  const trashed = flt === 'pending' ? allTrashed.filter(f => !!f.restoreRequested) : allTrashed;
  const pendingCount = allTrashed.filter(f => !!f.restoreRequested).length;
  const selCount = S.selectedTrash ? S.selectedTrash.size : 0;

  pc.innerHTML = `<div class="inner-page">
    <div class="page-hd" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem">
      <div>
        <h2><i class="fas fa-trash-can" style="color:var(--danger)"></i> Recycle Bin</h2>
        <p>${isAdmin ? 'Manage deleted files. Approve restore requests, batch delete, or empty bin.' : 'Deleted files can be restored upon admin approval.'}</p>
      </div>
      <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">
        ${isAdmin && allTrashed.length ? `
          <button class="btn-ghost sm danger" onclick="adminEmptyTrash()" title="Permanently delete all trash"><i class="fas fa-trash-can"></i> Empty Bin</button>
        ` : ''}
      </div>
    </div>

    <!-- Filter and Batch Action Bar -->
    <div class="trash-toolbar" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.7rem;margin-top:.7rem;padding:.7rem 1rem;background:var(--bg2);border:1px solid var(--border);border-radius:12px">
      <div class="filter-tabs" style="margin:0">
        <button class="ftab ${flt==='all'?'active':''}" onclick="setTrashFilter('all')">All (${allTrashed.length})</button>
        <button class="ftab ${flt==='pending'?'active':''}" onclick="setTrashFilter('pending')"><i class="fas fa-clock" style="color:#ffcc00"></i> Pending Request (${pendingCount})</button>
      </div>
      <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">
        ${allTrashed.length ? `
          <button class="btn-ghost sm" onclick="selectAllTrash()"><i class="fas fa-check-double"></i> Select All</button>
          ${selCount > 0 ? `<button class="btn-ghost sm" onclick="clearTrashSelection()"><i class="fas fa-times"></i> Clear (${selCount})</button>` : ''}
        ` : ''}
        ${selCount > 0 ? (isAdmin ? `
          <button class="btn-primary sm" onclick="batchAdminApproveRestore()"><i class="fas fa-rotate-left"></i> Restore Selected (${selCount})</button>
          <button class="btn-danger sm" onclick="batchAdminPermanentDelete()"><i class="fas fa-trash"></i> Delete Selected (${selCount})</button>
        ` : `
          <button class="btn-primary sm" onclick="batchUserRequestRestore()"><i class="fas fa-rotate-left"></i> Request Restore (${selCount})</button>
        `) : ''}
      </div>
    </div>

    ${trashed.length ? `
      <div class="trash-list" style="display:flex;flex-direction:column;gap:.7rem;margin-top:1rem">
        ${trashed.map(f => {
          const cfg = ftCfg(f.name, f.mimeType);
          const isReq = !!f.restoreRequested;
          const isSelected = S.selectedTrash && S.selectedTrash.has(f.id);
          return `
            <div class="trash-item ${isSelected ? 'is-selected' : ''}" style="display:flex;align-items:center;gap:.9rem;padding:.85rem 1.1rem;background:${isSelected ? 'rgba(78,134,245,0.08)' : 'var(--bg2)'};border:1px solid ${isSelected ? 'var(--primary)' : 'var(--border)'};border-radius:12px;transition:.15s">
              <input type="checkbox" class="row-select-check" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation(); toggleTrashSelect('${esc(f.id)}')">
              <div style="font-size:1.5rem;color:${cfg.col};width:34px;text-align:center"><i class="fas ${cfg.icon}"></i></div>
              <div style="flex:1;min-width:0">
                <div style="font-weight:600;font-size:.92rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(f.name)}</div>
                <div style="font-size:.76rem;color:var(--text3);margin-top:2px">
                  ${fmt(f.size||0)} · Deleted ${fmtDate(f.trashedAt)} by ${esc(f.trashedBy||'user')}
                  ${isReq ? `<span class="badge-pending" style="margin-left:8px;background:rgba(255,204,0,0.18);color:#ffcc00;padding:2px 8px;border-radius:6px;font-weight:600;font-size:.72rem"><i class="fas fa-clock"></i> Restore Requested</span>` : ''}
                </div>
              </div>
              <div style="display:flex;gap:.5rem">
                ${isAdmin ? `
                  <button class="btn-primary sm" onclick="adminApproveRestore('${esc(f.id)}')"><i class="fas fa-rotate-left"></i> Restore</button>
                  <button class="btn-ghost sm danger" onclick="adminPermanentDelete('${esc(f.id)}','${esc(f.name)}')"><i class="fas fa-trash"></i> Delete Permanently</button>
                ` : isReq ? `
                  <button class="btn-ghost sm" disabled style="opacity:.6"><i class="fas fa-hourglass-half"></i> Pending Admin</button>
                ` : `
                  <button class="btn-primary sm" onclick="requestRestoreFile('${esc(f.id)}')"><i class="fas fa-rotate-left"></i> Request Restore</button>
                `}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    ` : `
      <div class="empty-state" style="margin-top:2rem">
        <div class="empty-icon"><i class="fas fa-trash-can" style="color:var(--text3)"></i></div>
        <h3>Recycle Bin is empty</h3>
        <p>${flt==='pending' ? 'No pending restore requests.' : 'No deleted files.'}</p>
      </div>
    `}
  </div>`;
}

function setTrashFilter(flt){
  S.trashFilter = flt;
  renderTrashPage();
}

function toggleTrashSelect(id){
  if(!S.selectedTrash) S.selectedTrash = new Set();
  if(S.selectedTrash.has(id)) S.selectedTrash.delete(id);
  else S.selectedTrash.add(id);
  renderTrashPage();
}

function selectAllTrash(){
  if(!S.selectedTrash) S.selectedTrash = new Set();
  const allTrashed = (S.db&&S.db.files||[]).filter(f => !!f.trashed);
  const flt = S.trashFilter || 'all';
  const trashed = flt === 'pending' ? allTrashed.filter(f => !!f.restoreRequested) : allTrashed;
  trashed.forEach(f => S.selectedTrash.add(f.id));
  renderTrashPage();
}

function clearTrashSelection(){
  if(S.selectedTrash) S.selectedTrash.clear();
  renderTrashPage();
}

async function batchAdminApproveRestore(){
  if(!S.selectedTrash || S.selectedTrash.size === 0) return;
  const count = S.selectedTrash.size;
  const ids = Array.from(S.selectedTrash);
  toast(`Restoring ${count} file(s)…`, 'info');
  const res = await apiBatchApproveRestore(ids);
  if(res && res.ok){
    toast(`Restored ${res.count || count} file(s)!`, 'success');
    S.selectedTrash.clear();
    S.db = await apiFetchDB();
    renderSidebarStorage();
    renderTrashPage();
  } else {
    toast(res ? (res.error || 'Failed to restore') : 'Network error', 'error');
  }
}

async function batchAdminPermanentDelete(){
  if(!S.selectedTrash || S.selectedTrash.size === 0) return;
  const count = S.selectedTrash.size;
  if(!confirm(`PERMANENTLY DELETE ${count} selected item(s) from Google Drive? This CANNOT be undone.`)) return;
  const ids = Array.from(S.selectedTrash);
  toast(`Permanently deleting ${count} file(s)…`, 'info');
  const res = await apiBatchPermanentDelete(ids);
  if(res && res.ok){
    toast(`Permanently deleted ${res.count || count} file(s)`, 'success');
    S.selectedTrash.clear();
    S.db = await apiFetchDB();
    renderSidebarStorage();
    renderTrashPage();
  } else {
    toast(res ? (res.error || 'Failed to permanently delete') : 'Network error', 'error');
  }
}

async function adminEmptyTrash(){
  const trashed = (S.db&&S.db.files||[]).filter(f => !!f.trashed);
  if(!trashed.length){
    toast('Recycle Bin is already empty', 'info');
    return;
  }
  if(!confirm(`EMPTY RECYCLE BIN?\n\nThis will PERMANENTLY DELETE all ${trashed.length} item(s) from Google Drive forever. This action CANNOT be undone.`)) return;
  toast('Emptying Recycle Bin…', 'info');
  const res = await apiEmptyTrash();
  if(res && res.ok){
    toast(`Recycle Bin emptied (${res.count || trashed.length} items permanently deleted)`, 'success');
    if(S.selectedTrash) S.selectedTrash.clear();
    S.db = await apiFetchDB();
    renderSidebarStorage();
    renderTrashPage();
  } else {
    toast(res ? (res.error || 'Failed to empty recycle bin') : 'Network error', 'error');
  }
}

async function batchUserRequestRestore(){
  if(!S.selectedTrash || S.selectedTrash.size === 0) return;
  const count = S.selectedTrash.size;
  const ids = Array.from(S.selectedTrash);
  toast(`Requesting restore for ${count} file(s)…`, 'info');
  const res = await apiBatchRequestRestore(ids);
  if(res && res.ok){
    toast(`Requested restore for ${res.count || count} file(s)! Admin can now approve.`, 'success');
    S.selectedTrash.clear();
    S.db = await apiFetchDB();
    renderTrashPage();
  } else {
    toast(res ? (res.error || 'Failed to request restore') : 'Network error', 'error');
  }
}

async function toggleStar(fileId) {
  var f = (S.db&&S.db.files||[]).find(x => x.id === fileId);
  if (!f) return;

  // Instant optimistic update: instantly turns star golden yellow in UI
  f.starred = !f.starred;
  var btns = document.querySelectorAll('[data-star-id="' + fileId + '"]');
  btns.forEach(function(btn){
    btn.classList.toggle('starred', f.starred);
    var ico = btn.querySelector('i');
    if (ico) ico.style.color = f.starred ? '#ffcc00' : '';
  });
  toast(f.starred ? 'Starred!' : 'Removed from Starred', 'info');

  if (_curPage === 'starred') renderStarredPage();

  // Sync in background
  var r = await apiToggleStar(fileId);
  if (!r.ok && r.error) {
    // Revert if error
    f.starred = !f.starred;
    btns.forEach(function(btn){
      btn.classList.toggle('starred', f.starred);
      var ico = btn.querySelector('i');
      if (ico) ico.style.color = f.starred ? '#ffcc00' : '';
    });
    toast(r.error, 'error');
  }
}