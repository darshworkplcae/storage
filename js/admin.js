// TeleDrive — Admin Panel
function renderAdminScreen(){
  const el=$('adminScreen');if(!el)return;
  const db=S.db||{drives:[],files:[],folders:[],activityLog:[],users:[]};
  const drives=db.drives||[];const files=db.files||[];const users=db.users||[];const log=db.activityLog||[];
  const totalSize=files.reduce((s,f)=>s+(f.size||0),0);
  el.innerHTML=`
  <div class="admin-wrap">
    <div class="admin-hd">
      <div class="admin-logo"><i class="fas fa-shield-halved"></i> Admin Panel</div>
      <button class="btn-ghost sm" onclick="goHome()"><i class="fas fa-arrow-left"></i> Back</button>
    </div>
    <div class="admin-tabs" id="adminTabs">
      <button class="atab active" onclick="showAdminTab('overview',this)"><i class="fas fa-chart-pie"></i> Overview</button>
      <button class="atab" onclick="showAdminTab('drives',this)"><i class="fab fa-google-drive"></i> Drives</button>
      <button class="atab" onclick="showAdminTab('files',this)"><i class="fas fa-folder"></i> Files</button>
      <button class="atab" onclick="showAdminTab('users',this)"><i class="fas fa-users"></i> Users</button>
      <button class="atab" onclick="showAdminTab('log',this)"><i class="fas fa-list-ul"></i> Activity</button>
      <button class="atab" onclick="showAdminTab('settings',this)"><i class="fas fa-sliders"></i> Settings</button>
    </div>
    <div id="adminContent" class="admin-content"></div>
  </div>`;
  showAdminTab('overview');
}

function showAdminTab(tab,btn){
  document.querySelectorAll('#adminTabs .atab').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  else document.querySelector(`#adminTabs .atab`)?.classList.add('active');
  const db=S.db||{drives:[],files:[],folders:[],activityLog:[],users:[]};
  const drives=db.drives||[];const files=db.files||[];const users=db.users||[];const log=db.activityLog||[];
  const totalSize=files.reduce((s,f)=>s+(f.size||0),0);
  const el=$('adminContent');if(!el)return;

  if(tab==='overview'){
    const totalCap=drives.reduce((s,d)=>s+(d.capacity||0),0);
    const totalUsed=drives.reduce((s,d)=>s+(d.usedBytes||0),0);
    const pct=totalCap?Math.round(totalUsed/totalCap*100):0;
    el.innerHTML=`
      <div class="overview-cards">
        <div class="ov-card"><div class="ov-icon" style="background:#0a84ff22;color:#0a84ff"><i class="fab fa-google-drive"></i></div><div class="ov-txt"><span class="ov-val">${drives.length}</span><span class="ov-lbl">Drives</span></div></div>
        <div class="ov-card"><div class="ov-icon" style="background:#30d15822;color:#30d158"><i class="fas fa-file"></i></div><div class="ov-txt"><span class="ov-val">${files.length}</span><span class="ov-lbl">Files</span></div></div>
        <div class="ov-card"><div class="ov-icon" style="background:#bf5af222;color:#bf5af2"><i class="fas fa-users"></i></div><div class="ov-txt"><span class="ov-val">${users.length}</span><span class="ov-lbl">Users</span></div></div>
        <div class="ov-card"><div class="ov-icon" style="background:#ff9f0a22;color:#ff9f0a"><i class="fas fa-database"></i></div><div class="ov-txt"><span class="ov-val">${fmt(totalSize)}</span><span class="ov-lbl">Stored</span></div></div>
      </div>
      <div class="ov-section"><h3>Storage Usage</h3>
        <div class="quota-bar big"><div class="quota-fill" style="width:${pct}%;background:var(--primary)"></div></div>
        <div style="display:flex;justify-content:space-between;margin-top:.5rem;color:var(--text3);font-size:.85rem"><span>${fmt(totalUsed)} used</span><span>${fmt(totalCap)} total</span></div>
      </div>
      <div class="ov-section"><h3>Drives</h3>
        ${drives.map(d=>{const p=d.capacity?Math.round((d.usedBytes||0)/d.capacity*100):0;return`<div class="drive-row"><span class="sb-dot" style="background:${d.color}"></span><span style="flex:1">${esc(d.email)}</span><span>${fmt(d.usedBytes||0)} / ${fmt(d.capacity||0)}</span><div class="mini-bar"><div style="width:${p}%;background:${d.color};height:100%;border-radius:2px"></div></div></div>`}).join('')}
      </div>`;
    // Refresh live quota
    apiDriveQuota().then(r=>{if(!r.drives)return;r.drives.forEach(qd=>{const d=S.db?.drives?.find(x=>x.id===qd.id);if(d&&!qd.error){d.capacity=qd.capacity;d.usedBytes=qd.usedBytes;}});if($('adminContent'))showAdminTab('overview',null);});
  }

  else if(tab==='drives'){
    el.innerHTML=`
      <div class="admin-actions">
        <button class="btn-p" id="connectDriveBtn" onclick="doConnectDrive()"><i class="fab fa-google-drive"></i> Connect Google Drive</button>
      </div>
      <div class="drives-list">
        ${drives.length?drives.map(d=>`
          <div class="drive-item">
            <div class="di-avatar" style="background:${d.color}22;color:${d.color}">${(d.name||'?')[0].toUpperCase()}</div>
            <div class="di-info"><div class="di-name">${esc(d.name)}</div><div class="di-email">${esc(d.email)}</div><div class="di-quota">${fmt(d.usedBytes||0)} / ${fmt(d.capacity||0)}</div></div>
            <div class="di-acts">
              <button class="btn-ghost sm danger" onclick="disconnectDrive('${esc(d.id)}')"><i class="fas fa-unlink"></i> Disconnect</button>
            </div>
          </div>`).join(''):`<div class="empty-msg"><i class="fab fa-google-drive"></i><p>No drives connected yet.<br>Click "Connect Google Drive" to add your first drive.</p></div>`}
      </div>`;
  }

  else if(tab==='files'){
    const search=($('adminFileSearch')?.value||'').toLowerCase();
    const filt=search?files.filter(f=>f.name.toLowerCase().includes(search)):files;
    el.innerHTML=`
      <div class="admin-actions"><input class="inp" id="adminFileSearch" placeholder="Search files…" oninput="showAdminTab('files')" style="max-width:300px"></div>
      <div class="admin-table-wrap"><table class="admin-table">
        <thead><tr><th>Name</th><th>Drive</th><th>Size</th><th>Date</th><th></th></tr></thead>
        <tbody>${filt.length?filt.map(f=>{const drive=drives.find(d=>d.id===f.driveId);const cfg=ftCfg(f.name,f.mimeType);return`<tr>
          <td><i class="fas ${cfg.icon}" style="color:${cfg.col};margin-right:.4rem"></i>${esc(f.name)}</td>
          <td><span class="sb-dot" style="background:${drive?.color||'#888'}"></span>${esc(drive?.email||'?')}</td>
          <td>${fmt(f.size||0)}</td><td>${fmtDate(f.date)}</td>
          <td><button class="icon-btn sm danger" onclick="confirmDeleteFile('${esc(f.id)}','${esc(f.name)}')"><i class="fas fa-trash-alt"></i></button></td>
        </tr>`;}).join(''):`<tr><td colspan="5" style="text-align:center;color:var(--text3)">No files found</td></tr>`}</tbody>
      </table></div>`;
  }

  else if(tab==='users'){
    el.innerHTML=`
      <div class="admin-actions">
        <button class="btn-p" onclick="showCreateUserDialog()"><i class="fas fa-user-plus"></i> Add User</button>
      </div>
      <div class="admin-table-wrap"><table class="admin-table">
        <thead><tr><th>Username</th><th>Allowed Drives</th><th>Created</th><th></th></tr></thead>
        <tbody>${users.length?users.map(u=>`<tr>
          <td><i class="fas fa-user" style="color:var(--primary);margin-right:.4rem"></i>${esc(u.username)}</td>
          <td>${u.allowedDrives==='all'?'<span class="badge">All Drives</span>':Array.isArray(u.allowedDrives)?(u.allowedDrives.map(id=>{const d=drives.find(x=>x.id===id);return d?`<span class="badge">${esc(d.email)}</span>`:''}).join('')):'All'}</td>
          <td>${fmtDate(u.createdAt||'')}</td>
          <td><button class="icon-btn sm danger" onclick="deleteUser('${esc(u.id)}','${esc(u.username)}')"><i class="fas fa-trash-alt"></i></button></td>
        </tr>`).join(''):`<tr><td colspan="4" style="text-align:center;color:var(--text3)">No users yet. Add users so others can access TeleDrive.</td></tr>`}</tbody>
      </table></div>`;
  }

  else if(tab==='log'){
    el.innerHTML=`<div class="admin-table-wrap"><table class="admin-table">
      <thead><tr><th>Action</th><th>File</th><th>Drive</th><th>Time</th></tr></thead>
      <tbody>${log.length?log.slice(0,100).map(l=>{
        const icons={upload:'fa-upload',download:'fa-download',delete:'fa-trash-alt',view:'fa-eye'};
        const colors={upload:'var(--success)',download:'var(--primary)',delete:'var(--danger)',view:'var(--text2)'};
        return`<tr>
          <td><i class="fas ${icons[l.type]||'fa-circle'}" style="color:${colors[l.type]||'var(--text2)'};margin-right:.4rem"></i>${l.type}</td>
          <td>${esc(l.name||l.googleFileId||'—')}</td>
          <td>${esc(l.driveLetter||l.driveId||'—')}</td>
          <td style="color:var(--text3);font-size:.8rem">${fmtDate(l.ts)}</td>
        </tr>`;}).join(''):`<tr><td colspan="4" style="text-align:center;color:var(--text3)">No activity yet</td></tr>`}</tbody>
    </table></div>`;
  }

  else if(tab==='settings'){
    el.innerHTML=`
      <div class="settings-section">
        <h3>Change Admin Password</h3>
        <div class="settings-row">
          <input class="inp" type="password" id="newAdminPass" placeholder="New admin password (min 4 chars)">
          <button class="btn-p" onclick="changeAdminPassword()"><i class="fas fa-key"></i> Update Password</button>
        </div>
      </div>
      <div class="settings-section">
        <h3>Google Cloud Setup</h3>
        <div class="setup-steps">
          <div class="step"><span class="step-num">1</span><div><strong>Create a Google Cloud project</strong><br><a href="https://console.cloud.google.com/" target="_blank" class="link">console.cloud.google.com</a> → New Project</div></div>
          <div class="step"><span class="step-num">2</span><div><strong>Enable Google Drive API</strong><br>APIs & Services → Enable APIs → Search "Google Drive API" → Enable</div></div>
          <div class="step"><span class="step-num">3</span><div><strong>Create OAuth Credentials</strong><br>Credentials → Create Credentials → OAuth 2.0 Client ID → Web Application<br>Redirect URI: <code>https://tobichan.pages.dev/api/auth/callback</code></div></div>
          <div class="step"><span class="step-num">4</span><div><strong>Set Environment Variables in Cloudflare Pages</strong><br>Pages → tobichan → Settings → Environment Variables:<br><code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code>, <code>ENCRYPTION_KEY</code> (any 32-char string), <code>UPSTASH_URL</code>, <code>UPSTASH_TOKEN</code></div></div>
          <div class="step"><span class="step-num">5</span><div><strong>Connect Drive</strong><br>Go to Drives tab → Connect Google Drive → authorize with your Google account</div></div>
        </div>
      </div>`;
  }
}

async function doConnectDrive(){
  const btn=$('connectDriveBtn');
  if(btn){btn.disabled=true;btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> Connecting…';}
  toast('Opening Google authorization…','info');
  const ok=await apiConnectDrive();
  if(ok){toast('Drive connected!','success');S.db=await apiFetchDB();showAdminTab('drives');}
  else{toast('Authorization was cancelled or failed','error');}
  if(btn){btn.disabled=false;btn.innerHTML='<i class="fab fa-google-drive"></i> Connect Google Drive';}
}

async function changeAdminPassword(){
  const p=$('newAdminPass')?.value;
  if(!p||p.length<4){toast('Password must be at least 4 characters','warning');return;}
  const r=await apiChangeAdminPassword(p);
  if(r.ok){toast('Password updated','success');$('newAdminPass').value='';}
  else toast(r.error||'Failed','error');
}

function showCreateUserDialog(){
  const username=prompt('Username:');if(!username?.trim())return;
  const password=prompt('Password:');if(!password)return;
  const drivesInput=prompt('Allowed drives (comma-separated emails, or leave blank for all):');
  let allowedDrives='all';
  if(drivesInput?.trim()){
    const emails=drivesInput.split(',').map(e=>e.trim());
    const ids=(S.db?.drives||[]).filter(d=>emails.includes(d.email)).map(d=>d.id);
    if(ids.length)allowedDrives=ids;
  }
  apiCreateUser(username.trim(),password,allowedDrives).then(async r=>{
    if(r.ok){toast(`User "${username}" created`,'success');S.db=await apiFetchDB();showAdminTab('users');}
    else toast(r.error||'Failed','error');
  });
}

function deleteUser(userId,username){
  if(!confirm(`Delete user "${username}"?`))return;
  apiDeleteUser(userId).then(async r=>{
    if(r.ok){toast('User deleted','success');S.db=await apiFetchDB();showAdminTab('users');}
    else toast(r.error||'Failed','error');
  });
}