/* stocké — app.js (full version) */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDatabase, ref, onValue, push, remove, update, get } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const firebaseConfig = { apiKey:"AIzaSyDZ-SHcvAXcaBybYf6qZfduoDPPw6ljL1g", authDomain:"stocke-23237.firebaseapp.com", databaseURL:"https://stocke-23237-default-rtdb.firebaseio.com", projectId:"stocke-23237,", storageBucket:"stocke-23237.firebasestorage.app", messagingSenderId:"1071402774871,", appId:"1:1071402774871:web:4d4e2034b1b88d218c8e12" };
const firebaseApp=initializeApp(firebaseConfig), auth=getAuth(firebaseApp), db=getDatabase(firebaseApp);

const EMOJIS=['🧻','🧴','🧹','🪣','🧺','🐾','🐶','🐱','🐟','🥫','🍚','🥤','💊','🩺','🪥','🧼','🛁','🍶','🧃','🫙','🍞','🥛','☕','🫧','🧽','🗑'];
const CAT_EMOJI={'日用品':'🏠','ペット用品':'🐾','食品・飲料':'🥦','洗剤・清掃':'🧴','薬・衛生':'💊','その他':'📦'};
const PCT_LABELS={100:'満タン',75:'75%',50:'半分',25:'残り少し',0:'空'};

let items=[],allHistory={},activeTab='全て',currentPage='home',editFirebaseKey=null,selectedEmoji='🛒',uploadedImg=null,dbUnsubscribe=null,histUnsubscribe=null,currentMode='count',currentAutoMode='manual',selectedPct=100,viewYear=new Date().getFullYear(),viewMonth=new Date().getMonth();

function showToast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2500);}
function setSyncStatus(status,label){const dot=document.getElementById('sync-dot');dot.className='sync-dot'+(status==='ok'?'':status==='loading'?' loading':' error');document.getElementById('sync-label').textContent=label;}
function getStatus(item){
  if(item.mode==='percent'){const p=item.percent??100,th=item.pctThreshold??25;if(p<=0)return 'low';if(p<=th/2)return 'low';if(p<=th)return 'warn';return 'ok';}
  if(item.stock===0)return 'low';if(item.stock<=Math.floor(item.threshold/2))return 'low';if(item.stock<=item.threshold)return 'warn';return 'ok';
}
function getAllCats(){return['全て',...new Set(items.map(i=>i.cat))];}
function fmtCurrency(n){return'¥'+Math.round(n).toLocaleString();}
function fmtMonth(y,m){return`${y}年${m+1}月`;}

function calcLearnedPace(history){
  if(!history||history.length<2)return null;
  const sorted=[...history].sort((a,b)=>a.ts-b.ts);let td=0,tdays=0;
  for(let i=1;i<sorted.length;i++){const delta=sorted[i-1].val-sorted[i].val,days=(sorted[i].ts-sorted[i-1].ts)/86400000;if(delta>0&&days>0){td+=delta;tdays+=days;}}
  return tdays>0?td/tdays:null;
}

async function runAutoConsumption(){
  const today=new Date().toDateString();
  for(const item of items){
    if(!item.autoEnabled||item.lastAutoDate===today)continue;
    let pace=null;
    if(item.autoMode==='learn'){const snap=await get(ref(db,`inventory/history/${item._key}`));const hist=snap.val()?Object.values(snap.val()):[];pace=calcLearnedPace(hist)??item.manualPace??1;}
    else{pace=item.manualPace??1;}
    if(item.mode==='percent'){const nP=Math.max(0,(item.percent??100)-pace);await update(ref(db,`inventory/items/${item._key}`),{percent:Math.round(nP),lastAutoDate:today});}
    else{const nS=Math.max(0,(item.stock??0)-pace);await update(ref(db,`inventory/items/${item._key}`),{stock:Math.round(nS*10)/10,lastAutoDate:today});}
  }
}

async function recordHistory(key,newVal,consumed,price){
  const cost=(consumed>0&&price>0)?consumed*price:0;
  const item=items.find(i=>i._key===key)||{};
  await push(ref(db,`inventory/history/${key}`),{ts:Date.now(),val:newVal,consumed,cost,itemName:item.name||'',cat:item.cat||''});
  const snap=await get(ref(db,`inventory/history/${key}`));
  if(snap.val()){const entries=Object.entries(snap.val()).sort((a,b)=>a[1].ts-b[1].ts);if(entries.length>50)for(let i=0;i<entries.length-50;i++)await remove(ref(db,`inventory/history/${key}/${entries[i][0]}`));}
}

function showScreen(name){document.getElementById('auth-screen').style.display=name==='login'?'flex':'none';document.getElementById('register-screen').style.display=name==='register'?'flex':'none';document.getElementById('app-screen').style.display=name==='app'?'block':'none';}
function showPage(name){currentPage=name;document.getElementById('page-home').style.display=name==='home'?'block':'none';document.getElementById('page-history').style.display=name==='history'?'block':'none';document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.page===name));if(name==='history')renderHistoryPage();}
document.querySelectorAll('.nav-btn').forEach(btn=>btn.addEventListener('click',()=>showPage(btn.dataset.page)));

function authErrorMessage(code){
  switch(code){case'auth/invalid-email':return'メールアドレスの形式が正しくありません';case'auth/user-not-found':return'このメールアドレスは登録されていません';case'auth/wrong-password':return'パスワードが正しくありません';case'auth/invalid-credential':return'メールアドレスまたはパスワードが正しくありません';case'auth/email-already-in-use':return'このメールアドレスはすでに登録されています';case'auth/weak-password':return'パスワードは6文字以上にしてください';case'auth/too-many-requests':return'しばらく時間をおいてから再試行してください';default:return'エラーが発生しました（'+code+'）';}
}

document.getElementById('btn-login').addEventListener('click',async()=>{
  const errEl=document.getElementById('auth-error');errEl.style.display='none';
  const email=document.getElementById('auth-email').value.trim(),pass=document.getElementById('auth-password').value;
  if(!email||!pass){errEl.textContent='メールアドレスとパスワードを入力してください';errEl.style.display='block';return;}
  try{await signInWithEmailAndPassword(auth,email,pass);}catch(e){errEl.textContent=authErrorMessage(e.code);errEl.style.display='block';}
});
document.getElementById('btn-go-register').addEventListener('click',()=>showScreen('register'));
document.getElementById('btn-go-login').addEventListener('click',()=>showScreen('login'));
document.getElementById('btn-register').addEventListener('click',async()=>{
  const errEl=document.getElementById('reg-error');errEl.style.display='none';
  const email=document.getElementById('reg-email').value.trim(),pass=document.getElementById('reg-password').value,pass2=document.getElementById('reg-password2').value;
  if(!email||!pass){errEl.textContent='メールアドレスとパスワードを入力してください';errEl.style.display='block';return;}
  if(pass.length<6){errEl.textContent='パスワードは6文字以上にしてください';errEl.style.display='block';return;}
  if(pass!==pass2){errEl.textContent='パスワードが一致しません';errEl.style.display='block';return;}
  try{await createUserWithEmailAndPassword(auth,email,pass);showToast('登録しました。ようこそ！');}catch(e){errEl.textContent=authErrorMessage(e.code);errEl.style.display='block';}
});
document.getElementById('btn-logout').addEventListener('click',async()=>{
  if(dbUnsubscribe){dbUnsubscribe();dbUnsubscribe=null;}if(histUnsubscribe){histUnsubscribe();histUnsubscribe=null;}
  await signOut(auth);showScreen('login');
});
onAuthStateChanged(auth,(user)=>{
  if(user){document.getElementById('user-label').textContent=user.email;showScreen('app');showPage('home');startRealtimeSync();startHistorySync();}
  else{if(dbUnsubscribe){dbUnsubscribe();dbUnsubscribe=null;}if(histUnsubscribe){histUnsubscribe();histUnsubscribe=null;}items=[];allHistory={};showScreen('login');}
});

function startRealtimeSync(){
  setSyncStatus('loading','接続中...');
  dbUnsubscribe=onValue(ref(db,'inventory/items'),async(snap)=>{
    const data=snap.val();
    if(data){items=Object.entries(data).map(([k,v])=>({...v,_key:k}));await runAutoConsumption();}else{items=[];await initDefaultItems();}
    setSyncStatus('ok','リアルタイム同期中');render();
  },err=>{setSyncStatus('error','接続エラー');console.error(err);});
}
function startHistorySync(){
  histUnsubscribe=onValue(ref(db,'inventory/history'),(snap)=>{
    const data=snap.val()||{};allHistory={};
    for(const[key,entries]of Object.entries(data)){allHistory[key]=Object.values(entries).sort((a,b)=>a.ts-b.ts);}
    if(currentPage==='history')renderHistoryPage();
  });
}
async function initDefaultItems(){
  const defaults=[
    {name:'トイレットペーパー',cat:'日用品',mode:'count',stock:1,threshold:3,unit:'個',price:498,emoji:'🧻',img:null,autoEnabled:false},
    {name:'シャンプー',cat:'日用品',mode:'count',stock:5,threshold:2,unit:'本',price:698,emoji:'🧴',img:null,autoEnabled:false},
    {name:'ワンちゃんのエサ',cat:'ペット用品',mode:'count',stock:2,threshold:2,unit:'袋',price:1580,emoji:'🐾',img:null,autoEnabled:false},
    {name:'猫砂',cat:'ペット用品',mode:'percent',percent:75,pctThreshold:25,price:980,emoji:'🐱',img:null,autoEnabled:false},
    {name:'食器用洗剤',cat:'洗剤・清掃',mode:'count',stock:1,threshold:2,unit:'本',price:298,emoji:'🧹',img:null,autoEnabled:false},
    {name:'お米',cat:'食品・飲料',mode:'percent',percent:50,pctThreshold:25,price:2980,emoji:'🍚',img:null,autoEnabled:false},
  ];
  for(const item of defaults)await push(ref(db,'inventory/items'),item);
}

function render(){renderTabs();renderAlerts();renderList();}
function renderTabs(){document.getElementById('tabs').innerHTML=getAllCats().map(c=>`<button class="tab${activeTab===c?' active':''}" data-tab="${c}">${CAT_EMOJI[c]||'📋'} ${c}</button>`).join('');}
function renderAlerts(){const low=items.filter(i=>getStatus(i)!=='ok');document.getElementById('alert-area').innerHTML=low.length?`<div class="alert-banner"><span class="alert-dot"></span>在庫が少ない商品が${low.length}件あります：${low.map(i=>i.name).join('、')}</div>`:'';}

function cardHTML(item){
  const st=getStatus(item);
  const badges={ok:'<span class="status-badge badge-ok">十分</span>',warn:'<span class="status-badge badge-warn">少ない</span>',low:'<span class="status-badge badge-low">要補充</span>'};
  const imgEl=item.img?`<div class="card-img"><img src="${item.img}" alt="${item.name}"></div>`:`<div class="card-img">${item.emoji}</div>`;
  const priceEl=item.price?`<div class="card-price">¥${Number(item.price).toLocaleString()}</div>`:'';
  let ctrl='';
  if(item.mode==='percent'){
    const pct=item.percent??100,fillCls=st==='ok'?'fill-ok':st==='warn'?'fill-warn':'fill-low';
    const steps=[100,75,50,25,0].map(p=>`<button class="pct-step-btn${pct===p?' current':''}" data-pct-step="${item._key}" data-pct="${p}" data-prev="${pct}">${PCT_LABELS[p]}</button>`).join('');
    ctrl=`<div class="percent-bar-wrap"><div class="percent-bar-bg"><div class="percent-bar-fill ${fillCls}" style="width:${pct}%"></div></div><div class="percent-label">${PCT_LABELS[pct]??pct+'%'}</div><div class="pct-step-row">${steps}</div></div>`;
  }else{ctrl=`<div class="stepper"><button class="step-btn" data-step="${item._key}" data-delta="-1" data-price="${item.price||0}">−</button><span class="step-val num-${st}">${item.stock??0}</span><span style="font-size:11px;color:var(--brown-mid)">${item.unit||'個'}</span><button class="step-btn" data-step="${item._key}" data-delta="1" data-price="${item.price||0}">＋</button></div>`;}
  const autoBadge=item.autoEnabled?`<div class="auto-badge ${item.autoMode==='learn'?'learn':'on'}">${item.autoMode==='learn'?'🧠 自動学習':'⏱ 自動消費'}</div>`:'';
  return `<div class="card ${st==='ok'?'':st}" data-key="${item._key}">${imgEl}<div class="card-name" title="${item.name}">${item.name}</div>${priceEl}<div class="card-cat">${item.cat}</div><div class="stock-row"><span style="font-size:12px;color:var(--brown-mid)">残量</span>${badges[st]}</div>${ctrl}${autoBadge}</div>`;
}
function carouselSectionHTML(cat,catItems,index){
  const id=`carousel-${index}`;
  return `<div class="carousel-section"><div class="carousel-header"><div class="section-title">${CAT_EMOJI[cat]||'📦'} ${cat}</div><span class="carousel-count">${catItems.length}件</span></div><div class="carousel-track-wrap"><button class="carousel-arrow prev" data-target="${id}">‹</button><div class="carousel-track" id="${id}">${catItems.map(cardHTML).join('')}</div><button class="carousel-arrow next" data-target="${id}">›</button></div><div class="carousel-dots" id="${id}-dots">${catItems.map((_,i)=>`<div class="carousel-dot${i===0?' active':''}" data-target="${id}" data-index="${i}"></div>`).join('')}</div></div>`;
}
function renderList(){
  const filtered=activeTab==='全て'?items:items.filter(i=>i.cat===activeTab);
  const el=document.getElementById('list-area');
  if(!filtered.length){el.innerHTML='<div class="empty">商品がありません。「＋ 追加」から登録してください。</div>';return;}
  const cats=[...new Set(filtered.map(i=>i.cat))];
  el.innerHTML=cats.map((cat,idx)=>carouselSectionHTML(cat,filtered.filter(i=>i.cat===cat),idx)).join('');
  cats.forEach((_,idx)=>{const track=document.getElementById(`carousel-${idx}`);if(track)track.addEventListener('scroll',()=>updateDots(`carousel-${idx}`),{passive:true});});
}
function updateDots(trackId){const track=document.getElementById(trackId);if(!track)return;const cw=(track.querySelector('.card')?.offsetWidth??160)+12;const idx=Math.round(track.scrollLeft/cw);document.querySelectorAll(`[data-target="${trackId}"].carousel-dot`).forEach((d,i)=>d.classList.toggle('active',i===idx));}
function scrollCarousel(trackId,dir){const track=document.getElementById(trackId);if(!track)return;const cw=(track.querySelector('.card')?.offsetWidth??160)+12;track.scrollBy({left:dir*cw*2,behavior:'smooth'});}

document.getElementById('list-area').addEventListener('click',async function(e){
  const arrow=e.target.closest('.carousel-arrow');if(arrow){scrollCarousel(arrow.dataset.target,arrow.classList.contains('next')?1:-1);return;}
  const dot=e.target.closest('.carousel-dot');if(dot){const track=document.getElementById(dot.dataset.target);if(track){const cw=(track.querySelector('.card')?.offsetWidth??160)+12;track.scrollTo({left:parseInt(dot.dataset.index)*cw,behavior:'smooth'});}return;}
  const pctBtn=e.target.closest('[data-pct-step]');
  if(pctBtn){const key=pctBtn.dataset.pctStep,pct=parseInt(pctBtn.dataset.pct),prev=parseInt(pctBtn.dataset.prev),item=items.find(i=>i._key===key);if(item){await update(ref(db,`inventory/items/${key}`),{percent:pct});await recordHistory(key,pct,Math.max(0,prev-pct),item.price||0);}return;}
  const stepBtn=e.target.closest('[data-step]');
  if(stepBtn){const key=stepBtn.dataset.step,delta=parseInt(stepBtn.dataset.delta),price=parseFloat(stepBtn.dataset.price)||0,item=items.find(i=>i._key===key);if(item){const nS=Math.max(0,(item.stock??0)+delta);await update(ref(db,`inventory/items/${key}`),{stock:nS});if(delta<0)await recordHistory(key,nS,1,price);}return;}
  const card=e.target.closest('[data-key]');if(card)openEdit(card.dataset.key);
});

function getMonthHistory(y,m){
  const start=new Date(y,m,1).getTime(),end=new Date(y,m+1,1).getTime(),result=[];
  for(const[key,entries]of Object.entries(allHistory)){for(const e of entries){if(e.ts>=start&&e.ts<end&&e.consumed>0)result.push({...e,key});}}
  return result.sort((a,b)=>b.ts-a.ts);
}
function getTotalCost(entries){return entries.reduce((s,e)=>s+(e.cost||0),0);}

function renderHistoryPage(){
  document.getElementById('month-label').textContent=fmtMonth(viewYear,viewMonth);
  const thisEntries=getMonthHistory(viewYear,viewMonth);
  const prevDate=new Date(viewYear,viewMonth-1,1);
  const prevEntries=getMonthHistory(prevDate.getFullYear(),prevDate.getMonth());
  const thisCost=getTotalCost(thisEntries),prevCost=getTotalCost(prevEntries),diff=thisCost-prevCost;
  document.getElementById('summary-cost').textContent=fmtCurrency(thisCost);
  document.getElementById('summary-count').textContent=`${thisEntries.length}件`;
  const diffEl=document.getElementById('summary-diff');
  if(prevCost===0){diffEl.textContent='-';diffEl.className='summary-value';}
  else{diffEl.textContent=(diff>=0?'+':'')+fmtCurrency(diff);diffEl.className='summary-value '+(diff>0?'up':'down');}
  const catMap={};for(const e of thisEntries){const cat=e.cat||'その他';catMap[cat]=(catMap[cat]||0)+(e.cost||0);}
  const maxCat=Math.max(...Object.values(catMap),1);
  const catEl=document.getElementById('cat-chart');
  catEl.innerHTML=!Object.keys(catMap).length?'<div class="history-empty">データがありません</div>'
    :Object.entries(catMap).sort((a,b)=>b[1]-a[1]).map(([cat,cost])=>`<div class="cat-bar-row"><div class="cat-bar-label">${CAT_EMOJI[cat]||'📦'} ${cat}</div><div class="cat-bar-wrap"><div class="cat-bar-fill" style="width:${Math.round(cost/maxCat*100)}%"></div></div><div class="cat-bar-amount">${fmtCurrency(cost)}</div></div>`).join('');
  const months=[];for(let i=2;i>=0;i--){const d=new Date(viewYear,viewMonth-i,1);months.push({y:d.getFullYear(),m:d.getMonth()});}
  const mCosts=months.map(({y,m})=>({label:fmtMonth(y,m),cost:getTotalCost(getMonthHistory(y,m)),current:y===viewYear&&m===viewMonth}));
  const maxM=Math.max(...mCosts.map(x=>x.cost),1);
  document.getElementById('monthly-chart').innerHTML=`<div class="monthly-chart-wrap">${mCosts.map(({label,cost,current})=>`<div class="monthly-col"><div class="monthly-bar-amount">${cost>0?fmtCurrency(cost):''}</div><div class="monthly-bar${current?' current':''}" style="height:${Math.max(4,Math.round(cost/maxM*80))}px"></div><div class="monthly-bar-label">${label}</div></div>`).join('')}</div>`;
  const histEl=document.getElementById('history-list');
  histEl.innerHTML=!thisEntries.length?'<div class="history-empty">この月の履歴はありません</div>'
    :thisEntries.map(e=>{const item=items.find(i=>i._key===e.key)||{};const d=new Date(e.ts);const ds=`${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;return`<div class="history-item"><div class="history-emoji">${item.emoji||'📦'}</div><div class="history-info"><div class="history-name">${e.itemName||item.name||'不明'}</div><div class="history-meta">${e.cat||item.cat||''} · ${ds} · ${e.consumed}${item.unit||'個'}消費</div></div><div class="history-cost">${e.cost>0?fmtCurrency(e.cost):'-'}</div></div>`;}).join('');
}
document.getElementById('btn-month-prev').addEventListener('click',()=>{viewMonth--;if(viewMonth<0){viewMonth=11;viewYear--;}renderHistoryPage();});
document.getElementById('btn-month-next').addEventListener('click',()=>{const now=new Date();if(viewYear<now.getFullYear()||(viewYear===now.getFullYear()&&viewMonth<now.getMonth())){viewMonth++;if(viewMonth>11){viewMonth=0;viewYear++;}renderHistoryPage();}});

function buildEmojiGrid(sel){document.getElementById('emoji-grid').innerHTML=EMOJIS.map(e=>`<div class="emoji-opt${e===sel?' selected':''}" data-emoji="${e}">${e}</div>`).join('');}
function setMode(mode){currentMode=mode;document.querySelectorAll('.mode-btn').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));document.getElementById('count-fields').style.display=mode==='count'?'':'none';document.getElementById('percent-fields').style.display=mode==='percent'?'':'none';}
function setPct(pct){selectedPct=pct;document.querySelectorAll('#percent-selector .pct-btn').forEach(b=>b.classList.toggle('active',parseInt(b.dataset.pct)===pct));}
function setAutoMode(mode){currentAutoMode=mode;document.getElementById('manual-pace-field').style.display=mode==='manual'?'':'none';document.getElementById('learn-info').style.display=mode==='learn'?'':'none';}
document.getElementById('mode-selector').addEventListener('click',e=>{const btn=e.target.closest('.mode-btn');if(btn)setMode(btn.dataset.mode);});
document.getElementById('percent-selector').addEventListener('click',e=>{const btn=e.target.closest('.pct-btn');if(btn)setPct(parseInt(btn.dataset.pct));});
document.getElementById('f-auto-enabled').addEventListener('change',function(){document.getElementById('auto-fields').style.display=this.checked?'':'none';});
document.querySelectorAll('input[name="auto-mode"]').forEach(r=>r.addEventListener('change',()=>setAutoMode(r.value)));

function openAdd(){
  editFirebaseKey=null;uploadedImg=null;selectedEmoji='🛒';selectedPct=100;
  document.getElementById('modal-title').textContent='商品を追加';document.getElementById('f-name').value='';document.getElementById('f-cat').value='日用品';document.getElementById('f-price').value='';document.getElementById('f-stock').value=1;document.getElementById('f-threshold').value=2;document.getElementById('f-unit').value='';document.getElementById('f-auto-enabled').checked=false;document.getElementById('auto-fields').style.display='none';document.getElementById('f-pace-amount').value=1;document.getElementById('btn-delete').style.display='none';document.getElementById('img-preview').innerHTML='<span id="preview-emoji">🛒</span>';
  document.querySelectorAll('input[name="auto-mode"]')[0].checked=true;setMode('count');setPct(100);setAutoMode('manual');buildEmojiGrid('🛒');document.getElementById('modal-overlay').classList.add('open');
}
function openEdit(key){
  const item=items.find(i=>i._key===key);if(!item)return;
  editFirebaseKey=key;uploadedImg=item.img||null;selectedEmoji=item.emoji;selectedPct=item.percent??100;
  document.getElementById('modal-title').textContent='在庫を編集';document.getElementById('f-name').value=item.name;document.getElementById('f-cat').value=item.cat;document.getElementById('f-price').value=item.price||'';document.getElementById('f-stock').value=item.stock??0;document.getElementById('f-threshold').value=item.threshold??2;document.getElementById('f-unit').value=item.unit||'';document.getElementById('f-pct-threshold').value=item.pctThreshold??25;document.getElementById('f-auto-enabled').checked=!!item.autoEnabled;document.getElementById('auto-fields').style.display=item.autoEnabled?'':'none';document.getElementById('f-pace-amount').value=item.manualPace??1;document.getElementById('btn-delete').style.display='';
  document.getElementById('img-preview').innerHTML=item.img?`<img src="${item.img}" alt="">`:`<span id="preview-emoji">${item.emoji}</span>`;
  const autoMode=item.autoMode||'manual';document.querySelectorAll('input[name="auto-mode"]').forEach(r=>r.checked=(r.value===autoMode));
  setMode(item.mode||'count');setPct(item.percent??100);setAutoMode(autoMode);document.getElementById('pace-unit-label').textContent=item.unit||'個';buildEmojiGrid(item.emoji);document.getElementById('modal-overlay').classList.add('open');
}
function closeModal(){document.getElementById('modal-overlay').classList.remove('open');}
async function saveItem(){
  const name=document.getElementById('f-name').value.trim();if(!name){alert('商品名を入力してください');return;}
  const autoEnabled=document.getElementById('f-auto-enabled').checked,autoMode=document.querySelector('input[name="auto-mode"]:checked')?.value||'manual',unit=document.getElementById('f-unit').value.trim()||'個',price=parseFloat(document.getElementById('f-price').value)||0;
  const data={name,cat:document.getElementById('f-cat').value,mode:currentMode,emoji:selectedEmoji,img:uploadedImg||null,price,autoEnabled,autoMode,manualPace:parseFloat(document.getElementById('f-pace-amount').value)||1,...(currentMode==='count'?{stock:parseInt(document.getElementById('f-stock').value)||0,threshold:parseInt(document.getElementById('f-threshold').value)||1,unit}:{percent:selectedPct,pctThreshold:parseInt(document.getElementById('f-pct-threshold').value)||25})};
  try{if(editFirebaseKey)await update(ref(db,`inventory/items/${editFirebaseKey}`),data);else await push(ref(db,'inventory/items'),data);closeModal();showToast('保存しました');}catch(e){alert('保存に失敗しました: '+e.message);}
}
function confirmDelete(){const item=items.find(i=>i._key===editFirebaseKey);if(!item)return;document.getElementById('confirm-msg').textContent=`「${item.name}」を削除しますか？`;document.getElementById('confirm-overlay').classList.add('open');}
async function doDelete(){
  try{await remove(ref(db,`inventory/items/${editFirebaseKey}`));await remove(ref(db,`inventory/history/${editFirebaseKey}`));document.getElementById('confirm-overlay').classList.remove('open');closeModal();showToast('削除しました');}
  catch(e){alert('削除に失敗しました: '+e.message);}
}
document.getElementById('btn-add').addEventListener('click',openAdd);
document.getElementById('btn-cancel').addEventListener('click',closeModal);
document.getElementById('btn-save').addEventListener('click',saveItem);
document.getElementById('btn-delete').addEventListener('click',confirmDelete);
document.getElementById('confirm-no').addEventListener('click',()=>document.getElementById('confirm-overlay').classList.remove('open'));
document.getElementById('confirm-yes').addEventListener('click',doDelete);
document.getElementById('modal-overlay').addEventListener('click',function(e){if(e.target===this)closeModal();});
document.getElementById('tabs').addEventListener('click',function(e){const t=e.target.closest('[data-tab]');if(t){activeTab=t.dataset.tab;render();}});
document.getElementById('emoji-grid').addEventListener('click',function(e){const opt=e.target.closest('[data-emoji]');if(!opt)return;selectedEmoji=opt.dataset.emoji;const pe=document.getElementById('preview-emoji');if(pe)pe.textContent=selectedEmoji;buildEmojiGrid(selectedEmoji);});
document.getElementById('f-unit').addEventListener('input',function(){document.getElementById('pace-unit-label').textContent=this.value||'個';});
document.getElementById('img-input').addEventListener('change',function(e){const file=e.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=ev=>{uploadedImg=ev.target.result;document.getElementById('img-preview').innerHTML=`<img src="${uploadedImg}" alt="">`;};reader.readAsDataURL(file);});
