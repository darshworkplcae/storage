// TELEDRIVE — Global State
const S = {
  db:  { v:2, adminHash:'', drives:[], folders:[], files:[] },
  cfg: { botToken:'', chatId:'' },
  ses: { isAdmin:false, unlocked:[] },
  driveId:null, folderId:null, selectedId:null,
  navHist:[], navIdx:-1,
  view:'grid', sort:'name',
  filter:'all', filterExt:'',
  uploading:false, cancelUpload:false, _xhr:null,
};