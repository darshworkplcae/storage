const SES='td:ses',TM='td:tm';
function loadSes(){try{const s=JSON.parse(sessionStorage.getItem(SES)||'{}');Object.assign(S.ses,s);}catch{}}
function saveSes(){sessionStorage.setItem(SES,JSON.stringify(S.ses));}
function clearSes(){S.ses={token:null,role:null,userId:null,username:null,allowedDrives:'all'};sessionStorage.removeItem(SES);}
function tmLoad(){try{return JSON.parse(localStorage.getItem(TM)||'[]');}catch{return[];}}
function tmSave(l){localStorage.setItem(TM,JSON.stringify(l.slice(0,50)));}
function tmAdd(id,name,size){const l=tmLoad();l.unshift({id,name,size,status:'uploading',pct:0,speed:0,uploaded:0,ts:new Date().toISOString()});tmSave(l);renderTM();}
function tmUpdate(id,pct,speed=0,uploaded=0){const l=tmLoad();const t=l.find(x=>x.id===id);if(t){t.pct=pct;t.speed=speed;t.uploaded=uploaded;}tmSave(l);renderTM();}
function tmDone(id,ok=true){const l=tmLoad();const t=l.find(x=>x.id===id);if(t){t.status=ok?'done':'failed';t.pct=ok?100:t.pct;t.speed=0;}tmSave(l);renderTM();}