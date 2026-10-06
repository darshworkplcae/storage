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

function renderSidebarStorage(){
  const db=S.db; if(!db)return;
  const drives=db.drives||[], files=db.files||[];
  const byType={image:0,video:0,audio:0,doc:0,other:0};
  files.forEach(f=>{const c=ftCfg(f.name,f.mimeType).cat;byType[c]=(byType[c]||0)+(f.size||0);});
  const types=[
    {lbl:'Photo',  col:'#30d158', val:byType.image},
    {lbl:'Video',  col:'#ff9f0a', val:byType.video},
    {lbl:'Document',col:'#4e86f5',val:byType.doc},
    {lbl:'Other',  col:'#8f91a8', val:byType.other},
  ];
  const totalCap=drives.reduce((s,d)=>s+(d.capacity||0),0);
  const totalUsed=drives.reduce((s,d)=>s+(d.usedBytes||0),0);
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
  let folders=(db.folders||[]).filter(f=>f.driveId===driveId&&f.parentId===(folderId||null));
  let files=(db.files||[]).filter(f=>f.driveId===driveId&&f.folderId===(folderId||null));
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
    <button class="ftab active" data-filter="all">All</button>
    <button class="ftab" data-filter="image"><i class="fas fa-image"></i></button>
    <button class="ftab" data-filter="video"><i class="fas fa-film"></i></button>
    <button class="ftab" data-filter="audio"><i class="fas fa-music"></i></button>
    <button class="ftab" data-filter="doc"><i class="fas fa-file-lines"></i></button>
    <button class="ftab" data-filter="archive"><i class="fas fa-file-zipper"></i></button>
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
  const used=d.usedBytes||0,cap=d.capacity||0;
  const pct=cap?Math.min(100,Math.round(used/cap*100)):0;
  const files=(S.db?.files||[]).filter(f=>f.driveId===d.id).length;
  const isAdmin=S.ses.role==='admin';
  return `<div class="fg-card" ondblclick="navTo('files','${esc(d.id)}')" onclick="selectCard(this)" title="${esc(d.email)}">
    <div class="fg-icon xl" style="color:${esc(d.color)}"><i class="fab fa-google-drive"></i></div>
    <div class="fg-name">${esc(d.name)}</div>
    <div class="fg-meta">${fmt(used)} / ${cap?fmt(cap):'∞'} · ${pct}%</div>
    <div class="fg-acts">
      ${isAdmin?`<button class="icon-btn xs danger" onclick="event.stopPropagation();disconnectDrive('${esc(d.id)}')" title="Disconnect"><i class="fas fa-unlink"></i></button>`:''}
      <button class="icon-btn xs" onclick="event.stopPropagation();navTo('files','${esc(d.id)}')" title="Open"><i class="fas fa-folder-open"></i></button>
    </div>
  </div>`;
}

// ─── Folder / File cards ───────────────────────────────
function folderCard(f){
  const isAdmin=S.ses.role==='admin';
  return `<div class="fg-card" ondblclick="navTo('files','${esc(f.driveId)}','${esc(f.id)}')" onclick="selectCard(this)">
    <div class="fg-icon xl"><i class="fas fa-folder" style="color:#ff9f0a"></i></div>
    <div class="fg-name">${esc(f.name)}</div>
    <div class="fg-acts">${isAdmin?`<button class="icon-btn xs danger" onclick="event.stopPropagation();confirmDeleteFolder('${esc(f.id)}','${esc(f.name)}')"><i class="fas fa-trash-alt"></i></button>`:''}</div>
  </div>`;
}
function fileCard(f){
  const cfg=ftCfg(f.name,f.mimeType),isAdmin=S.ses.role==='admin';
  const isMedia=['image','video','audio'].includes(cfg.cat);
  const isImage=cfg.cat==='image';
  const isVideo=cfg.cat==='video';
  const driveId=f.driveId||_driveId||(S.db&&S.db.drives&&S.db.drives[0]?S.db.drives[0].id:'');
  const previewUrl=getFileDownloadUrl(f.googleFileId, driveId, true);

  return `<div class="fg-card ${isImage?'is-image':isVideo?'is-video':''}" ondblclick="${isMedia?`openMedia('${esc(f.id)}')`:`downloadFile('${esc(f.id)}')`}" onclick="selectCard(this)">
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
      ${isMedia?`<button class="icon-btn xs" onclick="event.stopPropagation();openMedia('${esc(f.id)}')"><i class="fas fa-eye"></i></button>`:''}
      <button class="icon-btn xs" onclick="event.stopPropagation();downloadFile('${esc(f.id)}')"><i class="fas fa-download"></i></button>
      ${isAdmin?`<button class="icon-btn xs danger" onclick="event.stopPropagation();confirmDeleteFile('${esc(f.id)}','${esc(f.name)}')"><i class="fas fa-trash-alt"></i></button>`:''}
    </div>
  </div>`;
}
function folderRow(f){
  const isAdmin=S.ses.role==='admin';
  return `<div class="fl-row" ondblclick="navTo('files','${esc(f.driveId)}','${esc(f.id)}')">
    <span><i class="fas fa-folder" style="color:#ff9f0a;margin-right:.4rem"></i>${esc(f.name)}</span>
    <span>—</span><span>${fmtDate(f.date)}</span>
    <span>${isAdmin?`<button class="icon-btn xs danger" onclick="confirmDeleteFolder('${esc(f.id)}','${esc(f.name)}')"><i class="fas fa-trash-alt"></i></button>`:''}</span>
  </div>`;
}
function fileRow(f){
  const cfg=ftCfg(f.name,f.mimeType),isAdmin=S.ses.role==='admin';
  const isMedia=['image','video','audio'].includes(cfg.cat);
  return `<div class="fl-row" ondblclick="${isMedia?`openMedia('${esc(f.id)}')`:`downloadFile('${esc(f.id)}')`}">
    <span><i class="fas ${cfg.icon}" style="color:${cfg.col};margin-right:.4rem"></i>${esc(f.name)}</span>
    <span>${fmt(f.size||0)}</span><span>${fmtDate(f.date)}</span>
    <span style="display:flex;gap:.2rem">
      ${isMedia?`<button class="icon-btn xs" onclick="event.stopPropagation();openMedia('${esc(f.id)}')"><i class="fas fa-eye"></i></button>`:''}
      <button class="icon-btn xs" onclick="event.stopPropagation();downloadFile('${esc(f.id)}')"><i class="fas fa-download"></i></button>
      ${isAdmin?`<button class="icon-btn xs danger" onclick="event.stopPropagation();confirmDeleteFile('${esc(f.id)}','${esc(f.name)}')"><i class="fas fa-trash-alt"></i></button>`:''}
    </span>
  </div>`;
}
function selectCard(el){document.querySelectorAll('.fg-card.selected').forEach(e=>e.classList.remove('selected'));el.classList.add('selected');}

// ─── Quota Tracker ─────────────────────────────────────
async function renderQuotaPage(){
  const pc=$('pageContent');if(!pc)return;
  const drives=S.db?.drives||[];
  pc.innerHTML=`<div class="inner-page">
    <div class="page-hd"><h2>Quota Tracker</h2><p>Live storage usage across all connected drives</p></div>
    <div class="quota-grid" id="quotaGrid">
      ${drives.length?drives.map(d=>{const used=d.usedBytes||0,cap=d.capacity||0,pct=cap?Math.min(100,Math.round(used/cap*100)):0;const free=Math.max(0,cap-used);return`<div class="quota-card">
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
  if(!transfers.length){list.innerHTML=`<div class="tm-empty"><i class="fas fa-inbox"></i><span>No transfers yet</span></div>`;return;}
  list.innerHTML=transfers.map(t=>{
    const col=t.status==='done'?'var(--success)':t.status==='failed'?'var(--danger)':'var(--primary)';
    const ico=t.status==='done'?'fa-check-circle':t.status==='failed'?'fa-times-circle':'fa-spinner fa-spin';
    const uMB=(t.uploaded/1048576||0).toFixed(1),tMB=(t.size/1048576||0).toFixed(1),spd=t.speed?` · ${fmtSpeed(t.speed)}`:'';
    const sub=t.status==='uploading'?`${uMB}/${tMB} MB${spd}`:t.status==='done'?`Done · ${fmt(t.size||0)}`:'Failed';
    return `<div class="tm-item">
      <div class="tm-ico" style="color:${col}"><i class="fas ${ico}"></i></div>
      <div class="tm-info"><div class="tm-name">${esc(t.name)}</div><div class="tm-sub">${sub}</div>
        ${t.status==='uploading'?`<div class="tm-bar"><div class="tm-fill" style="width:${t.pct||0}%"></div></div>`:''}
      </div>
      ${t.status==='uploading'?`<button class="tm-cancel" onclick="S.cancelUpload=true;S._xhr?.abort()"><i class="fas fa-times"></i></button>`:''}
    </div>`;
  }).join('');
}