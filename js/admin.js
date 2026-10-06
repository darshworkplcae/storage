// TeleDrive — Settings + Admin Pages

function renderSettingsPage(){
  const pc=$('pageContent');if(!pc)return;
  const db=S.db||{drives:[],files:[],users:[]};
  const drives=db.drives||[];
  const isAdmin=S.ses.role==='admin';
  pc.innerHTML=`<div class="inner-page">
    <div class="page-hd"><h2>Setting</h2><p>Manage account and connected storage.</p></div>

    ${isAdmin?`<div class="connect-cards">
      <div class="connect-card active">
        <div class="cc-info">
          <div class="cc-title"><i class="fab fa-google-drive"></i> Google Drive</div>
          <div class="cc-sub">Connect one or more Google Drive accounts. TeleDrive will route uploads to account with enough space.</div>
        </div>
        <button class="btn-primary" id="connectDriveBtn" onclick="doConnectDrive()"><i class="fab fa-google-drive"></i> Connect Drive</button>
      </div>
    </div>

    <div class="card">
      <div class="card-hd">
        <div>
          <div class="card-title"><i class="fas fa-plug"></i> Connected Storage Accounts</div>
          <div class="card-sub">Manage your connected Google Drive accounts</div>
        </div>
      </div>
      ${drives.length?`<div class="conn-list">${drives.map(d=>{
        const used=d.usedBytes||0,cap=d.capacity||0,free=Math.max(0,cap-used);
        const pct=cap?Math.min(100,Math.round(used/cap*100)):0;
        return`<div class="conn-item">
          <div class="conn-top">
            <div class="conn-avatar" style="background:${d.color}22;color:${d.color}">${(d.name||'?')[0].toUpperCase()}</div>
            <div class="conn-info"><div class="conn-name">${esc(d.name)}</div><div class="conn-email">${esc(d.email)} · connected</div></div>
            <div style="display:flex;gap:.5rem">
              <button class="btn-ghost sm" onclick="syncDrive('${esc(d.id)}')"><i class="fas fa-rotate"></i> Sync</button>
              <button class="btn-ghost sm danger" onclick="disconnectDrive('${esc(d.id)}')"><i class="fas fa-unlink"></i> Disconnect</button>
            </div>
          </div>
          <div class="conn-stats">
            <div class="conn-stat"><div class="conn-stat-val">${fmt(used)}</div><div class="conn-stat-lbl">Used</div></div>
            <div class="conn-stat"><div class="conn-stat-val">${cap?fmt(cap):'—'}</div><div class="conn-stat-lbl">Total</div></div>
            <div class="conn-stat"><div class="conn-stat-val">${fmt(free)}</div><div class="conn-stat-lbl">Free</div></div>
          </div>
          <div class="conn-quota-bar"><div class="conn-quota-fill" style="width:${pct}%;background:${d.color}"></div></div>
        </div>`;}).join('')}</div>`
      :`<div class="empty-state" style="min-height:180px"><div class="empty-icon"><i class="fab fa-google-drive"></i></div><h3>No drives connected yet</h3><p>Click "Connect Drive" above to add your Google Drive.</p></div>`}
    </div>`:''}

    ${isAdmin?`
    <div class="card">
      <div class="card-hd"><div class="card-title"><i class="fas fa-users"></i> Users</div><button class="btn-primary sm" onclick="showCreateUserDialog()"><i class="fas fa-user-plus"></i> Add User</button></div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Username</th><th>Access</th><th>Created</th><th></th></tr></thead>
        <tbody>${(db.users||[]).length?(db.users||[]).map(u=>`<tr>
          <td><i class="fas fa-user" style="color:var(--purple);margin-right:.4rem"></i>${esc(u.username)}</td>
          <td><span class="badge badge-blue">${u.allowedDrives==='all'?'All Drives':Array.isArray(u.allowedDrives)?u.allowedDrives.length+' drives':'All Drives'}</span></td>
          <td style="color:var(--text3)">${fmtDate(u.createdAt||'')}</td>
          <td><button class="icon-btn xs danger" onclick="deleteUser('${esc(u.id)}','${esc(u.username)}')"><i class="fas fa-trash-alt"></i></button></td>
        </tr>`).join(''):`<tr><td colspan="4" style="text-align:center;color:var(--text3);padding:1.5rem">No users yet. Add users so others can access TeleDrive.</td></tr>`}
        </tbody>
      </table></div>
    </div>

    <div class="card">
      <div class="card-hd"><div class="card-title"><i class="fas fa-key"></i> Admin Password</div></div>
      <div class="settings-row">
        <input class="inp" type="password" id="newAdminPass" placeholder="New password (min 4 characters)" style="max-width:280px">
        <button class="btn-primary" onclick="changeAdminPassword()"><i class="fas fa-save"></i> Update</button>
      </div>
    </div>

    <div class="card">
      <div class="card-hd"><div class="card-title"><i class="fas fa-circle-info"></i> Google Cloud Setup Guide</div></div>
      <div class="setup-list">
        <div class="setup-step"><span class="step-num">1</span><div><strong>Create a Google Cloud project</strong><br><a href="https://console.cloud.google.com/" target="_blank" style="color:var(--primary)">console.cloud.google.com</a> → New Project</div></div>
        <div class="setup-step"><span class="step-num">2</span><div><strong>Enable Google Drive API</strong><br>APIs & Services → Enable APIs → Search "Google Drive API" → Enable</div></div>
        <div class="setup-step"><span class="step-num">3</span><div><strong>Create OAuth 2.0 Credentials</strong><br>Credentials → Create Credentials → OAuth 2.0 Client ID → Web Application<br>Redirect URI: <code>https://tobichan.pages.dev/api/auth/callback</code></div></div>
        <div class="setup-step"><span class="step-num">4</span><div><strong>Set env vars in Cloudflare Pages → Settings → Variables</strong><br><code>GOOGLE_CLIENT_ID</code> · <code>GOOGLE_CLIENT_SECRET</code> · <code>ENCRYPTION_KEY</code> (any 32-char string) · <code>UPSTASH_URL</code> · <code>UPSTASH_TOKEN</code></div></div>
        <div class="setup-step"><span class="step-num">5</span><div><strong>Redeploy Cloudflare</strong><br>Cloudflare → Pages → tobichan → Deployments → latest → ··· → Retry deployment</div></div>
        <div class="setup-step"><span class="step-num">6</span><div><strong>Connect Drive</strong><br>Come back here → click "Connect Drive" → authorize with Google</div></div>
      </div>
    </div>`:''}
  </div>`;
}

async function doConnectDrive(){
  const btn=$('connectDriveBtn');
  if(btn){btn.disabled=true;btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> Opening…';}
  toast('Opening Google authorization…','info');
  const ok=await apiConnectDrive();
  if(ok){toast('✓ Drive connected!','success');S.db=await apiFetchDB();renderSidebarStorage();renderSettingsPage();}
  else toast('Authorization cancelled or failed','error');
  if(btn){btn.disabled=false;btn.innerHTML='<i class="fab fa-google-drive"></i> Connect Drive';}
}

async function syncDrive(driveId){
  toast('Sync in progress…','info');
  // Refresh quota from Google
  const r=await apiDriveQuota().catch(()=>null);
  if(r?.drives){
    r.drives.forEach(qd=>{const d=S.db?.drives?.find(x=>x.id===qd.id);if(d&&!qd.error){d.capacity=qd.capacity;d.usedBytes=qd.usedBytes;}});
    renderSidebarStorage();renderSettingsPage();toast('Synced!','success');
  }else toast('Sync failed','error');
}

async function disconnectDrive(driveId){
  if(!confirm('Disconnect this Google Drive?\nFiles already uploaded stay in Google Drive but won\'t appear here.'))return;
  const r=await apiDisconnectDrive(driveId);
  if(r.ok){toast('Drive disconnected','success');S.db=await apiFetchDB();renderSidebarStorage();renderSettingsPage();}
  else toast(r.error||'Failed','error');
}

async function changeAdminPassword(){
  const p=$('newAdminPass')?.value;
  if(!p||p.length<4){toast('Min 4 characters','warning');return;}
  const r=await apiChangeAdminPassword(p);
  if(r.ok){toast('✓ Password updated','success');$('newAdminPass').value='';}
  else toast(r.error||'Failed','error');
}

function showCreateUserDialog(){
  const username=prompt('Username:');if(!username?.trim())return;
  const password=prompt('Password:');if(!password)return;
  const drivesInput=prompt('Allowed drives (comma-separated emails, or leave blank for all):');
  let allowedDrives='all';
  if(drivesInput?.trim()){
    const emails=drivesInput.split(',').map(e=>e.trim());
    const ids=(S.db?.drives||[]).filter(d=>emails.some(e=>d.email.includes(e))).map(d=>d.id);
    if(ids.length)allowedDrives=ids;
  }
  apiCreateUser(username.trim(),password,allowedDrives).then(async r=>{
    if(r.ok){toast(`✓ User "${username}" created`,'success');S.db=await apiFetchDB();renderSettingsPage();}
    else toast(r.error||'Failed','error');
  });
}

function deleteUser(userId,username){
  if(!confirm(`Delete user "${username}"?`))return;
  apiDeleteUser(userId).then(async r=>{
    if(r.ok){toast('User deleted','success');S.db=await apiFetchDB();renderSettingsPage();}
    else toast(r.error||'Failed','error');
  });
}

function renderApiKeysPage(){
  $('pageContent').innerHTML=`<div class="inner-page">
    <div class="page-hd"><h2>API Keys</h2><p>Manage programmatic access to TeleDrive</p></div>
    <div class="card">
      <div class="card-hd"><div class="card-title"><i class="fas fa-key"></i> Your API Keys</div><button class="btn-primary sm"><i class="fas fa-plus"></i> New Key</button></div>
      <div class="empty-state" style="min-height:180px">
        <div class="empty-icon"><i class="fas fa-key"></i></div>
        <h3>No API keys yet</h3>
        <p>API access is coming soon</p>
      </div>
    </div>
  </div>`;
}