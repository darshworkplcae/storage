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

function tmLoad() { try { return JSON.parse(localStorage.getItem(TM_KEY)||'[]'); } catch(e) { return []; } }
function tmSave(l) { try { localStorage.setItem(TM_KEY, JSON.stringify(l.slice(0,50))); } catch(e) {} }
function tmAdd(id, name, size) {
  var l = tmLoad(); l.unshift({id:id,name:name,size:size,status:'uploading',pct:0,speed:0,uploaded:0,ts:new Date().toISOString()});
  tmSave(l); renderTM();
}
function tmUpdate(id, pct, speed, uploaded) {
  speed = speed||0; uploaded = uploaded||0;
  var l = tmLoad(), item = l.find(function(x){return x.id===id;});
  if(item){item.pct=pct;item.speed=speed;item.uploaded=uploaded;} tmSave(l); renderTM();
}
function tmDone(id, ok) {
  ok = (ok!==false);
  var l = tmLoad(), item = l.find(function(x){return x.id===id;});
  if(item){item.status=ok?'done':'failed';item.pct=ok?100:item.pct;item.speed=0;} tmSave(l); renderTM();
}