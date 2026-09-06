// TELEDRIVE — Utilities
function $(id){return document.getElementById(id);}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function fmt(b){if(!b)return'0 B';const k=1024,s=['B','KB','MB','GB','TB'],i=Math.floor(Math.log(b)/Math.log(k));return(b/Math.pow(k,i)).toFixed(2)+' '+s[i];}
function fmtDate(s){if(!s)return'';const d=new Date(s),now=new Date(),df=(now-d)/1e3;if(df<60)return'Just now';if(df<3600)return Math.floor(df/60)+'m ago';if(df<86400)return Math.floor(df/3600)+'h ago';if(df<604800)return Math.floor(df/86400)+'d ago';return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});}
function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,6);}
async function sha256(str){const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(str));return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');}
function toast(msg,type='info'){const wrap=$('toastWrap');const el=document.createElement('div');el.className=`toast ${type}`;el.innerHTML=`<div class="toast-dot"></div><span>${msg}</span>`;wrap.appendChild(el);setTimeout(()=>{el.classList.add('hide');setTimeout(()=>el.remove(),300);},3200);}
function dlLink(url,name){const a=document.createElement('a');a.href=url;a.download=name;a.target='_blank';a.click();}
function ftCfg(t=''){
  if(t.startsWith('image/'))return{em:'🖼️',ico:'<i class="fas fa-image"></i>',color:'#ff375f'};
  if(t.startsWith('video/'))return{em:'🎬',ico:'<i class="fas fa-video"></i>',color:'#bf5af2'};
  if(t.startsWith('audio/'))return{em:'🎵',ico:'<i class="fas fa-music"></i>',color:'#ff9f0a'};
  if(t.includes('pdf'))return{em:'📄',ico:'<i class="fas fa-file-pdf"></i>',color:'#ff453a'};
  if(t.includes('zip')||t.includes('rar')||t.includes('7z')||t.includes('tar'))return{em:'📦',ico:'<i class="fas fa-file-zipper"></i>',color:'#ffd60a'};
  if(t.includes('word')||t.includes('document'))return{em:'📝',ico:'<i class="fas fa-file-word"></i>',color:'#0a84ff'};
  if(t.includes('sheet')||t.includes('excel'))return{em:'📊',ico:'<i class="fas fa-file-excel"></i>',color:'#30d158'};
  if(t.includes('text/'))return{em:'📃',ico:'<i class="fas fa-file-lines"></i>',color:'#64d2ff'};
  return{em:'📁',ico:'<i class="fas fa-file"></i>',color:'#8e8e93'};
}