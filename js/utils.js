function $(id) { return document.getElementById(id); }
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmt(bytes) {
  bytes = Number(bytes) || 0;
  if (bytes >= 1099511627776) return (bytes/1099511627776).toFixed(1)+' TB';
  if (bytes >= 1073741824)    return (bytes/1073741824).toFixed(1)+' GB';
  if (bytes >= 1048576)       return (bytes/1048576).toFixed(1)+' MB';
  if (bytes >= 1024)          return (bytes/1024).toFixed(1)+' KB';
  return bytes+' B';
}
function fmtSpeed(bps) {
  return fmt(bps)+'/s';
}
function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString(); } catch(e) { return iso; }
}
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function toast(msg, type) {
  type = type || 'info';
  var wrap = $('toastWrap'); if (!wrap) return;
  var el = document.createElement('div');
  el.className = 'toast toast-' + type;
  var icons = { success:'check-circle', error:'times-circle', warning:'exclamation-triangle', info:'info-circle' };
  el.innerHTML = '<i class="fas fa-' + (icons[type]||'info-circle') + '"></i> ' + esc(msg);
  wrap.appendChild(el);
  requestAnimationFrame(function() { el.classList.add('in'); });
  setTimeout(function() { el.classList.remove('in'); setTimeout(function() { el.remove(); }, 350); }, 3500);
}
function ftCfg(name, mime) {
  var ext = (name||'').split('.').pop().toLowerCase();
  var m = mime || '';
  if (m.startsWith('image/') || ['jpg','jpeg','png','gif','webp','svg','bmp','ico'].includes(ext)) return { icon:'fa-file-image', col:'#30d158', cat:'image' };
  if (m.startsWith('video/') || ['mp4','mkv','avi','mov','webm','flv','wmv'].includes(ext)) return { icon:'fa-file-video', col:'#ff9f0a', cat:'video' };
  if (m.startsWith('audio/') || ['mp3','flac','wav','aac','ogg','m4a'].includes(ext)) return { icon:'fa-file-audio', col:'#bf5af2', cat:'audio' };
  if (['pdf'].includes(ext)) return { icon:'fa-file-pdf', col:'#ff453a', cat:'doc' };
  if (['doc','docx'].includes(ext)) return { icon:'fa-file-word', col:'#4e86f5', cat:'doc' };
  if (['xls','xlsx','csv'].includes(ext)) return { icon:'fa-file-excel', col:'#30d158', cat:'doc' };
  if (['ppt','pptx'].includes(ext)) return { icon:'fa-file-powerpoint', col:'#ff6b35', cat:'doc' };
  if (['txt','md','log','json','xml','yaml','yml','ini','cfg'].includes(ext)) return { icon:'fa-file-lines', col:'#8f91a8', cat:'doc' };
  if (['zip','rar','7z','tar','gz','bz2'].includes(ext)) return { icon:'fa-file-zipper', col:'#ff9f0a', cat:'archive' };
  if (['js','ts','py','java','c','cpp','cs','go','rs','php','rb','html','css'].includes(ext)) return { icon:'fa-file-code', col:'#64d2ff', cat:'doc' };
  return { icon:'fa-file', col:'#8f91a8', cat:'other' };
}

function isFolderDescendant(childId, ancestorId) {
  if (!childId || !ancestorId) return false;
  if (childId === ancestorId) return true;
  var db = (typeof S !== 'undefined' && S.db) ? S.db : {};
  var folders = db.folders || [];
  var curr = folders.find(function(f){ return f.id === childId; });
  var visited = new Set();
  while (curr && !visited.has(curr.id)) {
    visited.add(curr.id);
    if (curr.parentId === ancestorId) return true;
    curr = curr.parentId ? folders.find(function(f){ return f.id === curr.parentId; }) : null;
  }
  return false;
}

function getFirstLockedFolder(folderId) {
  if (!folderId) return null;
  var db = (typeof S !== 'undefined' && S.db) ? S.db : {};
  var folders = db.folders || [];
  var curr = folders.find(function(f){ return f.id === folderId; });
  var visited = new Set();
  while (curr && !visited.has(curr.id)) {
    visited.add(curr.id);
    if (curr.isLocked && typeof isFolderCurrentlyUnlocked === 'function' && !isFolderCurrentlyUnlocked(curr.id)) {
      return curr;
    }
    curr = curr.parentId ? folders.find(function(f){ return f.id === curr.parentId; }) : null;
  }
  return null;
}