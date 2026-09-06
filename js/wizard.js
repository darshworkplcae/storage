// TELEDRIVE — Auto Setup
async function autoSetup() {
  S.db.adminHash = await sha256(DEFAULT_ADMIN_PASS);
  S.db.drives = [
    { id:uid(), letter:'T', name:'Telegram Drive', color:'#0a84ff', passwordHash:null, capacity:null, createdAt:new Date().toISOString() },
    { id:uid(), letter:'P', name:'Private', color:'#bf5af2', passwordHash:null, capacity:900, createdAt:new Date().toISOString() }
  ];
  S.db.activityLog = [];
  // NOTE: NOT setting isAdmin here — user must login via /#/admin
  saveCfg();
  const ok = await saveDB();
  if (ok) toast('TeleDrive ready!', 'success');
  else    toast('Could not save to Upstash', 'warning');
}