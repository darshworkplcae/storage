function renderSettingsPage() {
  if(S.ses.role !== 'admin') { renderAccessDenied(); return; }
  var pc=$('pageContent'); if(!pc) return;
  var db=S.db||{};
  var drives=(db.drives||[]);

  pc.innerHTML = [
    '<div class="inner-page">',
    '<div class="page-hd"><h2><i class="fas fa-gear"></i> Settings</h2><p>Manage storage and accounts</p></div>',

    // Connect Drive card
    '<div class="settings-section">',
    '<div class="sect-hd"><i class="fas fa-hard-drive" style="color:#4e86f5"></i><div><h3>Google Drive Storage</h3><p>Connect Google Drive accounts. Files route to the drive with most space.</p></div>',
    '<button class="btn-primary" onclick="connectDrive()"><i class="fas fa-plug"></i> Connect Drive</button></div>',
    '</div>',

    // Connected drives
    '<div class="settings-section">',
    '<h3 class="sect-title"><i class="fas fa-database"></i> Connected Drives</h3>',
    drives.length===0
      ? '<div class="empty-small"><i class="fas fa-hard-drive"></i><p>No drives connected yet</p></div>'
      : '<div class="drives-grid">' + drives.map(function(d){
          var used = d.usedBytes || 0;
          var cap = d.capacity || 0;
          var free = Math.max(0, cap - used);
          var usedPct = cap > 0 ? Math.min(100, Math.round(used / cap * 100)) : 0;
          var isOpen = (db.openDriveId === d.id || d.isOpenDrive);
          return '<div class="drive-card '+(isOpen?'open-drive-card':'')+'">' +
            '<div class="dc-top">' +
              '<div class="dc-icon" style="background:'+d.color+'22;color:'+d.color+'"><i class="fas fa-hard-drive"></i></div>' +
              '<div class="dc-info">' +
                '<div class="dc-name" style="display:flex;align-items:center;gap:6px">' +
                  esc(d.name) + (isOpen?'<span class="badge-open">Open Drive</span>':'') +
                '</div>' +
                '<div class="dc-email">'+esc(d.email)+'</div>' +
              '</div>' +
              '<div style="display:flex;gap:4px">' +
                '<button class="icon-btn danger sm" onclick="disconnectDrive(\''+d.id+'\')" title="Disconnect"><i class="fas fa-unlink"></i></button>' +
              '</div>' +
            '</div>' +
            '<div class="dc-bar"><div class="dc-fill" style="width:'+usedPct+'%;background:'+d.color+'"></div></div>' +
            '<div class="dc-usage">'+fmt(used)+' / '+fmt(cap)+' ('+usedPct+'%) · <span style="color:#30d158;font-weight:600">'+fmt(free)+' free</span></div>' +
            '<div style="margin-top:.6rem;display:flex;gap:6px">' +
              '<button class="btn-ghost xs" style="flex:1" onclick="promptRenameDrive(\''+d.id+'\',\''+esc(d.name).replace(/'/g,"\\'")+'\')"><i class="fas fa-pen"></i> Rename</button>' +
              '<button class="btn-ghost xs" style="flex:1" onclick="toggleOpenDrive(\''+d.id+'\')"><i class="fas fa-users"></i> '+(isOpen?'Disable Open':'Make Open')+'</button>' +
            '</div>' +
          '</div>';
        }).join('') + '</div>',
    '</div>',

    // Users management
    '<div class="settings-section">',
    '<div class="sect-hd"><i class="fas fa-users" style="color:#30d158"></i><div><h3>User Management</h3><p>Create sub-accounts to share access.</p></div>',
    '<button class="btn-primary" onclick="showAddUser()"><i class="fas fa-user-plus"></i> Add User</button></div>',

    // Add user form (hidden by default)
    '<div id="addUserForm" class="add-user-form hidden">',
    '<input class="inp" id="newUsername" type="text" placeholder="Username">',
    '<input class="inp" id="newPassword" type="password" placeholder="Password">',
    '<select class="inp" id="newDriveAccess">',
    '<option value="all">All Drives</option>',
    drives.map(function(d){ return '<option value="'+d.id+'">'+esc(d.name)+' only</option>'; }).join(''),
    '</select>',
    '<div style="display:flex;gap:.5rem"><button class="btn-primary" onclick="submitAddUser()"><i class="fas fa-check"></i> Create</button><button class="btn-ghost" onclick="$(\'addUserForm\').classList.add(\'hidden\')">Cancel</button></div>',
    '</div>',

    // Users table
    '<div class="users-table-wrap">',
    (db.users&&db.users.length>0) ? [
      '<table class="users-table">',
      '<thead><tr><th>Username</th><th>Access</th><th>Created</th><th></th></tr></thead>',
      '<tbody>',
      db.users.map(function(u){
        return '<tr><td><i class="fas fa-user" style="color:#64d2ff;margin-right:.4rem"></i>'+esc(u.username)+'</td><td>'+esc(u.allowedDrives==='all'?'All Drives':u.allowedDrives)+'</td><td>'+fmtDate(u.createdAt)+'</td><td><button class="icon-btn danger sm" onclick="deleteUser(\''+u.id+'\',\''+esc(u.username)+'\')"><i class="fas fa-trash"></i></button></td></tr>';
      }).join(''),
      '</tbody></table>'
    ].join('') : '<div class="empty-small"><i class="fas fa-users"></i><p>No users yet. Add users above.</p></div>',
    '</div>',
    '</div>',

    // User & Guest Permissions Policy (Download / Delete Controls)
    '<div class="settings-section">',
    '<div class="sect-hd"><i class="fas fa-user-shield" style="color:#bf5af2"></i><div><h3>User & Guest Permissions Policy</h3><p>Control what actions Guests and Private Users are allowed to perform across all drives.</p></div></div>',
    '<div class="policy-controls-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1rem;margin-top:1rem">',
      '<div class="policy-card" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:1.1rem;display:flex;align-items:center;justify-content:space-between">',
        '<div>',
          '<div style="font-weight:600;font-size:.9rem;color:var(--text1);display:flex;align-items:center;gap:8px"><i class="fas fa-download" style="color:var(--primary)"></i> Allow File Downloads</div>',
          '<div style="font-size:.78rem;color:var(--text3);margin-top:3px">If disabled, non-admins cannot download files or view download buttons.</div>',
        '</div>',
        '<label class="switch-toggle" style="margin-left:12px;flex-shrink:0"><input type="checkbox" id="policyAllowDownload" '+(db.policy&&db.policy.allowUserDownload===false?'':'checked')+' onchange="updateAdminPolicy()"><span class="slider round"></span></label>',
      '</div>',
      '<div class="policy-card" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:1.1rem;display:flex;align-items:center;justify-content:space-between">',
        '<div>',
          '<div style="font-weight:600;font-size:.9rem;color:var(--text1);display:flex;align-items:center;gap:8px"><i class="fas fa-trash-alt" style="color:var(--danger)"></i> Allow File & Folder Deletions</div>',
          '<div style="font-size:.78rem;color:var(--text3);margin-top:3px">If disabled, non-admins cannot delete files or move them to Recycle Bin.</div>',
        '</div>',
        '<label class="switch-toggle" style="margin-left:12px;flex-shrink:0"><input type="checkbox" id="policyAllowDelete" '+(db.policy&&db.policy.allowUserDelete===false?'':'checked')+' onchange="updateAdminPolicy()"><span class="slider round"></span></label>',
      '</div>',
      '<div class="policy-card" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:1.1rem;display:flex;align-items:center;justify-content:space-between">',
        '<div>',
          '<div style="font-weight:600;font-size:.9rem;color:var(--text1);display:flex;align-items:center;gap:8px"><i class="fas fa-pen" style="color:#ff9f0a"></i> Allow File & Folder Renaming</div>',
          '<div style="font-size:.78rem;color:var(--text3);margin-top:3px">If disabled, non-admins cannot rename files or folders; only administrators can rename.</div>',
        '</div>',
        '<label class="switch-toggle" style="margin-left:12px;flex-shrink:0"><input type="checkbox" id="policyAllowRename" '+(db.policy&&db.policy.allowUserRename===false?'':'checked')+' onchange="updateAdminPolicy()"><span class="slider round"></span></label>',
      '</div>',
    '</div>',
    '</div>',

    // Folder Privacy & Visibility Manager
    '<div class="settings-section">',
    '<div class="sect-hd"><i class="fas fa-eye-slash" style="color:#00e5ff"></i><div><h3>Folder Privacy & Visibility Control</h3><p>Manage which folders are hidden from guests and regular users, set Admin-Only exclusivity, or delegate folder access to specific user accounts.</p></div>',
    '<button class="btn-ghost sm" onclick="loadAdminFolderVisibility()"><i class="fas fa-rotate"></i> Refresh</button></div>',
    '<div id="folderVisibilityContainer" style="margin-top:1rem"><div class="empty-small"><i class="fas fa-spinner fa-spin"></i><p>Loading folder visibility settings…</p></div></div>',
    '</div>',

    // Folder Security & Password Recovery (Admin recovery for encrypted folders)
    '<div class="settings-section">',
    '<div class="sect-hd"><i class="fas fa-lock" style="color:#ffd700"></i><div><h3>Folder Security & Password Recovery</h3><p>View and manage encrypted folders created by Private Users and Guests. Passwords can be decoded and recovered here.</p></div>',
    '<button class="btn-ghost sm" onclick="loadAdminLockedFolders()"><i class="fas fa-rotate"></i> Refresh</button></div>',
    '<div id="lockedFoldersContainer" style="margin-top:1rem"><div class="empty-small"><i class="fas fa-spinner fa-spin"></i><p>Loading encrypted folders…</p></div></div>',
    '</div>',

    // Destroyed Vault Folders (Security Breach Recovery)
    '<div class="settings-section">',
    '<div class="sect-hd"><i class="fas fa-skull-crossbones" style="color:var(--danger)"></i><div><h3>Destroyed Vault Folders (5 Failed Password Attempts)</h3><p>Folders automatically destroyed after 5 failed password attempts. Regular users see these as permanently wiped. As Admin, you can recover them exclusively to the Admin view.</p></div>',
    '<button class="btn-ghost sm" onclick="loadAdminDestroyedFolders()"><i class="fas fa-rotate"></i> Refresh</button></div>',
    '<div id="destroyedFoldersContainer" style="margin-top:1rem"><div class="empty-small"><i class="fas fa-spinner fa-spin"></i><p>Loading destroyed folders…</p></div></div>',
    '</div>',

    // Change admin password
    '<div class="settings-section">',
    '<h3 class="sect-title"><i class="fas fa-shield-halved"></i> Admin Password</h3>',
    '<div class="pass-form">',
    '<input class="inp" id="newAdminPass" type="password" placeholder="New password (min 4 chars)">',
    '<input class="inp" id="confAdminPass" type="password" placeholder="Confirm password">',
    '<button class="btn-primary" onclick="changeAdminPass()"><i class="fas fa-key"></i> Update Password</button>',
    '</div>',
    '</div>',

    // Google OAuth note
    '<div class="settings-section info-box">',
    '<h3 class="sect-title"><i class="fas fa-circle-info" style="color:#64d2ff"></i> Google OAuth Note</h3>',
    '<p>Your app is in <strong>Testing mode</strong> (External). You can add up to 100 test users at <a href="https://console.cloud.google.com/apis/credentials/consent" target="_blank" style="color:var(--primary)">Google Console → OAuth Consent Screen → Test Users</a>.</p>',
    '<p style="margin-top:.5rem;color:var(--text2)">You cannot use "Internal" because that requires Google Workspace (paid G Suite). For public access, you would need to submit the app for Google verification.</p>',
    '</div>',

    '</div>'
  ].join('');

  loadAdminFolderVisibility();
  loadAdminLockedFolders();
  loadAdminDestroyedFolders();
}

async function loadAdminFolderVisibility() {
  var el = $('folderVisibilityContainer');
  if (!el) return;
  var db = S.db || {};
  var folders = (db.folders || []).filter(function(f){ return !f.destroyed && !f.trashed; });
  if (!folders.length) {
    el.innerHTML = '<div class="empty-small"><i class="fas fa-folder-open" style="color:var(--text3)"></i><p>No active folders found.</p></div>';
    return;
  }

  // Build tree hierarchy
  var folderMap = new Map();
  var childrenMap = new Map();
  folders.forEach(function(f) {
    folderMap.set(f.id, f);
    if (!childrenMap.has(f.parentId || null)) childrenMap.set(f.parentId || null, []);
  });
  folders.forEach(function(f) {
    var pid = f.parentId || null;
    if (!childrenMap.has(pid)) childrenMap.set(pid, []);
    childrenMap.get(pid).push(f);
  });

  // Identify root folders (no parent or parent not in active folders)
  var rootFolders = folders.filter(function(f) {
    return !f.parentId || !folderMap.has(f.parentId);
  });

  function renderFolderRow(f, level) {
    var drv = (db.drives || []).find(function(d){ return d.id === f.driveId; });
    var isAdm = !!f.adminOnly;
    var hasSpecific = Array.isArray(f.allowedUsers) && f.allowedUsers.length > 0;
    var statusBadge = isAdm
      ? '<span class="badge" style="background:rgba(255,69,58,0.18);color:#ff453a;border:1px solid rgba(255,69,58,0.3)"><i class="fas fa-user-secret"></i> Admin Only</span>'
      : hasSpecific
      ? '<span class="badge" style="background:rgba(191,90,242,0.18);color:#bf5af2;border:1px solid rgba(191,90,242,0.3)"><i class="fas fa-user-lock"></i> Restricted</span>'
      : '<span class="badge" style="background:rgba(48,209,88,0.18);color:#30d158;border:1px solid rgba(48,209,88,0.3)"><i class="fas fa-globe"></i> Public</span>';

    var audienceTxt = isAdm
      ? '<span style="color:#ff453a;font-size:.78rem;font-weight:600">Hidden from all users & guests</span>'
      : hasSpecific
      ? '<span style="color:#bf5af2;font-size:.78rem;font-weight:600">' + f.allowedUsers.length + ' specific user(s)</span>'
      : '<span style="color:var(--text3);font-size:.78rem">All drive visitors</span>';

    var children = childrenMap.get(f.id) || [];
    var hasChildren = children.length > 0;
    var isSub = level > 0;

    var toggleBtn = hasChildren
      ? '<button class="icon-btn xs" onclick="toggleAdminFolderTree(\'' + f.id + '\')" title="Expand/Collapse Subfolders" style="margin-right:4px;color:var(--primary);cursor:pointer"><i class="fas fa-chevron-right" id="visTreeIco_' + f.id + '"></i></button>'
      : '<span style="display:inline-block;width:24px"></span>';

    var subBadge = hasChildren
      ? '<span class="badge sm" onclick="toggleAdminFolderTree(\'' + f.id + '\')" style="cursor:pointer;background:rgba(78,134,245,0.15);color:var(--primary);margin-left:8px;font-size:.7rem;padding:1px 6px;border-radius:10px" title="Click arrow to expand ' + children.length + ' subfolder(s)"><i class="fas fa-folder-tree"></i> ' + children.length + '</span>'
      : '';

    var indent = isSub
      ? '<span style="display:inline-block;width:' + (level * 22) + 'px"></span><i class="fas fa-turn-up fa-rotate-90" style="color:var(--text3);margin-right:6px;font-size:.75rem"></i>'
      : '';

    var rowClass = isSub ? 'vis-subfolder-row vis-child-of-' + f.parentId + ' hidden' : 'vis-root-row';

    var html = '<tr class="' + rowClass + '" id="visRow_' + f.id + '" data-folder-id="' + f.id + '" data-parent-id="' + (f.parentId || '') + '" data-name="' + esc(f.name).toLowerCase() + '">' +
      '<td>' +
        '<div style="display:flex;align-items:center">' +
          indent +
          toggleBtn +
          '<i class="fas ' + (hasChildren ? 'fa-folder-tree' : 'fa-folder') + '" style="color:' + (isAdm ? '#ff453a' : '#ff9f0a') + ';margin-right:6px"></i>' +
          '<strong style="font-size:.88rem">' + esc(f.name) + '</strong>' +
          subBadge +
        '</div>' +
      '</td>' +
      '<td>' + esc(drv ? drv.name : 'Unknown Drive') + '</td>' +
      '<td>' + statusBadge + '</td>' +
      '<td>' + audienceTxt + '</td>' +
      '<td>' +
        '<button class="btn-ghost xs" onclick="showFolderVisibilityDialog(\'' + f.id + '\')" title="Edit Visibility"><i class="fas fa-sliders"></i> Change</button>' +
      '</td>' +
    '</tr>';

    if (hasChildren) {
      children.forEach(function(child) {
        html += renderFolderRow(child, level + 1);
      });
    }

    return html;
  }

  var tableHtml = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.8rem;gap:10px;flex-wrap:wrap">' +
    '<div style="display:flex;align-items:center;gap:8px">' +
      '<input type="text" class="inp" id="folderVisSearch" placeholder="Filter folders by name…" style="max-width:240px;padding:.32rem .65rem;font-size:.82rem" oninput="filterAdminFolderVisTable(this.value)">' +
      '<span style="font-size:.78rem;color:var(--text3)">' + rootFolders.length + ' root folders (' + folders.length + ' total)</span>' +
    '</div>' +
    '<div style="display:flex;gap:6px">' +
      '<button class="btn-ghost xs" onclick="toggleAllAdminFolderVis(true)"><i class="fas fa-angles-down"></i> Expand All</button>' +
      '<button class="btn-ghost xs" onclick="toggleAllAdminFolderVis(false)"><i class="fas fa-angles-up"></i> Collapse All</button>' +
    '</div>' +
  '</div>' +
  '<table class="users-table" style="margin-bottom:1rem">' +
    '<thead><tr><th>Folder (Click arrow to expand)</th><th>Drive</th><th>Visibility Status</th><th>Target Audience</th><th>Actions</th></tr></thead>' +
    '<tbody>' +
      rootFolders.map(function(f){ return renderFolderRow(f, 0); }).join('') +
    '</tbody>' +
  '</table>';

  el.innerHTML = tableHtml;
}

function toggleAdminFolderTree(folderId) {
  var ico = $('visTreeIco_' + folderId);
  var isExpanded = ico && ico.classList.contains('fa-chevron-down');
  var childRows = document.querySelectorAll('.vis-child-of-' + folderId);

  if (isExpanded) {
    if (ico) {
      ico.classList.remove('fa-chevron-down');
      ico.classList.add('fa-chevron-right');
    }
    // Collapse all descendants recursively
    function hideDescendants(pId) {
      var rows = document.querySelectorAll('.vis-child-of-' + pId);
      rows.forEach(function(r) {
        r.classList.add('hidden');
        var subIco = r.querySelector('[id^="visTreeIco_"]');
        if (subIco) {
          subIco.classList.remove('fa-chevron-down');
          subIco.classList.add('fa-chevron-right');
        }
        var subId = r.getAttribute('data-folder-id');
        if (subId) hideDescendants(subId);
      });
    }
    hideDescendants(folderId);
  } else {
    if (ico) {
      ico.classList.remove('fa-chevron-right');
      ico.classList.add('fa-chevron-down');
    }
    childRows.forEach(function(r) {
      r.classList.remove('hidden');
    });
  }
}

function toggleAllAdminFolderVis(expand) {
  var allSubRows = document.querySelectorAll('.vis-subfolder-row');
  allSubRows.forEach(function(r) {
    r.classList.toggle('hidden', !expand);
  });
  document.querySelectorAll('[id^="visTreeIco_"]').forEach(function(ico) {
    ico.className = expand ? 'fas fa-chevron-down' : 'fas fa-chevron-right';
  });
}

function filterAdminFolderVisTable(query) {
  var q = (query || '').toLowerCase().trim();
  var allRows = document.querySelectorAll('#folderVisibilityContainer tbody tr');
  if (!q) {
    // Reset to default collapsed state
    toggleAllAdminFolderVis(false);
    return;
  }
  allRows.forEach(function(r) {
    var name = r.getAttribute('data-name') || '';
    var matches = name.includes(q);
    r.classList.toggle('hidden', !matches);
  });
}

async function loadAdminLockedFolders() {
  var el = $('lockedFoldersContainer');
  if(!el) return;
  el.innerHTML = '<div class="empty-small"><i class="fas fa-spinner fa-spin"></i><p>Loading encrypted folders…</p></div>';
  var res = await apiGetAdminLockedFolders();
  if(!res || !res.folders || res.folders.length === 0){
    el.innerHTML = '<div class="empty-small"><i class="fas fa-lock-open" style="color:var(--text3)"></i><p>No locked folders found across any drive.</p></div>';
    return;
  }

  var userFolders = res.folders.filter(function(f){ return f.lockedRole !== 'guest'; });
  var guestFolders = res.folders.filter(function(f){ return f.lockedRole === 'guest'; });

  function renderTable(list, typeLabel) {
    if(!list.length) return '<div style="padding:1rem;color:var(--text3);font-size:.82rem;font-style:italic">No '+typeLabel+' locked folders.</div>';
    return '<table class="users-table" style="margin-bottom:1rem">' +
      '<thead><tr><th>Folder</th><th>Drive</th><th>Locked By</th><th>Locked Date</th><th>Plain Password</th><th>Action</th></tr></thead>' +
      '<tbody>' + list.map(function(f, idx){
        var inputId = 'lfp_' + f.id + '_' + idx;
        return '<tr>' +
          '<td><strong style="display:flex;align-items:center;gap:6px"><i class="fas fa-folder" style="color:#ffd700"></i> ' + esc(f.name) + '</strong></td>' +
          '<td>' + esc(f.driveName) + '</td>' +
          '<td><span class="badge ' + (f.lockedRole==='guest'?'badge-guest':'badge-user') + '">' + esc(f.lockedBy) + '</span></td>' +
          '<td>' + fmtDate(f.lockedAt) + '</td>' +
          '<td>' +
            '<div style="display:flex;align-items:center;gap:6px">' +
              '<input type="password" id="' + inputId + '" value="' + esc(f.plainPassword) + '" readonly class="inp xs" style="width:110px;font-family:monospace;background:rgba(255,255,255,0.06);border-color:transparent">' +
              '<button class="icon-btn xs" onclick="var el=document.getElementById(\'' + inputId + '\');el.type=el.type===\'password\'?\'text\':\'password\';this.innerHTML=\'<i class=\\\'fas fa-\'+(el.type===\'password\'?\'eye\':\'eye-slash\')+\'\\\'></i>\';" title="Reveal Password"><i class="fas fa-eye"></i></button>' +
              '<button class="icon-btn xs" onclick="navigator.clipboard.writeText(\'' + esc(f.plainPassword).replace(/'/g,"\\'") + '\');toast(\'Password copied!\',\'success\');" title="Copy Password"><i class="fas fa-copy"></i></button>' +
            '</div>' +
          '</td>' +
          '<td>' +
            '<button class="btn-ghost xs danger" onclick="adminRemoveFolderLock(\'' + f.id + '\',\'' + esc(f.name).replace(/'/g,"\\'") + '\')" title="Remove Lock"><i class="fas fa-lock-open"></i> Unlock</button>' +
          '</td>' +
        '</tr>';
      }).join('') +
      '</tbody></table>';
  }

  el.innerHTML = [
    '<div class="locked-folders-wrap">',
    '<h4 style="margin:.8rem 0 .4rem;font-size:.86rem;color:var(--primary);display:flex;align-items:center;gap:6px"><i class="fas fa-user-shield"></i> Private User Folders (' + userFolders.length + ')</h4>',
    renderTable(userFolders, 'private user'),
    '<h4 style="margin:1.2rem 0 .4rem;font-size:.86rem;color:#ff9f0a;display:flex;align-items:center;gap:6px"><i class="fas fa-users"></i> Guest / Public Trip Folders (' + guestFolders.length + ')</h4>',
    renderTable(guestFolders, 'guest'),
    '</div>'
  ].join('');
}

async function adminRemoveFolderLock(folderId, folderName) {
  if(!confirm('Permanently remove password lock from "' + folderName + '"?')) return;
  toast('Removing password…', 'info');
  var res = await apiRemoveFolderLock(folderId, '');
  if(res && res.ok){
    toast('Folder unlocked successfully!', 'success');
    S.db = await apiFetchDB();
    loadAdminLockedFolders();
  } else {
    toast(res ? (res.error || 'Failed') : 'Error', 'error');
  }
}

function renderApiKeysPage() {
  if(S.ses.role !== 'admin') { renderAccessDenied(); return; }
  var pc=$('pageContent'); if(!pc) return;
  pc.innerHTML = '<div class="inner-page"><div class="page-hd"><h2><i class="fas fa-key"></i> API Keys</h2><p>Manage API access keys</p></div><div class="empty-state"><div class="empty-icon"><i class="fas fa-key" style="color:#ff9f0a"></i></div><h3>Coming soon</h3><p>API key management will be available in a future update.</p></div></div>';
}

function renderAccessDenied() {
  var pc=$('pageContent'); if(!pc) return;
  pc.innerHTML='<div class="empty-state"><div class="empty-icon"><i class="fas fa-lock" style="color:var(--danger)"></i></div><h3>Admin access required</h3><p>Please sign in as admin to view this page.</p><button class="btn-primary" onclick="showSignInAdmin()"><i class="fas fa-shield-halved"></i> Admin Login</button></div>';
}

async function connectDrive() {
  toast('Opening Google authorization…', 'info');
  var ok = await apiConnectDrive();
  if(ok) {
    S.db = await apiFetchDB();
    renderSettingsPage();
    renderSidebarStorage();
    toast('Drive connected!', 'success');
  } else { toast('Authorization cancelled or failed', 'error'); }
}

async function disconnectDrive(id) {
  if(!confirm('Disconnect this drive? Files already uploaded will remain in Google Drive.')) return;
  var r = await apiDisconnect(id);
  if(r.ok) { S.db=await apiFetchDB(); renderSettingsPage(); renderSidebarStorage(); toast('Drive disconnected','success'); }
  else toast(r.error||'Failed','error');
}

function showAddUser() {
  var f=$('addUserForm'); if(f) f.classList.toggle('hidden');
}

async function submitAddUser() {
  var u=$('newUsername'), p=$('newPassword'), d=$('newDriveAccess');
  if(!u||!p) return;
  var username=u.value.trim(), password=p.value.trim(), driveAccess=d?d.value:'all';
  if(!username||!password){toast('Username and password required','warning');return;}
  if(password.length<4){toast('Password must be at least 4 chars','warning');return;}
  var r=await apiCreateUser(username,password,driveAccess);
  if(r.ok){
    toast('User "'+username+'" created','success');
    u.value='';p.value='';
    S.db=await apiFetchDB();
    renderSettingsPage();
  } else toast(r.error||'Failed to create user','error');
}

async function deleteUser(id, name) {
  if(!confirm('Delete user "'+name+'"? They will be logged out.')) return;
  var r=await apiDeleteUser(id);
  if(r.ok){toast('User deleted','success');S.db=await apiFetchDB();renderSettingsPage();}
  else toast(r.error||'Failed','error');
}

async function changeAdminPass() {
  var np=$('newAdminPass'), cp=$('confAdminPass');
  if(!np||!cp) return;
  if(np.value!==cp.value){toast('Passwords do not match','error');return;}
  if(np.value.length<4){toast('Min 4 characters','warning');return;}
  var r=await apiChangeAdminPass(np.value);
  if(r.ok){toast('Password updated! Please log in again.','success');doLogout();}
  else toast(r.error||'Failed','error');
}

async function toggleOpenDrive(id) {
  var db = S.db || {};
  db.openDriveId = (db.openDriveId === id) ? null : id;
  (db.drives || []).forEach(function(d){ d.isOpenDrive = (d.id === db.openDriveId); });
  var r = await apiFetch('admin/open-drive', { method: 'POST', body: JSON.stringify({ openDriveId: db.openDriveId }) });
  if (r.ok) {
    toast(db.openDriveId ? 'Open Drive enabled for friends!' : 'Open Drive disabled', 'success');
    S.db = await apiFetchDB();
    renderSettingsPage();
  } else {
    toast(r.error || 'Failed to update open drive', 'error');
  }
}

async function promptRenameDrive(driveId, currentName) {
  var newName = prompt('Enter new display name for this drive (friends will see this name):', currentName);
  if (!newName || !newName.trim() || newName.trim() === currentName) return;
  toast('Updating drive name…', 'info');
  var res = await apiRenameDrive(driveId, newName.trim());
  if (res && res.ok) {
    toast('Drive renamed to: ' + res.name, 'success');
    S.db = await apiFetchDB();
    renderSettingsPage();
    renderSidebarStorage();
  } else {
    toast(res ? (res.error || 'Failed to rename drive') : 'Network error', 'error');
  }
}

async function updateAdminPolicy() {
  var dlCh = $('policyAllowDownload');
  var delCh = $('policyAllowDelete');
  var renCh = $('policyAllowRename');
  var policy = {
    allowUserDownload: dlCh ? dlCh.checked : true,
    allowUserDelete: delCh ? delCh.checked : true,
    allowUserRename: renCh ? renCh.checked : true
  };
  toast('Updating permissions policy…', 'info');
  var res = await apiSetPolicy(policy);
  if (res && res.ok) {
    if (!S.db) S.db = {};
    S.db.policy = res.policy;
    toast('Permissions policy updated successfully!', 'success');
  } else {
    toast(res ? (res.error || 'Failed to update policy') : 'Network error', 'error');
  }
}

async function promptRenameFile(fileId, currentName) {
  var newName = prompt('Enter new file name:', currentName);
  if (!newName || !newName.trim() || newName.trim() === currentName) return;
  toast('Renaming file…', 'info');
  var res = await apiRenameFile(fileId, newName.trim());
  if (res && res.ok) {
    toast('File renamed to: ' + res.file.name, 'success');
    S.db = await apiFetchDB();
    if (typeof _curPage !== 'undefined' && _curPage === 'recent') renderRecentPage();
    else if (typeof _curPage !== 'undefined' && _curPage === 'starred') renderStarredPage();
    else if (typeof _driveId !== 'undefined' && _driveId) renderFilesPage(_driveId, _folderId);
  } else {
    toast(res ? (res.error || 'Failed to rename file') : 'Network error', 'error');
  }
}

async function promptRenameFolder(folderId, currentName) {
  var newName = prompt('Enter new folder name:', currentName);
  if (!newName || !newName.trim() || newName.trim() === currentName) return;
  toast('Renaming folder…', 'info');
  var res = await apiRenameFolder(folderId, newName.trim());
  if (res && res.ok) {
    toast('Folder renamed to: ' + res.folder.name, 'success');
    S.db = await apiFetchDB();
    if (typeof _driveId !== 'undefined' && _driveId) renderFilesPage(_driveId, _folderId);
  } else {
    toast(res ? (res.error || 'Failed to rename folder') : 'Network error', 'error');
  }
}

async function loadAdminDestroyedFolders() {
  var el = $('destroyedFoldersContainer');
  if (!el) return;
  el.innerHTML = '<div class="empty-small"><i class="fas fa-spinner fa-spin"></i><p>Loading destroyed folders…</p></div>';
  var res = await apiGetDestroyedFolders();
  if (!res || !res.folders || res.folders.length === 0) {
    el.innerHTML = '<div class="empty-small"><i class="fas fa-shield-check" style="color:var(--success)"></i><p>No destroyed folders! No security breaches recorded.</p></div>';
    return;
  }

  el.innerHTML = '<table class="users-table" style="margin-bottom:1rem">' +
    '<thead><tr><th>Destroyed Folder</th><th>Drive</th><th>Locked By</th><th>Destroyed Date</th><th>Plain Password</th><th>Action</th></tr></thead>' +
    '<tbody>' + res.folders.map(function(f, idx){
      var inputId = 'dfp_' + f.id + '_' + idx;
      return '<tr>' +
        '<td><strong style="display:flex;align-items:center;gap:6px;color:#ff453a"><i class="fas fa-skull"></i> ' + esc(f.name) + '</strong><span style="font-size:.72rem;color:var(--text3)">' + esc(f.destroyedReason) + '</span></td>' +
        '<td>' + esc(f.driveName) + '</td>' +
        '<td><span class="badge badge-guest">' + esc(f.lockedBy) + '</span></td>' +
        '<td>' + fmtDate(f.destroyedAt) + '</td>' +
        '<td>' +
          '<div style="display:flex;align-items:center;gap:6px">' +
            '<input type="password" id="' + inputId + '" value="' + esc(f.plainPassword) + '" readonly class="inp xs" style="width:110px;font-family:monospace;background:rgba(255,255,255,0.06);border-color:transparent">' +
            '<button class="icon-btn xs" onclick="var el=document.getElementById(\'' + inputId + '\');el.type=el.type===\'password\'?\'text\':\'password\';this.innerHTML=\'<i class=\\\'fas fa-\'+(el.type===\'password\'?\'eye\':\'eye-slash\')+\'\\\'></i>\';" title="Reveal Password"><i class="fas fa-eye"></i></button>' +
            '<button class="icon-btn xs" onclick="navigator.clipboard.writeText(\'' + esc(f.plainPassword).replace(/'/g,"\\'") + '\');toast(\'Password copied!\',\'success\');" title="Copy Password"><i class="fas fa-copy"></i></button>' +
          '</div>' +
        '</td>' +
        '<td>' +
          '<button class="btn-primary xs" style="background:linear-gradient(135deg,var(--primary),#7928ca)" onclick="adminRecoverFolder(\'' + f.id + '\',\'' + esc(f.name).replace(/'/g,"\\'") + '\')" title="Recover folder to Admin View"><i class="fas fa-rotate-left"></i> Recover Folder</button>' +
        '</td>' +
      '</tr>';
    }).join('') +
    '</tbody></table>';
}

async function adminRecoverFolder(folderId, folderName) {
  if (!confirm('Recover folder "' + folderName + '"? It will be restored into the drive exclusively in Admin View (never visible to guests).')) return;
  toast('Recovering folder…', 'info');
  var res = await apiRecoverFolder(folderId);
  if (res && res.ok) {
    toast('Folder "' + folderName + '" recovered to Admin View!', 'success');
    S.db = await apiFetchDB();
    loadAdminDestroyedFolders();
    loadAdminLockedFolders();
    renderSidebarStorage();
  } else {
    toast(res ? (res.error || 'Recovery failed') : 'Network error', 'error');
  }
}