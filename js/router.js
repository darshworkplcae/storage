// TeleDrive — Router
function pushNav(driveId,folderId){
  S.navHist=S.navHist.slice(0,S.navIdx+1);
  S.navHist.push({driveId,folderId});
  S.navIdx=S.navHist.length-1;
  updateHash();
}
function navBack(){if(S.navIdx>0){S.navIdx--;const n=S.navHist[S.navIdx];S.driveId=n.driveId;S.folderId=n.folderId;updateHash();renderExplorer();}}
function navFwd(){if(S.navIdx<S.navHist.length-1){S.navIdx++;const n=S.navHist[S.navIdx];S.driveId=n.driveId;S.folderId=n.folderId;updateHash();renderExplorer();}}
function navUp(){
  if(S.folderId){
    const parent=S.db?.folders?.find(f=>f.id===S.folderId)?.parentId||null;
    S.folderId=parent;
    pushNav(S.driveId,S.folderId);renderExplorer();
  }else if(S.driveId){
    S.driveId=null;S.folderId=null;updateHash();
    showScreen('homeScreen');renderHome();
  }
}
function goHome(){S.driveId=null;S.folderId=null;window.location.hash='#/';showScreen('homeScreen');renderHome();}
function updateHash(){
  if(!S.driveId){window.location.hash='#/';return;}
  window.location.hash=S.folderId?`#/${S.driveId}/${S.folderId}`:`#/${S.driveId}`;
}
function handleHash(){
  const h=window.location.hash.replace('#/','').split('/').filter(Boolean);
  if(!h.length){goHome();return;}
  if(h[0]==='admin'){showAdminScreen();return;}
  if(h[0]==='login'){showLoginScreen();return;}
  // Drive navigation
  const driveId=h[0];const folderId=h[1]||null;
  if(!S.db){return;}
  const drive=S.db.drives?.find(d=>d.id===driveId);
  if(!drive){goHome();return;}
  S.driveId=driveId;S.folderId=folderId;
  pushNav(driveId,folderId);
  showScreen('explorerView');syncToolbar();renderExplorer();
}
function showScreen(id){
  ['homeScreen','explorerView','adminScreen','authScreen'].forEach(s=>{
    const el=$(s);if(el)el.classList.toggle('hidden',s!==id);
  });
}
function showAdminScreen(){
  if(S.ses.role!=='admin'){showLoginScreen('admin');return;}
  showScreen('adminScreen');renderAdminScreen();
}
function showLoginScreen(returnTo=''){
  showScreen('authScreen');renderLoginScreen(returnTo);
}
function syncToolbar(){
  const isAdmin=S.ses.role==='admin';
  const admin=$('adminFab');if(admin)admin.classList.toggle('hidden',!isAdmin);
  // Show back-to-home when in drive
  const hb=$('homeBreadBtn');if(hb)hb.classList.toggle('hidden',!S.driveId);
}