// TELEDRIVE — Render
function renderHome(){
  const grid=$('drivesGrid');if(!grid)return;
  const q=($('globalSearch')?.value||'').toLowerCase();
  const drives=q?S.db.drives.filter(d=>d.name.toLowerCase().includes(q)||d.letter.toLowerCase().includes(q)):S.db.drives;
  grid.innerHTML='';
  drives.forEach(d=>{
    const locked=d.passwordHash&&!S.ses.unlocked.includes(d.id)&&!S.ses.isAdmin;
    const sz=S.db.files.filter(f=>f.driveId===d.id).reduce((a,f)=>a+f.size,0);
    const fc=S.db.files.filter(f=>f.driveId===d.id).length;
    const pct=Math.min(100,(sz/(200*1024*1024*1024))*100).toFixed(1);
    const card=document.createElement('div');card.className=`drive-card${locked?' locked':''}`;
    card.style.setProperty('--dc',d.color||'var(--primary)');
    card.innerHTML=`${locked?'<i class="fas fa-lock drive-lock"></i>':''}<div class="drive-icon"><i class="fas fa-hard-drive"></i><div class="drive-letter">${esc(d.letter)}</div></div><div class="drive-info"><div class="drive-name">${esc(d.name)} (${esc(d.letter)}:)</div><div class="drive-bar-bg"><div class="drive-bar-fill" style="width:${pct}%"></div></div><div class="drive-space">${fmt(sz)} used · ${fc} file${fc!==1?'s':''} · Unlimited</div></div>`;
    card.onclick=async()=>{if(locked)await promptPass(d);else nav(d.id);};
    card.oncontextmenu=e=>{e.preventDefault();if(!S.ses.isAdmin)return;showCtx(e,[{i:'fa-folder-open',l:'Open',a:()=>nav(d.id)},{sep:true},{i:'fa-edit',l:'Edit Drive',a:()=>editDriveDialog(d)},{sep:true},{i:'fa-trash',l:'Delete Drive',danger:true,a:()=>confirmDeleteDrive(d)}]);};
    grid.appendChild(card);
  });
  if(S.ses.isAdmin){const add=document.createElement('div');add.className='drive-add';add.innerHTML='<i class="fas fa-plus-circle" style="font-size:1.4rem"></i><span style="font-size:.88rem;font-weight:500">New Drive</span>';add.onclick=()=>createDriveDialog();grid.appendChild(add);}
}

function renderExplorer(){renderSidebar();renderAddrBar();renderContent();syncNavBtns();syncStatus();}

function renderSidebar(){
  const tree=$('sidebarTree');tree.innerHTML='';if(!S.driveId)return;
  const d=S.db.drives.find(x=>x.id===S.driveId);if(!d)return;
  tree.appendChild(mkTreeNode('fa-hard-drive',`${d.letter}: ${d.name}`,!S.folderId,()=>nav(S.driveId,null)));
  renderTreeLevel(tree,null,1);
}
function renderTreeLevel(container,parentId,depth){
  S.db.folders.filter(f=>f.driveId===S.driveId&&f.parentId===parentId).forEach(f=>{
    const n=mkTreeNode('fa-folder',f.name,S.folderId===f.id,()=>nav(S.driveId,f.id));
    n.style.paddingLeft=(0.5+depth*0.75)+'rem';container.appendChild(n);renderTreeLevel(container,f.id,depth+1);
  });
}
function mkTreeNode(icon,label,active,onClick){const n=document.createElement('div');n.className=`tree-node${active?' active':''}`;n.innerHTML=`<i class="fas ${icon}"></i><span class="tree-label">${esc(label)}</span>`;n.onclick=onClick;return n;}

function renderAddrBar(){
  const bar=$('addrBar');bar.innerHTML='';if(!S.driveId)return;
  const d=S.db.drives.find(x=>x.id===S.driveId);if(!d)return;
  const crumbs=[{name:`${d.letter}:`,action:()=>nav(S.driveId,null)}];
  if(S.folderId)getFolderPath(S.folderId).forEach(f=>crumbs.push({name:f.name,action:()=>nav(S.driveId,f.id)}));
  crumbs.forEach((c,i)=>{
    if(i>0){const sep=document.createElement('span');sep.className='bc-sep';sep.innerHTML='<i class="fas fa-chevron-right" style="font-size:.6rem"></i>';bar.appendChild(sep);}
    const bc=document.createElement('div');bc.className=`bc-item${i===crumbs.length-1?' cur':''}`;bc.innerHTML=`<span>${esc(c.name)}</span>`;
    if(i<crumbs.length-1)bc.querySelector('span').onclick=c.action;bar.appendChild(bc);
  });
}
function getFolderPath(fid){const p=[];let cur=S.db.folders.find(f=>f.id===fid);while(cur){p.unshift(cur);cur=cur.parentId?S.db.folders.find(f=>f.id===cur.parentId):null;}return p;}

function renderContent(){
  const content=$('exContent');content.innerHTML='';if(!S.driveId)return;
  const q=($('globalSearch')?.value||'').toLowerCase();
  let folders=S.db.folders.filter(f=>f.driveId===S.driveId&&f.parentId===S.folderId);
  let files=S.db.files.filter(f=>f.driveId===S.driveId&&f.folderId===S.folderId);
  if(q){folders=folders.filter(f=>f.name.toLowerCase().includes(q));files=files.filter(f=>f.name.toLowerCase().includes(q));}
  if(S.filter!=='all'){files=files.filter(f=>{const t=f.type||'';
    if(S.filter==='image')return t.startsWith('image/');if(S.filter==='video')return t.startsWith('video/');
    if(S.filter==='audio')return t.startsWith('audio/');
    if(S.filter==='doc')return t.includes('pdf')||t.includes('word')||t.includes('text')||t.includes('sheet');
    if(S.filter==='ext'&&S.filterExt)return f.name.toLowerCase().endsWith('.'+S.filterExt.toLowerCase());
    return true;
  });}
  const sortFn=(a,b)=>{if(S.sort==='name')return a.name.localeCompare(b.name);if(S.sort==='date')return new Date(b.date||b.createdAt)-new Date(a.date||a.createdAt);if(S.sort==='size')return(b.size||0)-(a.size||0);return 0;};
  folders.sort(sortFn);files.sort(sortFn);
  if(!folders.length&&!files.length){content.innerHTML=`<div class="empty"><i class="fas fa-folder-open"></i><h3>${q?'No results':'Empty'}</h3><p>${q?'Try a different search':'Drop files here or click Upload'}</p></div>`;setupDrop(content);return;}
  if(S.view==='grid'){const g=document.createElement('div');g.className='file-grid';folders.forEach(f=>g.appendChild(mkFolderGrid(f)));files.forEach(f=>g.appendChild(mkFileGrid(f)));content.appendChild(g);}
  else{const l=document.createElement('div');l.className='file-list';folders.forEach(f=>l.appendChild(mkFolderList(f)));files.forEach(f=>l.appendChild(mkFileList(f)));content.appendChild(l);}
  setupDrop(content);
}
function mkFolderGrid(f){const el=document.createElement('div');el.className='f-item folder';const cnt=S.db.files.filter(x=>x.folderId===f.id).length;el.innerHTML=`<div class="f-item-ico">📁</div><div class="f-item-name">${esc(f.name)}</div><div class="f-item-sub">${cnt} item${cnt!==1?'s':''}</div>`;el.onclick=()=>nav(S.driveId,f.id);el.oncontextmenu=e=>{e.preventDefault();showFolderCtx(e,f);};return el;}
function mkFileGrid(f){const el=document.createElement('div');el.className=`f-item${S.selectedId===f.id?' sel':''}`;const cfg=ftCfg(f.type);el.innerHTML=`<div class="f-item-ico">${cfg.em}</div><div class="f-item-name" title="${esc(f.name)}">${esc(f.name)}</div><div class="f-item-sub">${fmt(f.size)}${f.isChunked?' 🔗':''}</div>`;el.onclick=()=>{S.selectedId=f.id;renderContent();};el.ondblclick=()=>openMedia(f);el.oncontextmenu=e=>{e.preventDefault();showFileCtx(e,f);};return el;}
function mkFolderList(f){const el=document.createElement('div');el.className='f-list-item';const cnt=S.db.files.filter(x=>x.folderId===f.id).length;el.innerHTML=`<div class="f-list-ico" style="color:#ffd60a"><i class="fas fa-folder"></i></div><div class="f-list-name">${esc(f.name)}</div><div class="f-list-size">${cnt} items</div><div class="f-list-date">${fmtDate(f.createdAt)}</div>`;el.onclick=()=>nav(S.driveId,f.id);el.oncontextmenu=e=>{e.preventDefault();showFolderCtx(e,f);};return el;}
function mkFileList(f){const el=document.createElement('div');el.className=`f-list-item${S.selectedId===f.id?' sel':''}`;const cfg=ftCfg(f.type);el.innerHTML=`<div class="f-list-ico" style="color:${cfg.color}">${cfg.ico}</div><div class="f-list-name" title="${esc(f.name)}">${esc(f.name)}${f.isChunked?'<span style="color:var(--warning);font-size:.65rem;margin-left:.3rem">🔗</span>':''}</div><div class="f-list-size">${fmt(f.size)}</div><div class="f-list-date">${fmtDate(f.date)}</div>`;el.onclick=()=>{S.selectedId=f.id;renderContent();};el.ondblclick=()=>openMedia(f);el.oncontextmenu=e=>{e.preventDefault();showFileCtx(e,f);};return el;}

function showCtx(e,items){
  document.querySelectorAll('.ctx-menu').forEach(m=>m.remove());
  const menu=document.createElement('div');menu.className='ctx-menu';
  items.forEach(item=>{if(item.sep){const s=document.createElement('div');s.className='ctx-sep';menu.appendChild(s);return;}const el=document.createElement('div');el.className=`ctx-item${item.danger?' danger':''}`;el.innerHTML=`<i class="fas ${item.i}"></i><span>${item.l}</span>`;el.onclick=()=>{menu.remove();item.a();};menu.appendChild(el);});
  document.body.appendChild(menu);
  const x=Math.min(e.clientX,window.innerWidth-190),y=Math.min(e.clientY,window.innerHeight-menu.scrollHeight-10);menu.style.left=x+'px';menu.style.top=y+'px';
  setTimeout(()=>document.addEventListener('click',()=>menu.remove(),{once:true}),0);
}
function showFileCtx(e,f){showCtx(e,[{i:'fa-eye',l:'Preview / Play',a:()=>openMedia(f)},{i:'fa-download',l:'Download',a:()=>downloadFile(f)},{sep:true},{i:'fa-link',l:'Copy Link',a:async()=>{const u=await tgFileUrl(f.chunks[0].fileId);if(u){navigator.clipboard.writeText(u);toast('Link copied','success');}else toast('Could not get link','error');}},{sep:true},{i:'fa-trash',l:'Delete',danger:true,a:()=>confirmDeleteFile(f)}]);}
function showFolderCtx(e,f){showCtx(e,[{i:'fa-folder-open',l:'Open',a:()=>nav(S.driveId,f.id)},{i:'fa-edit',l:'Rename',a:()=>renameFolderDlg(f)},{sep:true},{i:'fa-trash',l:'Delete',danger:true,a:()=>confirmDeleteFolder(f)}]);}

function syncNavBtns(){$('navBack').disabled=S.navIdx<=0;$('navFwd').disabled=S.navIdx>=S.navHist.length-1;$('navUp').disabled=!S.driveId;}
function syncStatus(){const b=$('statusBar');if(!b)return;if(!S.driveId){b.innerHTML='';return;}const fc=S.db.folders.filter(f=>f.driveId===S.driveId&&f.parentId===S.folderId).length;const fi=S.db.files.filter(f=>f.driveId===S.driveId&&f.folderId===S.folderId).length;const sz=S.db.files.filter(f=>f.driveId===S.driveId&&f.folderId===S.folderId).reduce((a,f)=>a+f.size,0);b.innerHTML=`<span>${fc+fi} item${fc+fi!==1?'s':''}</span>${sz?`<span>·</span><span>${fmt(sz)}</span>`:''}`;}

function setupDrop(el){
  el.addEventListener('dragover',e=>{e.preventDefault();if(!el.querySelector('.drop-ov')){const ov=document.createElement('div');ov.className='drop-ov';ov.innerHTML='<i class="fas fa-cloud-upload-alt"></i><span>Drop files to upload</span>';el.style.position='relative';el.appendChild(ov);}});
  el.addEventListener('dragleave',e=>{if(!el.contains(e.relatedTarget))el.querySelector('.drop-ov')?.remove();});
  el.addEventListener('drop',e=>{e.preventDefault();el.querySelector('.drop-ov')?.remove();if(e.dataTransfer.files.length)uploadFiles(e.dataTransfer.files);});
}
function syncAdminUI(){const l=$('logoutBtn');if(l)l.classList.toggle('hidden',!S.ses.isAdmin);}