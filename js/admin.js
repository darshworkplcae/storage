function renderSettingsPage() {
  if(S.ses.role !== 'admin') { renderAccessDenied(); return; }
  var pc=$('pageContent'); if(!pc) return;
  var db=S.db||{};
  var drives=(db.drives||[]);
  var policy = Object.assign({
    allowUserDownload: true,
    allowUserDelete: true,
    allowUserRename: true,
    folderLockoutEnabled: true
  }, (db && db.policy) || {});
  try {
    var rawPol = localStorage.getItem('td_policy');
    if (rawPol) {
      var parsedPol = JSON.parse(rawPol);
      Object.assign(policy, parsedPol);
    }
  } catch(e){}

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
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;flex-wrap:wrap;gap:8px"><h3 class="sect-title" style="margin-bottom:0"><i class="fas fa-database"></i> Connected Drives</h3><button class="btn-ghost sm" onclick="scanDriveFiles(\'all\')" title="Scan all connected Google Drives for any new folders and files"><i class="fas fa-rotate"></i> Sync All Drives</button></div>',
    drives.length===0
      ? '<div class="empty-small"><i class="fas fa-hard-drive"></i><p>No drives connected yet</p></div>'
      : '<div class="drives-grid">' + drives.map(function(d){
          var used = d.usedBytes || 0;
          var cap = d.capacity || 0;
          var free = Math.max(0, cap - used);
          var usedPct = cap > 0 ? Math.min(100, Math.round(used / cap * 100)) : 0;
          var isOpen = typeof isDriveOpen === 'function' ? isDriveOpen(d.id, db) : (d.isOpenDrive || db.openDriveId === d.id);
          return '<div class="drive-card '+(isOpen?'open-drive-card':'')+'">' +
            '<div class="dc-top">' +
              '<div class="dc-icon" style="background:'+d.color+'22;color:'+d.color+'"><i class="fas fa-hard-drive"></i></div>' +
              '<div class="dc-info">' +
               '<div class="dc-name">' +
                  '<span class="dc-name-text">' + esc(d.name) + '</span>' + (isOpen?'<span class="badge-open">Open Drive</span>':'') + (d.hasPassword?'<span class="badge-open" style="background:rgba(255,159,10,0.15);color:#ff9f0a;border-color:rgba(255,159,10,0.35)"><i class="fas fa-lock"></i> Protected</span>':'') +
                '</div>' +
                '<div class="dc-email">'+esc(d.email)+'</div>' +
              '</div>' +
              '<div style="display:flex;gap:4px">' +
                '<button class="icon-btn danger sm" onclick="disconnectDrive(\''+d.id+'\')" title="Disconnect"><i class="fas fa-unlink"></i></button>' +
              '</div>' +
            '</div>' +
            '<div class="dc-bar"><div class="dc-fill" style="width:'+usedPct+'%;background:'+d.color+'"></div></div>' +
            '<div class="dc-usage">'+fmt(used)+' / '+fmt(cap)+' ('+usedPct+'%) · <span style="color:#30d158;font-weight:600">'+fmt(free)+' free</span></div>' +
            '<div style="margin-top:.6rem;display:flex;gap:6px;flex-wrap:wrap">' +
              '<button class="btn-ghost xs" style="flex:1" onclick="promptRenameDrive(\''+d.id+'\',\''+esc(d.name).replace(/'/g,"\\'")+'\')"><i class="fas fa-pen"></i> Rename</button>' +
              '<button class="btn-ghost xs" style="flex:1" onclick="toggleOpenDrive(\''+d.id+'\')"><i class="fas fa-users"></i> '+(isOpen?'Disable Open':'Make Open')+'</button>' +
              '<button class="btn-ghost xs '+(d.hasPassword?'active-lock':'')+'" style="flex:1;'+(d.hasPassword?'color:#ff9f0a;border-color:rgba(255,159,10,0.4);background:rgba(255,159,10,0.1)':'')+'" onclick="showSetDrivePasswordDialog(\''+d.id+'\','+(d.hasPassword?true:false)+',\''+esc(d.name).replace(/'/g,"\\'")+'\',\''+esc(d.passwordHint||'').replace(/'/g,"\\'")+'\')" title="Set Password for Drive Access"><i class="fas '+(d.hasPassword?'fa-lock':'fa-key')+'"></i> '+(d.hasPassword?'Pass Set':'Drive Pass')+'</button>' +
              '<button class="btn-ghost xs" style="flex:1" onclick="scanDriveFiles(\''+d.id+'\')" title="Scan Google Drive to detect and restore all uploaded files"><i class="fas fa-rotate"></i> Sync Files</button>' +
            '</div>' +
            '<div style="margin-top:.6rem;padding-top:.5rem;border-top:1px solid rgba(255,255,255,.07)">' +
              '<div style="font-size:.72rem;color:var(--text3);margin-bottom:.4rem;font-weight:600;text-transform:uppercase;letter-spacing:.5px">Maintenance Tools</div>' +
              '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:6px">' +
                '<button class="btn-danger xs" style="font-size:.74rem;padding:6px 8px;display:flex;align-items:center;justify-content:center;gap:5px;border-radius:7px" onclick="purgeGDriveRootFiles(\''+d.id+'\',\''+esc(d.name)+'\')" title="DANGER: Permanently deletes ALL loose files directly in TeleDrive root folder on Google Drive. Folders (ok, pdfs, tera etc) are safe. Frees storage for duplicate/stray files."><i class="fas fa-fire"></i> Purge Root</button>' +
                '<button class="btn-warning xs" style="font-size:.74rem;padding:6px 8px;display:flex;align-items:center;justify-content:center;gap:5px;border-radius:7px" onclick="dedupFolders(\''+d.id+'\',\''+esc(d.name)+'\')" title="Find and merge duplicate folders by name. Only fixes the DB — never touches Google Drive folders."><i class="fas fa-code-merge"></i> Dedup</button>' +
                '<button class="btn-primary xs" style="font-size:.74rem;padding:6px 8px;display:flex;align-items:center;justify-content:center;gap:5px;border-radius:7px" onclick="restoreDriveFolders(\''+d.id+'\',\''+esc(d.name)+'\')" title="Untrash all folders tracked in DB from Google Drive. Use this to recover folders accidentally trashed by dedup."><i class="fas fa-trash-arrow-up"></i> Restore Folders</button>' +
                '<button class="btn-ghost xs" style="font-size:.74rem;padding:6px 8px;border:1px solid rgba(100,210,255,0.45);color:#64d2ff;background:rgba(100,210,255,0.12);display:flex;align-items:center;justify-content:center;gap:5px;border-radius:7px" onclick="fixFolderLocations(\''+d.id+'\',\''+esc(d.name)+'\')" title="Move misplaced subfolders back to their correct parent on Google Drive (fixes folders that landed at wrong Drive location)."><i class="fas fa-folder-tree"></i> Move Misplaced</button>' +
              '</div>' +
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
        '<label class="switch-toggle" style="margin-left:12px;flex-shrink:0"><input type="checkbox" id="policyAllowDownload" '+(policy.allowUserDownload===false?'':'checked')+' onchange="updateAdminPolicy()"><span class="slider round"></span></label>',
      '</div>',
      '<div class="policy-card" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:1.1rem;display:flex;align-items:center;justify-content:space-between">',
        '<div>',
          '<div style="font-weight:600;font-size:.9rem;color:var(--text1);display:flex;align-items:center;gap:8px"><i class="fas fa-trash-alt" style="color:var(--danger)"></i> Allow File & Folder Deletions</div>',
          '<div style="font-size:.78rem;color:var(--text3);margin-top:3px">If disabled, non-admins cannot delete files or move them to Recycle Bin.</div>',
        '</div>',
        '<label class="switch-toggle" style="margin-left:12px;flex-shrink:0"><input type="checkbox" id="policyAllowDelete" '+(policy.allowUserDelete===false?'':'checked')+' onchange="updateAdminPolicy()"><span class="slider round"></span></label>',
      '</div>',
      '<div class="policy-card" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:1.1rem;display:flex;align-items:center;justify-content:space-between">',
        '<div>',
          '<div style="font-weight:600;font-size:.9rem;color:var(--text1);display:flex;align-items:center;gap:8px"><i class="fas fa-pen" style="color:#ff9f0a"></i> Allow File & Folder Renaming</div>',
          '<div style="font-size:.78rem;color:var(--text3);margin-top:3px">If disabled, non-admins cannot rename files or folders; only administrators can rename.</div>',
        '</div>',
        '<label class="switch-toggle" style="margin-left:12px;flex-shrink:0"><input type="checkbox" id="policyAllowRename" '+(policy.allowUserRename===false?'':'checked')+' onchange="updateAdminPolicy()"><span class="slider round"></span></label>',
      '</div>',
      '<div class="policy-card" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:1.1rem;display:flex;align-items:center;justify-content:space-between">',
        '<div>',
          '<div style="font-weight:600;font-size:.9rem;color:var(--text1);display:flex;align-items:center;gap:8px"><i class="fas fa-shield-halved" style="color:#ffd700"></i> Folder 5-Attempt Lockout & Self-Destruct</div>',
          '<div style="font-size:.78rem;color:var(--text3);margin-top:3px">When enabled, folders self-destruct after 5 wrong password attempts. Turn OFF to keep folder password protection without any attempt limit.</div>',
        '</div>',
        '<label class="switch-toggle" style="margin-left:12px;flex-shrink:0"><input type="checkbox" id="policyFolderLockout" '+(policy.folderLockoutEnabled===false?'':'checked')+' onchange="updateAdminPolicy()"><span class="slider round"></span></label>',
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

    // Database Maintenance & Backup
    '<div class="settings-section">',
    '<h3 class="sect-title"><i class="fas fa-database" style="color:var(--primary)"></i> Database Backup & Restore</h3>',
    '<p style="color:var(--text2);font-size:.85rem;margin-bottom:.8rem">Download an instant JSON backup of your database, or restore from a previous backup file / pasted JSON.</p>',
    '<div style="display:flex;gap:10px;flex-wrap:wrap">',
    '<button class="btn-ghost sm" onclick="exportDBBackup()"><i class="fas fa-download"></i> Export Backup (JSON)</button>',
    '<label class="btn-ghost sm" style="cursor:pointer;display:inline-flex;align-items:center;gap:6px"><i class="fas fa-upload"></i> Restore Backup File<input type="file" accept=".json" style="display:none" onchange="importDBBackup(event)"></label>',
    '<button class="btn-ghost sm" onclick="promptPasteDBBackup()"><i class="fas fa-paste"></i> Paste Database JSON</button>',
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
      '<thead><tr><th>Folder</th><th>Drive</th><th>Locked By</th><th>Locked Date</th><th>Password Hint</th><th>Plain Password</th><th>Action</th></tr></thead>' +
      '<tbody>' + list.map(function(f, idx){
        var inputId = 'lfp_' + f.id + '_' + idx;
        return '<tr>' +
          '<td><strong style="display:flex;align-items:center;gap:6px"><i class="fas fa-folder" style="color:#ffd700"></i> ' + esc(f.name) + '</strong></td>' +
          '<td>' + esc(f.driveName) + '</td>' +
          '<td><span class="badge ' + (f.lockedRole==='guest'?'badge-guest':'badge-user') + '">' + esc(f.lockedBy) + '</span></td>' +
          '<td>' + fmtDate(f.lockedAt) + '</td>' +
          '<td>' + (f.passwordHint ? '<span style="color:#0a84ff;font-size:.78rem;background:rgba(10,132,255,0.1);padding:3px 7px;border-radius:4px;display:inline-flex;align-items:center;gap:4px"><i class="fas fa-lightbulb" style="color:#ffd60a"></i> ' + esc(f.passwordHint) + '</span>' : '<span style="color:var(--text3);font-size:.78rem">—</span>') + '</td>' +
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
  var d = (S.db && S.db.drives || []).find(function(x){ return x.id === id; });
  var currentlyOpen = typeof isDriveOpen === 'function' ? isDriveOpen(id, S.db) : (d && d.isOpenDrive);
  var willBeOpen = !currentlyOpen;
  toast(willBeOpen ? 'Opening drive for guests…' : 'Disabling guest access…', 'info');
  var r = await apiFetch('admin/open-drive', {
    method: 'POST',
    body: JSON.stringify({ driveId: id, isOpen: willBeOpen })
  });
  if (r && r.ok) {
    toast(willBeOpen ? 'Open Drive enabled for guests!' : 'Drive is now private', 'success');
    S.db = await apiFetchDB();
    renderSettingsPage();
    renderSidebarStorage();
  } else {
    toast(r ? (r.error || 'Failed to update open drive') : 'Network error', 'error');
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
  var lockCh = $('policyFolderLockout');
  var policy = {
    allowUserDownload: dlCh ? dlCh.checked : true,
    allowUserDelete: delCh ? delCh.checked : true,
    allowUserRename: renCh ? renCh.checked : true,
    folderLockoutEnabled: lockCh ? lockCh.checked : true
  };

  // 1. Immediately persist to localStorage and memory so UI never reverts on refresh
  try { localStorage.setItem('td_policy', JSON.stringify(policy)); } catch(e){}
  if (!S.db) S.db = {};
  S.db.policy = policy;
  if (typeof cacheDBLocally === 'function') cacheDBLocally(S.db);

  toast('Updating permissions policy…', 'info');
  try {
    var res = await apiSetPolicy(policy);
    if (res && res.ok) {
      S.db.policy = res.policy;
      try { localStorage.setItem('td_policy', JSON.stringify(res.policy)); } catch(e){}
      if (typeof cacheDBLocally === 'function') cacheDBLocally(S.db);
      toast('Permissions policy updated successfully!', 'success');
    } else {
      toast('Permissions policy saved locally', 'success');
    }
  } catch(err) {
    toast('Permissions policy saved locally', 'success');
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
    '<thead><tr><th>Destroyed Folder</th><th>Drive</th><th>Locked By</th><th>Destroyed Date</th><th>Password Hint</th><th>Plain Password</th><th>Action</th></tr></thead>' +
    '<tbody>' + res.folders.map(function(f, idx){
      var inputId = 'dfp_' + f.id + '_' + idx;
      return '<tr>' +
        '<td><strong style="display:flex;align-items:center;gap:6px;color:#ff453a"><i class="fas fa-skull"></i> ' + esc(f.name) + '</strong><span style="font-size:.72rem;color:var(--text3)">' + esc(f.destroyedReason) + '</span></td>' +
        '<td>' + esc(f.driveName) + '</td>' +
        '<td><span class="badge badge-guest">' + esc(f.lockedBy) + '</span></td>' +
        '<td>' + fmtDate(f.destroyedAt) + '</td>' +
        '<td>' + (f.passwordHint ? '<span style="color:#0a84ff;font-size:.78rem;background:rgba(10,132,255,0.1);padding:3px 7px;border-radius:4px;display:inline-flex;align-items:center;gap:4px"><i class="fas fa-lightbulb" style="color:#ffd60a"></i> ' + esc(f.passwordHint) + '</span>' : '<span style="color:var(--text3);font-size:.78rem">—</span>') + '</td>' +
        '<td>' +
          '<div style="display:flex;align-items:center;gap:6px">' +
            '<input type="password" id="' + inputId + '" value="' + esc(f.plainPassword) + '" readonly class="inp xs" style="width:110px;font-family:monospace;background:rgba(255,255,200,0.06);border-color:transparent">' +
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

async function scanDriveFiles(driveId) {
  toast('Scanning Google Drive for uploaded files…', 'info', 25000);
  var totalAddedFiles = 0;
  var totalAddedFolders = 0;
  var nextToken = '';
  var isDone = false;
  var batchNum = 1;
  var finalTotalFiles = 0;

  try {
    while (!isDone) {
      var query = nextToken ? ('?pageToken=' + encodeURIComponent(nextToken)) : '';
      var r = await apiFetch('drives/scan/' + encodeURIComponent(driveId) + query, { method: 'POST' });
      if (!r || !r.ok) {
        var err = (r && r.error) ? r.error : (r && r.status ? ('Server error HTTP ' + r.status) : 'Scan failed');
        toast(err, 'error', 8000);
        return;
      }
      totalAddedFiles += (r.addedFiles || 0);
      totalAddedFolders += (r.addedFolders || 0);
      finalTotalFiles = r.totalFiles || totalAddedFiles;

      if (r.partial && r.nextPageToken) {
        nextToken = r.nextPageToken;
        toast('Syncing batch ' + batchNum + '… Synced ' + totalAddedFiles + ' files so far.', 'info', 15000);
        batchNum++;
      } else {
        isDone = true;
      }
    }

    var msg = 'Sync complete! ' + totalAddedFiles + ' new file(s) and ' + totalAddedFolders + ' folder(s) synced. Total: ' + finalTotalFiles + ' files in database.';
    toast(msg, 'success', 8000);
    clearFreshDBOverride(); // Clear any stale post-dedup override before re-fetching
    S.db = await apiFetchDB();
    saveFreshDBOverride(S.db.folders, S.db.files); // Cache so refresh also shows correct state
    renderSettingsPage();
    renderSidebarStorage();
    if (typeof _curPage !== 'undefined' && _curPage === 'files') renderFilesPage(_driveId, _folderId);
  } catch(e) {
    toast(e.message || 'Scan error', 'error', 8000);
  }
}


async function purgeStrayFilesInFolder(driveId, folderId, googleFolderId, folderName) {
  // Wraps purgeGDriveRootFiles but scans inside a specific Google Drive subfolder
  toast('Scanning "' + folderName + '" on Google Drive for stray files…', 'info', 10000);
  var dryRes = await apiFetch('admin/drive-root-purge', {
    method: 'POST',
    body: JSON.stringify({ driveId: driveId, dryRun: true, targetGoogleFolderId: googleFolderId, targetFolderLabel: folderName })
  });
  if (!dryRes || dryRes.error) {
    toast(dryRes ? dryRes.error : 'Scan failed', 'error');
    return;
  }
  if (dryRes.found === 0) {
    toast('✅ No stray files found directly inside "' + folderName + '" — already clean!', 'success');
    return;
  }
  if (!window.confirm(
    'Found ' + dryRes.found + ' stray file(s) directly inside "' + folderName + '" on Google Drive.\n\n' +
    'These are files that should be in subfolders but ended up here due to upload bugs.\n\n' +
    '⚠️ DANGER: This will permanently delete them from Google Drive!\n\nProceed?'
  )) {
    toast('Purge cancelled.', 'info');
    return;
  }
  // Delegate to the same purge flow, passing the googleFolderId
  await purgeGDriveRootFiles(driveId, folderName, googleFolderId);
  // Refresh the folder view
  S.db = await apiFetchDB();
  renderFilesPage(_driveId, _folderId);
}

async function purgeGDriveRootFiles(driveId, driveName, targetGoogleFolderId) {
  var targetFolderLabel = targetGoogleFolderId ? driveName : 'root';

  // Step 1: dry-run scan to get count (skip if called from purgeStrayFilesInFolder which already did it)
  if (!targetGoogleFolderId) {
    toast('Scanning Google Drive root for stray files…', 'info', 10000);
    var dryRes = await apiFetch('admin/drive-root-purge', { method: 'POST', body: JSON.stringify({ driveId: driveId, dryRun: true }) });
    if (!dryRes || dryRes.error) {
      toast(dryRes ? dryRes.error : 'Scan failed', 'error');
      return;
    }
    if (dryRes.found === 0) {
      toast('No loose files found in Google Drive root — already clean!', 'success');
      return;
    }

    if (!confirm(
      'PURGE STRAY FILES from Google Drive?\n\n' +
      'Drive: ' + driveName + '\n' +
      'Files to delete: ' + dryRes.found + ' loose files in TeleDrive root\n\n' +
      '⚠️ WARNING: This permanently deletes ALL these files from Google Drive and CANNOT be undone.\n' +
      'Your folders (ok, pdfs, tera, photosold etc) are SAFE — only loose root files are deleted.\n\n' +
      'Click OK to permanently delete ' + dryRes.found + ' files.'
    )) return;
  }

  // Step 2: list phase — backend scans Drive and stores IDs in KV, returns jobId
  toast('Indexing files on Google Drive…', 'info', 15000);
  var listRes = await apiFetch('admin/drive-root-purge', { method: 'POST', body: JSON.stringify({
    driveId: driveId, dryRun: false, action: 'list',
    targetGoogleFolderId: targetGoogleFolderId || null,
    targetFolderLabel: targetFolderLabel
  }) });
  if (!listRes || listRes.error || !listRes.jobId) {
    toast(listRes ? (listRes.error || 'Failed to start purge job') : 'Network error', 'error');
    return;
  }

  var jobId = listRes.jobId;
  var totalFiles = listRes.total;

  // Step 3: show live progress modal and delete in 300-file chunks
  var cancelled = false;
  var ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.72);backdrop-filter:blur(10px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
  ov.innerHTML =
    '<div id="purgeModal" style="background:var(--surface,#13152a);border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:1.6rem;max-width:400px;width:100%;box-shadow:0 24px 60px rgba(0,0,0,.8);">' +
      '<div style="display:flex;align-items:center;gap:.8rem;margin-bottom:1.2rem;">' +
        '<div style="width:40px;height:40px;border-radius:12px;background:rgba(255,69,58,.15);color:#ff453a;display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0;"><i class="fas fa-fire"></i></div>' +
        '<div>' +
          '<div style="font-size:.95rem;font-weight:700;color:var(--text1,#e8eaf6);">Purging stray files…</div>' +
          '<div style="font-size:.78rem;color:var(--text2,#8c90b0);margin-top:.1rem;">' + esc(driveName) + ' · ' + totalFiles + ' files total</div>' +
        '</div>' +
      '</div>' +
      '<div style="margin-bottom:.8rem;">' +
        '<div style="display:flex;justify-content:space-between;font-size:.78rem;color:var(--text2,#8c90b0);margin-bottom:.35rem;">' +
          '<span id="purgeStatusTxt">Starting…</span>' +
          '<span id="purgePctTxt">0%</span>' +
        '</div>' +
        '<div style="height:6px;background:rgba(255,255,255,.1);border-radius:3px;overflow:hidden;">' +
          '<div id="purgeBarFill" style="height:100%;background:linear-gradient(90deg,#ff453a,#ff9f0a);border-radius:3px;transition:width .4s;width:0%"></div>' +
        '</div>' +
      '</div>' +
      '<button id="purgeCancelBtn" style="width:100%;background:transparent;border:1px solid rgba(255,255,255,.12);color:var(--text2,#8c90b0);border-radius:10px;padding:.55rem;cursor:pointer;font-size:.83rem;">' +
        '<i class="fas fa-xmark"></i> Stop (keeps progress)' +
      '</button>' +
    '</div>';
  document.body.appendChild(ov);
  ov.querySelector('#purgeCancelBtn').onclick = function() { cancelled = true; };

  var deletedSoFar = 0;
  var offset = 0;
  var CHUNK = 300;

  function updatePurgeUI(deleted, remaining) {
    deletedSoFar += deleted;
    var pct = totalFiles > 0 ? Math.round(deletedSoFar / totalFiles * 100) : 0;
    var fill = document.getElementById('purgeBarFill');
    var statusTxt = document.getElementById('purgeStatusTxt');
    var pctTxt = document.getElementById('purgePctTxt');
    if (fill) fill.style.width = pct + '%';
    if (pctTxt) pctTxt.textContent = pct + '%';
    if (statusTxt) statusTxt.textContent = 'Deleted ' + deletedSoFar + ' / ' + totalFiles + (remaining > 0 ? ' · ' + remaining + ' remaining' : ' · Done!');
  }

  try {
    while (!cancelled) {
      var delRes = await apiFetch('admin/drive-root-purge', {
        method: 'POST',
        body: JSON.stringify({ driveId: driveId, dryRun: false, action: 'delete', jobId: jobId, offset: offset })
      });

      if (!delRes || delRes.error) {
        toast('Purge chunk error: ' + (delRes ? delRes.error : 'Network error'), 'error');
        break;
      }

      updatePurgeUI(delRes.deleted || 0, delRes.remaining || 0);
      offset = delRes.nextOffset || (offset + CHUNK);

      if (delRes.remaining <= 0 || offset >= totalFiles) break; // all done
      // Small pause between chunks so we don't hammer the API
      await new Promise(function(r) { setTimeout(r, 400); });
    }
  } finally {
    if (ov.parentNode) ov.parentNode.removeChild(ov);
  }

  if (cancelled) {
    toast('Purge stopped at ' + deletedSoFar + ' / ' + totalFiles + ' files. Click Purge again to continue from where you left off.', 'warning', 8000);
  } else {
    toast('✅ Done! Deleted ' + deletedSoFar + ' stray files from Google Drive. Refresh Quota to see freed storage.', 'success', 12000);
    S.db = await apiFetchDB();
    renderSettingsPage();
    renderSidebarStorage();
  }
}


async function dedupFolders(driveId, driveName) {
  toast('Scanning for duplicate folders in "' + driveName + '"…', 'info');
  var dryRes = await apiFetch('admin/dedup-folders', {
    method: 'POST',
    body: JSON.stringify({ driveId: driveId, dryRun: true })
  }).catch(function() { return null; });

  if (!dryRes || dryRes.error) {
    toast(dryRes ? dryRes.error : 'Scan failed', 'error');
    return;
  }

  var willMerge = dryRes.wouldMergeFolders || 0;
  if (willMerge === 0) {
    toast('✅ No duplicate folders found in "' + driveName + '"! Everything looks clean.', 'success');
    return;
  }

  var groups   = dryRes.duplicateGroups   || 0;
  var willMove = dryRes.wouldMoveFiles    || 0;

  if (!window.confirm(
    'Found ' + groups + ' duplicate folder group(s) in "' + driveName + '".\n\n' +
    '• ' + willMerge + ' duplicate folder record(s) will be removed from DB\n' +
    '• ' + willMove + ' file(s) will be re-linked to the correct folder\n\n' +
    'Google Drive folders are NOT touched — only the TeleDrive database is fixed.\n\nProceed?'
  )) {
    toast('Dedup cancelled.', 'info');
    return;
  }

  toast('Merging duplicate folders…', 'info');
  var res = await apiFetch('admin/dedup-folders', {
    method: 'POST',
    body: JSON.stringify({ driveId: driveId, dryRun: false })
  }).catch(function() { return null; });

  if (!res || res.error) {
    toast(res ? res.error : 'Dedup failed', 'error');
    return;
  }

  toast('✅ Dedup done! Merged ' + res.merged + ' folder(s), moved ' + res.movedFiles + ' file(s). Refreshing…', 'success', 8000);
  // Use folders/files from response directly — avoids KV propagation delay
  if (res.updatedFolders) {
    S.db.folders = res.updatedFolders;
    if (res.updatedFiles) S.db.files = res.updatedFiles;
    // Cache to sessionStorage so page refreshes within 90s also show correct data
    saveFreshDBOverride(res.updatedFolders, res.updatedFiles || S.db.files);
  } else {
    S.db = await apiFetchDB();
  }
  renderSettingsPage();
  renderSidebarStorage();
  renderFilesPage();
}


async function restoreDriveFolders(driveId, driveName) {
  if (!window.confirm(
    'Restore Drive Folders for "' + driveName + '"?\n\n' +
    'This will untrash ALL folders tracked in the TeleDrive database from Google Drive.\n' +
    'Use this if folders were accidentally trashed by the Dedup tool.\n\n' +
    'Folders already not in trash will not be affected.\n\nProceed?'
  )) return;

  toast('Restoring folders from Google Drive Trash…', 'info', 15000);
  var res = await apiFetch('admin/restore-drive-folders', {
    method: 'POST',
    body: JSON.stringify({ driveId: driveId })
  }).catch(function() { return null; });

  if (!res || res.error) {
    toast(res ? res.error : 'Restore failed — check connection', 'error');
    return;
  }

  toast('✅ ' + res.message, 'success', 10000);
  S.db = await apiFetchDB();
  renderSettingsPage();
  renderSidebarStorage();
}


async function fixFolderLocations(driveId, driveName) {
  toast('Checking folder locations for "' + driveName + '"…', 'info');
  var dryRes = await apiFetch('admin/fix-folder-locations', {
    method: 'POST',
    body: JSON.stringify({ driveId: driveId, dryRun: true })
  }).catch(function() { return null; });

  if (!dryRes || dryRes.error) {
    toast(dryRes ? dryRes.error : 'Check failed — see console', 'error');
    return;
  }

  if (!dryRes.willCheck || dryRes.willCheck === 0) {
    toast('✅ No misplaced folders detected for "' + driveName + '"!', 'success');
    return;
  }

  if (!window.confirm(
    'Fix Folder Locations for "' + driveName + '"?\n\n' +
    'Will check and move ' + dryRes.willCheck + ' folder(s) to their correct location on Google Drive.\n\n' +
    'Folders already in the correct location will be skipped.\n' +
    'Accidentally trashed folders will be untrashed first.\n\nProceed?'
  )) {
    toast('Cancelled.', 'info');
    return;
  }

  toast('Moving folders to correct locations on Google Drive…', 'info', 20000);
  var res = await apiFetch('admin/fix-folder-locations', {
    method: 'POST',
    body: JSON.stringify({ driveId: driveId, dryRun: false })
  }).catch(function() { return null; });

  if (!res || res.error) {
    toast(res ? res.error : 'Fix failed — see console', 'error');
    return;
  }

  toast('✅ ' + res.message, 'success', 12000);
}


async function exportDBBackup() {

  toast('Generating database backup…', 'info');
  try {
    var r = await apiFetch('admin/backup');
    if (!r || r.error) { toast(r ? r.error : 'Backup failed', 'error'); return; }
    var jsonStr = JSON.stringify(r, null, 2);
    var blob = new Blob([jsonStr], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'teledrive-db-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('Backup downloaded successfully!', 'success');
  } catch(e) {
    toast(e.message || 'Backup failed', 'error');
  }
}

async function importDBBackup(event) {
  var file = event && event.target && event.target.files && event.target.files[0];
  if (!file) return;
  if (!confirm('Are you sure you want to restore database from "' + file.name + '"? This will overwrite existing metadata.')) {
    event.target.value = '';
    return;
  }
  toast('Restoring database backup…', 'info');
  var reader = new FileReader();
  reader.onload = async function(e) {
    try {
      var data = JSON.parse(e.target.result);
      var r = await apiFetch('admin/restore', { method: 'POST', body: JSON.stringify(data) });
      if (r && r.ok) {
        toast('Database restored successfully!', 'success', 5000);
        S.db = await apiFetchDB();
        renderSettingsPage();
        renderSidebarStorage();
        if (typeof _curPage !== 'undefined' && _curPage === 'files') renderFilesPage(_driveId, _folderId);
      } else {
        toast(r ? (r.error || 'Restore failed') : 'Network error', 'error');
      }
    } catch(err) {
      toast('Invalid JSON file: ' + err.message, 'error');
    }
    event.target.value = '';
  };
  reader.readAsText(file);
}

function promptPasteDBBackup() {
  var existing = document.getElementById('pasteJsonModal');
  if (existing) existing.remove();
  var ov = document.createElement('div');
  ov.className = 'overlay';
  ov.id = 'pasteJsonModal';
  ov.innerHTML = `
    <div class="modal" style="max-width:560px;padding:1.8rem;box-shadow:0 24px 60px rgba(0,0,0,0.85);border:1px solid rgba(78,134,245,0.3)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem">
        <h3 style="margin:0;font-size:1.15rem;display:flex;align-items:center;gap:8px">
          <i class="fas fa-paste" style="color:var(--primary)"></i> Paste Old Database JSON
        </h3>
        <button class="icon-btn sm" onclick="document.getElementById('pasteJsonModal').remove()"><i class="fas fa-times"></i></button>
      </div>
      <p style="font-size:.82rem;color:var(--text2);margin-bottom:.8rem;line-height:1.5">
        If you copied the <code>td:db</code> value from Upstash Console Data Browser, paste the JSON text below to merge and restore all your drives, folders, files, and users.
      </p>
      <textarea id="rawDbJsonInput" class="inp" style="width:100%;height:180px;font-family:monospace;font-size:.78rem;resize:vertical;margin-bottom:1rem" placeholder='{"v":3,"adminHash":"...","drives":[...]}'></textarea>
      <div style="display:flex;justify-content:flex-end;gap:10px">
        <button class="btn-ghost sm" onclick="document.getElementById('pasteJsonModal').remove()">Cancel</button>
        <button class="btn-primary sm" onclick="submitPastedDBBackup()"><i class="fas fa-check"></i> Save & Restore</button>
      </div>
    </div>
  `;
  document.body.appendChild(ov);
}

async function submitPastedDBBackup() {
  var inp = document.getElementById('rawDbJsonInput');
  if (!inp || !inp.value.trim()) { toast('Please paste JSON text', 'warning'); return; }
  try {
    var parsed = JSON.parse(inp.value.trim());
    toast('Restoring database…', 'info');
    var r = await apiFetch('admin/restore', { method: 'POST', body: JSON.stringify(parsed) });
    if (r && r.ok) {
      toast('Database restored! ' + (r.totalFiles || 0) + ' files, ' + (r.totalDrives || 0) + ' drives recovered.', 'success', 6000);
      var m = document.getElementById('pasteJsonModal');
      if (m) m.remove();
      S.db = await apiFetchDB();
      renderSettingsPage();
      renderSidebarStorage();
      if (typeof _curPage !== 'undefined' && _curPage === 'files') renderFilesPage(_driveId, _folderId);
    } else {
      toast(r ? (r.error || 'Restore failed') : 'Network error', 'error');
    }
  } catch(e) {
    toast('Invalid JSON syntax: ' + e.message, 'error');
  }
}

// ─── Dedicated TripSplit Admin Page & Lifetime Ledgers ────────────────────────
async function renderTripAdminPage() {
  var pc = $('pageContent');
  if (!pc) return;

  pc.innerHTML = [
    '<div class="inner-page">',
    '<div class="page-hd">',
    '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">',
    '<div>',
    '<h2><i class="fas fa-receipt" style="color:var(--primary);margin-right:8px"></i> TripSplit Admin — Member Ledgers & Bill Archive</h2>',
    '<p>Group lifetime expenditures, friend account passwords, and individual uploaded bill archives</p>',
    '</div>',
    '<div style="display:flex;gap:8px">',
    '<a href="/trip" target="_blank" class="btn-primary sm" style="text-decoration:none;display:inline-flex;align-items:center;gap:6px"><i class="fas fa-arrow-up-right-from-square"></i> Open Live TripSplit</a>',
    '</div>',
    '</div>',
    '</div>',
    '<div id="tripAdminFullContainer"><div class="empty-small"><i class="fas fa-spinner fa-spin" style="color:var(--primary)"></i><p>Loading TripSplit member ledgers and bill archives…</p></div></div>',
    '</div>'
  ].join('');

  loadFullTripAdminPanel();
}

async function loadFullTripAdminPanel() {
  var el = document.getElementById('tripAdminFullContainer');
  if (!el) return;

  try {
    var res = await apiFetch('trip/admin-users', { method: 'GET' });
    if (!res || !res.users) {
      el.innerHTML = '<div class="empty-small"><i class="fas fa-circle-exclamation" style="color:var(--danger)"></i><p>' + (res && res.error ? res.error : 'Failed to load trip data') + '</p></div>';
      return;
    }

    var users = res.users || [];
    var trips = res.trips || [];
    var sum = res.summary || {};
    var billsByUser = res.billsByUser || {};

    // 1. Group Lifetime Financial Summary (4 Metric Cards)
    var summaryHtml = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:1.6rem">' +
      '<div style="background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:14px;padding:16px;text-align:center">' +
      '<div style="font-size:0.75rem;color:var(--text3);text-transform:uppercase;font-weight:700;letter-spacing:0.5px">Total Group Spend</div>' +
      '<div style="font-size:1.6rem;font-weight:900;color:var(--text1);margin-top:4px">₹' + (sum.totalLifetimeExpenses || 0).toLocaleString() + '</div>' +
      '<div style="font-size:0.72rem;color:var(--text3);margin-top:2px">Across all trip folders</div>' +
      '</div>' +
      '<div style="background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:14px;padding:16px;text-align:center">' +
      '<div style="font-size:0.75rem;color:var(--text3);text-transform:uppercase;font-weight:700;letter-spacing:0.5px">Total Settled</div>' +
      '<div style="font-size:1.6rem;font-weight:900;color:#30d158;margin-top:4px">₹' + (sum.totalLifetimeSettled || 0).toLocaleString() + '</div>' +
      '<div style="font-size:0.72rem;color:#30d158;margin-top:2px">Verified dues paid</div>' +
      '</div>' +
      '<div style="background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:14px;padding:16px;text-align:center">' +
      '<div style="font-size:0.75rem;color:var(--text3);text-transform:uppercase;font-weight:700;letter-spacing:0.5px">Remaining Due</div>' +
      '<div style="font-size:1.6rem;font-weight:900;color:#ff9f0a;margin-top:4px">₹' + (sum.totalLifetimeDue || 0).toLocaleString() + '</div>' +
      '<div style="font-size:0.72rem;color:#ff9f0a;margin-top:2px">Unsettled group balance</div>' +
      '</div>' +
      '<div style="background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:14px;padding:16px;text-align:center">' +
      '<div style="font-size:0.75rem;color:var(--text3);text-transform:uppercase;font-weight:700;letter-spacing:0.5px">Active Friends</div>' +
      '<div style="font-size:1.6rem;font-weight:900;color:#64d2ff;margin-top:4px">' + users.length + ' Users</div>' +
      '<div style="font-size:0.72rem;color:var(--text3);margin-top:2px">Group member accounts</div>' +
      '</div>' +
      '</div>';

    // 2. Member Passwords & Lifetime Balance Table
    var usersTable = '<div class="settings-section" style="margin-bottom:1.8rem">' +
      '<div class="sect-hd"><i class="fas fa-user-lock" style="color:var(--primary)"></i><div><h3>Friend Account Credentials & Lifetime Balances</h3><p>Every member account password, UPI configuration, and lifetime net position</p></div></div>' +
      '<div class="table-wrap" style="overflow-x:auto">' +
      '<table class="data-table" style="width:100%">' +
      '<thead><tr>' +
      '<th>Friend Name</th>' +
      '<th>Plain Password</th>' +
      '<th>UPI / QR</th>' +
      '<th style="text-align:right">Lifetime Paid</th>' +
      '<th style="text-align:right">Lifetime Share</th>' +
      '<th>Lifetime Balance</th>' +
      '<th>Action</th>' +
      '</tr></thead><tbody>' +
      users.map(function(u) {
        var statusPill = u.lifetimeStatus === 'gets'
          ? '<span class="badge" style="background:rgba(48,209,88,0.18);color:#30d158;font-weight:700">+₹' + u.lifetimeNet.toLocaleString() + ' (Gets)</span>'
          : u.lifetimeStatus === 'owes'
          ? '<span class="badge" style="background:rgba(255,159,10,0.18);color:#ff9f0a;font-weight:700">-₹' + Math.abs(u.lifetimeNet).toLocaleString() + ' (Owes)</span>'
          : '<span class="badge" style="background:rgba(255,255,255,0.08);color:var(--text3)">Settled ✅</span>';

        var qrBadge = u.hasQr
          ? '<span class="badge sm" style="background:rgba(48,209,88,0.15);color:#30d158" title="QR Code Uploaded"><i class="fas fa-qrcode"></i> QR Set</span>'
          : '<span class="badge sm" style="background:rgba(255,255,255,0.06);color:var(--text3)">No QR</span>';

        return '<tr>' +
          '<td>' +
          '<div style="display:flex;align-items:center;gap:8px">' +
          '<div style="width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,#007aff,#5856d6);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:0.8rem">' + esc(u.name)[0] + '</div>' +
          '<div><div style="font-weight:700;font-size:0.88rem;color:var(--text1)">' + esc(u.name) + '</div><div style="font-size:0.72rem;color:var(--text3)">@' + esc(u.username) + '</div></div>' +
          '</div>' +
          '</td>' +
          '<td>' +
          '<div style="display:inline-flex;align-items:center;gap:6px;background:rgba(0,0,0,0.35);padding:4px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.08)">' +
          '<span id="tripPassVal_' + u.id + '" style="font-family:monospace;font-size:0.84rem;letter-spacing:1px;color:#ffd60a">••••••••</span>' +
          '<button class="icon-btn xs" onclick="toggleTripPlainPass(\'' + u.id + '\', \'' + esc(u.password).replace(/'/g, "\\'") + '\')" title="Show / Hide Plain Password"><i class="fas fa-eye" id="tripPassIco_' + u.id + '"></i></button>' +
          '<button class="icon-btn xs" onclick="copyTripPass(\'' + esc(u.password).replace(/'/g, "\\'") + '\')" title="Copy Password"><i class="fas fa-copy"></i></button>' +
          '</div>' +
          '</td>' +
          '<td>' +
          '<div style="font-size:0.78rem">' + (u.upiId ? '<span style="font-family:monospace;color:var(--text2)">' + esc(u.upiId) + '</span> ' : '') + qrBadge + '</div>' +
          '</td>' +
          '<td style="text-align:right;font-weight:700;color:var(--text1)">₹' + u.lifetimePaid.toLocaleString() + ' <span style="font-size:0.7rem;color:var(--text3);font-weight:normal">(' + u.billsCreatedCount + ' bills)</span></td>' +
          '<td style="text-align:right;font-weight:700;color:var(--text2)">₹' + u.lifetimeShare.toLocaleString() + '</td>' +
          '<td>' + statusPill + '</td>' +
          '<td>' +
          '<button class="btn-ghost xs" onclick="adminQuickResetTripPass(\'' + esc(u.username) + '\', \'' + esc(u.name).replace(/'/g, "\\'") + '\')"><i class="fas fa-key"></i> Reset Pass</button>' +
          '</td>' +
          '</tr>';
      }).join('') +
      '</tbody></table></div></div>';

    // 3. Member Bill Folders ("a folder that have everyone names and inside that all bill they uploaded by date")
    var memberFoldersHtml = '<div class="settings-section" style="margin-bottom:1.8rem">' +
      '<div class="sect-hd"><i class="fas fa-folder-open" style="color:#ffd60a"></i><div><h3>Friend Bill Archives (Uploaded Receipts)</h3><p>Browse folders for each friend to inspect all bills they uploaded, sorted by date with receipt images</p></div></div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px">' +
      users.map(function(u) {
        var uBills = billsByUser[u.username.toLowerCase()] || [];
        var totalPaid = uBills.reduce(function(acc, b) { return acc + (b.amount || 0); }, 0);
        var drawerId = 'userBillDrawer_' + u.id;
        var arrowId = 'userBillArrow_' + u.id;

        var billsRows = uBills.length === 0
          ? '<div style="padding:16px;text-align:center;color:var(--text3);font-size:0.8rem">No bills uploaded by ' + esc(u.name) + ' yet.</div>'
          : '<div style="max-height:380px;overflow-y:auto;padding:6px">' +
            uBills.map(function(b) {
              var receiptUrl = b.receiptImage || b.proofPhoto;
              var proofBtn = receiptUrl
                ? '<a href="' + receiptUrl + '" target="_blank" rel="noopener noreferrer" class="btn-ghost xs" style="color:#00e5ff;border:1px solid rgba(0,229,255,0.3);border-radius:20px;padding:3px 10px;text-decoration:none;display:inline-flex;align-items:center;gap:5px" title="Open receipt in new tab"><i class="fas fa-arrow-up-right-from-square"></i> Open Receipt</a>'
                : '<span style="font-size:0.72rem;color:var(--text3);font-style:italic">No receipt attached</span>';

              return '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:10px 12px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">' +
                '<div>' +
                '<div style="font-weight:700;font-size:0.86rem;color:var(--text1)">' + esc(b.title) + '</div>' +
                '<div style="font-size:0.72rem;color:var(--text3);margin-top:2px"><i class="fas fa-calendar-day"></i> ' + dateStr + ' · <span style="color:#e0834a">🏖️ ' + esc(b.tripName) + '</span></div>' +
                '</div>' +
                '<div style="display:flex;align-items:center;gap:10px">' +
                '<div style="text-align:right"><div style="font-size:0.95rem;font-weight:800;color:#ffd60a">₹' + (b.amount || 0).toLocaleString() + '</div><div style="font-size:0.7rem;color:var(--text3)">' + (b.splitMembers ? b.splitMembers.length : 7) + ' members</div></div>' +
                proofBtn +
                '<button class="icon-btn xs danger" onclick="adminDeleteTripBill(\'' + b.folderId + '\', \'' + b.id + '\')" title="Delete this bill"><i class="fas fa-trash-alt"></i></button>' +
                '</div>' +
                '</div>';
            }).join('') +
            '</div>';

        return '<div style="background:rgba(255,255,255,0.02);border:1px solid var(--border);border-radius:14px;overflow:hidden">' +
          '<div style="padding:14px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;background:rgba(255,255,255,0.02)" onclick="toggleFriendBillDrawer(\'' + drawerId + '\', \'' + arrowId + '\')">' +
          '<div style="display:flex;align-items:center;gap:10px">' +
          '<div style="width:36px;height:36px;border-radius:10px;background:rgba(255,214,10,0.12);border:1px solid rgba(255,214,10,0.25);color:#ffd60a;display:flex;align-items:center;justify-content:center;font-size:1.1rem"><i class="fas fa-folder"></i></div>' +
          '<div>' +
          '<div style="font-weight:800;font-size:0.9rem;color:var(--text1)">' + esc(u.name) + '\'s Bills</div>' +
          '<div style="font-size:0.74rem;color:var(--text3)">' + uBills.length + ' bill(s) · Paid ₹' + totalPaid.toLocaleString() + '</div>' +
          '</div>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:8px">' +
          '<span class="badge sm" style="background:rgba(255,255,255,0.06);color:var(--text2)">' + uBills.length + ' Bills</span>' +
          '<i class="fas fa-chevron-down" id="' + arrowId + '" style="font-size:0.8rem;color:var(--text3);transition:transform 0.2s"></i>' +
          '</div>' +
          '</div>' +
          '<div id="' + drawerId + '" style="display:none;border-top:1px solid var(--border);background:rgba(0,0,0,0.2)">' +
          billsRows +
          '</div>' +
          '</div>';
      }).join('') +
      '</div></div>';

    // 4. Connected Trips Section
    var tripsHtml = '';
    if (trips.length > 0) {
      tripsHtml = '<div class="settings-section">' +
        '<div class="sect-hd"><i class="fas fa-map-location-dot" style="color:#e0834a"></i><div><h3>Active Trip Expense Folders (' + trips.length + ')</h3><p>Manage and open connected trips in TripSplit</p></div></div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px">' +
        trips.map(function(t) {
          return '<div style="background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:12px;padding:14px;display:flex;flex-direction:column;justify-content:space-between;gap:10px">' +
            '<div><div style="font-weight:800;font-size:0.95rem;color:var(--text1)">🏖️ ' + esc(t.name) + '</div>' +
            '<div style="font-size:0.76rem;color:var(--text3);margin-top:3px">' + t.billsCount + ' bills · Total: <b style="color:var(--text1)">₹' + t.totalExpenses.toLocaleString() + '</b></div>' +
            '<div style="font-size:0.76rem;color:var(--text3)">Settled: <b style="color:#30d158">₹' + t.totalSettled.toLocaleString() + '</b> · Due: <b style="color:#ff9f0a">₹' + t.remainingDue.toLocaleString() + '</b></div></div>' +
            '<div style="display:flex;gap:6px">' +
            '<a href="/trip?folder=' + encodeURIComponent(t.folderId) + '" target="_blank" class="btn-primary xs" style="background:#007aff;border:none;flex:1;text-align:center;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:6px"><i class="fas fa-arrow-up-right-from-square"></i> Open in TripSplit</a>' +
            '</div></div>';
        }).join('') +
        '</div></div>';
    }

    el.innerHTML = summaryHtml + usersTable + memberFoldersHtml + tripsHtml;
  } catch(e) {
    el.innerHTML = '<div class="empty-small"><i class="fas fa-triangle-exclamation" style="color:var(--danger)"></i><p>Error: ' + e.message + '</p></div>';
  }
}

function toggleFriendBillDrawer(drawerId, arrowId) {
  var drawer = document.getElementById(drawerId);
  var arrow = document.getElementById(arrowId);
  if (!drawer) return;
  if (drawer.style.display === 'none' || !drawer.style.display) {
    drawer.style.display = 'block';
    if (arrow) arrow.style.transform = 'rotate(180deg)';
  } else {
    drawer.style.display = 'none';
    if (arrow) arrow.style.transform = 'rotate(0deg)';
  }
}

function showTripReceiptLightbox(title, imgUrl) {
  var existing = document.getElementById('adminTripReceiptLightbox');
  if (existing) existing.remove();
  var modal = document.createElement('div');
  modal.id = 'adminTripReceiptLightbox';
  modal.className = 'modal-backdrop';
  modal.style.zIndex = '9999';
  modal.innerHTML = '<div class="modal" style="max-width:650px;background:#18181b;border:1px solid rgba(255,255,255,0.12);padding:1.2rem;border-radius:16px;text-align:center">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.8rem">' +
    '<h3 style="font-size:0.95rem;font-weight:700;color:#fff;margin:0"><i class="fas fa-receipt" style="color:#00e5ff;margin-right:6px"></i> ' + esc(title) + '</h3>' +
    '<button class="icon-btn xs" onclick="document.getElementById(\'adminTripReceiptLightbox\').remove()"><i class="fas fa-times"></i></button>' +
    '</div>' +
    '<div style="max-height:75vh;overflow:auto;display:flex;align-items:center;justify-content:center;background:#09090b;border-radius:12px;padding:8px">' +
    '<img src="' + imgUrl + '" style="max-width:100%;max-height:70vh;object-fit:contain;border-radius:8px" alt="Bill Receipt">' +
    '</div>' +
    '</div>';
  document.body.appendChild(modal);
}

async function adminDeleteTripBill(folderId, billId) {
  if (!confirm('Are you sure you want to delete this trip bill?')) return;
  toast('Deleting bill…', 'info');
  try {
    var res = await apiFetch('trip/bill/delete', {
      method: 'POST',
      body: JSON.stringify({ folderId: folderId, billId: billId })
    });
    if (res && res.ok) {
      toast('Bill deleted successfully', 'success');
      loadFullTripAdminPanel();
    } else {
      toast(res ? (res.error || 'Failed') : 'Error', 'error');
    }
  } catch(e) {
    toast('Error: ' + e.message, 'error');
  }
}

function toggleTripPlainPass(userId, plainPass) {
  var span = document.getElementById('tripPassVal_' + userId);
  var ico = document.getElementById('tripPassIco_' + userId);
  if (!span) return;
  if (span.textContent === '••••••••') {
    span.textContent = plainPass;
    span.style.color = '#30d158';
    if (ico) ico.className = 'fas fa-eye-slash';
  } else {
    span.textContent = '••••••••';
    span.style.color = '#ffd60a';
    if (ico) ico.className = 'fas fa-eye';
  }
}

function copyTripPass(pass) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(pass).then(function() {
      toast('Password copied: ' + pass, 'success');
    }).catch(function() {
      prompt('Copy password:', pass);
    });
  } else {
    prompt('Copy password:', pass);
  }
}

async function adminQuickResetTripPass(username, name) {
  var newPass = prompt('Enter new password for ' + name + ' (@' + username + '):');
  if (!newPass || !newPass.trim()) return;
  if (newPass.trim().length < 3) return toast('Password must be at least 3 characters', 'warning');

  toast('Updating password…', 'info');
  try {
    var res = await apiFetch('trip/admin-users', {
      method: 'POST',
      body: JSON.stringify({
        name: name,
        username: username,
        password: newPass.trim()
      })
    });
    if (res && res.ok) {
      toast('Password updated for ' + name + '!', 'success');
      loadFullTripAdminPanel();
    } else {
      toast(res ? (res.error || 'Failed') : 'Error', 'error');
    }
  } catch(e) {
    toast('Error: ' + e.message, 'error');
  }
}