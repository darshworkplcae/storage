// TELEDRIVE — Router
function nav(driveId,folderId=null){
  if(S.navIdx<S.navHist.length-1)S.navHist=S.navHist.slice(0,S.navIdx+1);
  S.navHist.push({driveId,folderId});S.navIdx=S.navHist.length-1;
  S.driveId=driveId;S.folderId=folderId;S.selectedId=null;
  const d=S.db.drives.find(x=>x.id===driveId);
  if(d)window.location.hash=folderId?`#/${d.letter}/${folderId}`:`#/${d.letter}`;
  showExplorer();
}
function navBack(){if(S.navIdx>0){S.navIdx--;const n=S.navHist[S.navIdx];S.driveId=n.driveId;S.folderId=n.folderId;const d=S.db.drives.find(x=>x.id===n.driveId);if(d)window.location.hash=n.folderId?`#/${d.letter}/${n.folderId}`:`#/${d.letter}`;showExplorer();}}
function navFwd(){if(S.navIdx<S.navHist.length-1){S.navIdx++;const n=S.navHist[S.navIdx];S.driveId=n.driveId;S.folderId=n.folderId;const d=S.db.drives.find(x=>x.id===n.driveId);if(d)window.location.hash=n.folderId?`#/${d.letter}/${n.folderId}`:`#/${d.letter}`;showExplorer();}}
function navUp(){if(!S.driveId)return;if(!S.folderId){goHome();return;}const f=S.db.folders.find(x=>x.id===S.folderId);nav(S.driveId,f?.parentId||null);}
function goHome(){S.driveId=null;S.folderId=null;S.selectedId=null;window.location.hash='#/';$('homeScreen').classList.remove('hidden');$('explorerView').classList.add('hidden');renderHome();}
function showExplorer(){$('homeScreen').classList.add('hidden');$('explorerView').classList.remove('hidden');renderExplorer();}
function handleHash(){
  const hash=window.location.hash;
  if(!hash||hash==='#'||hash==='#/'){if(S.db.adminHash)goHome();return;}
  const parts=hash.slice(2).split('/');
  const letter=parts[0];const folderId=parts[1]||null;
  if(!letter)return;
  const drive=S.db.drives.find(d=>d.letter===letter);
  if(!drive)return;
  const locked=drive.passwordHash&&!S.ses.unlocked.includes(drive.id)&&!S.ses.isAdmin;
  if(locked){promptPass(drive);return;}
  S.driveId=drive.id;S.folderId=folderId;S.selectedId=null;
  if(S.navIdx<S.navHist.length-1)S.navHist=S.navHist.slice(0,S.navIdx+1);
  S.navHist.push({driveId:drive.id,folderId});S.navIdx=S.navHist.length-1;
  showExplorer();
}