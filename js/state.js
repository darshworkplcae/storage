// TeleDrive — App State
const S = {
  db: null,           // loaded from API
  driveId: null,
  folderId: null,
  view: 'grid',
  sort: 'name',
  filter: 'all',
  filterExt: '',
  uploading: false,
  cancelUpload: false,
  navHist: [],
  navIdx: -1,
  ses: {
    token: null,
    role: null,       // 'admin' | 'user' | null
    userId: null,
    username: null,
    allowedDrives: 'all',
  },
};