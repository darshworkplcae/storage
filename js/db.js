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
    try { localStorage.setItem(TM_KEY, JSON.stringify(l.slice(0, 1500))); } catch(e) {}
    return;
  }
  if (!_tmSaveTimer) {
    _tmSaveTimer = setTimeout(function() {
      _tmSaveTimer = null;
      try { localStorage.setItem(TM_KEY, JSON.stringify((_tmCache || []).slice(0, 1500))); } catch(e) {}
    }, 350);
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
    if (changed) tmSave(l, true);
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
      tmSave(l, true);
      if (typeof renderTM === 'function') renderTM();
    }
  } catch(e) {}
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
  tmSave(l, true);
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
  var l = tmLoad();
  items.forEach(function(item) {
    var existing = l.find(function(x){ return x.id === item.id || (x.name === item.name && x.size === item.size); });
    if (existing) {
      if (existing.status !== 'done') {
        existing.id = item.id;
        existing.status = 'queued';
        existing.pct = 0;
        existing.uploaded = 0;
        existing.speed = 0;
      }
    } else {
      l.push({
        id: item.id,
        name: item.name,
        size: item.size,
        status: 'queued',
        pct: 0,
        speed: 0,
        uploaded: 0,
        ts: new Date().toISOString()
      });
    }
  });
  tmSave(l, true);
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

function tmDone(id, ok) {
  ok = (ok!==false);
  var l = tmLoad(), item = l.find(function(x){return x.id===id;});
  if(item){
    item.status=ok?'done':'failed';
    item.pct=ok?100:item.pct;
    if(ok) item.uploaded = item.size;
    item.speed=0;
  }
  tmSave(l, true);
  if (typeof renderTM === 'function') renderTM();
}

function tmClear() {
  var l = tmLoad();
  var remaining = l.filter(function(x){ return x.status === 'uploading'; });
  tmSave(remaining, true);
  if (typeof renderTM === 'function') renderTM();
}

function tmClearInterrupted() {
  var l = tmLoad();
  var remaining = l.filter(function(x){ return x.status !== 'interrupted'; });
  tmSave(remaining, true);
  if (typeof renderTM === 'function') renderTM();
}

// Sanitize stale transfers immediately on script evaluation
tmSanitizeOnStartup();