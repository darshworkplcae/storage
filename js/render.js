// TeleDrive — Rendering

function renderHome(){
  const el=$('drivesGrid');if(!el)return;
  const drives=S.db?.drives||[];
  const search=($('globalSearch')?.value||'').toLowerCase();
  if(!drives.length){
    el.innerHTML=`<div class="empty-drives"><div class="empty-icon"><i class="fas fa-hard-drive"></i></div><h3>No Drives Connected</h3><p>Connect a Google Drive account from the admin panel</p>${S.ses.role==='admin'?`<button class="btn-p" onclick="showAdminScreen()"><i class="fas fa-plus"></i> Add Drive</button>`:''}</div>`;
    return;
  }
  const visible=drives.filter(d=>!search||d.name?.toLowerCase().includes(search)||d.email?.toLowerCase().includes(search));
  const isAdmin=S.ses.role==='admin';
  // Filter by allowed drives for users
  const allowed=S.ses.allowedDrives==='all'?null:S.ses.allowedDrives;
  const filtered=allowed?visible.filter(d=>allowed.includes(d.id)):visible;
  el.innerHTML=filtered.map(d=>{
    const used=d.usedBytes||0;const cap=d.capacity||0;
    const pct=cap?Math.min(100,Math.round(used/cap*100)):0;
    const usedStr=fmt(used);const capStr=cap?fmt(cap):'∞';
    const files=(S.db?.files||[]).filter(f=>f.driveId===d.id).length;
    return `<div class="drive-card" style="--dc:${esc(d.color)}" onclick="openDrive('${esc(d.id)}')">
      <div class="dc-accent"></div>
      <div class="dc-top">
        <div class="dc-icon" style="background:${esc(d.color)}22;color:${esc(d.color)}"><i class="fab fa-google-drive"></i></div>
        <div class="dc-info">
          <div class="dc-name">${esc(d.name)}</div>
          <div class="dc-email">${esc(d.email||'')}</div>
        </div>
        ${isAdmin?`<div class="dc-menu" onclick="event.stopPropagation();showDriveMenu('${esc(d.id)}',this)"><i class="fas fa-ellipsis-v"></i></div>`:''}
      </div>
      <div class="dc-quota">
        <div class="dc-quota-bar"><div class="dc-quota-fill" style="width:${pct}%;background:${esc(d.color)}"></div></div>
        <div class="dc-quota-txt"><span>${usedStr} used</span><span>${capStr}</span></div>
      </div>
      <div class="dc-footer">
        <span><i class="fas fa-file" style="color:${esc(d.color)}"></i> ${files} files</span>
        <span class="dc-badge" style="background:${esc(d.color)}22;color:${esc(d.color)}">${pct}%</span>
      </div>
    </div>`;
  }).join('');
  if(!filtered.length)el.innerHTML=`<div style="color:var(--text3);padding:2rem;grid-column:1/-1">No drives match your search.</div>`;
}

function openDrive(driveId){
  S.driveId=driveId;S.folderId=null;
  pushNav(driveId,null);
  showScreen('explorerView');syncToolbar();renderExplorer();
}

function renderExplorer(){
  renderSidebar();renderAddr();renderContent();renderStats();
}

function renderSidebar(){
  const el=$('sidebarTree');if(!el||!S.db)return;
  const drives=S.db.drives||[];
  el.innerHTML=drives.map(d=>`
    <div class="sb-drive ${S.driveId===d.id?'active':''}" onclick="openDrive('${esc(d.id)}')">
      <span class="sb-dot" style="background:${esc(d.color)}"></span>${esc(d.name)}
    </div>
    ${S.driveId===d.id?renderSidebarFolders(null,d.id,1):''}
  `).join('');
}

function renderSidebarFolders(parentId,driveId,depth){
  if(depth>3)return '';
  const folders=(S.db?.folders||[]).filter(f=>f.driveId===driveId&&f.parentId===parentId);
  return folders.map(f=>`
    <div class="sb-folder ${S.folderId===f.id?'active':''}" style="padding-left:${8+depth*12}px" onclick="openFolder('${esc(f.id)}')">
      <i class="fas fa-folder" style="color:#ff9f0a;font-size:.75rem;margin-right:.3rem"></i>${esc(f.name)}
    </div>
    ${renderSidebarFolders(f.id,driveId,depth+1)}
  `).join('');
}

function renderAddr(){
  const el=$('addrBar');if(!el||!S.db)return;
  const drive=S.db.drives?.find(d=>d.id===S.driveId);
  let parts=[`<span class="addr-part" onclick="openDrive('${esc(S.driveId)}')" style="color:${esc(drive?.color||'var(--primary)')}"><i class="fab fa-google-drive"></i> ${esc(drive?.name||'Drive')}</span>`];
  if(S.folderId){
    const chain=getFolderChain(S.folderId);
    chain.forEach(f=>{
      parts.push(`<i class="fas fa-chevron-right addr-sep"></i>`);
      parts.push(`<span class="addr-part" onclick="openFolder('${esc(f.id)}')">${esc(f.name)}</span>`);
    });
  }
  el.innerHTML=parts.join('');
}

function getFolderChain(folderId){
  const chain=[];let current=S.db?.folders?.find(f=>f.id===folderId);
  while(current){chain.unshift(current);current=S.db?.folders?.find(f=>f.id===current.parentId);}
  return chain;
}

function openFolder(folderId){S.folderId=folderId;pushNav(S.driveId,folderId);renderExplorer();}

function getVisibleItems(){
  if(!S.db||!S.driveId)return{folders:[],files:[]};
  const search=($('globalSearch')?.value||'').toLowerCase();
  let folders=(S.db.folders||[]).filter(f=>f.driveId===S.driveId&&f.parentId===(S.folderId||null));
  let files=(S.db.files||[]).filter(f=>f.driveId===S.driveId&&f.folderId===(S.folderId||null));
  // Filter by type
  if(S.filter!=='all'||S.filterExt){
    if(S.filterExt){const ext=S.filterExt.toLowerCase().replace(/^\./,'');files=files.filter(f=>f.name.split('.').pop().toLowerCase()===ext);}
    else{files=files.filter(f=>ftCfg(f.name,f.mimeType).cat===S.filter);}
    folders=[];
  }
  // Search
  if(search){folders=folders.filter(f=>f.name.toLowerCase().includes(search));files=files.filter(f=>f.name.toLowerCase().includes(search));}
  // Sort
  const sortKey=S.sort==='date'?'date':S.sort==='size'?'size':'name';
  const sortFn=(a,b)=>sortKey==='size'?(b.size||0)-(a.size||0):sortKey==='date'?new Date(b.date)-new Date(a.date):(a.name||'').localeCompare(b.name||'');
  folders.sort((a,b)=>(a.name||'').localeCompare(b.name||''));files.sort(sortFn);
  return{folders,files};
}

function renderContent(){
  const el=$('exContent');if(!el)return;
  const{folders,files}=getVisibleItems();
  if(!folders.length&&!files.length){
    el.innerHTML=`<div class="empty-state"><div class="empty-icon"><i class="fas fa-folder-open"></i></div><h3>Empty</h3><p>Drop files here or click Upload</p></div>`;
    return;
  }
  if(S.view==='list'){
    el.innerHTML=`<div class="file-list">
      <div class="fl-hd"><span>Name</span><span>Size</span><span>Date</span><span></span></div>
      ${folders.map(f=>folderListRow(f)).join('')}
      ${files.map(f=>fileListRow(f)).join('')}
    </div>`;
  }else{
    el.innerHTML=`<div class="file-grid">
      ${folders.map(f=>folderGridCard(f)).join('')}
      ${files.map(f=>fileGridCard(f)).join('')}
    </div>`;
  }
}

function folderGridCard(f){
  const isAdmin=S.ses.role==='admin';
  return `<div class="fg-card folder-card" ondblclick="openFolder('${esc(f.id)}')" onclick="selectItem(this)">
    <div class="fg-icon folder-icon"><i class="fas fa-folder"></i></div>
    <div class="fg-name" title="${esc(f.name)}">${esc(f.name)}</div>
    ${isAdmin?`<div class="fg-acts">
      <button class="icon-btn sm" onclick="event.stopPropagation();confirmDeleteFolder('${esc(f.id)}','${esc(f.name)}')" title="Delete"><i class="fas fa-trash-alt"></i></button>
    </div>`:''}
  </div>`;
}

function fileGridCard(f){
  const cfg=ftCfg(f.name,f.mimeType);
  const isAdmin=S.ses.role==='admin';
  const isMedia=['image','video','audio'].includes(cfg.cat);
  return `<div class="fg-card" ondblclick="${isMedia?`openMedia('${esc(f.id)}')`:`downloadFile('${esc(f.id)}')`}" onclick="selectItem(this)" title="${esc(f.name)}">
    <div class="fg-icon" style="color:${cfg.col}"><i class="fas ${cfg.icon}"></i></div>
    <div class="fg-name">${esc(f.name)}</div>
    <div class="fg-meta">${fmt(f.size||0)}</div>
    <div class="fg-acts">
      ${isMedia?`<button class="icon-btn sm" onclick="event.stopPropagation();openMedia('${esc(f.id)}')" title="Preview"><i class="fas fa-eye"></i></button>`:''}
      <button class="icon-btn sm" onclick="event.stopPropagation();downloadFile('${esc(f.id)}')" title="Download"><i class="fas fa-download"></i></button>
      ${isAdmin?`<button class="icon-btn sm danger" onclick="event.stopPropagation();confirmDeleteFile('${esc(f.id)}','${esc(f.name)}')" title="Delete"><i class="fas fa-trash-alt"></i></button>`:''}
    </div>
  </div>`;
}

function folderListRow(f){
  const isAdmin=S.ses.role==='admin';
  return `<div class="fl-row folder-row" ondblclick="openFolder('${esc(f.id)}')">
    <span><i class="fas fa-folder" style="color:#ff9f0a;margin-right:.5rem"></i>${esc(f.name)}</span>
    <span>—</span><span>${fmtDate(f.date)}</span>
    <span>${isAdmin?`<button class="icon-btn sm" onclick="confirmDeleteFolder('${esc(f.id)}','${esc(f.name)}')"><i class="fas fa-trash-alt"></i></button>`:''}</span>
  </div>`;
}

function fileListRow(f){
  const cfg=ftCfg(f.name,f.mimeType);const isAdmin=S.ses.role==='admin';
  const isMedia=['image','video','audio'].includes(cfg.cat);
  return `<div class="fl-row" ondblclick="${isMedia?`openMedia('${esc(f.id)}')`:`downloadFile('${esc(f.id)}')`}">
    <span><i class="fas ${cfg.icon}" style="color:${cfg.col};margin-right:.5rem"></i>${esc(f.name)}</span>
    <span>${fmt(f.size||0)}</span><span>${fmtDate(f.date)}</span>
    <span style="display:flex;gap:.3rem">
      ${isMedia?`<button class="icon-btn sm" onclick="event.stopPropagation();openMedia('${esc(f.id)}')"><i class="fas fa-eye"></i></button>`:''}
      <button class="icon-btn sm" onclick="event.stopPropagation();downloadFile('${esc(f.id)}')"><i class="fas fa-download"></i></button>
      ${isAdmin?`<button class="icon-btn sm danger" onclick="event.stopPropagation();confirmDeleteFile('${esc(f.id)}','${esc(f.name)}')"><i class="fas fa-trash-alt"></i></button>`:''}
    </span>
  </div>`;
}

function renderStats(){
  const el=$('statusBar');if(!el||!S.db)return;
  const{folders,files}=getVisibleItems();
  const total=files.reduce((s,f)=>s+(f.size||0),0);
  el.innerHTML=`<span>${folders.length} folder${folders.length!==1?'s':''}, ${files.length} file${files.length!==1?'s':''}</span><span>${total?fmt(total):''}</span>`;
}

function selectItem(el){document.querySelectorAll('.fg-card.selected').forEach(e=>e.classList.remove('selected'));el.classList.add('selected');}

// Transfer Manager panel
function renderTM(){
  const badge=$('tmBadge'),list=$('tmList');
  const transfers=tmLoad();
  const active=transfers.filter(t=>t.status==='uploading');
  if(badge){badge.textContent=active.length||'';badge.classList.toggle('visible',active.length>0);}
  if(!list)return;
  if(!transfers.length){list.innerHTML=`<div class="tm-empty"><i class="fas fa-inbox"></i><span>No transfers yet</span></div>`;return;}
  list.innerHTML=transfers.map(t=>{
    const col=t.status==='done'?'var(--success)':t.status==='failed'?'var(--danger)':'var(--primary)';
    const ico=t.status==='done'?'fa-check-circle':t.status==='failed'?'fa-times-circle':'fa-spinner fa-spin';
    const uMB=t.uploaded?(t.uploaded/1048576).toFixed(1):'0';
    const tMB=t.size?(t.size/1048576).toFixed(1):'?';
    const spd=t.speed?` · ${fmtSpeed(t.speed)}`:'';
    const sub=t.status==='uploading'?`${uMB}/${tMB} MB${spd}`:t.status==='done'?`Done · ${fmt(t.size||0)}`:`Failed`;
    return `<div class="tm-item">
      <div class="tm-ico" style="color:${col}"><i class="fas ${ico}"></i></div>
      <div class="tm-info">
        <div class="tm-name" title="${esc(t.name)}">${esc(t.name)}</div>
        <div class="tm-sub">${sub}</div>
        ${t.status==='uploading'?`<div class="tm-bar"><div class="tm-fill" style="width:${t.pct||0}%"></div></div>`:''}
      </div>
      ${t.status==='uploading'?`<button class="tm-cancel" onclick="S.cancelUpload=true;S._xhr&&S._xhr.abort()" title="Cancel"><i class="fas fa-times"></i></button>`:''}
    </div>`;
  }).join('');
}

function renderLoginScreen(returnTo=''){
  const el=$('authScreen');if(!el)return;
  el.innerHTML=`<div class="auth-wrap">
    <div class="auth-card">
      <div class="auth-logo"><i class="fas fa-hard-drive"></i></div>
      <h2 class="auth-title">Sign In</h2>
      <p class="auth-sub">Enter your credentials to access TeleDrive</p>
      <div id="authError" class="auth-err hidden"></div>
      <div class="tabs" id="authTabs">
        <button class="tab active" onclick="switchAuthTab('user',this)">User</button>
        <button class="tab" onclick="switchAuthTab('admin',this)">Admin</button>
      </div>
      <div id="authUserForm">
        <input class="inp" type="text" id="authUsername" placeholder="Username" autocomplete="username">
        <input class="inp" type="password" id="authPassword" placeholder="Password" autocomplete="current-password">
        <button class="btn-p w100" id="authLoginBtn" onclick="doLogin()"><i class="fas fa-sign-in-alt"></i> Sign In</button>
      </div>
      <div id="authAdminForm" class="hidden">
        <input class="inp" type="password" id="authAdminPass" placeholder="Admin password" autocomplete="current-password">
        <button class="btn-p w100" onclick="doAdminLogin()"><i class="fas fa-user-shield"></i> Admin Login</button>
      </div>
    </div>
  </div>`;
}

function switchAuthTab(mode,btn){
  document.querySelectorAll('#authTabs .tab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  $('authUserForm').classList.toggle('hidden',mode==='admin');
  $('authAdminForm').classList.toggle('hidden',mode==='user');
}

function syncAdminUI(){
  const logoutBtn=$('logoutBtn');
  const isAuth=S.ses.role==='admin'||S.ses.role==='user';
  if(logoutBtn)logoutBtn.classList.toggle('hidden',!isAuth);
  const adminFab=$('adminFab');
  if(adminFab)adminFab.classList.toggle('hidden',S.ses.role!=='admin');
}