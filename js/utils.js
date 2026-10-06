// TeleDrive — Utilities
function $(id){return document.getElementById(id);}
function esc(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function fmt(b){if(!b)return '0 B';const u=['B','KB','MB','GB','TB'];let i=0;while(b>=1024&&i<4){b/=1024;i++;}return b.toFixed(i?1:0)+' '+u[i];}
function fmtDate(s){if(!s)return '';const d=new Date(s);return d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});}
function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,7);}
function dlLink(url,name){const a=document.createElement('a');a.href=url;a.download=name||'download';document.body.appendChild(a);a.click();a.remove();}
function ftCfg(name,type){
  const ext=(name||'').split('.').pop().toLowerCase();
  const t=type||'';
  if(t.startsWith('image/')||['jpg','jpeg','png','gif','webp','svg','bmp','ico'].includes(ext))return{icon:'fa-file-image',col:'#30d158',cat:'image'};
  if(t.startsWith('video/')||['mp4','mkv','avi','mov','webm','flv'].includes(ext))return{icon:'fa-file-video',col:'#ff9f0a',cat:'video'};
  if(t.startsWith('audio/')||['mp3','wav','flac','aac','ogg','m4a'].includes(ext))return{icon:'fa-file-audio',col:'#bf5af2',cat:'audio'};
  if(['pdf'].includes(ext))return{icon:'fa-file-pdf',col:'#ff453a',cat:'doc'};
  if(['doc','docx','odt','rtf'].includes(ext))return{icon:'fa-file-word',col:'#0a84ff',cat:'doc'};
  if(['xls','xlsx','csv','ods'].includes(ext))return{icon:'fa-file-excel',col:'#30d158',cat:'doc'};
  if(['ppt','pptx','odp'].includes(ext))return{icon:'fa-file-powerpoint',col:'#ff9f0a',cat:'doc'};
  if(['zip','rar','7z','tar','gz','bz2'].includes(ext))return{icon:'fa-file-zipper',col:'#ff9f0a',cat:'archive'};
  if(['js','ts','py','java','cpp','c','h','css','html','json','xml','sh','rb','go','rs'].includes(ext))return{icon:'fa-file-code',col:'#64d2ff',cat:'code'};
  if(['apk','exe','dmg','msi','deb'].includes(ext))return{icon:'fa-cube',col:'#ff453a',cat:'app'};
  return{icon:'fa-file',col:'#8e8e93',cat:'other'};
}
function toast(msg,type='info',dur=3500){
  const w=$('toastWrap');if(!w)return;
  const t=document.createElement('div');t.className=`toast toast-${type}`;
  const icons={success:'fa-check-circle',error:'fa-times-circle',warning:'fa-exclamation-triangle',info:'fa-info-circle'};
  t.innerHTML=`<i class="fas ${icons[type]||icons.info}"></i><span>${esc(msg)}</span>`;
  w.appendChild(t);requestAnimationFrame(()=>t.classList.add('in'));
  setTimeout(()=>{t.classList.remove('in');setTimeout(()=>t.remove(),350);},dur);
}
function fmtSpeed(bps){if(!bps)return '';const mbs=bps/1048576;return mbs>=1?mbs.toFixed(1)+' MB/s':(bps/1024).toFixed(0)+' KB/s';}