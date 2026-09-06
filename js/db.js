// TELEDRIVE — Database (Upstash Redis)
function loadCfg(){S.cfg={...DEFAULT_CFG};try{const s=JSON.parse(localStorage.getItem(SK)||'{}');if(s.botToken)S.cfg.botToken=s.botToken;if(s.chatId)S.cfg.chatId=s.chatId;}catch{}if(!S.cfg.botToken)S.cfg.botToken=DEFAULT_CFG.botToken;if(!S.cfg.chatId)S.cfg.chatId=DEFAULT_CFG.chatId;}
function saveCfg(){localStorage.setItem(SK,JSON.stringify({botToken:S.cfg.botToken,chatId:S.cfg.chatId}));}
function loadSes(){try{Object.assign(S.ses,JSON.parse(sessionStorage.getItem(SES)||'{}'));}catch{}}
function saveSes(){sessionStorage.setItem(SES,JSON.stringify(S.ses));}

async function upsGet(key){
  try{const r=await fetch(`${UPS_URL}/get/${key}`,{headers:{Authorization:`Bearer ${UPS_TOKEN}`}});const d=await r.json();return d.result?JSON.parse(d.result):null;}
  catch(e){console.error('upsGet',e);return null;}
}
async function upsSet(key,value){
  try{const r=await fetch(`${UPS_URL}/set/${key}`,{method:'POST',headers:{Authorization:`Bearer ${UPS_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(JSON.stringify(value))});const d=await r.json();return d.result==='OK';}
  catch(e){console.error('upsSet',e);return false;}
}
async function loadDB(){
  try{const data=await upsGet('td:db');if(data&&data.v){S.db=data;return true;}return true;}
  catch(e){console.error('loadDB',e);return false;}
}
async function saveDB(){return await upsSet('td:db',S.db);}