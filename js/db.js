// Session + Transfer manager
var SES_KEY = 'td:ses';
var TM_KEY  = 'td:tm';

function loadSes() {
  try {
    var raw = sessionStorage.getItem(SES_KEY);
    var s = raw ? JSON.parse(raw) : {};
    if (s && typeof s === 'object') {
      Object.assign(S.ses, s);
    }
  } catch (e) { console.warn('loadSes:', e.message); }
}
function saveSes() {
  try { sessionStorage.setItem(SES_KEY, JSON.stringify(S.ses)); } catch (e) {}
}
function clearSes() {
  S.ses = { token: null, role: null, userId: null, username: null, allowedDrives: 'all' };
  try { sessionStorage.removeItem(SES_KEY); } catch (e) {}
}

function tmLoad() {
  try { return JSON.parse(localStorage.getItem(TM_KEY) || '[]'); } catch (e) { return []; }
}
function tmSave(list) {
  try { localStorage.setItem(TM_KEY, JSON.stringify(list.slice(0, 50))); } catch (e) {}
}
function tmAdd(id, name, size) {
  var list = tmLoad();
  list.unshift({ id: id, name: name, size: size, status: 'uploading', pct: 0, speed: 0, uploaded: 0, ts: new Date().toISOString() });
  tmSave(list);
  renderTM();
}
function tmUpdate(id, pct, speed, uploaded) {
  speed = speed || 0; uploaded = uploaded || 0;
  var list = tmLoad();
  var item = list.find(function(x) { return x.id === id; });
  if (item) { item.pct = pct; item.speed = speed; item.uploaded = uploaded; }
  tmSave(list);
  renderTM();
}
function tmDone(id, ok) {
  ok = (ok !== false);
  var list = tmLoad();
  var item = list.find(function(x) { return x.id === id; });
  if (item) { item.status = ok ? 'done' : 'failed'; item.pct = ok ? 100 : item.pct; item.speed = 0; }
  tmSave(list);
  renderTM();
}