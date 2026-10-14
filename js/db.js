var SES_KEY = 'td:ses';
var TM_KEY  = 'td:tm';

function loadSes() {
  try {
    var raw = localStorage.getItem(SES_KEY);
    if (!raw) raw = sessionStorage.getItem(SES_KEY); // migrate from sessionStorage
    var s = raw ? JSON.parse(raw) : {};
    if (s && typeof s === 'object') Object.assign(S.ses, s);
  } catch(e) { console.warn('loadSes:', e); }
}
function saveSes() {
  try { localStorage.setItem(SES_KEY, JSON.stringify(S.ses)); } catch(e) {}
}
function clearSes() {
  S.ses = { token: null, role: null, userId: null, username: null, allowedDrives: 'all' };
  try { localStorage.removeItem(SES_KEY); sessionStorage.removeItem(SES_KEY); } catch(e) {}
}

// ─── Transfer Manager (High-Performance In-Memory Cache & Synchronous Storage) ───
var _tmCache = null;
var _tmSaveTimer = null;
var _tmRenderPending = false;

function tmScheduleRender() {
  if (_tmRenderPending) return;
  _tmRenderPending = true;
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(function() {
      _tmRenderPending = false;
      if (typeof renderTM === 'function') renderTM();
    });
  } else {
    setTimeout(function() {
      _tmRenderPending = false;
      if (typeof renderTM === 'function') renderTM();
    }, 50);
  }
}

function tmLoad() {
  if (_tmCache) return _tmCache;
  try {
    _tmCache = JSON.parse(localStorage.getItem(TM_KEY) || '[]');
  } catch(e) {
    _tmCache = [];
  }
  return _tmCache;
}

function tmSave(l, immediate) {
  _tmCache = l;
  if (immediate) {
    if (_tmSaveTimer) { clearTimeout(_tmSaveTimer); _tmSaveTimer = null; }
    try { localStorage.setItem(TM_KEY, JSON.stringify(l.slice(0, 400))); } catch(e) {}
    return;
  }
  if (!_tmSaveTimer) {
    _tmSaveTimer = setTimeout(function() {
      _tmSaveTimer = null;
      try { localStorage.setItem(TM_KEY, JSON.stringify((_tmCache || []).slice(0, 400))); } catch(e) {}
    }, 400);
  }
}

function tmSanitizeOnStartup() {
  try {
    var l = tmLoad();
    var changed = false;
    l.forEach(function(item) {
      if (item.status === 'uploading' || item.status === 'queued') {
        item.status = 'interrupted';
        item.speed = 0;
        changed = true;
      }
    });
    if (changed) tmSave(l, false);
  } catch(e) {}
}

function tmSyncWithServer(dbFiles) {
  if (!Array.isArray(dbFiles) || !dbFiles.length) return;
  try {
    var l = tmLoad();
    var changed = false;
    var fileMap = new Map();
    dbFiles.forEach(function(f) {
      if (!f.trashed) {
        fileMap.set(f.name + '::' + f.size, f);
      }
    });

    l.forEach(function(item) {
      if (item.status === 'interrupted' || item.status === 'uploading' || item.status === 'queued') {
        if (fileMap.has(item.name + '::' + item.size)) {
          item.status = 'done';
          item.pct = 100;
          item.speed = 0;
          item.uploaded = item.size;
          changed = true;
        }
      }
    });

    if (changed) {
      tmSave(l, false);
      tmScheduleRender();
    }
  } catch(e) {}
}

function cacheDBLocally(db) {
  if (!db || typeof db !== 'object') return;
  try {
    localStorage.setItem('td_cached_db', JSON.stringify({
      v: db.v,
      openDriveId: db.openDriveId,
      openDriveIds: db.openDriveIds,
      policy: db.policy,
      drives: db.drives,
      folders: db.folders,
      files: (db.files || []).slice(0, 15000),
      time: Date.now()
    }));
  } catch(e) {}
}

function getCachedLocalDB() {
  try {
    var raw = localStorage.getItem('td_cached_db');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch(e) {
    return null;
  }
}

function tmAdd(id, name, size) {
  var l = tmLoad();
  var existing = l.find(function(x){ return x.id === id || (x.name === name && x.size === size); });
  if (existing) {
    existing.id = id;
    existing.status = 'uploading';
    existing.speed = 0;
  } else {
    l.unshift({id:id,name:name,size:size,status:'uploading',pct:0,speed:0,uploaded:0,ts:new Date().toISOString()});
  }
  tmSave(l, false);
  tmScheduleRender();
}

function tmAddQueued(id, name, size) {
  var l = tmLoad();
  var existing = l.find(function(x){ return x.id === id || (x.name === name && x.size === size); });
  if (!existing) {
    l.push({id:id,name:name,size:size,status:'queued',pct:0,speed:0,uploaded:0,ts:new Date().toISOString()});
    tmSave(l, true);
  }
}

function tmAddBatchQueued(items) {
  if (!items || !items.length) return;
  var l = tmLoad();
  var map = new Map();
  l.forEach(function(x) {
    if (x.id) map.set(x.id, x);
    map.set((x.name || '') + '::' + (x.size || 0), x);
  });
  items.forEach(function(item) {
    var key = (item.name || '') + '::' + (item.size || 0);
    var existing = map.get(item.id) || map.get(key);
    if (existing) {
      if (existing.status !== 'done') {
        existing.id = item.id;
        existing.status = 'queued';
        existing.pct = 0;
        existing.uploaded = 0;
        existing.speed = 0;
      }
    } else {
      var newItem = {
        id: item.id,
        name: item.name,
        size: item.size,
        status: 'queued',
        pct: 0,
        speed: 0,
        uploaded: 0,
        ts: new Date().toISOString()
      };
      l.push(newItem);
      map.set(item.id, newItem);
      map.set(key, newItem);
    }
  });
  tmSave(l, false);
  tmScheduleRender();
}

function tmUpdate(id, pct, speed, uploaded) {
  speed = speed||0; uploaded = uploaded||0;
  var l = tmLoad(), item = l.find(function(x){return x.id===id;});
  if(item){
    item.status='uploading';
    item.pct=pct;
    item.speed=speed;
    item.uploaded=uploaded;
  }
  tmSave(l, false);
  tmScheduleRender();
}

function tmDone(id, ok, errorMsg) {
  ok = (ok!==false);
  var l = tmLoad(), item = l.find(function(x){return x.id===id;});
  if(item){
    item.status=ok?'done':'failed';
    item.pct=ok?100:item.pct;
    if(ok) {
      item.uploaded = item.size;
      delete item.error;
    } else if (errorMsg) {
      item.error = String(errorMsg);
    }
    item.speed=0;
  }
  tmSave(l, false);
  tmScheduleRender();
}

function tmBatchDone(doneIds) {
  if (!doneIds || !doneIds.length) return;
  var l = tmLoad();
  var set = new Set(doneIds);
  var changed = false;
  l.forEach(function(item) {
    if (set.has(item.id)) {
      item.status = 'done';
      item.pct = 100;
      item.uploaded = item.size;
      item.speed = 0;
      delete item.error;
      changed = true;
    }
  });
  if (changed) {
    tmSave(l, false);
    tmScheduleRender();
  }
}

function tmDismissSingle(id) {
  var l = tmLoad();
  var remaining = l.filter(function(x){ return x.id !== id; });
  tmSave(remaining, false);
  tmScheduleRender();
}

function tmClearFailed() {
  var l = tmLoad();
  var remaining = l.filter(function(x){ return x.status !== 'failed'; });
  tmSave(remaining, false);
  tmScheduleRender();
}

function tmClearDone() {
  var l = tmLoad();
  var remaining = l.filter(function(x){ return x.status !== 'done'; });
  tmSave(remaining, false);
  tmScheduleRender();
}

function tmClear() {
  var l = tmLoad();
  var hasDone = l.some(function(x){ return x.status === 'done'; });
  var hasFailed = l.some(function(x){ return x.status === 'failed'; });
  if (hasDone && hasFailed) {
    var remaining = l.filter(function(x){ return x.status !== 'done'; });
    tmSave(remaining, true);
    if (typeof toast === 'function') toast('Cleared completed transfers (failed items kept for retry)', 'info');
  } else {
    var remaining = l.filter(function(x){ return x.status === 'uploading'; });
    tmSave(remaining, false);
  }
  tmScheduleRender();
}

function tmClearInterrupted() {
  var l = tmLoad();
  var remaining = l.filter(function(x){ return x.status !== 'interrupted'; });
  tmSave(remaining, false);
  try { localStorage.removeItem('td_active_batch'); } catch(e){}
  tmScheduleRender();
  if (typeof toast === 'function') toast('Dismissed interrupted transfers', 'info');
}

// Sanitize stale transfers immediately on script evaluation
tmSanitizeOnStartup();