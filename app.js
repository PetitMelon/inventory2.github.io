/* =====================================================
   stocké — app.js
   ・買い物リスト（Firebase共有）
   ・消費グラフ（月別消費量・消費金額 過去3ヶ月）
   ・優先度ソート・自動消費・購入URL
   ===================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getDatabase, ref, onValue, push, remove, update, get
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

/* ===== Firebase設定（GitHub Actionsが自動注入） ===== */
const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_AUTH_DOMAIN",
  databaseURL:       "YOUR_DATABASE_URL",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

const firebaseApp = initializeApp(firebaseConfig);
const auth        = getAuth(firebaseApp);
const db          = getDatabase(firebaseApp);

/* ===== 定数 ===== */
const EMOJIS = ['🧻','🧴','🧹','🪣','🧺','🐾','🐶','🐱','🐟','🥫','🍚','🥤','💊','🩺','🪥','🧼','🛁','🍶','🧃','🫙','🍞','🥛','☕','🫧','🧽','🗑'];
const CAT_EMOJI = { '日用品':'🏠','ペット用品':'🐾','食品・飲料':'🥦','洗剤・清掃':'🧴','薬・衛生':'💊','その他':'📦' };
const PRI_ICON  = { 3:'🔴', 2:'🟡', 1:'🟢' };
const PRI_LABEL = { 3:'高',  2:'中',  1:'低'  };

/* ===== 状態 ===== */
let items            = [];
let shoppingItems    = [];
let activeTab        = '全て';
let activeView       = 'inventory';
let editFirebaseKey  = null;
let selectedEmoji    = '🛒';
let uploadedImg      = null;
let dbUnsubscribe    = null;
let shopUnsubscribe  = null;
let currentMode      = 'count';
let currentAutoMode  = 'manual';
let selectedPct      = 100;
let selectedPctThreshold = 50;
let selectedPriority = 2;

/* ===== ソート ===== */
function sortScore(item) {
  const st = getStatus(item);
  const statusScore = st==='low' ? 2 : st==='warn' ? 1 : 0;
  return statusScore * 10 + (item.priority ?? 2);
}
function sortItems(arr) { return [...arr].sort((a,b) => sortScore(b) - sortScore(a)); }

/* ===== ユーティリティ ===== */
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}
function setSyncStatus(status, label) {
  const dot = document.getElementById('sync-dot');
  dot.className = 'sync-dot' + (status==='ok'?'':status==='loading'?' loading':' error');
  document.getElementById('sync-label').textContent = label;
}
function getStatus(item) {
  if (item.mode === 'percent') {
    const p=item.percent??100, th=item.pctThreshold??50;
    if (p<=0) return 'low'; if (p<=th/2) return 'low'; if (p<=th) return 'warn'; return 'ok';
  }
  if (item.stock===0) return 'low';
  if (item.stock<=Math.floor(item.threshold/2)) return 'low';
  if (item.stock<=item.threshold) return 'warn';
  return 'ok';
}
function getAllCats() { return ['全て', ...new Set(items.map(i=>i.cat))]; }
function formatPrice(p) { return p!=null && p!=='' ? '¥'+Number(p).toLocaleString() : null; }
function toDailyPace(amount, period) {
  const a=parseFloat(amount)||1;
  return period==='week' ? a/7 : period==='month' ? a/30 : a;
}
function paceLabel(amount, period, unit) {
  const u=unit||'個';
  return period==='week' ? `${amount}${u}／週` : period==='month' ? `${amount}${u}／月` : `${amount}${u}／日`;
}

/* ===== 月ラベル ===== */
function monthLabel(monthsAgo) {
  const d = new Date();
  d.setMonth(d.getMonth() - monthsAgo);
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}`;
}
function monthKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}`;
}

/* ===== 自動消費 ===== */
function calcLearnedPace(history) {
  if (!history || history.length<2) return null;
  const sorted=[...history].sort((a,b)=>a.ts-b.ts);
  let totalDelta=0,totalDays=0;
  for(let i=1;i<sorted.length;i++){
    const delta=sorted[i-1].val-sorted[i].val;
    const days=(sorted[i].ts-sorted[i-1].ts)/86400000;
    if(delta>0&&days>0){totalDelta+=delta;totalDays+=days;}
  }
  return totalDays>0?totalDelta/totalDays:null;
}
function daysBetween(a,b){
  const da=new Date(a),db=new Date(b);
  da.setHours(0,0,0,0);db.setHours(0,0,0,0);
  return Math.round((db-da)/86400000);
}
async function runAutoConsumption() {
  const todayStr=new Date().toDateString();
  for(const item of items){
    if(!item.autoEnabled||item.lastAutoDate===todayStr) continue;
    const elapsed=item.lastAutoDate?Math.max(1,daysBetween(item.lastAutoDate,todayStr)):1;
    let dailyPace=null;
    if(item.autoMode==='learn'){
      const snap=await get(ref(db,`inventory/history/${item._key}`));
      const hist=snap.val()?Object.values(snap.val()):[];
      dailyPace=calcLearnedPace(hist)??toDailyPace(item.manualPace??1,item.pacePeriod??'day');
    } else { dailyPace=toDailyPace(item.manualPace??1,item.pacePeriod??'day'); }
    const total=dailyPace*elapsed;
    if(item.mode==='percent'){
      await update(ref(db,`inventory/items/${item._key}`),{percent:Math.max(0,Math.round((item.percent??100)-total)),lastAutoDate:todayStr});
    } else {
      await update(ref(db,`inventory/items/${item._key}`),{stock:Math.max(0,Math.round(((item.stock??0)-total)*10)/10),lastAutoDate:todayStr});
    }
  }
}
async function recordHistory(key, newVal) {
  await push(ref(db,`inventory/history/${key}`),{ts:Date.now(),val:newVal});
  const snap=await get(ref(db,`inventory/history/${key}`));
  if(snap.val()){
    const entries=Object.entries(snap.val()).sort((a,b)=>a[1].ts-b[1].ts);
    if(entries.length>30){
      for(let i=0;i<entries.length-30;i++) await remove(ref(db,`inventory/history/${key}/${entries[i][0]}`));
    }
  }
}

/* ===== 画面切り替え ===== */
function showScreen(name) {
  document.getElementById('auth-screen').style.display     = name==='login'    ? 'flex'  : 'none';
  document.getElementById('register-screen').style.display = name==='register' ? 'flex'  : 'none';
  document.getElementById('app-screen').style.display      = name==='app'      ? 'block' : 'none';
}
function showView(view) {
  activeView = view;
  ['inventory','shopping','graph'].forEach(v=>{
    document.getElementById(`view-${v}`).style.display = v===view ? '' : 'none';
  });
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  document.getElementById('btn-add').style.display = view==='inventory' ? '' : 'none';
  if(view==='shopping') renderShopping();
  if(view==='graph')    renderGraph();
}

/* ===== 認証 ===== */
function authErrorMessage(code) {
  switch(code){
    case 'auth/invalid-email':        return 'メールアドレスの形式が正しくありません';
    case 'auth/user-not-found':       return 'このメールアドレスは登録されていません';
    case 'auth/wrong-password':       return 'パスワードが正しくありません';
    case 'auth/invalid-credential':   return 'メールアドレスまたはパスワードが正しくありません';
    case 'auth/email-already-in-use': return 'このメールアドレスはすでに登録されています';
    case 'auth/weak-password':        return 'パスワードは6文字以上にしてください';
    case 'auth/too-many-requests':    return 'しばらく時間をおいてから再試行してください';
    default:                          return 'エラーが発生しました（'+code+'）';
  }
}
document.getElementById('btn-login').addEventListener('click', async () => {
  const e=document.getElementById('auth-error'); e.style.display='none';
  const email=document.getElementById('auth-email').value.trim();
  const pass=document.getElementById('auth-password').value;
  if(!email||!pass){e.textContent='メールアドレスとパスワードを入力してください';e.style.display='block';return;}
  try{await signInWithEmailAndPassword(auth,email,pass);}
  catch(err){e.textContent=authErrorMessage(err.code);e.style.display='block';}
});
document.getElementById('btn-go-register').addEventListener('click',()=>showScreen('register'));
document.getElementById('btn-go-login').addEventListener('click',()=>showScreen('login'));
document.getElementById('btn-register').addEventListener('click', async()=>{
  const e=document.getElementById('reg-error'); e.style.display='none';
  const email=document.getElementById('reg-email').value.trim();
  const pass=document.getElementById('reg-password').value;
  const pass2=document.getElementById('reg-password2').value;
  if(!email||!pass){e.textContent='メールアドレスとパスワードを入力してください';e.style.display='block';return;}
  if(pass.length<6){e.textContent='パスワードは6文字以上にしてください';e.style.display='block';return;}
  if(pass!==pass2){e.textContent='パスワードが一致しません';e.style.display='block';return;}
  try{await createUserWithEmailAndPassword(auth,email,pass);showToast('登録しました。ようこそ！');}
  catch(err){e.textContent=authErrorMessage(err.code);e.style.display='block';}
});
document.getElementById('btn-logout').addEventListener('click', async()=>{
  if(dbUnsubscribe){dbUnsubscribe();dbUnsubscribe=null;}
  if(shopUnsubscribe){shopUnsubscribe();shopUnsubscribe=null;}
  await signOut(auth); showScreen('login');
});
onAuthStateChanged(auth,(user)=>{
  if(user){
    document.getElementById('user-label').textContent=user.email;
    showScreen('app'); startRealtimeSync(); startShoppingSync();
  } else {
    if(dbUnsubscribe){dbUnsubscribe();dbUnsubscribe=null;}
    if(shopUnsubscribe){shopUnsubscribe();shopUnsubscribe=null;}
    items=[];shoppingItems=[];showScreen('login');
  }
});

/* ===== ナビ ===== */
document.getElementById('app-screen').addEventListener('click', e=>{
  const btn=e.target.closest('.nav-btn');
  if(btn) showView(btn.dataset.view);
});

/* ===== 在庫DB ===== */
function startRealtimeSync() {
  setSyncStatus('loading','接続中...');
  dbUnsubscribe=onValue(ref(db,'inventory/items'),async(snap)=>{
    const data=snap.val();
    if(data){ items=Object.entries(data).map(([k,v])=>({...v,_key:k})); await runAutoConsumption(); }
    else { items=[]; await initDefaultItems(); }
    setSyncStatus('ok','リアルタイム同期中');
    render();
  },(err)=>{setSyncStatus('error','接続エラー');console.error(err);});
}
async function initDefaultItems() {
  const defaults=[
    {name:'トイレットペーパー',cat:'日用品',   mode:'count',  stock:1,threshold:3,unit:'個',emoji:'🧻',img:null,autoEnabled:false,price:null,url:null,priority:2},
    {name:'シャンプー',        cat:'日用品',   mode:'count',  stock:5,threshold:2,unit:'本',emoji:'🧴',img:null,autoEnabled:false,price:null,url:null,priority:2},
    {name:'ワンちゃんのエサ',  cat:'ペット用品',mode:'count',  stock:2,threshold:2,unit:'袋',emoji:'🐾',img:null,autoEnabled:false,price:null,url:null,priority:3},
    {name:'猫砂',              cat:'ペット用品',mode:'percent',percent:75,pctThreshold:50,emoji:'🐱',img:null,autoEnabled:false,price:null,url:null,priority:2},
    {name:'食器用洗剤',        cat:'洗剤・清掃',mode:'count',  stock:1,threshold:2,unit:'本',emoji:'🧹',img:null,autoEnabled:false,price:null,url:null,priority:2},
    {name:'お米',              cat:'食品・飲料',mode:'percent',percent:50,pctThreshold:25,emoji:'🍚',img:null,autoEnabled:false,price:null,url:null,priority:3},
  ];
  for(const item of defaults) await push(ref(db,'inventory/items'),item);
}

/* ===== 買い物リストDB ===== */
function startShoppingSync() {
  shopUnsubscribe=onValue(ref(db,'shopping/items'),(snap)=>{
    const data=snap.val();
    shoppingItems=data?Object.entries(data).map(([k,v])=>({...v,_key:k})):[];
    if(activeView==='shopping') renderShopping();
  });
}

/* ===== 在庫描画 ===== */
function render() { renderTabs(); renderAlerts(); renderList(); }
function renderTabs() {
  document.getElementById('tabs').innerHTML=getAllCats().map(c=>
    `<button class="tab${activeTab===c?' active':''}" data-tab="${c}">${CAT_EMOJI[c]||'📋'} ${c}</button>`
  ).join('');
}
function renderAlerts() {
  const low=items.filter(i=>getStatus(i)!=='ok');
  document.getElementById('alert-area').innerHTML=low.length
    ?`<div class="alert-banner"><span class="alert-dot"></span>在庫が少ない商品が${low.length}件あります：${low.map(i=>i.name).join('、')}</div>`:'';
}
function cardHTML(item) {
  const st=getStatus(item), pri=item.priority??2;
  const badges={ok:'<span class="status-badge badge-ok">十分</span>',warn:'<span class="status-badge badge-warn">少ない</span>',low:'<span class="status-badge badge-low">要補充</span>'};
  const imgEl=item.img?`<div class="card-img"><img src="${item.img}" alt="${item.name}"></div>`:`<div class="card-img">${item.emoji}</div>`;
  const priceHTML=item.price!=null&&item.price!==''?`<div class="card-price">${formatPrice(item.price)}</div>`:'';
  const ribbonHTML=pri!==2?`<div class="priority-ribbon">${PRI_ICON[pri]}</div>`:'';
  let controlHTML='';
  if(item.mode==='percent'){
    const pct=item.percent??100,fillCls=st==='ok'?'fill-ok':st==='warn'?'fill-warn':'fill-low';
    const steps=[100,75,50,25,0].map(p=>`<button class="pct-step-btn${pct===p?' current':''}" data-pct-step="${item._key}" data-pct="${p}">${p}%</button>`).join('');
    controlHTML=`<div class="percent-bar-wrap"><div class="percent-bar-bg"><div class="percent-bar-fill ${fillCls}" style="width:${pct}%"></div></div><div class="percent-num-row"><span class="percent-num num-${st}">${pct}</span><span class="percent-num-unit">% 残量</span></div><div class="pct-step-row">${steps}</div></div>`;
  } else {
    controlHTML=`<div class="stepper"><button class="step-btn" data-step="${item._key}" data-delta="-1">−</button><span class="step-val num-${st}">${item.stock??0}</span><span style="font-size:11px;color:var(--brown-mid)">${item.unit||'個'}</span><button class="step-btn" data-step="${item._key}" data-delta="1">＋</button></div>`;
  }
  const buyBtn=item.url?`<a class="buy-btn" href="${item.url}" target="_blank" rel="noopener noreferrer" data-buy="true">🛒 購入サイトへ</a>`:'';
  const autoBadge=item.autoEnabled?`<div class="auto-badge ${item.autoMode==='learn'?'learn':'on'}">${item.autoMode==='learn'?'🧠 自動学習':'⏱ '+paceLabel(item.manualPace??1,item.pacePeriod??'day',item.unit)}</div>`:'';
  return `<div class="card ${st==='ok'?'':st}" data-key="${item._key}">${ribbonHTML}${imgEl}<div class="card-name" title="${item.name}">${item.name}</div>${priceHTML}<div class="card-cat">${item.cat}</div><div class="stock-row"><span style="font-size:12px;color:var(--brown-mid)">残量</span>${badges[st]}</div>${controlHTML}${buyBtn}${autoBadge}</div>`;
}
function carouselSectionHTML(cat, catItems, idx) {
  const sorted=sortItems(catItems), id=`carousel-${idx}`;
  return `<div class="carousel-section"><div class="carousel-header"><div class="section-title">${CAT_EMOJI[cat]||'📦'} ${cat}</div><span class="carousel-count">${sorted.length}件</span></div><div class="carousel-track-wrap"><button class="carousel-arrow prev" data-target="${id}">‹</button><div class="carousel-track" id="${id}">${sorted.map(cardHTML).join('')}</div><button class="carousel-arrow next" data-target="${id}">›</button></div><div class="carousel-dots" id="${id}-dots">${sorted.map((_,i)=>`<div class="carousel-dot${i===0?' active':''}" data-target="${id}" data-index="${i}"></div>`).join('')}</div></div>`;
}
function renderList() {
  const filtered=activeTab==='全て'?items:items.filter(i=>i.cat===activeTab);
  const el=document.getElementById('list-area');
  if(!filtered.length){el.innerHTML='<div class="empty">商品がありません。「＋ 追加」から登録してください。</div>';return;}
  const cats=[...new Set(filtered.map(i=>i.cat))];
  el.innerHTML=cats.map((cat,idx)=>carouselSectionHTML(cat,filtered.filter(i=>i.cat===cat),idx)).join('');
  cats.forEach((_,idx)=>{
    const track=document.getElementById(`carousel-${idx}`);
    if(track) track.addEventListener('scroll',()=>updateDots(`carousel-${idx}`),{passive:true});
  });
}
function updateDots(trackId){
  const track=document.getElementById(trackId); if(!track) return;
  const cw=(track.querySelector('.card')?.offsetWidth??165)+12;
  const idx=Math.round(track.scrollLeft/cw);
  document.querySelectorAll(`[data-target="${trackId}"].carousel-dot`).forEach((d,i)=>d.classList.toggle('active',i===idx));
}
function scrollCarousel(trackId,dir){
  const track=document.getElementById(trackId); if(!track) return;
  const cw=(track.querySelector('.card')?.offsetWidth??165)+12;
  track.scrollBy({left:dir*cw*2,behavior:'smooth'});
}

/* ===== カード操作 ===== */
document.getElementById('list-area').addEventListener('click', async function(e){
  if(e.target.closest('[data-buy]')) return;
  const arrow=e.target.closest('.carousel-arrow');
  if(arrow){scrollCarousel(arrow.dataset.target,arrow.classList.contains('next')?1:-1);return;}
  const dot=e.target.closest('.carousel-dot');
  if(dot){const track=document.getElementById(dot.dataset.target);if(track){const cw=(track.querySelector('.card')?.offsetWidth??165)+12;track.scrollTo({left:parseInt(dot.dataset.index)*cw,behavior:'smooth'});}return;}
  const pctBtn=e.target.closest('[data-pct-step]');
  if(pctBtn){const key=pctBtn.dataset.pctStep,pct=parseInt(pctBtn.dataset.pct),item=items.find(i=>i._key===key);if(item){await update(ref(db,`inventory/items/${key}`),{percent:pct});await recordHistory(key,pct);}return;}
  const stepBtn=e.target.closest('[data-step]');
  if(stepBtn){const key=stepBtn.dataset.step,delta=parseInt(stepBtn.dataset.delta),item=items.find(i=>i._key===key);if(item){const ns=Math.max(0,(item.stock??0)+delta);await update(ref(db,`inventory/items/${key}`),{stock:ns});await recordHistory(key,ns);}return;}
  const card=e.target.closest('[data-key]');
  if(card) openEdit(card.dataset.key);
});
document.getElementById('tabs').addEventListener('click',function(e){
  const t=e.target.closest('[data-tab]');if(t){activeTab=t.dataset.tab;render();}
});

/* ===== 買い物リスト描画 ===== */
function renderShopping() {
  const el=document.getElementById('shopping-list');
  if(!shoppingItems.length){el.innerHTML='<div class="shopping-empty">買い物リストは空です。<br>在庫不足の商品を一括追加するか、手動で追加してください。</div>';return;}
  // 未チェック→チェック済みの順
  const sorted=[...shoppingItems].sort((a,b)=>(a.checked?1:0)-(b.checked?1:0));
  el.innerHTML=sorted.map(item=>{
    const chkCls=item.checked?'checked':'';
    const chkIcon=item.checked?'✓':'';
    const urlLink=item.url?`<a class="shopping-item-url" href="${item.url}" target="_blank" rel="noopener noreferrer">🛒 購入サイトへ</a>`:'';
    const priceText=item.price?`${formatPrice(item.price)}` :'';
    const meta=[item.cat,priceText].filter(Boolean).join(' · ');
    return `<div class="shopping-item ${chkCls}" data-shop-key="${item._key}">
      <div class="shopping-checkbox ${chkCls}" data-shop-check="${item._key}">${chkIcon}</div>
      <div class="shopping-item-body">
        <div class="shopping-item-name">${item.name}</div>
        ${meta?`<div class="shopping-item-meta">${meta}</div>`:''}
        ${urlLink}
      </div>
      <button class="shopping-delete-btn" data-shop-del="${item._key}">×</button>
    </div>`;
  }).join('');
}

/* 買い物リストイベント */
document.getElementById('view-shopping').addEventListener('click', async function(e){
  const checkBtn=e.target.closest('[data-shop-check]');
  if(checkBtn){
    const key=checkBtn.dataset.shopCheck;
    const item=shoppingItems.find(i=>i._key===key);
    if(item) await update(ref(db,`shopping/items/${key}`),{checked:!item.checked});
    return;
  }
  const delBtn=e.target.closest('[data-shop-del]');
  if(delBtn){
    const key=delBtn.dataset.shopDel;
    await remove(ref(db,`shopping/items/${key}`));
    return;
  }
});

document.getElementById('btn-shopping-add').addEventListener('click', async()=>{
  const input=document.getElementById('shopping-input');
  const name=input.value.trim(); if(!name) return;
  await push(ref(db,'shopping/items'),{name,checked:false,cat:'',price:null,url:null,addedAt:Date.now()});
  input.value='';
});
document.getElementById('shopping-input').addEventListener('keydown',async(e)=>{
  if(e.key==='Enter'){
    const name=e.target.value.trim(); if(!name) return;
    await push(ref(db,'shopping/items'),{name,checked:false,cat:'',price:null,url:null,addedAt:Date.now()});
    e.target.value='';
  }
});

// 在庫不足を一括追加
document.getElementById('btn-import-shortage').addEventListener('click', async()=>{
  const shortage=items.filter(i=>getStatus(i)!=='ok');
  if(!shortage.length){showToast('在庫不足の商品はありません');return;}
  const existing=shoppingItems.map(i=>i.name);
  let added=0;
  for(const item of shortage){
    if(existing.includes(item.name)) continue;
    await push(ref(db,'shopping/items'),{
      name:item.name, checked:false,
      cat:item.cat||'', price:item.price||null,
      url:item.url||null, addedAt:Date.now()
    });
    added++;
  }
  showToast(added>0?`${added}件追加しました`:'すでにすべて追加済みです');
});

// チェック済みを削除
document.getElementById('btn-clear-checked').addEventListener('click', async()=>{
  const checked=shoppingItems.filter(i=>i.checked);
  for(const item of checked) await remove(ref(db,`shopping/items/${item._key}`));
  if(checked.length) showToast(`${checked.length}件削除しました`);
});

/* ===== 消費グラフ描画 ===== */
async function renderGraph() {
  const el=document.getElementById('graph-area');
  el.innerHTML='<div class="graph-empty">データを読み込み中...</div>';

  // 全商品の履歴を取得
  const historySnap=await get(ref(db,'inventory/history'));
  const allHistory=historySnap.val()||{};

  // 過去3ヶ月のラベル
  const months=[2,1,0].map(n=>monthLabel(n)); // ['2024/01','2024/02','2024/03']

  // 月別消費量（各商品の履歴から減少量を集計）
  const monthlyConsumption={};  // { 'YYYY/MM': { itemKey: amount } }
  months.forEach(m=>{monthlyConsumption[m]={};});

  for(const [itemKey, histObj] of Object.entries(allHistory)){
    if(!histObj) continue;
    const entries=Object.values(histObj).sort((a,b)=>a.ts-b.ts);
    for(let i=1;i<entries.length;i++){
      const delta=entries[i-1].val-entries[i].val;
      const mk=monthKey(entries[i].ts);
      if(delta>0 && monthlyConsumption[mk]){
        monthlyConsumption[mk][itemKey]=(monthlyConsumption[mk][itemKey]||0)+delta;
      }
    }
  }

  // 月別消費金額を計算
  const monthlyCost={};
  months.forEach(m=>{
    let cost=0;
    for(const [itemKey, amount] of Object.entries(monthlyConsumption[m]||{})){
      const item=items.find(i=>i._key===itemKey);
      if(item?.price) cost+=item.price*amount;
    }
    monthlyCost[m]=Math.round(cost);
  });

  // 月別合計消費量
  const monthlyTotal={};
  months.forEach(m=>{
    monthlyTotal[m]=Object.values(monthlyConsumption[m]||{}).reduce((s,v)=>s+v,0);
  });

  // 商品別消費量（直近3ヶ月合計）
  const itemTotal={};
  months.forEach(m=>{
    for(const [k,v] of Object.entries(monthlyConsumption[m]||{})){
      itemTotal[k]=(itemTotal[k]||0)+v;
    }
  });
  const topItems=Object.entries(itemTotal).sort((a,b)=>b[1]-a[1]).slice(0,6);

  const maxTotal=Math.max(...months.map(m=>monthlyTotal[m]),1);
  const maxCost=Math.max(...months.map(m=>monthlyCost[m]),1);
  const curMonth=monthLabel(0);

  // --- 月別消費金額カード ---
  const costCardsHTML=months.map((m,i)=>{
    const isCurrent=i===2;
    return `<div class="cost-card${isCurrent?' current':''}">
      <div class="cost-month">${m}</div>
      <div class="cost-amount">${monthlyCost[m]>0?'¥'+monthlyCost[m].toLocaleString():'—'}</div>
      <div class="cost-unit">${monthlyCost[m]>0?'消費金額':''}</div>
    </div>`;
  }).join('');

  // --- 月別消費量バーグラフ ---
  const barHTML=months.map((m,i)=>{
    const val=monthlyTotal[m];
    const pct=maxTotal>0?Math.round(val/maxTotal*100):0;
    const isCurrent=i===2;
    const fillHTML=pct>18
      ?`<div class="bar-fill${isCurrent?' current':''}" style="width:${pct}%"><span class="bar-value">${Math.round(val*10)/10}</span></div>`
      :`<div class="bar-fill${isCurrent?' current':''}" style="width:${pct}%"></div>`;
    return `<div class="bar-row">
      <span class="bar-label">${m.slice(5)}月</span>
      <div class="bar-wrap">${fillHTML}</div>
      ${pct<=18?`<span class="bar-value-outside">${Math.round(val*10)/10}</span>`:''}
    </div>`;
  }).join('');

  // --- 商品別消費量 ---
  const itemBarMax=topItems.length>0?topItems[0][1]:1;
  const itemBarsHTML=topItems.length>0?topItems.map(([key,val])=>{
    const item=items.find(i=>i._key===key);
    const name=item?.name||'不明';
    const emoji=item?.emoji||'📦';
    const unit=item?.unit||'';
    const pct=Math.round(val/itemBarMax*100);
    return `<div class="item-con-row">
      <span class="item-con-emoji">${emoji}</span>
      <span class="item-con-name" title="${name}">${name}</span>
      <div class="item-con-bar-wrap"><div class="item-con-bar" style="width:${pct}%"></div></div>
      <span class="item-con-val">${Math.round(val*10)/10}${unit}</span>
    </div>`;
  }).join(''):'<div class="graph-empty">消費履歴がまだありません</div>';

  el.innerHTML=`
    <div class="graph-section">
      <div class="graph-section-title">月別 消費金額（過去3ヶ月）</div>
      <div class="cost-grid">${costCardsHTML}</div>
    </div>
    <div class="graph-section">
      <div class="graph-section-title">月別 消費量</div>
      <div class="bar-chart">${barHTML}</div>
    </div>
    <div class="graph-section">
      <div class="graph-section-title">商品別 消費量（過去3ヶ月合計）</div>
      <div class="item-consumption-list">${itemBarsHTML}</div>
    </div>`;
}

/* ===== モーダル ===== */
function buildEmojiGrid(sel){
  document.getElementById('emoji-grid').innerHTML=EMOJIS.map(e=>`<div class="emoji-opt${e===sel?' selected':''}" data-emoji="${e}">${e}</div>`).join('');
}
function setMode(mode){
  currentMode=mode;
  document.querySelectorAll('.mode-btn').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
  document.getElementById('count-fields').style.display=mode==='count'?'':'none';
  document.getElementById('percent-fields').style.display=mode==='percent'?'':'none';
}
function setPct(pct){selectedPct=pct;document.querySelectorAll('#percent-selector .pct-btn').forEach(b=>b.classList.toggle('active',parseInt(b.dataset.pct)===pct));}
function setPctThreshold(th){selectedPctThreshold=th;document.querySelectorAll('.pct-th-btn').forEach(b=>b.classList.toggle('active',parseInt(b.dataset.th)===th));}
function setAutoMode(mode){currentAutoMode=mode;document.getElementById('manual-pace-field').style.display=mode==='manual'?'':'none';document.getElementById('learn-info').style.display=mode==='learn'?'':'none';}
function setPriority(pri){selectedPriority=pri;document.querySelectorAll('.pri-btn').forEach(b=>b.classList.toggle('active',parseInt(b.dataset.pri)===pri));}

document.getElementById('priority-selector').addEventListener('click',e=>{const b=e.target.closest('.pri-btn');if(b)setPriority(parseInt(b.dataset.pri));});
document.getElementById('mode-selector').addEventListener('click',e=>{const b=e.target.closest('.mode-btn');if(b)setMode(b.dataset.mode);});
document.getElementById('percent-selector').addEventListener('click',e=>{const b=e.target.closest('.pct-btn');if(b)setPct(parseInt(b.dataset.pct));});
document.getElementById('pct-threshold-selector').addEventListener('click',e=>{const b=e.target.closest('.pct-th-btn');if(b)setPctThreshold(parseInt(b.dataset.th));});
document.getElementById('f-auto-enabled').addEventListener('change',function(){document.getElementById('auto-fields').style.display=this.checked?'':'none';});
document.querySelectorAll('input[name="auto-mode"]').forEach(r=>r.addEventListener('change',()=>setAutoMode(r.value)));

function openAdd(){
  editFirebaseKey=null;uploadedImg=null;selectedEmoji='🛒';selectedPct=100;selectedPctThreshold=50;selectedPriority=2;
  document.getElementById('modal-title').textContent='商品を追加';
  document.getElementById('f-name').value='';document.getElementById('f-cat').value='日用品';
  document.getElementById('f-price').value='';document.getElementById('f-url').value='';
  document.getElementById('f-stock').value=1;document.getElementById('f-threshold').value=2;document.getElementById('f-unit').value='';
  document.getElementById('f-auto-enabled').checked=false;document.getElementById('auto-fields').style.display='none';
  document.getElementById('f-pace-amount').value=1;document.getElementById('f-pace-period').value='day';
  document.getElementById('btn-delete').style.display='none';
  document.getElementById('img-preview').innerHTML='<span id="preview-emoji">🛒</span>';
  document.querySelectorAll('input[name="auto-mode"]')[0].checked=true;
  setMode('count');setPct(100);setPctThreshold(50);setAutoMode('manual');setPriority(2);buildEmojiGrid('🛒');
  document.getElementById('modal-overlay').classList.add('open');
}
function openEdit(key){
  const item=items.find(i=>i._key===key); if(!item) return;
  editFirebaseKey=key;uploadedImg=item.img||null;selectedEmoji=item.emoji;
  selectedPct=item.percent??100;selectedPctThreshold=item.pctThreshold??50;selectedPriority=item.priority??2;
  document.getElementById('modal-title').textContent='在庫を編集';
  document.getElementById('f-name').value=item.name;document.getElementById('f-cat').value=item.cat;
  document.getElementById('f-price').value=item.price??'';document.getElementById('f-url').value=item.url??'';
  document.getElementById('f-stock').value=item.stock??0;document.getElementById('f-threshold').value=item.threshold??2;document.getElementById('f-unit').value=item.unit||'';
  document.getElementById('f-auto-enabled').checked=!!item.autoEnabled;
  document.getElementById('auto-fields').style.display=item.autoEnabled?'':'none';
  document.getElementById('f-pace-amount').value=item.manualPace??1;document.getElementById('f-pace-period').value=item.pacePeriod??'day';
  document.getElementById('btn-delete').style.display='';
  document.getElementById('img-preview').innerHTML=item.img?`<img src="${item.img}" alt="">`:`<span id="preview-emoji">${item.emoji}</span>`;
  const autoMode=item.autoMode||'manual';
  document.querySelectorAll('input[name="auto-mode"]').forEach(r=>r.checked=(r.value===autoMode));
  setMode(item.mode||'count');setPct(item.percent??100);setPctThreshold(item.pctThreshold??50);
  setAutoMode(autoMode);setPriority(item.priority??2);buildEmojiGrid(item.emoji);
  document.getElementById('pace-unit-label').textContent=item.unit||'個';
  document.getElementById('modal-overlay').classList.add('open');
}
function closeModal(){document.getElementById('modal-overlay').classList.remove('open');}

async function saveItem(){
  const name=document.getElementById('f-name').value.trim();
  if(!name){alert('商品名を入力してください');return;}
  const autoEnabled=document.getElementById('f-auto-enabled').checked;
  const autoMode=document.querySelector('input[name="auto-mode"]:checked')?.value||'manual';
  const unit=document.getElementById('f-unit').value.trim()||'個';
  const priceRaw=document.getElementById('f-price').value;
  const price=priceRaw!==''?parseInt(priceRaw):null;
  const url=document.getElementById('f-url').value.trim()||null;
  const pacePeriod=document.getElementById('f-pace-period').value;
  const manualPace=parseFloat(document.getElementById('f-pace-amount').value)||1;
  const data={name,cat:document.getElementById('f-cat').value,mode:currentMode,emoji:selectedEmoji,img:uploadedImg||null,price,url,priority:selectedPriority,autoEnabled,autoMode,manualPace,pacePeriod,...(currentMode==='count'?{stock:parseInt(document.getElementById('f-stock').value)||0,threshold:parseInt(document.getElementById('f-threshold').value)||1,unit}:{percent:selectedPct,pctThreshold:selectedPctThreshold})};
  try{
    if(editFirebaseKey) await update(ref(db,`inventory/items/${editFirebaseKey}`),data);
    else await push(ref(db,'inventory/items'),data);
    closeModal();showToast('保存しました');
  }catch(e){alert('保存に失敗しました: '+e.message);}
}

function confirmDelete(){
  const item=items.find(i=>i._key===editFirebaseKey);if(!item)return;
  document.getElementById('confirm-msg').textContent=`「${item.name}」を削除しますか？`;
  document.getElementById('confirm-overlay').classList.add('open');
}
async function doDelete(){
  try{
    await remove(ref(db,`inventory/items/${editFirebaseKey}`));
    await remove(ref(db,`inventory/history/${editFirebaseKey}`));
    document.getElementById('confirm-overlay').classList.remove('open');
    closeModal();showToast('削除しました');
  }catch(e){alert('削除に失敗しました: '+e.message);}
}

/* ===== その他イベント ===== */
document.getElementById('btn-add').addEventListener('click',openAdd);
document.getElementById('btn-cancel').addEventListener('click',closeModal);
document.getElementById('btn-save').addEventListener('click',saveItem);
document.getElementById('btn-delete').addEventListener('click',confirmDelete);
document.getElementById('confirm-no').addEventListener('click',()=>document.getElementById('confirm-overlay').classList.remove('open'));
document.getElementById('confirm-yes').addEventListener('click',doDelete);
document.getElementById('modal-overlay').addEventListener('click',function(e){if(e.target===this)closeModal();});
document.getElementById('emoji-grid').addEventListener('click',function(e){
  const opt=e.target.closest('[data-emoji]');if(!opt)return;
  selectedEmoji=opt.dataset.emoji;
  const pe=document.getElementById('preview-emoji');if(pe)pe.textContent=selectedEmoji;
  buildEmojiGrid(selectedEmoji);
});
document.getElementById('f-unit').addEventListener('input',function(){document.getElementById('pace-unit-label').textContent=this.value||'個';});
document.getElementById('img-input').addEventListener('change',function(e){
  const file=e.target.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=ev=>{uploadedImg=ev.target.result;document.getElementById('img-preview').innerHTML=`<img src="${uploadedImg}" alt="">`;};
  reader.readAsDataURL(file);
});
