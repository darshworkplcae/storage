// TELEDRIVE — Database (Upstash Redis)
function loadCfg(){S.cfg={...DEFAULT_CFG};try{const s=JSON.parse(localStorage.getItem(SK)||'{}');if(s.botToken)S.cfg.botToken=s.botToken;if(s.chatId)S.cfg.chatId=s.chatId;}catch{}if(!S.cfg.botToken)S.cfg.botToken=DEFAULT_CFG.botToken;if(!S.cfg.chatId)S.cfg.chatId=DEFAULT_CFG.chatId;}
function saveCfg(){localStorage.setItem(SK,JSON.stringify({botToken:S.cfg.botToken,chatId:S.cfg.chatId}));}
function loadSes(){try{Object.assign(S.ses,JSON.parse(sessionStorage.getItem(SES)||'{}'));}catch{}}
function saveSes(){sessionStorage.setItem(SES,JSON.stringify(S.ses));}

async function upsGet(key){
  const r=await fetch(`${UPS_URL}/get/${encodeURIComponent(key)}`,{headers:{Authorization:`Bearer ${UPS_TOKEN}`}});
  const d=await r.json();
  if(d.result===null||d.result===undefined)return null;
  if(typeof d.result==='object')return d.result;
  let v=d.result;
  try{v=JSON.parse(v);}catch{}
  if(typeof v==='string'){try{v=JSON.parse(v);}catch{}}
  return v;
}
async function upsSet(key,value){
  try{
    const r=await fetch(`${UPS_URL}/set/${encodeURIComponent(key)}`,{method:'POST',headers:{Authorization:`Bearer ${UPS_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(value)});
    const d=await r.json();return d.result==='OK';
  }catch(e){console.error('upsSet',e);return false;}
}

// Returns: 'ok' (loaded), 'empty' (first run), 'error' (network fail)
async function loadDB(){
  try{
    const data=await upsGet('td:db');
    if(data===null)return 'empty';
    if(data&&(data.v||data.adminHash)){
      S.db=data;
      if(!S.db.activityLog)S.db.activityLog=[];
      if(!S.db.folders)S.db.folders=[];
      if(!S.db.files)S.db.files=[];
      return 'ok';
    }
    return 'empty';
  }catch(e){console.error('loadDB error',e);return 'error';}
}
async function saveDB(){
  const ok=await upsSet('td:db',S.db);
  if(!ok)toast('⚠️ Save failed — check connection','warning');
  return ok;
}

// Activity log
function logActivity(type,name,details={}){
  if(!S.db.activityLog)S.db.activityLog=[];
  const drive=S.db.drives.find(d=>d.id===(details.driveId||S.driveId));
  S.db.activityLog.unshift({id:uid(),type,name,driveId:details.driveId||S.driveId,driveLetter:drive?.letter||'?',size:details.size||0,ts:new Date().toISOString()});
  if(S.db.activityLog.length>500)S.db.activityLog=S.db.activityLog.slice(0,500);
}

// Transfer manager (localStorage — survives page refresh, not Upstash)
const TM_KEY='td:transfers';
function tmLoad(){try{return JSON.parse(localStorage.getItem(TM_KEY)||'[]');}catch{return [];}}
function tmSave(list){localStorage.setItem(TM_KEY,JSON.stringify(list.slice(0,50)));}
function tmAdd(id,name,size){
  const list=tmLoad();
  list.unshift({id,name,size,status:'uploading',progress:0,speed:0,uploaded:0,ts:new Date().toISOString()});
  tmSave(list);renderTransferPanel();
}
function tmUpdate(id,progress,speed=0,uploaded=0,total=0){
  const list=tmLoad();const t=list.find(x=>x.id===id);
  if(t){t.progress=progress;t.speed=speed;t.uploaded=uploaded;t.total=total||t.size;}
  tmSave(list);renderTransferPanel();
}
function tmDone(id,ok=true){
  const list=tmLoad();const t=list.find(x=>x.id===id);
  if(t){t.status=ok?'done':'failed';t.progress=ok?100:t.progress;t.speed=0;}
  tmSave(list);renderTransferPanel();
}