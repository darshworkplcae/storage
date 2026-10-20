// TeleDrive — Inside Drive (Admin Full Root Google Drive Explorer)
// Completely isolated from regular TeleDrive database and sync logic.

(function () {
  window._rawDriveFolderChain = [];
  var _rawFilesCache = [];
  var _rawSearchTerm = '';
  var _rawNextPageToken = null;
  var _rawCurrentDriveId = null;
  var _rawCurrentFolderId = 'root';
  var _rawIsListMode = true;

  function _fmt(bytes) {
    if (typeof fmt === 'function') return fmt(bytes);
    if (!bytes || bytes === 0) return '0 B';
    var k = 1024, sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    var i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  function _esc(s) {
    if (typeof esc === 'function') return esc(s);
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function _debounce(fn, ms) {
    var t;
    return function () {
      var ctx = this, args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, ms || 200);
    };
  }

  function injectStyles() {
    if (document.getElementById('insideDriveResponsiveStyles')) return;
    var st = document.createElement('style');
    st.id = 'insideDriveResponsiveStyles';
    st.textContent = `
      .raw-container { width:100%; max-width:1200px; margin:0 auto; padding:.5rem 0 2rem; }
      .raw-drives-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(290px, 1fr)); gap:1.2rem; }
      .raw-toolbar { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:.75rem; margin-bottom:1.2rem; background:rgba(255,255,255,0.025); border:1px solid var(--border); border-radius:14px; padding:.75rem 1rem; }
      .raw-search-wrap { position:relative; width:240px; }
      .raw-file-row { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:.75rem .9rem; border-radius:10px; background:rgba(255,255,255,0.02); border:1px solid var(--border); transition:all .15s ease; }
      .raw-file-row:hover { background:rgba(255,255,255,0.05); border-color:rgba(0,229,255,0.3); }
      .raw-btn-touch { min-height:36px; padding:6px 12px; border-radius:8px; display:inline-flex; align-items:center; justify-content:center; gap:6px; font-weight:600; cursor:pointer; }

      @media (max-width: 640px) {
        .raw-drives-grid { grid-template-columns:1fr; gap:.9rem; }
        .raw-toolbar { flex-direction:column; align-items:stretch; gap:.65rem; padding:.75rem; }
        .raw-toolbar-left { display:flex; align-items:center; justify-content:space-between; width:100%; flex-wrap:wrap; gap:8px; }
        .raw-toolbar-right { display:flex; align-items:center; justify-content:space-between; width:100%; gap:8px; }
        .raw-search-wrap { width:100%; order:2; }
        .raw-file-row { flex-direction:column; align-items:flex-start; gap:8px; padding:.75rem; }
        .raw-file-row-main { width:100%; }
        .raw-file-row-acts { width:100%; justify-content:flex-end; border-top:1px solid rgba(255,255,255,0.06); padding-top:6px; }
      }
    `;
    document.head.appendChild(st);
  }

  window.renderInsideDrivePage = async function (driveId, folderId) {
    injectStyles();
    var pc = document.getElementById('pageContent');
    if (!pc) return;

    if (!S.ses || S.ses.role !== 'admin') {
      if (typeof navTo === 'function') navTo('files');
      return;
    }

    // Ensure database is loaded
    if (typeof loadDB === 'function' && (!S.db || !S.db.drives)) {
      pc.innerHTML = '<div class="loading-full"><i class="fas fa-spinner fa-spin"></i><p style="margin-top:10px;font-size:.85rem;color:var(--text3)">Connecting to database…</p></div>';
      try {
        await loadDB();
      } catch (e) {
        console.warn('loadDB error in inside-drive:', e);
      }
    }

    // Hide standard upload action buttons in top bar while browsing Inside Drive
    var uploadBtn = document.getElementById('uploadBtn');
    var folderUpBtn = document.getElementById('folderUpBtn');
    var newFolderBtn = document.getElementById('newFolderBtn');
    var viewSizeBtns = document.querySelector('.view-size-btns');
    if (uploadBtn) uploadBtn.classList.add('hidden');
    if (folderUpBtn) folderUpBtn.classList.add('hidden');
    if (newFolderBtn) newFolderBtn.classList.add('hidden');
    if (viewSizeBtns) viewSizeBtns.classList.add('hidden');

    if (!driveId) {
      renderDriveSelectionView(pc);
      return;
    }

    _rawCurrentDriveId = driveId;
    _rawCurrentFolderId = folderId || 'root';
    _rawSearchTerm = '';
    _rawNextPageToken = null;

    renderFolderView(pc, driveId, _rawCurrentFolderId);
  };

  function renderDriveSelectionView(pc) {
    window._rawDriveFolderChain = [];
    var drives = (S.db && S.db.drives) || [];

    var cardsHtml = drives.map(function (d) {
      var used = d.usedBytes || 0;
      var cap = d.totalBytes || 0;
      var pct = cap ? Math.min(100, Math.round((used / cap) * 100)) : 0;
      var dColor = d.color || '#00e5ff';

      return `
        <div class="fg-card drive-card-item" onclick="navTo('inside-drive', '${_esc(d.id)}', 'root')" style="position:relative;cursor:pointer;padding:1.4rem 1.1rem;border:1px solid rgba(0,229,255,0.22);border-radius:16px;background:rgba(255,255,255,0.02)">
          <div style="position:absolute;top:12px;right:12px;background:rgba(0,229,255,0.12);border:1px solid rgba(0,229,255,0.3);border-radius:12px;padding:2px 8px;font-size:.68rem;font-weight:700;color:#00e5ff">
            <i class="fas fa-hard-drive"></i> Root Explorer
          </div>
          <div class="fg-icon xl" style="display:flex;align-items:center;justify-content:center;margin-top:2px">
            <i class="fas fa-database" style="font-size:2.8rem;color:${_esc(dColor)}"></i>
          </div>
          <div class="fg-name" style="font-weight:700;font-size:1.1rem;margin-top:.6rem">${_esc(d.name)}</div>
          <div style="font-size:.78rem;color:var(--text3);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(d.email || '')}</div>
          <div class="fg-meta" style="margin-top:.6rem;font-size:.82rem">${_fmt(used)} / ${cap ? _fmt(cap) : '∞'} (${pct}%)</div>
          <div class="dc-bar" style="margin:.45rem 0 .8rem;height:6px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden">
            <div class="dc-fill" style="height:100%;border-radius:3px;width:${pct}%;background:${_esc(dColor)};box-shadow:0 0 8px ${_esc(dColor)}66"></div>
          </div>
          <button class="btn-primary sm raw-btn-touch" style="width:100%;margin-top:4px" onclick="event.stopPropagation();navTo('inside-drive', '${_esc(d.id)}', 'root')">
            <i class="fas fa-folder-tree mr-1"></i> Browse Full Root Drive
          </button>
        </div>
      `;
    }).join('');

    pc.innerHTML = `
      <div class="inner-page raw-container">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:1rem;margin-bottom:1.5rem">
          <div>
            <div style="display:inline-flex;align-items:center;gap:6px;background:rgba(0,229,255,0.12);border:1px solid rgba(0,229,255,0.3);color:#00e5ff;border-radius:20px;padding:3px 12px;font-size:.74rem;font-weight:700;margin-bottom:6px">
              <i class="fas fa-shield-halved"></i> Admin Feature
            </div>
            <h2 style="font-size:1.5rem;font-weight:800;color:var(--text1);display:flex;align-items:center;gap:10px">
              <i class="fas fa-hard-drive" style="color:#00e5ff"></i> Inside Drive — Root Explorer
            </h2>
            <p style="color:var(--text3);font-size:.85rem;margin-top:4px">
              Direct live Google Drive API explorer for administrators. View all account files, root folders, and system directories without affecting normal TeleDrive storage.
            </p>
          </div>
        </div>

        <div class="raw-drives-grid">
          ${cardsHtml || '<div class="empty-state" style="grid-column:1/-1;text-align:center;padding:3rem 1rem">No connected Google Drives found. Connect a drive in Settings.</div>'}
        </div>
      </div>
    `;
  }

  async function renderFolderView(pc, driveId, folderId) {
    var drv = (S.db && S.db.drives || []).find(function(d){ return d.id === driveId; });
    var driveName = drv ? drv.name : 'Drive';
    var driveColor = drv ? (drv.color || '#00e5ff') : '#00e5ff';

    pc.innerHTML = `
      <div class="inner-page raw-container">
        <!-- Top Toolbar -->
        <div class="raw-toolbar">
          <div class="raw-toolbar-left">
            <button class="btn-ghost sm raw-btn-touch" onclick="navTo('inside-drive')" style="border-radius:10px">
              <i class="fas fa-arrow-left mr-1"></i> All Drives
            </button>
            <div style="display:inline-flex;align-items:center;gap:6px;background:${_esc(driveColor)}18;border:1px solid ${_esc(driveColor)}44;border-radius:20px;padding:3px 12px;font-size:.78rem;font-weight:700;color:${_esc(driveColor)}">
              <i class="fas fa-hard-drive"></i> ${_esc(driveName)}
            </div>
            <span id="rawItemCountBadge" style="font-size:.78rem;color:var(--text3)"></span>
          </div>

          <div class="raw-toolbar-right">
            <div class="raw-search-wrap">
              <input type="text" id="rawSearchInput" class="inp xs" placeholder="Filter files in folder…" style="width:100%;padding-left:28px;height:34px;font-size:.82rem;border-radius:8px">
              <i class="fas fa-search" style="position:absolute;left:9px;top:50%;transform:translateY(-50%);font-size:.72rem;color:var(--text3);pointer-events:none"></i>
            </div>
            <button class="icon-btn sm" onclick="window._refreshRawFolder()" title="Refresh Folder">
              <i class="fas fa-rotate-right"></i>
            </button>
            <button class="icon-btn sm" id="rawToggleViewBtn" onclick="window._toggleRawViewMode()" title="Toggle View Mode">
              <i class="fas ${_rawIsListMode ? 'fa-table-cells-large' : 'fa-list'}"></i>
            </button>
          </div>
        </div>

        <div id="rawFolderContent">
          <div class="loading-full" style="padding:4rem 0"><i class="fas fa-spinner fa-spin"></i><p style="margin-top:10px;font-size:.85rem;color:var(--text3)">Fetching files from Google Drive API…</p></div>
        </div>
      </div>
    `;

    var searchInp = document.getElementById('rawSearchInput');
    if (searchInp) {
      searchInp.addEventListener('input', _debounce(function (e) {
        _rawSearchTerm = (e.target.value || '').toLowerCase().trim();
        renderRawItems();
      }, 200));
    }

    await loadRawFolderData(driveId, folderId);
  }

  async function loadRawFolderData(driveId, folderId, pageToken) {
    try {
      var tok = (S.ses && S.ses.token) ? S.ses.token : '';
      var url = `/api/admin/raw-drive-files?driveId=${encodeURIComponent(driveId)}&folderId=${encodeURIComponent(folderId || 'root')}` +
        (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '') +
        (tok ? `&token=${encodeURIComponent(tok)}` : '');

      var r = await fetch(url, {
        headers: {
          'Authorization': tok ? `Bearer ${tok}` : ''
        }
      });

      if (!r.ok) {
        var errJson = await r.json().catch(function () { return {}; });
        throw new Error(errJson.error || ('HTTP ' + r.status));
      }

      var res = await r.json();

      if (pageToken) {
        _rawFilesCache = _rawFilesCache.concat(res.files || []);
      } else {
        _rawFilesCache = res.files || [];
      }
      _rawNextPageToken = res.nextPageToken || null;

      // Update folder breadcrumb chain
      if (!pageToken) {
        if (folderId === 'root') {
          window._rawDriveFolderChain = [];
        } else {
          var existsIdx = window._rawDriveFolderChain.findIndex(function (x) { return x.id === folderId; });
          if (existsIdx >= 0) {
            window._rawDriveFolderChain = window._rawDriveFolderChain.slice(0, existsIdx + 1);
          } else {
            window._rawDriveFolderChain.push({ id: folderId, name: res.currentFolderName || folderId });
          }
        }
        if (typeof updateBreadcrumb === 'function') {
          updateBreadcrumb('inside-drive', driveId, folderId);
        }
      }

      renderRawItems();
    } catch (err) {
      console.error('Failed to load raw drive files:', err);
      var c = document.getElementById('rawFolderContent');
      if (c) {
        c.innerHTML = `
          <div style="text-align:center;padding:4rem 1rem">
            <div style="font-size:2.5rem;color:var(--danger);margin-bottom:1rem"><i class="fas fa-triangle-exclamation"></i></div>
            <h3 style="font-weight:700;margin-bottom:.5rem">Failed to load Google Drive files</h3>
            <p style="color:var(--text3);font-size:.85rem;max-width:500px;margin:0 auto 1.5rem">${_esc(err.message)}</p>
            <button class="btn-primary sm" onclick="window._refreshRawFolder()"><i class="fas fa-rotate-right mr-1"></i> Retry</button>
          </div>
        `;
      }
    }
  }

  function renderRawItems() {
    var c = document.getElementById('rawFolderContent');
    if (!c) return;

    var filtered = _rawFilesCache;
    if (_rawSearchTerm) {
      filtered = _rawFilesCache.filter(function (f) {
        return (f.name || '').toLowerCase().includes(_rawSearchTerm);
      });
    }

    var countBadge = document.getElementById('rawItemCountBadge');
    if (countBadge) {
      countBadge.textContent = `${filtered.length} item${filtered.length === 1 ? '' : 's'}`;
    }

    if (!filtered.length) {
      c.innerHTML = `
        <div style="text-align:center;padding:4rem 1rem;color:var(--text3)">
          <i class="fas fa-folder-open" style="font-size:2.8rem;color:rgba(255,255,255,0.15);margin-bottom:.8rem"></i>
          <p style="font-size:.9rem">${_rawSearchTerm ? 'No matching files or folders found' : 'This folder is empty'}</p>
        </div>
      `;
      return;
    }

    var folders = filtered.filter(function (x) { return x.mimeType === 'application/vnd.google-apps.folder'; });
    var files = filtered.filter(function (x) { return x.mimeType !== 'application/vnd.google-apps.folder'; });

    var loadMoreBtnHtml = _rawNextPageToken ? `
      <div style="text-align:center;margin-top:2rem">
        <button class="btn-ghost sm" onclick="window._loadMoreRawFiles()" id="rawLoadMoreBtn" style="border:1px solid rgba(0,229,255,0.4);color:#00e5ff">
          <i class="fas fa-arrow-down mr-1"></i> Load Next 100 Files
        </button>
      </div>
    ` : '';

    if (_rawIsListMode) {
      c.innerHTML = renderListView(folders, files) + loadMoreBtnHtml;
    } else {
      c.innerHTML = renderGridView(folders, files) + loadMoreBtnHtml;
    }
  }

  function renderListView(folders, files) {
    var foldersHtml = folders.map(function (f) {
      var modDate = f.modifiedTime ? new Date(f.modifiedTime).toLocaleDateString() : '—';
      return `
        <div class="raw-file-row" onclick="navTo('inside-drive', '${_esc(_rawCurrentDriveId)}', '${_esc(f.id)}')" style="cursor:pointer">
          <div class="raw-file-row-main" style="display:flex;align-items:center;gap:12px;min-width:0;flex:1">
            <i class="fas fa-folder" style="font-size:1.4rem;color:#f59e0b;flex-shrink:0"></i>
            <div style="min-width:0;flex:1">
              <div style="font-weight:600;font-size:.88rem;color:var(--text1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${_esc(f.name)}">${_esc(f.name)}</div>
              <div style="font-size:.72rem;color:var(--text3)">Folder · Modified ${modDate}</div>
            </div>
          </div>
          <div class="raw-file-row-acts" style="display:flex;align-items:center;gap:8px" onclick="event.stopPropagation()">
            ${f.webViewLink ? `<a href="${_esc(f.webViewLink)}" target="_blank" rel="noopener" class="icon-btn xs" title="Open in Google Drive"><i class="fas fa-arrow-up-right-from-square"></i></a>` : ''}
            <button class="btn-ghost xs raw-btn-touch" onclick="navTo('inside-drive', '${_esc(_rawCurrentDriveId)}', '${_esc(f.id)}')">
              Open <i class="fas fa-chevron-right ml-1"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');

    var filesHtml = files.map(function (f) {
      var cfg = (typeof ftCfg === 'function') ? ftCfg(f.name, f.mimeType) : { icon: 'fa-file', col: '#9ca3af', cat: 'file' };
      var modDate = f.modifiedTime ? new Date(f.modifiedTime).toLocaleDateString() : '—';
      var dlUrl = `/api/download/${encodeURIComponent(f.id)}?driveId=${encodeURIComponent(_rawCurrentDriveId)}&name=${encodeURIComponent(f.name)}`;
      var canStream = ['image', 'video', 'audio', 'doc'].includes(cfg.cat);

      return `
        <div class="raw-file-row">
          <div class="raw-file-row-main" style="display:flex;align-items:center;gap:12px;min-width:0;flex:1">
            <i class="fas ${cfg.icon}" style="font-size:1.3rem;color:${cfg.col};flex-shrink:0"></i>
            <div style="min-width:0;flex:1">
              <div style="font-weight:600;font-size:.88rem;color:var(--text1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${_esc(f.name)}">${_esc(f.name)}</div>
              <div style="font-size:.72rem;color:var(--text3)">${_fmt(f.size || 0)} · Modified ${modDate}</div>
            </div>
          </div>
          <div class="raw-file-row-acts" style="display:flex;align-items:center;gap:6px">
            ${canStream ? `<button class="btn-ghost xs raw-btn-touch" style="color:#00e5ff" onclick="window._openRawPreview('${_esc(f.id)}', '${_esc(f.name)}', '${_esc(f.mimeType)}')"><i class="fas fa-play mr-1"></i> Stream</button>` : ''}
            <a href="${dlUrl}" class="icon-btn xs" download="${_esc(f.name)}" title="Download"><i class="fas fa-download"></i></a>
            ${f.webViewLink ? `<a href="${_esc(f.webViewLink)}" target="_blank" rel="noopener" class="icon-btn xs" title="Open in Google Drive"><i class="fas fa-arrow-up-right-from-square"></i></a>` : ''}
          </div>
        </div>
      `;
    }).join('');

    return `
      <div style="display:flex;flex-direction:column;gap:8px">
        ${foldersHtml}
        ${filesHtml}
      </div>
    `;
  }

  function renderGridView(folders, files) {
    var foldersHtml = folders.map(function (f) {
      return `
        <div class="fg-card" onclick="navTo('inside-drive', '${_esc(_rawCurrentDriveId)}', '${_esc(f.id)}')" style="cursor:pointer;padding:1.2rem .8rem;text-align:center">
          <div style="font-size:2.8rem;color:#f59e0b;margin-bottom:.5rem"><i class="fas fa-folder"></i></div>
          <div class="fg-name" style="font-weight:600;font-size:.88rem">${_esc(f.name)}</div>
          <div style="font-size:.72rem;color:var(--text3);margin-top:2px">Folder</div>
        </div>
      `;
    }).join('');

    var filesHtml = files.map(function (f) {
      var cfg = (typeof ftCfg === 'function') ? ftCfg(f.name, f.mimeType) : { icon: 'fa-file', col: '#9ca3af', cat: 'file' };
      var dlUrl = `/api/download/${encodeURIComponent(f.id)}?driveId=${encodeURIComponent(_rawCurrentDriveId)}&name=${encodeURIComponent(f.name)}`;
      var canStream = ['image', 'video', 'audio', 'doc'].includes(cfg.cat);

      return `
        <div class="fg-card" style="padding:1rem .8rem;text-align:center;display:flex;flex-direction:column;justify-content:space-between">
          <div>
            <div style="font-size:2.5rem;color:${cfg.col};margin-bottom:.4rem"><i class="fas ${cfg.icon}"></i></div>
            <div class="fg-name" style="font-weight:600;font-size:.85rem">${_esc(f.name)}</div>
            <div style="font-size:.72rem;color:var(--text3);margin-top:2px">${_fmt(f.size || 0)}</div>
          </div>
          <div style="display:flex;gap:6px;justify-content:center;margin-top:.8rem">
            ${canStream ? `<button class="btn-ghost xs" style="color:#00e5ff" onclick="window._openRawPreview('${_esc(f.id)}', '${_esc(f.name)}', '${_esc(f.mimeType)}')"><i class="fas fa-play"></i></button>` : ''}
            <a href="${dlUrl}" class="icon-btn xs" download="${_esc(f.name)}" title="Download"><i class="fas fa-download"></i></a>
            ${f.webViewLink ? `<a href="${_esc(f.webViewLink)}" target="_blank" rel="noopener" class="icon-btn xs" title="Open in Google Drive"><i class="fas fa-arrow-up-right-from-square"></i></a>` : ''}
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="file-grid" style="grid-template-columns:repeat(auto-fill, minmax(150px, 1fr));gap:1rem">
        ${foldersHtml}
        ${filesHtml}
      </div>
    `;
  }

  window._refreshRawFolder = function () {
    if (_rawCurrentDriveId) {
      loadRawFolderData(_rawCurrentDriveId, _rawCurrentFolderId);
    }
  };

  window._toggleRawViewMode = function () {
    _rawIsListMode = !_rawIsListMode;
    var btn = document.getElementById('rawToggleViewBtn');
    if (btn) btn.innerHTML = `<i class="fas ${_rawIsListMode ? 'fa-table-cells-large' : 'fa-list'}"></i>`;
    renderRawItems();
  };

  window._loadMoreRawFiles = async function () {
    if (!_rawNextPageToken || !_rawCurrentDriveId) return;
    var btn = document.getElementById('rawLoadMoreBtn');
    if (btn) btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Loading…';
    await loadRawFolderData(_rawCurrentDriveId, _rawCurrentFolderId, _rawNextPageToken);
  };

  window._openRawPreview = function (fileId, fileName, mimeType) {
    var dlUrl = `/api/download/${encodeURIComponent(fileId)}?driveId=${encodeURIComponent(_rawCurrentDriveId)}&name=${encodeURIComponent(fileName)}`;
    var mediaUrl = `${dlUrl}&inline=1`;
    var cfg = (typeof ftCfg === 'function') ? ftCfg(fileName, mimeType) : { icon: 'fa-file', col: '#9ca3af', cat: 'file' };

    var existingOv = document.querySelector('.media-ov');
    if (existingOv) existingOv.remove();

    var ov = document.createElement('div');
    ov.className = 'media-ov';

    var bodyHtml = '';
    if (cfg.cat === 'image') {
      bodyHtml = `<img class="media-img" src="${mediaUrl}" alt="${_esc(fileName)}" onload="var s=document.getElementById('mediaLoadingSpinner');if(s)s.style.display='none';">`;
    } else if (cfg.cat === 'video') {
      bodyHtml = `
        <div class="media-video-container" style="position:relative;width:100%;max-width:1000px;display:flex;flex-direction:column;align-items:center;justify-content:center">
          <video id="rawVideoPlayer" class="media-vid" src="${mediaUrl}" controls autoplay playsinline onloadeddata="var s=document.getElementById('mediaLoadingSpinner');if(s)s.style.display='none';"></video>
        </div>
      `;
    } else if (cfg.cat === 'audio') {
      bodyHtml = `<audio src="${mediaUrl}" controls autoplay style="width:80%;max-width:500px" onloadeddata="var s=document.getElementById('mediaLoadingSpinner');if(s)s.style.display='none';"></audio>`;
    } else if (/\.pdf$/i.test(fileName) || (mimeType && mimeType.includes('pdf'))) {
      bodyHtml = `<iframe src="${mediaUrl}#toolbar=1" style="width:100%;max-width:1050px;height:82vh;border:none;border-radius:12px;background:#18181b" allowfullscreen onload="var s=document.getElementById('mediaLoadingSpinner');if(s)s.style.display='none';"></iframe>`;
    } else {
      bodyHtml = `
        <div style="text-align:center;padding:2.5rem;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:16px;max-width:450px">
          <i class="fas ${cfg.icon}" style="font-size:3.5rem;color:${cfg.col};margin-bottom:1rem"></i>
          <div style="font-weight:700;font-size:1.1rem;color:var(--text1);margin-bottom:.4rem">${_esc(fileName)}</div>
          <div style="display:flex;gap:8px;justify-content:center;margin-top:1.2rem">
            <a href="${dlUrl}" class="btn-primary sm" download="${_esc(fileName)}"><i class="fas fa-download mr-1"></i> Download File</a>
          </div>
        </div>
      `;
    }

    ov.innerHTML = `
      <div class="media-hd">
        <div class="media-title">
          <i class="fas ${cfg.icon}" style="color:${cfg.col}"></i>
          <span class="truncate" style="max-width:calc(100vw - 160px)">${_esc(fileName)}</span>
        </div>
        <div style="display:flex;gap:.5rem;align-items:center">
          <a href="${dlUrl}" class="icon-btn" download="${_esc(fileName)}" title="Download"><i class="fas fa-download"></i></a>
          <button class="icon-btn" onclick="this.closest('.media-ov').remove()"><i class="fas fa-times"></i></button>
        </div>
      </div>
      <div class="media-body" style="position:relative">
        <div id="mediaLoadingSpinner" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:10">
          <div style="background:rgba(0,0,0,0.65);border:1px solid rgba(255,255,255,0.12);padding:10px 16px;border-radius:30px;display:flex;align-items:center;gap:8px;backdrop-filter:blur(8px)">
            <i class="fas fa-circle-notch fa-spin" style="color:var(--primary);font-size:1rem"></i>
            <span style="font-size:0.78rem;color:var(--text2);font-weight:600">Loading…</span>
          </div>
        </div>
        ${bodyHtml}
      </div>
    `;

    document.body.appendChild(ov);
  };
})();
