/* =====================
   家族の在庫管理アプリ
   app.js
   ===================== */

const EMOJIS = [
  '🧻','🧴','🧹','🪣','🧺','🐾',
  '🐶','🐱','🐟','🥫','🍚','🥤',
  '💊','🩺','🪥','🧼','🛁','🍶',
  '🧃','🫙','🍞','🥛','☕','🫧',
  '🧽','🗑'
];

const CAT_EMOJI = {
  '日用品':   '🏠',
  'ペット用品':'🐾',
  '食品・飲料':'🥦',
  '洗剤・清掃':'🧴',
  '薬・衛生':  '💊',
  'その他':    '📦'
};

// ローカル保存キー（クラウド版では不使用）
const STORAGE_KEY = 'family-inventory-v1';

let items = [];
let nextId = 1;
let activeTab = '全て';
let editId = null;
let selectedEmoji = '🛒';
let uploadedImg = null;

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

function nowHM() {
  const d = new Date();
  return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
}

/* =====================
   クラウド保存
   （Claude.ai 組み込み版のみ動作。
     ローカルHTML版では localStorage にフォールバック）
   ===================== */

async function loadFromCloud() {
  setSyncStatus('loading', 'データを読み込み中...');
  try {
    if (window.storage) {
      // Claude.ai 共有ストレージ
      const result = await window.storage.get(STORAGE_KEY, true);
      if (result && result.value) {
        const data = JSON.parse(result.value);
        items  = data.items  || [];
        nextId = data.nextId || (items.length ? Math.max(...items.map(i => i.id)) + 1 : 1);
      } else {
        items  = getDefaultItems();
        nextId = items.length + 1;
        await saveToCloud();
      }
    } else {
      // ローカル版フォールバック：localStorage を使用
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        items  = data.items  || [];
        nextId = data.nextId || (items.length ? Math.max(...items.map(i => i.id)) + 1 : 1);
      } else {
        items  = getDefaultItems();
        nextId = items.length + 1;
        saveLocal();
      }
    }
    setSyncStatus('ok', '最終更新：' + nowHM() + (window.storage ? ' （共有中）' : ' （ローカル）'));
  } catch (e) {
    setSyncStatus('error', '読み込みエラー。オフラインで動作中');
    if (!items.length) {
      items  = getDefaultItems();
      nextId = items.length + 1;
    }
  }
  render();
}

async function saveToCloud() {
  setSyncStatus('loading', '保存中...');
  const payload = JSON.stringify({ items, nextId });
  try {
    if (window.storage) {
      await window.storage.set(STORAGE_KEY, payload, true);
    } else {
      saveLocal();
    }
    setSyncStatus('ok', '最終更新：' + nowHM() + (window.storage ? ' （共有中）' : ' （ローカル）'));
  } catch (e) {
    setSyncStatus('error', '保存に失敗しました');
  }
}

function saveLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ items, nextId }));
  } catch (e) {
    console.warn('localStorage 保存失敗:', e);
  }
}

/* =====================
   初期データ
   ===================== */

function getDefaultItems() {
  return [
    { id:1, name:'トイレットペーパー', cat:'日用品',   stock:1, threshold:3, unit:'個', emoji:'🧻', img:null },
    { id:2, name:'シャンプー',         cat:'日用品',   stock:5, threshold:2, unit:'本', emoji:'🧴', img:null },
    { id:3, name:'ワンちゃんのエサ',   cat:'ペット用品', stock:2, threshold:2, unit:'袋', emoji:'🐾', img:null },
    { id:4, name:'猫砂',               cat:'ペット用品', stock:4, threshold:1, unit:'袋', emoji:'🐱', img:null },
    { id:5, name:'食器用洗剤',         cat:'洗剤・清掃', stock:1, threshold:2, unit:'本', emoji:'🧹', img:null },
    { id:6, name:'お米',               cat:'食品・飲料', stock:3, threshold:1, unit:'袋', emoji:'🍚', img:null },
  ];
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
    <div class="card ${st === 'ok' ? '' : st}" data-edit="${item.id}">
      ${imgEl}
      <div class="card-name">${item.name}</div>
      <div class="card-cat">${item.cat}</div>
      <div class="stock-row">
        <span style="font-size:13px;color:var(--color-text-secondary,#666)">在庫</span>
        ${badges[st]}
      </div>
      <div class="stepper">
        <button class="step-btn" data-step="${item.id}" data-delta="-1">−</button>
        <span class="step-val num-${st}">${item.stock}</span>
        <span style="font-size:12px;color:var(--color-text-secondary,#666)">${item.unit || '個'}</span>
        <button class="step-btn" data-step="${item.id}" data-delta="1">＋</button>
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
  editId = null; uploadedImg = null; selectedEmoji = '🛒';
  document.getElementById('modal-title').textContent = '商品を追加';
  document.getElementById('f-name').value      = '';
  document.getElementById('f-cat').value       = '日用品';
  document.getElementById('f-stock').value     = 1;
  document.getElementById('f-threshold').value = 2;
  document.getElementById('f-unit').value      = '';
  document.getElementById('btn-delete').style.display = 'none';
  document.getElementById('img-preview').innerHTML    = '<span id="preview-emoji">🛒</span>';
  buildEmojiGrid('🛒');
  document.getElementById('modal-overlay').classList.add('open');
}

function openEdit(id) {
  editId = id;
  const item = items.find(i => i.id === id);
  if (!item) return;
  selectedEmoji = item.emoji; uploadedImg = item.img || null;
  document.getElementById('modal-title').textContent  = '在庫を編集';
  document.getElementById('f-name').value             = item.name;
  document.getElementById('f-cat').value              = item.cat;
  document.getElementById('f-stock').value            = item.stock;
  document.getElementById('f-threshold').value        = item.threshold;
  document.getElementById('f-unit').value             = item.unit || '';
  document.getElementById('btn-delete').style.display = '';
  document.getElementById('img-preview').innerHTML    = item.img
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
    img:       uploadedImg
  };
  if (editId) {
    const idx = items.findIndex(i => i.id === editId);
    if (idx !== -1) items[idx] = { ...items[idx], ...data };
  } else {
    items.push({ id: nextId++, ...data });
  }
  closeModal();
  render();
  await saveToCloud();
  showToast('保存しました');
}

function confirmDelete() {
  const item = items.find(i => i.id === editId);
  if (!item) return;
  document.getElementById('confirm-msg').textContent = `「${item.name}」を削除しますか？`;
  document.getElementById('confirm-overlay').classList.add('open');
}

async function doDelete() {
  items = items.filter(i => i.id !== editId);
  document.getElementById('confirm-overlay').classList.remove('open');
  closeModal();
  render();
  await saveToCloud();
  showToast('削除しました');
}

/* =====================
   イベントリスナー
   ===================== */

document.getElementById('btn-add').addEventListener('click', openAdd);
document.getElementById('btn-cancel').addEventListener('click', closeModal);
document.getElementById('btn-save').addEventListener('click', saveItem);
document.getElementById('btn-delete').addEventListener('click', confirmDelete);
document.getElementById('btn-reload').addEventListener('click', loadFromCloud);

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
    const id    = parseInt(stepBtn.dataset.step);
    const delta = parseInt(stepBtn.dataset.delta);
    const item  = items.find(i => i.id === id);
    if (item) {
      item.stock = Math.max(0, item.stock + delta);
      render();
      await saveToCloud();
    }
    return;
  }
  const card = e.target.closest('[data-edit]');
  if (card) openEdit(parseInt(card.dataset.edit));
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

/* =====================
   起動
   ===================== */

loadFromCloud();
// 30秒ごとに自動更新（共有版で最新データを取得）
setInterval(loadFromCloud, 30000);
