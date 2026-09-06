// TELEDRIVE — Admin (Full-Screen at #/admin)
const COLORS=['#0a84ff','#30d158','#ff9f0a','#bf5af2','#ff453a','#ff375f','#64d2ff','#ffd60a'];

// ---- Admin Login (shown when visiting #/admin while not logged in) ----
function showAdminLogin() {
  const sc = $('adminScreen');
  sc.classList.remove('hidden');
  $('homeScreen').classList.add('hidden');
  $('explorerView').classList.add('hidden');
  sc.innerHTML = `
    <div class="admin-login-wrap">
      <div class="admin-login-box">
        <div class="admin-login-logo"><i class="fas fa-shield-alt"></i></div>
        <h2 class="admin-login-title">Admin Access</h2>
        <p style="color:var(--text2);font-size:.85rem;margin-bottom:1.5rem;text-align:center">
          This area is restricted. Enter your admin password to continue.
        </p>
        <div class="f-grp">
          <input type="password" id="adminPassInp" class="f-inp" placeholder="Admin password..." autofocus>
          <div id="adminPassErr" class="f-err" style="min-height:1.1rem;margin-top:.35rem"></div>
        </div>
        <button class="btn-p" id="adminPassBtn" style="width:100%;margin-top:.4rem">
          <i class="fas fa-unlock"></i> Login
        </button>
        <button class="btn-s" onclick="goHome()" style="width:100%;margin-top:.6rem">
          <i class="fas fa-arrow-left"></i> Back to Home
        </button>
      </div>
    </div>
  `;
  const login = async () => {
    const p = $('adminPassInp').value;
    if (!p) return;
    const h = await sha256(p);
    if (h === S.db.adminHash) {
      S.ses.isAdmin = true; saveSes();
      logActivity('admin_login', 'Admin login', {});
      await saveDB();
      syncAdminUI(); showAdminScreen();
    } else {
      $('adminPassErr').textContent = 'Incorrect password';
      $('adminPassInp').value = '';
    }
  };
  $('adminPassBtn').onclick = login;
  $('adminPassInp').onkeydown = e => { if (e.key === 'Enter') login(); };
}

// ---- Full Admin Screen ----
function renderAdminScreen() {
  const sc = $('adminScreen');
  sc.innerHTML = `
    <div class="admin-pg">
      <div class="admin-pg-hd">
        <div class="admin-pg-logo"><i class="fas fa-shield-alt"></i> Admin Panel</div>
        <div class="admin-pg-acts">
          <button class="btn-sm" onclick="goHome()"><i class="fas fa-home"></i> Home</button>
          <button class="btn-sm d" id="adminLogoutBtn"><i class="fas fa-sign-out-alt"></i> Logout</button>
        </div>
      </div>
      <div class="admin-pg-tabs">
        <div class="admin-pg-tab active" data-t="overview"><i class="fas fa-chart-bar"></i> Overview</div>
        <div class="admin-pg-tab" data-t="files"><i class="fas fa-file"></i> All Files</div>
        <div class="admin-pg-tab" data-t="drives"><i class="fas fa-hard-drive"></i> Drives</div>
        <div class="admin-pg-tab" data-t="activity"><i class="fas fa-history"></i> Activity Log</div>
        <div class="admin-pg-tab" data-t="settings"><i class="fas fa-cog"></i> Settings</div>
      </div>
      <div class="admin-pg-body" id="adminPgBody">${renderAdminTab('overview')}</div>
    </div>
  `;
  sc.querySelectorAll('.admin-pg-tab').forEach(tab => {
    tab.onclick = () => {
      sc.querySelectorAll('.admin-pg-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      $('adminPgBody').innerHTML = renderAdminTab(tab.dataset.t);
      bindAdminPgTab(tab.dataset.t);
    };
  });
  bindAdminPgTab('overview');
  $('adminLogoutBtn').onclick = () => {
    S.ses.isAdmin = false; saveSes(); syncAdminUI();
    window.location.hash = '#/'; goHome(); toast('Logged out', 'info');
  };
}

function renderAdminTab(t) {
  if (t === 'overview') {
    const totalFiles = S.db.files.length;
    const totalSize  = S.db.files.reduce((a,f)=>a+f.size,0);
    const totalFolders = S.db.folders.length;
    const drives = S.db.drives.length;
    const recentUploads = S.db.files.slice().sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,5);
    return `
      <div class="admin-stats">
        <div class="stat-card"><div class="stat-n">${totalFiles}</div><div class="stat-l">Total Files</div></div>
        <div class="stat-card"><div class="stat-n">${fmt(totalSize)}</div><div class="stat-l">Storage Used</div></div>
        <div class="stat-card"><div class="stat-n">${totalFolders}</div><div class="stat-l">Folders</div></div>
        <div class="stat-card"><div class="stat-n">${drives}</div><div class="stat-l">Drives</div></div>
      </div>
      <div class="admin-section-title">Recent Uploads</div>
      <div class="admin-file-list">
        ${recentUploads.length ? recentUploads.map(f=>{
          const d=S.db.drives.find(x=>x.id===f.driveId);
          return `<div class="admin-file-row">
            <span class="admin-file-ico">${ftCfg(f.type).em}</span>
            <span class="admin-file-name">${esc(f.name)}</span>
            <span class="admin-file-drive" style="color:${d?.color||'var(--primary)'}">${d?.letter||'?'}:</span>
            <span class="admin-file-size">${fmt(f.size)}</span>
            <span class="admin-file-date">${fmtDate(f.date)}</span>
          </div>`;
        }).join('') : '<div style="color:var(--text2);padding:.8rem;text-align:center">No files yet</div>'}
      </div>
    `;
  }
  if (t === 'files') {
    const q = '';
    const allFiles = S.db.files.slice().sort((a,b)=>new Date(b.date)-new Date(a.date));
    return `
      <div style="display:flex;gap:.6rem;margin-bottom:1rem;align-items:center">
        <input type="text" id="adminFileSearch" class="f-inp" placeholder="Search files..." style="max-width:280px;margin-bottom:0">
        <span style="color:var(--text2);font-size:.82rem">${allFiles.length} total files</span>
      </div>
      <div class="admin-file-list" id="adminFileList">
        ${renderAdminFileRows(allFiles)}
      </div>
    `;
  }
  if (t === 'drives') {
    let h = `<div style="margin-bottom:1rem"><button class="btn-sm p" id="addDriveBtn"><i class="fas fa-plus"></i> Add Drive</button></div>`;
    S.db.drives.forEach(d => {
      const fc = S.db.files.filter(f=>f.driveId===d.id).length;
      const sz = S.db.files.filter(f=>f.driveId===d.id).reduce((a,f)=>a+f.size,0);
      const cap = d.capacity ? `${d.capacity} GB` : 'Unlimited';
      h += `<div class="drive-row">
        <div class="drive-row-badge" style="background:${d.color||'var(--primary)'}">${esc(d.letter)}</div>
        <div class="drive-row-info">
          <div class="drive-row-name">${esc(d.name)} (${esc(d.letter)}:)</div>
          <div class="drive-row-sub">${d.passwordHash?'🔒 Password set':'🔓 No password'} · ${fc} files · ${fmt(sz)} used · Capacity: ${cap}</div>
        </div>
        <div class="drive-row-acts">
          <button class="btn-sm editDrBtn" data-id="${d.id}">Edit</button>
          <button class="btn-sm d delDrBtn" data-id="${d.id}">Delete</button>
        </div>
      </div>`;
    });
    return h;
  }
  if (t === 'activity') {
    const log = S.db.activityLog || [];
    const iconMap = {upload:'fa-upload',download:'fa-download',delete_file:'fa-trash',delete_folder:'fa-folder-minus',view:'fa-eye',admin_login:'fa-shield-alt'};
    const colorMap = {upload:'var(--success)',download:'var(--primary)',delete_file:'var(--danger)',delete_folder:'var(--danger)',view:'var(--text2)',admin_login:'var(--warning)'};
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
        <span style="color:var(--text2);font-size:.82rem">${log.length} events logged</span>
        <button class="btn-sm d" id="clearLogBtn"><i class="fas fa-trash"></i> Clear Log</button>
      </div>
      <div class="activity-log" id="activityLog">
        ${log.length ? log.map(e=>{
          const ico = iconMap[e.type]||'fa-info';
          const col = colorMap[e.type]||'var(--text2)';
          return `<div class="activity-row">
            <div class="activity-ico" style="color:${col}"><i class="fas ${ico}"></i></div>
            <div class="activity-info">
              <div class="activity-name">${esc(e.name)}</div>
              <div class="activity-sub">${e.type.replace(/_/g,' ')}${e.driveLetter?' · Drive '+e.driveLetter+':':''}${e.size?' · '+fmt(e.size):''}</div>
            </div>
            <div class="activity-time">${fmtDate(e.ts)}</div>
          </div>`;
        }).join('') : '<div style="text-align:center;padding:3rem;color:var(--text2)"><i class="fas fa-history" style="font-size:2rem;display:block;margin-bottom:.8rem;opacity:.3"></i>No activity yet</div>'}
      </div>
    `;
  }
  if (t === 'settings') {
    return `
      <div class="f-grp"><label class="f-lbl">Bot Token</label><input type="password" id="sBt" class="f-inp" value="${esc(S.cfg.botToken)}"></div>
      <div class="f-grp"><label class="f-lbl">Chat ID</label><input id="sCid" class="f-inp" value="${esc(S.cfg.chatId)}"></div>
      <div class="f-grp"><label class="f-lbl">New Admin Password <span style="color:var(--text3)">(leave blank to keep current)</span></label><input type="password" id="sAp" class="f-inp" placeholder="New password..."></div>
      <div class="f-grp"><label class="f-lbl">Local Bot API URL</label><input id="sApi" class="f-inp" value="${esc(LOCAL_API)}" readonly><div class="f-hint">Change in js/config.js → LOCAL_API constant</div></div>
      <div style="margin-top:.5rem;display:flex;gap:.6rem">
        <button class="btn-p" id="saveSetBtn">Save Settings</button>
        <button class="btn-sm p" id="bkExport"><i class="fas fa-download"></i> Export Backup</button>
        <button class="btn-sm" id="bkImport"><i class="fas fa-upload"></i> Import</button>
        <input type="file" id="bkFile" accept=".json" hidden>
      </div>
    `;
  }
  return '';
}

function renderAdminFileRows(files) {
  if (!files.length) return '<div style="text-align:center;padding:3rem;color:var(--text2)">No files</div>';
  return files.map(f => {
    const d = S.db.drives.find(x=>x.id===f.driveId);
    const folder = f.folderId ? S.db.folders.find(x=>x.id===f.folderId) : null;
    return `<div class="admin-file-row" data-id="${f.id}">
      <span class="admin-file-ico">${ftCfg(f.type).em}</span>
      <div class="admin-file-name-wrap">
        <div class="admin-file-name">${esc(f.name)}</div>
        <div class="admin-file-path" style="font-size:.7rem;color:var(--text3)">${d?.letter||'?'}:${folder?'/'+esc(folder.name):''}</div>
      </div>
      <span class="admin-file-size">${fmt(f.size)}</span>
      <span class="admin-file-date">${fmtDate(f.date)}</span>
      <div class="admin-file-acts">
        <button class="btn-sm aDownBtn" data-id="${f.id}" title="Download"><i class="fas fa-download"></i></button>
        <button class="btn-sm d aDelBtn" data-id="${f.id}" title="Delete"><i class="fas fa-trash"></i></button>
      </div>
    </div>`;
  }).join('');
}

function bindAdminPgTab(t) {
  const body = $('adminPgBody');
  if (t === 'files') {
    $('adminFileSearch')?.addEventListener('input', e => {
      const q = e.target.value.toLowerCase();
      const filtered = q ? S.db.files.filter(f=>f.name.toLowerCase().includes(q)) : S.db.files;
      $('adminFileList').innerHTML = renderAdminFileRows(filtered.slice().sort((a,b)=>new Date(b.date)-new Date(a.date)));
      bindFileActions($('adminFileList'));
    });
    bindFileActions($('adminFileList'));
  }
  if (t === 'drives') {
    body.querySelector('#addDriveBtn')?.addEventListener('click', () => createDriveDialog(renderAdminScreen));
    body.querySelectorAll('.editDrBtn').forEach(btn => btn.addEventListener('click', () => {
      const d = S.db.drives.find(x=>x.id===btn.dataset.id);
      if (d) editDriveDialog(d, renderAdminScreen);
    }));
    body.querySelectorAll('.delDrBtn').forEach(btn => btn.addEventListener('click', async () => {
      const d = S.db.drives.find(x=>x.id===btn.dataset.id);
      if (d && confirm(`Delete "${d.name}" and ALL its files?`)) { await deleteDrive(d); renderAdminScreen(); }
    }));
  }
  if (t === 'activity') {
    $('clearLogBtn')?.addEventListener('click', async () => {
      if (!confirm('Clear all activity logs?')) return;
      S.db.activityLog = []; await saveDB(); renderAdminScreen();
      $('adminPgBody').innerHTML = renderAdminTab('activity');
      bindAdminPgTab('activity');
    });
  }
  if (t === 'settings') {
    $('saveSetBtn')?.addEventListener('click', async () => {
      const bt = $('sBt').value.trim();
      const cid = $('sCid').value.trim();
      const ap = $('sAp').value;
      if (bt) S.cfg.botToken = bt;
      if (cid) S.cfg.chatId = cid;
      if (ap) S.db.adminHash = await sha256(ap);
      saveCfg();
      const ok = await saveDB();
      toast(ok ? 'Settings saved' : 'Saved (Upstash sync failed)', ok ? 'success' : 'warning');
    });
    $('bkExport')?.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(S.db,null,2)],{type:'application/json'});
      dlLink(URL.createObjectURL(blob),`teledrive_backup_${new Date().toISOString().slice(0,10)}.json`);
      toast('Backup exported','success');
    });
    $('bkImport')?.addEventListener('click', () => $('bkFile').click());
    $('bkFile')?.addEventListener('change', async e => {
      const file = e.target.files[0]; if (!file) return;
      try {
        const d = JSON.parse(await file.text());
        if (!d.v||!d.drives) throw new Error('Invalid backup');
        S.db = d; if(!S.db.activityLog)S.db.activityLog=[];
        await saveDB(); renderAdminScreen(); toast('Backup restored','success');
      } catch(e) { toast('Import failed: '+e.message,'error'); }
    });
  }
}

function bindFileActions(container) {
  container?.querySelectorAll('.aDownBtn').forEach(btn => btn.addEventListener('click', () => {
    const f = S.db.files.find(x=>x.id===btn.dataset.id); if(f) downloadFile(f);
  }));
  container?.querySelectorAll('.aDelBtn').forEach(btn => btn.addEventListener('click', async () => {
    const f = S.db.files.find(x=>x.id===btn.dataset.id);
    if (f && confirm(`Delete "${f.name}"?`)) { await deleteFile(f); renderAdminScreen(); }
  }));
}

// Drive management
function createDriveDialog(cb) {
  let color=COLORS[0];
  const{box,close}=modal(`<div class="modal-hd"><div class="modal-ttl">Create Drive</div><button class="modal-x modal-cls"><i class="fas fa-times"></i></button></div><div class="modal-bd"><div class="f-grp"><label class="f-lbl">Drive Name</label><input id="cdName" class="f-inp" placeholder="e.g. My Drive" autofocus></div><div class="f-grp"><label class="f-lbl">Drive Letter</label><input id="cdLetter" class="f-inp" placeholder="T" maxlength="1" style="width:80px;text-transform:uppercase"></div><div class="f-grp"><label class="f-lbl">Capacity (GB)</label><input id="cdCap" class="f-inp" type="number" placeholder="Leave blank for Unlimited"></div><div class="f-grp"><label class="f-lbl">Color</label><div class="color-grid">${COLORS.map((c,i)=>`<div class="c-swatch${i===0?' active':''}" data-c="${c}" style="background:${c}"></div>`).join('')}</div></div><div class="f-grp"><label class="f-lbl">Password (optional)</label><input type="password" id="cdPass" class="f-inp" placeholder="Leave blank for no password"></div></div><div class="modal-ft"><button class="btn-s modal-cls">Cancel</button><button id="cdCreate" class="btn-p">Create Drive</button></div>`);
  box.querySelectorAll('.c-swatch').forEach(s=>{s.onclick=()=>{color=s.dataset.c;box.querySelectorAll('.c-swatch').forEach(x=>x.classList.remove('active'));s.classList.add('active');};});
  box.querySelector('#cdLetter').oninput=e=>e.target.value=e.target.value.toUpperCase().replace(/[^A-Z]/g,'');
  box.querySelector('#cdCreate').onclick=async()=>{
    const name=box.querySelector('#cdName').value.trim();
    const letter=box.querySelector('#cdLetter').value.trim().toUpperCase();
    const pass=box.querySelector('#cdPass').value;
    const cap=parseInt(box.querySelector('#cdCap').value)||null;
    if(!name||!letter){toast('Fill name and letter','error');return;}
    if(S.db.drives.find(d=>d.letter===letter)){toast('Letter in use','error');return;}
    S.db.drives.push({id:uid(),letter,name,color,passwordHash:pass?await sha256(pass):null,capacity:cap,createdAt:new Date().toISOString()});
    await saveDB();close();renderHome();toast(`Drive ${letter}: created`,'success');if(cb)cb();
  };
}
function editDriveDialog(drive, cb) {
  const{box,close}=modal(`<div class="modal-hd"><div class="modal-ttl">Edit Drive — ${esc(drive.letter)}:</div><button class="modal-x modal-cls"><i class="fas fa-times"></i></button></div><div class="modal-bd"><div class="f-grp"><label class="f-lbl">Drive Name</label><input id="edName" class="f-inp" value="${esc(drive.name)}" autofocus></div><div class="f-grp"><label class="f-lbl">Capacity (GB)</label><input id="edCap" class="f-inp" type="number" value="${drive.capacity||''}" placeholder="Blank = Unlimited"></div><div class="f-grp"><label class="f-lbl">${drive.passwordHash?'Change Password':'Set Password (optional)'}</label><input type="password" id="edPass" class="f-inp" placeholder="New password...">${drive.passwordHash?'<div class="f-hint"><label><input type="checkbox" id="edRemPass" style="margin-right:.3rem"> Remove password</label></div>':''}</div></div><div class="modal-ft"><button class="btn-s modal-cls">Cancel</button><button id="edSave" class="btn-p">Save</button></div>`);
  box.querySelector('#edSave').onclick=async()=>{
    const name=box.querySelector('#edName').value.trim();
    const pass=box.querySelector('#edPass').value;
    const rem=box.querySelector('#edRemPass')?.checked;
    const cap=parseInt(box.querySelector('#edCap').value)||null;
    const d=S.db.drives.find(x=>x.id===drive.id);
    if(d){if(name)d.name=name;d.capacity=cap;if(rem)d.passwordHash=null;else if(pass)d.passwordHash=await sha256(pass);}
    await saveDB();close();renderHome();toast('Drive updated','success');if(cb)cb();
  };
}
async function deleteDrive(d){
  const files=S.db.files.filter(f=>f.driveId===d.id);
  for(const f of files)for(const c of f.chunks)await tgDelete(c.msgId);
  S.db.files=S.db.files.filter(f=>f.driveId!==d.id);S.db.folders=S.db.folders.filter(f=>f.driveId!==d.id);S.db.drives=S.db.drives.filter(x=>x.id!==d.id);
  await saveDB();renderHome();toast(`Drive ${d.letter}: deleted`,'success');
}