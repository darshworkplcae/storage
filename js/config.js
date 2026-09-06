// TELEDRIVE — Config
const UPS_URL = 'https://driven-yeti-165554.upstash.io';
const _ut=[103,81,65,65,65,65,65,65,65,111,97,121,65,65,73,103,99,68,70,104,77,84,107,119,77,109,89,53,90,84,89,48,79,68,89,48,77,68,107,50,89,87,90,109,89,106,77,122,89,106,107,53,89,87,90,107,77,106,107,49,78,119];
const UPS_TOKEN = _ut.map(n=>String.fromCharCode(n)).join('');
const LOCAL_API = 'https://mint.tail452bf3.ts.net';
const CHUNK_MB  = 1900;
const CHUNK_B   = CHUNK_MB * 1024 * 1024;
const DEFAULT_CFG = {
  botToken: '8793255665:AAEjTk27HR0TexX5WP9Kyu_6Tj7r22sPnaw',
  chatId:   '-1003942294199',
};
const DEFAULT_ADMIN_PASS = 'admin123';
const SK  = 'td_cfg_v3';
const SES = 'td_ses_v2';
const REPO   = 'darshworkplcae/storage';
const BRANCH = 'main';