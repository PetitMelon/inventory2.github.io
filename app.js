/* =====================================================
   家族の在庫管理アプリ — app.js
   Firebase Authentication + Realtime Database 対応版

   【セットアップ手順】
   1. https://console.firebase.google.com でプロジェクト作成
   2. 「Authentication」→「Sign-in method」→「メール/パスワード」を有効化
   3. 「Realtime Database」を作成（テストモードで開始）
   4. 「プロジェクトの設定」→「マイアプリ」→ ウェブアプリを追加
   5. 表示された firebaseConfig の値を下記に貼り付ける
   ===================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getDatabase,
  ref,
  onValue,
  set,
  push,
  remove,
  update
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";


   ★ ここにFirebaseの設定を貼り付けてください ★
const firebaseConfig = {
  apiKey: "AIzaSyDZ-SHcvAXcaBybYf6qZfduoDPPw6ljL1g",
  authDomain: "stocke-23237.firebaseapp.com",
  databaseURL: "https://stocke-23237-default-rtdb.firebaseio.com",
  projectId: "stocke-23237",
  storageBucket: "stocke-23237.firebasestorage.app",
  messagingSenderId: "1071402774871",
  appId: "1:1071402774871:web:3defc3bae3f4fcae8c8e12",
  measurementId: "G-18FNSNDLJX"
};

const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL:       "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

/* =====================
   Firebase 初期化
   ===================== */
const firebaseApp = initializeApp(firebaseConfig);
const auth        = getAuth(firebaseApp);
const db          = getDatabase(firebaseApp);

/* =====================
   定数
   ===================== */
const EMOJIS = [
  '🧻','🧴','🧹','🪣','🧺','🐾',
  '🐶','🐱','🐟','🥫','🍚','🥤',
  '💊','🩺','🪥','🧼','🛁','🍶',
  '🧃','🫙','🍞','🥛','☕','🫧',
  '🧽','🗑'
];

const CAT_EMOJI = {
  '日用品':    '🏠',
  'ペット用品': '🐾',
  '食品・飲料': '🥦',
  '洗剤・清掃': '🧴',
  '薬・衛生':   '💊',
  'その他':     '📦'
};

/* =====================
   状態
   ===================== */
let items         = [];
let activeTab     = '全て';
let editId        = null;
let editFirebaseKey = null;
let selectedEmoji = '🛒';
let uploadedImg   = null;
let dbUnsubscribe = null;

/* =====================
   ユーティリティ
   ===================== */
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

function setSyncStatus(status, label) {
  const dot = document.getElementById('sync-dot');
  dot.className = 'sync-dot' + (
    status === 'ok'      ? '' :
    status === 'loading' ? ' loading' : ' error'
  );
  document.getElementById('sync-label').textContent = label;
}

function getStatus(item) {
  if (item.stock === 0) return 'low';
  if (item.stock <= Math.floor(item.threshold / 2)) return 'low';
  if (item.stock <= item.threshold) return 'warn';
  return 'ok';
}

function getAllCats() {
  return ['全て', ...new Set(items.map(i => i.cat))];
}

/* =====================
   認証
   ===================== */
function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.style.display = 'block';
}

function hideAuthError() {
  document.getElementById('auth-error').style.display = 'none';
}

document.getElementById('btn-login').addEventListener('click', async () => {
  hideAuthError();
  const email    = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  if (!email || !password) { showAuthError('メールアドレスとパスワードを入力してください'); return; }
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (e) {
    showAuthError(authErrorMessage(e.code));
  }
});

document.getElementById('btn-register').addEventListener('click', async () => {
  hideAuthError();
  const email    = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  if (!email || !password) { showAuthError('メールアドレスとパスワードを入力してください'); return; }
  if (password.length < 6)  { showAuthError('パスワードは6文字以上で設定してください'); return; }
  try {
    await createUserWithEmailAndPassword(auth, email, password);
    showToast('登録しました。ようこそ！');
  } catch (e) {
    showAuthError(authErrorMessage(e.code));
  }
});

document.getElementById('btn-logout').addEventListener('click', async () => {
  if (dbUnsubscribe) { dbUnsubscribe(); dbUnsubscribe = null; }
  await signOut(auth);
});

function authErrorMessage(code) {
  switch (code) {
    case 'auth/invalid-email':          return 'メールアドレスの形式が正しくありません';
    case 'auth/user-not-found':         return 'このメールアドレスは登録されていません';
    case 'auth/wrong-password':         return 'パスワードが正しくありません';
    case 'auth/invalid-credential':     return 'メールアドレスまたはパスワードが正しくありません';
    case 'auth/email-already-in-use':   return 'このメールアドレスはすでに登録されています';
    case 'auth/weak-password':          return 'パスワードは6文字以上にしてください';
    case 'auth/too-many-requests':      return 'しばらく時間をおいてから再試行してください';
    default:                            return 'エラーが発生しました（' + code + '）';
  }
}

/* =====================
   ログイン状態の監視
   ===================== */
onAuthStateChanged(auth, (user) => {
  if (user) {
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('app-screen').style.display  = 'block';
    document.getElementById('user-label').textContent    = user.email;
    startRealtimeSync();
  } else {
    document.getElementById('auth-screen').style.display = 'flex';
    document.getElementById('app-screen').style.display  = 'none';
    items = [];
  }
});

/* =====================
   Realtime Database 同期
   ===================== */
function startRealtimeSync() {
  setSyncStatus('loading', '接続中...');
  const itemsRef = ref(db, 'inventory/items');

  // onValue でリアルタイム購読（他の端末の変更も即反映）
  dbUnsubscribe = onValue(itemsRef, (snapshot) => {
    const data = snapshot.val();
    if (data) {
      items = Object.entries(data).map(([key, val]) => ({ ...val, _key: key }));
    } else {
      items = [];
      // 初回アクセス時はサンプルデータを投入
      initDefaultItems();
    }
    setSyncStatus('ok', 'リアルタイム同期中');
    render();
  }, (error) => {
    setSyncStatus('error', '接続エラー');
    console.error(error);
  });
}

async function initDefaultItems() {
  const defaults = [
    { name:'トイレットペーパー', cat:'日用品',    stock:1, threshold:3, unit:'個', emoji:'🧻', img:null },
    { name:'シャンプー',         cat:'日用品',    stock:5, threshold:2, unit:'本', emoji:'🧴', img:null },
    { name:'ワンちゃんのエサ',   cat:'ペット用品', stock:2, threshold:2, unit:'袋', emoji:'🐾', img:null },
    { name:'猫砂',               cat:'ペット用品', stock:4, threshold:1, unit:'袋', emoji:'🐱', img:null },
    { name:'食器用洗剤',         cat:'洗剤・清掃', stock:1, threshold:2, unit:'本', emoji:'🧹', img:null },
    { name:'お米',               cat:'食品・飲料', stock:3, threshold:1, unit:'袋', emoji:'🍚', img:null },
  ];
  const itemsRef = ref(db, 'inventory/items');
  for (const item of defaults) {
    await push(itemsRef, item);
  }
}

/* =====================
   描画
   ===================== */
function render() {
  renderTabs();
  renderAlerts();
  renderList();
}

function renderTabs() {
  document.getElementById('tabs').innerHTML = getAllCats().map(c =>
    `<button class="tab${activeTab === c ? ' active' : ''}" data-tab="${c}">${CAT_EMOJI[c] || '📋'} ${c}</button>`
  ).join('');
}

function renderAlerts() {
  const low = items.filter(i => getStatus(i) !== 'ok');
  document.getElementById('alert-area').innerHTML = low.length
    ? `<div class="alert-banner"><span class="alert-dot"></span>在庫が少ない商品が${low.length}件あります：${low.map(i => i.name).join('、')}</div>`
    : '';
}

function cardHTML(item) {
  const st = getStatus(item);
  const badges = {
    ok:   '<span class="status-badge badge-ok">十分</span>',
    warn: '<span class="status-badge badge-warn">少ない</span>',
    low:  '<span class="status-badge badge-low">要補充</span>'
  };
  const imgEl = item.img
    ? `<div class="card-img"><img src="${item.img}" alt="${item.name}"></div>`
    : `<div class="card-img">${item.emoji}</div>`;
  return `
    <div class="card ${st === 'ok' ? '' : st}" data-key="${item._key}">
      ${imgEl}
      <div class="card-name">${item.name}</div>
      <div class="card-cat">${item.cat}</div>
      <div class="stock-row">
        <span style="font-size:13px;color:#666">在庫</span>
        ${badges[st]}
      </div>
      <div class="stepper">
        <button class="step-btn" data-step="${item._key}" data-delta="-1">−</button>
        <span class="step-val num-${st}">${item.stock}</span>
        <span style="font-size:12px;color:#666">${item.unit || '個'}</span>
        <button class="step-btn" data-step="${item._key}" data-delta="1">＋</button>
      </div>
    </div>`;
}

function renderList() {
  const filtered = activeTab === '全て' ? items : items.filter(i => i.cat === activeTab);
  const el = document.getElementById('list-area');
  if (!filtered.length) {
    el.innerHTML = '<div class="empty">商品がありません。「＋ 追加」から登録してください。</div>';
    return;
  }
  if (activeTab === '全て') {
    const cats = [...new Set(filtered.map(i => i.cat))];
    el.innerHTML = cats.map(cat => {
      const ci = filtered.filter(i => i.cat === cat);
      return `<div class="section-title">${CAT_EMOJI[cat] || '📦'} ${cat}</div>
              <div class="grid">${ci.map(cardHTML).join('')}</div>`;
    }).join('');
  } else {
    el.innerHTML = `<div class="grid">${filtered.map(cardHTML).join('')}</div>`;
  }
}

/* =====================
   モーダル操作
   ===================== */
function buildEmojiGrid(sel) {
  document.getElementById('emoji-grid').innerHTML = EMOJIS.map(e =>
    `<div class="emoji-opt${e === sel ? ' selected' : ''}" data-emoji="${e}">${e}</div>`
  ).join('');
}

function openAdd() {
  editId = null; editFirebaseKey = null; uploadedImg = null; selectedEmoji = '🛒';
  document.getElementById('modal-title').textContent        = '商品を追加';
  document.getElementById('f-name').value                   = '';
  document.getElementById('f-cat').value                    = '日用品';
  document.getElementById('f-stock').value                  = 1;
  document.getElementById('f-threshold').value              = 2;
  document.getElementById('f-unit').value                   = '';
  document.getElementById('btn-delete').style.display       = 'none';
  document.getElementById('img-preview').innerHTML          = '<span id="preview-emoji">🛒</span>';
  buildEmojiGrid('🛒');
  document.getElementById('modal-overlay').classList.add('open');
}

function openEdit(key) {
  const item = items.find(i => i._key === key);
  if (!item) return;
  editId = item.id; editFirebaseKey = key; uploadedImg = item.img || null; selectedEmoji = item.emoji;
  document.getElementById('modal-title').textContent        = '在庫を編集';
  document.getElementById('f-name').value                   = item.name;
  document.getElementById('f-cat').value                    = item.cat;
  document.getElementById('f-stock').value                  = item.stock;
  document.getElementById('f-threshold').value              = item.threshold;
  document.getElementById('f-unit').value                   = item.unit || '';
  document.getElementById('btn-delete').style.display       = '';
  document.getElementById('img-preview').innerHTML          = item.img
    ? `<img src="${item.img}" alt="">`
    : `<span id="preview-emoji">${item.emoji}</span>`;
  buildEmojiGrid(item.emoji);
  document.getElementById('modal-overlay').classList.add('open');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
}

async function saveItem() {
  const name = document.getElementById('f-name').value.trim();
  if (!name) { alert('商品名を入力してください'); return; }
  const data = {
    name,
    cat:       document.getElementById('f-cat').value,
    stock:     parseInt(document.getElementById('f-stock').value)     || 0,
    threshold: parseInt(document.getElementById('f-threshold').value) || 1,
    unit:      document.getElementById('f-unit').value.trim() || '個',
    emoji:     selectedEmoji,
    img:       uploadedImg || null
  };
  try {
    if (editFirebaseKey) {
      await update(ref(db, `inventory/items/${editFirebaseKey}`), data);
    } else {
      await push(ref(db, 'inventory/items'), data);
    }
    closeModal();
    showToast('保存しました');
  } catch (e) {
    alert('保存に失敗しました: ' + e.message);
  }
}

function confirmDelete() {
  const item = items.find(i => i._key === editFirebaseKey);
  if (!item) return;
  document.getElementById('confirm-msg').textContent = `「${item.name}」を削除しますか？`;
  document.getElementById('confirm-overlay').classList.add('open');
}

async function doDelete() {
  try {
    await remove(ref(db, `inventory/items/${editFirebaseKey}`));
    document.getElementById('confirm-overlay').classList.remove('open');
    closeModal();
    showToast('削除しました');
  } catch (e) {
    alert('削除に失敗しました: ' + e.message);
  }
}

/* =====================
   イベントリスナー
   ===================== */
document.getElementById('btn-add').addEventListener('click', openAdd);
document.getElementById('btn-cancel').addEventListener('click', closeModal);
document.getElementById('btn-save').addEventListener('click', saveItem);
document.getElementById('btn-delete').addEventListener('click', confirmDelete);

document.getElementById('confirm-no').addEventListener('click', () =>
  document.getElementById('confirm-overlay').classList.remove('open')
);
document.getElementById('confirm-yes').addEventListener('click', doDelete);

document.getElementById('modal-overlay').addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});

document.getElementById('tabs').addEventListener('click', function(e) {
  const t = e.target.closest('[data-tab]');
  if (t) { activeTab = t.dataset.tab; render(); }
});

document.getElementById('list-area').addEventListener('click', async function(e) {
  const stepBtn = e.target.closest('[data-step]');
  if (stepBtn) {
    const key   = stepBtn.dataset.step;
    const delta = parseInt(stepBtn.dataset.delta);
    const item  = items.find(i => i._key === key);
    if (item) {
      const newStock = Math.max(0, item.stock + delta);
      await update(ref(db, `inventory/items/${key}`), { stock: newStock });
    }
    return;
  }
  const card = e.target.closest('[data-key]');
  if (card) openEdit(card.dataset.key);
});

document.getElementById('emoji-grid').addEventListener('click', function(e) {
  const opt = e.target.closest('[data-emoji]');
  if (!opt) return;
  selectedEmoji = opt.dataset.emoji;
  const pe = document.getElementById('preview-emoji');
  if (pe) pe.textContent = selectedEmoji;
  buildEmojiGrid(selectedEmoji);
});

document.getElementById('img-input').addEventListener('change', function(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(ev) {
    uploadedImg = ev.target.result;
    document.getElementById('img-preview').innerHTML = `<img src="${uploadedImg}" alt="">`;
  };
  reader.readAsDataURL(file);
});
