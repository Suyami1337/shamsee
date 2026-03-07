// ── Supabase init ─────────────────────────────────
const _SB = supabase.createClient('https://kkaixwmqclsudabgofcf.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtrYWl4d21xY2xzdWRhYmdvZmNmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1MDc4ODcsImV4cCI6MjA4ODA4Mzg4N30.zD9M-Tthd_FBdcrXuOukEdxuWnIaR0yWfm0CnWyuhb0');
let _currentUser = null;
let _projectId   = null;
let _projectName = '';
let _projectEmoji= '💼';

// ── Root element helper (desktop='app', mobile='content-root') ──
// SEC: Экранирование HTML — защита от XSS при вставке user data в innerHTML
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _appRoot() {
  return document.getElementById('app') || document.getElementById('content-root');
}


async function initAuth() {
  const showStatus = (msg) => {
    const el = _appRoot();
    if (el) el.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding-top:120px;gap:16px;min-height:60vh"><div style="font-size:48px;animation:spin 2s linear infinite">⚙️</div><div style="font-size:14px;color:#555">' + msg + '</div></div><style>@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}</style>';
  };
  showStatus('Проверяем сессию...');
  let sessionData;
  try {
    const result = await Promise.race([
      _SB.auth.getSession(),
      new Promise((_,reject) => setTimeout(() => reject(new Error('session timeout')), 8000))
    ]);
    sessionData = result;
  } catch(e) {
    _appRoot().innerHTML = '<div style="color:orange;padding:40px;font-family:monospace">Ошибка подключения: ' + e.message + '<br><br>Попробуй обновить страницу</div>';
    return false;
  }
  const { data } = sessionData;
  if (!data.session) { window.location.href = '/login'; return false; }
  _currentUser  = data.session.user;
  _projectId    = localStorage.getItem('active_project_id');
  _projectName  = localStorage.getItem('active_project_name') || '';
  _projectEmoji = localStorage.getItem('active_project_emoji') || '💼';

  // Always load projects from DB to validate and populate switcher
  try {
    await Promise.race([
      loadAllProjects(),
      new Promise((_,reject) => setTimeout(() => reject(new Error('timeout')), 8000))
    ]);
  } catch(e) { console.warn('loadAllProjects timeout/error', e); }

  const projects = state._allProjects || [];

  // No projects in DB at all — redirect to onboarding page
  if (projects.length === 0) {
    window.location.href = '/onboarding';
    return false;
  }

  // Validate that the stored projectId actually exists in DB
  const storedValid = _projectId && projects.some(p => p.id === _projectId);
  if (!storedValid) {
    // Pick first available project
    const first = projects[0];
    _projectId    = first.id;
    _projectName  = first.name || '';
    _projectEmoji = first.emoji || '💼';
    localStorage.setItem('active_project_id',    _projectId);
    localStorage.setItem('active_project_name',  _projectName);
    localStorage.setItem('active_project_emoji', _projectEmoji);
  }
  // Read active month from sessionStorage (set by dates.html or projects.html)
  const savedMonth = sessionStorage.getItem('active_month');
  if (!savedMonth) {
    // Auto-set current month instead of redirecting
    const now = new Date();
    const curMonth = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0');
    sessionStorage.setItem('active_month', curMonth);
    state.activeMonth = curMonth;
  } else {
    state.activeMonth = savedMonth;
  }
  // Restore custom period if set from dates.html
  const savedPeriod = sessionStorage.getItem('active_period');
  if (savedPeriod) {
    try { state.activePeriod = JSON.parse(savedPeriod); } catch(e) {}
    sessionStorage.removeItem('active_period'); // use once
  }
  if (window.location.hash) history.replaceState(null, '', window.location.pathname);
  return true;
}

async function cloudSave(payload) {
  if (!_currentUser || !_projectId) { console.warn('cloudSave: no user or project'); return; }
  try {
    const uid = _currentUser.id + '_' + _projectId;
    console.log('cloudSave: saving uid=', uid, 'txCount=', (payload.transactions||[]).length);
    const { error } = await _SB.from('user_data').upsert(
      { user_id: uid, project_id: _projectId, data: payload, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );
    if (error) { console.error('cloudSave error:', error); showSaveIndicator('error'); }
    else { showSaveIndicator('ok'); }
  } catch(e) { console.error('cloudSave exception:', e); showSaveIndicator('error'); }
}

// ── Custom confirm dialog (replaces browser confirm()) ────────────────────
function showConfirm(msg, onOk, { okLabel = 'Удалить', okStyle = 'danger' } = {}) {
  const existing = document.getElementById('_confirm_modal');
  if (existing) existing.remove();

  const okColor = okStyle === 'danger'
    ? 'background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.4);color:#f87171'
    : 'background:rgba(110,231,183,0.15);border:1px solid rgba(110,231,183,0.4);color:#6ee7b7';

  const el = document.createElement('div');
  el.id = '_confirm_modal';
  el.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px)';
  el.innerHTML = `
    <div style="background:#111;border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:28px 24px;max-width:360px;width:90%;text-align:center">
      <div style="font-size:14px;color:#ccc;line-height:1.6;margin-bottom:24px;white-space:pre-line">${msg}</div>
      <div style="display:flex;gap:10px;justify-content:center">
        <button id="_confirm_cancel" style="padding:10px 20px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:#888;font-size:14px;cursor:pointer">Отмена</button>
        <button id="_confirm_ok" style="padding:10px 20px;border-radius:10px;border:none;font-size:14px;font-weight:600;cursor:pointer;${okColor}">${okLabel}</button>
      </div>
    </div>`;
  document.body.appendChild(el);

  // Escape key closes modal
  const onKeydown = (e) => { if (e.key === 'Escape') { cancel(); } };
  document.addEventListener('keydown', onKeydown, { once: true });

  const cancel = () => { el.remove(); document.removeEventListener('keydown', onKeydown); if (typeof onCancel === 'function') onCancel(); };
  const confirm = () => { el.remove(); document.removeEventListener('keydown', onKeydown); onOk(); };

  document.getElementById('_confirm_cancel').onclick = cancel;
  el.addEventListener('click', e => { if (e.target === el) cancel(); });
  document.getElementById('_confirm_ok').onclick = confirm;
}

// Promisified showConfirm — resolves true on OK, false on Cancel/Escape
// Usage: if (!await confirmAsync('Удалить?', {okLabel:'Удалить'})) return;
function confirmAsync(msg, opts = {}) {
  return new Promise(resolve => {
    showConfirm(msg, () => resolve(true), { ...opts, onCancel: () => resolve(false) });
  });
}

function showToast(msg, type) {
  // type: 'success' | 'error' | 'info' (default)
  const isMobile = !!document.getElementById('content-root');
  let el = document.getElementById('_toast_indicator');
  if (!el) {
    el = document.createElement('div');
    el.id = '_toast_indicator';
    document.body.appendChild(el);
  }
  clearTimeout(el._timer);
  const styles = {
    success: 'background:rgba(110,231,183,0.15);border:1px solid rgba(110,231,183,0.3);color:#6ee7b7',
    error:   'background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);color:#f87171',
    info:    'background:rgba(148,163,184,0.15);border:1px solid rgba(148,163,184,0.25);color:#cbd5e1',
  };
  const position = isMobile
    ? 'top:16px;left:50%;transform:translateX(-50%);bottom:auto;right:auto;width:calc(100vw - 40px);text-align:center'
    : 'bottom:60px;right:20px;max-width:320px';
  el.style.cssText = 'position:fixed;' + position + ';z-index:99999;padding:12px 18px;border-radius:12px;font-size:14px;font-weight:600;line-height:1.4;transition:opacity 0.3s,transform 0.3s;pointer-events:none;white-space:pre-line;box-shadow:0 4px 24px rgba(0,0,0,0.4);opacity:1;' + (styles[type] || styles.info);
  el.textContent = msg;
  el._timer = setTimeout(() => { el.style.opacity = '0'; }, type === 'error' ? 4000 : 2500);
}

function showSaveIndicator(status) {
  const isMobile = !!document.getElementById('content-root');
  let el = document.getElementById('_save_indicator');
  if (!el) {
    el = document.createElement('div');
    el.id = '_save_indicator';
    document.body.appendChild(el);
  }
  clearTimeout(el._timer);
  const position = isMobile
    ? 'bottom:90px;left:0;right:0;margin:0 auto;width:fit-content;white-space:nowrap'
    : 'bottom:20px;right:20px';
  if (status === 'ok') {
    el.style.cssText = 'position:fixed;' + position + ';z-index:9999;padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;transition:opacity 0.4s;pointer-events:none;background:rgba(110,231,183,0.15);border:1px solid rgba(110,231,183,0.3);color:#6ee7b7;opacity:1;box-shadow:0 4px 16px rgba(0,0,0,0.3)';
    el.textContent = '✓ Сохранено';
  } else {
    el.style.cssText = 'position:fixed;' + position + ';z-index:9999;padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;transition:opacity 0.4s;pointer-events:none;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);color:#f87171;opacity:1;box-shadow:0 4px 16px rgba(0,0,0,0.3)';
    el.textContent = '⚠ Ошибка сохранения';
  }
  el._timer = setTimeout(() => { el.style.opacity = '0'; }, 2000);
}

async function cloudLoad() {
  if (!_currentUser || !_projectId) {
    console.warn('cloudLoad: no user or project', _currentUser, _projectId);
    return null;
  }
  try {
    const uid = _currentUser.id + '_' + _projectId;
    console.log('cloudLoad: fetching uid=', uid);
    const { data, error } = await _SB.from('user_data').select('data').eq('user_id', uid).maybeSingle();
    if (error) { console.error('cloudLoad error:', error); return null; }
    console.log('cloudLoad: got data=', data ? 'YES, keys=' + Object.keys(data.data || {}).join(',') : 'NULL');
    return data ? data.data : null;
  } catch(e) { console.error('cloudLoad exception:', e); return null; }
}

// ─── DATA ──────────────────────────────────────────────────────────────────

const DEFAULT_DIRECTIONS = {};
let DIRECTIONS = JSON.parse(JSON.stringify(DEFAULT_DIRECTIONS));

const INITIAL_ACCOUNTS = {};
const INITIAL_FUNDS = {
  cushion: { name: 'Подушка безопасности', balance: 0, currency: 'RUB', icon: '🛡️', color: '#6ee7b7' },
  invest:  { name: 'Инвест капитал',       balance: 0, currency: 'RUB', icon: '📈', color: '#93c5fd' },
  goals:   { name: 'Цели-хотелки',         balance: 0, currency: 'RUB', icon: '🎯', color: '#fbbf24' },
};

const DEFAULT_CATEGORIES_IN = [
  'Выручка','Зарплата','Услуги','Дивиденды',
  'Поступление от клиента','Возврат средств','Перевод входящий','Прочий доход'
];
let CATEGORIES_IN = [...DEFAULT_CATEGORIES_IN]; // legacy
const DEFAULT_CATEGORIES_OUT = [
  'Аренда','Зарплата / ФОТ','Реклама и маркетинг','Сервисы и подписки',
  'Связь и интернет','Транспорт','Налоги','Комиссии и эквайринг',
  'Перевод исходящий','Прочий расход'
];
const CATEGORIES_DIVIDENDS = ['Дивиденды собственника', 'Дивиденды партнёру'];
const CATEGORIES_DDS = [
  'Перевод между счетами','Снятие наличных','Пополнение счёта',
  'Обмен валют','Выплата дивидендов',
  'Пополнение фонда','Вывод из фонда'
];
// Legacy — kept for existing projects
const DEFAULT_CATEGORIES_OUT_PERSONAL = [
  'Аренда Квартира','Аренда Машины','Аренда Офис','ЖКХ','Налоги','Штрафы',
  'Интернет','Мобильная связь','Подписки','Доставка еды','Продукты',
  'Медицина','Покупки','Бензин','Обучение','Спорт','Отдых',
  'Мама','Жена','Дети','Такси','Иные расходы','Возвраты','Садака',
  'Перевод исходящий','Прочий расход'
];
const DEFAULT_CATEGORIES_OUT_PROJECT = [
  'Отдел продаж','Реклама','Сервисы','Прочие услуги','Зарплата (ФОТ)',
  'Эквайринг','Налоги','Дивиденды партнёру','Перевод исходящий','Прочий расход'
];
let CATEGORIES_OUT_PERSONAL = [...DEFAULT_CATEGORIES_OUT_PERSONAL];
let CATEGORIES_OUT_PROJECT  = [...DEFAULT_CATEGORIES_OUT_PROJECT];
let CATEGORIES_OUT = [...new Set([...DEFAULT_CATEGORIES_OUT, ...CATEGORIES_OUT_PERSONAL, ...CATEGORIES_OUT_PROJECT])];
const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

// ─── STATE ─────────────────────────────────────────────────────────────────
let state = {
  transactions: [],
  directions: {},
  accounts: {},
  dirOrder: null,  // null = use Object.keys order; array of dirKeys when reordered
  accOrder: null,
  fundOrder: null,  // null = use Object.keys order; array of accKeys when reordered
  tabOrder: null,    // null = default order; array of tab keys when reordered
  // per-direction categories: { dirKey: { in: [...], out: [...] } }
  dirCategories: {},
  // partner payments: { dirKey: [{ id, date, amount, note }] }
  partnerPayments: {},
  partnersActiveDir: null,
  enabledModules: { goals: false, budgets: false, spending: false, partners: false },
  showPartnerModal: null, // { dirKey, partnerId, partnerName }
  showPartnerManage: null, // dirKey
  showEditTxModal: null, // tx id
  showTxDetail: null, // tx id
  showDeleteConfirm: false,
  _pendingDeleteTxId: null,
  showExportModal: false,
  showSettingsModal: false,
  showProfileModal: false,
  txTypeFilter: ['income','expense','transfer','dividend'], // active types
  txSearch: '',       // live search query
  showTxAdvFilter: false,
  showCatPicker: false,
  txCatFilter: [],    // category filter (array for multi-select)
  txDateFrom: '',
  txDateTo: '',
  funds: JSON.parse(JSON.stringify(INITIAL_FUNDS)),
  fundHistory: [],
  tab: 'overview',
  activeDir: null,
  activeMonth: null,
  activePeriod: null,  // { mode: 'month'|'year'|'range', year?, from?, to? }
  showPeriodModal: false,
  showProjectSwitcher: false,
  _allProjects: [],  // loaded once from supabase
  _loadingProjects: false,
  showModal: false,
  showModePicker: false,
  showAiChat: false,
  aiMessages: [],
  aiPendingTxs: [],
  aiPendingCats: [],
  aiPendingEntities: null,  // { dirs, accs, funds } waiting for confirm
  aiEditingIdx: null,
  aiActiveImage: null,  // last uploaded image - persists for follow-up questions
  aiActiveImageMt: null,
  showFundModal: false,
  showAddFundModal: false,
  showEditFundModal: false,
  editFundKey: null,
  addFundForm: { name: '', currency: 'RUB', emoji: '💰', color: '#a78bfa' },
  showAccModal: false,
  showAddAccModal: false,
  showEditAccModal: false,
  editAccKey: null,
  addAccForm: { name: '', currency: 'RUB', direction: '', emoji: '💳', color: '#a78bfa' },
  accForm: { fromKey: 'personal_rub', toKey: 'saudi_sar', fromAmount: '', toAmount: '', note: '', date: '' },
  showCatEditor: null, // { dirKey, type: 'in'|'out' }
  showAddDirModal: false,
  showEditDirModal: false,
  editDirKey: null,
  addDirForm: { label: '', icon: '🏢', color: '#a78bfa', partners: [] },
  showPartnerEditModal: null, // { dirKey }
  showRates: false,
  rates: { SAR: 20.5, USDT: 90, USD: 90, source: 'fallback', updatedAt: null },
  form: null,
  fundForm: { fund: '', amount: '', type: 'in', note: '', date: '', account: '' },
};
state.form = defaultForm();

function _localDateStr() {
  // Use device local time — correct for all timezones
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function defaultProjectData() {
  return {
    transactions: [],
    accounts: {
      personal_card: { name: '💳 Личная карта', balance: 0, currency: 'RUB', color: '#6ee7b7' },
      cash:          { name: '💵 Наличные',     balance: 0, currency: 'RUB', color: '#a78bfa' },
    },
    accOrder: ['personal_card', 'cash'],
    funds: {
      cushion: { name: 'Подушка безопасности', balance: 0, currency: 'RUB', icon: '🛡️', color: '#6ee7b7' },
      savings:  { name: 'Накопительный счёт',  balance: 0, currency: 'RUB', icon: '💵', color: '#93c5fd' },
    },
    fundHistory: [], directions: {}, dirCategories: {}, partnerPayments: {},
    rates: { SAR: 20.5, USDT: 90, USD: 90, source: 'fallback', updatedAt: null },
    enabledCurrencies: ['RUB', 'USD'],
    theme: 'dark', lang: 'ru',
    dirOrder: null, accOrder: ['personal_card', 'cash'], fundOrder: null, tabOrder: null,
  };
}

function defaultForm() {
  const today = _localDateStr(); // ALWAYS today's date regardless of selected month
  // Pick first account from state
  const firstAccEntry = Object.entries(state.accounts || {})[0];
  const firstAcc = firstAccEntry ? firstAccEntry[0] : '';
  const firstCur = firstAccEntry ? firstAccEntry[1].currency : 'RUB';
  const secondAccEntry = Object.entries(state.accounts || {}).find(([k]) => k !== firstAcc);
  const secondAcc = secondAccEntry ? secondAccEntry[0] : '';
  return { date: today, type: 'income', account: firstAcc, toAccount: secondAcc, amount: '', toAmount: '', currency: firstCur, category: '', note: '' };
}

// ─── PERSISTENCE ───────────────────────────────────────────────────────────
function loadFromStorage() {
  // localStorage removed — all data comes from Supabase cloud
}

function getDirCats(dirKey, type) {
  // Global categories shared across all directions
  const key = '_global';
  if (!state.dirCategories[key]) state.dirCategories[key] = {};
  if (!state.dirCategories[key][type]) {
    if (type === 'in') {
      // Migrate from existing direction cats if available, else use defaults
      const existing = Object.entries(state.dirCategories)
        .filter(([k]) => k !== '_global' && state.dirCategories[k][type])
        .flatMap(([,v]) => v[type] || []);
      const merged = existing.length > 0
        ? [...new Set(existing)]
        : [...DEFAULT_CATEGORIES_IN];
      state.dirCategories[key][type] = merged;
    } else {
      const existing = Object.entries(state.dirCategories)
        .filter(([k]) => k !== '_global' && state.dirCategories[k][type])
        .flatMap(([,v]) => v[type] || []);
      const merged = existing.length > 0
        ? [...new Set(existing)]
        : [...DEFAULT_CATEGORIES_OUT];
      state.dirCategories[key][type] = merged;
    }
  }
  // Always deduplicate in place (fixes legacy cloud data)
  const arr = state.dirCategories[key][type];
  const deduped = [...new Set(arr.map(s => s.trim()).filter(Boolean))];
  if (deduped.length !== arr.length) state.dirCategories[key][type] = deduped;
  return state.dirCategories[key][type];
}

function syncCatState() {
  // nothing to sync globally — all per-direction
  saveToStorage();
}

function getFullState() {
  return { transactions: state.transactions, accounts: state.accounts, funds: state.funds, fundHistory: state.fundHistory, directions: state.directions, dirCategories: state.dirCategories, enabledModules: state.enabledModules, partnerPayments: state.partnerPayments, rates: state.rates, enabledCurrencies: state.enabledCurrencies, theme: state.theme, lang: state.lang, dirOrder: state.dirOrder, accOrder: state.accOrder, fundOrder: state.fundOrder, tabOrder: state.tabOrder };
}

function saveToStorage() {
  // Guard: never save before cloudLoad completes — prevents wiping data on page load
  if (!window._appReady) return;
  // Debounced cloud save
  clearTimeout(window._saveTimer);
  window._saveTimer = setTimeout(() => cloudSave(getFullState()), 1000);
}

// Save immediately before user leaves the page
window.addEventListener('beforeunload', () => {
  if (!window._appReady) return;
  if (window._saveTimer) {
    clearTimeout(window._saveTimer);
    cloudSave(getFullState());
  }
});

// Also save when tab becomes hidden (mobile / tab switch)
document.addEventListener('visibilitychange', () => {
  if (!window._appReady) return;
  if (document.hidden) {
    clearTimeout(window._saveTimer);
    cloudSave(getFullState());
  }
});

// ─── UTILS ─────────────────────────────────────────────────────────────────
function getOrderedDirs() {
  const keys = Object.keys(DIRECTIONS);
  if (!state.dirOrder) return keys;
  return [...state.dirOrder.filter(k => keys.includes(k)), ...keys.filter(k => !state.dirOrder.includes(k))];
}

function getOrderedAccounts() {
  const keys = Object.keys(state.accounts);
  if (!state.accOrder) return keys;
  return [...state.accOrder.filter(k => keys.includes(k)), ...keys.filter(k => !state.accOrder.includes(k))];
}

// Unified account option label: Account Name — Currency — Balance
function accOption(k, a, selKey) {
  const bal = fmt(a.balance, a.currency);
  const label = a.name + ' — ' + a.currency + ' — ' + bal;
  const sel = k === selKey ? 'selected' : '';
  return `<option value="${k}" ${sel}>${label}</option>`;
}

// All accounts as flat list
function allAccOptions(selKey) {
  const opts = getOrderedAccounts()
    .map(k => accOption(k, state.accounts[k], selKey)).join('');
  return `<optgroup label="${_projectEmoji} ${_projectName}">${opts}</optgroup>`;
}

// Accounts filtered to a direction (kept for backward compat)
function dirAccOptions(dirKey, selKey) {
  return getOrderedAccounts()
    .filter(k => state.accounts[k].direction === dirKey)
    .map(k => accOption(k, state.accounts[k], selKey)).join('');
}

// Accounts excluding one key, flat list
function allAccOptionsExcept(excludeKey, selKey) {
  const opts = getOrderedAccounts()
    .filter(k => k !== excludeKey)
    .map(k => accOption(k, state.accounts[k], selKey)).join('');
  return opts ? `<optgroup label="${_projectEmoji} ${_projectName}">${opts}</optgroup>` : '';
}

// Fund as virtual account option
function fundOption(k, f, selKey) {
  const bal = fmt(f.balance, f.currency || 'RUB');
  const label = (f.icon ? f.icon + ' ' : '') + f.name + ' — ' + (f.currency || 'RUB') + ' — ' + bal;
  const sel = ('fund:' + k) === selKey ? 'selected' : '';
  return `<option value="fund:${k}" ${sel}>${label}</option>`;
}

// All accounts + all funds as flat list
function allAccAndFundOptions(selKey) {
  const opts = getOrderedAccounts()
    .map(k => accOption(k, state.accounts[k], selKey)).join('');
  const accs = opts ? `<optgroup label="${_projectEmoji} ${_projectName}">${opts}</optgroup>` : '';
  const funds = Object.keys(state.funds||{}).length
    ? '<optgroup label="💰 Фонды">' + Object.entries(state.funds||{}).map(([k,f]) => fundOption(k, f, selKey)).join('') + '</optgroup>'
    : '';
  return accs + funds;
}

// All accounts + funds excluding one key
function allAccAndFundOptionsExcept(excludeKey, selKey) {
  const opts = getOrderedAccounts()
    .filter(k => k !== excludeKey && ('fund:'+k) !== excludeKey)
    .map(k => accOption(k, state.accounts[k], selKey)).join('');
  const accs = opts ? `<optgroup label="${_projectEmoji} ${_projectName}">${opts}</optgroup>` : '';
  const funds = Object.keys(state.funds||{}).length
    ? '<optgroup label="💰 Фонды">' + Object.entries(state.funds||{})
        .filter(([k]) => ('fund:'+k) !== excludeKey && k !== excludeKey)
        .map(([k,f]) => fundOption(k, f, selKey)).join('') + '</optgroup>'
    : '';
  return accs + funds;
}

// Resolve balance change for a key that may be "fund:key" or a regular account key
// Check if deducting amt from account/fund would go negative
// Returns null if OK, or error string if not enough balance
function checkSufficientBalance(key, amt) {
  if (!key || amt <= 0) return null;
  if (String(key).startsWith('fund:')) {
    const fk = key.slice(5);
    const f = (state.funds||{})[fk];
    if (!f) return null;
    if (f.balance - amt < 0) return `Недостаточно средств в фонде «${f.icon} ${f.name}»: баланс ${fmt(f.balance, f.currency||'RUB')}, нужно ${fmt(amt, f.currency||'RUB')}`;
  } else {
    const a = (state.accounts||{})[key];
    if (!a) return null;
    if (a.balance - amt < 0) return `Недостаточно средств на счёте «${a.name}»: баланс ${fmt(a.balance, a.currency)}, нужно ${fmt(amt, a.currency)}`;
  }
  return null;
}

function applyBalanceDelta(key, delta) {
  if (!key) return;
  if (String(key).startsWith('fund:')) {
    const fk = key.slice(5);
    if (state.funds[fk]) state.funds[fk].balance += delta;
  } else {
    if (state.accounts[key]) state.accounts[key].balance += delta;
  }
}

function getOrderedFunds() {
  const keys = Object.keys(state.funds || {});
  if (!state.fundOrder) return keys;
  return [...state.fundOrder.filter(k => keys.includes(k)), ...keys.filter(k => !state.fundOrder.includes(k))];
}

function toRub(amount, currency) {
  if (!currency || currency === 'RUB') return amount;
  const rate = state.rates[currency];
  if (rate) return amount * rate;
  return amount; // unknown currency — return as-is
}

// Format number input with spaces
function formatNumInput(el) {
  const raw = el.value.replace(/\s/g,'').replace(/[^\d.]/g,'');
  const parts = raw.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g,' ');
  el.value = parts.join('.');
  el.dataset.raw = raw;
}
function getRawValue(el) {
  if (!el) return '';
  return (el.dataset.raw || el.value.replace(/\s/g,'')).replace(/[^\d.]/g,'');
}

function fmt(n, currency) {
  currency = currency || 'RUB';
  const sym = currency === 'SAR'  ? ' رګ' : currency === 'USDT' ? ' ₮' : currency === 'USD'  ? ' $' : currency === 'EUR'  ? ' €' : currency === 'GBP'  ? ' £' : currency === 'AED'  ? ' د.إ' : currency === 'TRY'  ? ' ₺' : currency === 'CNY'  ? ' ¥' : currency === 'KZT'  ? ' ₸' : ' ₽';
  const num = parseFloat(n) || 0;
  // Show up to 2 decimal places, but only if there are non-zero cents
  const hasDecimals = Math.abs(num - Math.round(num)) >= 0.005;
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(num) + sym;
}

function getMonthKey(date) {
  const d = new Date(date);
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
}

function dirStats(direction) {
  const txs = monthTxs().filter(t => t.direction === direction);
  const income  = txs.filter(t => t.type === 'income'  && t.category !== 'Дивиденды собственника' && t.category !== 'Дивиденды партнёру' && t.category !== 'Дивиденды').reduce((s,t) => s + toRub(t.amount, t.currency), 0);
  const expense = txs.filter(t => t.type === 'expense' && t.category !== 'Дивиденды собственника' && t.category !== 'Дивиденды партнёру' && t.category !== 'Дивиденды').reduce((s,t) => s + toRub(t.amount, t.currency), 0);
  const dividends = txs.filter(t => t.type === 'dividend').reduce((s,t) => s + toRub(t.amount, t.currency), 0);
  return { income, expense, profit: income - expense, dividends };
}

function monthlyData() {
  const accs = Object.keys(state.accounts);
  const map = {};
  monthTxs().forEach(t => {
    const mk = getMonthKey(t.date);
    if (!map[mk]) {
      const entry = { month: mk, _in: 0, _out: 0 };
      accs.forEach(k => { entry[k+'_in'] = 0; entry[k+'_out'] = 0; });
      map[mk] = entry;
    }
    const v = toRub(t.amount, t.currency);
    if (t.type !== 'income' && t.type !== 'expense') return;
    if (t.category === 'Дивиденды собственника' || t.category === 'Дивиденды партнёру' || t.category === 'Дивиденды') return;
    const key = t.account;
    if (key) {
      if (t.type === 'income') { map[mk][key+'_in'] = (map[mk][key+'_in']||0) + v; map[mk]._in += v; }
      else                     { map[mk][key+'_out'] = (map[mk][key+'_out']||0) + v; map[mk]._out += v; }
    }
  });
  return Object.values(map).sort((a,b) => a.month.localeCompare(b.month)).map(m => ({
    ...m, label: MONTHS[parseInt(m.month.split('-')[1])-1] + "'" + m.month.split('-')[0].slice(2)
  }));
}

// ─── RENDER ────────────────────────────────────────────────────────────────
function renderOnboarding() {
  const EMOJIS = ['💼','📊','🏢','🚀','💡','🎯','💰','🌍','🏗️','📱','🎓','🛒','💎','🔥','⚡','🌿'];
  const COLORS = ['#6ee7b7','#3b82f6','#a78bfa','#f87171','#fbbf24','#fb923c','#34d399','#e879f9','#38bdf8','#f472b6'];
  let selEmoji = '💼', selColor = '#6ee7b7', selName = '';

  const draw = () => {
    // Preserve name if input already exists
    const existing = document.getElementById('ob-name');
    if (existing) selName = existing.value;

    const emojiHtml = EMOJIS.map(e => {
      const sel = e === selEmoji;
      return '<button data-ob-emoji="' + e + '" style="width:40px;height:40px;border-radius:9px;border:1px solid ' + (sel ? 'rgba(110,231,183,0.5)' : 'rgba(255,255,255,0.08)') + ';background:' + (sel ? 'rgba(110,231,183,0.15)' : 'rgba(255,255,255,0.04)') + ';font-size:19px;cursor:pointer">' + e + '</button>';
    }).join('');
    const colorHtml = COLORS.map(c => {
      const sel = c === selColor;
      return '<button data-ob-color="' + c + '" style="width:30px;height:30px;border-radius:50%;border:3px solid ' + (sel ? '#fff' : 'transparent') + ';background:' + c + ';cursor:pointer;transform:' + (sel ? 'scale(1.2)' : 'scale(1)') + '"></button>';
    }).join('');

    _appRoot().innerHTML =
      '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px">' +
        '<div style="background:rgba(16,16,28,0.98);border:1px solid rgba(255,255,255,0.1);border-radius:24px;padding:40px;width:100%;max-width:440px">' +
          '<div style="text-align:center;margin-bottom:32px">' +
            '<div style="font-size:48px;margin-bottom:16px">💰</div>' +
            '<div style="font-family:\'Syne\',sans-serif;font-size:26px;font-weight:800;color:#fff;margin-bottom:8px">Добро пожаловать!</div>' +
            '<div style="font-size:14px;color:#555;line-height:1.6">Создай первый проект — это твоё финансовое пространство со счетами, операциями и аналитикой</div>' +
          '</div>' +
          '<div style="display:flex;flex-direction:column;gap:18px">' +
            '<div>' +
              '<div style="font-size:11px;color:#555;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px">Название проекта</div>' +
              '<input id="ob-name" placeholder="Например: Мой бизнес" maxlength="40" style="width:100%;font-size:15px;padding:12px 14px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:11px;color:#fff;outline:none">' +
            '</div>' +
            '<div>' +
              '<div style="font-size:11px;color:#555;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px">Иконка</div>' +
              '<div style="display:flex;flex-wrap:wrap;gap:6px">' + emojiHtml + '</div>' +
            '</div>' +
            '<div>' +
              '<div style="font-size:11px;color:#555;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px">Цвет</div>' +
              '<div style="display:flex;gap:8px;flex-wrap:wrap">' + colorHtml + '</div>' +
            '</div>' +
            '<button id="ob-submit" style="width:100%;padding:14px;border-radius:12px;border:none;background:linear-gradient(135deg,#6ee7b7,#3b82f6);color:#000;font-size:15px;font-weight:700;cursor:pointer;margin-top:8px">Создать проект и начать →</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    // Restore name value after redraw
    const nameInput = document.getElementById('ob-name');
    if (selName) { nameInput.value = selName; }

    document.querySelectorAll('[data-ob-emoji]').forEach(btn => {
      btn.onclick = () => { selEmoji = btn.dataset.obEmoji; draw(); };
    });
    document.querySelectorAll('[data-ob-color]').forEach(btn => {
      btn.onclick = () => { selColor = btn.dataset.obColor; draw(); };
    });
    document.getElementById('ob-name').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('ob-submit').click(); });
    document.getElementById('ob-submit').onclick = async () => {
      const name = document.getElementById('ob-name').value.trim();
      if (!name) { document.getElementById('ob-name').focus(); return; }
      const btn = document.getElementById('ob-submit');
      btn.disabled = true; btn.textContent = 'Создаём...';
      const { data, error } = await _SB.from('projects').insert({
        user_id: _currentUser.id, name, emoji: selEmoji, color: selColor,
      }).select().single();
      if (error) { btn.disabled = false; btn.textContent = 'Создать проект и начать →'; showToast('Ошибка: ' + error.message, 'error'); return; }
      const defaultData = defaultProjectData();
      const uid = _currentUser.id + '_' + data.id;
      const { error: dataErr } = await _SB.from('user_data').upsert(
        { user_id: uid, project_id: data.id, data: defaultData, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );
      if (dataErr) console.warn('user_data upsert error:', dataErr.message);
      _projectId = data.id; _projectName = name; _projectEmoji = selEmoji;
      localStorage.setItem('active_project_id',    _projectId);
      localStorage.setItem('active_project_name',  _projectName);
      localStorage.setItem('active_project_emoji', _projectEmoji);
      const now = new Date();
      sessionStorage.setItem('active_month', now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0'));
      window.location.reload();
    };
  };
  draw();
}

function render() {
  try {
    document.getElementById('header-root').innerHTML = headerHtml();
    _appRoot().innerHTML = bodyHtml();
    bindEvents();
    renderCharts();
    // Delete confirm — rendered in separate root on top of everything
    let _confirmRoot = document.getElementById('delete-confirm-root');
    if (!_confirmRoot) {
      _confirmRoot = document.createElement('div');
      _confirmRoot.id = 'delete-confirm-root';
      document.body.appendChild(_confirmRoot);
    }
    if (state.showDeleteConfirm) {
      _confirmRoot.innerHTML = deleteConfirmModalHtml();
      _confirmRoot.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;pointer-events:all';
    } else {
      _confirmRoot.innerHTML = '';
      _confirmRoot.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;pointer-events:none';
    }
  } catch(e) {
    console.error('RENDER ERROR:', e);
    _appRoot().innerHTML = '<div style="color:red;padding:40px;font-family:monospace">Ошибка рендера: ' + e.message + '<br><br>' + e.stack + '</div>';
  }
}

function bodyHtml() {
  return `
    ${tabsHtml()}
    ${statsHtml()}
    ${contentHtml()}
    ${state.showModal        ? modalHtml()                              : ''}
    ${state.showModePicker   ? modePickerHtml()                        : ''}
    ${state.showAiChat       ? aiChatHtml()                            : ''}
    ${state.showRates        ? ratesModalHtml()                        : ''}
    ${state.showSettingsModal? settingsModalHtml()                     : ''}
    ${state.showPeriodModal      ? periodModalHtml()                   : ''}
    ${state.showProjectSwitcher  ? projectSwitcherHtml()               : ''}
    ${state.showProfileModal ? profileModalHtml()                      : ''}
    ${state.showEditTxModal  ? editTxModalHtml(state.showEditTxModal)  : ''}
    ${state.showTxDetail     ? txDetailModalHtml(state.showTxDetail)   : ''}
    ${state.showExportModal  ? exportModalHtml()                       : ''}
  `;
}

function html() {
  return bodyHtml();
}

function monthSelectorHtml() {
  // Get all months that have transactions
  const monthsWithData = [...new Set(state.transactions.map(t => getMonthKey(t.date)))].sort().reverse();

  // Generate months Feb 2026 — Dec 2026
  const allMonths = [];
  for (let m = 1; m <= 12; m++) {
    allMonths.push(`2026-${String(m).padStart(2,'0')}`);
  }

  const monthCards = allMonths.map(mk => {
    const [year, month] = mk.split('-');
    const monthNum = month;
    const monthName = MONTHS[parseInt(month)-1];
    const txCount = state.transactions.filter(t => getMonthKey(t.date) === mk).length;
    const hasData = txCount > 0;

    const txs = state.transactions.filter(t => getMonthKey(t.date) === mk);
    const income  = txs.filter(t=>t.type==='income').reduce((s,t)=>s+toRub(t.amount,t.currency),0);
    const expense = txs.filter(t=>t.type==='expense').reduce((s,t)=>s+toRub(t.amount,t.currency),0);
    const profit = income - expense;

    const q = Math.ceil(parseInt(month)/3);
    const qColors = {
      1: { border: 'rgba(110,231,183,0.35)', bg: 'rgba(110,231,183,0.06)', num: '#6ee7b7', label: 'Q1' },
      2: { border: 'rgba(147,197,253,0.35)', bg: 'rgba(147,197,253,0.06)', num: '#93c5fd', label: 'Q2' },
      3: { border: 'rgba(251,191,36,0.35)',  bg: 'rgba(251,191,36,0.06)',  num: '#fbbf24', label: 'Q3' },
      4: { border: 'rgba(240,120,120,0.35)', bg: 'rgba(240,120,120,0.06)', num: '#f87171', label: 'Q4' },
    };
    const qc = qColors[q];
    return `
      <div class="month-card ${hasData?'month-has-data':''}" data-month="${mk}" style="border-color:${qc.border};background:${qc.bg}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <div style="font-size:13px;font-weight:700;color:${qc.num};letter-spacing:0.05em">${monthNum}</div>
          <div style="font-size:10px;color:${qc.num};opacity:0.7;letter-spacing:0.1em">${qc.label}</div>
        </div>
        <div class="month-label">${monthName}</div>
        <div class="month-year">${year}</div>
        ${hasData ? `
          <div class="month-stats">
            <div class="month-stat-row"><span>🟢</span><span>${fmt(income)}</span></div>
            <div class="month-stat-row"><span>🔴</span><span>${fmt(expense)}</span></div>
            <div class="month-stat-row" style="border-top:1px solid rgba(255,255,255,0.08);padding-top:6px;margin-top:4px">
              <span>🟣</span>
              <span style="color:${profit>=0?'#a78bfa':'#f87171'};font-weight:700">${fmt(profit)}</span>
            </div>
          </div>
          <div class="month-tx-count">${txCount} операций</div>
        ` : `<div class="month-empty">Нет данных</div>`}
      </div>`;
  }).join('');

  return `
    <div class="app-bg" style="min-height:100vh">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 20px;background:rgba(15,15,25,0.95);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-bottom:1px solid rgba(255,255,255,0.07);position:fixed;top:0;left:0;right:0;z-index:100">
        <div style="display:flex;align-items:center;gap:10px">
          <button id="btn-to-projects" style="background:none;border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#888;font-size:12px;cursor:pointer;padding:5px 10px;white-space:nowrap">← Проекты</button>
          <div style="width:1px;height:18px;background:rgba(255,255,255,0.08)"></div>
          <div style="font-size:15px;font-weight:700;color:#fff">${_projectEmoji} ${_projectName}</div>
        </div>
        <div style="font-size:22px;font-weight:900;color:#fff;letter-spacing:-0.03em;position:absolute;left:50%;transform:translateX(-50%)">Выбор месяца</div>
        <div style="display:flex;align-items:center;gap:10px">
          <button id="btn-period-open" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:#bbb;font-size:13px;font-weight:600;cursor:pointer;padding:10px 16px;display:flex;align-items:center;gap:7px;white-space:nowrap">📅 Выбрать период</button>
          <button id="btn-profile-month" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:#bbb;font-size:13px;font-weight:600;cursor:pointer;padding:10px 16px;display:flex;align-items:center;gap:7px;white-space:nowrap">👤 Личный кабинет</button>
          <button id="btn-settings-month" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:#bbb;font-size:13px;font-weight:600;cursor:pointer;padding:10px 16px;display:flex;align-items:center;gap:7px;white-space:nowrap">⚙️ Настройки</button>
        </div>
      </div>
      <div style="max-width:1000px;margin:0 auto;padding:40px 20px">
        <div style="margin-bottom:40px">
          <div style="font-size:11px;color:#555;letter-spacing:0.15em;text-transform:uppercase;margin-bottom:8px">Финансовый дашборд · ${_projectEmoji} ${_projectName}</div>
          <div style="font-size:32px;font-weight:800;letter-spacing:-0.02em">Выберите месяц</div>
          <div style="font-size:16px;color:#888;margin-top:8px">Данные каждого месяца хранятся отдельно</div>
        </div>
        <div class="month-grid">${monthCards}</div>
      </div>
    </div>`;
}

function headerHtml() {
  const am = state.activeMonth || '';
  const [year, month] = am ? am.split('-') : ['', ''];
  const monthName = month ? MONTHS[parseInt(month)-1] : '';
  return `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 20px;background:rgba(15,15,25,0.95);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-bottom:1px solid rgba(255,255,255,0.07);position:fixed;top:0;left:0;right:0;z-index:100">
      <div style="display:flex;align-items:center;gap:8px">
        <button id="btn-open-project-switcher" style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:#ccc;font-size:13px;font-weight:700;cursor:pointer;padding:7px 14px;display:flex;align-items:center;gap:8px;white-space:nowrap">
          <span>${_projectEmoji}</span><span>${_projectName || 'MyFinanceAI'}</span><span style="color:#555;font-size:11px">▾</span>
        </button>
      </div>
      <button class="btn-add" id="btn-add" style="position:absolute;left:50%;transform:translateX(-50%);white-space:nowrap;font-size:15px;padding:11px 28px;border-radius:14px;font-weight:800">+ Операция</button>
      <div style="display:flex;align-items:center;gap:8px">
        <button id="btn-period-open" style="background:${state.activePeriod?'rgba(167,139,250,0.12)':'rgba(255,255,255,0.05)'};border:1px solid ${state.activePeriod?'rgba(167,139,250,0.4)':'rgba(255,255,255,0.1)'};border-radius:10px;color:${state.activePeriod?'#a78bfa':'#bbb'};font-size:13px;font-weight:600;cursor:pointer;padding:10px 16px;white-space:nowrap">📅 ${activePeriodLabel()}</button>
        <button id="btn-profile-dash" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:#bbb;font-size:13px;font-weight:600;cursor:pointer;padding:10px 16px;white-space:nowrap">👤 Личный кабинет</button>
        <button id="btn-settings-header" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:#bbb;font-size:13px;font-weight:600;cursor:pointer;padding:10px 16px;white-space:nowrap">⚙️ Настройки</button>
      </div>
    </div>`;
}

function ratesBarHtml() {
  const upd = state.rates.updatedAt
    ? 'обновлено ' + new Date(state.rates.updatedAt).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'})
    : (state.rates.source === 'fallback' ? '⚠️ резервный курс' : 'загрузка...');
  return `
    <div class="rates-bar">
      <span>💱 1 SAR = <strong>${(state.rates.SAR||0).toFixed(2)} ₽</strong></span>
      <span>1 USDT = <strong class="usdt">${(state.rates.USDT||0).toFixed(2)} ₽</strong></span>
      <span>1 USD = <strong style="color:#60a5fa">${(state.rates.USD||0).toFixed(2)} ₽</strong></span>
      <span style="margin-left:auto;color:#555;font-size:12px">${upd}</span>
    </div>`;
}

function monthTxs() {
  const all = state.transactions;
  const p = state.activePeriod;
  if (!p) {
    return state.activeMonth
      ? all.filter(t => getMonthKey(t.date) === state.activeMonth)
      : all;
  }
  if (p.mode === 'today') {
    const today = _localDateStr();
    return all.filter(t => t.date === today);
  }
  if (p.mode === 'week') {
    const to   = new Date(); to.setHours(23,59,59,999);
    const from = new Date(); from.setDate(from.getDate() - 6); from.setHours(0,0,0,0);
    const fromStr = from.toISOString().slice(0,10);
    const toStr   = to.toISOString().slice(0,10);
    return all.filter(t => t.date >= fromStr && t.date <= toStr);
  }
  if (p.mode === 'last30') {
    const to   = new Date(); to.setHours(23,59,59,999);
    const from = new Date(); from.setDate(from.getDate() - 29); from.setHours(0,0,0,0);
    const fromStr = from.toISOString().slice(0,10);
    const toStr   = to.toISOString().slice(0,10);
    return all.filter(t => t.date >= fromStr && t.date <= toStr);
  }
  if (p.mode === 'all')   return all;
  if (p.mode === 'month') return all.filter(t => getMonthKey(t.date) === p.month);
  if (p.mode === 'range') {
    const from = p.from, to = p.to;
    return all.filter(t => t.date >= from && t.date <= to);
  }
  return all;
}

async function loadAllProjects() {
  if (!_currentUser) return;
  try {
    const { data } = await _SB.from('projects').select('id,name,emoji,color').eq('user_id', _currentUser.id).order('created_at');
    if (data) state._allProjects = data;
  } catch(e) { console.warn('loadAllProjects error', e); }
}

function activePeriodLabel() {
  const p = state.activePeriod;
  if (!p) {
    if (!state.activeMonth) return 'Весь период';
    const [y,m] = state.activeMonth.split('-');
    return MONTHS[parseInt(m)-1] + ' ' + y;
  }
  if (p.mode === 'today')  return 'Сегодня';
  if (p.mode === 'week')   return 'Неделя';
  if (p.mode === 'last30') return '30 дней';
  if (p.mode === 'all')    return 'Весь период';
  if (p.mode === 'month')  { const [y,m] = (p.month||'').split('-'); return (MONTHS[parseInt(m)-1]||'') + ' ' + y; }
  if (p.mode === 'range') {
    const fmt = d => { if (!d) return '?'; const [y,mo,da] = d.split('-'); return da+'-'+mo+'-'+y; };
    return fmt(p.from) + ' — ' + fmt(p.to);
  }
  return 'Период';
}
function monthTxsWithTransfers() {
  // For account views: show all transactions (including transfers) for the active month
  return monthTxs();
}

function statsHtml() {
  // Context-aware: filter depends on active tab + active filters
  const tab = state.tab || 'overview';
  let bal, txIn, txOut, label = '';

  if (tab === 'overview') {
    // All directions, all accounts
    bal   = Object.values(state.accounts).reduce((s,a) => s + toRub(a.balance, a.currency), 0);
    const mtxs = monthTxs();
    txIn  = mtxs.filter(t=>t.type==='income').reduce((s,t)=>s+toRub(t.amount,t.currency),0);
    txOut = mtxs.filter(t=>t.type==='expense').reduce((s,t)=>s+toRub(t.amount,t.currency),0);

  } else if (tab === 'transactions') {
    // Filter by active account (activeDir now holds account key)
    const accFilter = state.activeDir;
    const acc = state.activeAccount;
    const isFundFilter = accFilter && state.funds && state.funds[accFilter];
    let txs = monthTxs().filter(t => !t.isTransfer && t.type !== 'transfer');
    if (isFundFilter) {
      txs = txs.filter(t => t.fundKey === accFilter);
    } else if (accFilter && accFilter !== 'funds') {
      txs = txs.filter(t => t.account === accFilter);
    }
    if (acc) txs = txs.filter(t => t.account === acc);
    // Balance
    if (acc) {
      const a = state.accounts[acc];
      bal = a ? toRub(a.balance, a.currency) : 0;
    } else if (isFundFilter) {
      const f = state.funds[accFilter];
      bal = f ? toRub(f.balance, f.currency || 'RUB') : 0;
    } else if (accFilter === 'funds') {
      bal = Object.values(state.funds).reduce((s,f) => s + toRub(f.balance, f.currency || 'RUB'), 0);
    } else if (accFilter && accFilter !== 'funds') {
      const a = state.accounts[accFilter];
      bal = a ? toRub(a.balance, a.currency) : 0;
    } else {
      bal = Object.values(state.accounts).reduce((s,a)=>s+toRub(a.balance,a.currency),0);
    }
    txIn  = txs.filter(t=>t.type==='income').reduce((s,t)=>s+toRub(t.amount,t.currency),0);
    txOut = txs.filter(t=>t.type==='expense').reduce((s,t)=>s+toRub(t.amount,t.currency),0);

  } else if (tab === 'pnl') {
    bal   = Object.values(state.accounts).reduce((s,a)=>s+toRub(a.balance,a.currency),0);
    const mtxs = monthTxs();
    txIn  = mtxs.filter(t=>t.type==='income').reduce((s,t)=>s+toRub(t.amount,t.currency),0);
    txOut = mtxs.filter(t=>t.type==='expense').reduce((s,t)=>s+toRub(t.amount,t.currency),0);

  } else {
    // Analytics or other — show global totals
    bal   = Object.values(state.accounts).reduce((s,a)=>s+toRub(a.balance,a.currency),0);
    const mtxs = monthTxs();
    txIn  = mtxs.filter(t=>t.type==='income').reduce((s,t)=>s+toRub(t.amount,t.currency),0);
    txOut = mtxs.filter(t=>t.type==='expense').reduce((s,t)=>s+toRub(t.amount,t.currency),0);
  }

  const profit = txIn - txOut;
  const balC = bal    >= 0 ? '#a78bfa' : '#f87171';
  const pc   = profit >= 0 ? '#a78bfa' : '#f87171';
  return `
    <div class="stats-grid" style="margin-top:0;margin-bottom:20px">
      <div class="stat-card"><div class="icon">💼</div><div class="label">Общий баланс</div><div class="value" style="color:${balC}">${fmt(bal)}</div></div>
      <div class="stat-card"><div class="icon">📈</div><div class="label">Всего доходов</div><div class="value" style="color:#6ee7b7">${fmt(txIn)}</div></div>
      <div class="stat-card"><div class="icon">📉</div><div class="label">Всего расходов</div><div class="value" style="color:#f87171">${fmt(txOut)}</div></div>
      <div class="stat-card"><div class="icon">✨</div><div class="label">Чистая прибыль</div><div class="value" style="color:${pc}">${fmt(profit)}</div></div>
    </div>`;
}

function _allTabDefs() {
  const em = state.enabledModules || {};
  return [
    ['overview',     '📊', 'Обзор'],
    ['transactions', '💳', 'Операции'],
    ['pnl',          '📂', 'Детализация'],
    ...(em.goals    ? [['goals',    '🎯', 'Цели']]    : []),
    ...(em.budgets  ? [['budgets',  '💰', 'Бюджеты']] : []),
    ...(em.spending ? [['spending', '🛒', 'Траты']]   : []),
    ...(em.partners ? [['partners', '🤝', 'Партнёры']]: []),
  ];
}

function _orderedTabs() {
  const all = _allTabDefs();
  const allKeys = all.map(t => t[0]);
  const order = (state.tabOrder || []).filter(k => allKeys.includes(k));
  allKeys.forEach(k => { if (!order.includes(k)) order.push(k); });
  return order.map(k => all.find(t => t[0] === k)).filter(Boolean);
}

function tabsHtml() {
  const tabs = _orderedTabs();
  return `<div class="tabs" style="overflow-x:auto;flex-wrap:nowrap;scrollbar-width:none" id="tabs-bar">${tabs.map(([k,emoji,l]) =>
    `<button class="tab ${state.tab===k?'active':''}" data-tab="${k}" draggable="true" data-drag-tab="${k}" style="user-select:none;-webkit-user-select:none">
      <span style="font-size:18px">${emoji}</span>
      <span>${l}</span>
    </button>`
  ).join('')}</div>`;
}

function comingSoonHtml(emoji, name) {
  return `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:300px;gap:16px;color:#555">
    <div style="font-size:48px;opacity:0.4">${emoji}</div>
    <div style="font-size:20px;font-weight:700;color:#444">${name}</div>
    <div style="background:rgba(167,139,250,0.08);border:1px solid rgba(167,139,250,0.2);border-radius:12px;padding:12px 24px;color:#a78bfa;font-size:14px;font-weight:600">🚧 В разработке...</div>
    <div style="font-size:13px;color:#444;text-align:center;max-width:280px">Этот раздел скоро появится. Мы работаем над ним!</div>
  </div>`;
}

function contentHtml() {
  if (state.tab === 'overview')      return overviewHtml();
  if (state.tab === 'transactions')  return transactionsHtml();
  if (state.tab === 'pnl')           return pnlHtml();
  if (state.tab === 'goals')         return comingSoonHtml('🎯', 'Цели');
  if (state.tab === 'budgets')       return comingSoonHtml('💰', 'Бюджеты');
  if (state.tab === 'spending')      return comingSoonHtml('🛒', 'Траты');
  if (state.tab === 'partners')      return partnersTabHtml();

  return '';
}

// ── OVERVIEW ──
function overviewHtml() {
  return `
    ${accountsHtml()}
    ${fundsOverviewHtml()}`;
}

function dirCardHtml(k) {
  const dir = DIRECTIONS[k];
  const s = dirStats(k);
  const partners = DIRECTIONS[k]?.partners || [];

  // Owner = isOwner flag (or legacy "Я")
  const owner    = partners.find(p => p.isOwner) || partners.find(p => p.name === 'Я');
  const nonOwners = partners.filter(p => !p.isOwner && p.name !== 'Я');
  const ownerShare = owner ? owner.share : (partners.length === 0 ? 1 : 0);
  const netProfit  = s.profit; // Full business profit, not per-share

  // Total balance across all accounts in this direction
  const dirBalance = Object.values(state.accounts)
    .filter(a => a.direction === k)
    .reduce((sum, a) => sum + toRub(a.balance, a.currency), 0);
  const balColor = dirBalance >= 0 ? '#6ee7b7' : '#f87171';

  const active = state.activeDir === k ? `active-${k}` : '';

  // Owner row — only show if there are other partners
  const ownerEarned = s.profit > 0 ? s.profit * ownerShare : 0;
  const ownerMetric = (owner && nonOwners.length > 0) ? `<div class="metric metric-partner" style="background:rgba(110,231,183,0.07);border:1px solid rgba(110,231,183,0.15)">
      <div class="m-label">👑 ${owner.name} (${(ownerShare*100).toFixed(0)}%)</div>
      <div class="m-value" style="color:#6ee7b7">${fmt(ownerEarned)}</div>
    </div>` : '';

  // Partner rows — only non-owner partners
  const partnerMetrics = ownerMetric + nonOwners.map(p => {
    const earned = s.profit > 0 ? s.profit * p.share : 0;
    return `<div class="metric metric-partner">
      <div class="m-label">🤝 ${p.name} (${(p.share*100).toFixed(0)}%)</div>
      <div class="m-value">${fmt(earned)}</div>
    </div>`;
  }).join('');

  return `
    <div class="dir-card ${active}" data-dir="${k}" data-drag-dir="${k}" draggable="true" style="border-color:${dir.color}33">
      <div class="dir-header" style="display:flex;align-items:center;justify-content:space-between">
        <div style="display:flex;align-items:center;gap:10px">
          <span class="dir-icon">${dir.icon}</span>
          <div>
            <div class="dir-name" style="color:${dir.color}">${dir.label}</div>
          </div>
        </div>
        <button data-dir-edit="${k}" onclick="event.stopPropagation()" style="padding:4px 8px;border-radius:7px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.06);color:#888;cursor:pointer;font-size:13px;flex-shrink:0">⚙️</button>
      </div>
      <div class="dir-metrics">
        <div class="metric" style="background:rgba(255,255,255,0.04)">
          <div class="m-label">💰 Баланс</div>
          <div class="m-value" style="color:${balColor}">${fmt(dirBalance)}</div>
        </div>
        <div class="metric metric-profit ${netProfit<0?'metric-profit-neg':''}">
          <div class="m-label">🟣 Чистая прибыль</div>
          <div class="m-value">${fmt(netProfit)}</div>
        </div>
        <div class="metric metric-income"><div class="m-label">🟢 Доходы</div><div class="m-value">${fmt(s.income)}</div></div>
        <div class="metric metric-expense"><div class="m-label">🔴 Расходы</div><div class="m-value">${fmt(s.expense)}</div></div>
        ${partnerMetrics}
      </div>
    </div>`;
}

function fundsOverviewHtml() {
  const totalFunds = Object.values(state.funds).reduce((s,f) => s + f.balance, 0);
  const cards = getOrderedFunds().map(k => { const f = state.funds[k]; return `
    <div data-drag-fund="${k}" draggable="true" style="flex:1;min-width:180px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:18px 20px;cursor:grab">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
        <div>
          <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:#888">
            ${f.icon} ${f.name}
            <button data-fund-edit="${k}" style="padding:3px 6px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.06);color:#888;cursor:pointer;font-size:11px;line-height:1">⚙️</button>
          </div>
          <div style="font-size:20px;font-weight:700;font-family:monospace;color:${f.color};margin-top:6px">${fmt(f.balance, f.currency||'RUB')}</div>
        </div>
      </div>
      <div style="display:flex;gap:8px">
        <button data-fund-action="in" data-fund-key="${k}" style="flex:1;padding:7px;border-radius:8px;border:1px solid rgba(110,231,183,0.3);background:rgba(110,231,183,0.07);color:#6ee7b7;cursor:pointer;font-size:12px">+ Пополнить</button>
        <button data-fund-action="out" data-fund-key="${k}" style="flex:1;padding:7px;border-radius:8px;border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.07);color:#f87171;cursor:pointer;font-size:12px">− Вывести</button>
      </div>
      <button data-fund-history="${k}" style="width:100%;margin-top:8px;padding:7px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:#888;cursor:pointer;font-size:12px">📋 История</button>
    </div>`; }).join('');

  return `
    <div class="card">
      <div class="card-header">
        <div style="display:flex;align-items:center;gap:10px">
          <span class="card-title">Фонды</span>
          <button id="btn-add-fund" style="padding:4px 10px;border-radius:8px;border:1px solid rgba(167,139,250,0.3);background:rgba(167,139,250,0.07);color:#a78bfa;cursor:pointer;font-size:12px">+ Добавить</button>
        </div>
        <span style="font-size:13px;color:#a78bfa">Итого: ${fmt(totalFunds)}</span>
      </div>
      <div style="padding:16px;display:flex;gap:12px;flex-wrap:wrap">${cards}</div>
    </div>
    ${state.showFundModal     ? fundModalHtml()     : ''}
    ${state.showAddFundModal  ? addFundModalHtml()  : ''}
    ${state.showEditFundModal ? editFundModalHtml() : ''}`;
}

function accountsHtml() {
  const accs = getOrderedAccounts().map(k => [k, state.accounts[k]]);
  const total = accs.reduce((s,[,a]) => s + toRub(a.balance, a.currency), 0);

  const rows = accs.map(([k,a]) => {
    const subbal = a.currency !== 'RUB' ? `<div class="sub">≈ ${fmt(toRub(a.balance, a.currency))}</div>` : '';
    return `
      <div class="accounts-row" data-drag-acc="${k}" draggable="true" style="grid-template-columns:auto 1fr auto auto auto auto auto;gap:8px;align-items:center;cursor:grab">
        <div class="acc-dot" style="background:${a.color||'#a78bfa'}"></div>
        <div style="display:flex;align-items:center;gap:6px">
          <div><div class="acc-name">${a.name} <span style="font-size:11px;color:#555;font-weight:500">${a.currency}</span></div></div>
          <button data-acc-edit="${k}" style="padding:4px 7px;border-radius:7px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.06);color:#888;cursor:pointer;font-size:13px;line-height:1;flex-shrink:0" title="Настройки">⚙️</button>
        </div>
        <div class="acc-bal"><div class="main">${fmt(a.balance, a.currency)}</div>${subbal}</div>
        <button data-acc-history="${k}" style="padding:5px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:#888;cursor:pointer;font-size:12px;white-space:nowrap">📋 История</button>
        <button data-acc-action="income" data-acc-key="${k}" style="padding:5px 10px;border-radius:8px;border:1px solid rgba(110,231,183,0.3);background:rgba(110,231,183,0.07);color:#6ee7b7;cursor:pointer;font-size:12px;white-space:nowrap">🟢 Доход</button>
        <button data-acc-action="expense" data-acc-key="${k}" style="padding:5px 10px;border-radius:8px;border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.07);color:#f87171;cursor:pointer;font-size:12px;white-space:nowrap">🔴 Расход</button>
        <button data-acc-action="transfer" data-acc-key="${k}" style="padding:5px 10px;border-radius:8px;border:1px solid rgba(251,191,36,0.3);background:rgba(251,191,36,0.07);color:#fbbf24;cursor:pointer;font-size:12px;white-space:nowrap">🟡 Перевод</button>
      </div>`;
  }).join('');
  return `
    <div class="card">
      <div class="card-header">
        <div style="display:flex;align-items:center;gap:10px">
          <span class="card-title">Все счета</span>
          <button id="btn-add-acc" style="padding:4px 10px;border-radius:8px;border:1px solid rgba(167,139,250,0.3);background:rgba(167,139,250,0.07);color:#a78bfa;cursor:pointer;font-size:12px">+ Добавить</button>
        </div>
        <span style="font-size:13px;color:#a78bfa">Итого: ${fmt(total)}</span>
      </div>
      ${rows}
    </div>
    ${state.showAccModal    ? accModalHtml()    : ''}
    ${state.showAddAccModal ? addAccModalHtml() : ''}
    ${state.showEditAccModal? editAccModalHtml(): ''}`;
}

// ── TRANSACTIONS ──
function buildEditFields(type, tx) {
  const allAccKeys = Object.keys(state.accounts);

  // For transfer: "to" account excludes whatever is selected as "from"
  const accOptsFrom = (selKey) => allAccAndFundOptions(selKey);
  const accOptsTo = (fromKey, selKey) => {
    const resolvedSel = (selKey && selKey !== fromKey) ? selKey : '';
    return allAccAndFundOptionsExcept(fromKey, resolvedSel);
  };

  if (type === 'transfer') {
    const fromKey = tx.fromAccount || tx.account || allAccKeys[0] || '';
    // ensure toKey != fromKey
    const rawTo   = tx.toAccount || '';
    const toKey   = (rawTo && rawTo !== fromKey) ? rawTo : (allAccKeys.find(k => k !== fromKey) || '');
    const fromAmt = tx.fromAmount || tx.amount || '';
    const toAmt   = tx.toAmount   || tx.fromAmount || tx.amount || '';
    const catOpts = CATEGORIES_DDS.map(c =>
      `<option value="${c}" ${tx.category===c?'selected':''}>${c}</option>`).join('');
    return `
      <div><div class="form-label">Откуда (списание)</div>
        <select class="form-inp" id="etx-from-account" onchange="syncEtxToAccount(this.value)">${accOptsFrom(fromKey)}</select></div>
      <div><div class="form-label">Куда (зачисление)</div>
        <select class="form-inp" id="etx-to-account">${accOptsTo(fromKey, toKey)}</select></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div><div class="form-label">Сумма списания</div>
          <input type="number" class="form-inp" id="etx-from-amount" value="${fromAmt}"></div>
        <div><div class="form-label">Сумма зачисления</div>
          <input type="number" class="form-inp" id="etx-to-amount" value="${toAmt}"></div>
      </div>
      <div><div class="form-label">Категория</div>
        <select class="form-inp" id="etx-category">${catOpts}</select></div>`;
  } else if (type === 'dividend') {
    const accKey = tx.account || getOrderedAccounts()[0] || '';
    const accOpts = allAccOptions(accKey);
    const lockedCat = tx.category || '—';
    return `
      <div><div class="form-label">Счёт</div>
        <select class="form-inp" id="etx-account">${accOpts}</select></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div><div class="form-label">Сумма</div>
          <input type="number" class="form-inp" id="etx-amount" value="${tx.amount||''}"></div>
        <div><div class="form-label">Валюта</div>
          <select class="form-inp" id="etx-currency">
            ${(state.enabledCurrencies||['RUB','SAR','USDT']).map(cur =>
              `<option value="${cur}" ${(tx.currency||'RUB')===cur?'selected':''}>${cur}</option>`).join('')}
          </select></div>
      </div>
      <div>
        <div class="form-label" style="display:flex;align-items:center;gap:6px">
          Категория
          <span style="font-size:11px;color:#666;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:1px 7px">🔒 закреплена</span>
        </div>
        <div style="background:rgba(167,139,250,0.07);border:1px solid rgba(167,139,250,0.2);border-radius:10px;padding:10px 14px;color:#a78bfa;font-size:14px;font-weight:600">🟣 ${lockedCat}</div>
        <input type="hidden" id="etx-category" value="${lockedCat}">
      </div>`;
  } else {
    const accKey = tx.account || getOrderedAccounts()[0] || '';
    const accOpts = allAccOptions(accKey);
    const catOpts = [...getDirCats('_global','in'), ...getDirCats('_global','out')]
      .filter((c,i,a)=>a.indexOf(c)===i)
      .map(cat => `<option value="${cat}" ${tx.category===cat?'selected':''}>${cat}</option>`).join('');
    return `
      <div><div class="form-label">Счёт</div>
        <select class="form-inp" id="etx-account">${accOpts}</select></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div><div class="form-label">Сумма</div>
          <input type="number" class="form-inp" id="etx-amount" value="${tx.amount||''}"></div>
        <div><div class="form-label">Валюта</div>
          <select class="form-inp" id="etx-currency">
            ${(state.enabledCurrencies||['RUB','SAR','USDT']).map(cur =>
              `<option value="${cur}" ${(tx.currency||'RUB')===cur?'selected':''}>${cur}</option>`).join('')}
          </select></div>
      </div>
      <div><div class="form-label">Категория</div>
        <select class="form-inp" id="etx-category">${catOpts}</select></div>`;
  }
}

// When "from" account changes — rebuild "to" options excluding selected "from"
function syncEtxToAccount(fromKey) {
  const toSel = document.getElementById('etx-to-account');
  if (!toSel) return;
  const curTo = toSel.value;
  const entries = getOrderedAccounts().map(k=>[k,state.accounts[k]]).filter(([k]) => k !== fromKey);
  const newTo   = (curTo && curTo !== fromKey) ? curTo : (entries[0]||[])[0] || '';
  toSel.innerHTML = allAccAndFundOptionsExcept(fromKey, newTo);
}

// When direction changes — rebuild account list to only show accounts of that direction
function syncEtxDirAccounts(dirKey) {
  const accSel = document.getElementById('etx-account');
  const catSel = document.getElementById('etx-category');
  if (!accSel) return;
  const entries = getOrderedAccounts().map(k=>[k,state.accounts[k]]).filter(([,a]) => a.direction === dirKey);
  accSel.innerHTML = entries.map(([k,a]) =>
    accOption(k, a, '')).join('');
  if (catSel) {
    const cats = [...getDirCats(dirKey,'in'), ...getDirCats(dirKey,'out')]
      .filter((c,i,a)=>a.indexOf(c)===i);
    catSel.innerHTML = cats.map(cat => `<option value="${cat}">${cat}</option>`).join('');
  }
}

function reRenderEditFields(newType) {
  const txId = state.showEditTxModal;
  const tx   = state.transactions.find(x => x.id === txId);
  if (!tx) return;
  const container = document.getElementById('etx-fields');
  if (!container) return;
  // build a fake tx snapshot with current form values to preserve edits
  const snapshot = {
    ...tx,
    type:      newType,
    account:   (document.getElementById('etx-account')   ||{}).value || tx.account,
    direction: (document.getElementById('etx-direction') ||{}).value || tx.direction,
    amount:    (document.getElementById('etx-amount')    ||{}).value || tx.amount,
    currency:  (document.getElementById('etx-currency')  ||{}).value || tx.currency,
    fromAccount: (document.getElementById('etx-from-account')||{}).value || tx.fromAccount,
    toAccount:   (document.getElementById('etx-to-account')  ||{}).value || tx.toAccount,
    fromAmount:  (document.getElementById('etx-from-amount') ||{}).value || tx.fromAmount,
    toAmount:    (document.getElementById('etx-to-amount')   ||{}).value || tx.toAmount,
    category:  (document.getElementById('etx-category')  ||{}).value || tx.category,
  };
  container.innerHTML = buildEditFields(newType, snapshot);
}


// ── Save edited transaction — called from btn-etx-save onclick ──────────
function _saveEditedTx() {
  const txId = state.showEditTxModal;
  const idx  = state.transactions.findIndex(x => x.id === txId);
  if (idx === -1) return;
  const tx = state.transactions[idx];
  const g  = id => (document.getElementById(id)||{}).value || '';
  const newType   = g('etx-type')    || tx.type;
  const newDate   = g('etx-date')    || tx.date;
  const newNote   = g('etx-note');
  const newAcc    = g('etx-account') || tx.account;
  const newCat    = g('etx-category')|| tx.category;
  const newCur    = g('etx-currency')|| tx.currency;
  const newAmtRaw = g('etx-amount');
  const newAmt    = newAmtRaw ? parseFloat(newAmtRaw) : parseFloat(tx.amount)||0;
  // reverse old balance first (to get real current balance)
  const oldAcc = state.accounts[tx.account];
  if (oldAcc && (tx.type==='income'||tx.type==='expense')) {
    if (tx.type==='income') oldAcc.balance -= parseFloat(tx.amount)||0;
    else                    oldAcc.balance += parseFloat(tx.amount)||0;
  }
  // check balance before applying new expense
  if (newType === 'expense') {
    const checkAcc = state.accounts[newAcc];
    if (checkAcc && checkAcc.balance < newAmt) {
      // restore old balance and abort
      if (oldAcc && (tx.type==='income'||tx.type==='expense')) {
        if (tx.type==='income') oldAcc.balance += parseFloat(tx.amount)||0;
        else                    oldAcc.balance -= parseFloat(tx.amount)||0;
      }
      showToast('Недостаточно средств на счёте', 'error'); return;
    }
  }
  // apply new balance
  const newAccObj = state.accounts[newAcc];
  if (newAccObj && (newType==='income'||newType==='expense')) {
    if (newType==='income') newAccObj.balance += newAmt;
    else                    newAccObj.balance -= newAmt;
  }
  if (newType === 'transfer') {
    const fromAcc = g('etx-from-account') || tx.fromAccount;
    const toAcc   = g('etx-to-account')   || tx.toAccount;
    const fromAmt = parseFloat(g('etx-from-amount') || tx.fromAmount || tx.amount) || 0;
    const toAmt   = parseFloat(g('etx-to-amount')   || tx.toAmount   || tx.amount) || fromAmt;
    state.transactions[idx] = { ...tx, type: newType, date: newDate, note: newNote,
      fromAccount: fromAcc, toAccount: toAcc, fromAmount: fromAmt, toAmount: toAmt,
      category: newCat, updatedAtMs: Date.now() };
  } else {
    state.transactions[idx] = { ...tx, type: newType, date: newDate, note: newNote,
      account: newAcc, amount: newAmt, currency: newCur, category: newCat,
      direction: tx.direction || _projectId || '', updatedAtMs: Date.now() };
  }
  state.showEditTxModal = null;
  saveToStorage(); render();
  showToast('Операция сохранена', 'success');
}
function editTxModalHtml(txId) {
  const t = state.transactions.find(x => x.id === txId);
  if (!t) return '';
  const allAccOpts = getOrderedAccounts().map(k => [k, state.accounts[k]]).map(([k,a]) =>
    `<option value="${k}">${escapeHtml(a.name)} (${a.currency})</option>`).join('');
  const accOptsFor = (selKey) => getOrderedAccounts().map(k=>[k,state.accounts[k]])
    .map(([k,a]) => `<option value="${k}" ${k===selKey?'selected':''}>${escapeHtml(a.name)} (${a.currency})</option>`).join('');
  const typeOpts = [['income','🟢 Доход'],['expense','🔴 Расход'],['transfer','🟡 Перевод'],['dividend','🟣 Дивиденды']]
    .map(([v,l]) => `<option value="${v}" ${t.type===v?'selected':''}>${l}</option>`).join('');
  const date = t.date || '';
  const note = (t.note||'').replace(/"/g,'&quot;');

  const fieldsHtml = buildEditFields(t.type, t);

  return `
    <div class="modal-bg" id="edit-tx-bg">
      <div id="edit-tx-inner" class="modal" style="max-width:440px">
        <div class="modal-header">
          <span class="modal-title">✏️ Редактировать операцию</span>
          <button class="modal-close" id="edit-tx-close">×</button>
        </div>
        <div class="form-grid">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div><div class="form-label">Тип</div>
              <select class="form-inp" id="etx-type" onchange="reRenderEditFields(this.value)">${typeOpts}</select></div>
            <div><div class="form-label">Дата</div>
              <input type="date" class="form-inp" id="etx-date" value="${date}"></div>
          </div>
          <div id="etx-fields">${fieldsHtml}</div>
          <div><div class="form-label">Комментарий</div>
            <input type="text" class="form-inp" id="etx-note" value="${note}"></div>
          <button class="btn-submit" id="btn-etx-save" onclick="_saveEditedTx()">Сохранить</button>
        </div>
      </div>
    </div>`;
}

function exportModalHtml() {
  const accChecks = getOrderedAccounts().map(k => [k, state.accounts[k]]).map(([k,a]) => {
    const checked = (state.exportAccs||[]).includes(k) ? 'checked' : '';
    return `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:6px 0">
      <input type="checkbox" data-exp-acc="${k}" ${checked} style="width:16px;height:16px;accent-color:#6ee7b7">
      <span style="font-size:14px">${escapeHtml(a.name)}</span>
    </label>`;
  }).join('');
  const showBal = state.exportShowBalances !== false;
  const dateFrom = state.exportDateFrom || '';
  const dateTo   = state.exportDateTo   || '';
  return `
    <div class="modal-bg" id="export-modal-bg">
      <div id="export-inner" class="modal" style="max-width:480px;max-height:90vh;overflow-y:auto">
        <div class="modal-header">
          <span class="modal-title">📊 Выгрузка в Excel</span>
          <button class="modal-close" id="export-modal-close">×</button>
        </div>
        <div style="padding:0 20px 20px;display:flex;flex-direction:column;gap:20px">
          <div>
            <div style="font-size:12px;font-weight:600;color:#555;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Счета</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button data-exp-sel-acc="all" style="padding:4px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:#888;cursor:pointer;font-size:12px">Все</button>
              <button data-exp-sel-acc="none" style="padding:4px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:#888;cursor:pointer;font-size:12px">Снять</button>
            </div>
            <div style="margin-top:8px">${accChecks}</div>
          </div>
          <div>
            <div style="font-size:12px;font-weight:600;color:#555;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Формат выгрузки</div>
            <div style="display:flex;gap:10px">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:8px 14px;border-radius:9px;border:1px solid rgba(110,231,183,0.3);background:rgba(110,231,183,0.07)">
                <input type="radio" name="exp-format" value="excel" checked style="accent-color:#6ee7b7"> <span style="font-size:14px;color:#6ee7b7;font-weight:600">📊 Excel</span>
              </label>
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:8px 14px;border-radius:9px;border:1px solid rgba(248,113,113,0.3);background:rgba(248,113,113,0.07)">
                <input type="radio" name="exp-format" value="pdf" style="accent-color:#f87171"> <span style="font-size:14px;color:#f87171;font-weight:600">📄 PDF</span>
              </label>
            </div>
          </div>
          <div>
            <div style="font-size:12px;font-weight:600;color:#555;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Период</div>
            <div style="display:flex;gap:12px;align-items:center">
              <div style="flex:1"><div style="font-size:12px;color:#555;margin-bottom:4px">С</div><input type="date" id="exp-date-from" value="${dateFrom}" class="form-inp"></div>
              <div style="flex:1"><div style="font-size:12px;color:#555;margin-bottom:4px">По</div><input type="date" id="exp-date-to" value="${dateTo}" class="form-inp"></div>
            </div>
          </div>
          <div>
            <label style="display:flex;align-items:center;gap:10px;cursor:pointer">
              <input type="checkbox" id="exp-show-balances" ${showBal?'checked':''} style="width:16px;height:16px;accent-color:#6ee7b7">
              <span style="font-size:14px;color:#ccc">Показывать остатки по счетам</span>
            </label>
          </div>
          <button id="btn-export-go" style="width:100%;padding:14px;border-radius:10px;border:none;background:linear-gradient(135deg,#6ee7b7,#3b82f6);color:#000;font-size:15px;font-weight:700;cursor:pointer">📊 Сформировать выписку</button>
        </div>
      </div>
    </div>`;
}

function transactionsHtml() {
  // Account tabs (no direction grouping)
  const dirTabs = [
    `<button class="filter-btn ${!state.activeDir?'active':''}" data-filter="">Все счета</button>`,
    `<span style="width:1px;height:16px;background:rgba(255,255,255,0.12);display:inline-block;align-self:center;margin:0 2px"></span>`,
    ...getOrderedAccounts().map(k => {
      const a = state.accounts[k];
      const bal = `<span style="font-size:10px;opacity:0.7;margin-left:4px">${fmt(a.balance, a.currency)}</span>`;
      return `<button class="filter-btn ${state.activeDir===k?'active':''}" data-filter="${k}">${escapeHtml(a.name)}${bal}</button>`;
    }),
    `<span style="width:1px;height:16px;background:rgba(255,255,255,0.12);display:inline-block;align-self:center;margin:0 2px"></span>`,
    ...Object.entries(state.funds||{}).map(([fk,f]) => {
      const fbal = `<span style="font-size:10px;opacity:0.7;margin-left:4px">${fmt(f.balance, f.currency||'RUB')}</span>`;
      return `<button class="filter-btn ${state.activeDir===fk?'active':''}" data-filter="${fk}">${f.emoji||'💰'} ${escapeHtml(f.name)}${fbal}</button>`;
    })
  ].join('');

  const typeFilters = [
    ['income','🟢 Доход','#6ee7b7','rgba(110,231,183,0.12)','rgba(110,231,183,0.3)'],
    ['expense','🔴 Расход','#f87171','rgba(239,68,68,0.12)','rgba(239,68,68,0.3)'],
    ['transfer','🟡 Перевод','#fbbf24','rgba(251,191,36,0.12)','rgba(251,191,36,0.3)'],
    ['dividend','🟣 Дивиденды','#a78bfa','rgba(167,139,250,0.12)','rgba(167,139,250,0.3)'],
  ];
  const allCats = [...new Set([...getDirCats('_global','in'),...getDirCats('_global','out')])].filter(c=>!c.includes('Перевод'));
  const hasAdvFilter = (state.txCatFilter && state.txCatFilter.length) || state.txDateFrom || state.txDateTo;
  const typeFilterBar = `<div style="display:flex;gap:8px;padding:8px 16px 4px;flex-wrap:wrap;align-items:center">
    ${typeFilters.map(([type,label,color,bg,border]) => {
      const active = state.txTypeFilter.includes(type);
      return `<button onclick="(function(){var idx=state.txTypeFilter.indexOf('${type}');if(idx>=0)state.txTypeFilter.splice(idx,1);else state.txTypeFilter.push('${type}');render();})()" style="padding:5px 12px;border-radius:20px;border:1px solid ${active?border:'rgba(255,255,255,0.08)'};background:${active?bg:'transparent'};color:${active?color:'#555'};cursor:pointer;font-size:12px;font-weight:${active?'600':'400'};transition:all 0.15s">${label}</button>`;
    }).join('')}
    <div style="margin-left:auto;display:flex;gap:8px;align-items:center">
      <button id="btn-export-excel" style="padding:6px 14px;border-radius:9px;border:1px solid rgba(110,231,183,0.3);background:rgba(110,231,183,0.07);color:#6ee7b7;cursor:pointer;font-size:13px;font-weight:600;white-space:nowrap">📊 Выгрузить Excel</button>
      <div style="position:relative;display:flex;align-items:center">
        <input id="tx-search" type="text" placeholder="🔍 Поиск..." value="${state.txSearch||''}" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:6px 30px 6px 12px;color:#ccc;font-size:13px;width:160px;outline:none">
        ${state.txSearch ? `<button onclick="state.txSearch='';render()" style="position:absolute;right:0;top:0;bottom:0;width:36px;background:none;border:none;color:#aaa;cursor:pointer;font-size:18px;line-height:1;padding:0;display:flex;align-items:center;justify-content:center">×</button>` : ''}
      </div>
      <button id="btn-adv-filter" style="padding:6px 12px;border-radius:10px;border:1px solid ${hasAdvFilter?'rgba(167,139,250,0.5)':'rgba(255,255,255,0.1)'};background:${hasAdvFilter?'rgba(167,139,250,0.12)':'rgba(255,255,255,0.04)'};color:${hasAdvFilter?'#a78bfa':'#666'};cursor:pointer;font-size:12px;white-space:nowrap">+ Фильтр${hasAdvFilter?' ●':''}</button>
    </div>
  </div>
  ${state.showTxAdvFilter ? `<div style="padding:8px 16px 12px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;border-top:1px solid rgba(255,255,255,0.05)">
    <div style="position:relative">
      <button id="btn-cat-picker" style="padding:6px 12px;border-radius:10px;border:1px solid ${(state.txCatFilter&&state.txCatFilter.length)?'rgba(167,139,250,0.5)':'rgba(255,255,255,0.1)'};background:${(state.txCatFilter&&state.txCatFilter.length)?'rgba(167,139,250,0.12)':'rgba(255,255,255,0.04)'};color:${(state.txCatFilter&&state.txCatFilter.length)?'#a78bfa':'#666'};cursor:pointer;font-size:12px;white-space:nowrap">
        🏷 Категории${(state.txCatFilter&&state.txCatFilter.length)?' ('+state.txCatFilter.length+')':''}
      </button>
      ${state.showCatPicker ? `<div id="cat-picker-dropdown" style="position:absolute;top:calc(100% + 6px);left:0;z-index:999;background:#1a1a1a;border:1px solid rgba(255,255,255,0.12);border-radius:14px;padding:12px 14px;min-width:220px;max-height:340px;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.6)">
        <div style="font-size:11px;font-weight:700;color:#6ee7b7;text-transform:uppercase;letter-spacing:0.06em;padding:2px 0 6px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#6ee7b7;margin-right:5px;vertical-align:middle"></span>Доходы</div>
        ${getDirCats('_global','in').filter(c=>c!=='Перевод входящий').map(c=>{const sel=state.txCatFilter.includes(c);return `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:4px 4px;border-radius:6px;background:${sel?'rgba(110,231,183,0.08)':'transparent'}"><input type="checkbox" data-cat-check="${c}" ${sel?'checked':''} style="accent-color:#6ee7b7;width:13px;height:13px"><span style="font-size:13px;color:${sel?'#6ee7b7':'#aaa'}">${c}</span></label>`;}).join('')}
        <div style="font-size:11px;font-weight:700;color:#f87171;text-transform:uppercase;letter-spacing:0.06em;padding:10px 0 6px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#f87171;margin-right:5px;vertical-align:middle"></span>Расходы</div>
        ${getDirCats('_global','out').filter(c=>c!=='Перевод исходящий').map(c=>{const sel=state.txCatFilter.includes(c);return `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:4px 4px;border-radius:6px;background:${sel?'rgba(248,113,113,0.08)':'transparent'}"><input type="checkbox" data-cat-check="${c}" ${sel?'checked':''} style="accent-color:#f87171;width:13px;height:13px"><span style="font-size:13px;color:${sel?'#f87171':'#aaa'}">${c}</span></label>`;}).join('')}
        <div style="font-size:11px;font-weight:700;color:#fbbf24;text-transform:uppercase;letter-spacing:0.06em;padding:10px 0 6px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#fbbf24;margin-right:5px;vertical-align:middle"></span>Переводы</div>
        ${CATEGORIES_DDS.map(c=>{const sel=state.txCatFilter.includes(c);return `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:4px 4px;border-radius:6px;background:${sel?'rgba(251,191,36,0.08)':'transparent'}"><input type="checkbox" data-cat-check="${c}" ${sel?'checked':''} style="accent-color:#fbbf24;width:13px;height:13px"><span style="font-size:13px;color:${sel?'#fbbf24':'#aaa'}">${c}</span></label>`;}).join('')}
        ${(()=>{
          const txDivCats = [...new Set(state.transactions.filter(t=>t.type==='dividend').map(t=>t.category).filter(Boolean))];
          const divCats = [...new Set([...CATEGORIES_DIVIDENDS, ...txDivCats])];
          return `<div style="font-size:11px;font-weight:700;color:#a78bfa;text-transform:uppercase;letter-spacing:0.06em;padding:10px 0 6px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#a78bfa;margin-right:5px;vertical-align:middle"></span>Дивиденды</div>${divCats.map(c=>{const sel=state.txCatFilter.includes(c);return `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:4px 4px;border-radius:6px;background:${sel?'rgba(167,139,250,0.08)':'transparent'}"><input type="checkbox" data-cat-check="${c}" ${sel?'checked':''} style="accent-color:#a78bfa;width:13px;height:13px"><span style="font-size:13px;color:${sel?'#a78bfa':'#aaa'}">${c}</span></label>`;}).join('')}`;
        })()}
        <div style="display:flex;gap:6px;margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.07)">
          <button id="cat-pick-all" style="flex:1;padding:5px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:#888;font-size:11px;cursor:pointer">Все</button>
          <button id="cat-pick-none" style="flex:1;padding:5px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:#888;font-size:11px;cursor:pointer">Снять</button>
        </div>
      </div>` : ''}
    </div>
    <div style="display:flex;align-items:center;gap:6px">
      <span style="font-size:12px;color:#666">С:</span>
      <input type="date" id="tx-date-from" value="${state.txDateFrom||''}" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:5px 8px;color:#ccc;font-size:12px">
    </div>
    <div style="display:flex;align-items:center;gap:6px">
      <span style="font-size:12px;color:#666">По:</span>
      <input type="date" id="tx-date-to" value="${state.txDateTo||''}" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:5px 8px;color:#ccc;font-size:12px">
    </div>
    <button id="tx-filter-reset" style="padding:5px 10px;border-radius:8px;border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.06);color:#f87171;font-size:12px;cursor:pointer">✕ Сбросить</button>
  </div>` : ''}`;

  if (!state.activeDir) {
    const sorted = applyTxFilters([...monthTxs()].filter(t => { if (t.isFundTarget) return false; const tt = (t.isTransfer || t.type==='transfer') ? 'transfer' : t.type; return state.txTypeFilter.includes(tt); })).sort((a,b) => { const dd = new Date(b.date) - new Date(a.date); return dd !== 0 ? dd : (function(a,b){
          const ac = a.createdAt||0, bc = b.createdAt||0;
          // Dividend always before linked income — check explicit links AND matching by amount+date+category
          const isDivIncPair = (div, inc) =>
            div.type==='dividend' && inc.type==='income' &&
            (div.linkedIncomeTxId===inc.id || inc.linkedDividendTxId===div.id ||
             (div.date===inc.date && parseFloat(div.amount)===parseFloat(inc.amount) &&
              (inc.category==='Дивиденды собственника'||inc.category==='Дивиденды')));
          if (isDivIncPair(a,b)) return -1;
          if (isDivIncPair(b,a)) return 1;
          return bc - ac;
        })(a,b); });
    const MONTHS_GEN = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
    const dayLabel = d => {
      const [y,m,day] = d.split('-');
      return parseInt(day) + ' ' + MONTHS_GEN[parseInt(m)-1] + ' ' + y;
    };
    const txGroups = {};
    sorted.slice(0,200).forEach(t => { if (!txGroups[t.date]) txGroups[t.date] = []; txGroups[t.date].push(t); });
    const txHtml = sorted.length === 0
      ? `<div class="empty">Нет операций. Нажмите «+ Операция» чтобы начать!</div>`
      : Object.entries(txGroups).sort((a,b)=>b[0].localeCompare(a[0])).map(([date, txList]) =>
          `<div style="font-size:11px;color:#444;text-transform:uppercase;letter-spacing:0.08em;padding:12px 0 6px;border-top:1px solid rgba(255,255,255,0.04);margin-top:4px">${dayLabel(date)}</div>`
          + txList.map(t => txItemHtml(t)).join('')
        ).join('');
    const etm = ''; const dtm = ''; const expM = ''; // rendered globally in bodyHtml
    return `<div class="filter-bar" style="display:flex;align-items:center;flex-wrap:wrap;gap:8px">
      <div style="display:flex;gap:6px;flex-wrap:wrap">${dirTabs}</div>
    </div>${typeFilterBar}${txHtml}`;
  }

  // FUNDS section
  if (state.activeDir === 'funds') {
    const activeFund = state.activeAccount || Object.keys(state.funds)[0];
    const totalFundsBalance = Object.values(state.funds).reduce((s,f) => s + toRub(f.balance, f.currency||'RUB'), 0);
    const fundTabs = Object.entries(state.funds).map(([k,f]) => `
      <button class="acc-tab ${activeFund===k?'acc-tab-active':''}" data-acc="${k}">
        <div style="font-size:13px;font-weight:600">${f.icon} ${f.name}</div>
        <div style="font-size:12px;margin-top:2px;color:${f.color}">${fmt(f.balance)}</div>
      </button>`).join('');
    const fundTxs = monthTxs().filter(t => t.isFund && t.fundKey === activeFund && !t.isFundTarget);
    const sorted = applyTxFilters([...fundTxs].filter(t => { const tt = (t.isTransfer || t.type==='transfer') ? 'transfer' : t.type; return state.txTypeFilter.includes(tt); })).sort((a,b) => { const dd = new Date(b.date)-new Date(a.date); return dd !== 0 ? dd : (function(a,b){
          const ac = a.createdAt||0, bc = b.createdAt||0;
          const isDivIncPair = (div, inc) =>
            div.type==='dividend' && inc.type==='income' &&
            (div.linkedIncomeTxId===inc.id || inc.linkedDividendTxId===div.id ||
             (div.date===inc.date && parseFloat(div.amount)===parseFloat(inc.amount) &&
              (inc.category==='Дивиденды собственника'||inc.category==='Дивиденды')));
          if (isDivIncPair(a,b)) return -1;
          if (isDivIncPair(b,a)) return 1;
          return bc - ac;
        })(a,b); });
    const txHtml = sorted.length === 0
      ? `<div class="empty">Нет операций по этому фонду</div>`
      : sorted.map(t => txItemHtml(t)).join('');
    const etmf = ''; const dtmf = ''; const expMf = ''; // rendered globally in bodyHtml
    return `<div class="filter-bar" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
      <div style="display:flex;gap:6px;flex-wrap:wrap">${dirTabs}</div>
      <button id="btn-export-excel" style="padding:7px 14px;border-radius:9px;border:1px solid rgba(110,231,183,0.3);background:rgba(110,231,183,0.07);color:#6ee7b7;cursor:pointer;font-size:13px;font-weight:600;white-space:nowrap">📊 Выгрузить Excel</button>
    </div>
    <div class="acc-tabs-row">${fundTabs}</div>${typeFilterBar}${txHtml}`;
  }

  // Show transactions for selected account
  const activeAcc = state.activeDir; // now activeDir IS the account key

  const allForDir = activeAcc
    ? monthTxs().filter(t => t.account === activeAcc || ((t.isTransfer || t.type==='transfer') && (t.fromAccount === activeAcc || t.toAccount === activeAcc || t.account === activeAcc)))
    : monthTxs();

  const filtered = allForDir.filter(t => !t.isFundTarget);
  const sorted = applyTxFilters([...filtered].filter(t => { const tt = (t.isTransfer || t.type==='transfer') ? 'transfer' : t.type; return state.txTypeFilter.includes(tt); })).sort((a,b) => { const dd = new Date(b.date) - new Date(a.date); return dd !== 0 ? dd : (function(a,b){
          const ac = a.createdAt||0, bc = b.createdAt||0;
          const isDivIncPair = (div, inc) =>
            div.type==='dividend' && inc.type==='income' &&
            (div.linkedIncomeTxId===inc.id || inc.linkedDividendTxId===div.id ||
             (div.date===inc.date && parseFloat(div.amount)===parseFloat(inc.amount) &&
              (inc.category==='Дивиденды собственника'||inc.category==='Дивиденды')));
          if (isDivIncPair(a,b)) return -1;
          if (isDivIncPair(b,a)) return 1;
          return bc - ac;
        })(a,b); });

  const txHtml = sorted.length === 0
    ? `<div class="empty">Нет операций по этому счёту</div>`
    : sorted.slice(0,100).map(t => txItemHtml(t)).join('');

  const dtm2 = ''; const etm2 = ''; const expM2 = ''; // rendered globally in bodyHtml
  return `
    <div class="filter-bar" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
      <div style="display:flex;gap:6px;flex-wrap:wrap">${dirTabs}</div>
      <button id="btn-export-excel" style="padding:7px 14px;border-radius:9px;border:1px solid rgba(110,231,183,0.3);background:rgba(110,231,183,0.07);color:#6ee7b7;cursor:pointer;font-size:13px;font-weight:600;white-space:nowrap">📊 Выгрузить Excel</button>
    </div>
    ${typeFilterBar}${txHtml}`;
}

function txItemHtml(t) {
  const MONTHS_GEN = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  const dp = t.date ? t.date.split('-') : [];
  const dateStr = dp.length===3 ? `${parseInt(dp[2])} ${MONTHS_GEN[parseInt(dp[1])-1]}` : t.date;

  // ── TRANSFER (unified) ──────────────────────────────────────────────────────
  if (t.isTransfer || (t.isFund && t.type === 'transfer')) {
    // Resolve account or fund name from key (supports "fund:key" virtual accounts)
    function resolveAccName(key) {
      if (!key) return '—';
      if (key.startsWith('fund:')) {
        const fk = key.slice(5);
        const f = (state.funds||{})[fk];
        return f ? (f.icon + ' ' + f.name) : key;
      }
      const a = state.accounts[key];
      return a ? a.name : key;
    }
    const fromAccKey = t.fromAccount || t.account;
    const fromAmt    = t.fromAmount  || t.amount;
    const fromCur    = t.fromCurrency || t.currency;
    const toAccKey   = t.toAccount;
    const toAmt      = t.toAmount || fromAmt;
    const toCur      = t.toCurrency || fromCur;
    const fromName   = resolveAccName(fromAccKey);
    const toName     = resolveAccName(toAccKey);
    return `
      <div class="tx-item" data-tx-open="${t.id}" style="cursor:pointer;display:flex;align-items:center;gap:12px;padding:20px 16px;border-color:rgba(251,191,36,0.15)">
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:10px">
          <span style="font-size:12px;font-weight:600;padding:3px 10px;border-radius:20px;border:1px solid rgba(251,191,36,0.3);background:rgba(251,191,36,0.08);color:#fbbf24;display:inline-block;width:fit-content">🔄 Перевод</span>
          <div style="font-size:18px;font-weight:600;color:#ccc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${t.category||'Перевод между счетами'}</div>
          ${t.note ? `<div style="font-size:13px;color:#666;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(t.note)}</div>` : ''}
          <div style="font-size:13px;color:#888;display:flex;align-items:center;gap:6px;white-space:nowrap;overflow:hidden">
            <span style="color:#888;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${fromName}</span>
            <span style="color:#555;flex-shrink:0">→</span>
            <span style="color:#888;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${toName}</span>
          </div>
          <div style="font-size:13px;color:#555">${dateStr}</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          ${fromCur === toCur
            ? `<div style="font-size:15px;font-weight:700;font-family:monospace;color:#fbbf24">⇄ ${fmt(fromAmt,fromCur)}</div>`
            : `<div style="font-size:15px;font-weight:700;font-family:monospace;color:#f87171">−${fmt(fromAmt,fromCur)}</div>
               <div style="font-size:15px;font-weight:700;font-family:monospace;color:#93c5fd;margin-top:2px">+${fmt(toAmt,toCur)}</div>`
          }
        </div>
      </div>`;
  }

  // ── REGULAR ─────────────────────────────────────────────────────────────────
  const acc  = state.accounts[t.account];
  const isDividend = t.type === 'dividend';
  const sign = t.type === 'income' ? '+' : t.type === 'transfer' ? '⇄' : '-';
  const amtColor  = t.type==='income'?'#6ee7b7':t.type==='expense'?'#f87171':isDividend?'#a78bfa':'#fbbf24';
  const typeLabel = t.type==='income'?'🟢 Доход':t.type==='expense'?'🔴 Расход':t.type==='transfer'?'🟡 Перевод':isDividend?'🟣 Дивиденды':'Неизвестно';
  const typeBg    = t.type==='income'?'rgba(110,231,183,0.08)':t.type==='expense'?'rgba(239,68,68,0.08)':isDividend?'rgba(167,139,250,0.08)':'rgba(251,191,36,0.08)';
  const typeBorder= t.type==='income'?'rgba(110,231,183,0.2)':t.type==='expense'?'rgba(239,68,68,0.2)':isDividend?'rgba(167,139,250,0.2)':'rgba(251,191,36,0.2)';
  const accName = acc ? acc.name : '—';
  const sub = t.currency!=='RUB' ? `<div style="font-size:11px;color:#555;margin-top:1px">≈${fmt(toRub(t.amount,t.currency))}</div>` : '';
  return `
    <div class="tx-item" data-tx-open="${t.id}" style="cursor:pointer;display:flex;align-items:center;gap:12px;padding:20px 16px">
      <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:10px">
        <span style="font-size:12px;font-weight:600;padding:3px 10px;border-radius:20px;border:1px solid ${typeBorder};background:${typeBg};color:${amtColor};display:inline-block;width:fit-content">${typeLabel}</span>
        <div style="font-size:18px;font-weight:600;color:#ccc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${t.category}</div>
        ${t.note ? `<div style="font-size:13px;color:#666;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(t.note)}</div>` : ''}
        <div style="font-size:13px;color:#888;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${accName}</div>
        <div style="font-size:13px;color:#555">${dateStr}</div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-size:18px;font-weight:700;font-family:monospace;color:${amtColor}">${sign}${fmt(t.amount,t.currency)}</div>
        ${sub}
      </div>
    </div>`;
}

function txDetailModalHtml(txId) {
  const t = state.transactions.find(x => x.id === txId);
  if (!t) return '';
  const MONTHS_GEN = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  const dp = t.date ? t.date.split('-') : [];
  const dateFormatted = dp.length===3 ? `${parseInt(dp[2])} ${MONTHS_GEN[parseInt(dp[1])-1]} ${dp[0]}` : (t.date||'—');

  function row(label, value) {
    if (!value && value !== 0) return '';
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-top:1px solid rgba(255,255,255,0.07)">
      <span style="font-size:13px;color:#555;flex-shrink:0;margin-right:24px">${label}</span>
      <span style="font-size:13px;color:#ccc;text-align:right">${value}</span>
    </div>`;
  }

  function fmtDateTime(ms) {
    if (!ms) return '—';
    const d = new Date(ms);
    const pad = n => String(n).padStart(2,'0');
    const months = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
    return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear()
      + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  let amountBlock, rowsHtml;

  if (t.type === 'transfer') {
    function resolveDetailName(key) {
      if (!key) return '—';
      if (String(key).startsWith('fund:')) {
        const fk = key.slice(5);
        const f = (state.funds||{})[fk];
        return f ? (f.icon + ' ' + f.name) : key;
      }
      const a = state.accounts[key];
      return a ? a.name : key;
    }
    const fromAcc = state.accounts[t.fromAccount];
    const toAcc   = state.accounts[t.toAccount];
    const fromName = resolveDetailName(t.fromAccount);
    const toName   = resolveDetailName(t.toAccount);
    const fromAmt  = parseFloat(t.fromAmount || t.amount) || 0;
    const toAmt    = parseFloat(t.toAmount   || t.amount) || 0;
    const fromCur  = t.fromCurrency || (fromAcc && fromAcc.currency) || 'RUB';
    const toCur    = t.toCurrency   || (toAcc   && toAcc.currency)   || 'RUB';
    const sameAmt  = fromAmt === toAmt && fromCur === toCur;
    amountBlock = `
      <div style="text-align:center;padding:20px 0 16px">
        <div style="font-size:28px;font-weight:800;font-family:monospace;color:#fbbf24">${fmt(fromAmt, fromCur)}</div>
        <div style="font-size:13px;color:#555;margin-top:6px">${fromName} → ${toName}</div>
        ${!sameAmt ? `<div style="font-size:13px;color:#6ee7b7;margin-top:4px">= ${fmt(toAmt, toCur)}</div>` : ''}
      </div>`;
    rowsHtml = [
      row('Тип', '🟡 Перевод'),
      row('Откуда', fromName),
      row('Куда', toName),
      fromAmt !== toAmt ? row('Сумма списания', fmt(fromAmt, fromCur)) : '',
      fromAmt !== toAmt ? row('Сумма зачисления', fmt(toAmt, toCur)) : '',
      row('Категория', t.category),
      t.note ? row('Комментарий', t.note) : '',
      row('Дата операции', dateFormatted),
      row('Добавлена', fmtDateTime(t.createdAtMs || t.createdAt)),
      t.updatedAtMs ? row('Изменена', fmtDateTime(t.updatedAtMs)) : '',
    ].join('');
  } else {
    const acc = state.accounts[t.account];
    const dir = (state.directions || DIRECTIONS)[t.direction] || DIRECTIONS[t.direction];
    const accName = acc ? acc.name : (t.account || '—');
    const dirName = dir ? dir.icon + ' ' + dir.label : (t.direction || '—');
    const isIncome = t.type === 'income';
    const sign = isIncome ? '+' : '-';
    const amtColor = t.type==='income' ? '#6ee7b7' : t.type==='expense' ? '#f87171' : '#fbbf24';
    const typeLabel = t.type==='income' ? '🟢 Доход' : t.type==='expense' ? '🔴 Расход'
                    : t.type==='transfer' ? '🟡 Перевод' : t.type==='dividend' ? '🟣 Дивиденды' : t.type;
    const amt = parseFloat(t.amount) || 0;
    const cur = t.currency || 'RUB';
    amountBlock = `
      <div style="text-align:center;padding:20px 0 16px">
        <div style="font-size:32px;font-weight:800;font-family:monospace;color:${amtColor}">${sign}${fmt(amt, cur)}</div>
        ${cur !== 'RUB' ? `<div style="font-size:13px;color:#555;margin-top:4px">≈ ${fmt(toRub(amt, cur))} RUB</div>` : ''}
      </div>`;
    rowsHtml = [
      row('Тип', typeLabel),
      row('Категория', t.category),
      t.note ? row('Комментарий', t.note) : '',
      row('Дата операции', dateFormatted),
      row('Счёт', accName),
      row('Добавлена', fmtDateTime(t.createdAtMs || t.createdAt)),
      t.updatedAtMs ? row('Изменена', fmtDateTime(t.updatedAtMs)) : '',
    ].join('');
  }

  return `
    <div class="modal-bg" id="tx-detail-bg">
      <div id="tx-detail-inner" class="modal" style="max-width:520px">
        <div class="modal-header">
          <span class="modal-title">Операция</span>
          <button class="modal-close" id="tx-detail-close">×</button>
        </div>
        <div style="padding:0 20px 8px">
          ${amountBlock}
          ${rowsHtml}
        </div>
        <div style="padding:16px 0 0;display:grid;grid-template-columns:1fr 1fr;gap:10px;width:100%;box-sizing:border-box">
          <button data-tx-edit="${t.id}" style="width:100%;box-sizing:border-box;height:44px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:#ccc;cursor:pointer;font-size:13px;text-align:center;line-height:1;white-space:nowrap">✏️ Редактировать</button>
          <button data-tx-del="${t.id}" style="width:100%;box-sizing:border-box;height:44px;border-radius:10px;border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.07);color:#f87171;cursor:pointer;font-size:13px;text-align:center;line-height:1;white-space:nowrap">🗑 Удалить</button>
        </div>
      </div>
    </div>`;
}

function deleteConfirmModalHtml() {
  const txId = state._pendingDeleteTxId;
  const tx = state.transactions.find(t => t.id === txId) || {};
  const amt = tx.amount ? fmt(tx.amount, tx.currency||'RUB') : '';
  const label = tx.note || tx.category || 'операция';
  return `
    <div class="modal-bg" id="delete-confirm-bg" style="z-index:2000">
      <div class="modal" id="delete-confirm-inner" style="max-width:360px;text-align:center">
        <div style="font-size:40px;margin-bottom:12px">🗑</div>
        <div style="font-size:17px;font-weight:700;color:#fff;margin-bottom:8px">Удалить операцию?</div>
        <div style="font-size:13px;color:#888;margin-bottom:24px">${escapeHtml(label)}${amt ? ' · ' + amt : ''}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <button id="btn-confirm-delete" style="height:44px;border-radius:10px;border:1px solid rgba(239,68,68,0.4);background:rgba(239,68,68,0.15);color:#f87171;cursor:pointer;font-size:14px;font-weight:700">Удалить</button>
          <button id="btn-cancel-delete" style="height:44px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:#ccc;cursor:pointer;font-size:14px">Отмена</button>
        </div>
      </div>
    </div>`;
}

// ── P&L (ОПиУ) ──
function getPartnerPayments(dirKey) {
  return state.partnerPayments[dirKey] || [];
}

// Returns the owner partner — always present, cannot be deleted
function getOwnerPartner(dirKey) {
  const dir = state.directions[dirKey] || DIRECTIONS[dirKey] || {};
  const partners = dir.partners || [];
  return partners.find(p => p.isOwner) || null;
}

// Ensure owner exists in direction — call on load and when managing partners
function ensureOwner(dirKey) {
  if (!state.directions[dirKey]) {
    state.directions[dirKey] = { label: 'Проект', icon: '📁', partners: [] };
  }
  if (!DIRECTIONS[dirKey]) DIRECTIONS[dirKey] = state.directions[dirKey];
  const dir = state.directions[dirKey];
  DIRECTIONS[dirKey] = dir;
  if (!dir.partners) dir.partners = [];
  const hasOwner = dir.partners.some(p => p.isOwner);
  if (!hasOwner) {
    const meIdx = dir.partners.findIndex(p => p.name === 'Я' || p.role === 'Владелец');
    if (meIdx >= 0) {
      dir.partners[meIdx].isOwner = true;
      dir.partners[meIdx].name = dir.partners[meIdx].name || 'Я';
    } else {
      dir.partners.unshift({ id: 'owner_' + dirKey, name: 'Я', role: 'Владелец', share: 0, isOwner: true });
    }
  }
  const partnerSum = dir.partners.filter(p => !p.isOwner).reduce((s,p) => s + (p.share||0), 0);
  const ownerIdx = dir.partners.findIndex(p => p.isOwner);
  if (ownerIdx >= 0) dir.partners[ownerIdx].share = Math.max(0, 1 - partnerSum);
}


// ─── PARTNERS TAB ─────────────────────────────────────────────────────────────

// Fixed project key — no directions, one project = one partner config
const PARTNER_KEY = '_project';

function ensureProjectPartners() {
  if (!state.directions[PARTNER_KEY]) {
    state.directions[PARTNER_KEY] = { label: 'Проект', icon: '📁', partners: [] };
  }
  const dir = state.directions[PARTNER_KEY];
  if (!dir.partners) dir.partners = [];
  // Ensure owner exists
  if (!dir.partners.find(p => p.isOwner)) {
    dir.partners.unshift({ id: 'owner_' + Date.now(), name: 'Я', role: 'Владелец', share: 1, isOwner: true });
  }
  // Recalc owner share = 1 - sum of others
  const partnerSum = dir.partners.filter(p => !p.isOwner).reduce((s,p) => s + (p.share||0), 0);
  const owner = dir.partners.find(p => p.isOwner);
  if (owner) owner.share = Math.max(0, 1 - partnerSum);
  if (!DIRECTIONS[PARTNER_KEY]) DIRECTIONS[PARTNER_KEY] = dir;
}

function projectProfit() {
  // Total project profit = income - expense for current period (excluding dividend categories)
  const divCats = new Set(['Дивиденды собственника','Дивиденды партнёру','Дивиденды']);
  const txs = monthTxs();
  const income  = txs.filter(t => t.type==='income'  && !divCats.has(t.category)).reduce((s,t) => s + toRub(t.amount, t.currency), 0);
  const expense = txs.filter(t => t.type==='expense' && !divCats.has(t.category)).reduce((s,t) => s + toRub(t.amount, t.currency), 0);
  return income - expense;
}

function partnersTabHtml() {
  const isMobile = window.innerWidth <= 600;
  return isMobile ? partnersTabMobileHtml() : partnersTabDesktopHtml();
}

function partnersTabDesktopHtml() {
  ensureProjectPartners();
  const dir = state.directions[PARTNER_KEY] || {};
  const allPartners = dir.partners || [];
  const owner  = allPartners.find(p => p.isOwner);
  const others = allPartners.filter(p => !p.isOwner);
  const ordered = owner ? [owner, ...others] : others;
  const profit = projectProfit();
  const allPayments = state.partnerPayments[PARTNER_KEY] || {};

  const section = partnerSectionHtml(PARTNER_KEY, profit);

  return `
    <div style="max-width:900px;margin:0 auto">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
        <div style="font-size:22px;font-weight:900;color:#fff;letter-spacing:-0.02em">🤝 Партнёры</div>
        <button data-partner-manage="${PARTNER_KEY}" style="padding:6px 14px;border-radius:9px;border:1px solid rgba(251,191,36,0.3);background:rgba(251,191,36,0.08);color:#fbbf24;cursor:pointer;font-size:13px;font-weight:600">⚙️ Управление партнёрами</button>
      </div>
      <div class="card" style="border-color:rgba(251,191,36,0.15)">
        ${section}
      </div>
    </div>`;
}

function partnersTabMobileHtml() {
  ensureProjectPartners();
  const dir = state.directions[PARTNER_KEY] || {};
  const allPartners = dir.partners || [];
  const owner  = allPartners.find(p => p.isOwner);
  const others = allPartners.filter(p => !p.isOwner);
  const ordered = owner ? [owner, ...others] : others;
  const profit = projectProfit();
  const allPayments = state.partnerPayments[PARTNER_KEY] || {};

  // Period profit summary card
  const summaryCard = `
    <div style="background:linear-gradient(135deg,rgba(251,191,36,0.08),rgba(251,191,36,0.03));border:1px solid rgba(251,191,36,0.2);border-radius:16px;padding:16px;margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div style="font-size:11px;color:#888;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.06em">Прибыль за период</div>
          <div style="font-size:24px;font-weight:900;color:${profit>=0?'#fbbf24':'#f87171'};font-family:monospace">${fmt(profit)}</div>
        </div>
        <button data-partner-manage="${PARTNER_KEY}" style="padding:7px 12px;border-radius:10px;border:1px solid rgba(251,191,36,0.3);background:rgba(251,191,36,0.08);color:#fbbf24;cursor:pointer;font-size:12px;font-weight:600">⚙️ Партнёры</button>
      </div>
    </div>`;

  // Partner cards
  const partnerCards = ordered.map(partner => {
    const isOwner = !!partner.isOwner;
    const accrued   = profit > 0 ? profit * partner.share : 0;
    const payments  = (allPayments[partner.id] || []);
    const paid      = payments.reduce((s,p) => s + p.amount, 0);
    const remaining = accrued - paid;
    const remColor  = remaining > 100 ? '#f87171' : '#6ee7b7';
    const accent    = isOwner ? '#ffd700' : '#fbbf24';
    const bg        = isOwner ? 'rgba(255,215,0,0.06)' : 'rgba(255,255,255,0.03)';
    const border    = isOwner ? 'rgba(255,215,0,0.2)' : 'rgba(255,255,255,0.08)';
    const icon      = isOwner ? '👑' : '🤝';
    const btnLabel  = isOwner ? 'Получить дивиденды' : 'Внести выплату';
    const btnGrad   = isOwner ? 'linear-gradient(135deg,#ffd700,#f59e0b)' : 'linear-gradient(135deg,rgba(251,191,36,0.3),rgba(251,191,36,0.15))';
    const btnColor  = isOwner ? '#000' : '#fbbf24';

    const recentPays = [...payments].reverse().slice(0, 3);
    const payRows = recentPays.length === 0
      ? `<div style="font-size:12px;color:#444;padding:8px 0">Выплат ещё не было</div>`
      : recentPays.map(p => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04)">
            <div>
              <div style="font-size:13px;color:#aaa;font-family:monospace">${fmt(p.amount)}</div>
              ${p.note ? `<div style="font-size:11px;color:#555">${escapeHtml(p.note)}</div>` : ''}
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              <div style="font-size:11px;color:#555">${p.date}</div>
              <button data-partner-del="${PARTNER_KEY}" data-partner-id="${partner.id}" data-pay-id="${p.id}" style="width:22px;height:22px;border-radius:6px;border:1px solid rgba(239,68,68,0.3);background:transparent;color:#f87171;cursor:pointer;font-size:10px;display:flex;align-items:center;justify-content:center">✕</button>
            </div>
          </div>`).join('');

    return `
      <div style="background:${bg};border:1px solid ${border};border-radius:18px;padding:16px;margin-bottom:12px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
          <div style="display:flex;align-items:center;gap:10px">
            <div style="width:42px;height:42px;border-radius:14px;background:${isOwner?'rgba(255,215,0,0.15)':'rgba(255,255,255,0.07)'};display:flex;align-items:center;justify-content:center;font-size:20px">${icon}</div>
            <div>
              <div style="font-size:15px;font-weight:700;color:${accent}">${partner.name}</div>
              <div style="font-size:11px;color:#555">${partner.role||''} · <span style="color:${accent}">${(partner.share*100).toFixed(0)}%</span></div>
            </div>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px">
          <div style="background:rgba(255,255,255,0.04);border-radius:12px;padding:10px 12px">
            <div style="font-size:10px;color:#555;margin-bottom:3px">Начислено</div>
            <div style="font-size:14px;font-weight:700;font-family:monospace;color:${accent}">${fmt(accrued)}</div>
          </div>
          <div style="background:rgba(110,231,183,0.06);border-radius:12px;padding:10px 12px">
            <div style="font-size:10px;color:#555;margin-bottom:3px">Выплачено</div>
            <div style="font-size:14px;font-weight:700;font-family:monospace;color:#6ee7b7">${fmt(paid)}</div>
          </div>
          <div style="background:${remaining>100?'rgba(239,68,68,0.06)':'rgba(110,231,183,0.06)'};border-radius:12px;padding:10px 12px">
            <div style="font-size:10px;color:#555;margin-bottom:3px">Остаток</div>
            <div style="font-size:14px;font-weight:700;font-family:monospace;color:${remColor}">${fmt(remaining)}</div>
          </div>
        </div>

        <div style="margin-bottom:14px">${payRows}</div>

        <button data-partner-pay="${PARTNER_KEY}" data-partner-id="${partner.id}" data-partner-name="${partner.name}" data-partner-is-owner="${isOwner}"
          style="width:100%;padding:12px;border-radius:12px;border:none;background:${btnGrad};color:${btnColor};cursor:pointer;font-size:14px;font-weight:700">
          ${isOwner ? '👑' : '+'} ${btnLabel}
        </button>
      </div>`;
  }).join('');

  return `<div class="tab-content" style="padding:16px">
    ${summaryCard}
    ${partnerCards}
  </div>`;
}


function partnerSectionHtml(dirKey, profit) {
  ensureOwner(dirKey);
  const dir = DIRECTIONS[dirKey] || {};
  const allPartners = dir.partners || [];

  // Owner always first
  const owner    = allPartners.find(p => p.isOwner);
  const others   = allPartners.filter(p => !p.isOwner);
  const ordered  = owner ? [owner, ...others] : others;

  const allPayments = state.partnerPayments[dirKey] || {};

  const partnerBlocks = ordered.map(partner => {
    const accrued   = profit > 0 ? profit * partner.share : 0;
    const payments  = allPayments[partner.id] || [];
    const paid      = payments.reduce((s,p) => s + p.amount, 0);
    const remaining = accrued - paid;
    const remColor  = remaining > 0 ? '#f87171' : '#6ee7b7';
    const isOwner   = !!partner.isOwner;

    // Owner: gold crown style; Partners: amber
    const bgStyle   = isOwner
      ? 'border-bottom:1px solid rgba(255,215,0,0.15);padding:18px 20px;background:rgba(255,215,0,0.03)'
      : 'border-bottom:1px solid rgba(255,255,255,0.07);padding:18px 20px';
    const nameColor = isOwner ? '#ffd700' : '#fbbf24';
    const icon      = isOwner ? '👑' : '🤝';

    const rows = payments.length === 0
      ? `<tr><td colspan="4" style="padding:10px 16px;color:#555;font-size:13px">Выплат ещё не было</td></tr>`
      : [...payments].reverse().map(p => `
        <tr style="border-bottom:1px solid rgba(255,255,255,0.03)">
          <td style="padding:8px 16px;font-size:13px;color:#aaa">${p.date}</td>
          <td style="padding:8px 16px;font-size:13px;color:${nameColor};font-family:monospace">${fmt(p.amount)}</td>
          <td style="padding:8px 16px;font-size:13px;color:#888">${p.note||'—'}</td>
          <td style="padding:8px 16px;display:flex;gap:4px">
            ${p.txId ? `<button data-partner-edit-pay="${dirKey}" data-partner-id="${partner.id}" data-pay-id="${p.id}" style="padding:2px 7px;border-radius:5px;border:1px solid rgba(255,255,255,0.15);background:transparent;color:#888;cursor:pointer;font-size:11px">⚙</button>` : ''}
            <button data-partner-del="${dirKey}" data-partner-id="${partner.id}" data-pay-id="${p.id}" style="padding:2px 7px;border-radius:5px;border:1px solid rgba(239,68,68,0.3);background:transparent;color:#f87171;cursor:pointer;font-size:11px">✕</button>
          </td>
        </tr>`).join('');

    const payBtnStyle = 'padding:4px 10px;border-radius:7px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:#aaa;cursor:pointer;font-size:12px';

    return `
      <div style="${bgStyle}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:14px;font-weight:700;color:${nameColor}">${icon} ${partner.name}</span>
            <span style="font-size:11px;color:#555">${partner.role}</span>
            <span style="font-size:12px;font-weight:700;color:${nameColor};background:rgba(255,255,255,0.06);padding:2px 8px;border-radius:20px">${(partner.share*100).toFixed(0)}%</span>
            
          </div>
          <button data-partner-pay="${dirKey}" data-partner-id="${partner.id}" data-partner-name="${partner.name}" data-partner-is-owner="${isOwner}"
            style="${payBtnStyle}">
            ${isOwner ? '+ Получить дивиденды' : '+ Внести выплату'}
          </button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px">
          <div style="background:rgba(255,255,255,0.04);border-radius:10px;padding:12px 14px">
            <div style="font-size:11px;color:#555;margin-bottom:3px">Начислено</div>
            <div style="font-size:16px;font-weight:700;font-family:monospace;color:${nameColor}">${fmt(accrued)}</div>
          </div>
          <div style="background:rgba(110,231,183,0.05);border-radius:10px;padding:12px 14px">
            <div style="font-size:11px;color:#555;margin-bottom:3px">Выплачено</div>
            <div style="font-size:16px;font-weight:700;font-family:monospace;color:#6ee7b7">${fmt(paid)}</div>
          </div>
          <div style="background:rgba(239,68,68,0.05);border-radius:10px;padding:12px 14px">
            <div style="font-size:11px;color:#555;margin-bottom:3px">Остаток</div>
            <div style="font-size:16px;font-weight:700;font-family:monospace;color:${remColor}">${fmt(remaining)}</div>
          </div>
        </div>
        <table style="width:100%"><tbody>${rows}</tbody></table>
      </div>`;
  }).join('');

  return `
    <div style="padding:16px 20px 8px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div style="font-size:18px;font-weight:800;color:#fbbf24;letter-spacing:0.02em">🤝 Партнёрские отчисления</div>
        <button data-partner-manage="${dirKey}" style="padding:4px 10px;border-radius:7px;border:1px solid rgba(251,191,36,0.3);background:rgba(251,191,36,0.07);color:#fbbf24;cursor:pointer;font-size:12px">⚙️ Управление партнёрами</button>
      </div>
    </div>
    ${partnerBlocks}`;
}

function partnerPayModalHtml({ dirKey, partnerId, partnerName, isOwner }) {
  const dir = DIRECTIONS[dirKey] || {};
  const defaultDate = _localDateStr(); // always today

  const fromOptions = allAccOptions('');

  const titleIcon  = isOwner ? '👑' : '💸';
  const titleColor = isOwner ? '#ffd700' : '#fff';
  const btnLabel   = isOwner ? '👑 Получить дивиденды' : 'Записать выплату';

  const ownerFields = '';

  return `
    <div class="modal-bg" id="partner-modal-bg">
      <div id="partner-modal-inner" class="modal" style="max-width:420px">
        <div class="modal-header">
          <span class="modal-title" style="color:${titleColor}">${titleIcon} ${partnerName} · ${dir.icon} ${dir.label}</span>
          <button class="modal-close" id="partner-modal-close">×</button>
        </div>
        <div class="form-grid">
          <div>
            <div class="form-label">Списать со счёта проекта</div>
            <select class="form-inp" id="pp-account">${fromOptions}</select>
          </div>
          ${ownerFields}
          <div>
            <div class="form-label">Дата</div>
            <input type="date" class="form-inp" id="pp-date" value="${defaultDate}">
          </div>
          <div>
            <div class="form-label">Сумма</div>
            <input type="number" placeholder="0" class="form-inp" id="pp-amount" autofocus>
          </div>
          <div>
            <div class="form-label">Комментарий</div>
            <input type="text" placeholder="Необязательно..." class="form-inp" id="pp-note">
          </div>
          <button class="btn-submit" id="btn-pp-submit" style="${isOwner?'background:linear-gradient(135deg,#ffd700,#f59e0b);color:#000':''}">${btnLabel}</button>
        </div>
      </div>
    </div>`;
}

function partnerManageModalHtml(dirKey) {
  ensureOwner(dirKey);
  const dir = DIRECTIONS[dirKey] || {};
  const allPartners = dir.partners || [];
  const owner   = allPartners.find(p => p.isOwner);
  const others  = allPartners.filter(p => !p.isOwner);
  const partnerSum = others.reduce((s,p) => s+(p.share||0), 0);
  const ownerShare = Math.max(0, 1 - partnerSum);
  const ownerPct   = (ownerShare * 100).toFixed(0);
  const overLimit  = partnerSum > 1;

  const partnerRows = others.map((p, i) => {
    const hasPay = (state.partnerPayments[dirKey]||{})[p.id]?.length > 0;
    return `<div style="display:grid;grid-template-columns:1fr 1fr auto auto;gap:8px;align-items:center;margin-bottom:10px">
      <input type="text" data-pm-name="${i}" value="${p.name}" placeholder="Имя" class="form-inp" style="font-size:13px;padding:8px 10px">
      <input type="text" data-pm-role="${i}" value="${p.role}" placeholder="Роль" class="form-inp" style="font-size:13px;padding:8px 10px">
      <div style="display:flex;align-items:center;gap:4px">
        <input type="number" data-pm-share="${i}" value="${(p.share*100).toFixed(0)}" min="0" max="99" class="form-inp" style="width:64px;font-size:13px;padding:8px 8px;text-align:center" oninput="updateOwnerSharePreview('${dirKey}')">
        <span style="color:#555;font-size:13px">%</span>
      </div>
      ${hasPay
        ? `<button disabled title="Есть выплаты — сначала удали их" style="padding:6px 9px;border-radius:7px;border:1px solid rgba(255,255,255,0.07);background:transparent;color:#555;cursor:not-allowed;font-size:13px">🗑</button>`
        : `<button data-pm-del="${i}" style="padding:6px 9px;border-radius:7px;border:1px solid rgba(239,68,68,0.3);background:transparent;color:#f87171;cursor:pointer;font-size:13px">🗑</button>`}
    </div>`;
  }).join('');

  return `
    <div class="modal-bg" id="partner-manage-bg">
      <div id="partner-manage-inner" class="modal" style="max-width:460px">
        <div class="modal-header">
          <span class="modal-title">⚙️ Партнёры · ${dir.icon} ${dir.label}</span>
          <button class="modal-close" id="partner-manage-close">×</button>
        </div>
        <div style="padding:16px 20px">

          <!-- Owner row — pinned, name editable, no delete, no % input -->
          <div style="padding:12px 14px;border-radius:12px;background:rgba(255,215,0,0.06);border:1px solid rgba(255,215,0,0.2);margin-bottom:16px">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
              <div style="display:flex;align-items:center;gap:8px">
                <span style="font-size:18px">👑</span>
                <div style="font-size:12px;color:#888">Владелец</div>
              </div>
              <div style="font-size:20px;font-weight:800;color:#ffd700" id="owner-share-preview">${ownerPct}%</div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              <input type="text" id="pm-owner-name" value="${owner ? owner.name : ''}" placeholder="Ваше имя" class="form-inp" style="font-size:13px;padding:8px 10px;border-color:rgba(255,215,0,0.3)">
              <input type="text" id="pm-owner-role" value="${owner ? owner.role : 'Владелец'}" placeholder="Роль" class="form-inp" style="font-size:13px;padding:8px 10px;border-color:rgba(255,215,0,0.3)">
            </div>
          </div>

          <!-- Partners -->
          <div style="font-size:12px;color:#555;margin-bottom:10px">Партнёры (их процент вводится вручную; остаток — автоматически Владельцу)</div>
          ${overLimit ? `<div style="padding:8px 12px;border-radius:8px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);color:#f87171;font-size:12px;margin-bottom:10px">⚠️ Сумма долей партнёров превышает 100%</div>` : ''}
          ${partnerRows}

          <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:8px">
            <button id="btn-pm-add" style="width:100%;padding:9px;border-radius:9px;border:1px solid rgba(167,139,250,0.3);background:rgba(167,139,250,0.07);color:#a78bfa;cursor:pointer;font-size:13px">+ Добавить партнёра</button>
            <button id="btn-pm-reset" style="width:100%;padding:9px;border-radius:9px;border:1px solid rgba(239,68,68,0.25);background:rgba(239,68,68,0.05);color:#f87171;cursor:pointer;font-size:12px">🗑 Сбросить всех партнёров (оставить только владельца)</button>
          </div>
          <button id="btn-pm-save" class="btn-submit" style="margin-top:12px">Сохранить</button>
        </div>
      </div>
    </div>`;
}

function updateOwnerSharePreview(dirKey) {
  const inputs = document.querySelectorAll('[data-pm-share]');
  let sum = 0;
  inputs.forEach(inp => { sum += parseFloat(inp.value)||0; });
  const ownerPct = Math.max(0, 100 - sum);
  const el = document.getElementById('owner-share-preview');
  if (el) {
    el.textContent = ownerPct.toFixed(0) + '%';
    el.style.color = sum > 100 ? '#f87171' : '#ffd700';
  }
}

function getCatsForDir(dirKey, type) {
  return getDirCats(dirKey, type);
}

function catEditorModalHtml() {
  const { dirKey, type } = state.showCatEditor;
  const cats = getCatsForDir(dirKey, type);
  const dir  = DIRECTIONS[dirKey] || {};
  const title = type === 'in' ? '💚 Статьи доходов' : '🔴 Статьи расходов';
  // Block delete if category used in ANY direction (global rule)
  const txType = type === 'in' ? 'income' : 'expense';
  const usedCats = new Set(
    state.transactions
      .filter(t => t.type === txType)
      .map(t => t.category)
  );
  const rows = cats.map((cat, i) => {
    const used = usedCats.has(cat);
    return `<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.07)">
      <input type="text" data-cat-rename="${i}" value="${cat}" style="flex:1;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);border-radius:7px;padding:6px 10px;color:#ccc;font-size:13px">
      <button data-cat-del="${i}" ${used?'disabled title="Есть операции — нельзя удалить"':''} style="padding:4px 8px;border-radius:6px;border:1px solid ${used?'rgba(255,255,255,0.04)':'rgba(239,68,68,0.3)'};background:${used?'transparent':'rgba(239,68,68,0.08)'};color:${used?'#333':'#f87171'};cursor:${used?'not-allowed':'pointer'};font-size:12px">🗑</button>
    </div>`;
  }).join('');
  return `
    <div class="modal-bg" id="cat-editor-bg">
      <div id="cat-editor-inner" class="modal" style="max-width:420px">
        <div class="modal-header">
          <span class="modal-title">${title} · Все направления</span>
          <button class="modal-close" id="cat-editor-close">×</button>
        </div>
        <div style="padding:16px 20px;max-height:50vh;overflow-y:auto" id="cat-list">${rows}</div>
        <div style="padding:12px 20px;border-top:1px solid var(--border);display:flex;gap:8px">
          <input type="text" id="cat-new-input" placeholder="Новая статья..." style="flex:1;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:8px 12px;color:#ccc;font-size:13px">
          <button id="cat-new-add" style="padding:8px 14px;border-radius:8px;border:1px solid rgba(110,231,183,0.3);background:rgba(110,231,183,0.07);color:#6ee7b7;cursor:pointer;font-size:13px">+ Добавить</button>
        </div>
        <div style="padding:0 20px 16px">
          <button id="cat-save-all" class="btn-submit">Сохранить</button>
        </div>
      </div>
    </div>`;
}

function applyTxFilters(txs) {
  let result = txs;
  const q = (state.txSearch||'').toLowerCase().trim();
  if (q) result = result.filter(t => {
    const cat = (t.category||'').toLowerCase();
    const note = (t.note||'').toLowerCase();
    const amt = String(t.amount||'');
    return cat.includes(q) || note.includes(q) || amt.includes(q);
  });
  if (state.txCatFilter && state.txCatFilter.length) result = result.filter(t => state.txCatFilter.includes(t.category));
  if (state.txDateFrom)  result = result.filter(t => t.date >= state.txDateFrom);
  if (state.txDateTo)    result = result.filter(t => t.date <= state.txDateTo);
  return result;
}

function buildPeriodTable(allTxs, activeM) {
  const activeYear = activeM ? activeM.split('-')[0] : new Date().getFullYear().toString();
  // Only months of the active year
  const byMonth = {};
  allTxs.forEach(t => {
    if (t.isTransfer || t.type === 'transfer' || t.type === 'dividend') return;
    const mk = getMonthKey(t.date);
    if (!mk || mk.split('-')[0] !== activeYear) return;
    if (!byMonth[mk]) byMonth[mk] = { in: 0, out: 0 };
    const rv = toRub(t.amount, t.currency);
    if (t.type === 'income') byMonth[mk].in += rv;
    else if (t.type === 'expense') byMonth[mk].out += rv;
  });
  if (!Object.keys(byMonth).length) return '';

  const rows = Object.entries(byMonth).sort((a,b)=>b[0].localeCompare(a[0])).map(([mk,mv])=>{
    const net = mv.in - mv.out; const nc = net>=0?'#a78bfa':'#f87171';
    const isAct = mk === activeM;
    return `<tr data-switch-month="${mk}" style="border-bottom:1px solid rgba(255,255,255,0.04);background:${isAct?'rgba(167,139,250,0.07)':'transparent'};cursor:pointer">
      <td style="padding:10px 16px;font-weight:${isAct?'700':'400'};color:${isAct?'#a78bfa':'#ccc'}">${MONTHS[parseInt(mk.split('-')[1])-1]}${isAct?' ◀':' →'}</td>
      <td class="td-right" style="color:#6ee7b7;padding:10px 16px">${fmt(mv.in)}</td>
      <td class="td-right" style="color:#f87171;padding:10px 16px">${fmt(mv.out)}</td>
      <td class="td-right" style="color:${nc};padding:10px 16px">${fmt(net)}</td>
    </tr>`;
  }).join('');

  // Year total row
  const yearIn  = Object.values(byMonth).reduce((s,v)=>s+v.in,0);
  const yearOut = Object.values(byMonth).reduce((s,v)=>s+v.out,0);
  const yearNet = yearIn - yearOut;
  const ync = yearNet>=0?'#a78bfa':'#f87171';
  const yearRow = `<tr style="border-top:2px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.03)">
    <td style="padding:12px 16px;font-weight:700;color:#fff;font-size:13px">За весь ${activeYear} год</td>
    <td class="td-right" style="color:#6ee7b7;padding:12px 16px;font-weight:700">${fmt(yearIn)}</td>
    <td class="td-right" style="color:#f87171;padding:12px 16px;font-weight:700">${fmt(yearOut)}</td>
    <td class="td-right" style="color:${ync};padding:12px 16px;font-weight:700">${fmt(yearNet)}</td>
  </tr>`;

  return `<div style="overflow-x:auto">
    <table><thead><tr>
      <th>Период</th><th style="text-align:right">Доходы</th><th style="text-align:right">Расходы</th><th style="text-align:right">Прибыль</th>
    </tr></thead><tbody>${rows}${yearRow}</tbody></table>
  </div>`;
}

function pnlHtml() {
  const isMobile = !!document.getElementById('content-root');

  // ── Data ──────────────────────────────────────────────────────────
  const allTxs = monthTxs().filter(t =>
    !t.isTransfer && t.type !== 'transfer' && t.type !== 'dividend' &&
    t.category !== 'Дивиденды собственника' &&
    t.category !== 'Дивиденды партнёру' &&
    t.category !== 'Дивиденды'
  );
  const incomeMap = {}, expenseMap = {};
  allTxs.forEach(t => {
    const rv = toRub(t.amount, t.currency);
    if (t.type === 'income')  incomeMap[t.category]  = (incomeMap[t.category]  || 0) + rv;
    if (t.type === 'expense') expenseMap[t.category] = (expenseMap[t.category] || 0) + rv;
  });
  const totalIncome  = Object.values(incomeMap).reduce((s,v)=>s+v,0);
  const totalExpense = Object.values(expenseMap).reduce((s,v)=>s+v,0);

  const allIncomeCats  = getDirCats('_global','in').filter(c=>c!=='Перевод входящий');
  const allExpenseCats = getDirCats('_global','out').filter(c=>c!=='Перевод исходящий');
  Object.keys(incomeMap).forEach(c => { if (!allIncomeCats.includes(c)) allIncomeCats.push(c); });
  Object.keys(expenseMap).forEach(c => { if (!allExpenseCats.includes(c)) allExpenseCats.push(c); });

  const catModal     = state.showCatEditor    ? catEditorModalHtml()                           : '';
  const partnerModal = state.showPartnerModal  ? partnerPayModalHtml(state.showPartnerModal)    : '';
  const manageModal  = state.showPartnerManage ? partnerManageModalHtml(state.showPartnerManage): '';

  const INC_COLORS = ['#6ee7b7','#a78bfa','#60a5fa','#fbbf24','#34d399','#f472b6','#fb923c','#38bdf8'];
  const EXP_COLORS = ['#f87171','#fb923c','#facc15','#c084fc','#f472b6','#60a5fa','#a78bfa','#34d399'];

  // ── Donut SVG — fix: 1 segment = full circle ───────────────────────
  function buildSegments(catMap, total, colors) {
    return Object.entries(catMap).filter(([,v])=>v>0)
      .sort((a,b)=>b[1]-a[1])
      .map(([cat,val],i) => ({ pct: val/total, color: colors[i%colors.length], cat, val }));
  }

  function svgDonut(segs, total, totalColor, size, r, holeR) {
    const cx = size/2, cy = size/2;
    const bg = '#0d0d1a';
    const totalText = `<circle cx="${cx}" cy="${cy}" r="${holeR}" fill="${bg}"/>
      <text x="${cx}" y="${cy-6}" text-anchor="middle" fill="#555" font-size="10">Итого</text>
      <text x="${cx}" y="${cy+10}" text-anchor="middle" fill="${totalColor}" font-size="11" font-weight="700">${total}</text>`;

    if (!segs.length) return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="${totalColor}" opacity="0.15"/>
      ${totalText}</svg>`;

    // 1 segment — full circle, no pie paths needed
    if (segs.length === 1) return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="${segs[0].color}"/>
      ${totalText}</svg>`;

    let start = 0, paths = '';
    segs.forEach(s => {
      const end = start + s.pct;
      const a1 = (start*360-90)*Math.PI/180;
      const a2 = (end  *360-90)*Math.PI/180;
      const x1 = cx+r*Math.cos(a1), y1 = cy+r*Math.sin(a1);
      const x2 = cx+r*Math.cos(a2), y2 = cy+r*Math.sin(a2);
      paths += `<path d="M ${cx},${cy} L ${x1.toFixed(2)},${y1.toFixed(2)} A ${r},${r} 0 ${s.pct>0.5?1:0},1 ${x2.toFixed(2)},${y2.toFixed(2)} Z" fill="${s.color}"/>`;
      start = end;
    });
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${paths}${totalText}</svg>`;
  }

  // ── Category rows list ─────────────────────────────────────────────
  function catRows(allCats, catMap, total, segs, colors) {
    return [...allCats].sort((a,b)=>(catMap[b]||0)-(catMap[a]||0)).map((cat,i) => {
      const val = catMap[cat]||0;
      const seg = segs.find(s=>s.cat===cat);
      const color = seg ? seg.color : (val ? colors[i%colors.length] : '#333');
      const pct = total>0&&val ? Math.round(val/total*100)+'%' : '';
      const dim = !val;
      return `<div style="display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid rgba(255,255,255,0.04)${dim?';opacity:0.3':''}">
        <span style="width:10px;height:10px;border-radius:50%;background:${dim?'#333':color};flex-shrink:0;display:inline-block"></span>
        <span style="flex:1;font-size:14px;color:${dim?'#3a3a3a':'#ccc'}">${escapeHtml(cat)}</span>
        <span style="font-family:monospace;font-size:13px;font-weight:600;color:${dim?'#2a2a2a':color};flex-shrink:0">${val?fmt(val):'—'}</span>
        <span style="font-size:11px;color:#555;min-width:32px;text-align:right;flex-shrink:0">${pct}</span>
      </div>`;
    }).join('');
  }

  // ── Chart data helpers ─────────────────────────────────────────────
  function lastNMonths(n) {
    const keys = [...new Set(state.transactions.map(t=>getMonthKey(t.date)))].sort();
    return keys.slice(-n);
  }
  function monthTotals(mk) {
    const txs = state.transactions.filter(t =>
      getMonthKey(t.date)===mk && !t.isTransfer && t.type!=='transfer' && t.type!=='dividend' &&
      t.category!=='Дивиденды собственника' && t.category!=='Дивиденды партнёру'
    );
    const MSHORT = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
    const [,m] = mk.split('-');
    return {
      label: MSHORT[parseInt(m)-1],
      inc: txs.filter(t=>t.type==='income').reduce((s,t)=>s+toRub(t.amount,t.currency),0),
      exp: txs.filter(t=>t.type==='expense').reduce((s,t)=>s+toRub(t.amount,t.currency),0)
    };
  }

  // ── Balance area chart ─────────────────────────────────────────────
  function svgBalance(W, H) {
    const txs = [...monthTxs()].filter(t=>t.type==='income'||t.type==='expense').sort((a,b)=>a.date.localeCompare(b.date));
    if (txs.length < 2) return `<p style="text-align:center;color:#444;padding:36px 0;font-size:13px">Недостаточно данных</p>`;
    const dm = {};
    txs.forEach(t => { const rv=toRub(t.amount,t.currency); dm[t.date]=(dm[t.date]||0)+(t.type==='income'?rv:-rv); });
    const dates=Object.keys(dm).sort(); let run=0;
    const pts=dates.map(d=>{run+=dm[d];return{d,v:run};});
    const vals=pts.map(p=>p.v), minV=Math.min(...vals), maxV=Math.max(...vals), rng=maxV-minV||1;
    const pL=22,pR=10,pT=22,pB=16, vW=W-pL-pR, vH=H-pT-pB;
    const px=i=>pL+i*(vW/(pts.length-1||1));
    const py=v=>pT+(1-(v-minV)/rng)*vH;
    const line=pts.map((p,i)=>(i?'L':'M')+px(i).toFixed(1)+','+py(p.v).toFixed(1)).join(' ');
    const fill=line+` L${px(pts.length-1).toFixed(1)},${H-pB} L${pL},${H-pB} Z`;
    const uid='b'+Math.random().toString(36).slice(2,6);
    // Y labels
    const fmtK=v=>{const a=Math.abs(v);return a>=1e6?(v/1e6).toFixed(1)+'M':a>=1e3?Math.round(v/1e3)+'K':Math.round(v)+'';};
    const yL=[maxV,(maxV+minV)/2,minV].map(v=>`<text x="${pL-2}" y="${py(v)+3}" fill="#3a3a3a" font-size="8" text-anchor="end">${fmtK(v)}</text>`).join('');
    // X labels — 5 evenly spaced
    const step=Math.max(1,Math.floor((pts.length-1)/4));
    const xi=[0,step,step*2,step*3,pts.length-1].filter((v,i,a)=>a.indexOf(v)===i&&v<pts.length);
    const xL=xi.map(i=>`<text x="${px(i).toFixed(1)}" y="${H+3}" text-anchor="middle" fill="#444" font-size="9">${pts[i].d.slice(5)}</text>`).join('');
    // Dots
    const dots=xi.map(i=>`<circle cx="${px(i).toFixed(1)}" cy="${py(pts[i].v).toFixed(1)}" r="4" fill="#a78bfa" stroke="#0a0a14" stroke-width="2" style="cursor:pointer"
      onclick="var t=document.getElementById('tt_${uid}');t.style.display='block';t.innerHTML='<div style=font-size:10px;color:#666;margin-bottom:2px>${pts[i].d}</div>${escapeHtml(fmt(pts[i].v))}'"/>
      <circle cx="${px(i).toFixed(1)}" cy="${py(pts[i].v).toFixed(1)}" r="8" fill="rgba(167,139,250,0.2)"/>`).join('');
    return `<div style="position:relative">
<svg width="100%" height="${H+16}" viewBox="0 0 ${W} ${H+16}" style="overflow:visible">
  <defs><linearGradient id="g${uid}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#a78bfa" stop-opacity="0.3"/>
    <stop offset="100%" stop-color="#a78bfa" stop-opacity="0"/>
  </linearGradient></defs>
  <line x1="${pL}" y1="${pT}" x2="${W-pR}" y2="${pT}" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>
  <line x1="${pL}" y1="${pT+vH/2}" x2="${W-pR}" y2="${pT+vH/2}" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>
  <line x1="${pL}" y1="${H-pB}" x2="${W-pR}" y2="${H-pB}" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>
  ${yL}
  <path d="${fill}" fill="url(#g${uid})"/>
  <path d="${line}" fill="none" stroke="#a78bfa" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
  ${dots}${xL}
</svg>
<div id="tt_${uid}" style="display:none;position:absolute;top:4px;right:4px;background:#1a1a2e;border:1px solid rgba(255,255,255,0.15);border-radius:10px;padding:7px 12px;font-size:12px;font-weight:600;color:#a78bfa;pointer-events:none;white-space:nowrap;box-shadow:0 4px 20px rgba(0,0,0,0.5)"></div>
</div>`;
  }

  // ── Line chart (income vs expense) ────────────────────────────────
  function svgLine(W, H) {
    const months=lastNMonths(6); if(!months.length) return `<p style="text-align:center;color:#444;padding:36px 0;font-size:13px">Нет данных</p>`;
    const data=months.map(monthTotals);
    const pL=10,pR=10,pT=20,pB=16, vW=W-pL-pR, vH=H-pT-pB;
    const maxV=Math.max(...data.map(d=>Math.max(d.inc,d.exp)),1);
    const n=data.length;
    const px=i=>pL+i*(vW/(n-1||1)); const py=v=>pT+(1-v/maxV)*vH;
    const iL=data.map((d,i)=>(i?'L':'M')+px(i).toFixed(1)+','+py(d.inc).toFixed(1)).join(' ');
    const eL=data.map((d,i)=>(i?'L':'M')+px(i).toFixed(1)+','+py(d.exp).toFixed(1)).join(' ');
    const iF=iL+` L${px(n-1).toFixed(1)},${H-pB} L${pL},${H-pB} Z`;
    const eF=eL+` L${px(n-1).toFixed(1)},${H-pB} L${pL},${H-pB} Z`;
    const uid='l'+Math.random().toString(36).slice(2,6);
    const dots=data.map((d,i)=>`
      <circle cx="${px(i).toFixed(1)}" cy="${py(d.inc).toFixed(1)}" r="3.5" fill="#6ee7b7" stroke="#0a0a14" stroke-width="2" style="cursor:pointer"
        onclick="var t=document.getElementById('tt_${uid}');t.style.display='block';t.innerHTML='<div class=tdate>${escapeHtml(d.label)}</div><span style=color:#6ee7b7>&#8593; ${escapeHtml(fmt(d.inc))}</span><br><span style=color:#f87171>&#8595; ${escapeHtml(fmt(d.exp))}</span>'"/>
      <circle cx="${px(i).toFixed(1)}" cy="${py(d.exp).toFixed(1)}" r="3.5" fill="#f87171" stroke="#0a0a14" stroke-width="2" style="cursor:pointer"
        onclick="var t=document.getElementById('tt_${uid}');t.style.display='block';t.innerHTML='<div class=tdate>${escapeHtml(d.label)}</div><span style=color:#6ee7b7>&#8593; ${escapeHtml(fmt(d.inc))}</span><br><span style=color:#f87171>&#8595; ${escapeHtml(fmt(d.exp))}</span>'"/ >`).join('');
    const xL=data.map((d,i)=>`<text x="${px(i).toFixed(1)}" y="${H+3}" text-anchor="middle" fill="#444" font-size="9">${d.label}</text>`).join('');
    // cursor line at last point
    const lastX=px(n-1).toFixed(1);
    return `<div style="position:relative">
<svg width="100%" height="${H+16}" viewBox="0 0 ${W} ${H+16}" style="overflow:visible">
  <defs>
    <linearGradient id="gi${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#6ee7b7" stop-opacity="0.2"/><stop offset="100%" stop-color="#6ee7b7" stop-opacity="0"/></linearGradient>
    <linearGradient id="ge${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#f87171" stop-opacity="0.15"/><stop offset="100%" stop-color="#f87171" stop-opacity="0"/></linearGradient>
  </defs>
  <line x1="${pL}" y1="${pT}" x2="${W-pR}" y2="${pT}" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>
  <line x1="${pL}" y1="${pT+vH/2}" x2="${W-pR}" y2="${pT+vH/2}" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>
  <line x1="${pL}" y1="${H-pB}" x2="${W-pR}" y2="${H-pB}" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>
  <path d="${iF}" fill="url(#gi${uid})"/>
  <path d="${eF}" fill="url(#ge${uid})"/>
  <path d="${iL}" fill="none" stroke="#6ee7b7" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
  <path d="${eL}" fill="none" stroke="#f87171" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
  <line x1="${lastX}" y1="${pT-5}" x2="${lastX}" y2="${H-pB}" stroke="rgba(255,255,255,0.1)" stroke-width="1" stroke-dasharray="4 3"/>
  ${dots}${xL}
</svg>
<div id="tt_${uid}" style="display:none;position:absolute;top:8px;right:4px;background:#1a1a2e;border:1px solid rgba(255,255,255,0.15);border-radius:10px;padding:7px 12px;font-size:12px;color:#fff;line-height:1.6;pointer-events:none;white-space:nowrap;box-shadow:0 4px 20px rgba(0,0,0,0.5)"><style scoped>.tdate{font-size:10px;color:#666;margin-bottom:2px}</style></div>
</div>`;
  }

  // ── Bar chart ──────────────────────────────────────────────────────
  function svgBar(W, H) {
    const months=lastNMonths(6); if(!months.length) return `<p style="text-align:center;color:#444;padding:36px 0;font-size:13px">Нет данных</p>`;
    const data=months.map(monthTotals);
    const pL=10,pR=10,pT=20,pB=16, vW=W-pL-pR, vH=H-pT-pB;
    const maxV=Math.max(...data.map(d=>Math.max(d.inc,d.exp)),1);
    const n=data.length, slotW=vW/n, bW=Math.min(slotW*0.32,18);
    const uid='r'+Math.random().toString(36).slice(2,6);
    // Find current month
    const curMk = state.activeMonth || getMonthKey(new Date().toISOString().slice(0,10));
    const bars=data.map((d,i)=>{
      const mk=lastNMonths(6)[i];
      const isCur=mk===curMk;
      const cx=pL+i*slotW+slotW/2;
      const iH=(d.inc/maxV)*vH, eH=(d.exp/maxV)*vH;
      const oc=`onclick="var t=document.getElementById('tt_${uid}');t.style.display='block';t.innerHTML='<div style=font-size:10px;color:#666;margin-bottom:2px>${escapeHtml(d.label)}</div><span style=color:#6ee7b7>&#8593; ${escapeHtml(fmt(d.inc))}</span><br><span style=color:#f87171>&#8595; ${escapeHtml(fmt(d.exp))}</span>'"`;
      return `
        <rect x="${(cx-bW-1).toFixed(1)}" y="${(pT+vH-iH).toFixed(1)}" width="${bW}" height="${iH.toFixed(1)}" rx="4" fill="#6ee7b7" opacity="${isCur?'1':'0.7'}" style="cursor:pointer" ${oc}/>
        <rect x="${(cx+1).toFixed(1)}" y="${(pT+vH-eH).toFixed(1)}" width="${bW}" height="${eH.toFixed(1)}" rx="4" fill="#f87171" opacity="${isCur?'1':'0.7'}" style="cursor:pointer" ${oc}/>
        <text x="${cx.toFixed(1)}" y="${H+3}" text-anchor="middle" fill="${isCur?'#aaa':'#444'}" font-size="${isCur?'10':'9'}" font-weight="${isCur?'700':'400'}">${d.label}</text>`;
    }).join('');
    return `<div style="position:relative">
<svg width="100%" height="${H+16}" viewBox="0 0 ${W} ${H+16}" style="overflow:visible">
  <line x1="${pL}" y1="${pT}" x2="${W-pR}" y2="${pT}" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>
  <line x1="${pL}" y1="${pT+vH/2}" x2="${W-pR}" y2="${pT+vH/2}" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>
  <line x1="${pL}" y1="${H-pB}" x2="${W-pR}" y2="${H-pB}" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>
  ${bars}
</svg>
<div id="tt_${uid}" style="display:none;position:absolute;top:4px;right:4px;background:#1a1a2e;border:1px solid rgba(255,255,255,0.15);border-radius:10px;padding:7px 12px;font-size:12px;color:#fff;line-height:1.6;pointer-events:none;white-space:nowrap;box-shadow:0 4px 20px rgba(0,0,0,0.5)"></div>
</div>`;
  }

  // ── Section wrappers — exact mockup style ─────────────────────────
  // chart-section: background rgba(255,255,255,0.02), border rgba(255,255,255,0.06), border-radius 18px
  const CS = 'background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:18px;overflow:hidden;margin-bottom:14px';

  function chartHeader(title, gearType) {
    const gear = gearType
      ? `<button data-cat-edit="_global" data-cat-type="${gearType}" style="width:28px;height:28px;border-radius:8px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.04);color:#555;cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center;flex-shrink:0">⚙</button>`
      : '';
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px 0">${title}${gear}</div>`;
  }

  function chartTitleSpan(label, dotColor) {
    const dot = dotColor ? `<span style="width:10px;height:10px;border-radius:50%;background:${dotColor};display:inline-block;flex-shrink:0"></span> ` : '';
    return `<span style="font-size:13px;font-weight:700;color:#ccc;text-transform:uppercase;letter-spacing:0.06em">${dot}${label}</span>`;
  }

  function legendBar(items) {
    return `<div style="display:flex;gap:16px;padding:6px 16px 0">${items.map(([c,l])=>`<span style="display:flex;align-items:center;gap:6px;font-size:11px;color:#888"><span style="width:8px;height:8px;border-radius:50%;background:${c};display:inline-block"></span>${l}</span>`).join('')}</div>`;
  }

  function chartWrapDiv(inner) {
    return `<div style="padding:12px 16px 16px;position:relative">${inner}</div>`;
  }

  function totalFooter(val, color) {
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-top:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.02)">
      <span style="font-size:13px;font-weight:700;color:#888">Итого</span>
      <span style="font-size:15px;font-weight:700;font-family:monospace;color:${color}">${fmt(val)}</span>
    </div>`;
  }

  // ── Donut + list block ─────────────────────────────────────────────
  function donutBlock(allCats, catMap, total, colors, accent, label, catType, size, r, holeR, isMob) {
    const segs = buildSegments(catMap, total, colors);
    const donut = svgDonut(segs, fmt(total), accent, size, r, holeR);
    const rows  = catRows(allCats, catMap, total, segs, colors);
    const hdr   = chartHeader(chartTitleSpan(label, accent), catType);
    if (isMob) {
      return `<div style="${CS}">
        ${hdr}
        <div style="display:flex;justify-content:center;padding:16px 16px 12px">${donut}</div>
        <div style="height:1px;background:rgba(255,255,255,0.05);margin:0 16px"></div>
        <div style="height:280px;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain">${rows}</div>
        ${totalFooter(total, accent)}
      </div>`;
    }
    return `<div style="${CS};margin-bottom:0">
      ${hdr}
      <div style="display:flex;align-items:flex-start;padding:14px 16px;gap:0">
        <div style="flex-shrink:0">${donut}</div>
        <div style="flex:1;overflow-y:auto;max-height:200px;padding-left:14px">${rows}</div>
      </div>
      ${totalFooter(total, accent)}
    </div>`;
  }

  // ── MOBILE ─────────────────────────────────────────────────────────
  if (isMobile) {
    const balHtml  = `<div style="${CS}">${chartHeader(chartTitleSpan('График баланса',null), null)}${chartWrapDiv(svgBalance(340,140))}</div>`;
    const incHtml  = donutBlock(allIncomeCats, incomeMap, totalIncome, INC_COLORS, '#6ee7b7', 'Доходы по категориям', 'in', 180, 75, 46, true);
    const expHtml  = donutBlock(allExpenseCats, expenseMap, totalExpense, EXP_COLORS, '#f87171', 'Расходы по категориям', 'out', 180, 75, 46, true);
    const lineHtml = `<div style="${CS}">${chartHeader(chartTitleSpan('Линейный график',null), null)}${legendBar([['#6ee7b7','Доходы'],['#f87171','Расходы']])}${chartWrapDiv(svgLine(340,130))}</div>`;
    const barHtml  = `<div style="${CS}">${chartHeader(chartTitleSpan('Столбчатая диаграмма',null), null)}${legendBar([['#6ee7b7','Доходы'],['#f87171','Расходы']])}${chartWrapDiv(svgBar(340,130))}</div>`;
    return `<div style="padding:16px 16px 80px">${balHtml}${incHtml}${expHtml}${lineHtml}${barHtml}${catModal}${partnerModal}${manageModal}</div>`;
  }

  // ── DESKTOP ────────────────────────────────────────────────────────
  const incHtml  = donutBlock(allIncomeCats, incomeMap, totalIncome, INC_COLORS, '#6ee7b7', 'Доходы по категориям', 'in', 160, 68, 42, false);
  const expHtml  = donutBlock(allExpenseCats, expenseMap, totalExpense, EXP_COLORS, '#f87171', 'Расходы по категориям', 'out', 160, 68, 42, false);
  const balHtml  = `<div style="${CS};margin-bottom:0">${chartHeader(chartTitleSpan('График баланса',null), null)}${chartWrapDiv(svgBalance(340,150))}</div>`;
  const lineHtml = `<div style="${CS};margin-bottom:0">${chartHeader(chartTitleSpan('Линейный график',null), null)}${legendBar([['#6ee7b7','Доходы'],['#f87171','Расходы']])}${chartWrapDiv(svgLine(340,130))}</div>`;
  const barHtml  = `<div style="${CS};margin-bottom:0">${chartHeader(chartTitleSpan('Столбчатая диаграмма',null), null)}${legendBar([['#6ee7b7','Доходы'],['#f87171','Расходы']])}${chartWrapDiv(svgBar(340,130))}</div>`;
  return `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">${incHtml}${expHtml}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px">${balHtml}${lineHtml}${barHtml}</div>
    ${catModal}${partnerModal}${manageModal}`;
}


// ── FUNDS ──
function fundsHtml() {
  const totalFunds = Object.values(state.funds).reduce((s,f) => s + f.balance, 0);

  const fundCards = Object.entries(state.funds).map(([k,f]) => `
    <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:16px;padding:24px;flex:1;min-width:200px">
      <div style="font-size:28px;margin-bottom:8px">${f.icon}</div>
      <div style="font-size:14px;color:#888;margin-bottom:6px">${f.name}</div>
      <div style="font-size:24px;font-weight:700;font-family:monospace;color:${f.color}">${fmt(f.balance)}</div>
      <div style="margin-top:16px;display:flex;gap:8px">
        <button data-fund-action="in" data-fund-key="${k}" style="flex:1;padding:8px;border-radius:8px;border:1px solid rgba(110,231,183,0.3);background:rgba(110,231,183,0.07);color:#6ee7b7;cursor:pointer;font-size:13px">+ Пополнить</button>
        <button data-fund-action="out" data-fund-key="${k}" style="flex:1;padding:8px;border-radius:8px;border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.07);color:#f87171;cursor:pointer;font-size:13px">− Вывести</button>
      </div>
    </div>`).join('');

  const history = [...state.fundHistory].sort((a,b) => new Date(b.date)-new Date(a.date));
  const histRows = history.length === 0
    ? `<div class="empty">Нет операций по фондам</div>`
    : history.slice(0,50).map(h => {
        const f = state.funds[h.fund] || {};
        const sign = h.type === 'in' ? '+' : '-';
        const col  = h.type === 'in' ? '#6ee7b7' : '#f87171';
        return `<div class="tx-item">
          <div class="tx-icon ${h.type==='in'?'tx-icon-in':'tx-icon-out'}">${h.type==='in'?'💚':'🔴'}</div>
          <div class="tx-info">
            <div class="tx-cat">${f.icon||''} ${f.name||h.fund}${h.note?' · '+h.note:''}</div>
            <div class="tx-meta">${h.date}</div>
          </div>
          <div class="tx-amount"><div class="main" style="color:${col}">${sign}${fmt(h.amount)}</div></div>
        </div>`;
      }).join('');

  return `
    <div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:24px">${fundCards}</div>
    <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:16px;overflow:hidden">
      <div style="padding:16px 24px;border-bottom:1px solid rgba(255,255,255,0.07);display:flex;justify-content:space-between;align-items:center">
        <span style="font-weight:700;font-size:15px">История пополнений</span>
        <span style="font-size:13px;color:#a78bfa">Итого в фондах: ${fmt(totalFunds)}</span>
      </div>
      <div style="padding:16px">${histRows}</div>
    </div>
    ${state.showFundModal ? fundModalHtml() : ''}`;
}

function addDirModalHtml() {
  const f = state.addDirForm;
  const colors = ['#6ee7b7','#93c5fd','#fbbf24','#f87171','#a78bfa','#fb923c','#34d399','#e879f9'];
  return `
    <div class="modal-bg" id="add-dir-modal-bg">
      <div id="add-dir-inner" class="modal" style="max-width:420px">
        <div class="modal-header">
          <span class="modal-title">+ Новое направление</span>
          <button class="modal-close" id="add-dir-close">×</button>
        </div>
        <div class="form-grid">
          <div style="display:grid;grid-template-columns:48px 1fr;gap:10px;align-items:end">
            <div>
              <div class="form-label">Эмодзи</div>
              <input type="text" class="form-inp" id="ndir-icon" value="${f.icon}" style="text-align:center;font-size:20px;padding:8px">
            </div>
            <div>
              <div class="form-label">Название</div>
              <input type="text" class="form-inp" id="ndir-label" placeholder="Например: Новый проект" value="${f.label}">
            </div>
          </div>
          <div style="padding:10px 14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:10px;font-size:12px;color:#555">
            После создания добавьте партнёров в ОПиУ → 🤝 Партнёрские отчисления
          </div>
          <div>
            <div class="form-label">Цвет</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              ${colors.map(c=>`<div data-ndir-color="${c}" style="width:28px;height:28px;border-radius:50%;background:${c};cursor:pointer;border:3px solid ${f.color===c?'#fff':'transparent'}"></div>`).join('')}
            </div>
          </div>
          <button class="btn-submit" id="btn-ndir-submit">Создать направление</button>
        </div>
      </div>
    </div>`;
}

function editDirModalHtml() {
  const k = state.editDirKey;
  const d = DIRECTIONS[k] || {};
  const colors = ['#6ee7b7','#93c5fd','#fbbf24','#f87171','#a78bfa','#fb923c','#34d399','#e879f9'];
  const linkedAccounts = Object.entries(state.accounts).filter(([,a])=>a.direction===k);
  const allAccounts = getOrderedAccounts().map(k => [k, state.accounts[k]]);
  return `
    <div class="modal-bg" id="edit-dir-modal-bg">
      <div id="edit-dir-inner" class="modal" style="max-width:440px">
        <div class="modal-header">
          <span class="modal-title">⚙️ Настройки направления</span>
          <button class="modal-close" id="edit-dir-close">×</button>
        </div>
        <div class="form-grid">
          <div style="display:grid;grid-template-columns:48px 1fr;gap:10px;align-items:end">
            <div>
              <div class="form-label">Эмодзи</div>
              <input type="text" class="form-inp" id="edir-icon" value="${d.icon||'🏢'}" style="text-align:center;font-size:20px;padding:8px">
            </div>
            <div>
              <div class="form-label">Название</div>
              <input type="text" class="form-inp" id="edir-label" value="${d.label||''}">
            </div>
          </div>
          <!-- Partners managed via 🤝 section in P&L -->
          <div style="padding:10px 14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:10px;font-size:12px;color:#555">
            Партнёры настраиваются в разделе ОПиУ → 🤝 Партнёрские отчисления
          </div>
          <div>
            <div class="form-label">Цвет</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              ${colors.map(c=>`<div data-edir-color="${c}" style="width:28px;height:28px;border-radius:50%;background:${c};cursor:pointer;border:3px solid ${(d.color||'')===c?'#fff':'transparent'}"></div>`).join('')}
            </div>
          </div>
          <div>
            <div class="form-label">Привязанные счета</div>
            <div style="display:flex;flex-direction:column;gap:6px;max-height:160px;overflow-y:auto">
              ${allAccounts.map(([ak,a])=>{
                const isOwn     = a.direction === k;
                const takenBy   = !isOwn && a.direction ? DIRECTIONS[a.direction] : null;
                const disabled  = takenBy ? 'disabled' : '';
                const labelColor = takenBy ? '#444' : '#ccc';
                const hint = takenBy ? `<span style="font-size:11px;color:#555;margin-left:4px">→ ${takenBy.icon} ${takenBy.label}</span>` : '';
                return `
                <label style="display:flex;align-items:center;gap:8px;cursor:${takenBy?'not-allowed':'pointer'};font-size:13px;color:${labelColor}" title="${takenBy?'Уже привязан к: '+takenBy.label:''}">
                  <input type="checkbox" data-edir-acc="${ak}" ${isOwn?'checked':''} ${disabled} style="accent-color:#a78bfa;cursor:${takenBy?'not-allowed':'pointer'}">
                  ${a.name}${hint}
                </label>`;
              }).join('')}
            </div>
          </div>
          <button class="btn-submit" id="btn-edir-save">Сохранить</button>
          <button id="btn-edir-delete" style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:10px;padding:10px;color:#f87171;cursor:pointer;font-size:14px;width:100%">🗑 Удалить направление</button>
        </div>
      </div>
    </div>`;
}

function addAccModalHtml() {
  const f = state.addAccForm;
  return `
    <div class="modal-bg" id="add-acc-modal-bg">
      <div id="m-add-acc-inner" class="modal" style="max-width:420px">
        <div class="modal-header">
          <span class="modal-title">+ Новый счёт</span>
          <button class="modal-close" id="add-acc-close">×</button>
        </div>
        <div class="form-grid">
          <div style="display:grid;grid-template-columns:48px 1fr;gap:10px;align-items:end">
            <div>
              <div class="form-label">Эмодзи</div>
              <input type="text" class="form-inp" id="nacc-emoji" value="${f.emoji}" style="text-align:center;font-size:20px;padding:8px">
            </div>
            <div>
              <div class="form-label">Название счёта</div>
              <input type="text" class="form-inp" id="nacc-name" placeholder="Например: Сбербанк RUB" value="${f.name}">
            </div>
          </div>
          <div>
            <div class="form-label">Валюта</div>
            <select class="form-inp" id="nacc-currency">
              ${(state.enabledCurrencies||['RUB','SAR','USDT']).map(c => `<option value="${c}" ${f.currency===c?'selected':''}>${c}</option>`).join('')}
            </select>
          </div>
          <div>
            <div class="form-label">Цвет метки</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              ${['#6ee7b7','#93c5fd','#fbbf24','#f87171','#a78bfa','#fb923c','#34d399','#e879f9'].map(c=>`
                <div data-nacc-color="${c}" style="width:28px;height:28px;border-radius:50%;background:${c};cursor:pointer;border:3px solid ${f.color===c?'#fff':'transparent'}"></div>`).join('')}
            </div>
          </div>
          <button class="btn-submit" id="btn-nacc-submit">Создать счёт</button>
        </div>
      </div>
    </div>`;
}

function editAccModalHtml() {
  const k = state.editAccKey;
  const a = state.accounts[k] || {};
  const emoji = a.name?.match(/^(\S+\s)/)?.[1]?.trim() || '💳';
  const nameOnly = a.name?.replace(/^\S+\s/, '') || a.name || '';
  return `
    <div class="modal-bg" id="edit-acc-modal-bg">
      <div id="m-edit-acc-inner" class="modal" style="max-width:420px">
        <div class="modal-header">
          <span class="modal-title">⚙️ Настройки счёта</span>
          <button class="modal-close" id="edit-acc-close">×</button>
        </div>
        <div class="form-grid">
          <div style="display:grid;grid-template-columns:48px 1fr;gap:10px;align-items:end">
            <div>
              <div class="form-label">Эмодзи</div>
              <input type="text" class="form-inp" id="eacc-emoji" value="${emoji}" style="text-align:center;font-size:20px;padding:8px">
            </div>
            <div>
              <div class="form-label">Название</div>
              <input type="text" class="form-inp" id="eacc-name" value="${nameOnly}">
            </div>
          </div>
          <div>
            <div class="form-label">Валюта</div>
            <select class="form-inp" id="eacc-currency">
              <option ${a.currency==='RUB'?'selected':''}>RUB</option>
              <option ${a.currency==='SAR'?'selected':''}>SAR</option>
              <option ${a.currency==='USDT'?'selected':''}>USDT</option>
            </select>
          </div>
          <div>
            <div class="form-label">Цвет метки</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              ${['#6ee7b7','#93c5fd','#fbbf24','#f87171','#a78bfa','#fb923c','#34d399','#e879f9'].map(c=>`
                <div data-eacc-color="${c}" style="width:28px;height:28px;border-radius:50%;background:${c};cursor:pointer;border:3px solid ${(a.color||'')===c?'#fff':'transparent'}"></div>`).join('')}
            </div>
          </div>
          <button class="btn-submit" id="btn-eacc-save">Сохранить</button>
          <button id="btn-eacc-delete" ${Math.abs(a.balance||0) > 0.001 ? 'disabled title="Обнули баланс перед удалением" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:10px;color:#444;cursor:not-allowed;font-size:14px;width:100%"' : 'style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:10px;padding:10px;color:#f87171;cursor:pointer;font-size:14px;width:100%"'}>🗑 Удалить счёт${Math.abs(a.balance||0) > 0.001 ? ' (баланс: ' + fmt(a.balance, a.currency) + ')' : ''}</button>
        </div>
      </div>
    </div>`;
}

function accModalHtml() {
  const f = state.accForm;
  const fromAcc = state.accounts[f.fromKey] || {};
  const otherAccounts = Object.entries(state.accounts).filter(([k]) => k !== f.fromKey);
  const today = state.activeMonth ? `${state.activeMonth}-${new Date().getDate().toString().padStart(2,'0')}` : _localDateStr();
  return `
    <div class="modal-bg" id="acc-modal-bg">
      <div id="acc-modal-inner" class="modal" style="max-width:440px">
        <div class="modal-header">
          <span class="modal-title">🔄 Перевод</span>
          <button class="modal-close" id="acc-modal-close">×</button>
        </div>
        <div class="form-grid">
          <div>
            <div class="form-label">🟡 Откуда (списать)</div>
            <div style="padding:10px 14px;background:rgba(251,191,36,0.07);border:1px solid rgba(251,191,36,0.2);border-radius:10px;font-size:14px;color:#fbbf24">${fromAcc.name||''} · ${fromAcc.currency||''}</div>
          </div>
          <div>
            <div class="form-label">🔵 Куда (зачислить)</div>
            <select class="form-inp" id="af-to">
              ${allAccAndFundOptionsExcept(f.account||'', f.toKey)}
            </select>
          </div>
          <div>
            <div class="form-label">Дата</div>
            <input type="date" class="form-inp" id="af-date" value="${today}">
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div>
              <div class="form-label">Сумма списания (${fromAcc.currency||'RUB'})</div>
              <input type="number" placeholder="0" class="form-inp" id="af-from-amount" class="form-inp amount-inp" autofocus>
            </div>
            <div>
              <div class="form-label">Сумма зачисления</div>
              <input type="number" placeholder="если другая валюта" class="form-inp" id="af-to-amount" class="form-inp amount-inp">
            </div>
          </div>
          <div style="font-size:12px;color:#888;margin-top:-8px">Если валюта одинаковая — второе поле не заполняй</div>
          <div>
            <div class="form-label">Категория перевода</div>
            <select class="form-inp" id="af-category">
              ${CATEGORIES_DDS.map(cat => `<option value="${cat}">${cat}</option>`).join('')}
            </select>
          </div>
          <div>
            <div class="form-label">Комментарий</div>
            <input type="text" placeholder="Необязательно..." class="form-inp" id="af-note">
          </div>
          <button class="btn-submit" id="btn-acc-submit">✓ Создать перевод</button>
        </div>
      </div>
    </div>`;
}

function addFundModalHtml() {
  const f = state.addFundForm;
  const colors = ['#6ee7b7','#93c5fd','#fbbf24','#f87171','#a78bfa','#fb923c','#34d399','#e879f9'];
  return `
    <div class="modal-bg" id="add-fund-modal-bg">
      <div id="m-add-fund-inner" class="modal" style="max-width:400px">
        <div class="modal-header">
          <span class="modal-title">+ Новый фонд</span>
          <button class="modal-close" id="add-fund-close">×</button>
        </div>
        <div class="form-grid">
          <div style="display:grid;grid-template-columns:48px 1fr;gap:10px;align-items:end">
            <div>
              <div class="form-label">Эмодзи</div>
              <input type="text" class="form-inp" id="nfund-emoji" value="${f.emoji}" style="text-align:center;font-size:20px;padding:8px">
            </div>
            <div>
              <div class="form-label">Название</div>
              <input type="text" class="form-inp" id="nfund-name" placeholder="Например: Резервный фонд" value="${f.name}">
            </div>
          </div>
          <div>
            <div class="form-label">Валюта</div>
            <select class="form-inp" id="nfund-currency">
              <option ${f.currency==='RUB'?'selected':''}>RUB</option>
              <option ${f.currency==='SAR'?'selected':''}>SAR</option>
              <option ${f.currency==='USDT'?'selected':''}>USDT</option>
            </select>
          </div>
          <div>
            <div class="form-label">Цвет</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              ${colors.map(c=>`<div data-nfund-color="${c}" style="width:28px;height:28px;border-radius:50%;background:${c};cursor:pointer;border:3px solid ${f.color===c?'#fff':'transparent'}"></div>`).join('')}
            </div>
          </div>
          <button class="btn-submit" id="btn-nfund-submit">Создать фонд</button>
        </div>
      </div>
    </div>`;
}

function editFundModalHtml() {
  const k = state.editFundKey;
  const f = state.funds[k] || {};
  const colors = ['#6ee7b7','#93c5fd','#fbbf24','#f87171','#a78bfa','#fb923c','#34d399','#e879f9'];
  return `
    <div class="modal-bg" id="edit-fund-modal-bg">
      <div id="m-edit-fund-inner" class="modal" style="max-width:400px">
        <div class="modal-header">
          <span class="modal-title">⚙️ Настройки фонда</span>
          <button class="modal-close" id="edit-fund-close">×</button>
        </div>
        <div class="form-grid">
          <div style="display:grid;grid-template-columns:48px 1fr;gap:10px;align-items:end">
            <div>
              <div class="form-label">Эмодзи</div>
              <input type="text" class="form-inp" id="efund-emoji" value="${f.icon||'💰'}" style="text-align:center;font-size:20px;padding:8px">
            </div>
            <div>
              <div class="form-label">Название</div>
              <input type="text" class="form-inp" id="efund-name" value="${f.name||''}">
            </div>
          </div>
          <div>
            <div class="form-label">Валюта</div>
            <select class="form-inp" id="efund-currency">
              <option ${(f.currency||'RUB')==='RUB'?'selected':''}>RUB</option>
              <option ${(f.currency||'')==='SAR'?'selected':''}>SAR</option>
              <option ${(f.currency||'')==='USDT'?'selected':''}>USDT</option>
            </select>
          </div>
          <div>
            <div class="form-label">Цвет</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              ${colors.map(c=>`<div data-efund-color="${c}" style="width:28px;height:28px;border-radius:50%;background:${c};cursor:pointer;border:3px solid ${(f.color||'')===c?'#fff':'transparent'}"></div>`).join('')}
            </div>
          </div>
          <button class="btn-submit" id="btn-efund-save">Сохранить</button>
          <button id="btn-efund-delete" ${Math.abs(f.balance||0) > 0.001 ? 'disabled title="Выведи средства перед удалением" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:10px;color:#444;cursor:not-allowed;font-size:14px;width:100%"' : 'style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:10px;padding:10px;color:#f87171;cursor:pointer;font-size:14px;width:100%"'}>🗑 Удалить фонд${Math.abs(f.balance||0) > 0.001 ? ' (баланс: ' + fmt(f.balance, f.currency||'RUB') + ')' : ''}</button>
        </div>
      </div>
    </div>`;
}

function fundModalHtml() {
  const f = state.fundForm;
  const allAccounts = getOrderedAccounts().map(k => [k, state.accounts[k]]);
  return `
    <div class="modal-bg" id="fund-modal-bg">
      <div id="fund-modal-inner" class="modal" style="max-width:420px">
        <div class="modal-header">
          <span class="modal-title">${f.type==='in'?'💚 Пополнить фонд':'🔴 Вывести из фонда'}</span>
          <button class="modal-close" id="fund-modal-close">×</button>
        </div>
        <div class="form-grid">
          <div>
            <div class="form-label">Фонд</div>
            <select class="form-inp" id="ff-fund" onchange="(function(){state.fundForm.fund=this.value;var accSel=document.getElementById('ff-account');if(accSel)accSel.innerHTML=allAccAndFundOptionsExcept('fund:'+this.value,accSel.value);}).call(this)">
              ${Object.entries(state.funds).map(([k,fd])=>`<option value="${k}" ${f.fund===k?'selected':''}>${fd.icon} ${escapeHtml(fd.name)}</option>`).join('')}
            </select>
          </div>
          <div>
            <div class="form-label">${f.type==='in'?'Списать со счёта':'Вернуть на счёт'}</div>
            <select class="form-inp" id="ff-account">
              ${allAccAndFundOptionsExcept('fund:' + f.fund, f.account)}
            </select>
          </div>
          <div>
            <div class="form-label">Дата</div>
            <input type="date" class="form-inp" id="ff-date" value="${f.date||_localDateStr()}">
          </div>
          <div>
            <div class="form-label">Сумма (RUB)</div>
            <input type="text" inputmode="decimal" placeholder="0" class="form-inp amount-inp" id="ff-amount" value="${f.amount}">
          </div>
          <div>
            <div class="form-label">Комментарий</div>
            <input type="text" placeholder="Необязательно..." class="form-inp" id="ff-note" value="${f.note}">
          </div>
          <button class="btn-submit" id="btn-fund-submit">${f.type==='in'?'Пополнить':'Вывести'}</button>
        </div>
      </div>
    </div>`;
}

// ── ANALYTICS ──
function analyticsHtml() {
  const md = monthlyData();
  if (md.length === 0) return `<div class="empty">Добавьте операции для отображения аналитики</div>`;
  const accCards = getOrderedAccounts().map(k => {
    const a = state.accounts[k];
    const color = a.color || '#a78bfa';
    return `<div class="card"><div class="card-header"><span class="card-title">${escapeHtml(a.name)}</span></div><div class="chart-wrap"><canvas id="chart-acc-${k}" height="200"></canvas></div></div>`;
  }).join('');
  return `
    <div class="card"><div class="card-header"><span class="card-title">Чистый денежный поток по месяцам</span></div><div class="chart-wrap"><canvas id="chart-line" height="220"></canvas></div></div>
    <div class="two-col-equal">
      ${accCards}
    </div>`;
}

// ── MODAL ──
function modalHtml() {
  const f = state.form;
  const catsIn  = getDirCats('_global', 'in').map(c => `<option value="${c}" ${f.category===c?'selected':''}>${c}</option>`).join('');
  const catsOut = getDirCats('_global', 'out').map(c => `<option value="${c}" ${f.category===c?'selected':''}>${c}</option>`).join('');

  const isDDS = f.type === 'transfer';
  const isDividend = f.type === 'dividend';
  const allAccounts = getOrderedAccounts().map(k => [k, state.accounts[k]]);
  const toAccounts  = allAccounts.filter(([k]) => k !== f.account);

  return `
    <div class="modal-bg" id="modal-bg">
      <div id="new-tx-inner" class="modal">
        <div class="modal-header">
          <span class="modal-title">Новая операция</span>
          <button class="modal-close" id="modal-close">×</button>
        </div>
        <div class="form-grid">
          <div>
            <div class="form-label">Тип</div>
            <select class="form-inp" id="f-type">
              <option value="income"   ${f.type==='income'   ?'selected':''}>🟢 Доход</option>
              <option value="expense"  ${f.type==='expense'  ?'selected':''}>🔴 Расход</option>
              <option value="transfer" ${f.type==='transfer' ?'selected':''}>🟡 Перевод</option>
              <option value="dividend" ${f.type==='dividend' ?'selected':''}>🟣 Дивиденды</option>
            </select>
          </div>
          <div>
            <div class="form-label">Дата</div>
            <input type="date" class="form-inp" id="f-date" value="${f.date}">
          </div>

          ${isDDS ? `
          <div>
            <div class="form-label">🟡 Откуда (списать)</div>
            <select class="form-inp" id="f-account">
              ${allAccAndFundOptionsExcept('fund:' + f.fund, f.account)}
            </select>
          </div>
          <div>
            <div class="form-label">🔵 Куда (зачислить)</div>
            <select class="form-inp" id="f-to-account">
              ${allAccAndFundOptionsExcept(f.account, f.toAccount)}
            </select>
          </div>
          ` : isDividend ? `
          <div>
            <div class="form-label">Кому выплачиваем</div>
            <select class="form-inp" id="f-div-partner">
              ${(()=>{
                const dirKey = Object.keys(state.directions||{})[0] || Object.keys(state.partnerPayments||{})[0] || '_project';
                const dir = state.directions[dirKey] || {};
                const partners = dir.partners || [];
                if (!partners.length) return '<option value="">— нет партнёров —</option>';
                return partners.map(p =>
                  `<option value="${p.id}" ${f.divPartnerId===p.id?'selected':''}>${p.isOwner?'👑':'🤝'} ${p.name||'—'} · ${(p.share*100).toFixed(0)}%</option>`
                ).join('');
              })()}
            </select>
          </div>
          <div>
            <div class="form-label">Счёт (списать с)</div>
            <select class="form-inp" id="f-account">
              ${allAccOptions(f.account)}
            </select>
          </div>
          ${(()=>{
            const dir = DIRECTIONS[f.direction] || {};
            // No "withdraw to other account" - only one direction exists
            return '';
          })()}
          ` : `
          <div>
            <div class="form-label">Счёт</div>
            <select class="form-inp" id="f-account">
              ${allAccOptions(f.account)}
            </select>
          </div>
          `}

          <div class="form-row form-row-3">
            <div>
              <div class="form-label">Сумма ${isDDS ? '(списание)' : ''}</div>
              <input type="text" inputmode="decimal" placeholder="0" class="form-inp amount-inp" id="f-amount" value="${f.amount}">
            </div>
            <div>
              <div class="form-label">Валюта</div>
              <select class="form-inp" id="f-currency">
                ${(state.enabledCurrencies||['RUB','SAR','USDT']).map(cur => `<option value="${cur}" ${f.currency===cur?'selected':''}>${cur}</option>`).join('')}
              </select>
            </div>
          </div>

          ${isDDS ? `
          <div>
            <div class="form-label">Сумма зачисления <span style="color:#555;font-size:11px">(если другая валюта)</span></div>
            <input type="text" inputmode="decimal" placeholder="оставь пустым если та же валюта" class="form-inp amount-inp" id="f-to-amount" value="${f.toAmount||''}">
          </div>
          ` : ''}

          ${!isDividend ? `
          <div>
            <div class="form-label">Категория</div>
            <select class="form-inp" id="f-category">
              <option value="">— выбрать —</option>
              ${isDDS
                ? `<optgroup label="Перевод">${CATEGORIES_DDS.map(c=>`<option value="${c}" ${f.category===c?'selected':''}>${c}</option>`).join('')}</optgroup>`
                : f.type==='income'
                  ? `<optgroup label="Доходы">${catsIn}</optgroup>`
                  : `<optgroup label="Расходы">${catsOut}</optgroup>`
              }
            </select>
          </div>` : ''}
          <div>
            <div class="form-label">Комментарий</div>
            <input type="text" placeholder="Необязательно..." class="form-inp" id="f-note" value="${f.note}">
          </div>
          <button class="btn-submit" id="btn-submit">Добавить операцию</button>
        </div>
      </div>
    </div>`;
}

const _PROJ_EMOJIS = ['💼','📊','🏢','🚀','💡','🎯','💰','🌍','🏗️','📱','🎓','🛒','💎','🔥','⚡','🌿'];
const _PROJ_COLORS = ['#6ee7b7','#3b82f6','#a78bfa','#f87171','#fbbf24','#fb923c','#34d399','#e879f9','#38bdf8','#f472b6'];
let _projSwitcherMode = 'list';
let _projSettingsId   = null;
let _projNewEmoji     = '💼';
let _projNewColor     = '#6ee7b7';
let _projEditEmoji    = '💼';
let _projEditColor    = '#6ee7b7';

function _emojiGrid(selectedEmoji, prefix) {
  return _PROJ_EMOJIS.map(e => {
    const sel = e === selectedEmoji;
    return `<button data-${prefix}-emoji="${e}" style="width:40px;height:40px;border-radius:9px;border:1px solid ${sel?'rgba(110,231,183,0.5)':'rgba(255,255,255,0.08)'};background:${sel?'rgba(110,231,183,0.15)':'rgba(255,255,255,0.04)'};font-size:19px;cursor:pointer;flex-shrink:0">${e}</button>`;
  }).join('');
}
function _colorGrid(selectedColor, prefix) {
  return _PROJ_COLORS.map(c => {
    const sel = c === selectedColor;
    return `<button data-${prefix}-color="${c}" style="width:30px;height:30px;border-radius:50%;border:3px solid ${sel?'#fff':'transparent'};background:${c};cursor:pointer;transform:${sel?'scale(1.2)':'scale(1)'}"></button>`;
  }).join('');
}

function projectSwitcherHtml() {
  const projects = state._allProjects || [];

  if (_projSwitcherMode === 'create') {
    return `
    <div class="modal-bg" id="project-switcher-bg">
      <div id="m-projects-inner" class="modal" style="max-width:430px;padding:32px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px">
          <span style="font-size:16px;font-weight:700;color:#fff">＋ Новый проект</span>
          <button class="modal-close" id="project-switcher-close">×</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:18px">
          <div>
            <div class="form-label">Название проекта</div>
            <input class="form-inp" id="proj-new-name" placeholder="Например: Мой бизнес" maxlength="40" style="width:100%;font-size:15px">
          </div>
          <div>
            <div class="form-label">Иконка</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px">${_emojiGrid(_projNewEmoji, 'new')}</div>
          </div>
          <div>
            <div class="form-label">Цвет</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">${_colorGrid(_projNewColor, 'new')}</div>
          </div>
          <div style="display:flex;gap:10px;margin-top:4px">
            <button id="btn-proj-create-back" style="flex:1;padding:12px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);background:transparent;color:#666;cursor:pointer;font-size:14px">← Назад</button>
            <button id="btn-proj-create-submit" style="flex:2;padding:13px;border-radius:10px;border:none;background:linear-gradient(135deg,#6ee7b7,#3b82f6);color:#000;font-size:15px;font-weight:700;cursor:pointer">Создать проект →</button>
          </div>
        </div>
      </div>
    </div>`;
  }

  if (_projSwitcherMode === 'settings') {
    const proj = projects.find(p => p.id === _projSettingsId) || {};
    return `
    <div class="modal-bg" id="project-switcher-bg">
      <div id="m-projects-inner" class="modal" style="max-width:430px;padding:32px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px">
          <span style="font-size:16px;font-weight:700;color:#fff">⚙️ Настройки проекта</span>
          <button class="modal-close" id="project-switcher-close">×</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:18px">
          <div>
            <div class="form-label">Название проекта</div>
            <input class="form-inp" id="proj-edit-name" value="${(proj.name||'').replace(/"/g,'&quot;')}" maxlength="40" style="width:100%;font-size:15px">
          </div>
          <div>
            <div class="form-label">Иконка</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px">${_emojiGrid(_projEditEmoji, 'edit')}</div>
          </div>
          <div>
            <div class="form-label">Цвет</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">${_colorGrid(_projEditColor, 'edit')}</div>
          </div>
          <div style="display:flex;gap:10px;margin-top:4px">
            <button id="btn-proj-edit-back" style="flex:1;padding:12px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);background:transparent;color:#666;cursor:pointer;font-size:14px">← Назад</button>
            <button id="btn-proj-edit-save" style="flex:2;padding:12px;border-radius:10px;border:none;background:linear-gradient(135deg,#6ee7b7,#3b82f6);color:#000;font-size:15px;font-weight:700;cursor:pointer">Сохранить</button>
          </div>
          <button id="btn-proj-delete" style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.06);color:#f87171;font-size:13px;font-weight:600;cursor:pointer">🗑 Удалить проект</button>
        </div>
      </div>
    </div>`;
  }

  // list mode
  const rows = projects.map(p => {
    const isCurrent = p.id === _projectId;
    return `<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-radius:12px;background:${isCurrent?'rgba(167,139,250,0.1)':'rgba(255,255,255,0.03)'};border:1px solid ${isCurrent?'rgba(167,139,250,0.35)':'rgba(255,255,255,0.07)'}">
      <span data-switch-project="${p.id}" data-switch-name="${(p.name||'').replace(/"/g,'&quot;')}" data-switch-emoji="${p.emoji||'💼'}" style="font-size:22px;cursor:${isCurrent?'default':'pointer'};flex:0 0 auto">${p.emoji||'💼'}</span>
      <div data-switch-project="${p.id}" data-switch-name="${(p.name||'').replace(/"/g,'&quot;')}" data-switch-emoji="${p.emoji||'💼'}" style="flex:1;min-width:0;cursor:${isCurrent?'default':'pointer'}">
        <div style="font-size:14px;font-weight:${isCurrent?'700':'500'};color:${isCurrent?'#a78bfa':'#ccc'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.name||'Без названия'}</div>
        ${isCurrent ? '<div style="font-size:11px;color:#a78bfa;margin-top:2px">текущий проект</div>' : ''}
      </div>
      <button data-proj-settings-btn="${p.id}" data-proj-settings-emoji="${p.emoji||'💼'}" data-proj-settings-color="${p.color||'#6ee7b7'}" style="padding:5px 8px;border-radius:7px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.04);color:#555;cursor:pointer;font-size:13px;flex-shrink:0">⚙️</button>
    </div>`;
  }).join('');

  return `
    <div class="modal-bg" id="project-switcher-bg">
      <div id="m-projects-inner" class="modal" style="max-width:430px">
        <div class="modal-header">
          <span class="modal-title">🗂 Проекты</span>
          <button class="modal-close" id="project-switcher-close">×</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;padding:0 24px 24px">
          ${rows.length ? rows : '<div style="color:#555;font-size:13px;padding:12px 0">Загрузка...</div>'}
          <button id="btn-proj-new" style="margin-top:8px;width:100%;padding:11px;border-radius:10px;border:1px dashed rgba(110,231,183,0.3);background:rgba(110,231,183,0.04);color:#6ee7b7;cursor:pointer;font-size:14px;font-weight:600">＋ Новый проект</button>
        </div>
      </div>
    </div>`;
}

function periodModalHtml() {
  const p = state.activePeriod || {};
  const mode = p.mode || 'month';
  const showRange = mode === 'range';

  // Month options: all months with transactions + current month (even if empty)
  const curMk = getMonthKey(_localDateStr());
  const txMonths = [...new Set(state.transactions.map(t => getMonthKey(t.date)).filter(Boolean))];
  if (!txMonths.includes(curMk)) txMonths.push(curMk);
  const allMk = txMonths.sort().reverse();
  const selectedMk = p.month || state.activeMonth || curMk;
  const monthOpts = allMk.map(mk => {
    const [y,m] = mk.split('-');
    return `<option value="${mk}" ${selectedMk===mk?'selected':''}>${MONTHS[parseInt(m)-1]} ${y}</option>`;
  }).join('');

  const qBtn = (id, active, label) =>
    `<button id="${id}" style="padding:11px 4px;border-radius:10px;border:1px solid ${active?'rgba(167,139,250,0.5)':'rgba(255,255,255,0.1)'};background:${active?'rgba(167,139,250,0.12)':'rgba(255,255,255,0.04)'};color:${active?'#a78bfa':'#888'};cursor:pointer;font-size:12px;font-weight:${active?'700':'500'};transition:all 0.15s;text-align:center;flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${label}</button>`;

  return `
    <div class="modal-bg" id="period-modal-bg">
      <div id="m-period-inner" class="modal" style="max-width:400px">
        <div class="modal-header">
          <span class="modal-title">📅 Выбор периода</span>
          <button class="modal-close" id="period-modal-close">×</button>
        </div>
        <div class="form-grid">

          <!-- 3 quick buttons — equal width, no overflow -->
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;width:100%;box-sizing:border-box;overflow:hidden">
            ${qBtn('pmode-today', mode==='today', 'Сегодня')}
            ${qBtn('pmode-week',  mode==='week',  'Неделя')}
            ${qBtn('pmode-all',   mode==='all',   'Всё время')}
          </div>

          <!-- Свой период / Выбрать месяц toggle button -->
          <button id="pmode-range" style="width:100%;padding:11px;border-radius:10px;border:1px solid ${showRange?'rgba(167,139,250,0.5)':'rgba(255,255,255,0.1)'};background:${showRange?'rgba(167,139,250,0.12)':'rgba(255,255,255,0.04)'};color:${showRange?'#a78bfa':'#888'};cursor:pointer;font-size:13px;font-weight:${showRange?'700':'500'};transition:all 0.15s;box-sizing:border-box">
            ${showRange ? '📅 Выбрать месяц' : '🗓 Свой период'}
          </button>

          <!-- Swappable content block: range or month -->
          <div id="period-content-block">
          ${showRange ? `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div>
              <div class="form-label">С даты</div>
              <input type="date" class="form-inp" id="period-from" value="${p.from||''}">
            </div>
            <div>
              <div class="form-label">По дату</div>
              <input type="date" class="form-inp" id="period-to" value="${p.to||''}">
            </div>
          </div>
          <button class="btn-submit" id="btn-period-apply">Применить</button>` : `
          <!-- Month picker -->
          <div>
            <div class="form-label">Конкретный месяц</div>
            <select class="form-inp" id="period-month">${monthOpts}</select>
          </div>
          <button class="btn-submit" id="btn-period-apply">Применить</button>`}
          </div>
          <script>window._periodMonthOpts = ${JSON.stringify(monthOpts)};</script>

          ${state.activePeriod ? `<button id="btn-period-reset" style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);background:transparent;color:#555;cursor:pointer;font-size:13px;margin-top:-8px">✕ Сбросить фильтр</button>` : ''}
        </div>
      </div>
    </div>`;
}

function ratesModalHtml() {
  const upd = state.rates.updatedAt ? new Date(state.rates.updatedAt).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
  const isFallback = state.rates.source === 'fallback';
  const statusHtml = isFallback
    ? `<div style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:10px;padding:10px 14px;font-size:12px;color:#f87171">⚠️ Не удалось получить актуальный курс. Используются резервные значения.</div>`
    : `<div style="background:rgba(110,231,183,0.06);border:1px solid rgba(110,231,183,0.15);border-radius:10px;padding:10px 14px;font-size:12px;color:#6ee7b7">✓ Курсы актуальны · Обновлено: ${upd}</div>`;
  return `
    <div class="modal-bg" id="rates-bg">
      <div id="rates-inner" class="modal" style="max-width:360px">
        <div class="modal-header">
          <span class="modal-title">💱 Курсы валют</span>
          <button class="modal-close" id="rates-close">×</button>
        </div>
        <div class="form-grid">
          ${statusHtml}
          <div style="display:grid;gap:10px">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:rgba(255,255,255,0.04);border-radius:12px;border:1px solid rgba(255,255,255,0.07)">
              <span style="color:#888;font-size:13px">1 SAR</span>
              <span style="font-size:18px;font-weight:700;font-family:monospace;color:#fbbf24">${(state.rates.SAR||0).toFixed(2)} ₽</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:rgba(255,255,255,0.04);border-radius:12px;border:1px solid rgba(255,255,255,0.07)">
              <span style="color:#888;font-size:13px">1 USDT</span>
              <span style="font-size:18px;font-weight:700;font-family:monospace;color:#a78bfa">${(state.rates.USDT||0).toFixed(2)} ₽</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:rgba(255,255,255,0.04);border-radius:12px;border:1px solid rgba(255,255,255,0.07)">
              <span style="color:#888;font-size:13px">1 USD</span>
              <span style="font-size:18px;font-weight:700;font-family:monospace;color:#60a5fa">${(state.rates.USD||0).toFixed(2)} ₽</span>
            </div>
          </div>
          <button class="btn-submit" id="btn-refresh-rates" style="background:rgba(255,255,255,0.07);color:#ccc;border:1px solid rgba(255,255,255,0.12)">🔄 Обновить курсы</button>
        </div>
      </div>
    </div>`;
}

// ─── EMOJI PICKER ──────────────────────────────────────────────────────────

// ─── MODE PICKER ───────────────────────────────────────────────────────────
function modePickerHtml() {
  return `
    <div class="mode-picker-bg" id="mode-picker-bg">
      <div id="mode-picker-inner" class="mode-picker">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
          <div style="font-size:20px;font-weight:900;color:#fff;letter-spacing:-0.02em">+ Новая операция</div>
          <button id="mode-picker-close" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#666;font-size:20px;cursor:pointer;padding:4px 10px;line-height:1">×</button>
        </div>
        <button class="mode-btn" id="mode-manual">
          <div class="mode-btn-icon">✏️</div>
          <div>
            <div class="mode-btn-title">Ввести вручную</div>
            <div class="mode-btn-sub">Заполни форму с типом, суммой, счётом и категорией</div>
          </div>
        </button>
        <button class="mode-btn" id="mode-ai" style="border-color:rgba(110,231,183,0.25);background:rgba(110,231,183,0.04)">
          <div class="mode-btn-icon">🤖</div>
          <div>
            <div class="mode-btn-title" style="color:#6ee7b7">AI-помощник</div>
            <div class="mode-btn-sub">Отправь скриншот, надиктуй или напиши — AI сам создаст операции</div>
          </div>
        </button>
      </div>
    </div>`;
}

// ─── AI CHAT ────────────────────────────────────────────────────────────────
function aiChatHtml() {

function formatAiText(text) {
  if (!text) return '';
  let html = escHtmlAi(text);

  // ── 1. Bold: **text** → <b>text</b> ──
  html = html.replace(/\*\*(.+?)\*\*/g, '<b style="color:#fff;font-weight:700">$1</b>');

  // ── 2. Highlight direction names with their colors ──
  const dirs = Object.entries(state.directions || {});
  dirs.forEach(([key, dir]) => {
    if (!dir.label) return;
    const color = dir.color || '#6ee7b7';
    const icon  = dir.icon  || '';
    const escaped = dir.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Match icon+label or just label
    html = html.replace(new RegExp(
      (icon ? '(' + icon + '\\s*)?' : '') + '(' + escaped + ')',
      'g'
    ), (match) => {
      return `<span style="color:${color};font-weight:600">${icon ? icon + ' ' : ''}${dir.label}</span>`;
    });
  });

  // ── 3. Highlight account names with direction colors ──
  const accs = Object.entries(state.accounts || {});
  accs.forEach(([key, acc]) => {
    if (!acc.name) return;
    const dir   = (state.directions || {})[acc.direction] || {};
    const color = dir.color || '#93c5fd';
    // Strip emoji from name for matching, then re-add
    const nameEscaped = acc.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    html = html.replace(new RegExp(nameEscaped, 'g'),
      `<span style="color:${color};font-weight:600">${escapeHtml(acc.name)}</span>`
    );
  });

  // ── 4. Newlines ──
  html = html.replace(/\n/g, '<br>');

  return html;
}

  const msgs = state.aiMessages.map(m => {
    if (m.role === 'user') {
      const imgHtml = m.image ? `<img class="ai-msg-img" src="${m.image}" alt="скриншот">` : '';
      return `<div class="ai-msg ai-msg-user">${m.text ? escHtmlAi(m.text).replace(/\n/g,'<br>') : ''}${imgHtml}</div>`;
    } else if (m.role === 'typing') {
      return `<div class="ai-msg ai-msg-assistant"><div class="ai-typing"><span></span><span></span><span></span></div></div>`;
    } else {
      return `<div class="ai-msg ai-msg-assistant">${formatAiText(m.text)}</div>`;
    }
  }).join('');

  const pendingEntitiesHtml = state.aiPendingEntities ? (() => {
    const pe = state.aiPendingEntities;
    const rows = [
      ...pe.dirs.map(d  => `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06)"><span style="font-size:12px;color:#a78bfa;min-width:80px">📁 Направление</span><span style="flex:1;font-size:14px;color:#fff;font-weight:600">${d.icon||''} ${d.label}</span></div>`),
      ...pe.accs.map(a  => `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06)"><span style="font-size:12px;color:#6ee7b7;min-width:80px">💳 Счёт</span><span style="flex:1;font-size:14px;color:#fff;font-weight:600">${a.icon||'💳'} ${escapeHtml(a.name)} · ${a.currency||'RUB'}</span></div>`),
      ...pe.funds.map(f => `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06)"><span style="font-size:12px;color:#fbbf24;min-width:80px">🏦 Фонд</span><span style="flex:1;font-size:14px;color:#fff;font-weight:600">${f.icon||'💰'} ${escapeHtml(f.name)} · ${f.currency||'RUB'}</span></div>`),
    ].join('');
    return `<div style="background:rgba(110,231,183,0.06);border:1px solid rgba(110,231,183,0.2);border-radius:14px;padding:16px;margin-bottom:12px">
      <div style="font-size:12px;font-weight:700;color:#6ee7b7;margin-bottom:10px;letter-spacing:0.05em">❓ СОЗДАТЬ НОВЫЕ ОБЪЕКТЫ?</div>
      ${rows}
      <div style="display:flex;gap:8px;margin-top:12px">
        <button id="btn-confirm-entities" style="flex:1;padding:10px;border-radius:10px;border:none;background:linear-gradient(135deg,#6ee7b7,#3b82f6);color:#000;font-size:13px;font-weight:700;cursor:pointer">✅ Создать</button>
        <button id="btn-reject-entities" style="padding:10px 16px;border-radius:10px;border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.07);color:#f87171;font-size:13px;cursor:pointer">✕ Отмена</button>
      </div>
    </div>`;
  })() : '';

  const pendingCatsHtml = state.aiPendingCats && state.aiPendingCats.length > 0 ? (() => {
    const rows = state.aiPendingCats.map(cat => {
      const typeLabel = cat.type === 'in' ? '🟢 Доход' : '🔴 Расход';
      return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06)">
        <span style="font-size:12px;color:#888">${typeLabel}</span>
        <span style="flex:1;font-size:14px;color:#fff;font-weight:600">«${cat.name}»</span>
      </div>`;
    }).join('');
    return `<div style="background:rgba(167,139,250,0.08);border:1px solid rgba(167,139,250,0.25);border-radius:14px;padding:16px;margin-bottom:12px">
      <div style="font-size:12px;font-weight:700;color:#a78bfa;margin-bottom:10px;letter-spacing:0.05em">❓ НОВЫЕ КАТЕГОРИИ — ПОДТВЕРДИТЬ?</div>
      ${rows}
      <div style="display:flex;gap:8px;margin-top:12px">
        <button id="btn-confirm-cats" style="flex:1;padding:10px;border-radius:10px;border:none;background:linear-gradient(135deg,#a78bfa,#6ee7b7);color:#000;font-size:13px;font-weight:700;cursor:pointer">✅ Добавить</button>
        <button id="btn-reject-cats" style="padding:10px 16px;border-radius:10px;border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.07);color:#f87171;font-size:13px;cursor:pointer">✕ Отклонить</button>
      </div>
    </div>`;
  })() : '';

  const pendingHtml = state.aiPendingTxs.length > 0 ? (() => {
    const typeInfo = {
      income:  { label:'🟢 Доход',  color:'#6ee7b7', bg:'rgba(110,231,183,0.12)', border:'rgba(110,231,183,0.3)' },
      expense: { label:'🔴 Расход', color:'#f87171', bg:'rgba(239,68,68,0.12)',   border:'rgba(239,68,68,0.3)' },
      transfer: { label:'🟡 Перевод', color:'#fbbf24', bg:'rgba(251,191,36,0.12)', border:'rgba(251,191,36,0.3)' },
    };
    const editingIdx = state.aiEditingIdx;
    const allAccounts = getOrderedAccounts().map(k => [k, state.accounts[k]]);
    const allDirs = Object.entries(state.directions || DIRECTIONS);

    const pendingTxs = state.aiPendingTxs;
    const rows = [...pendingTxs].reverse().map((tx, origI) => { const i = pendingTxs.length - 1 - origI; tx = pendingTxs[i];
      const ti = typeInfo[tx.type] || typeInfo.expense;
      const dateStr = tx.date ? (() => { const dp=(tx.date||'').split('-'); const M=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря']; return dp.length===3?parseInt(dp[2])+' '+M[parseInt(dp[1])-1]:tx.date; })() : '';

      let amountHtml, accountLine;
      if (tx.type === 'transfer') {
        const fromAcc = state.accounts[tx.fromAccount];
        const toAcc   = state.accounts[tx.toAccount];
        const fromName = fromAcc ? fromAcc.name : (tx.fromAccount || '—');
        const toName   = toAcc   ? toAcc.name   : (tx.toAccount   || '—');
        const fromAmt  = tx.fromAmount || tx.amount || '?';
        const fromCur  = tx.fromCurrency || (fromAcc && fromAcc.currency) || 'RUB';
        amountHtml = `<div style="font-size:17px;font-weight:700;font-family:monospace;color:${ti.color}">${fromAmt} ${fromCur}</div>`;
        accountLine = `${fromName} → ${toName}`;
      } else {
        const acc = state.accounts[tx.account];
        const accName = acc ? acc.name : (tx.account || '—');
        const sign = tx.type === 'income' ? '+' : '-';
        const amt = tx.amount || '?';
        amountHtml = `<div style="font-size:17px;font-weight:700;font-family:monospace;color:${ti.color}">${sign}${amt} ${tx.currency||'RUB'}</div>`;
        accountLine = accName;
      }

      return `<div class="tx-item" style="margin-bottom:8px;position:relative;cursor:default">
        <div style="position:absolute;top:8px;left:12px;font-size:11px;font-weight:700;color:#444;z-index:1">#${pendingTxs.length - i}</div>
        <div style="position:absolute;top:8px;right:36px;display:flex;gap:4px;z-index:1">
          <button data-ai-edit="${i}" style="width:22px;height:22px;border-radius:6px;border:1px solid rgba(167,139,250,0.3);background:rgba(167,139,250,0.07);color:#a78bfa;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1">⚙</button>
        </div>
        <button data-ai-remove="${i}" style="position:absolute;top:8px;right:8px;width:22px;height:22px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:#555;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:1;line-height:1">×</button>
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:6px;padding-left:28px;padding-right:60px">
          <span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:20px;border:1px solid ${ti.border};background:${ti.bg};color:${ti.color};display:inline-block;width:fit-content">${ti.label}</span>
          <div style="font-size:16px;font-weight:600;color:#ccc">${escHtmlAi(tx.category||'—')}</div>
          ${tx.note ? `<div style="font-size:13px;color:#888">${escHtmlAi(tx.note)}</div>` : ''}
          <div style="font-size:12px;color:#555">${dateStr} · ${accountLine}</div>
        </div>
        <div style="text-align:right;flex-shrink:0">${amountHtml}</div>
      </div>`;
    }).join('');
    return `<div class="ai-pending-txs">
      <div style="font-size:12px;font-weight:700;color:#6ee7b7;margin-bottom:10px;letter-spacing:0.05em">✅ ГОТОВО К ДОБАВЛЕНИЮ (${state.aiPendingTxs.length})</div>
      ${rows}
      <div style="display:flex;gap:8px;margin-top:12px">
        <button id="ai-confirm-txs" style="flex:2;padding:10px;border-radius:10px;border:none;background:linear-gradient(135deg,#6ee7b7,#3b82f6);color:#000;font-weight:700;font-size:13px;cursor:pointer">Добавить выбранные операции →</button>
        <button id="ai-discard-txs" style="flex:1;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:#666;font-size:13px;cursor:pointer">Отмена</button>
      </div>
    </div>`;
  })() : '';

  return `
    <div class="ai-chat-bg" id="ai-chat-bg">
      <div class="ai-chat-wrap" id="ai-chat-wrap-inner">
        <div class="ai-chat-header">
          <div class="ai-chat-title">🤖 <span>AI-помощник по операциям</span></div>
          <div style="display:flex;gap:8px;align-items:center">
            <button id="ai-chat-clear" title="Очистить чат и начать заново" style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);border-radius:8px;color:#f87171;font-size:12px;font-weight:600;cursor:pointer;padding:5px 10px;line-height:1;white-space:nowrap">🗑 Очистить</button>
            <button id="ai-chat-close" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#666;font-size:20px;cursor:pointer;padding:4px 10px;line-height:1">×</button>
          </div>
        </div>
        <div class="ai-chat-messages" id="ai-chat-messages">
          ${msgs || '<div class="ai-msg ai-msg-assistant">Привет! Опиши свои операции — текстом, списком или загрузи скриншот банковской выписки. Я всё пойму и создам операции автоматически 👇</div>'}
          ${pendingEntitiesHtml}${pendingCatsHtml}${pendingHtml}
        </div>
        <div class="ai-chat-input-area">
          <div style="display:flex;gap:8px;align-items:flex-end">
            <label for="ai-img-input" style="width:40px;height:40px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:18px;flex-shrink:0" title="Загрузить скриншот">📎</label>
            <input type="file" id="ai-img-input" accept="image/*" style="display:none">
            <button id="ai-voice-btn" style="width:40px;height:40px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:18px;flex-shrink:0" title="Голосовой ввод">🎤</button>
            <textarea id="ai-text-input" placeholder="Напиши операции или задай вопрос..." style="flex:1;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:12px;color:#fff;font-size:14px;padding:10px 14px;resize:none;outline:none;font-family:inherit;height:42px;max-height:120px;overflow-y:auto;line-height:1.4"></textarea>
            <button id="ai-send-btn" style="width:40px;height:40px;border-radius:10px;border:none;background:linear-gradient(135deg,#6ee7b7,#3b82f6);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:18px;flex-shrink:0">➤</button>
          </div>
        </div>
        ${state.aiEditingIdx !== null ? aiEditModalHtml() : ''}
      </div>
    </div>`;
}

function aiEditModalHtml() {
  const idx = state.aiEditingIdx;
  const tx = state.aiPendingTxs[idx];
  if (!tx) return '';
  const allAccounts = getOrderedAccounts().map(k => [k, state.accounts[k]]);
  const dirKey = tx.direction || (state.accounts[tx.account] && state.accounts[tx.account].direction) || Object.keys(state.directions||{})[0];
  const catsIn  = getDirCats(dirKey,'in').map(cat=>`<option value="${cat}" ${tx.category===cat?'selected':''}>${cat}</option>`).join('');
  const catsOut = getDirCats(dirKey,'out').map(cat=>`<option value="${cat}" ${tx.category===cat?'selected':''}>${cat}</option>`).join('');
  const ddsCats = CATEGORIES_DDS.map(cat=>`<option value="${cat}" ${tx.category===cat?'selected':''}>${cat}</option>`).join('');
  return `<div id="ai-edit-modal-bg" style="position:absolute;inset:0;background:rgba(0,0,0,0.88);backdrop-filter:blur(8px);z-index:20;display:flex;align-items:center;justify-content:center;padding:20px;border-radius:24px" data-ai-edit-cancel>
    <div id="ai-edit-inner" style="background:#111;border:1px solid rgba(255,255,255,0.12);border-radius:20px;padding:24px;width:100%;max-width:420px;max-height:85vh;overflow-y:auto">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
        <span style="font-size:16px;font-weight:700;color:#fff">✏️ Операция #${idx+1}</span>
        <button data-ai-edit-cancel style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#666;font-size:18px;cursor:pointer;padding:2px 10px">×</button>
      </div>
      <div class="form-grid">
        <div class="form-row form-row-2">
          <div><div class="form-label">Тип</div>
            <select class="form-inp" id="aie-type">
              <option value="income" ${tx.type==='income'?'selected':''}>🟢 Доход</option>
              <option value="expense" ${tx.type==='expense'?'selected':''}>🔴 Расход</option>
              <option value="transfer" ${tx.type==='transfer'?'selected':''}>🟡 Перевод</option>
            </select>
          </div>
          <div><div class="form-label">Дата</div>
            <input type="date" class="form-inp" id="aie-date" value="${tx.date||''}">
          </div>
        </div>
        ${tx.type === 'transfer' ? `
        <div><div class="form-label">Откуда (счёт списания)</div>
          <select class="form-inp" id="aie-from-account">
            ${allAccOptions(tx.fromAccount||tx.account)}
          </select>
        </div>
        <div><div class="form-label">Куда (счёт зачисления)</div>
          <select class="form-inp" id="aie-to-account">
            ${allAccOptions(tx.toAccount)}
          </select>
        </div>
        <div class="form-row form-row-2">
          <div><div class="form-label">Сумма списания</div>
            <input type="number" class="form-inp" id="aie-from-amount" value="${tx.fromAmount||tx.amount||''}">
          </div>
          <div><div class="form-label">Сумма зачисления</div>
            <input type="number" class="form-inp" id="aie-to-amount" value="${tx.toAmount||tx.fromAmount||tx.amount||''}">
          </div>
        </div>
        ` : `
        <div><div class="form-label">Счёт</div>
          <select class="form-inp" id="aie-account">
            ${allAccOptions(tx.account)}
          </select>
        </div>
        <div class="form-row form-row-3">
          <div><div class="form-label">Сумма</div>
            <input type="number" class="form-inp" id="aie-amount" value="${tx.amount||''}">
          </div>
          <div><div class="form-label">Валюта</div>
            <select class="form-inp" id="aie-currency">
              ${(state.enabledCurrencies||['RUB','SAR','USDT']).map(cur=>`<option value="${cur}" ${tx.currency===cur?'selected':''}>${cur}</option>`).join('')}
            </select>
          </div>
        </div>
        `}
        <div><div class="form-label">Категория</div>
          <select class="form-inp" id="aie-category">
            ${tx.type==='transfer' ? `<optgroup label="Переводы">${ddsCats}</optgroup>` : tx.type==='income' ? `<optgroup label="Доходы">${catsIn}</optgroup>` : `<optgroup label="Расходы">${catsOut}</optgroup>`}
            ${tx.category ? `<option value="${tx.category}" selected>${escapeHtml(tx.category)}</option>` : ''}
          </select>
        </div>
        <div><div class="form-label">Комментарий</div>
          <input type="text" class="form-inp" id="aie-note" value="${escHtmlAi(tx.note||'')}">
        </div>
        <button class="btn-submit" data-ai-edit-save="${idx}">✓ Сохранить изменения</button>
      </div>
    </div>
  </div>`;
}

function escHtmlAi(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function scrollAiToBottom() {
  setTimeout(() => {
    const el = document.getElementById('ai-chat-messages');
    if (el) el.scrollTop = el.scrollHeight;
  }, 50);
}

async function sendAiMessage(text, imageBase64, imageMediaType) {
  if (!text && !imageBase64) return;

  // Add user message
  // Save active image for follow-up context
  if (imageBase64) {
    state.aiActiveImage = imageBase64;
    state.aiActiveImageMt = imageMediaType || 'image/jpeg';
  }
  state.aiMessages.push({ role: 'user', text, image: imageBase64 ? `data:\${imageMediaType||'image/jpeg'};base64,\${imageBase64}` : null });
  state.aiMessages.push({ role: 'typing' });
  // Trim history: keep max 60 messages in state (API only uses last 12 anyway)
  // Preserve 'typing' at end — trim from the front
  const MAX_AI_MSGS = 60;
  if (state.aiMessages.filter(m => m.role !== 'typing').length > MAX_AI_MSGS) {
    const typingMsg = state.aiMessages.find(m => m.role === 'typing');
    state.aiMessages = state.aiMessages.filter(m => m.role !== 'typing').slice(-MAX_AI_MSGS);
    if (typingMsg) state.aiMessages.push(typingMsg);
  }
  try { const msgsSafe = state.aiMessages.filter(m=>m.role!=='typing').map(m=>({...m, image: m.image ? '[img]' : null})); sessionStorage.setItem('ai_chat_history', JSON.stringify({ messages: msgsSafe, ts: Date.now(), projectId: _projectId })); } catch(e) {}
  render(); scrollAiToBottom();

  // Build context about user's project
  const accList = Object.entries(state.accounts).map(([k,a]) => {
    return `${a.name} [${a.currency}] (key: ${k})`;
  }).join('\n  ');
  const catIn  = getDirCats('_global','in').filter(c=>c!=='Перевод входящий').join(', ');
  const catOut = getDirCats('_global','out').filter(c=>c!=='Перевод исходящий').join(', ');

  const systemPrompt = `Ты AI-помощник финансового приложения MyFinanceAI. Твоя задача — точно записывать финансовые операции пользователя в строгом соответствии с инструкциями ниже.

═══ ДАННЫЕ ПРОЕКТА ═══
Счета пользователя:
  ${accList}

Категории доходов: ${catIn}
Категории расходов: ${catOut}
Активный месяц: ${state.activeMonth || 'текущий'}
Дата сегодня: ${_localDateStr()}

═══ ТИПЫ ОПЕРАЦИЙ — ТОЛЬКО ТРИ ТИПА ═══

1. ДОХОД (type: "income") — деньги пришли ИЗВНЕ на счёт.
   Пример: зарплата, оплата от клиента, дивиденды, предоплата.
   Поля: type, amount, currency, account, category, date, note

2. РАСХОД (type: "expense") — деньги ушли со счёта на ВНЕШНИЕ нужды.
   Пример: продукты, аренда, подписка, оплата услуг.
   Поля: type, amount, currency, account, category, date, note

3. ПЕРЕВОД (type: "transfer") — деньги переместились МЕЖДУ счетами пользователя.
   Это ОДНА операция (не две!). Она сразу списывает с одного счёта и зачисляет на другой.
   Примеры: снял наличные с карты, перевёл между счетами, обменял валюту.
   Поля: type:"transfer", fromAccount, toAccount, fromAmount, toAmount, fromCurrency, toCurrency, category, date, note
   
   Категории для переводов: "Снятие наличных", "Перевод между счетами", "Пополнение счёта", "Обмен валют"

⚠️ ЗАПРЕЩЕНО использовать type "dds_in" или "dds_out" — их больше не существует!
⚠️ БАЛАНС: перед созданием расхода или перевода ПРОВЕРЯЙ баланс счёта в state.accounts[key].balance. Если баланса недостаточно — НЕ создавай операцию, а напиши пользователю об ошибке.

⚠️ ЗАПРЕЩЕНО создавать тип "dividend" самостоятельно — дивиденды создаются только через кнопку выплаты партнёру.

═══ ПРАВИЛО ПЕРЕВОДОВ ═══
Перевод — ВСЕГДА одна операция типа "transfer", НЕ две отдельных.
Обязательно уточняй: с какого счёта (fromAccount) и на какой (toAccount).
Если суммы разные (обмен валют) — укажи fromAmount и toAmount отдельно.

Примеры:
• "снял 10000 наличных с карты" → transfer: fromAccount=карта, toAccount=наличные, fromAmount=10000, toAmount=10000
• "обменял 1000$ на рубли" → transfer: fromAccount=долларовый счёт, toAccount=рублёвый, fromAmount=1000, toAmount=90000, fromCurrency=USD, toCurrency=RUB
• "перевёл 5000 с одного счёта на другой" → transfer: fromAccount=ключ1, toAccount=ключ2, fromAmount=5000, toAmount=5000

═══ ЗОЛОТОЕ ПРАВИЛО — ПОДТВЕРЖДЕНИЕ ОБЯЗАТЕЛЬНО ═══

ЛЮБОЕ действие (создание транзакций, счетов, фондов, категорий) происходит ТОЛЬКО после явного подтверждения пользователя.

Порядок работы:
1. Пользователь даёт команду
2. Ты уточняешь всё непонятное ОДНИМ сообщением
3. Пользователь отвечает / подтверждает
4. Ты формируешь JSON и показываешь что именно будет сделано
5. Пользователь нажимает подтверждение в интерфейсе
6. После применения — отчитываешься: что именно сделано, сколько операций, на какие суммы

ЗАПРЕЩЕНО:
- Делать что-либо без явного «да», «подтвердить», «добавить» от пользователя
- Сообщать «готово» или «записал» до того как пользователь нажал подтверждение в интерфейсе
- Выполнять действия которые нельзя сделать вручную в приложении

Что ИИ может делать (только то, что доступно вручную):
✅ Создать транзакцию (доход / расход / перевод)
✅ Создать новый счёт
✅ Создать новый фонд
✅ Создать новую категорию (с подтверждением)

Что ИИ НЕ МОЖЕТ делать (даже если просят):
❌ Удалять транзакции, счета, фонды, категории
❌ Редактировать существующие транзакции
❌ Изменять балансы счетов напрямую
❌ Выплачивать дивиденды партнёрам
❌ Изменять настройки партнёрских долей
❌ Создавать или изменять структуру проекта
❌ Очищать данные или делать сброс

═══ ПРАВИЛА УТОЧНЕНИЯ ═══

ГЛАВНОЕ ПРАВИЛО: Задавай ВСЕ вопросы ОДНИМ сообщением, пронумеровано. Никогда не задавай вопросы по одному в разных сообщениях.

ПОРЯДОК ОПЕРАЦИЙ: Сохраняй строго тот порядок в котором операции идут в тексте или на скриншоте. Не сортируй по дате, сумме или типу. Первая операция в тексте = первая в TRANSACTIONS_JSON.

При ОДИНОЧНОЙ операции:
- Если чего-то не хватает — задай все вопросы сразу одним списком и жди ответа

При СПИСКЕ операций (3+):
1. Сначала разбери весь список и определи что понятно, что нет
2. Всё что понятно — готово к записи
3. Всё что непонятно — собери ВСЕ вопросы в ОДНО сообщение, пронумеровано:
   Например: "Уточни по нескольким операциям:
   1. -16600 на сервис — с какого счёта? (Личная карта / Наличные)
   2. -6000р — что это за операция? категория?
   3. -60000р дивиденды Адаму — это Перевод или Расход?"
4. После получения ответов — сразу формируй JSON со ВСЕМИ операциями
5. Больше вопросов не задавай — используй полученные ответы

НЕ надо уточнять если:
- Счёт только один и всё очевидно
- Пользователь явно указал счёт
- Можно логически вывести из контекста
- Категория очевидна из описания

ЗАПРЕЩЕНО:
- Задавать вопросы по одному в разных сообщениях
- Говорить "занёс" без показа TRANSACTIONS_JSON
- Показывать превью без полного JSON всех операций

═══ ФОРМАТ ОТВЕТА ═══
Сначала краткое подтверждение на русском, затем JSON:

TRANSACTIONS_JSON для доходов/расходов:
[{"type":"income|expense","amount":1000,"currency":"RUB","account":"ключ_счёта","category":"Название категории","date":"2026-03-03","note":"комментарий"}]

TRANSACTIONS_JSON для переводов:
[{"type":"transfer","fromAccount":"ключ_счёта_откуда","toAccount":"ключ_счёта_куда","fromAmount":1000,"toAmount":1000,"fromCurrency":"RUB","toCurrency":"RUB","category":"Снятие наличных","date":"2026-03-03","note":"Снятие наличных: Личная карта → Наличные"}]

Можно смешивать разные типы в одном массиве TRANSACTIONS_JSON.

⚠️ КАТЕГОРИИ — ЗОЛОТЫЕ ПРАВИЛА (НАРУШЕНИЕ НЕДОПУСТИМО):
- ЗАПРЕЩЕНО создавать NEW_CATEGORIES_JSON без явного письменного подтверждения пользователя
- Используй ТОЛЬКО категории из глобального списка выше — единый список для всего проекта
- Если транзакция похожа на существующую категорию — ВСЕГДА предложи её, не создавай новую
- Если категория не ясна — обязательно спроси и перечисли подходящие варианты из списка
- ПЕРЕД предложением новой категории — проверь список на похожие по смыслу (синонимы, похожие слова)
- Если нашёл похожую — спроси: «Подойдёт ли категория «X»?» вместо создания новой
- Только если пользователь явно написал «да, создай новую категорию [название]» — используй блок:
NEW_CATEGORIES_JSON:
[{"dirKey":"_global","type":"in|out","name":"Название категории"}]
- СТРОГО ЗАПРЕЩЕНО: использовать NEW_CATEGORIES_JSON если в списке есть похожая категория

⚠️ НАПРАВЛЕНИЯ БОЛЬШЕ НЕ СУЩЕСТВУЕТ — ВАЖНО:
- В приложении 1 проект = 1 направление. Поле direction НЕ нужно и НЕ запрашивается.
- НИКОГДА не спрашивай пользователя про направление (direction).
- НИКОГДА не включай поле direction в TRANSACTIONS_JSON.

⚠️ ОБЯЗАТЕЛЬНЫЕ ПОЛЯ — операция НЕ может быть создана без:
- amount (сумма > 0) — если не указана, уточни
- category — если не ясна, предложи варианты из списка и уточни
- account / fromAccount+toAccount — если не ясен, уточни
- date — если не указана, используй сегодняшнюю дату

═══ СОЗДАНИЕ НОВЫХ СУЩНОСТЕЙ ═══
Если пользователь называет счёт/фонд которого нет — СНАЧАЛА спроси подтверждение, опиши что именно создашь.
Только после явного «да» от пользователя — добавь соответствующий JSON блок.
Пользователь увидит карточку подтверждения и нажмёт кнопку — только тогда объект будет создан.

Для нового счёта:
NEW_ACCOUNT_JSON:
[{"key":"уникальный_ключ","name":"Название счёта","currency":"RUB","icon":"💳"}]

ВАЖНО при создании счёта: всегда спрашивай — в какой валюте.

Для нового фонда:
NEW_FUND_JSON:
[{"key":"уникальный_ключ","name":"Название фонда","currency":"RUB","icon":"💰","color":"#a78bfa"}]

Ключи должны быть латиницей без пробелов, уникальными (например: "alfa_card", "reserve_fund").

═══ ПРАВИЛО КОММЕНТАРИЯ ПРИ ПЕРЕВОДАХ ═══
Для операции transfer поле note заполняй автоматически:
"[Категория]: [название счёта откуда] → [название счёта куда]"
Пример: note = "Снятие наличных: Личная карта → Наличные"

═══ РАБОТА С ИЗОБРАЖЕНИЯМИ ═══
Если пользователь прислал скриншот (банковской выписки, чека, переписки с суммами):
1. Внимательно прочитай все суммы, даты, описания операций
2. Распознай каждую операцию
3. Сразу сформируй TRANSACTIONS_JSON со всеми найденными операциями
4. Если что-то неясно — задай все вопросы одним сообщением
НЕ говори "я вижу изображение" или "на скриншоте" — просто сразу обрабатывай операции.

ВАЖНО:
- При создании новых сущностей — сначала NEW_*_JSON, потом TRANSACTIONS_JSON
- Всегда отвечай на русском языке, кратко и по делу
- JSON блоки пиши БЕЗ markdown-обёрток (без \`\`\`json и \`\`\`) — только чистый JSON сразу после метки`;

  try {
    // Build messages for built-in Claude API (no key needed)
    const userContent = [];
    // Use current image OR last active image for context
    const imgData = imageBase64 || state.aiActiveImage;
    const imgMt = imageBase64 ? (imageMediaType || 'image/jpeg') : state.aiActiveImageMt;
    if (imgData) {
      const allowedMt = ['image/jpeg','image/png','image/gif','image/webp'];
      const safeMt = allowedMt.includes(imgMt) ? imgMt : 'image/jpeg';
      userContent.push({ type: 'image', source: { type: 'base64', media_type: safeMt, data: imgData } });
    }
    if (text) userContent.push({ type: 'text', text });

    const apiMessages = [];
    // Add conversation history (skip typing indicators)
    // Keep last 12 messages. NEVER send images from history - only text+placeholder.
    // Images corrupt when stored/restored, so only the CURRENT message can have an image.
    const histMsgs = state.aiMessages.filter(m => m.role !== 'typing').slice(0, -1).slice(-12);
    histMsgs.forEach((m) => {
      if (m.role === 'user') {
        const content = [];
        // Always replace history images with placeholder text - never send raw base64 from history
        if (m.image && m.image !== '[img]') {
          content.push({ type: 'text', text: '[пользователь прикреплял скриншот в этом сообщении]' });
        } else if (m.image === '[img]') {
          content.push({ type: 'text', text: '[пользователь прикреплял скриншот в этом сообщении]' });
        }
        if (m.text) content.push({ type: 'text', text: m.text });
        if (content.length === 0) content.push({ type: 'text', text: '...' });
        apiMessages.push({ role: 'user', content });
      } else {
        apiMessages.push({ role: 'assistant', content: m.text || '...' });
      }
    });
    apiMessages.push({ role: 'user', content: userContent });

    // Get current session token to prove user is logged in
    const { data: { session } } = await _SB.auth.getSession();
    const authToken = session ? session.access_token : null;

    const resp = await fetch('/.netlify/functions/claude', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { 'Authorization': 'Bearer ' + authToken } : {})
      },
      body: JSON.stringify({
        system: systemPrompt,
        messages: apiMessages,
      })
    });

    const data = await resp.json();
    // Handle API errors
    if (!resp.ok || data.error || (data.type === 'error')) {
      const errMsg = data.error?.message || data.error || JSON.stringify(data).slice(0,200);
      throw new Error('API: ' + errMsg);
    }
    const fullText = (data.content || []).map(b => b.text || '').join('');
    if (!fullText.trim()) {
      // Empty response - likely overload, retry hint
      throw new Error('Пустой ответ от AI. Попробуй отправить сообщение ещё раз.');
    }

    // Remove typing indicator
    state.aiMessages = state.aiMessages.filter(m => m.role !== 'typing');

    // Parse transactions if present
    // Try to extract JSON transactions from response
    let parsed = null;
    let newCats = null;
    let displayText = fullText;

    // Extract NEW_CATEGORIES_JSON
    // Strip markdown code fences from AI response before parsing
    function stripJsonFences(str) {
      return str.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    }
    function extractJsonBlock(text, marker) {
      if (!text.includes(marker + ':')) return null;
      try {
        const raw = text.split(marker + ':')[1]
          .split(/NEW_[A-Z_]+_JSON:|TRANSACTIONS_JSON:|NEW_CATEGORIES_JSON:/)[0]
          .trim();
        const clean = stripJsonFences(raw);
        const parsed = JSON.parse(clean);
        return Array.isArray(parsed) ? parsed : null;
      } catch(e) {
        console.warn(marker + ' parse error:', e.message);
        return null;
      }
    }

    if (fullText.includes('NEW_CATEGORIES_JSON:')) {
      const parts = fullText.split('NEW_CATEGORIES_JSON:');
      displayText = parts[0].trim();
      try {
        const catJson = stripJsonFences(parts[1].split('TRANSACTIONS_JSON:')[0].trim());
        newCats = JSON.parse(catJson);
      } catch(e) {}
    }

    // Extract TRANSACTIONS_JSON
    if (fullText.includes('TRANSACTIONS_JSON:')) {
      const parts = fullText.split('TRANSACTIONS_JSON:');
      displayText = parts[0].replace('NEW_CATEGORIES_JSON:', '').trim();
      try { parsed = JSON.parse(stripJsonFences(parts[1].trim())); } catch(e) {}
    }

    // Also try to find JSON array anywhere in text
    if (!parsed) {
      const match = fullText.match(/\[\s*\{[\s\S]*?\}\s*\]/);
      if (match) {
        try {
          const candidate = JSON.parse(match[0]);
          if (candidate[0] && candidate[0].type && ['income','expense','transfer','dividend'].includes(candidate[0].type)) {
            parsed = candidate;
            displayText = fullText.replace(match[0], '').replace('TRANSACTIONS_JSON:', '').replace('NEW_CATEGORIES_JSON:', '').trim();
          }
        } catch(e) {}
      }
    }


    // Extract NEW_ACCOUNT_JSON
    const newAccs = extractJsonBlock(fullText, 'NEW_ACCOUNT_JSON');

    // Extract NEW_FUND_JSON
    const newFunds = extractJsonBlock(fullText, 'NEW_FUND_JSON');

    // Queue entities for confirmation — never apply immediately
    const hasEntities = (newAccs && newAccs.length) || (newFunds && newFunds.length);
    if (hasEntities) {
      state.aiPendingEntities = { dirs: [], accs: newAccs||[], funds: newFunds||[] };
      const lines = [];
      if (newAccs && newAccs.length)  lines.push('💳 Счёт: ' + newAccs.map(a => a.name).join(', '));
      if (newFunds && newFunds.length) lines.push('🏦 Фонд: ' + newFunds.map(f => f.name).join(', '));
      displayText = (displayText||'') + '\n\n❓ Хочу создать:\n' + lines.join('\n') + '\nПодтвердить создание?';
    }

    // Rule: AI must ask before adding new categories — store as pending
    if (newCats && Array.isArray(newCats)) {
      const truly_new = newCats.filter(cat => {
        if (!cat.type || !cat.name) return false;
        const existing = getDirCats('_global', cat.type);
        return !existing.includes(cat.name);
      });
      if (truly_new.length > 0) {
        state.aiPendingCats = truly_new;
        const names = truly_new.map(c => '«' + c.name + '» (' + (c.type === 'in' ? 'доход' : 'расход') + ')').join(', ');
        displayText = (displayText || '') + '\n\n❓ Хочу добавить новые категории: ' + names + '.\nДобавить их в список?';
      }
    }

    if (parsed && Array.isArray(parsed) && parsed.length > 0 && parsed[0].type) {
      state.aiPendingTxs = parsed;
      state.aiMessages.push({ role: 'assistant', text: displayText || 'Вот что я нашёл:' });
    } else {
      state.aiMessages.push({ role: 'assistant', text: displayText || fullText || '...' });
    }
    try { const msgsSafe = state.aiMessages.map(m=>({...m, image: m.image ? '[img]' : null})); sessionStorage.setItem('ai_chat_history', JSON.stringify({ messages: msgsSafe, ts: Date.now(), projectId: _projectId })); } catch(e) {}
  } catch(e) {
    state.aiMessages = state.aiMessages.filter(m => m.role !== 'typing');
    state.aiMessages.push({ role: 'assistant', text: '⚠️ Ошибка: ' + e.message });
    try { const msgsSafe = state.aiMessages.map(m=>({...m, image: m.image ? '[img]' : null})); sessionStorage.setItem('ai_chat_history', JSON.stringify({ messages: msgsSafe, ts: Date.now(), projectId: _projectId })); } catch(e) {}
  }
  render(); scrollAiToBottom();
}

function confirmAiCats() {
  if (!state.aiPendingCats || !state.aiPendingCats.length) return;
  if (!state.dirCategories['_global']) state.dirCategories['_global'] = { in: [], out: [] };
  state.aiPendingCats.forEach(cat => {
    const arr = getDirCats('_global', cat.type);
    if (!arr.includes(cat.name)) arr.push(cat.name);
  });
  const names = state.aiPendingCats.map(c => c.name).join(', ');
  state.aiPendingCats = [];
  state.aiMessages.push({ role: 'assistant', text: '✅ Категории добавлены: ' + names });
  saveToStorage();
  render(); scrollAiToBottom();
}

function confirmAiTxs() {
  const today = _localDateStr();
  const aiBalErrors = [];
  state.aiPendingTxs.forEach(tx => {
    const id = 'ai_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    const now = Date.now();

    if (tx.type === 'transfer') {
      // ── TRANSFER: same logic as manual btn-submit ──
      const fromAcc = state.accounts[tx.fromAccount];
      const toAcc   = state.accounts[tx.toAccount];
      if (!fromAcc || !toAcc) return; // skip invalid
      const fromAmt = parseFloat(tx.fromAmount || tx.amount) || 0;
      const toAmt   = parseFloat(tx.toAmount   || tx.amount) || fromAmt;
      const aiBalErrT = checkSufficientBalance(tx.fromAccount, fromAmt);
      if (aiBalErrT) { aiBalErrors.push(aiBalErrT); return; }
      fromAcc.balance -= fromAmt;
      toAcc.balance   += toAmt;
      state.transactions.push({
        id: 'tr_' + id,
        date: tx.date || today,
        type: 'transfer',
        fromAccount: tx.fromAccount, toAccount: tx.toAccount,
        fromDirection: fromAcc.direction, toDirection: toAcc.direction,
        fromAmount: fromAmt, toAmount: toAmt,
        fromCurrency: fromAcc.currency, toCurrency: toAcc.currency,
        category: tx.category || 'Перевод между счетами',
        note: tx.note || '',
        createdAt: now, createdAtMs: now, updatedAtMs: null,
        isTransfer: true,
      });
    } else {
      // ── INCOME / EXPENSE: same logic as manual btn-submit ──
      const acc = state.accounts[tx.account];
      const amount = parseFloat(tx.amount) || 0;
      if (acc) {
        if (tx.type === 'income') {
          acc.balance += amount;
        } else {
          const aiBalErrE = checkSufficientBalance(tx.account, amount);
          if (aiBalErrE) { aiBalErrors.push(aiBalErrE); return; }
          acc.balance -= amount;
        }
      }
      state.transactions.push({
        id,
        date: tx.date || today,
        type: tx.type,
        direction: tx.direction || _projectId || '',
        account: tx.account,
        amount, currency: tx.currency || 'RUB',
        category: tx.category || '',
        note: tx.note || '',
        createdAt: now, createdAtMs: now, updatedAtMs: null,
      });
    }
  });
  if (aiBalErrors.length) {
    state.aiMessages.push({ role: 'assistant', text: '⚠️ Некоторые операции не созданы — недостаточно средств:\n' + aiBalErrors.map(e => '• ' + e).join('\n') });
  }
  const txsSaved = [...state.aiPendingTxs];
  state.aiPendingTxs = [];
  // Build detailed report
  const byType = { income: [], expense: [], transfer: [] };
  txsSaved.forEach(t => { if (byType[t.type]) byType[t.type].push(t); });
  const lines = ['✅ Записано ' + txsSaved.length + ' ' + (txsSaved.length===1?'операция':'операций') + ':'];
  byType.income.forEach(t  => lines.push('  📈 +' + t.amount + ' ' + (t.currency||'RUB') + ' · ' + t.category + (t.note?' ('+t.note+')':'')));
  byType.expense.forEach(t => lines.push('  📉 -' + t.amount + ' ' + (t.currency||'RUB') + ' · ' + t.category + (t.note?' ('+t.note+')':'')));
  byType.transfer.forEach(t=> lines.push('  🔄 ' + (t.fromAmount||t.amount) + ' ' + (t.fromCurrency||'RUB') + ' → ' + (t.toAmount||t.amount) + ' ' + (t.toCurrency||t.currency||'RUB') + (t.note?' ('+t.note+')':'')));
  state.aiMessages.push({ role: 'assistant', text: lines.join('\n') });
  saveToStorage(); render(); scrollAiToBottom();
}

// ─── Period apply logic ────────────────────────────────────────────────────
function _bindPeriodApply() {
  var applyBtn = document.getElementById('btn-period-apply') || document.getElementById('btn-period-apply-inner');
  if (!applyBtn) return;
  applyBtn.onclick = function() {
    var mode = (state.activePeriod || {}).mode || 'month';
    if (mode === 'range') {
      var from = (document.getElementById('period-from')||{}).value;
      var to   = (document.getElementById('period-to')||{}).value;
      if (!from || !to) { showToast('Укажи обе даты', 'error'); return; }
      if (from > to) { showToast('Дата «С» должна быть раньше даты «По»', 'error'); return; }
      state.activePeriod = { mode: 'range', from, to };
    } else {
      var mk = (document.getElementById('period-month')||{}).value;
      if (!mk) return;
      state.activePeriod = { mode: 'month', month: mk };
      state.activeMonth = mk;
    }
    state.showPeriodModal = false;
    render();
  };
}

// ─── Toggle patch — updates visual state without render() ───────────────────
function _patchToggle(checkbox) {
  const label = checkbox.closest('label');
  if (!label) return;
  const track = label.querySelector('span');
  if (!track) return;
  const knob = track.querySelector('span');
  const on = checkbox.checked;
  track.style.background = on ? '#6ee7b7' : 'rgba(255,255,255,0.1)';
  if (knob) {
    knob.style.left = on ? '23px' : '3px';
    knob.style.background = on ? '#0a0a12' : '#555';
  }
}

// ─── BIND EVENTS ───────────────────────────────────────────────────────────
function bindEvents() {
  // header buttons
  const btnRates = document.getElementById('btn-rates');
  const btnAdd = document.getElementById('btn-add');
  if (btnRates) btnRates.onclick = () => { state.showRates = true; render(); };
  const btnClearTxs = document.getElementById('btn-clear-txs');
  if (btnClearTxs) btnClearTxs.onclick = async () => {
    const month = state.activeMonth || new Date().toISOString().slice(0,7);
    const [y, m] = month.split('-');
    const monthName = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'][parseInt(m)-1];
    const count = state.transactions.filter(t => (t.date||'').startsWith(month)).length;
    if (!await confirmAsync(`Удалить все операции за ${monthName} ${y}?\n\nБудет удалено: ${count} операций.\nНаправления, счета, фонды и категории останутся.`, { okLabel: 'Удалить' })) return;

    // Remove transactions for this month
    state.transactions = state.transactions.filter(t => !(t.date||'').startsWith(month));

    // Recalculate account and fund balances from scratch
    Object.values(state.accounts).forEach(a => { a.balance = 0; });
    Object.values(state.funds).forEach(f => { f.balance = 0; });
    state.transactions.forEach(t => {
      if (t.type === 'transfer' || t.isTransfer) {
        const fa = state.accounts[t.fromAccount];
        const ta = state.accounts[t.toAccount];
        if (fa) fa.balance -= parseFloat(t.fromAmount || t.amount) || 0;
        if (ta) ta.balance += parseFloat(t.toAmount   || t.amount) || 0;
      } else if (t.type === 'income') {
        const a = state.accounts[t.account]; if (a) a.balance += parseFloat(t.amount) || 0;
      } else if (t.type === 'expense') {
        const a = state.accounts[t.account]; if (a) a.balance -= parseFloat(t.amount) || 0;
      } else if (t.type === 'fund_in') {
        const f = state.funds[t.fund]; if (f) f.balance += parseFloat(t.amount) || 0;
      } else if (t.type === 'fund_out') {
        const f = state.funds[t.fund]; if (f) f.balance -= parseFloat(t.amount) || 0;
      }
    });

    await saveToStorage();
    state.showSettingsModal = false;
    render();
    showToast(`✅ Операции за ${monthName} ${y} удалены. Балансы пересчитаны.`, 'success');
  };

  const btnReset = document.getElementById('btn-reset');
  if (btnReset) btnReset.onclick = async () => {
    showConfirm('Сбросить все данные до заводских настроек?\nЭто действие необратимо!', async () => {
      // Reset to same defaults as new project creation
      state.transactions    = [];
      state.fundHistory     = [];
      state.partnerPayments = {};
      state.directions = {
        personal: { label: 'Личные финансы', color: '#6ee7b7', icon: '👤', partners: [{ id: 'owner_personal', name: 'Я', role: 'Владелец', share: 1, isOwner: true }] },
      };
      state.accounts = {
        personal_card: { name: '💳 Личная карта', direction: 'personal', currency: 'RUB', balance: 0 },
        personal_cash: { name: '💵 Наличные',     direction: 'personal', currency: 'RUB', balance: 0 },
      };
      state.funds = {
        cushion: { name: 'Подушка безопасности', balance: 0, currency: 'RUB', icon: '🛡️', color: '#6ee7b7' },
        savings: { name: 'Накопительный счёт',   balance: 0, currency: 'RUB', icon: '💵', color: '#93c5fd' },
      };
      state.dirCategories = {
        personal: {
          in:  ['Выручка','Зарплата','Услуги','Дивиденды','Поступление от клиента','Возврат средств','Перевод входящий','Прочий доход'],
          out: ['Аренда','Зарплата / ФОТ','Реклама и маркетинг','Сервисы и подписки','Связь и интернет','Транспорт','Налоги','Комиссии и эквайринг','Перевод исходящий','Прочий расход'],
        }
      };
      state.enabledCurrencies = ['RUB', 'USD'];
      state.dirOrder = null;
      state.accOrder = null;
      state.fundOrder = null;
      DIRECTIONS = state.directions;
      await cloudSave(getFullState());
      render();
    }, { okLabel: 'Сбросить', okStyle: 'danger' });
  };

  // Header settings button — opens overlay modal
  // Settings buttons (header + month selector)
  // ── Period modal — use delegation since header renders separately ──
  var periodBg    = document.getElementById('period-modal-bg');
  var periodClose = document.getElementById('period-modal-close');
  if (periodBg)    periodBg.onclick    = function(e) { if(e.target===periodBg){state.showPeriodModal=false;render();} };
  if (periodClose) periodClose.onclick = function()  { state.showPeriodModal=false; render(); };

  // Quick period buttons — apply immediately and close
  ['today','week','all'].forEach(function(m) {
    var btn = document.getElementById('pmode-'+m);
    if (btn) btn.onclick = function() {
      state.activePeriod = { mode: m };
      state.showPeriodModal = false;
      render();
    };
  });

  // Range toggle button — patch DOM in-place, no render()
  var rangeBtn = document.getElementById('pmode-range');
  if (rangeBtn) rangeBtn.onclick = function() {
    var cur = (state.activePeriod || {}).mode;
    if (!state.activePeriod) state.activePeriod = {};
    var goRange = cur !== 'range';
    state.activePeriod.mode = goRange ? 'range' : 'month';

    // Swap button label
    rangeBtn.textContent = goRange ? '📅 Выбрать месяц' : '🗓 Свой период';
    var activeStyle  = 'rgba(167,139,250,0.5)';
    var inactiveStyle = 'rgba(255,255,255,0.1)';
    rangeBtn.style.border = '1px solid ' + (goRange ? activeStyle : inactiveStyle);
    rangeBtn.style.background = goRange ? 'rgba(167,139,250,0.12)' : 'rgba(255,255,255,0.04)';
    rangeBtn.style.color = goRange ? '#a78bfa' : '#888';
    rangeBtn.style.fontWeight = goRange ? '700' : '500';

    // Swap content block: range inputs ↔ month select
    var container = document.getElementById('period-content-block');
    if (!container) return;
    if (goRange) {
      var pFrom = (state.activePeriod||{}).from || '';
      var pTo   = (state.activePeriod||{}).to   || '';
      container.innerHTML = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">'
        + '<div><div class="form-label">С даты</div><input type="date" class="form-inp" id="period-from" value="' + pFrom + '"></div>'
        + '<div><div class="form-label">По дату</div><input type="date" class="form-inp" id="period-to" value="' + pTo + '"></div>'
        + '</div>'
        + '<button class="btn-submit" id="btn-period-apply-inner">Применить</button>';
    } else {
      var monthOptsHtml = window._periodMonthOpts || '';
      container.innerHTML = '<div><div class="form-label">Конкретный месяц</div>'
        + '<select class="form-inp" id="period-month">' + monthOptsHtml + '</select></div>'
        + '<button class="btn-submit" id="btn-period-apply-inner">Применить</button>';
    }
    // Re-bind apply inside swapped content
    var innerApply = document.getElementById('btn-period-apply-inner');
    if (innerApply) innerApply.onclick = document.getElementById('btn-period-apply') && document.getElementById('btn-period-apply').onclick || function(){};
    _bindPeriodApply();
  };

  // Apply button
  _bindPeriodApply();

  // Reset button
  var resetBtn = document.getElementById('btn-period-reset');
  if (resetBtn) resetBtn.onclick = function() {
    state.activePeriod = null;
    state.showPeriodModal = false;
    render();
  };

  ['btn-settings-header','btn-settings-month'].forEach(function(id) {
    var b = document.getElementById(id);
    if (b) b.onclick = function() { state.showSettingsModal = true; _openSettingsDraft(); render(); };
  });

  // Period button
  var btnPeriodOpen = document.getElementById('btn-period-open');
  if (btnPeriodOpen) btnPeriodOpen.onclick = function() { state.showPeriodModal = true; render(); };

  // Project switcher button — handled by global document click delegation below

  // Profile/cabinet buttons
  ['btn-profile-month','btn-profile-dash'].forEach(function(id) {
    var b = document.getElementById(id);
    if (b) b.onclick = function() { state.showProfileModal = true; render(); };
  });

  // Profile modal: close button
  var bpc = document.getElementById('btn-profile-close');
  if (bpc) bpc.onclick = function() { state.showProfileModal = false; render(); };
  const profileModalBg = document.getElementById('profile-modal-bg');
  if (profileModalBg) profileModalBg.onclick = e => { if (e.target === profileModalBg) { state.showProfileModal = false; render(); } };

  // Profile modal: change password
  var bcp = document.getElementById('btn-change-password');
  if (bcp) bcp.onclick = async function() {
    if (!_currentUser) return;
    var r = await _SB.auth.resetPasswordForEmail(_currentUser.email);
    if (r.error) { showToast('Ошибка: ' + r.error.message, 'error'); return; }
    showToast('✉️ Письмо отправлено на ' + _currentUser.email, 'success');
  };

  // Profile modal: logout
  var blp = document.getElementById('btn-logout-profile');
  if (blp) blp.onclick = async function() {
    await _SB.auth.signOut();
    // Очищаем активный проект — иначе следующий пользователь на этом устройстве
    // попытается загрузить чужой проект и приложение зависнет
    localStorage.removeItem('active_project_id');
    localStorage.removeItem('active_project_name');
    localStorage.removeItem('active_project_emoji');
    sessionStorage.removeItem('active_month');
    sessionStorage.removeItem('active_period');
    sessionStorage.removeItem('ai_chat_history');
    window.location.href = '/login';
  };

  // Settings modal close
  const btnSettingsClose = document.getElementById('btn-settings-close');

  // Language buttons
  document.querySelectorAll('[data-lang-set]').forEach(el => {
    el.onclick = () => { state.lang = el.dataset.langSet; saveToStorage(); render(); };
  });

  // Module toggles — patch DOM in-place, no render()
  document.querySelectorAll('[data-module]').forEach(el => {
    el.onchange = () => {
      if (!_settingsDraft) _openSettingsDraft();
      if (!_settingsDraft.enabledModules) _settingsDraft.enabledModules = Object.assign({}, state.enabledModules || {});
      _settingsDraft.enabledModules[el.dataset.module] = el.checked;
      _patchToggle(el);
    };
  });

  if (btnSettingsClose) btnSettingsClose.onclick = () => { state.showSettingsModal = false; _applySettingsDraft(); saveToStorage(); render(); };
  const settingsModalBg = document.getElementById('settings-modal-bg');
  if (settingsModalBg) settingsModalBg.onclick = e => { if (e.target === settingsModalBg) { state.showSettingsModal = false; _applySettingsDraft(); saveToStorage(); render(); } };

  // Currency toggles — patch DOM in-place, no render()
  document.querySelectorAll('[data-cur-toggle]').forEach(el => {
    el.onchange = () => {
      if (!_settingsDraft) _openSettingsDraft();
      const checked = [...document.querySelectorAll('[data-cur-toggle]:checked')].map(e => e.dataset.curToggle);
      _settingsDraft.enabledCurrencies = ['RUB', ...checked];
      _patchToggle(el);
    };
  });

  // Export JSON backup
  const btnExpJson = document.getElementById('btn-export-json');
  if (btnExpJson) btnExpJson.onclick = () => {
    const data = JSON.stringify({ transactions: state.transactions, accounts: state.accounts, funds: state.funds, fundHistory: state.fundHistory, directions: state.directions, dirCategories: state.dirCategories, enabledModules: state.enabledModules, partnerPayments: state.partnerPayments, rates: state.rates, enabledCurrencies: state.enabledCurrencies });
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'finance_backup_' + _localDateStr() + '.json';
    a.click();
  };

  // Import JSON backup
  const inpJson = document.getElementById('inp-import-json');
  if (inpJson) inpJson.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      try {
        const parsed = JSON.parse(ev.target.result);
        showConfirm('Загрузить данные из файла?\nТекущие данные будут заменены.', async () => {
          state.transactions    = parsed.transactions    || [];
          state.accounts        = parsed.accounts        || {};
          state.funds           = parsed.funds           || JSON.parse(JSON.stringify(INITIAL_FUNDS));
          state.fundHistory     = parsed.fundHistory     || [];
          state.directions      = parsed.directions      || {};
          state.dirCategories   = parsed.dirCategories   || {};
          state.partnerPayments = parsed.partnerPayments || {};
          state.rates           = parsed.rates           || state.rates;
          state.enabledCurrencies = parsed.enabledCurrencies || ['RUB','SAR','USDT'];
          state.enabledModules  = parsed.enabledModules  || { goals: false, budgets: false, spending: false, partners: false };
          state.showSettingsModal = false;
          DIRECTIONS = state.directions;
          state.dirOrder = [];
          state.transactions.forEach(t => { delete t.fromDirection; delete t.toDirection; });
          Object.values(state.accounts).forEach(a => { delete a.direction; });
          await cloudSave(getFullState());
          render();
        }, { okLabel: 'Загрузить', okStyle: 'ok' });
      } catch { showToast('Ошибка: неверный формат файла', 'error'); }
    };
    reader.readAsText(file);
  };
  const btnBack = document.getElementById('btn-back');
  if (btnBack) btnBack.onclick = () => { state.showProjectSwitcher = true; render(); };

  // Month selector: back to projects
  const btnToProjects = document.getElementById("btn-to-projects");
  if (btnToProjects) btnToProjects.onclick = () => { state.showProjectSwitcher = true; render(); };
  document.querySelectorAll('[data-month]').forEach(el => {
    el.onclick = () => { state.activeMonth = el.dataset.month; state.tab = 'overview'; render(); };
  });
  if (btnAdd) btnAdd.onclick = () => { state.showModePicker = true; render(); };

  // tabs
  document.querySelectorAll('[data-tab]').forEach(el => {
    el.onclick = () => { state.tab = el.dataset.tab; render(); };
  });

  // ── Tab drag-to-reorder ──────────────────────────────────────────────────
  (function() {
    const bar = document.getElementById('tabs-bar');
    if (!bar) return;
    let dragKey = null, dragEl = null;
    bar.querySelectorAll('[data-drag-tab]').forEach(el => {
      el.addEventListener('dragstart', e => {
        dragKey = el.dataset.dragTab;
        dragEl = el;
        el.style.opacity = '0.4';
        e.dataTransfer.effectAllowed = 'move';
      });
      el.addEventListener('dragend', () => {
        el.style.opacity = '';
        bar.querySelectorAll('[data-drag-tab]').forEach(b => b.style.outline = '');
        dragKey = null; dragEl = null;
      });
      el.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        bar.querySelectorAll('[data-drag-tab]').forEach(b => b.style.outline = '');
        if (el.dataset.dragTab !== dragKey) el.style.outline = '2px solid #6ee7b7';
      });
      el.addEventListener('dragleave', () => { el.style.outline = ''; });
      el.addEventListener('drop', e => {
        e.preventDefault();
        const toKey = el.dataset.dragTab;
        if (!dragKey || dragKey === toKey) return;
        const tabs = _orderedTabs().map(t => t[0]);
        const fromIdx = tabs.indexOf(dragKey);
        const toIdx   = tabs.indexOf(toKey);
        if (fromIdx < 0 || toIdx < 0) return;
        tabs.splice(fromIdx, 1);
        tabs.splice(toIdx, 0, dragKey);
        state.tabOrder = tabs;
        saveToStorage();
        render();
      });
    });

    // ── Touch drag support ──────────────────────────────────────────────────
    let touchDragKey = null, touchClone = null, touchStartX = 0;
    bar.querySelectorAll('[data-drag-tab]').forEach(el => {
      el.addEventListener('touchstart', e => {
        if (e.touches.length !== 1) return;
        touchDragKey = el.dataset.dragTab;
        touchStartX = e.touches[0].clientX;
        touchClone = el.cloneNode(true);
        touchClone.style.cssText = 'position:fixed;z-index:9999;opacity:0.8;pointer-events:none;border-radius:10px;background:#1a1a2e;border:1px solid #6ee7b7;padding:6px 12px;transition:none';
        const r = el.getBoundingClientRect();
        touchClone.style.top = r.top + 'px';
        touchClone.style.left = r.left + 'px';
        document.body.appendChild(touchClone);
        el.style.opacity = '0.3';
      }, { passive: true });
      el.addEventListener('touchmove', e => {
        if (!touchDragKey || !touchClone) return;
        e.preventDefault();
        const t = e.touches[0];
        touchClone.style.left = (t.clientX - 40) + 'px';
        touchClone.style.top  = (t.clientY - 20) + 'px';
        // Highlight target
        bar.querySelectorAll('[data-drag-tab]').forEach(b => b.style.outline = '');
        const under = document.elementFromPoint(t.clientX, t.clientY);
        const targetEl = under && under.closest('[data-drag-tab]');
        if (targetEl && targetEl.dataset.dragTab !== touchDragKey) targetEl.style.outline = '2px solid #6ee7b7';
      }, { passive: false });
      el.addEventListener('touchend', e => {
        if (!touchDragKey) return;
        const t = e.changedTouches[0];
        const under = document.elementFromPoint(t.clientX, t.clientY);
        const targetEl = under && under.closest('[data-drag-tab]');
        if (targetEl && targetEl.dataset.dragTab && targetEl.dataset.dragTab !== touchDragKey) {
          const toKey = targetEl.dataset.dragTab;
          const tabs = _orderedTabs().map(t => t[0]);
          const fromIdx = tabs.indexOf(touchDragKey);
          const toIdx   = tabs.indexOf(toKey);
          if (fromIdx >= 0 && toIdx >= 0) {
            tabs.splice(fromIdx, 1);
            tabs.splice(toIdx, 0, touchDragKey);
            state.tabOrder = tabs;
            saveToStorage();
          }
        }
        bar.querySelectorAll('[data-drag-tab]').forEach(b => { b.style.outline = ''; b.style.opacity = ''; });
        if (touchClone) { touchClone.remove(); touchClone = null; }
        touchDragKey = null;
        render();
      });
    });
  })();

  // filter buttons
  document.querySelectorAll('[data-filter]').forEach(el => {
    el.onclick = () => { state.activeDir = el.dataset.filter || null; state.activeAccount = null; render(); };
  });
  // account sub-tabs
  document.querySelectorAll('[data-acc]').forEach(el => {
    el.onclick = () => { state.activeAccount = el.dataset.acc; render(); };
  });
  document.querySelectorAll('[data-switch-month]').forEach(el => {
    el.onclick = () => { state.activeMonth = el.dataset.switchMonth; render(); };
  });
  document.querySelectorAll('[data-pnl-month]').forEach(el => {
    el.onclick = () => { state.activeMonth = el.dataset.pnlMonth; render(); };
  });

  // TYPE FILTER handled via inline onclick on buttons

  // ── SEARCH ──
  const txSearchEl = document.getElementById('tx-search');
  if (txSearchEl) {
    txSearchEl.oninput = (e) => {
      const val = e.target.value;
      const pos = e.target.selectionStart;
      state.txSearch = val;
      render();
      // Restore focus and cursor after re-render
      const el2 = document.getElementById('tx-search');
      if (el2) { el2.focus(); try { el2.setSelectionRange(pos, pos); } catch(_){} }
    };
    txSearchEl.onclick = e => e.stopPropagation();
  }

  // ── ADV FILTER TOGGLE ──
  const btnAdvFilter = document.getElementById('btn-adv-filter');
  if (btnAdvFilter) btnAdvFilter.onclick = () => { state.showTxAdvFilter = !state.showTxAdvFilter; render(); };

  // ── ADV FILTER CONTROLS ──
  const btnCatPicker = document.getElementById('btn-cat-picker');
  if (btnCatPicker) btnCatPicker.onclick = (e) => { e.stopPropagation(); state.showCatPicker = !state.showCatPicker; render(); };

  const catPickAll  = document.getElementById('cat-pick-all');
  const catPickNone = document.getElementById('cat-pick-none');
  if (catPickAll)  catPickAll.onclick  = (e) => { e.stopPropagation(); const all=[...getDirCats('_global','in'),...getDirCats('_global','out'),...CATEGORIES_DDS,...CATEGORIES_DIVIDENDS,...new Set(state.transactions.filter(t=>t.type==='dividend').map(t=>t.category).filter(Boolean))]; state.txCatFilter=[...new Set(all)]; render(); };
  if (catPickNone) catPickNone.onclick = (e) => { e.stopPropagation(); state.txCatFilter=[]; render(); };

  document.querySelectorAll('[data-cat-check]').forEach(el => {
    el.onchange = () => {
      const cat = el.dataset.catCheck;
      if (!Array.isArray(state.txCatFilter)) state.txCatFilter = [];
      if (el.checked) { if (!state.txCatFilter.includes(cat)) state.txCatFilter.push(cat); }
      else state.txCatFilter = state.txCatFilter.filter(c => c !== cat);
      render();
    };
  });

  // Close cat picker on outside click
  if (state.showCatPicker) {
    setTimeout(() => {
      const closeOnClick = (e) => {
        const dp = document.getElementById('cat-picker-dropdown');
        const btn = document.getElementById('btn-cat-picker');
        if (dp && !dp.contains(e.target) && btn && !btn.contains(e.target)) {
          state.showCatPicker = false; render();
          document.removeEventListener('click', closeOnClick);
        }
      };
      document.addEventListener('click', closeOnClick);
    }, 0);
  }
  const txDateFrom = document.getElementById('tx-date-from');
  if (txDateFrom) txDateFrom.onchange = e => { state.txDateFrom = e.target.value; render(); };
  const txDateTo = document.getElementById('tx-date-to');
  if (txDateTo) txDateTo.onchange = e => { state.txDateTo = e.target.value; render(); };
  const txFilterReset = document.getElementById('tx-filter-reset');
  if (txFilterReset) txFilterReset.onclick = () => { state.txCatFilter=[]; state.txDateFrom=''; state.txDateTo=''; state.txSearch=''; render(); };

  // ── EXCEL EXPORT ──
  const btnExportExcel = document.getElementById('btn-export-excel');
  if (btnExportExcel) btnExportExcel.onclick = () => { state.showExportModal = true; render(); };

  const expModalClose = document.getElementById('export-modal-close');
  const expModalBg    = document.getElementById('export-modal-bg');
  if (expModalClose) expModalClose.onclick = () => { state.showExportModal = false; render(); };
  if (expModalBg)    expModalBg.onclick = e => { if (e.target === expModalBg) { state.showExportModal = false; render(); } };

  // Export dir/acc checkboxes
  document.querySelectorAll('[data-exp-acc]').forEach(el => {
    el.onchange = () => {
      const k = el.dataset.expAcc;
      if (!state.exportAccs) state.exportAccs = [];
      if (el.checked) { if (!state.exportAccs.includes(k)) state.exportAccs.push(k); }
      else state.exportAccs = state.exportAccs.filter(a => a !== k);
    };
  });
  document.querySelectorAll('[data-exp-sel-acc]').forEach(el => {
    el.onclick = () => {
      const v = el.dataset.expSelAcc;
      state.exportAccs = v === 'all' ? Object.keys(state.accounts) : [];
      render();
    };
  });
  const expDateFrom = document.getElementById('exp-date-from');
  const expDateTo   = document.getElementById('exp-date-to');
  const expShowBal  = document.getElementById('exp-show-balances');
  if (expDateFrom) expDateFrom.onchange = e => { state.exportDateFrom = e.target.value; };
  if (expDateTo)   expDateTo.onchange   = e => { state.exportDateTo   = e.target.value; };
  if (expShowBal)  expShowBal.onchange  = e => { state.exportShowBalances = e.target.checked; };

  const btnExportGo = document.getElementById('btn-export-go');
  if (btnExportGo) btnExportGo.onclick = () => {
    const fmt2 = document.querySelector('input[name="exp-format"]:checked')?.value || 'excel';
    if (fmt2 === 'pdf') { doExportPdf(); return; }
    // Excel export using SheetJS
    try {
      const accs  = state.exportAccs && state.exportAccs.length ? state.exportAccs : Object.keys(state.accounts);
      const from  = state.exportDateFrom || null;
      const to    = state.exportDateTo   || null;
      let txs = state.transactions.filter(t => {
        if (from && t.date < from) return false;
        if (to   && t.date > to)   return false;
        if (t.type === 'transfer' || t.isTransfer) {
          return accs.includes(t.fromAccount) || accs.includes(t.toAccount);
        }
        return accs.includes(t.account);
      }).sort((a,b) => a.date < b.date ? -1 : 1);

      const rows = [['Дата','Тип','Счёт','Категория','Сумма','Валюта','Примечание']];
      txs.forEach(t => {
        if (t.isTransfer || t.type === 'transfer') {
          const fAcc = state.accounts[t.fromAccount];
          const tAcc = state.accounts[t.toAccount];
          rows.push([t.date,'Перевод',
            (fAcc?fAcc.name:t.fromAccount)+' → '+(tAcc?tAcc.name:t.toAccount),
            t.category||'',
            t.fromAmount, t.fromCurrency||'RUB', t.note||'']);
        } else {
          const acc = state.accounts[t.account];
          rows.push([t.date,
            t.type==='income'?'Доход':t.type==='expense'?'Расход':'Дивиденды',
            acc?acc.name:t.account,
            t.category||'', t.amount, t.currency||'RUB', t.note||'']);
        }
      });

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = [10,12,18,20,12,8,25].map(w=>({wch:w}));
      XLSX.utils.book_append_sheet(wb, ws, 'Операции');

      if (state.exportShowBalances !== false) {
        const balRows = [['Счёт','Баланс','Валюта']];
        Object.entries(state.accounts).forEach(([k,a]) => {
          balRows.push([a.name, a.balance, a.currency||'RUB']);
        });
        const ws2 = XLSX.utils.aoa_to_sheet(balRows);
        XLSX.utils.book_append_sheet(wb, ws2, 'Балансы');
      }

      const month = state.activeMonth || new Date().toISOString().slice(0,7);
      XLSX.writeFile(wb, 'finance_' + month + '.xlsx');
      state.showExportModal = false; render();
    } catch(e) { showToast('Ошибка экспорта: ' + e.message, 'error'); }
  };
  // add account button
  const btnAddAcc = document.getElementById('btn-add-acc');
  if (btnAddAcc) btnAddAcc.onclick = () => {
    state.addAccForm = { name:'', currency:'RUB', emoji:'💳', color:'#a78bfa' };
    state.showAddAccModal = true;
    render();
  };

  // edit account gear buttons
  document.querySelectorAll('[data-acc-edit]').forEach(el => {
    el.onclick = (e) => {
      e.stopPropagation();
      state.editAccKey = el.dataset.accEdit;
      state.showEditAccModal = true;
      render();
    };
  });

  // add account modal
  const addAccClose = document.getElementById('add-acc-close');
  const addAccBg    = document.getElementById('add-acc-modal-bg');
  if (addAccClose) addAccClose.onclick = () => { state.showAddAccModal=false; render(); };
  if (addAccBg)    addAccBg.onclick = e => { if(e.target===addAccBg){state.showAddAccModal=false;render();} };
  document.querySelectorAll('[data-nacc-color]').forEach(el => {
    el.onclick = () => {
      state.addAccForm.color = el.dataset.naccColor;
      document.querySelectorAll('[data-nacc-color]').forEach(e => {
        e.style.border = e.dataset.naccColor === el.dataset.naccColor ? '3px solid #fff' : '3px solid transparent';
      });
    };
  });
  const btnNaccSubmit = document.getElementById('btn-nacc-submit');
  if (btnNaccSubmit) btnNaccSubmit.onclick = () => {
    const emoji = (document.getElementById('nacc-emoji')||{}).value || '💳';
    const name  = (document.getElementById('nacc-name')||{}).value || '';
    const cur   = (document.getElementById('nacc-currency')||{}).value || 'RUB';
    if (!name) { showToast('Введи название счёта', 'error'); return; }
    const key = 'acc_' + Date.now();
    state.accounts[key] = { name: (emoji+' '+name).trim(), currency: cur, balance: 0, color: state.addAccForm.color };
    saveToStorage();
    state.showAddAccModal = false;
    render();
  };

  // edit account modal
  const editAccClose = document.getElementById('edit-acc-close');
  const editAccBg    = document.getElementById('edit-acc-modal-bg');
  if (editAccClose) editAccClose.onclick = () => { state.showEditAccModal=false; render(); };
  if (editAccBg)    editAccBg.onclick = e => { if(e.target===editAccBg){state.showEditAccModal=false;render();} };
  document.querySelectorAll('[data-eacc-color]').forEach(el => {
    el.onclick = () => {
      state._editAccColor = el.dataset.eaccColor;
      document.querySelectorAll('[data-eacc-color]').forEach(e => {
        e.style.border = e.dataset.eaccColor === el.dataset.eaccColor ? '3px solid #fff' : '3px solid transparent';
      });
    };
  });
  const btnEaccSave = document.getElementById('btn-eacc-save');
  if (btnEaccSave) btnEaccSave.onclick = () => {
    const k = state.editAccKey;
    if (!k || !state.accounts[k]) return;
    const emoji = (document.getElementById('eacc-emoji')||{}).value || '';
    const name  = (document.getElementById('eacc-name')||{}).value || '';
    const cur   = (document.getElementById('eacc-currency')||{}).value || 'RUB';
    state.accounts[k].name      = (emoji+' '+name).trim();
    state.accounts[k].currency  = cur;
    if (state._editAccColor) { state.accounts[k].color = state._editAccColor; state._editAccColor = null; }
    saveToStorage();
    state.showEditAccModal = false;
    render();
  };
  const btnEaccDel = document.getElementById('btn-eacc-delete');
  if (btnEaccDel) btnEaccDel.onclick = async () => {
    const _acc = state.accounts[state.editAccKey];
    if (_acc && Math.abs(_acc.balance) > 0.001) {
      showToast('Нельзя удалить счёт с ненулевым балансом (' + fmt(_acc.balance, _acc.currency) + ').\nСначала обнули баланс.', 'error');
      return;
    }
    if (!await confirmAsync('Удалить счёт?\nОперации по нему останутся.', { okLabel: 'Удалить' })) return;
    delete state.accounts[state.editAccKey];
    saveToStorage();
    state.showEditAccModal = false;
    render();
  };

  // history button
  document.querySelectorAll('[data-acc-history]').forEach(el => {
    el.onclick = () => {
      state.tab = 'transactions';
      state.activeDir = null;
      state.activeAccount = el.dataset.accHistory;
      render();
    };
  });

  // account buttons (transfer / income / expense)
  document.querySelectorAll('[data-acc-action]').forEach(el => {
    el.onclick = () => {
      const action = el.dataset.accAction;
      const accKey = el.dataset.accKey;
      const acc    = state.accounts[accKey] || {};
      if (action === 'transfer') {
        const toKey = Object.keys(state.accounts).find(k => k !== accKey) || '';
        state.accForm = { fromKey: accKey, toKey, fromAmount: '', toAmount: '', note: '', date: _localDateStr() };
        state.showAccModal = true;
        render();
      } else {
        // Pre-fill transaction modal with type + account
        // catList handled via getDirCats in modal render
        state.form = {
          date: _localDateStr(),
          type: action,
          account: accKey,
          amount: '',
          currency: acc.currency || 'RUB',
          category: '',
          note: '',
        };
        state.showModal = true;
        render();
      }
    };
  });
  // acc modal close
  const acmc = document.getElementById('acc-modal-close');
  const acmbg = document.getElementById('acc-modal-bg');
  if (acmc) acmc.onclick = () => { state.showAccModal = false; render(); };
  if (acmbg) acmbg.onclick = e => { if (e.target===acmbg) { state.showAccModal=false; render(); } };
  // acc modal inputs
  // acc modal inputs are read directly from DOM on submit
  const btnAccSubmit = document.getElementById('btn-acc-submit');
  if (btnAccSubmit) btnAccSubmit.onclick = () => {
    // Read everything fresh from DOM
    const fromKey    = state.accForm.fromKey;
    const toKey      = (document.getElementById('af-to') || {}).value || state.accForm.toKey;
    const fromAmtVal = getRawValue(document.getElementById('af-from-amount'));
    const toAmtVal   = getRawValue(document.getElementById('af-to-amount'));
    const dateVal    = (document.getElementById('af-date') || {}).value;
    const noteVal    = (document.getElementById('af-note') || {}).value || '';
    const catVal     = (document.getElementById('af-category') || {}).value || 'Перевод между счетами';

    if (!fromAmtVal || parseFloat(fromAmtVal) <= 0) { showToast('Введи сумму списания', 'error'); return; }

    const fromAcc = state.accounts[fromKey];
    const toAcc   = state.accounts[toKey];
    if (!fromAcc || !toAcc) { showToast('Счёт не найден', 'error'); return; }

    const fromAmt = parseFloat(fromAmtVal);
    const balErrQ = checkSufficientBalance(fromKey, fromAmt);
    if (balErrQ) { showToast(balErrQ, 'error'); return; }
    const sameCur = fromAcc.currency === toAcc.currency;
    const toAmt   = (toAmtVal && parseFloat(toAmtVal) > 0) ? parseFloat(toAmtVal) : (sameCur ? fromAmt : 0);
    if (toAmt <= 0) { showToast('Введи сумму зачисления', 'error'); return; }

    const date = dateVal || _localDateStr();
    const note = noteVal || '';
    const id   = Date.now().toString() + '_' + Math.random().toString(36).slice(2, 7);

    // Update balances
    fromAcc.balance -= fromAmt;
    toAcc.balance   += toAmt;

    // Create ONE unified transfer transaction
    state.transactions.push({
      id: 'tr_'+id,
      date, type: 'transfer',
      fromAccount: fromKey, toAccount: toKey,
      fromDirection: fromAcc.direction, toDirection: toAcc.direction,
      fromAmount: fromAmt, toAmount: toAmt,
      fromCurrency: fromAcc.currency, toCurrency: toAcc.currency,
      category: catVal, note, createdAt: Date.now(), createdAtMs: Date.now(), updatedAtMs: null,
      isTransfer: true
    });

    saveToStorage();
    state.showAccModal = false;
    render();
  };

  // fund action buttons
  document.querySelectorAll('[data-fund-action]').forEach(el => {
    el.onclick = () => {
      const defaultDate = _localDateStr(); // always today
      const firstAccKey = Object.keys(state.accounts)[0] || '';
      state.fundForm = { fund: el.dataset.fundKey, type: el.dataset.fundAction, amount: '', note: '', date: defaultDate, account: firstAccKey };
      state.showFundModal = true;
      render();
    };
  });

  // fund history button
  document.querySelectorAll('[data-fund-history]').forEach(el => {
    el.onclick = () => {
      state.tab = 'transactions';
      state.activeDir = 'funds';
      state.activeAccount = el.dataset.fundHistory;
      render();
    };
  });

  // add fund button
  const btnAddFund = document.getElementById('btn-add-fund');
  if (btnAddFund) btnAddFund.onclick = () => {
    state.addFundForm = { name:'', currency:'RUB', emoji:'💰', color:'#a78bfa' };
    state.showAddFundModal = true;
    render();
  };
  const addFundClose = document.getElementById('add-fund-close');
  const addFundBg    = document.getElementById('add-fund-modal-bg');
  if (addFundClose) addFundClose.onclick = () => { state.showAddFundModal=false; render(); };
  if (addFundBg)    addFundBg.onclick = e => { if(e.target===addFundBg){state.showAddFundModal=false;render();} };
  document.querySelectorAll('[data-nfund-color]').forEach(el => {
    el.onclick = () => {
      state.addFundForm.color = el.dataset.nfundColor;
      document.querySelectorAll('[data-nfund-color]').forEach(e => {
        e.style.border = e.dataset.nfundColor === el.dataset.nfundColor ? '3px solid #fff' : '3px solid transparent';
      });
    };
  });
  const btnNfundSubmit = document.getElementById('btn-nfund-submit');
  if (btnNfundSubmit) btnNfundSubmit.onclick = () => {
    const emoji = (document.getElementById('nfund-emoji')||{}).value || '💰';
    const name  = (document.getElementById('nfund-name')||{}).value || '';
    const cur   = (document.getElementById('nfund-currency')||{}).value || 'RUB';
    if (!name) { showToast('Введи название фонда', 'error'); return; }
    const key = 'fund_' + Date.now();
    state.funds[key] = { name, icon: emoji, currency: cur, balance: 0, color: state.addFundForm.color };
    saveToStorage();
    state.showAddFundModal = false;
    render();
  };

  // edit fund gear buttons
  document.querySelectorAll('[data-fund-edit]').forEach(el => {
    el.onclick = (e) => {
      e.stopPropagation();
      state.editFundKey = el.dataset.fundEdit;
      state.showEditFundModal = true;
      render();
    };
  });
  const editFundClose = document.getElementById('edit-fund-close');
  const editFundBg    = document.getElementById('edit-fund-modal-bg');
  if (editFundClose) editFundClose.onclick = () => { state.showEditFundModal=false; render(); };
  if (editFundBg)    editFundBg.onclick = e => { if(e.target===editFundBg){state.showEditFundModal=false;render();} };
  document.querySelectorAll('[data-efund-color]').forEach(el => {
    el.onclick = () => {
      state._editFundColor = el.dataset.efundColor;
      document.querySelectorAll('[data-efund-color]').forEach(e => {
        e.style.border = e.dataset.efundColor === el.dataset.efundColor ? '3px solid #fff' : '3px solid transparent';
      });
    };
  });
  const btnEfundSave = document.getElementById('btn-efund-save');
  if (btnEfundSave) btnEfundSave.onclick = () => {
    const k = state.editFundKey;
    if (!k || !state.funds[k]) return;
    state.funds[k].icon     = (document.getElementById('efund-emoji')||{}).value || '💰';
    state.funds[k].name     = (document.getElementById('efund-name')||{}).value || '';
    state.funds[k].currency = (document.getElementById('efund-currency')||{}).value || 'RUB';
    if (state._editFundColor) { state.funds[k].color = state._editFundColor; state._editFundColor = null; }
    saveToStorage();
    state.showEditFundModal = false;
    render();
  };
  const btnEfundDel = document.getElementById('btn-efund-delete');
  if (btnEfundDel) btnEfundDel.onclick = async () => {
    const _fund = state.funds[state.editFundKey];
    if (_fund && Math.abs(_fund.balance) > 0.001) {
      showToast('Нельзя удалить фонд с ненулевым балансом (' + fmt(_fund.balance, _fund.currency || 'RUB') + ').\nСначала выведи все средства.', 'error');
      return;
    }
    if (!await confirmAsync('Удалить фонд?\nИстория пополнений останется.', { okLabel: 'Удалить' })) return;
    delete state.funds[state.editFundKey];
    saveToStorage();
    state.showEditFundModal = false;
    render();
  };
  // fund modal
  const fmc = document.getElementById('fund-modal-close');
  const fmbg = document.getElementById('fund-modal-bg');
  if (fmc) fmc.onclick = () => { state.showFundModal = false; render(); };
  if (fmbg) fmbg.onclick = e => { if (e.target===fmbg) { state.showFundModal=false; render(); } };
  // fund modal inputs read directly from DOM on submit
  const btnFundSubmit = document.getElementById('btn-fund-submit');
  if (btnFundSubmit) btnFundSubmit.onclick = () => {
    // Read all values from DOM directly
    const fundKey  = (document.getElementById('ff-fund')   ||{}).value || state.fundForm.fund;
    const accKey   = (document.getElementById('ff-account')||{}).value || state.fundForm.account;
    const amtVal   = getRawValue(document.getElementById('ff-amount'));
    const noteVal  = (document.getElementById('ff-note')   ||{}).value || '';
    const dateEl   =  document.getElementById('ff-date');
    const txType   = state.fundForm.type; // 'in' or 'out'

    if (!amtVal || parseFloat(amtVal) <= 0) { showToast('Введи сумму', 'error'); return; }
    if (accKey === 'fund:' + fundKey) { showToast('Нельзя переводить фонд на самого себя', 'error'); return; }
    const amt  = parseFloat(amtVal);
    // Check balance on the source side
    const fundSrcKey = txType === 'in' ? accKey : 'fund:' + fundKey;
    const balErrF = checkSufficientBalance(fundSrcKey, amt);
    if (balErrF) { showToast(balErrF, 'error'); return; }
    const fund = state.funds[fundKey];
    const acc  = state.accounts[accKey];
    if (!fund) { showToast('Фонд не найден', 'error'); return; }

    const rawDate = (dateEl && dateEl.value) ? dateEl.value : '';
    // If date is outside activeMonth, force it into activeMonth
    const date = rawDate || _localDateStr(); // use entered date as-is

    // Update fund balance
    if (txType === 'in') fund.balance += amt;
    else fund.balance = Math.max(0, fund.balance - amt);

    // Update linked account balance
    if (acc) {
      if (txType === 'in') acc.balance -= amt;
      else acc.balance += amt;
    }

    const id = 'f_' + Date.now().toString();
    const accDir = acc ? acc.direction : Object.keys(DIRECTIONS)[0]||'';
    const cur = fund.currency || 'RUB';
    const noteAcc  = `→ ${fund.icon} ${fund.name}${noteVal?' — '+noteVal:''}`;
    const noteFund = `← ${acc ? acc.name : accKey}${noteVal?' — '+noteVal:''}`;

    // Single record per fund operation — visible in all views
    const fromAccKey2 = txType === 'in' ? accKey : 'fund:' + fundKey;
    const toAccKey2   = txType === 'in' ? 'fund:' + fundKey : accKey;
    const txNote = noteVal || '';

    state.transactions.push({
      id: 'fa_' + id,
      date,
      type: 'transfer',
      isTransfer: true,
      direction: accDir,
      fromAccount: fromAccKey2,
      toAccount: toAccKey2,
      fromAmount: amt,
      toAmount: amt,
      fromCurrency: cur,
      toCurrency: cur,
      account: accKey,
      amount: amt,
      currency: cur,
      category: txType === 'in' ? 'Пополнение фонда' : 'Вывод из фонда',
      note: txNote,
      fundKey,
      isFund: true,
      createdAt: Date.now(),
      createdAtMs: Date.now(),
      updatedAtMs: null,
    });

    // Fund history entry
    state.fundHistory.push({ fund: fundKey, type: txType, amount: amt, note: noteVal, date, id, account: accKey });


    saveToStorage();
    state.showFundModal = false;
    render();
  };

  // modal
  const mc = document.getElementById('modal-close');
  const mb = document.getElementById('modal-bg');
  if (mc) mc.onclick = () => { state.showModal = false; render(); };
  if (mb) mb.onclick = (e) => { if (e.target === mb) { state.showModal = false; render(); } };

  // form live update
  ['f-type','f-date','f-account','f-to-account','f-amount','f-to-amount','f-currency','f-category','f-note','f-div-partner'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.oninput = el.onchange = () => {
      const key = id.replace('f-','').replace('-','_');
      if (id === 'f-div-partner') { state.form.divPartnerId = el.value; render(); return; }
      state.form[id.replace('f-','')] = (id === 'f-amount' || id === 'f-to-amount') ? el.value.replace(/\s/g,'') : el.value;
      if (id === 'f-type') {
        state.form.category = '';
        render();
      }
      if (id === 'f-account') {
        const acc = state.accounts[el.value];
        if (acc) state.form.currency = acc.currency;
        if (state.form.type === 'transfer') {
          // Reset toAccount if it's same as new fromAccount
          if (state.form.toAccount === el.value) {
            const other = Object.keys(state.accounts).find(k => k !== el.value);
            state.form.toAccount = other || '';
          }
          render();
        }
      }
    };
  });

  // submit — read everything from DOM to avoid stale state
  const sub = document.getElementById('btn-submit');
  if (sub) sub.onclick = () => {
    const get = id => (document.getElementById(id)||{}).value || '';
    const type      = get('f-type')      || state.form.type;
    const date      = get('f-date')      || state.form.date;
    const account   = get('f-account')  || state.form.account;
    const currency  = get('f-currency') || state.form.currency;
    const category  = get('f-category') || state.form.category;
    const note      = get('f-note');
    const rawAmt    = get('f-amount').replace(/\s/g,'');

    if (!rawAmt || parseFloat(rawAmt) <= 0) { showToast('Укажи сумму', 'error'); return; }
    if (!category && type !== 'dividend') { showToast('Выбери категорию', 'error'); return; }

    const id = Date.now().toString() + '_' + Math.random().toString(36).slice(2, 7);

    if (type === 'transfer') {
      const toKey    = get('f-to-account') || state.form.toAccount;
      const toAmtRaw = get('f-to-amount').replace(/\s/g,'');
      const fromAcc  = state.accounts[account];
      const toAcc    = state.accounts[toKey];
      if (!fromAcc || !toAcc) { showToast('Выбери оба счёта', 'error'); return; }
      const fromAmt = parseFloat(rawAmt);
      const balErr1 = checkSufficientBalance(account, fromAmt);
      if (balErr1) { showToast(balErr1, 'error'); return; }
      const toAmt   = toAmtRaw && parseFloat(toAmtRaw) > 0 ? parseFloat(toAmtRaw) : fromAmt;
      fromAcc.balance -= fromAmt;
      toAcc.balance   += toAmt;
      state.transactions.push({
        id: 'tr_'+id, date, type: 'transfer',
        fromAccount: account, toAccount: toKey,
        fromDirection: fromAcc.direction, toDirection: toAcc.direction,
        fromAmount: fromAmt, toAmount: toAmt,
        fromCurrency: currency, toCurrency: toAcc.currency,
        category, note, createdAt: Date.now(), createdAtMs: Date.now(), updatedAtMs: null, isTransfer: true
      });
    } else if (type === 'dividend') {
      const divPartnerId = (document.getElementById('f-div-partner')||{}).value || '';
      const firstDirKey = Object.keys(DIRECTIONS)[0] || '';
      const dir = DIRECTIONS[firstDirKey] || {};
      const partner = (dir.partners||[]).find(p => p.id === divPartnerId);
      const partnerName = partner ? partner.name : '—';
      const isOwner = partner?.isOwner || false;
      const acc = state.accounts[account];
      if (!acc) { showToast('Счёт не найден', 'error'); return; }
      const amt = parseFloat(rawAmt);
      const balErrDiv = checkSufficientBalance(account, amt);
      if (balErrDiv) { showToast(balErrDiv, 'error'); return; }
      acc.balance -= amt;
      const _manNow = Date.now();
      const ppId = 'pp_manual_' + _manNow;
      const txId = 'tr_' + id;
      // Save to partnerPayments
      if (partner) {
        if (!state.partnerPayments[firstDirKey]) state.partnerPayments[firstDirKey] = {};
        if (!state.partnerPayments[firstDirKey][divPartnerId]) state.partnerPayments[firstDirKey][divPartnerId] = [];
        state.partnerPayments[firstDirKey][divPartnerId].push({
          id: ppId, txId, date, amount: amt, currency, note,
          account, createdAtMs: _manNow, isOwnerDividend: isOwner,
        });
      }
      state.transactions.push({
        id: txId, date, type: 'dividend',
        direction: firstDirKey, account,
        amount: amt, currency,
        category: isOwner ? 'Дивиденды собственника' : 'Дивиденды партнёру',
        note: note || (isOwner ? 'Дивиденды собственника' : 'Выплата: ' + partnerName),
        createdAt: _manNow, createdAtMs: _manNow, updatedAtMs: null,
        partnerPayId: ppId, partnerId: divPartnerId, partnerDirKey: firstDirKey,
        linkedIncomeTxId: null,
      });
    } else {
      const deductAmt = parseFloat(rawAmt);
      if (type === 'expense') {
        const balErr2 = checkSufficientBalance(account, deductAmt);
        if (balErr2) { showToast(balErr2, 'error'); return; }
      }
      const tx = {
        id, date, type, account,
        direction: _projectId || '',
        amount: deductAmt,
        currency, category, note,
        createdAt: Date.now(), createdAtMs: Date.now(), updatedAtMs: null,
      };
      state.transactions.push(tx);
      const acc = state.accounts[tx.account];
      if (acc) {
        if (tx.type === 'income') acc.balance += tx.amount;
        else acc.balance -= tx.amount;
      }
    }

    saveToStorage();
    state.showModal = false;
    state.form = defaultForm();
    render();
  };

  // cat editor
  document.querySelectorAll('[data-cat-edit]').forEach(el => {
    el.onclick = e => {
      e.stopPropagation();
      state.showCatEditor = { dirKey: el.dataset.catEdit, type: el.dataset.catType };
      render();
    };
  });
  const catEditorClose = document.getElementById('cat-editor-close');
  const catEditorBg    = document.getElementById('cat-editor-bg');
  if (catEditorClose) catEditorClose.onclick = () => { state.showCatEditor = null; render(); };
  if (catEditorBg)    catEditorBg.onclick = e => { if(e.target===catEditorBg){state.showCatEditor=null;render();} };

  // tx detail modal close
  const txDetailBg = document.getElementById('tx-detail-bg');
  const txDetailClose = document.getElementById('tx-detail-close');
  if (txDetailBg)    txDetailBg.onclick    = e => { if(e.target===txDetailBg){state.showTxDetail=null;render();} };
  if (txDetailClose) txDetailClose.onclick = () => { state.showTxDetail=null; render(); };

  // edit tx modal close
  const editTxBg = document.getElementById('edit-tx-bg');
  const editTxClose = document.getElementById('edit-tx-close');
  if (editTxBg)    editTxBg.onclick    = e => { if(e.target===editTxBg){state.showEditTxModal=null;render();} };
  if (editTxClose) editTxClose.onclick = () => { state.showEditTxModal=null; render(); };
  // btn-etx-save handled via onclick="_saveEditedTx()" in HTML
  // delete cat row
  document.querySelectorAll('[data-cat-del]').forEach(el => {
    if (el.disabled) return;
    el.onclick = () => {
      const { dirKey, type } = state.showCatEditor;
      const idx = parseInt(el.dataset.catDel);
      const cats = getCatsForDir(dirKey, type);
      cats.splice(idx, 1);
      syncCatState();
      render();
    };
  });
  // add new cat
  const catNewAdd = document.getElementById('cat-new-add');
  if (catNewAdd) catNewAdd.onclick = () => {
    const inp = document.getElementById('cat-new-input');
    const val = inp ? inp.value.trim() : '';
    if (!val) return;
    const { dirKey, type } = state.showCatEditor;
    const cats = getCatsForDir(dirKey, type);
    const lower = val.toLowerCase();
    const exact = cats.find(c => c.toLowerCase() === lower);
    if (exact) {
      inp.style.borderColor = '#f87171';
      inp.title = 'Такая категория уже есть: «' + exact + '»';
      setTimeout(() => { inp.style.borderColor = ''; inp.title = ''; }, 2500);
      return;
    }
    cats.push(val);
    syncCatState();
    render();
  };
  // save all (renames)
  const catSaveAll = document.getElementById('cat-save-all');
  if (catSaveAll) catSaveAll.onclick = () => {
    const { dirKey, type } = state.showCatEditor;
    const cats = getCatsForDir(dirKey, type);
    document.querySelectorAll('[data-cat-rename]').forEach(inp => {
      const idx = parseInt(inp.dataset.catRename);
      const newName = inp.value.trim();
      if (newName && cats[idx] !== undefined) {
        const oldName = cats[idx];
        // rename in transactions too
        state.transactions.forEach(t => { if (t.category === oldName) t.category = newName; });
        cats[idx] = newName;
      }
    });
    syncCatState();
    saveToStorage();
    state.showCatEditor = null;
    render();
  };

  // all partner interactions handled via document delegation at bottom of file

  // rates modal
  const rc = document.getElementById('rates-close');
  const rb = document.getElementById('rates-bg');
  if (rc) rc.onclick = () => { state.showRates = false; render(); };
  if (rb) rb.onclick = (e) => { if (e.target === rb) { state.showRates = false; render(); } };

  const refreshRatesBtn = document.getElementById('btn-refresh-rates');
  if (refreshRatesBtn) refreshRatesBtn.onclick = async () => {
    refreshRatesBtn.textContent = '⏳ Загружаю...';
    refreshRatesBtn.disabled = true;
    await fetchLiveRates();
    render();
  };
  const settingsRefreshBtn = document.getElementById('btn-settings-refresh-rates');
  if (settingsRefreshBtn) settingsRefreshBtn.onclick = async () => {
    settingsRefreshBtn.textContent = '⏳...';
    settingsRefreshBtn.disabled = true;
    await fetchLiveRates();
    render();
  };

  // ── Mode Picker buttons ──
  const modePickerClose = document.getElementById('mode-picker-close');
  const modePickerBg    = document.getElementById('mode-picker-bg');
  const modeManual      = document.getElementById('mode-manual');
  const modeAi          = document.getElementById('mode-ai');
  if (modePickerClose) modePickerClose.onclick = () => { state.showModePicker = false; render(); };
  if (modePickerBg)    modePickerBg.onclick = (e) => { if (e.target === modePickerBg) { state.showModePicker = false; render(); } };
  if (modeManual) modeManual.onclick = () => {
    state.showModePicker = false;
    state.showModal = true;
    state.form = { type:'expense', date: _localDateStr(), direction: Object.keys(state.directions)[0]||'', account:'', currency:'RUB', category:'', note:'', amount:'', toAccount:'', toAmount:'' };
    render();
  };
  if (modeAi) modeAi.onclick = () => {
    state.showModePicker = false;
    state.showAiChat = true;
    if (!state.aiMessages || state.aiMessages.length === 0) {
      state.aiMessages = [{ role: 'assistant', text: 'Привет! Опиши операции текстом, голосом или прикрепи скриншот выписки 📎' }];
    }
    document.body.style.overflow = 'hidden';
    render();
    scrollAiToBottom();
  };

  // ── AI Chat buttons ──
  const aiChatClose  = document.getElementById('ai-chat-close');
  const aiChatBg     = document.getElementById('ai-chat-bg');
  const aiSendBtn    = document.getElementById('ai-send-btn');
  const aiVoiceBtn2  = document.getElementById('ai-voice-btn');
  const aiConfirmBtn = document.getElementById('ai-confirm-txs');
  const aiDiscardBtn = document.getElementById('ai-discard-txs');

  const aiChatClear = document.getElementById('ai-chat-clear');
  if (aiChatClear) aiChatClear.onclick = async () => {
    if (!await confirmAsync('Очистить историю чата с AI?', { okLabel: 'Очистить' })) return;
    state.aiMessages = [];
    state.aiPendingTxs = [];
    state.aiEditingIdx = null;
    state.aiActiveImage = null;
    state.aiActiveImageMt = null;
    try { sessionStorage.removeItem('ai_chat_history'); } catch(e) {}
    render();
    scrollAiToBottom();
  };
  if (aiChatClose) aiChatClose.onclick = () => {
    state.showAiChat = false; state.aiPendingTxs = [];
    state.aiActiveImage = null; state.aiActiveImageMt = null;
    document.body.style.overflow = '';
    render();
  };
  if (aiChatBg) aiChatBg.onclick = (e) => {
    if (e.target === aiChatBg) {
      state.showAiChat = false; state.aiPendingTxs = [];
      document.body.style.overflow = '';
      render();
    }
  };
  if (aiSendBtn) aiSendBtn.onclick = () => {
    const inp = document.getElementById('ai-text-input');
    const text = inp ? inp.value.trim() : '';
    if (text) { inp.value = ''; inp.style.height = '42px'; sendAiMessage(text, null); }
  };
  if (aiVoiceBtn2) aiVoiceBtn2.onclick = () => startVoiceInput();

  // ── Категории — вешаем сразу, независимо от pending txs ──
  const confirmCatsBtnD = document.getElementById('btn-confirm-cats');
  if (confirmCatsBtnD) confirmCatsBtnD.onclick = () => confirmAiCats();
  const rejectCatsBtnD = document.getElementById('btn-reject-cats');
  if (rejectCatsBtnD) rejectCatsBtnD.onclick = () => {
    state.aiPendingCats = [];
    state.aiMessages.push({ role: 'assistant', text: '\u2715 Новые категории отклонены.' });
    render(); scrollAiToBottom();
  };

  if (aiConfirmBtn) aiConfirmBtn.onclick = () => {
    const confirmEntitiesBtn = document.getElementById('btn-confirm-entities');
    if (confirmEntitiesBtn) confirmEntitiesBtn.onclick = () => {
      const pe = state.aiPendingEntities;
      const report = [];
      if (pe.dirs) pe.dirs.forEach(d => {
        if (!d.key || !d.label) return;
        state.directions[d.key] = { label: d.label, icon: d.icon||'🏢', color: d.color||'#a78bfa', partners: [] };
        DIRECTIONS[d.key] = state.directions[d.key];
        report.push('📁 Направление «' + d.icon+' '+d.label + '» создано');
      });
      if (pe.accs) pe.accs.forEach(a => {
        if (!a.key || !a.name || !a.direction) return;
        state.accounts[a.key] = { name: (a.icon||'💳')+' '+a.name, direction: a.direction, currency: a.currency||'RUB', balance: 0 };
        report.push('💳 Счёт «' + a.name + '» создан');
      });
      if (pe.funds) pe.funds.forEach(f => {
        if (!f.key || !f.name) return;
        state.funds[f.key] = { name: f.name, balance: 0, currency: f.currency||'RUB', icon: f.icon||'💰', color: f.color||'#a78bfa' };
        report.push('🏦 Фонд «' + f.name + '» создан');
      });
      state.aiPendingEntities = null;
      saveToStorage();
      state.aiMessages.push({ role: 'assistant', text: '✅ Готово:\n' + report.join('\n') });
      render(); scrollAiToBottom();
    };
    const rejectEntitiesBtn = document.getElementById('btn-reject-entities');
    if (rejectEntitiesBtn) rejectEntitiesBtn.onclick = () => {
      state.aiPendingEntities = null;
      state.aiMessages.push({ role: 'assistant', text: '✕ Создание отменено.' });
      render(); scrollAiToBottom();
    };
    if (state.aiPendingTxs.length === 0) return;
    const txsToSave = [...state.aiPendingTxs]; // snapshot before clearing
    let added = 0;
    const errors = [];
    const savedIds = []; // track IDs we attempted to save
    txsToSave.forEach((tx, i) => {
      // Unique id: timestamp + index + random to avoid collisions
      // i=0 is first/newest → gets highest createdAt so it sorts to top
      const uid = (Date.now() + (txsToSave.length - i)).toString() + '_' + Math.random().toString(36).slice(2,7);
      try {
        if (tx.type === 'transfer') {
          const fromAcc = state.accounts[tx.fromAccount];
          const toAcc   = state.accounts[tx.toAccount];
          if (!fromAcc) { errors.push(`#${i+1}: счёт "${tx.fromAccount}" не найден`); return; }
          if (!toAcc)   { errors.push(`#${i+1}: счёт "${tx.toAccount}" не найден`); return; }
          if (!tx.category) { errors.push(`#${i+1}: не указана категория перевода`); return; }
          const fromAmt = parseFloat(tx.fromAmount || tx.amount) || 0;
          const toAmt   = parseFloat(tx.toAmount   || tx.amount) || 0;
          if (fromAmt <= 0) { errors.push(`#${i+1}: некорректная сумма`); return; }
          fromAcc.balance -= fromAmt;
          toAcc.balance   += toAmt;
          state.transactions.push({
            ...tx,
            id: 'tr_' + uid,
            createdAt: Date.now() + i, createdAtMs: Date.now(), updatedAtMs: null,
            isTransfer: true,
            fromAmount: fromAmt,
            toAmount: toAmt,
            fromCurrency: tx.fromCurrency || fromAcc.currency || 'RUB',
            toCurrency:   tx.toCurrency   || toAcc.currency   || 'RUB',
          });
          savedIds.push('tr_' + uid);
          added++;
        } else if (tx.type === 'income' || tx.type === 'expense') {
          const acc = state.accounts[tx.account];
          if (!acc) { errors.push(`#${i+1}: счёт "${tx.account}" не найден`); return; }
          if (!tx.category) { errors.push(`#${i+1}: не указана категория`); return; }
          // direction — подставляем projectId если не задано
          if (!tx.direction) tx.direction = _projectId || '';
          const amt = parseFloat(tx.amount) || 0;
          if (amt <= 0) { errors.push(`#${i+1}: некорректная сумма`); return; }
          if (tx.type === 'income')  acc.balance += amt;
          if (tx.type === 'expense') acc.balance -= amt;
          state.transactions.push({
            ...tx,
            id: uid,
            createdAt: Date.now() + i, createdAtMs: Date.now(), updatedAtMs: null,
            amount: amt,
            currency: tx.currency || acc.currency || 'RUB',
          });
          savedIds.push(uid);
          added++;
        } else {
          errors.push(`#${i+1}: неизвестный тип "${tx.type}"`);
        }
      } catch(err) {
        errors.push(`#${i+1}: ${err.message}`);
      }
    });

    // Verify IDs actually landed in state.transactions
    const verifiedIds = new Set(state.transactions.map(t => t.id));
    const reallyAdded  = savedIds.filter(id => verifiedIds.has(id)).length;
    const missingCount = savedIds.length - reallyAdded;
    if (missingCount > 0) errors.push(missingCount + ' операций не появились в списке — ошибка записи');

    if (reallyAdded > 0) saveToStorage();

    // Only clear pending if ALL saved successfully — keep failed ones for correction
    if (errors.length === 0) {
      state.aiPendingTxs = [];
    } else {
      // Remove only the successfully saved ones, keep failed ones in pending
      state.aiPendingTxs = txsToSave.filter((tx, i) => {
        const uid = savedIds[savedIds.indexOf(savedIds.find((id,si) => si === i))];
        return !uid || !verifiedIds.has(uid);
      });
      // Simpler: keep only txs whose index had an error
      const failedIndices = new Set(errors.map(e => {
        const m = e.match(/^#(\d+)/);
        return m ? parseInt(m[1]) - 1 : -1;
      }));
      state.aiPendingTxs = txsToSave.filter((_, i) => failedIndices.has(i));
    }

    let msg;
    if (reallyAdded > 0 && errors.length === 0) {
      msg = '✅ Сохранено ' + reallyAdded + ' операций — все успешно появились в списке.';
    } else if (reallyAdded > 0) {
      msg = '✅ Сохранено ' + reallyAdded + ' операций.\n⚠️ Не сохранены (остались в списке для исправления):\n' + errors.map(function(e){return '• '+e;}).join('\n');
    } else {
      msg = '❌ Ничего не сохранено — операции остались в списке.\nОшибки:\n' + errors.map(function(e){return '• '+e;}).join('\n');
    }
    state.aiMessages.push({ role: 'assistant', text: msg });
    try { const ms = state.aiMessages.map(m=>({...m,image:m.image?'[img]':null})); sessionStorage.setItem('ai_chat_history', JSON.stringify({messages:ms,ts:Date.now(),projectId:_projectId})); } catch(e) {}
    render();
    scrollAiToBottom();
  };
  if (aiDiscardBtn) aiDiscardBtn.onclick = () => { state.aiPendingTxs = []; render(); };

  // ── AI inline edit buttons ──
  document.querySelectorAll('[data-ai-edit]').forEach(btn => {
    if (btn.dataset.aiEditSave !== undefined) return;
    btn.onclick = () => { state.aiEditingIdx = parseInt(btn.dataset.aiEdit); render(); scrollAiToBottom(); };
  });
  document.querySelectorAll('[data-ai-edit-cancel]').forEach(btn => {
    btn.onclick = (e) => {
      // Only close if clicking the bg overlay, not the inner modal card
      if (btn.id === 'ai-edit-modal-bg' || btn.hasAttribute('data-ai-edit-cancel')) {
        if (e.target !== btn && !btn.id) return; // inner content clicked — ignore
      }
      const msgs = document.getElementById('ai-chat-messages');
      const scrollPos = msgs ? msgs.scrollTop : null;
      state.aiEditingIdx = null;
      render();
      if (scrollPos !== null) { const el = document.getElementById('ai-chat-messages'); if (el) el.scrollTop = scrollPos; }
    };
  });
  // Stop clicks on the inner modal card from closing the bg
  const aiEditInner = document.querySelector('#ai-edit-modal-bg > div');
  if (aiEditInner) aiEditInner.onclick = (e) => e.stopPropagation();
  document.querySelectorAll('[data-ai-edit-save]').forEach(btn => {
    btn.onclick = () => {
      const idx = parseInt(btn.dataset.aiEditSave);
      const tx = state.aiPendingTxs[idx];
      if (!tx) { state.aiEditingIdx = null; render(); return; }
      const g = id => { const el = document.getElementById(id); return el ? el.value : undefined; };
      const type     = g('aie-type')     || tx.type;
      const date     = g('aie-date')     || tx.date;
      const category = g('aie-category') || tx.category;
      const note     = g('aie-note') !== undefined ? g('aie-note') : (tx.note||'');
      let updated;
      if (type === 'transfer') {
        const fromAccount = g('aie-from-account') || tx.fromAccount || tx.account;
        const toAccount   = g('aie-to-account')   || tx.toAccount;
        const fromAmount  = parseFloat(g('aie-from-amount')) || tx.fromAmount || tx.amount;
        const toAmount    = parseFloat(g('aie-to-amount'))   || tx.toAmount   || fromAmount;
        const fromAcc = state.accounts[fromAccount];
        const toAcc   = state.accounts[toAccount];
        updated = { ...tx, type, date, category, note,
          fromAccount, toAccount, fromAmount, toAmount,
          fromCurrency: fromAcc ? fromAcc.currency : (tx.fromCurrency||'RUB'),
          toCurrency:   toAcc   ? toAcc.currency   : (tx.toCurrency||'RUB') };
      } else {
        const account  = g('aie-account')  || tx.account;
        const amount   = parseFloat(g('aie-amount')) || tx.amount;
        const currency = g('aie-currency') || tx.currency;
        const acc = state.accounts[account];
        updated = { ...tx, type, date, account, amount, currency, category, note,
          direction: acc ? acc.direction : tx.direction };
      }
      state.aiPendingTxs[idx] = updated;
      const msgs2 = document.getElementById('ai-chat-messages');
      const scrollPos2 = msgs2 ? msgs2.scrollTop : null;
      state.aiEditingIdx = null;
      render();
      if (scrollPos2 !== null) { const el2 = document.getElementById('ai-chat-messages'); if (el2) el2.scrollTop = scrollPos2; }
    };
  });
  document.querySelectorAll('[data-ai-remove]').forEach(btn => {
    btn.onclick = () => {
      const idx = parseInt(btn.dataset.aiRemove);
      state.aiPendingTxs.splice(idx, 1);
      if (state.aiEditingIdx === idx) state.aiEditingIdx = null;
      render();
    };
  });

  // ── Fix AI chat scroll: prevent bg scroll, allow messages scroll ──
  // Guard: only attach once — these accumulate on every render() otherwise
  const aiMessages = document.getElementById('ai-chat-messages');
  if (aiMessages && !aiMessages._scrollBound) {
    aiMessages._scrollBound = true;
    aiMessages.addEventListener('wheel', (e) => { e.stopPropagation(); }, { passive: true });
    aiMessages.addEventListener('touchmove', (e) => { e.stopPropagation(); }, { passive: true });
  }

  // ── Restore voice button visual state after re-render ──
  if (_voiceActive) {
    const vBtn = document.getElementById('ai-voice-btn');
    if (vBtn) {
      vBtn.textContent = '⏹';
      vBtn.style.background = 'rgba(239,68,68,0.25)';
      vBtn.style.borderColor = 'rgba(239,68,68,0.5)';
      vBtn.style.color = '#f87171';
    }
  }

  // ── Project switcher — global click delegation ────────────────────────────
  // Guard: only attach once — accumulates on every render() otherwise
  if (!window._projSwitcherClickBound) {
    window._projSwitcherClickBound = true;
  document.addEventListener('click', async function(e) {
    // Open tx detail on click
    const txOpenEl = e.target.closest('[data-tx-open]');
    if (txOpenEl && !e.target.closest('[data-tx-edit],[data-tx-del],.tx-act-btn')) {
      state.showTxDetail = txOpenEl.dataset.txOpen;
      render();
      return;
    }
    // tx edit / delete inside detail modal (delegated)
    const txEditBtn = e.target.closest('[data-tx-edit]');
    if (txEditBtn) { state.showTxDetail = null; state.showEditTxModal = txEditBtn.dataset.txEdit; render(); return; }
    const txDelBtn = e.target.closest('[data-tx-del]');
    if (txDelBtn) {
      const txId = txDelBtn.dataset.txDel;
      const tx = state.transactions.find(t => t.id === txId);
      if (!tx) return;
      state._pendingDeleteTxId = txId;
      state.showDeleteConfirm = true;
      render();
      return;
    }
    // Confirm delete
    if (e.target.id === 'btn-confirm-delete') {
      const txId = state._pendingDeleteTxId;
      const tx = state.transactions.find(t => t.id === txId);
      if (tx) {
        const acc = state.accounts[tx.account];
        if (acc) { if (tx.type==='income') acc.balance -= parseFloat(tx.amount)||0; else if (tx.type==='expense') acc.balance += parseFloat(tx.amount)||0; }
        state.transactions = state.transactions.filter(t => t.id !== txId);
      }
      state.showDeleteConfirm = false;
      state._pendingDeleteTxId = null;
      state.showTxDetail = null;
      saveToStorage(); render();
      return;
    }
    if (e.target.id === 'btn-cancel-delete' || e.target.id === 'delete-confirm-bg') {
      state.showDeleteConfirm = false;
      state._pendingDeleteTxId = null;
      render();
      return;
    }
    // Open switcher (desktop: btn-open-project-switcher, mobile: btn-open-project-switcher-m)
    if (e.target.closest('#btn-open-project-switcher') || e.target.closest('#btn-open-project-switcher-m')) {
      state.showProjectSwitcher = true;
      render();
      if (!state._allProjects.length && !state._loadingProjects) {
        state._loadingProjects = true;
        await loadAllProjects();
        state._loadingProjects = false;
        render();
      }
      return;
    }
    // Close on bg or X
    if (e.target.id === 'project-switcher-bg') { state.showProjectSwitcher = false; _projSwitcherMode = 'list'; render(); return; }
    if (e.target.id === 'project-switcher-close') { state.showProjectSwitcher = false; _projSwitcherMode = 'list'; render(); return; }
    // New project
    if (e.target.id === 'btn-proj-new') { _projSwitcherMode = 'create'; _projNewEmoji = '💼'; _projNewColor = '#6ee7b7'; render(); setTimeout(() => document.getElementById('proj-new-name')?.focus(), 50); return; }
    // Back
    if (e.target.id === 'btn-proj-create-back' || e.target.id === 'btn-proj-edit-back') { _projSwitcherMode = 'list'; render(); return; }
    // Emoji/color pickers — create
    if (e.target.dataset.newEmoji) {
      _projNewEmoji = e.target.dataset.newEmoji;
      document.querySelectorAll('[data-new-emoji]').forEach(el => {
        const sel = el.dataset.newEmoji === _projNewEmoji;
        el.style.border = sel ? '1px solid rgba(110,231,183,0.5)' : '1px solid rgba(255,255,255,0.08)';
        el.style.background = sel ? 'rgba(110,231,183,0.15)' : 'rgba(255,255,255,0.04)';
      });
      return;
    }
    if (e.target.dataset.newColor) {
      _projNewColor = e.target.dataset.newColor;
      document.querySelectorAll('[data-new-color]').forEach(el => {
        const sel = el.dataset.newColor === _projNewColor;
        el.style.border = sel ? '3px solid #fff' : '3px solid transparent';
        el.style.transform = sel ? 'scale(1.2)' : 'scale(1)';
      });
      return;
    }
    // Emoji/color pickers — edit
    if (e.target.dataset.editEmoji) {
      _projEditEmoji = e.target.dataset.editEmoji;
      document.querySelectorAll('[data-edit-emoji]').forEach(el => {
        const sel = el.dataset.editEmoji === _projEditEmoji;
        el.style.border = sel ? '1px solid rgba(110,231,183,0.5)' : '1px solid rgba(255,255,255,0.08)';
        el.style.background = sel ? 'rgba(110,231,183,0.15)' : 'rgba(255,255,255,0.04)';
      });
      return;
    }
    if (e.target.dataset.editColor) {
      _projEditColor = e.target.dataset.editColor;
      document.querySelectorAll('[data-edit-color]').forEach(el => {
        const sel = el.dataset.editColor === _projEditColor;
        el.style.border = sel ? '3px solid #fff' : '3px solid transparent';
        el.style.transform = sel ? 'scale(1.2)' : 'scale(1)';
      });
      return;
    }
    // Submit create new project
    if (e.target.id === 'btn-proj-create-submit') {
      const name = (document.getElementById('proj-new-name')?.value || '').trim();
      if (!name) { document.getElementById('proj-new-name')?.focus(); return; }
      e.target.disabled = true; e.target.textContent = 'Создаём...';
      const { data, error } = await _SB.from('projects').insert({
        user_id: _currentUser.id, name, emoji: _projNewEmoji, color: _projNewColor,
      }).select().single();
      if (error) { e.target.disabled = false; e.target.textContent = 'Создать проект →'; showToast('Ошибка: ' + error.message, 'error'); return; }
      const defaultData = defaultProjectData();
      const uid = _currentUser.id + '_' + data.id;
      await _SB.from('user_data').upsert({ user_id: uid, project_id: data.id, data: defaultData, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
      if (!state._allProjects) state._allProjects = [];
      state._allProjects.push(data);
      _projSwitcherMode = 'list'; render(); return;
    }
    // Open settings for a project
    const settingsBtn = e.target.closest('[data-proj-settings-btn]');
    if (settingsBtn) {
      _projSettingsId = settingsBtn.dataset.projSettingsBtn;
      _projEditEmoji  = settingsBtn.dataset.projSettingsEmoji || '💼';
      _projEditColor  = settingsBtn.dataset.projSettingsColor || '#6ee7b7';
      _projSwitcherMode = 'settings'; render(); return;
    }
    // Save project settings
    if (e.target.id === 'btn-proj-edit-save') {
      const name = (document.getElementById('proj-edit-name')?.value || '').trim();
      if (!name) return;
      e.target.disabled = true; e.target.textContent = 'Сохраняем...';
      const { error } = await _SB.from('projects').update({ name, emoji: _projEditEmoji, color: _projEditColor }).eq('id', _projSettingsId);
      e.target.disabled = false; e.target.textContent = 'Сохранить';
      if (error) { showToast('Ошибка: ' + error.message, 'error'); return; }
      const proj = (state._allProjects || []).find(p => p.id === _projSettingsId);
      if (proj) { proj.name = name; proj.emoji = _projEditEmoji; proj.color = _projEditColor; }
      if (_projSettingsId === _projectId) {
        _projectName = name; _projectEmoji = _projEditEmoji;
        localStorage.setItem('active_project_name', name);
        localStorage.setItem('active_project_emoji', _projEditEmoji);
      }
      _projSwitcherMode = 'list'; render(); return;
    }
    // Delete project — also cleans up user_data
    if (e.target.id === 'btn-proj-delete') {
      const proj = (state._allProjects || []).find(p => p.id === _projSettingsId);
      if (!await confirmAsync('Удалить проект «' + (proj?.name || '') + '»?\nВсе данные будут удалены без возможности восстановления!', { okLabel: 'Удалить проект' })) return;
      e.target.disabled = true; e.target.textContent = 'Удаляем...';
      const uid = _currentUser.id + '_' + _projSettingsId;
      const { error: delDataErr } = await _SB.from('user_data').delete().eq('user_id', uid);
      if (delDataErr) { showToast('Ошибка удаления данных: ' + delDataErr.message, 'error'); e.target.disabled = false; e.target.textContent = '🗑 Удалить проект'; return; }
      const { error: delProjErr } = await _SB.from('projects').delete().eq('id', _projSettingsId);
      if (delProjErr) { showToast('Ошибка удаления проекта: ' + delProjErr.message, 'error'); e.target.disabled = false; e.target.textContent = '🗑 Удалить проект'; return; }
      state._allProjects = (state._allProjects || []).filter(p => p.id !== _projSettingsId);
      if (_projSettingsId === _projectId) {
        localStorage.removeItem('active_project_id');
        localStorage.removeItem('active_project_name');
        localStorage.removeItem('active_project_emoji');
        window.location.href = '/onboarding'; return;
      }
      _projSwitcherMode = 'list'; render(); return;
    }
    // Switch to another project
    const row = e.target.closest('[data-switch-project]');
    if (row) {
      const pid   = row.dataset.switchProject;
      const pname = row.dataset.switchName;
      const pEmoji= row.dataset.switchEmoji;
      if (pid === _projectId) { state.showProjectSwitcher = false; render(); return; }
      await saveToStorage();
      localStorage.setItem('active_project_id',    pid);
      localStorage.setItem('active_project_name',  pname);
      localStorage.setItem('active_project_emoji', pEmoji);
      window.location.reload();
    }
  }); // end project switcher click handler
  } // end _projSwitcherClickBound guard
}

// ─── CHARTS (Canvas) ───────────────────────────────────────────────────────
function renderCharts() {
  const md = monthlyData();
  if (md.length === 0) return;

  // Bar chart - overview
  const barCanvas = document.getElementById('chart-bar');
  if (barCanvas) drawBarChart(barCanvas, md);

  // Line chart - analytics
  const lineCanvas = document.getElementById('chart-line');
  if (lineCanvas) drawLineChart(lineCanvas, md);

  // Per-account area charts
  getOrderedAccounts().forEach(k => {
    const canvas = document.getElementById('chart-acc-' + k);
    const a = state.accounts[k];
    if (canvas && a) drawAreaChart(canvas, md, k, a.color || '#a78bfa');
  });
}

function drawBarChart(canvas, md) {
  const ctx = canvas.getContext('2d');
  const W = canvas.offsetWidth || 600;
  const H = 220;
  canvas.width = W; canvas.height = H;
  ctx.clearRect(0,0,W,H);

  const pad = { l:50, r:20, t:20, b:40 };
  const cw = W - pad.l - pad.r;
  const ch = H - pad.t - pad.b;

  const maxVal = Math.max(...md.map(m =>
    Math.max(m._in, m._out)
  )) * 1.15 || 1;

  const bw = Math.max(8, (cw / md.length) * 0.35);
  const gap = (cw / md.length);

  // grid
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + ch - (ch * i / 4);
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W-pad.r, y); ctx.stroke();
    ctx.fillStyle = '#555'; ctx.font = '11px monospace'; ctx.textAlign = 'right';
    ctx.fillText(fmtShort(maxVal * i / 4), pad.l - 6, y + 4);
  }

  md.forEach((m, i) => {
    const x = pad.l + i * gap + gap/2;
    const inVal  = m._in;
    const outVal = m._out;

    // income bar
    const inH = (inVal / maxVal) * ch;
    ctx.fillStyle = '#6ee7b7';
    ctx.fillRect(x - bw - 2, pad.t + ch - inH, bw, inH);

    // expense bar
    const outH = (outVal / maxVal) * ch;
    ctx.fillStyle = '#f87171';
    ctx.fillRect(x + 2, pad.t + ch - outH, bw, outH);

    // label
    ctx.fillStyle = '#666'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(m.label, x, H - 8);
  });
}

function drawLineChart(canvas, md) {
  const ctx = canvas.getContext('2d');
  const W = canvas.offsetWidth || 600;
  const H = 220;
  canvas.width = W; canvas.height = H;
  ctx.clearRect(0,0,W,H);

  const pad = { l:55, r:20, t:20, b:40 };
  const cw = W - pad.l - pad.r;
  const ch = H - pad.t - pad.b;

  const nets = md.map(m => m._in - m._out);
  const maxV = Math.max(...nets.map(Math.abs)) * 1.2 || 1;

  ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + i * ch/4;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W-pad.r, y); ctx.stroke();
    const v = maxV - maxV * 2 * (i/4);
    ctx.fillStyle = '#555'; ctx.font = '11px monospace'; ctx.textAlign = 'right';
    ctx.fillText(fmtShort(v), pad.l-6, y+4);
  }
  // zero line
  const zy = pad.t + ch/2;
  ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(pad.l, zy); ctx.lineTo(W-pad.r, zy); ctx.stroke();

  // line
  ctx.beginPath();
  ctx.strokeStyle = '#a78bfa'; ctx.lineWidth = 2.5;
  nets.forEach((v, i) => {
    const x = pad.l + (i / (nets.length - 1 || 1)) * cw;
    const y = pad.t + (ch/2) - (v / maxV) * (ch/2);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();

  // dots + labels
  nets.forEach((v, i) => {
    const x = pad.l + (i / (nets.length - 1 || 1)) * cw;
    const y = pad.t + (ch/2) - (v / maxV) * (ch/2);
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI*2);
    ctx.fillStyle = '#a78bfa'; ctx.fill();
    ctx.fillStyle = '#666'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(md[i].label, x, H-8);
  });
}

function drawAreaChart(canvas, md, dir, color) {
  const ctx = canvas.getContext('2d');
  const W = canvas.offsetWidth || 400;
  const H = 200;
  canvas.width = W; canvas.height = H;
  ctx.clearRect(0,0,W,H);

  const pad = { l:50, r:15, t:15, b:35 };
  const cw = W - pad.l - pad.r;
  const ch = H - pad.t - pad.b;

  const ins  = md.map(m => m[dir+'_in']);
  const outs = md.map(m => m[dir+'_out']);
  const maxV = Math.max(...ins, ...outs) * 1.2 || 1;
  const n = md.length;

  ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1;
  for (let i = 0; i <= 3; i++) {
    const y = pad.t + i * ch/3;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W-pad.r, y); ctx.stroke();
    ctx.fillStyle = '#555'; ctx.font = '10px monospace'; ctx.textAlign = 'right';
    ctx.fillText(fmtShort(maxV * (1 - i/3)), pad.l-4, y+4);
  }

  function drawArea(vals, clr, alpha) {
    const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t+ch);
    grad.addColorStop(0, clr.replace(')', `,${alpha})`).replace('rgb', 'rgba'));
    grad.addColorStop(1, clr.replace(')', ',0)').replace('rgb', 'rgba'));
    ctx.beginPath();
    vals.forEach((v, i) => {
      const x = pad.l + (i / (n-1||1)) * cw;
      const y = pad.t + ch - (v / maxV) * ch;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    const lastX = pad.l + cw;
    ctx.lineTo(lastX, pad.t+ch); ctx.lineTo(pad.l, pad.t+ch); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();
    ctx.beginPath();
    vals.forEach((v, i) => {
      const x = pad.l + (i / (n-1||1)) * cw;
      const y = pad.t + ch - (v / maxV) * ch;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = clr; ctx.lineWidth = 2; ctx.stroke();
  }

  // convert hex to rgb for gradient
  function hexToRgb(hex) { const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16); return `rgb(${r},${g},${b})`; }
  drawArea(ins,  hexToRgb(color),   0.3);
  drawArea(outs, 'rgb(239,68,68)',  0.2);

  ins.forEach((_, i) => {
    ctx.fillStyle = '#555'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(md[i].label, pad.l + (i/(n-1||1))*cw, H-5);
  });
}

function drawPieChart(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.offsetWidth || 200;
  const H = 200;
  canvas.width = W; canvas.height = H;
  ctx.clearRect(0,0,W,H);

  const data = getOrderedDirs().map(k => [k, DIRECTIONS[k]]).map(([k,v]) => {
    const s = dirStats(k);
    return { name: v.label, value: Math.max(s.income, 0), color: v.color };
  }).filter(d => d.value > 0);

  if (data.length === 0) {
    ctx.fillStyle = '#333'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('Нет данных', W/2, H/2);
    return;
  }

  const total = data.reduce((s,d) => s+d.value, 0);
  const cx = W/2, cy = H/2, r = Math.min(W,H)/2 - 20;
  let angle = -Math.PI/2;

  data.forEach(d => {
    const slice = (d.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, angle, angle+slice);
    ctx.closePath();
    ctx.fillStyle = d.color; ctx.fill();

    // label
    const mid = angle + slice/2;
    const lx = cx + Math.cos(mid) * (r*0.65);
    const ly = cy + Math.sin(mid) * (r*0.65);
    ctx.fillStyle = '#000'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(Math.round(d.value/total*100)+'%', lx, ly+4);

    angle += slice;
  });

  // inner circle
  ctx.beginPath(); ctx.arc(cx, cy, r*0.45, 0, Math.PI*2);
  ctx.fillStyle = '#0d0d0d'; ctx.fill();

  // legend
  const legend = document.getElementById('pie-legend');
  if (legend) {
    legend.innerHTML = data.map(d => `
      <div class="pie-leg-item">
        <div class="pie-dot" style="background:${d.color}"></div>
        ${d.name}
      </div>`).join('');
  }
}

function fmtShort(n) {
  if (Math.abs(n) >= 1000000) return (n/1000000).toFixed(1) + 'M';
  if (Math.abs(n) >= 1000) return (n/1000).toFixed(0) + 'k';
  return Math.round(n).toString();
}

// ─── LIVE RATES ────────────────────────────────────────────────────────────
async function fetchLiveRates(retryCount = 0) {
  try {
    const resp = await fetch('/.netlify/functions/rates');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    // Apply all currency rates from API response
    const ALL_RATE_KEYS = ['SAR','USD','USDT','EUR','GBP','AED','TRY','CNY','KZT'];
    const newRates = { updatedAt: data.updatedAt || null, source: data.source || 'api' };
    for (const key of ALL_RATE_KEYS) {
      newRates[key] = data[key] || state.rates[key] || null;
    }
    state.rates = newRates;
    // НЕ вызываем saveToStorage здесь — это затрёт облачные данные
    // если fetchLiveRates отработает до завершения cloudLoad
    console.log('Live rates loaded:', state.rates);
  } catch(e) {
    console.warn('fetchLiveRates failed:', e.message);
    if (retryCount < 1) {
      // One retry after 3 seconds
      setTimeout(() => fetchLiveRates(retryCount + 1).then(() => { if (window._appReady) render(); }), 3000);
    } else {
      // Keep existing rates, mark as fallback
      state.rates.source = 'fallback';
      console.warn('fetchLiveRates: using fallback rates after retry');
    }
  }
}

// ─── PRELOAD DATA ──────────────────────────────────────────────────────────
function preloadIfEmpty() {
  // New project defaults — set minimal clean state
  state.directions = {};
  state.accounts = {
    
  };
  state.funds = {
    cushion: { name: 'Подушка безопасности', balance: 0, currency: 'RUB', icon: '🛡️', color: '#6ee7b7' },
    savings: { name: 'Накопительный счёт', balance: 0, currency: 'RUB', icon: '💵', color: '#93c5fd' },
  };
  state.enabledCurrencies = ['RUB', 'USD'];
  state.rates = { SAR: 20.5, USDT: 90, USD: 90, source: "fallback", updatedAt: null };
  DIRECTIONS = state.directions;
}

// ─── INIT ──────────────────────────────────────────────────────────────────
function applyTheme() {
  // Theme switching disabled - dark theme only
  document.body.classList.remove('light');
}


// ── Init sequence is in finance.html (desktop) and finance-mobile.html (mobile) ──


// ── Voice input ──────────────────────────────────────────────────────────────
let _voiceRecognition = null;
let _voiceActive = false;

// ── Voice input via MediaRecorder + Whisper API ──────────────────────────────
let _mediaRecorder = null;
let _audioChunks = [];

async function startVoiceInput() {
  const btn = document.getElementById('ai-voice-btn');
  const inp = document.getElementById('ai-text-input');

  function btnOn() {
    if (!btn) return;
    btn.textContent = '⏹';
    btn.style.background = 'rgba(239,68,68,0.2)';
    btn.style.borderColor = 'rgba(239,68,68,0.5)';
    btn.style.color = '#f87171';
    btn.title = 'Нажми чтобы остановить';
  }
  function btnOff() {
    if (!btn) return;
    btn.textContent = '🎤';
    btn.style.background = '';
    btn.style.borderColor = '';
    btn.style.color = '';
    btn.title = 'Голосовой ввод';
  }
  function btnLoading() {
    if (!btn) return;
    btn.textContent = '⏳';
    btn.style.background = 'rgba(251,191,36,0.15)';
    btn.style.color = '#fbbf24';
  }

  // If already recording — stop and send
  if (_voiceActive && _mediaRecorder) {
    _mediaRecorder.stop();
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showToast('Запись аудио не поддерживается в этом браузере', 'error');
    return;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch(e) {
    showToast('Доступ к микрофону запрещён.\nРазреши: 🔒 в адресной строке → Микрофон → Разрешить', 'error');
    return;
  }

  // Pick best supported format
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
                 : MediaRecorder.isTypeSupported('audio/webm')             ? 'audio/webm'
                 : MediaRecorder.isTypeSupported('audio/mp4')              ? 'audio/mp4'
                 : 'audio/ogg';

  _audioChunks = [];
  _mediaRecorder = new MediaRecorder(stream, { mimeType });
  _voiceActive = true;
  btnOn();
  if (inp) inp.placeholder = '🎤 Говорите... (нажмите ⏹ чтобы отправить)';

  _mediaRecorder.ondataavailable = e => {
    if (e.data.size > 0) _audioChunks.push(e.data);
  };

  _mediaRecorder.onstop = async () => {
    _voiceActive = false;
    stream.getTracks().forEach(t => t.stop());

    if (_audioChunks.length === 0) { btnOff(); return; }

    btnLoading();
    if (inp) inp.placeholder = '⏳ Распознаю речь...';

    try {
      const blob = new Blob(_audioChunks, { type: mimeType });
      const base64 = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload  = () => res(reader.result.split(',')[1]);
        reader.onerror = rej;
        reader.readAsDataURL(blob);
      });

      // Get current session token for auth check on function side
      const { data: { session: wSession } } = await _SB.auth.getSession();
      const wToken = wSession ? wSession.access_token : null;

      const resp = await fetch('/.netlify/functions/whisper', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(wToken ? { 'Authorization': 'Bearer ' + wToken } : {}),
        },
        body: JSON.stringify({ audio: base64, mimeType: mimeType.split(';')[0] }),
      });

      const data = await resp.json();

      if (data.error) throw new Error(data.error);
      if (!data.text || !data.text.trim()) throw new Error('Речь не распознана — попробуй ещё раз');

      btnOff();
      if (inp) inp.placeholder = 'Напиши или надиктуй операцию...';
      sendAiMessage(data.text.trim(), null);

    } catch(err) {
      btnOff();
      if (inp) inp.placeholder = 'Напиши или надиктуй операцию...';
      showToast('Ошибка распознавания: ' + err.message, 'error');
    }

    _audioChunks = [];
    _mediaRecorder = null;
  };

  _mediaRecorder.start();
}

function profileModalHtml() {
  const user = _currentUser || {};
  const email = user.email || '';
  const name = (user.user_metadata && user.user_metadata.full_name) ? user.user_metadata.full_name : email.split('@')[0];
  const created = user.created_at ? new Date(user.created_at) : null;
  const months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  const createdStr = created ? (created.getDate() + ' ' + months[created.getMonth()] + ' ' + created.getFullYear()) : '—';
  return `
    <div class="modal-bg" id="profile-modal-bg" style="align-items:center">
      <div id="m-profile-inner" class="modal" style="max-width:420px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:28px">
          <div style="font-size:20px;font-weight:800;color:#fff">👤 Личный кабинет</div>
          <button id="btn-profile-close" class="modal-close" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#666;font-size:20px;cursor:pointer;padding:4px 10px;line-height:1">×</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:14px;margin-bottom:28px">
          <div style="padding:14px 16px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);border-radius:12px">
            <div style="font-size:11px;color:#555;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:5px">Имя</div>
            <div style="font-size:15px;font-weight:600;color:#fff">${name}</div>
          </div>
          <div style="padding:14px 16px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);border-radius:12px">
            <div style="font-size:11px;color:#555;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:5px">Почта</div>
            <div style="font-size:15px;font-weight:600;color:#fff">${email}</div>
          </div>
          <div style="padding:14px 16px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);border-radius:12px">
            <div style="font-size:11px;color:#555;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:5px">Дата регистрации</div>
            <div style="font-size:15px;font-weight:600;color:#fff">${createdStr}</div>
          </div>
        </div>
        <button id="btn-change-password" style="width:100%;padding:12px;border-radius:11px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:#ccc;font-size:14px;font-weight:600;cursor:pointer;margin-bottom:10px">🔐 Сменить пароль</button>
        <button id="btn-logout-profile" style="width:100%;padding:12px;border-radius:11px;border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.06);color:#f87171;font-size:14px;font-weight:600;cursor:pointer">Выйти из аккаунта</button>
      </div>
    </div>`;
}

// ─── SETTINGS DRAFT ──────────────────────────────────────────────────────────
// Changes in settings are staged in _settingsDraft, applied only on close

let _settingsDraft = null;

function _openSettingsDraft() {
  _settingsDraft = {
    enabledModules:    Object.assign({}, state.enabledModules || {}),
    enabledCurrencies: (state.enabledCurrencies || ['RUB','SAR','USDT']).slice(),
  };
}

function _applySettingsDraft() {
  if (!_settingsDraft) return;
  state.enabledModules    = _settingsDraft.enabledModules;
  state.enabledCurrencies = _settingsDraft.enabledCurrencies;
  _settingsDraft = null;
}

function _usedCurrencies() {
  // Returns set of currency codes currently used in accounts or funds
  const used = new Set(['RUB']);
  Object.values(state.accounts || {}).forEach(a => { if (a.currency) used.add(a.currency); });
  Object.values(state.funds    || {}).forEach(f => { if (f.currency) used.add(f.currency); });
  return used;
}

function settingsModalHtml() {
  const langs = [['ru','🇷🇺 Русский'],['en','🇬🇧 English']];
  const ALL_CURRENCIES = [
    { code: 'RUB', name: 'Российский рубль', symbol: '₽' },
    { code: 'SAR', name: 'Саудовский риял', symbol: 'ر.س' },
    { code: 'USDT', name: 'Tether (USDT)', symbol: '₮' },
    { code: 'USD', name: 'Доллар США', symbol: '$' },
    { code: 'EUR', name: 'Евро', symbol: '€' },
    { code: 'GBP', name: 'Британский фунт', symbol: '£' },
    { code: 'AED', name: 'Дирхам ОАЭ', symbol: 'د.إ' },
    { code: 'TRY', name: 'Турецкая лира', symbol: '₺' },
    { code: 'CNY', name: 'Китайский юань', symbol: '¥' },
    { code: 'KZT', name: 'Казахстанский тенге', symbol: '₸' },
  ];

  const CARD = 'margin-bottom:14px;padding:20px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:16px';
  const TITLE = 'font-size:16px;font-weight:800;color:#fff;margin-bottom:14px';

  function toggle(enabled) {
    const trackBg  = enabled ? '#6ee7b7' : 'rgba(255,255,255,0.1)';
    const knobLeft = enabled ? '23px' : '3px';
    const knobBg   = enabled ? '#0a0a12' : '#555';
    return '<span style="position:absolute;inset:0;border-radius:12px;background:' + trackBg + ';transition:background 0.2s">'
         + '<span style="position:absolute;top:3px;left:' + knobLeft + ';width:18px;height:18px;border-radius:50%;background:' + knobBg + ';transition:left 0.2s;box-shadow:0 1px 4px rgba(0,0,0,0.5)"></span>'
         + '</span>';
  }

  // ── 1. Язык ──────────────────────────────────────────────────────────────
  const langBlock = '<div style="' + CARD + '">'
    + '<div style="' + TITLE + '">🌐 Язык интерфейса</div>'
    + '<div style="display:flex;gap:8px">'
    + langs.map(function(p){ var v=p[0],l=p[1]; var on=state.lang===v;
        return '<button data-lang-set="' + v + '" style="flex:1;padding:11px;border-radius:10px;border:1px solid ' + (on?'rgba(147,197,253,0.4)':'rgba(255,255,255,0.07)') + ';background:' + (on?'rgba(147,197,253,0.1)':'rgba(255,255,255,0.03)') + ';color:' + (on?'#93c5fd':'#666') + ';cursor:pointer;font-size:14px;font-weight:' + (on?700:400) + '">' + l + '</button>';
      }).join('')
    + '</div>'
    + (state.lang==='en' ? '<p style="font-size:12px;color:#555;margin-top:10px">⚠️ English translation coming soon</p>' : '')
    + '</div>';

  // ── 2. Модули ─────────────────────────────────────────────────────────────
  const MODULES = [
    ['goals',    '🎯', 'Цели'],
    ['budgets',  '💰', 'Бюджеты'],
    ['spending', '🛒', 'Траты'],
    ['partners', '🤝', 'Партнёры'],
  ];
  const modulesRows = MODULES.map(function(m, i) {
    var key=m[0], icon=m[1], label=m[2];
    var src = _settingsDraft || {}; var enabled = !!(src.enabledModules || state.enabledModules || {})[key];
    var last = i === MODULES.length - 1;
    return '<div style="display:flex;align-items:center;justify-content:space-between;padding:11px 0' + (last?'':';border-bottom:1px solid rgba(255,255,255,0.05)') + '">'
      + '<div style="display:flex;align-items:center;gap:10px">'
      + '<span style="font-size:18px">' + icon + '</span>'
      + '<span style="font-size:14px;color:#ccc;font-weight:500">' + label + '</span>'
      + '</div>'
      + '<label style="position:relative;width:44px;height:24px;cursor:pointer;flex-shrink:0">'
      + '<input type="checkbox" data-module="' + key + '" ' + (enabled?'checked':'') + ' style="opacity:0;width:0;height:0;position:absolute">'
      + toggle(enabled)
      + '</label>'
      + '</div>';
  }).join('');
  const modulesBlock = '<div style="' + CARD + '">'
    + '<div style="' + TITLE + '">🧩 Модули</div>'
    + '<div style="font-size:13px;color:#555;margin-bottom:14px">Обзор, Операции и Детализация — обязательные. Остальные включаются по необходимости.</div>'
    + modulesRows
    + '</div>';

  // ── 3. Валюты и курсы ─────────────────────────────────────────────────────
  const rateUpdTime = state.rates.updatedAt
    ? new Date(state.rates.updatedAt).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})
    : null;
  const rateStatus = state.rates.source === 'fallback'
    ? '<span style="color:#f87171;font-size:12px">⚠️ резервные значения</span>'
    : rateUpdTime
      ? '<span style="color:#6ee7b7;font-size:12px">✓ обновлено ' + rateUpdTime + '</span>'
      : '<span style="color:#888;font-size:12px">загрузка...</span>';

  const currencyRows = ALL_CURRENCIES.map(function(cur, i) {
    var _draftCurs = (_settingsDraft ? _settingsDraft.enabledCurrencies : null) || state.enabledCurrencies || ['RUB','SAR','USDT'];
    var enabled = _draftCurs.includes(cur.code);
    var locked  = _usedCurrencies().has(cur.code);
    var isBase  = cur.code === 'RUB';
    var rateVal = state.rates[cur.code];
    var rateLabel = (!isBase && rateVal)
      ? '<span style="font-size:11px;color:#666">1 ' + cur.code + ' = </span><span style="font-family:monospace;font-size:12px;font-weight:700;color:#aaa">' + Number(rateVal).toFixed(2) + ' ₽</span>'
      : (!isBase ? '<span style="font-size:11px;color:#444">нет курса</span>' : '');
    var last = i === ALL_CURRENCIES.length - 1;
    return '<div style="display:flex;align-items:center;justify-content:space-between;padding:11px 0' + (last?'':';border-bottom:1px solid rgba(255,255,255,0.05)') + '">'
      + '<div style="display:flex;align-items:center;gap:10px">'
      + '<div style="width:32px;height:32px;border-radius:8px;background:rgba(255,255,255,0.06);display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0">' + cur.symbol + '</div>'
      + '<div>'
      + '<div style="font-size:14px;font-weight:600;color:#ddd">' + cur.code + '</div>'
      + '<div style="font-size:11px;color:#444">' + cur.name + '</div>'
      + '</div>'
      + '</div>'
      + '<div style="display:flex;align-items:center;gap:10px">'
      + (!isBase ? '<div style="text-align:right">' + rateLabel + '</div>' : '')
      + (isBase
          ? '<span style="font-size:11px;color:#6ee7b7;font-weight:600;padding:3px 9px;background:rgba(110,231,183,0.1);border-radius:20px">Базовая</span>'
          : locked
            ? '<label style="position:relative;width:44px;height:24px;cursor:not-allowed;flex-shrink:0;opacity:0.35">'
              + '<input type="checkbox" disabled checked style="opacity:0;width:0;height:0;position:absolute">'
              + toggle(true)
              + '</label>'
            : '<label style="position:relative;width:44px;height:24px;cursor:pointer;flex-shrink:0">'
              + '<input type="checkbox" data-cur-toggle="' + cur.code + '" ' + (enabled?'checked':'') + ' style="opacity:0;width:0;height:0;position:absolute">'
              + toggle(enabled)
              + '</label>')
      + '</div>'
      + '</div>';
  }).join('');

  const currenciesBlock = '<div style="' + CARD + '">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">'
    + '<div style="' + TITLE + ';margin-bottom:0">💱 Валюты и курсы</div>'
    + '<button id="btn-settings-refresh-rates" style="padding:5px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.04);color:#888;font-size:12px;cursor:pointer">🔄 Обновить</button>'
    + '</div>'
    + '<div style="font-size:12px;color:#555;margin-bottom:14px">' + rateStatus + ' · Включи нужные валюты для пересчёта в рубли.</div>'
    + currencyRows
    + '</div>';

  // ── 4. Данные ─────────────────────────────────────────────────────────────
  const dataBlock = '<div style="' + CARD + '">'
    + '<div style="' + TITLE + '">📦 Данные</div>'
    + '<div style="font-size:13px;color:#555;margin-bottom:14px">Резервное копирование и восстановление данных.</div>'
    + '<div style="display:flex;gap:10px;flex-wrap:wrap">'
    + '<button id="btn-export-json" style="flex:1;min-width:130px;padding:12px;border-radius:12px;border:1px solid rgba(147,197,253,0.2);background:rgba(147,197,253,0.05);color:#93c5fd;font-size:13px;font-weight:600;cursor:pointer">📥 Скачать резервную копию</button>'
    + '<label style="flex:1;min-width:130px;padding:12px;border-radius:12px;border:1px solid rgba(251,191,36,0.2);background:rgba(251,191,36,0.05);color:#fbbf24;font-size:13px;font-weight:600;cursor:pointer;text-align:center;display:flex;align-items:center;justify-content:center">'
    + '📤 Загрузить из файла'
    + '<input type="file" id="inp-import-json" accept=".json" style="display:none">'
    + '</label>'
    + '</div>'
    + '</div>';

  // ── 5. Опасная зона ────────────────────────────────────────────────────────
  const dangerBlock = '<div style="padding:20px;border-radius:16px;border:1px solid rgba(239,68,68,0.2);background:rgba(239,68,68,0.04)">'
    + '<div style="font-size:16px;font-weight:800;color:#f87171;margin-bottom:8px">⚠️ Опасная зона</div>'
    + '<div style="font-size:13px;color:#555;margin-bottom:14px">Это действие необратимо. Все транзакции, счета, фонды и настройки будут удалены.</div>'
    + '<button id="btn-clear-txs" style="width:100%;padding:12px;border-radius:10px;border:1px solid rgba(251,191,36,0.3);background:rgba(251,191,36,0.07);color:#fbbf24;font-size:14px;font-weight:600;cursor:pointer;margin-bottom:10px">🧹 Очистить операции за этот месяц</button>'
    + '<button id="btn-reset" style="width:100%;padding:12px;border-radius:10px;border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.07);color:#f87171;font-size:14px;font-weight:600;cursor:pointer">🗑 Сбросить все данные</button>'
    + '</div>';

  return '<div id="settings-modal-bg" class="modal-bg">'
    + '<div id="settings-modal-inner" class="modal" style="max-width:580px;max-height:96vh">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">'
    + '<div style="font-size:20px;font-weight:800;color:#fff">⚙️ Настройки</div>'
    + '<button id="btn-settings-close" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#666;font-size:20px;cursor:pointer;padding:4px 10px;line-height:1">×</button>'
    + '</div>'
    + langBlock
    + modulesBlock
    + currenciesBlock
    + dataBlock
    + dangerBlock
    + '</div>'
    + '</div>';
}


function doExportPdf() {
  const dirs  = state.exportDirs  || getOrderedDirs();
  const accs  = state.exportAccs  || Object.keys(state.accounts);
  const from  = state.exportDateFrom ? new Date(state.exportDateFrom) : null;
  const to    = state.exportDateTo   ? new Date(state.exportDateTo)   : null;
  const showBal = state.exportShowBalances !== false;

  let txs = state.transactions.filter(t => {
    if (!dirs.includes(t.direction)) return false;
    if (!accs.includes(t.account))   return false;
    if (from && new Date(t.date) < from) return false;
    if (to   && new Date(t.date) > to)   return false;
    return true;
  }).sort((a,b) => new Date(a.date)-new Date(b.date));

  const MONTHS_GEN = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  const fmtDate = d => { const p=d.split('-'); return p.length===3?`${parseInt(p[2])} ${MONTHS_GEN[parseInt(p[1])-1]} ${p[0]}`:d; };
  const typeLabel = t => t==='income'?'Доход':t==='expense'?'Расход':'Перевод';
  const typeColor = t => t==='income'?'#16a34a':t==='expense'?'#dc2626':'#d97706';

  const txRows = txs.map(t => {
    const acc = state.accounts[t.account];
    const dir = DIRECTIONS[t.direction];
    const sign = t.type==='income' ? '+' : '-';
    const color = typeColor(t.type);
    return `<tr>
      <td>${fmtDate(t.date)}</td>
      <td style="color:${color};font-weight:600">${typeLabel(t.type)}</td>
      
      <td>${acc ? acc.name : t.account}</td>
      <td>${t.category}</td>
      <td>${t.note || '—'}</td>
      <td style="text-align:right;font-weight:600;color:${color}">${sign}${fmt(t.amount, t.currency)}</td>
      <td style="text-align:right;color:#555">${t.currency !== 'RUB' ? '≈'+fmt(toRub(t.amount,t.currency)) : '—'}</td>
    </tr>`;
  }).join('');

  const balRows = showBal ? accs.map(k => {
    const a = state.accounts[k];
    if (!a) return '';
    const dir = DIRECTIONS[a.direction];
    return `<tr>
      <td>${a.name}</td>
      
      <td>${a.currency}</td>
      <td style="text-align:right;font-weight:600">${fmt(a.balance, a.currency)}</td>
      <td style="text-align:right;color:#555">${a.currency !== 'RUB' ? '≈'+fmt(toRub(a.balance,a.currency)) : '—'}</td>
    </tr>`;
  }).join('') : '';

  const periodStr = from || to
    ? `Период: ${from ? fmtDate(state.exportDateFrom) : '—'} → ${to ? fmtDate(state.exportDateTo) : '—'}`
    : 'Все время';

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <title>MyFinanceAI — Выписка</title>
  <style>
    body{font-family:Arial,sans-serif;padding:24px;color:#111}
    h1{font-size:20px;margin-bottom:4px}
    .sub{color:#666;font-size:13px;margin-bottom:20px}
    table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:32px}
    th{background:#f3f4f6;text-align:left;padding:8px 10px;border-bottom:2px solid #e5e7eb;font-weight:600}
    td{padding:7px 10px;border-bottom:1px solid #f0f0f0}
    h2{font-size:15px;margin-bottom:8px;color:#374151}
  </style></head><body>
  <h1>📊 Финансовая выписка — MyFinanceAI</h1>
  <div class="sub">${periodStr} · Сформировано: ${new Date().toLocaleDateString('ru')}</div>
  <h2>Операции</h2>
  <table>
    <thead><tr><th>Дата</th><th>Тип</th><th>Счёт</th><th>Категория</th><th>Комментарий</th><th>Сумма</th><th>≈RUB</th></tr></thead>
    <tbody>${txRows}</tbody>
  </table>
  ${showBal ? '<h2>Балансы счётов</h2><table><thead><tr><th>Счёт</th><th>Валюта</th><th>Баланс</th><th>≈RUB</th></tr></thead><tbody>'+balRows+'</tbody></table>' : ''}
  </body></html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (!win) {
    // Popup blocked — fallback: download as HTML file
    const a = document.createElement('a');
    a.href = url;
    a.download = 'report.html';
    a.click();
    showToast('Popup заблокирован — файл скачан. Открой его в браузере и нажми Печать.', 'info');
  } else {
    setTimeout(() => { win.print(); URL.revokeObjectURL(url); }, 600);
  }
}
