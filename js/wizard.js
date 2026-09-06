// TELEDRIVE — Auto Setup
async function autoSetup(){
  S.db.adminHash=await sha256(DEFAULT_ADMIN_PASS);
  S.db.drives=[{id:uid(),letter:'T',name:'Telegram Drive',color:'#0a84ff',passwordHash:null,createdAt:new Date().toISOString()}];
  S.ses.isAdmin=true; saveSes(); saveCfg();
  const ok=await saveDB();
  if(ok)toast('TeleDrive ready! Admin password: admin123','success');
  else toast('Could not save to Upstash — working offline','warning');
}