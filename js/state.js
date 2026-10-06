// Global state - use var so all scripts can access it
var S = {
  db: null,
  ses: { token: null, role: null, userId: null, username: null, allowedDrives: 'all' },
  view: 'md',
  sort: 'name',
  filter: 'all',
  listMode: false,
  cancelUpload: false,
  _xhr: null
};