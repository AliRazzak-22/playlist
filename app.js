'use strict';

(() => {
  const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyACHSjXB-UVG418YSsyedNPV48QbIB9OWA',
    authDomain: 'send-files-to-tv-d371a.firebaseapp.com',
    databaseURL: 'https://send-files-to-tv-d371a-default-rtdb.firebaseio.com',
    projectId: 'send-files-to-tv-d371a',
    storageBucket: 'send-files-to-tv-d371a.firebasestorage.app',
  };
  const USE_EMULATOR = new URLSearchParams(location.search).has('emulator');
  const ONLINE_WINDOW_MS = 3 * 60 * 1000;
  const MAX_URL_LENGTH = 2048;
  const PIN_LENGTH = 9;
  const SESSION_MS = 8 * 60 * 60 * 1000;
  const DEFAULT_CONFIG = { volume: 1, muted: false, update_check_interval_minutes: 30, playback_order: 'sequential', display_mode: 'contain' };
  let pinValue = '';
  let pinBusy = false;
  let pinUnlocked = false;
  let retryUntil = 0;
  let retryTimer = null;
  let sessionDeadline = 0;
  let expiryTimer = null;
  let sessionEpoch = 0;
  let startupReady = false;

  const ADMIN_EMAIL = 'signage-admin@send-files-to-tv-d371a.firebaseapp.com';
  const GITHUB_REPO = 'AliRazzak-22/playlist';
  const PAGES_BASE = 'https://alirazzak-22.github.io/playlist/';
  const GITHUB_TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new?name=signage-media-upload'
    + '&description=Upload%20signage%20media%20to%20the%20playlist%20repository&target_name=AliRazzak-22&expires_in=none&contents=write';

  if (!window.firebase || ['auth', 'database'].some((name) => typeof firebase[name] !== 'function')) {
    document.getElementById('boot-view').replaceChildren(
      Object.assign(document.createElement('p'), { textContent: 'ما كدرت أحمل مكتبات Firebase. تأكد من الإنترنت وافتح الصفحة مرة ثانية.' }));
    return;
  }

  firebase.initializeApp(FIREBASE_CONFIG);
  const auth = firebase.auth();
  const db = firebase.database();
  if (USE_EMULATOR) {
    auth.useEmulator('http://127.0.0.1:9099', { disableWarnings: true });
    db.useEmulator('127.0.0.1', 9000);
  }
  // No private listeners or persisted browser identity before server login.
  db.goOffline();

  const $ = (id) => document.getElementById(id);

  // ---------- DOM helpers ----------

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (value == null || value === false) continue;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
        else if (value === true) node.setAttribute(key, '');
        else node.setAttribute(key, String(value));
      }
    }
    for (const child of children.flat()) {
      if (child == null || child === false) continue;
      node.append(child instanceof Node ? child : String(child));
    }
    return node;
  }

  const ICONS = {
    screen: '<rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
    play: '<path d="M7 4.8v14.4a.8.8 0 0 0 1.2.7l11.3-7.2a.8.8 0 0 0 0-1.4L8.2 4.1A.8.8 0 0 0 7 4.8z" fill="currentColor" stroke="none"/>',
    pause: '<rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none"/>',
    next: '<path d="M5 5l10 7-10 7z" fill="currentColor" stroke="none"/><path d="M19 5v14"/>',
    prev: '<path d="M19 5L9 12l10 7z" fill="currentColor" stroke="none"/><path d="M5 5v14"/>',
    restart: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
    reload: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>',
    broom: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 19h16"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
    more: '<circle cx="5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="19" cy="12" r="1.4" fill="currentColor"/>',
    up: '<path d="M6 15l6-6 6 6"/>',
    down: '<path d="M6 9l6 6 6-6"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h9"/>',
  };

  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = ICONS[name] || '';
    return svg;
  }

  function button(label, { kind = '', iconName, onClick, title, disabled, iconOnly = false, type = 'button' } = {}) {
    const classes = ['btn', kind, iconOnly ? 'icon-only' : ''].filter(Boolean).join(' ');
    return el('button', {
      type,
      class: classes,
      title: title || (iconOnly ? label : null),
      'aria-label': iconOnly ? label : null,
      disabled: !!disabled,
      onclick: onClick,
    }, iconName ? icon(iconName) : null, iconOnly ? null : label);
  }

  function pill(text, tone) {
    return el('span', { class: `pill ${tone}`, text });
  }

  function showError(node, message) {
    node.textContent = message || '';
    node.hidden = !message;
  }

  // ---------- Formatting ----------

  const numberFmt = new Intl.NumberFormat('ar-u-nu-latn');
  const relativeFmt = new Intl.RelativeTimeFormat('ar-u-nu-latn', { numeric: 'auto' });
  const dateFmt = new Intl.DateTimeFormat('ar-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' });

  function serverNow() {
    return Date.now() + state.serverOffset;
  }

  function timeAgo(ts) {
    const seconds = Math.round((ts - serverNow()) / 1000);
    const abs = Math.abs(seconds);
    if (abs < 45) return 'هسه';
    if (abs < 3600) return relativeFmt.format(Math.round(seconds / 60), 'minute');
    if (abs < 86400) return relativeFmt.format(Math.round(seconds / 3600), 'hour');
    return relativeFmt.format(Math.round(seconds / 86400), 'day');
  }

  function duration(ms) {
    const minutes = Math.max(0, Math.floor(ms / 60000));
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    const mins = minutes % 60;
    if (days > 0) return hours ? `${days} يوم و ${hours} ساعة` : `${days} يوم`;
    if (hours > 0) return mins ? `${hours} ساعة و ${mins} دقيقة` : `${hours} ساعة`;
    return `${mins} دقيقة`;
  }

  function formatMb(mb) {
    return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
  }

  function fileName(url) {
    try {
      const parsed = new URL(url);
      const last = parsed.pathname.split('/').filter(Boolean).pop();
      return last ? decodeURIComponent(last) : parsed.hostname;
    } catch {
      return url;
    }
  }

  function isHttpsUrl(value) {
    if (typeof value !== 'string' || value.length > MAX_URL_LENGTH) return false;
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'https:' && !!parsed.hostname;
    } catch {
      return false;
    }
  }

  const isMediaUrl = isHttpsUrl;

  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const str = (v) => (typeof v === 'string' ? v : '');
  const shortCode = (id) => id.slice(0, 6).toUpperCase();
  const timestamp = (value) => num(value) != null && value > 0 && value <= 8640000000000000 ? value : null;

  // Firebase orders integer-like keys numerically first, then the rest lexicographically.
  function firebaseKeyOrder(a, b) {
    const ia = /^-?\d+$/.test(a);
    const ib = /^-?\d+$/.test(b);
    if (ia && ib) return Number(a) - Number(b);
    if (ia !== ib) return ia ? -1 : 1;
    return a < b ? -1 : a > b ? 1 : 0;
  }

  function newId() {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function mediaEntry(value, fallbackId) {
    // Legacy trial URLs are accepted only at the external data boundary.
    const raw = typeof value === 'string' ? { url: value, kind: 'video' } : value;
    if (!raw || typeof raw !== 'object' || !isMediaUrl(raw.url)) return null;
    const kind = raw.kind === 'image' ? 'image' : 'video';
    return {
      id: str(raw.id) || fallbackId,
      url: raw.url,
      kind,
      name: str(raw.name).slice(0, 240) || fileName(raw.url).slice(0, 240),
      duration_ms: Math.max(0, num(raw.duration_ms) ?? (kind === 'image' ? 10000 : 0)),
      fade_in_ms: Math.max(0, num(raw.fade_in_ms) || 0),
      fade_out_ms: Math.max(0, num(raw.fade_out_ms) || 0),
      fit: raw.fit === 'cover' ? 'cover' : 'contain',
    };
  }

  function toMediaList(value) {
    if (!value || typeof value !== 'object') return [];
    const keys = Object.keys(value).sort(firebaseKeyOrder);
    const seen = new Set();
    return keys.map((key) => {
      const entry = mediaEntry(value[key], `legacy-${key}`);
      if (entry) {
        const originalId = entry.id;
        let suffix = 0;
        while (seen.has(entry.id)) entry.id = `${originalId}-${key}-${++suffix}`;
        seen.add(entry.id);
      }
      return entry;
    }).filter(Boolean);
  }

  const cloneList = (list) => list.map((entry) => ({ ...entry }));
  const sameList = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  function validEntry(entry) {
    return !!entry && !!str(entry.id) && entry.id.length <= 128 && isMediaUrl(entry.url)
      && ['video', 'image'].includes(entry.kind) && !!str(entry.name) && entry.name.length <= 255
      && ['contain', 'cover'].includes(entry.fit)
      && ['duration_ms', 'fade_in_ms', 'fade_out_ms'].every((key) => Number.isSafeInteger(entry[key]) && entry[key] >= 0)
      && entry.fade_in_ms <= 5000 && entry.fade_out_ms <= 5000
      && entry.fade_in_ms + entry.fade_out_ms <= entry.duration_ms
      && (entry.kind !== 'image' || (entry.duration_ms >= 1000 && entry.duration_ms <= 86400000));
  }

  function clock(ms) {
    const total = Math.floor(Math.max(0, num(ms) || 0) / 1000);
    const seconds = String(total % 60).padStart(2, '0');
    const minutes = String(Math.floor(total / 60) % 60).padStart(2, '0');
    return total >= 3600 ? `${String(Math.floor(total / 3600)).padStart(2, '0')}:${minutes}:${seconds}` : `${minutes}:${seconds}`;
  }

  function errorText(error) {
    const code = str(error?.code) || str(error?.message);
    if (/permission[_-]denied/i.test(code)) {
      return 'الخدمة السحابية رفضت صلاحية المدير. اقفل اللوحة وادخل بالرمز مرة ثانية؛ إذا استمر الرفض، يحتاج مسؤول المشروع نشر قواعد قاعدة البيانات.';
    }
    if (/session-expired|unauthenticated|auth\/user-token-expired/i.test(code)) return 'انتهت الجلسة. اقفل اللوحة وادخل بالرمز مرة ثانية.';
    if (/upload-canceled/i.test(code)) return 'انلغى الرفع. تقدر تعيد المحاولة.';
    if (/github-token-missing/i.test(code)) return 'لازم تحط مفتاح GitHub مرة وحدة أولاً (فوق، بنفس هاي الصفحة) حتى تكدر ترفع.';
    if (/github-401/i.test(code)) return 'مفتاح GitHub غير صالح أو انلغى. سوّي مفتاح جديد وحطه بمكان المفتاح.';
    if (/github-40[34]/i.test(code)) return 'مفتاح GitHub ما عنده صلاحية الكتابة على مستودع playlist. سوّي مفتاح جديد واختار المستودع playlist وصلاحية Contents: Read and write.';
    if (/github-409|github-422/i.test(code)) return 'GitHub رفض الملف (ممكن ملف بنفس الاسم أو حجم كبير). أعد المحاولة.';
    if (/github-413/i.test(code)) return 'الملف أكبر من حد GitHub. صغّر الفيديو تحت 95 MiB.';
    if (/github-(429|5\d\d)/i.test(code)) return 'GitHub مشغول هسه. انتظر دقيقة وأعد المحاولة.';
    if (/pages-timeout/i.test(code)) return 'الملف انرفع بس رابطه ما صار جاهز بعد. اضغط إعادة المحاولة بعد دقيقتين (ما يعيد الرفع). إذا تكرر، تأكد إن GitHub Pages مفعّلة للمستودع.';
    if (/network|disconnected|retry-limit-exceeded/i.test(code)) return 'انقطع الاتصال. افحص الإنترنت وأعد المحاولة؛ لا تغلق الصفحة أثناء الرفع.';
    return `صار خطأ: ${code || 'غير معروف'}. أعد المحاولة بعد فحص الاتصال والخدمة السحابية.`;
  }

  function requireManager() {
    if (!pinUnlocked || !state.user || !auth.currentUser || Date.now() >= sessionDeadline) {
      throw new Error('session-expired');
    }
    if (!state.connected) throw new Error('disconnected');
  }

  async function managerWrite(operation) {
    requireManager();
    const epoch = sessionEpoch;
    const result = await operation();
    if (epoch !== sessionEpoch) throw new Error('session-expired');
    return result;
  }

  // ---------- Toasts, modal, confirm ----------

  const toastBox = $('toasts');
  const supportsPopover = typeof HTMLElement.prototype.showPopover === 'function';
  if (supportsPopover) toastBox.setAttribute('popover', 'manual');

  function toast(message, kind = '') {
    const node = el('div', { class: `toast ${kind}`.trim(), role: 'status', text: message });
    toastBox.append(node);
    if (supportsPopover) {
      // Re-showing moves the popover above any dialog opened since the last toast.
      if (toastBox.matches(':popover-open')) toastBox.hidePopover();
      toastBox.showPopover();
    }
    setTimeout(() => {
      node.remove();
      if (supportsPopover && !toastBox.childElementCount && toastBox.matches(':popover-open')) {
        toastBox.hidePopover();
      }
    }, kind === 'bad' ? 6000 : 3500);
  }

  const modal = $('modal');
  let modalCleanup = null;
  let modalGuard = null;

  function finishModal() {
    const cleanup = modalCleanup;
    modalCleanup = null;
    modalGuard = null;
    modal.replaceChildren();
    if (cleanup) cleanup();
  }

  modal.addEventListener('close', () => {
    if (!modal.open) finishModal();
  });
  modal.addEventListener('cancel', (event) => {
    event.preventDefault();
    requestCloseModal();
  });

  async function requestCloseModal() {
    if (modalGuard && !(await modalGuard())) return;
    if (modal.open) modal.close();
  }

  function openModal({ title, body, actions = [], wide = false, onClose = null, guard = null }) {
    if (modal.open) modal.close();
    finishModal();
    modal.append(el('div', { class: `modal-card${wide ? ' wide' : ''}` },
      el('div', { class: 'modal-head' },
        el('h2', { text: title }),
        button('إغلاق', { kind: 'ghost sm', iconName: 'x', iconOnly: true, onClick: requestCloseModal })),
      el('div', { class: 'modal-body' }, body),
      actions.length ? el('div', { class: 'modal-foot' }, actions) : null));
    modalCleanup = onClose;
    modalGuard = guard;
    modal.showModal();
    return { close: () => modal.open && modal.close() };
  }

  const confirmDialog = $('confirm');

  function confirmBox({ title, message, okText = 'تأكيد', danger = false }) {
    if (confirmDialog.open) return Promise.resolve(false);
    return new Promise((resolve) => {
      const ok = button(okText, { kind: danger ? 'danger solid' : 'primary', onClick: () => confirmDialog.close('ok') });
      const cancel = button('إلغاء', { kind: 'ghost', onClick: () => confirmDialog.close('cancel') });
      confirmDialog.replaceChildren(el('div', { class: 'modal-card' },
        el('div', { class: 'modal-head' }, el('h2', { text: title })),
        el('div', { class: 'modal-body' }, el('p', { style: 'margin:0;white-space:pre-line', text: message })),
        el('div', { class: 'modal-foot' }, cancel, ok)));
      confirmDialog.returnValue = '';
      confirmDialog.addEventListener('close', () => {
        const accepted = confirmDialog.returnValue === 'ok';
        confirmDialog.replaceChildren();
        resolve(accepted);
      }, { once: true });
      confirmDialog.showModal();
      (danger ? cancel : ok).focus();
    });
  }

  // ---------- State + listeners ----------

  const state = {
    user: null,
    connected: false,
    everConnected: false,
    serverOffset: 0,
    devices: {},
    names: {},
    devicePlaylists: {},
    playlist: [],
    config: null,
    appVersion: null,
    loaded: new Set(),
    denied: new Set(),
    filter: 'all',
    search: '',
    openMenu: null,
    library: {},
    deviceEditor: null,
    sync: null,
    githubToken: '',
  };

  let unsubscribers = [];
  let tickTimer = null;
  let renderQueued = false;

  function listen(path, onValue) {
    const ref = db.ref(path);
    const epoch = sessionEpoch;
    const callback = ref.on('value', (snap) => {
      if (!pinUnlocked || epoch !== sessionEpoch) return;
      state.loaded.add(path);
      if (state.denied.delete(path)) renderBanner();
      onValue(snap.val());
      scheduleRender();
    }, (error) => {
      if (!pinUnlocked || epoch !== sessionEpoch) return;
      console.warn(`Listener on /${path} cancelled`, error);
      state.denied.add(path);
      renderBanner();
    });
    unsubscribers.push(() => ref.off('value', callback));
  }

  function startListening() {
    listen('.info/connected', (v) => {
      state.connected = v === true;
      if (state.connected) state.everConnected = true;
      renderConnection();
    });
    listen('.info/serverTimeOffset', (v) => { state.serverOffset = num(v) || 0; });
    listen('devices', (v) => { state.devices = v && typeof v === 'object' ? v : {}; });
    listen('device_names', (v) => { state.names = v && typeof v === 'object' ? v : {}; });
    listen('device_playlists', (v) => {
      state.devicePlaylists = v && typeof v === 'object' ? v : {};
      if (state.deviceEditor) {
        state.deviceEditor.editor.setRemote(toMediaList(state.devicePlaylists[state.deviceEditor.id]));
      }
    });
    listen('playlist', (v) => {
      state.playlist = toMediaList(v);
      globalEditor.setRemote(state.playlist);
    });
    listen('config', (v) => {
      state.config = v && typeof v === 'object' ? v : null;
      fillConfigForm(false);
    });
    listen('app_version', (v) => { state.appVersion = v && typeof v === 'object' ? v : null; });
    listen('media_library', (v) => {
      state.library = v && typeof v === 'object' ? v : {};
      renderLibrary();
      if (libraryPickerRefresh) libraryPickerRefresh();
    });
    listen('sync', (v) => {
      state.sync = v && typeof v === 'object' && v.enabled === true && num(v.anchor_at) != null ? v : null;
      renderGlobalCommands();
    });
    listen('github_upload', (v) => {
      state.githubToken = str(v && v.token);
      renderGithubSetup();
    });
  }

  function stopListening() {
    unsubscribers.forEach((off) => off());
    unsubscribers = [];
  }

  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      if (!pinUnlocked) return;
      if (Date.now() >= sessionDeadline) { stopApp('انتهت جلسة الثماني ساعات. أدخل الرمز مرة ثانية.'); return; }
      renderDevices();
      renderUpdateTab();
      renderSync();
    });
  }

  // ---------- Topbar + banner ----------

  function renderConnection() {
    const badge = $('conn-badge');
    if (state.connected) {
      badge.className = 'pill ok';
      badge.textContent = 'متصل';
    } else if (state.everConnected) {
      badge.className = 'pill bad';
      badge.textContent = 'انقطع الاتصال';
    } else {
      badge.className = 'pill muted';
      badge.textContent = 'جاري الاتصال…';
    }
  }

  function renderBanner() {
    const banner = $('global-banner');
    banner.hidden = !state.denied.size;
    banner.className = 'banner bad';
    banner.replaceChildren(state.denied.size
      ? el('span', { role: 'alert', text: `رفضت الخدمة السحابية الوصول: ${Array.from(state.denied).join('، ')}. اقفل اللوحة وادخل بالرمز من جديد. إذا استمر الرفض، يحتاج مسؤول الخدمة إكمال إعداد الخادم والصلاحيات.` })
      : '');
  }

  // ---------- Tabs ----------

  const TAB_NAMES = ['screens', 'playlist', 'control', 'update', 'library'];

  function selectTab(name) {
    if (!TAB_NAMES.includes(name)) name = 'screens';
    document.querySelectorAll('.tabs [data-tab]').forEach((btn) => {
      const active = btn.dataset.tab === name;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('.tab-panel').forEach((panel) => {
      panel.classList.toggle('active', panel.id === `tab-${name}`);
    });
    if (location.hash !== `#${name}`) history.replaceState(null, '', `#${name}`);
  }

  document.querySelectorAll('.tabs [data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => selectTab(btn.dataset.tab));
  });

  // ---------- Commands ----------

  const ACTIONS = {
    play: { label: 'تشغيل', icon: 'play' },
    pause: { label: 'إيقاف مؤقت', icon: 'pause' },
    next: { label: 'المحتوى التالي', icon: 'next' },
    previous: { label: 'المحتوى السابق', icon: 'prev' },
    restart: { label: 'إعادة القائمة من الأول', icon: 'restart' },
    reload: { label: 'إعادة تشغيل التطبيق', icon: 'reload' },
    check_update: { label: 'فحص التحديث هسه', icon: 'download' },
    identify: { label: 'إظهار رمز الشاشة', icon: 'eye' },
    clear_cache: {
      label: 'مسح الوسائط المحفوظة',
      icon: 'broom',
      confirm: 'الشاشة راح تمسح الفيديوهات والصور المحفوظة عدها وترجع تنزلها من جديد، وهذا يصرف إنترنت.\nمتأكد؟',
    },
  };

  async function sendCommand(path, action, targetLabel, offline = false) {
    const meta = ACTIONS[action];
    if (meta.confirm && !(await confirmBox({ title: meta.label, message: meta.confirm, okText: 'نعم، امسح', danger: true }))) {
      return;
    }
    const id = db.ref().push().key;
    try {
      await managerWrite(() => db.ref(path).set({ id, action, ts: firebase.database.ServerValue.TIMESTAMP }));
      toast(offline
        ? `${targetLabel} غير متصلة هسه. الأمر «${meta.label}» راح يتنفذ أول ما ترجع.`
        : `انرسل «${meta.label}» إلى ${targetLabel}.`, offline ? '' : 'ok');
    } catch (error) {
      toast(errorText(error), 'bad');
    }
  }

  const SYNC_ACTIONS = new Set(['play', 'pause', 'next', 'previous', 'restart']);

  function renderGlobalCommands() {
    const grid = $('global-commands');
    grid.replaceChildren(...Object.entries(ACTIONS).map(([action, meta]) => {
      const shared = !!state.sync && SYNC_ACTIONS.has(action);
      return button(meta.label, {
        iconName: meta.icon,
        title: shared ? 'وضع التزامن شغّال: الأمر يحرك الساعة المشتركة، فكل الشاشات تتحرك سوا' : null,
        onClick: () => (state.sync && SYNC_ACTIONS.has(action) ? syncAction(action) : sendCommand('commands', action, 'كل الشاشات')),
      });
    }));
  }

  // ---------- Shared frame sync ----------

  // Must stay identical to app/src/main/java/com/signage/tv/player/SyncTimeline.kt.
  function mulberry32(seed) {
    let a = seed | 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return (t ^ (t >>> 14)) >>> 0;
    };
  }

  function syncTimeline(durations, shuffle, seed) {
    const playable = durations.map((d, i) => (d > 0 ? i : -1)).filter((i) => i >= 0);
    const total = playable.reduce((sum, i) => sum + durations[i], 0);
    const n = playable.length;
    let cachedCycle = null;
    let order = [];
    let starts = [];
    const load = (cycle) => {
      if (cycle === cachedCycle) return;
      order = playable.slice();
      if (shuffle) {
        const next = mulberry32(seed ^ Math.imul(cycle | 0, 0x9E3779B9 | 0));
        for (let i = order.length - 1; i > 0; i--) {
          const j = next() % (i + 1);
          [order[i], order[j]] = [order[j], order[i]];
        }
      }
      starts = [0];
      for (let i = 1; i < order.length; i++) starts.push(starts[i - 1] + durations[order[i - 1]]);
      cachedCycle = cycle;
    };
    const mod = (a, b) => ((a % b) + b) % b;
    const slotStart = (slot) => {
      const cycle = Math.floor(slot / n);
      load(cycle);
      return cycle * total + starts[mod(slot, n)];
    };
    const positionAt = (t) => {
      const cycle = Math.floor(t / total);
      const within = t - cycle * total;
      load(cycle);
      let pos = 0;
      while (pos + 1 < starts.length && starts[pos + 1] <= within) pos++;
      return { slot: cycle * n + pos, index: order[pos], offset: within - starts[pos], duration: durations[order[pos]] };
    };
    return { total, empty: n === 0, slotStart, positionAt };
  }

  function globalTimeline() {
    if (!state.sync) return null;
    const timeline = syncTimeline(state.playlist.map((entry) => entry.duration_ms),
      currentConfig().playback_order === 'shuffle', num(state.sync.seed) | 0);
    return timeline.empty ? null : timeline;
  }

  const syncBase = () => num(state.sync.paused_at) ?? serverNow();

  async function setSyncEnabled(enabled) {
    if (enabled) {
      const zero = state.playlist.filter((entry) => !(entry.duration_ms > 0)).length;
      const ok = await confirmBox({
        title: 'تشغيل التزامن',
        message: `كل الشاشات راح تبدي من أول القائمة بنفس اللحظة، وأي شاشة تنفتح بعدين تلتحق بنفس الفريم.${zero ? `\n\nانتباه: ${zero} عنصر بالقائمة العامة بدون مدة معروفة (روابط قديمة)، وهاي ما تنعرض بوضع التزامن. ارفعها من المكتبة حتى تنحسب مدتها.` : ''}\n\nالشاشات لازم تكون على إصدار التطبيق 3 أو أحدث.`,
        okText: 'شغّل التزامن',
      });
      if (!ok) return;
    } else if (!(await confirmBox({
      title: 'إطفاء التزامن',
      message: 'كل شاشة ترجع تشتغل لوحدها، وممكن تتباعد عن بعض.',
      okText: 'اطفِ التزامن',
      danger: true,
    }))) return;
    try {
      await managerWrite(() => (enabled
        ? db.ref('sync').set({ enabled: true, anchor_at: firebase.database.ServerValue.TIMESTAMP, seed: crypto.getRandomValues(new Int32Array(1))[0] })
        : db.ref('sync').remove()));
      toast(enabled ? 'انشغل التزامن. الشاشات تلتحق خلال ثواني.' : 'انطفى التزامن.', 'ok');
    } catch (e) {
      toast(errorText(e), 'bad');
    }
  }

  async function syncAction(action) {
    const s = state.sync;
    if (!s) return;
    const TS = firebase.database.ServerValue.TIMESTAMP;
    const pausedAt = num(s.paused_at);
    let update;
    if (action === 'restart') update = pausedAt != null ? { anchor_at: TS, paused_at: TS } : { anchor_at: TS };
    else if (action === 'pause') {
      if (pausedAt != null) { toast('الشاشات متوقفة أصلاً.'); return; }
      update = { paused_at: TS };
    } else if (action === 'play') {
      if (pausedAt == null) { toast('الشاشات شغّالة أصلاً.'); return; }
      update = { anchor_at: Math.round(num(s.anchor_at) + (serverNow() - pausedAt)), paused_at: null };
    } else {
      const timeline = globalTimeline();
      if (!timeline) { toast('القائمة العامة ما بيها عناصر بمدة معروفة.', 'bad'); return; }
      const base = syncBase();
      const pos = timeline.positionAt(base - num(s.anchor_at));
      update = { anchor_at: Math.round(base - timeline.slotStart(pos.slot + (action === 'next' ? 1 : -1))) };
    }
    try {
      await managerWrite(() => db.ref('sync').update(update));
      toast(`انرسل «${ACTIONS[action].label}» لكل الشاشات المتزامنة.`, 'ok');
    } catch (e) {
      toast(errorText(e), 'bad');
    }
  }

  const SYNC_STATES = {
    off: ['التزامن طافي', 'muted'],
    no_timeline: ['ما عدها محتوى بمدة معروفة', 'warn'],
    local: ['موقوفة محلياً (خارج التزامن)', 'warn'],
    joining: ['تلتحق بالبقية', 'warn'],
    synced: ['متزامنة', 'ok'],
    correcting: ['تصحح تأخير', 'warn'],
    paused: ['متوقفة ويا البقية', 'muted'],
  };
  const CLOCK_SOURCES = { ntp: 'ساعة إنترنت (NTP)', firebase: 'ساعة Firebase', device: 'ساعة الجهاز (أقل دقة)' };

  let syncSignature = '';
  let syncLive = null;

  function renderSync() {
    const panel = $('sync-panel');
    const s = state.sync;
    const signature = JSON.stringify([!!s, num(s?.paused_at) != null, state.loaded.has('sync')]);
    if (signature !== syncSignature) {
      syncSignature = signature;
      syncLive = el('div', { class: 'now-playing' });
      const summary = el('div', { class: 'muted-text' });
      panel.replaceChildren(
        el('div', { class: 'form-actions', style: 'justify-content:flex-start' },
          s ? pill(num(s.paused_at) != null ? 'التزامن شغّال — متوقف' : 'التزامن شغّال', num(s.paused_at) != null ? 'warn' : 'ok')
            : pill(state.loaded.has('sync') ? 'التزامن طافي' : 'جاري التحميل…', 'muted'),
          button(s ? 'اطفِ التزامن' : 'شغّل التزامن', { kind: s ? 'danger sm' : 'primary', onClick: () => setSyncEnabled(!s) })),
        s ? syncLive : el('p', { class: 'muted-text', style: 'margin:0', text: 'لما التزامن طافي، كل شاشة تشتغل لوحدها.' }),
        summary,
        el('p', { class: 'muted-text', style: 'margin:0', text: 'بوضع التزامن، أزرار التشغيل والإيقاف والتالي والسابق والإعادة تحت تتحكم بكل الشاشات سوا. الشاشات اللي عدها قائمة خاصة تتزامن ويا الشاشات اللي عدها نفس القائمة.' }));
      syncLive.summary = summary;
    }
    if (!syncLive) return;
    const devices = allDevices().filter((v) => v.online);
    const count = (states) => devices.filter((v) => states.includes(str(v.d.sync_state))).length;
    const old = devices.filter((v) => (deviceVersion(v.d) ?? 0) < 3).length;
    syncLive.summary.textContent = s
      ? `من ${devices.length} شاشة متصلة: ${count(['synced', 'paused'])} متزامنة · ${count(['joining', 'correcting'])} تلتحق أو تصحح${old ? ` · ${old} إصدار قديم ما يدعم التزامن` : ''}`
      : '';
    if (!s) return;
    const timeline = globalTimeline();
    if (!timeline) {
      syncLive.replaceChildren(el('strong', { text: 'القائمة العامة ما بيها عناصر بمدة معروفة، فما كو شي يتزامن.' }));
      return;
    }
    const pos = timeline.positionAt(syncBase() - num(s.anchor_at));
    const entry = state.playlist[pos.index];
    const zero = state.playlist.length - state.playlist.filter((item) => item.duration_ms > 0).length;
    syncLive.replaceChildren(
      el('small', { text: `اللحظة المشتركة للقائمة العامة · عنصر ${pos.index + 1} من ${state.playlist.length}` }),
      el('strong', { text: entry ? entry.name : '—' }),
      el('bdi', { class: 'measured-time', dir: 'ltr', text: `${clock(pos.offset)} / ${clock(pos.duration)}` }),
      el('progress', { class: 'playback-progress', max: '100', value: Math.min(100, pos.offset / pos.duration * 100), 'aria-label': 'تقدم العنصر الحالي بالساعة المشتركة' }),
      zero ? el('small', { class: 'form-error', text: `${zero} عنصر بدون مدة معروفة ما ينعرض بالتزامن.` }) : null);
  }

  // ---------- Screens tab ----------

  const STATES = {
    playing: ['يعرض', 'ok'],
    paused: ['متوقف مؤقتاً', 'warn'],
    buffering: ['يحمّل الفيديو', 'warn'],
    waiting: ['قائمة التشغيل فاضية', 'warn'],
    error: ['ما يكدر يشغّل الفيديوهات', 'bad'],
    background: ['التطبيق مو ظاهر على الشاشة', 'warn'],
    idle: ['جاهز', 'muted'],
    stopped: ['التطبيق مسكّر', 'muted'],
  };

  function deviceView(id) {
    const raw = state.devices[id];
    const d = raw && typeof raw === 'object' ? raw : {};
    const lastSeen = timestamp(d.last_seen);
    const online = d.online === true && lastSeen != null && serverNow() - lastSeen < ONLINE_WINDOW_MS;
    const name = str(state.names[id]).trim();
    const model = str(d.model);
    return {
      id,
      code: shortCode(id),
      name,
      model,
      title: name || model || 'شاشة بدون اسم',
      online,
      lastSeen,
      state: str(d.state),
      d,
    };
  }

  function allDevices() {
    return Object.keys(state.devices)
      .map(deviceView)
      .sort((a, b) => (b.online - a.online) || a.title.localeCompare(b.title, 'ar'));
  }

  const deviceCards = new Map();

  function renderDevices() {
    const loaded = state.loaded.has('devices');
    const devices = allDevices();
    const online = devices.filter((v) => v.online);
    $('stat-total').textContent = numberFmt.format(devices.length);
    $('stat-online').textContent = numberFmt.format(online.length);
    $('stat-offline').textContent = numberFmt.format(devices.length - online.length);
    $('stat-playing').textContent = numberFmt.format(online.filter((v) => v.state === 'playing').length);

    const query = state.search.trim().toLowerCase();
    const visible = devices.filter((v) => {
      if (state.filter === 'online' && !v.online) return false;
      if (state.filter === 'offline' && v.online) return false;
      if (!query) return true;
      return [v.title, v.code, v.model, v.id].some((s) => s.toLowerCase().includes(query));
    });

    $('device-empty').hidden = !loaded || devices.length > 0;
    $('device-no-match').hidden = devices.length === 0 || visible.length > 0;
    const grid = $('device-grid');
    const focused = grid.contains(document.activeElement) ? document.activeElement : null;
    const wanted = new Set(visible.map((v) => v.id));
    for (const [id, card] of deviceCards) {
      if (!wanted.has(id)) { card.remove(); deviceCards.delete(id); }
    }
    visible.forEach((v, index) => {
      const fresh = deviceCard(v);
      let card = deviceCards.get(v.id);
      if (!card) { card = fresh; deviceCards.set(v.id, card); }
      else {
        card.className = fresh.className;
        card.querySelector('.device-head').replaceWith(fresh.querySelector('.device-head'));
        card.querySelector('.device-body').replaceWith(fresh.querySelector('.device-body'));
        // Never replace the action buttons, focused controls, or open details menu.
      }
      if (grid.children[index] !== card) grid.insertBefore(card, grid.children[index] || null);
    });
    if (focused?.isConnected && document.activeElement !== focused) focused.focus({ preventScroll: true });
  }

  function kv(label, ...value) {
    return el('div', { class: 'kv' }, el('span', { text: label }), el('span', null, ...value));
  }

  const ltr = (text) => el('bdi', { dir: 'ltr', text });
  const deviceVersion = (d) => num(d.version_code) ?? num(d.version);
  const versionLabel = (d) => `${str(d.version_name) || str(d.version) || '?'} (${deviceVersion(d) ?? '?'})`;

  function deviceCard(v) {
    const d = v.d;
    const [stateLabel, tone] = v.online ? (STATES[v.state] || ['غير معروف', 'muted']) : ['غير متصلة', 'bad'];
    const size = Math.max(0, Math.floor(num(d.playlist_size) || 0));
    const index = Math.max(0, Math.floor(num(d.now_index) || 0));
    const nowPlaying = str(d.now_playing);
    const cached = Math.max(0, Math.floor(num(d.cached) ?? num(d.cache) ?? 0));
    const freeMb = num(d.free_mb) ?? num(d.free);
    const versionCode = deviceVersion(d);
    const target = num(state.appVersion && state.appVersion.version_code);
    const outdated = versionCode != null && target != null && versionCode < target;
    const custom = toMediaList(state.devicePlaylists[v.id]);
    const startedAt = num(d.started_at);
    const send = (action) => {
      const current = deviceView(v.id);
      if (state.sync && ['next', 'previous', 'restart'].includes(action) && (deviceVersion(current.d) ?? 0) >= 3) {
        toast('التزامن شغّال: التالي والسابق والإعادة تنطبق على كل الشاشات سوا من تبويب «التحكم والإعدادات».');
        return undefined;
      }
      return sendCommand(`device_commands/${v.id}`, action, `الشاشة «${current.title}»`, !current.online);
    };

    const body = el('div', { class: 'device-body' });
    if (nowPlaying || str(d.media_name) || num(d.position_ms) != null) {
      const position = num(d.position_ms);
      const total = num(d.duration_ms);
      const sampledAt = timestamp(d.sampled_at);
      const age = sampledAt == null ? null : Math.max(0, serverNow() - sampledAt);
      const reportInterval = Math.max(1000, num(d.report_interval_ms) || 1000);
      const stale = age == null || age > Math.max(5000, reportInterval * 3) || !v.online;
      const measured = position == null ? 'القياس المباشر غير متوفر — حدّث التطبيق إلى الإصدار 2 أو أحدث'
        : `${clock(position)} / ${total != null && total > 0 ? clock(total) : '—'} (قياس من الشاشة)`;
      const freshness = age == null ? 'آخر قياس غير متوفر'
        : `آخر قياس قبل ${Math.floor(age / 1000)} ثانية${stale ? ' — قياس قديم' : ''}`;
      const progress = total != null && total > 0 && position != null ? Math.max(0, Math.min(100, position / total * 100)) : 0;
      const kind = d.media_kind === 'image' ? 'صورة' : d.media_kind === 'video' ? 'فيديو' : 'وسائط';
      body.append(el('div', { class: `now-playing${stale ? ' stale' : ''}` },
        el('small', { text: `${kind} · ${stateLabel}${size ? ` (${index + 1} من ${size})` : ''}` }),
        el('strong', { title: nowPlaying, text: str(d.media_name) || fileName(nowPlaying) || 'المحتوى الحالي' }),
        el('bdi', { class: 'measured-time', dir: 'ltr', text: measured }),
        el('progress', { class: 'playback-progress', max: '100', value: progress, 'aria-label': 'تقدم التشغيل المقاس من الشاشة' }),
        el('small', { class: 'sample-freshness', title: sampledAt ? dateFmt.format(sampledAt) : '', text: freshness })));
    }
    body.append(kv('قائمة التشغيل', custom.length
      ? el('b', { text: `خاصة بيها (${custom.length} عنصر)` })
      : `العامة (${state.playlist.length} عنصر)`));
    if (size > 0) {
      body.append(kv('محفوظ على الشاشة', `${cached} من ${size}`,
        freeMb != null ? ' · فاضي ' : null,
        freeMb != null ? ltr(formatMb(freeMb)) : null));
      body.append(el('div', { class: 'progress', title: `${cached} من ${size}` },
        el('i', { style: `width:${Math.min(100, Math.round((cached / size) * 100))}%` })));
    } else if (freeMb != null) {
      body.append(kv('المساحة الفاضية', ltr(formatMb(freeMb))));
    }
    body.append(kv('إصدار التطبيق',
      versionCode != null ? ltr(versionLabel(d)) : 'غير معروف',
      outdated ? ' ' : null,
      outdated ? pill('ينتظر التحديث', 'warn') : null));
    if (versionCode == null || versionCode < 2) body.append(pill('إصدار قديم: بدون صور أو قياس مباشر', 'warn'));
    if (state.sync && v.online) {
      const syncState = str(d.sync_state);
      if (versionCode == null || versionCode < 3 || !syncState) {
        body.append(pill('ما تدعم التزامن — حدّث التطبيق إلى الإصدار 3', 'warn'));
      } else {
        const [syncLabel, syncTone] = SYNC_STATES[syncState] || ['غير معروف', 'muted'];
        const drift = num(d.sync_drift_ms);
        const corrections = num(d.sync_corrections);
        body.append(kv('التزامن', pill(syncLabel, syncTone),
          drift != null ? ' · فرق ' : null, drift != null ? ltr(`${Math.round(drift)} ms`) : null,
          corrections ? ` · ${corrections} تصحيح` : null,
          CLOCK_SOURCES[str(d.clock_source)] ? ` · ${CLOCK_SOURCES[str(d.clock_source)]}` : null));
      }
    }
    if (v.online && startedAt) {
      body.append(kv('شغّالة من', duration(serverNow() - startedAt)));
    } else if (v.lastSeen) {
      body.append(kv('آخر ظهور', el('span', { title: dateFmt.format(v.lastSeen), text: timeAgo(v.lastSeen) })));
    }

    const menuItem = (label, iconName, onClick, danger = false) => el('button', {
      type: 'button',
      class: danger ? 'danger' : null,
      onclick: (event) => {
        event.currentTarget.closest('details').open = false;
        onClick();
      },
    }, icon(iconName), label);

    const menu = el('details', {
      class: 'menu',
      ontoggle: (event) => {
        if (!event.currentTarget.isConnected) return;
        if (event.currentTarget.open) {
          state.openMenu = v.id;
          placeMenu(event.currentTarget);
          document.querySelectorAll('details.menu[open]').forEach((m) => { if (m !== event.currentTarget) m.open = false; });
        } else if (state.openMenu === v.id) {
          state.openMenu = null;
        }
      },
    },
    el('summary', { class: 'btn ghost sm icon-only', title: 'خيارات أكثر', 'aria-label': 'خيارات أكثر' }, icon('more')),
    el('div', { class: 'menu-list' },
      menuItem('قائمة تشغيل خاصة', 'list', () => openDevicePlaylist(v.id)),
      menuItem('تغيير الاسم', 'edit', () => renameDevice(v.id)),
      el('hr'),
      menuItem(ACTIONS.restart.label, 'restart', () => send('restart')),
      menuItem(ACTIONS.reload.label, 'reload', () => send('reload')),
      menuItem(ACTIONS.check_update.label, 'download', () => send('check_update')),
      menuItem(ACTIONS.clear_cache.label, 'broom', () => send('clear_cache')),
      el('hr'),
      menuItem('حذف من اللوحة', 'trash', () => deleteDevice(v.id), true)));
    if (state.openMenu === v.id) menu.open = true;

    return el('article', { class: `device${v.online ? '' : ' offline'}` },
      el('div', { class: 'device-head' },
        el('div', { class: 'device-title' },
          el('h3', { title: v.title, text: v.title }),
          el('small', null, el('span', { class: 'code-tag', dir: 'ltr', text: v.code }),
            v.name && v.model ? ` · ${v.model}` : '')),
        pill(stateLabel, tone)),
      body,
      el('div', { class: 'device-actions' },
        button(ACTIONS.previous.label, { kind: 'sm', iconName: 'prev', iconOnly: true, onClick: () => send('previous') }),
        button(ACTIONS.play.label, { kind: 'sm', iconName: 'play', iconOnly: true, onClick: () => send('play') }),
        button(ACTIONS.pause.label, { kind: 'sm', iconName: 'pause', iconOnly: true, onClick: () => send('pause') }),
        button(ACTIONS.next.label, { kind: 'sm', iconName: 'next', iconOnly: true, onClick: () => send('next') }),
        el('span', { class: 'spacer' }),
        button('تعريف', { kind: 'ghost sm', iconName: 'eye', title: 'يطلع رمز الشاشة عليها 20 ثانية', onClick: () => send('identify') }),
        menu));
  }

  // Opens upward by default; flips down when the sticky topbar would cover it.
  function placeMenu(menu) {
    menu.classList.remove('down');
    const list = menu.querySelector('.menu-list');
    const topbar = document.querySelector('.topbar').getBoundingClientRect().bottom;
    if (list.getBoundingClientRect().top < topbar + 8) menu.classList.add('down');
  }

  document.addEventListener('click', (event) => {
    document.querySelectorAll('details.menu[open]').forEach((menu) => {
      if (!menu.contains(event.target)) menu.open = false;
    });
  });

  $('device-search').addEventListener('input', (event) => {
    state.search = event.target.value;
    renderDevices();
  });

  $('device-filter').addEventListener('click', (event) => {
    const btn = event.target.closest('[data-filter]');
    if (!btn) return;
    state.filter = btn.dataset.filter;
    $('device-filter').querySelectorAll('[data-filter]').forEach((b) => b.classList.toggle('active', b === btn));
    renderDevices();
  });

  function renameDevice(id) {
    const v = deviceView(id);
    const input = el('input', { type: 'text', maxlength: '60', value: v.name, placeholder: v.model || 'مثلاً: شاشة الاستقبال' });
    const error = el('p', { class: 'form-error', hidden: true });
    const save = async () => {
      const name = input.value.trim();
      try {
        await managerWrite(() => name ? db.ref(`device_names/${id}`).set(name) : db.ref(`device_names/${id}`).remove());
        dialog.close();
        toast('انحفظ الاسم.', 'ok');
      } catch (e) {
        showError(error, errorText(e));
      }
    };
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter') save(); });
    const dialog = openModal({
      title: `اسم الشاشة ${v.code}`,
      body: [el('label', { class: 'field' }, el('span', { text: 'الاسم' }), input),
        el('p', { class: 'muted-text', style: 'margin:0', text: 'اتركه فاضي حتى يرجع يطلع اسم جهاز الشاشة.' }), error],
      actions: [button('إلغاء', { kind: 'ghost', onClick: () => dialog.close() }), button('حفظ', { kind: 'primary', onClick: save })],
    });
    input.focus();
    input.select();
  }

  async function deleteDevice(id) {
    const v = deviceView(id);
    const ok = await confirmBox({
      title: `حذف «${v.title}»`,
      message: 'راح تنمسح الشاشة واسمها وقائمتها الخاصة من اللوحة.\nإذا الشاشة بعدها شغّالة راح ترجع تطلع لوحدها خلال دقيقة (بدون اسم). حتى توقفها نهائياً، امسح التطبيق منها.',
      okText: 'حذف',
      danger: true,
    });
    if (!ok) return;
    try {
      await managerWrite(() => db.ref().update({
        [`devices/${id}`]: null,
        [`device_names/${id}`]: null,
        [`device_playlists/${id}`]: null,
        [`device_commands/${id}`]: null,
      }));
      toast('انحذفت الشاشة من اللوحة.', 'ok');
    } catch (e) {
      toast(errorText(e), 'bad');
    }
  }

  // ---------- Playlist editor ----------

  // ---------- Shared cloud media library ----------

  // GitHub's Contents API refuses files above 100 MB; keep headroom for the request envelope.
  const MIME_TYPES = {
    'video/mp4': { kind: 'video', ext: 'mp4', max: 95 * 1024 * 1024 },
    'video/webm': { kind: 'video', ext: 'webm', max: 95 * 1024 * 1024 },
    'image/jpeg': { kind: 'image', ext: 'jpg', max: 20 * 1024 * 1024 },
    'image/png': { kind: 'image', ext: 'png', max: 20 * 1024 * 1024 },
    'image/webp': { kind: 'image', ext: 'webp', max: 20 * 1024 * 1024 },
  };
  const uploads = new Map();
  const metadataCancels = new Set();
  const activePreviews = new Set();
  let libraryPickerRefresh = null;
  let libraryPickerClose = null;

  function validateFile(file) {
    const spec = Object.hasOwn(MIME_TYPES, file.type) ? MIME_TYPES[file.type] : null;
    if (!spec) throw new Error('نوع الملف غير مدعوم. اختَر MP4 / WebM أو JPEG / PNG / WebP فقط؛ SVG غير مسموح.');
    if (file.size <= 0 || file.size > spec.max) throw new Error(`حجم الملف لازم يكون أكثر من صفر وحتى ${spec.max / (1024 * 1024)} MiB.`);
    return spec;
  }

  async function verifyFileSignature(file) {
    const bytes = new Uint8Array(await file.slice(0, 64).arrayBuffer());
    const matches = (offset, signature) => signature.every((byte, i) => bytes[offset + i] === byte);
    const valid = file.type === 'image/jpeg' ? matches(0, [255, 216, 255])
      : file.type === 'image/png' ? matches(0, [137, 80, 78, 71, 13, 10, 26, 10])
      : file.type === 'image/webp' ? matches(0, [82, 73, 70, 70]) && matches(8, [87, 69, 66, 80])
      : file.type === 'video/webm' ? matches(0, [26, 69, 223, 163])
      : file.type === 'video/mp4' && matches(4, [102, 116, 121, 112]);
    if (!valid) throw new Error('محتوى الملف ما يطابق نوعه المسموح. اختَر الملف الأصلي الصحيح، بدون تغيير امتداد SVG أو ملف آخر.');
  }

  function decodeMetadata(file, kind, job) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const media = kind === 'video' ? document.createElement('video') : new Image();
      let settled = false;
      let timer;
      const cleanup = () => {
        clearTimeout(timer);
        metadataCancels.delete(cancel);
        if (job) job.abortMetadata = null;
        media.onload = media.onerror = media.onloadedmetadata = null;
        media.removeAttribute('src');
        if (kind === 'video') media.load();
        URL.revokeObjectURL(url);
      };
      const finish = (error) => {
        if (settled) return;
        settled = true;
        const width = kind === 'video' ? media.videoWidth : media.naturalWidth;
        const height = kind === 'video' ? media.videoHeight : media.naturalHeight;
        const durationMs = kind === 'video' ? Math.round(media.duration * 1000) : 10000;
        cleanup();
        if (error) reject(error);
        else if (!width || !height || !Number.isSafeInteger(durationMs) || durationMs <= 0) {
          reject(new Error('ما كدرت أقرأ أبعاد أو مدة الملف. اختَر ملف صالح يمكن للمتصفح تشغيله.'));
        } else resolve({ width, height, duration_ms: durationMs });
      };
      const cancel = () => finish(new Error('upload-canceled'));
      metadataCancels.add(cancel);
      if (job) job.abortMetadata = cancel;
      timer = setTimeout(() => finish(new Error('فحص الملف أخذ وقت طويل. اختَر ملف صالح وأعد المحاولة.')), 30000);
      media.onerror = () => finish(new Error('الملف تالف أو ترميزه غير مدعوم بالمتصفح. جرّب فيديو H.264 MP4 أو صورة صالحة.'));
      if (kind === 'video') { media.preload = 'metadata'; media.onloadedmetadata = () => finish(); }
      else media.onload = () => finish();
      media.src = url;
    });
  }

  function libraryAssets() {
    return Object.entries(state.library).map(([id, raw]) => {
      const entry = mediaEntry(raw, id);
      return entry ? { ...entry, storage_path: str(raw.storage_path), bytes: num(raw.bytes) || 0, sha: str(raw.sha),
        created_at: num(raw.created_at) || 0, width: num(raw.width), height: num(raw.height) } : null;
    }).filter(Boolean).sort((a, b) => b.created_at - a.created_at || a.name.localeCompare(b.name, 'ar'));
  }

  function assetCard(asset, onSelect, selectLabel, onDelete = null) {
    return el('article', { class: 'library-asset' },
      pill(asset.kind === 'image' ? 'صورة' : 'فيديو', 'muted'),
      el('strong', { title: asset.name, text: asset.name }),
      el('small', { class: 'muted-text', text: `${formatMb(asset.bytes / (1024 * 1024))}${asset.width && asset.height ? ` · ${asset.width} × ${asset.height}` : ''}` }),
      el('div', { class: 'group' },
        button('معاينة', { kind: 'ghost sm', iconName: 'eye', onClick: () => previewMedia(asset) }),
        button(selectLabel, { kind: 'primary sm', iconName: 'plus', onClick: () => onSelect(asset) }),
        onDelete ? button('حذف', { kind: 'danger sm', iconName: 'trash', iconOnly: true, onClick: () => onDelete(asset) }) : null));
  }

  function renderLibrary() {
    const assets = libraryAssets();
    $('library-empty').hidden = !state.loaded.has('media_library') || assets.length > 0;
    $('media-library').replaceChildren(...assets.map((asset) => assetCard(asset, (entry) => {
      globalEditor.addEntry(entry);
      toast('انضافت للقائمة العامة كمسودة. احفظ القائمة حتى تظهر على الشاشات.', 'ok');
    }, 'أضف للعامة', deleteAsset)));
  }

  // ---------- GitHub media hosting ----------

  let githubQueue = Promise.resolve();

  // Commits to one branch must be sequential or GitHub answers 409 conflicts.
  function githubSerial(task) {
    const run = githubQueue.then(task, task);
    githubQueue = run.catch(() => {});
    return run;
  }

  function githubRequest(method, path, body, { token = state.githubToken, onProgress = null, job = null } = {}) {
    return new Promise((resolve, reject) => {
      if (!token) { reject(new Error('github-token-missing')); return; }
      const xhr = new XMLHttpRequest();
      xhr.open(method, `https://api.github.com${path}`);
      xhr.setRequestHeader('Accept', 'application/vnd.github+json');
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.setRequestHeader('X-GitHub-Api-Version', '2022-11-28');
      if (body) xhr.setRequestHeader('Content-Type', 'application/json');
      if (onProgress) xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(event.loaded / event.total); };
      xhr.onload = () => {
        let data = null;
        try { data = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch { data = null; }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(Object.assign(new Error(`github-${xhr.status}`), { status: xhr.status }));
      };
      xhr.onerror = () => reject(new Error('network'));
      xhr.onabort = () => reject(new Error('upload-canceled'));
      if (job) job.xhr = xhr;
      xhr.send(body || null);
    }).finally(() => { if (job) job.xhr = null; });
  }

  const contentsPath = (path) => `/repos/${GITHUB_REPO}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;

  function readBase64(file, job) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      job.reader = reader;
      reader.onload = () => {
        const result = String(reader.result);
        resolve(result.slice(result.indexOf(',') + 1));
      };
      reader.onerror = () => reject(new Error('ما كدرت أقرا الملف من الجهاز. اختاره مرة ثانية.'));
      reader.onabort = () => reject(new Error('upload-canceled'));
      reader.readAsDataURL(file);
    }).finally(() => { job.reader = null; });
  }

  async function existingSha(path) {
    try {
      const data = await githubRequest('GET', `${contentsPath(path)}?ref=main`);
      return /^[0-9a-f]{40}$/.test(str(data?.sha)) ? data.sha : '';
    } catch (error) {
      if (error.status === 404) return '';
      throw error;
    }
  }

  async function waitForPages(url, job, check) {
    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline) {
      check();
      try {
        const response = await fetch(`${url}?v=${Date.now()}`, { method: 'HEAD', cache: 'no-store' });
        if (response.ok) return;
      } catch { /* Pages may still be building; keep polling. */ }
      const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      job.message = `الملف انرفع. GitHub يجهّز الرابط (عادةً دقيقة)… باقي حد أقصى ${Math.ceil(left / 60)} دقيقة`;
      renderUpload(job);
      await new Promise((resolve) => setTimeout(resolve, 8000));
    }
    throw new Error('pages-timeout');
  }

  async function deleteAsset(asset) {
    const inUse = [state.playlist, ...Object.values(state.devicePlaylists).map(toMediaList)]
      .some((list) => list.some((entry) => entry.url === asset.url));
    if (inUse) {
      toast(`«${asset.name}» مستخدم بقائمة تشغيل. شيله من القوائم واحفظها أولاً، بعدين احذفه.`, 'bad');
      return;
    }
    const onGithub = /^media\/[0-9a-f-]{36}\.[a-z0-9]+$/.test(asset.storage_path) && asset.url.startsWith(PAGES_BASE);
    if (!(await confirmBox({
      title: `حذف «${asset.name}»`,
      message: onGithub ? 'الملف ينحذف من المكتبة ومن مستودع GitHub، ورابطه يبطل يشتغل.' : 'الملف ينحذف من المكتبة فقط.',
      okText: 'حذف',
      danger: true,
    }))) return;
    try {
      requireManager();
      if (onGithub) {
        await githubSerial(async () => {
          const sha = asset.sha || await existingSha(asset.storage_path);
          if (!sha) return;
          await githubRequest('DELETE', contentsPath(asset.storage_path),
            JSON.stringify({ message: `Remove signage media ${asset.storage_path}`, sha, branch: 'main' }))
            .catch((error) => { if (error.status !== 404) throw error; });
        });
      }
      await managerWrite(() => db.ref(`media_library/${asset.id}`).remove());
      toast('انحذف الملف.', 'ok');
    } catch (e) {
      toast(errorText(e), 'bad');
    }
  }

  let githubSignature = '';

  function renderGithubSetup() {
    const box = $('github-setup');
    const signature = `${pinUnlocked}:${state.loaded.has('github_upload')}:${!!state.githubToken}`;
    if (signature === githubSignature) return;
    githubSignature = signature;
    if (!pinUnlocked || !state.loaded.has('github_upload')) { box.replaceChildren(); return; }
    if (state.githubToken) {
      box.replaceChildren(el('div', { class: 'form-actions', style: 'justify-content:flex-start' },
        pill('مفتاح رفع GitHub محفوظ', 'ok'),
        button('غيّر المفتاح', { kind: 'ghost sm', onClick: () => editGithubToken() }),
        button('احذف المفتاح', { kind: 'danger sm', onClick: removeGithubToken })));
      return;
    }
    editGithubToken();
  }

  function editGithubToken() {
    const box = $('github-setup');
    const input = el('input', { type: 'password', dir: 'ltr', autocomplete: 'off', spellcheck: 'false', placeholder: 'github_pat_…' });
    const error = el('p', { class: 'form-error', hidden: true });
    const save = button('تحقق واحفظ', { kind: 'primary', onClick: async () => {
      const token = input.value.trim();
      if (!/^github_pat_[A-Za-z0-9_]{20,255}$/.test(token)) {
        showError(error, 'المفتاح لازم يبدي بـ github_pat_ . انسخه كامل من صفحة GitHub.');
        return;
      }
      save.disabled = true;
      showError(error, '');
      try {
        requireManager();
        const repo = await githubRequest('GET', `/repos/${GITHUB_REPO}`, null, { token });
        if (repo?.full_name?.toLowerCase() !== GITHUB_REPO.toLowerCase()) throw new Error('github-404');
        await managerWrite(() => db.ref('github_upload').set({ token }));
        input.value = '';
        toast('انحفظ مفتاح GitHub. تقدر ترفع هسه.', 'ok');
      } catch (e) {
        showError(error, errorText(e));
      } finally {
        save.disabled = false;
      }
    } });
    box.replaceChildren(el('div', { class: 'banner' },
      el('div', null,
        el('strong', { text: 'إعداد الرفع المجاني (مرة وحدة بس)' }),
        el('ol', { style: 'margin:.5em 0;padding-inline-start:1.4em' },
          el('li', null, 'اضغط ', el('a', { href: GITHUB_TOKEN_URL, target: '_blank', rel: 'noopener noreferrer', text: 'افتح صفحة إنشاء المفتاح' }), ' وسجّل دخول GitHub إذا طلب.'),
          el('li', { text: 'بقسم Repository access اختار Only select repositories واختار playlist.' }),
          el('li', { text: 'تأكد إن Contents مكتوب يمّه Read and write، وبعدين اضغط Generate token.' }),
          el('li', { text: 'انسخ المفتاح (يبدي بـ github_pat_) والصقه هنا واضغط تحقق واحفظ.' })),
        el('p', { class: 'muted-text', style: 'margin:0', text: 'المفتاح ينحفظ بقاعدة البيانات ويقدر يشوفه بس اللي يعرف رمز اللوحة. صلاحيته بس رفع ملفات على مستودع playlist.' }),
        el('div', { class: 'form-actions', style: 'justify-content:flex-start' }, input, save),
        error,
        state.githubToken ? button('رجوع', { kind: 'ghost sm', onClick: () => { githubSignature = ''; renderGithubSetup(); } }) : null)));
  }

  async function removeGithubToken() {
    if (!(await confirmBox({
      title: 'حذف مفتاح GitHub',
      message: 'بعد الحذف ما تكدر ترفع ملفات جديدة إلا تحط مفتاح ثاني. الملفات المرفوعة تبقى شغالة.\nحتى تلغيه نهائياً، احذفه هم من إعدادات GitHub.',
      okText: 'احذف المفتاح',
      danger: true,
    }))) return;
    try {
      await managerWrite(() => db.ref('github_upload').remove());
      toast('انحذف المفتاح.', 'ok');
    } catch (e) {
      toast(errorText(e), 'bad');
    }
  }

  function chooseLibrary(editor) {
    if (libraryPickerClose) libraryPickerClose();
    const list = el('div', { class: 'library-grid' });
    const note = el('p', { class: 'muted-text', text: 'كل ضغطة تضيف نسخة مستقلة. بعد الاختيار حدّد المدة والتلاشي بالقائمة ثم احفظ.' });
    const dialog = el('dialog', { class: 'modal' }, el('div', { class: 'modal-card wide' },
      el('div', { class: 'modal-head' }, el('h2', { text: 'اختيار من المكتبة' }),
        button('تم', { kind: 'ghost', onClick: () => dialog.close() })),
      el('div', { class: 'modal-body' }, note, list,
        button('رفع ملفات جديدة', { kind: 'ghost', onClick: () => {
          dialog.close();
          if (modal.open) requestCloseModal().then(() => { if (!modal.open) selectTab('library'); });
          else selectTab('library');
        } }))));
    const refresh = () => {
      const assets = libraryAssets();
      list.replaceChildren(...(assets.length ? assets.map((asset) => assetCard(asset, (entry) => {
        editor.addEntry(entry);
        note.textContent = `انضافت «${entry.name}». تقدر تضيف غيرها أو تضغط تم ثم تحفظ القائمة.`;
      }, 'اختيار')) : [el('p', { class: 'muted-text', text: state.loaded.has('media_library') ? 'المكتبة فاضية. ارفع ملفات أولاً.' : 'جاري تحميل المكتبة…' })]));
    };
    const close = () => { if (dialog.open) dialog.close(); dialog.remove(); if (libraryPickerRefresh === refresh) { libraryPickerRefresh = null; libraryPickerClose = null; } };
    dialog.addEventListener('close', close);
    libraryPickerRefresh = refresh;
    libraryPickerClose = close;
    refresh();
    document.body.append(dialog);
    dialog.showModal();
  }

  function renderUpload(job) {
    if (job.epoch !== sessionEpoch) return;
    job.name.textContent = job.file.name;
    job.progress.value = job.percent;
    job.status.textContent = job.message;
    job.cancel.disabled = !['validating', 'uploading'].includes(job.phase);
    job.retry.disabled = job.running;
    job.retry.hidden = !['failed', 'canceled'].includes(job.phase);
  }

  async function runUpload(job) {
    if (job.running || job.epoch !== sessionEpoch) return;
    job.running = true;
    job.canceled = false;
    job.phase = 'validating';
    job.percent = job.sha ? 100 : 0;
    job.message = 'جاري فحص الملف…';
    renderUpload(job);
    const check = () => {
      if (job.canceled || job.epoch !== sessionEpoch) throw new Error('upload-canceled');
      requireManager();
    };
    try {
      check();
      const spec = validateFile(job.file);
      if (!state.githubToken) throw new Error('github-token-missing');
      if (!job.metadata) {
        await verifyFileSignature(job.file);
        check();
        job.metadata = await decodeMetadata(job.file, spec.kind, job);
      }
      check();
      const path = `media/${job.id}.${spec.ext}`;
      const url = `${PAGES_BASE}${path}`;
      if (!job.sha) {
        job.phase = 'uploading';
        job.message = 'جاري تجهيز الملف…';
        renderUpload(job);
        const content = await readBase64(job.file, job);
        check();
        job.message = 'بالانتظار حتى يخلص الرفع اللي قبله…';
        renderUpload(job);
        job.sha = await githubSerial(async () => {
          check();
          const previous = await existingSha(path);
          if (previous) return previous;
          check();
          const body = new Blob([`{"message":${JSON.stringify(`Add signage media ${path}`)},"branch":"main","content":"`, content, '"}'],
            { type: 'application/json' });
          const result = await githubRequest('PUT', contentsPath(path), body, {
            job,
            onProgress: (ratio) => {
              if (job.epoch !== sessionEpoch || job.canceled) return;
              job.percent = Math.min(99, Math.floor(ratio * 100));
              job.message = `جاري الرفع إلى GitHub… ${job.percent}%`;
              renderUpload(job);
            },
          });
          return str(result?.content?.sha);
        });
        if (!/^[0-9a-f]{40}$/.test(job.sha)) { job.sha = ''; throw new Error('GitHub ما رجّع بصمة الملف. أعد المحاولة.'); }
      }
      job.phase = 'publishing';
      job.percent = 100;
      renderUpload(job);
      await waitForPages(url, job, check);
      check();
      job.message = 'الرابط جاهز؛ جاري حفظه بالمكتبة…';
      renderUpload(job);
      const entry = {
        id: job.id, url, kind: spec.kind, name: job.file.name.slice(0, 240),
        duration_ms: job.metadata.duration_ms, fade_in_ms: spec.kind === 'image' ? 600 : 0, fade_out_ms: spec.kind === 'image' ? 600 : 0,
        fit: currentConfig().display_mode, storage_path: path, sha: job.sha,
        bytes: job.file.size, created_at: firebase.database.ServerValue.TIMESTAMP,
        width: job.metadata.width, height: job.metadata.height,
      };
      await managerWrite(() => db.ref(`media_library/${job.id}`).set(entry));
      check();
      job.phase = 'complete';
      job.message = 'تم الرفع والحفظ بالمكتبة. اختَر الملف للقائمة ثم احفظها.';
    } catch (error) {
      if (job.epoch !== sessionEpoch) return;
      job.phase = job.canceled || /upload-canceled/.test(error.message || error.code) ? 'canceled' : 'failed';
      job.message = job.phase === 'canceled' ? 'انلغى الرفع. أعد المحاولة إذا تريد ترفعه.'
        : `${errorText(error)}${job.sha ? ' الملف مرفوع على GitHub؛ إعادة المحاولة ما تعيد رفعه.' : ''}`;
    } finally {
      job.running = false;
      renderUpload(job);
    }
  }

  $('media-files').addEventListener('change', (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    for (const file of files) {
      const job = { id: newId(), file, epoch: sessionEpoch, percent: 0, phase: 'queued', message: '', running: false };
      job.name = el('strong');
      job.progress = el('progress', { max: '100', value: '0', 'aria-label': `رفع ${file.name}` });
      job.status = el('p', { class: 'muted-text', role: 'status' });
      job.cancel = button('إلغاء الرفع', { kind: 'danger sm', onClick: () => {
        job.canceled = true;
        if (job.abortMetadata) job.abortMetadata();
        if (job.reader) job.reader.abort();
        if (job.xhr) job.xhr.abort();
        job.phase = 'canceled';
        job.message = 'انلغى الرفع. أعد المحاولة إذا تريد ترفعه.';
        renderUpload(job);
      } });
      job.retry = button('إعادة المحاولة', { kind: 'ghost sm', onClick: () => runUpload(job) });
      const row = el('article', { class: 'upload-job' }, job.name, job.progress, job.status, el('div', { class: 'group' }, job.cancel, job.retry));
      $('upload-list').append(row);
      uploads.set(job.id, job);
      runUpload(job);
    }
  });

  function cancelUploads() {
    for (const cancel of Array.from(metadataCancels)) cancel();
    for (const job of uploads.values()) {
      job.canceled = true;
      if (job.reader) job.reader.abort();
      if (job.xhr) job.xhr.abort();
    }
    uploads.clear();
    $('upload-list').replaceChildren();
    $('media-files').value = '';
  }

  function previewMedia(entry) {
    if (!isMediaUrl(entry.url)) { toast('رابط المعاينة غير آمن أو غير صالح.', 'bad'); return; }
    const isImage = entry.kind === 'image';
    const media = isImage ? el('img', { src: entry.url, alt: entry.name })
      : el('video', { src: entry.url, controls: true, playsinline: true, preload: 'metadata' });
    media.className = 'media-preview';
    media.style.objectFit = entry.fit === 'cover' ? 'cover' : 'contain';
    const note = el('p', { class: 'muted-text', text: isImage
      ? `مدة الصورة ${entry.duration_ms / 1000} ثانية · دخول ${entry.fade_in_ms / 1000} ث · خروج ${entry.fade_out_ms / 1000} ث · ${entry.fit}`
      : 'معاينة من التخزين السحابي. توافق تشغيل الفيديو يعتمد على ترميز الملف.' });
    let animation = null;
    const animate = () => {
      if (!isImage || typeof media.animate !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches || !validEntry(entry)) return;
      const ms = entry.duration_ms;
      animation = media.animate([
        { opacity: entry.fade_in_ms ? 0 : 1, offset: 0 },
        { opacity: 1, offset: entry.fade_in_ms / ms },
        { opacity: 1, offset: 1 - entry.fade_out_ms / ms },
        { opacity: entry.fade_out_ms ? 0 : 1, offset: 1 },
      ], { duration: ms, iterations: Infinity });
    };
    media.addEventListener('load', animate, { once: true });
    media.addEventListener('error', () => { note.textContent = 'ما كدرت أحمل الوسائط. افحص الإنترنت وصلاحية الملف أو أعد رفع نسخة صالحة.'; note.className = 'form-error'; });
    const dialog = el('dialog', { class: 'modal' }, el('div', { class: 'modal-card wide' },
      el('div', { class: 'modal-head' }, el('h2', { text: entry.name }),
        button('إغلاق', { kind: 'ghost sm', iconName: 'x', iconOnly: true, onClick: () => dialog.close() })),
      el('div', { class: 'modal-body' }, media, note)));
    const cleanup = () => {
      if (animation) animation.cancel();
      if (!isImage) media.pause();
      media.removeAttribute('src');
      if (!isImage) media.load();
      activePreviews.delete(cleanup);
      dialog.remove();
    };
    activePreviews.add(cleanup);
    dialog.addEventListener('close', cleanup, { once: true });
    document.body.append(dialog);
    dialog.showModal();
  }

  class PlaylistEditor {
    constructor({ onSave, emptyText, extraActions = () => [], confirmEmpty = null }) {
      this.onSave = onSave;
      this.emptyText = emptyText;
      this.extraActions = extraActions;
      this.confirmEmpty = confirmEmpty;
      this.remote = [];
      this.items = [];
      this.dirty = false;
      this.conflict = false;
      this.saving = false;

      this.libraryButton = button('اختيار فيديو أو صورة من المكتبة', {
        kind: 'primary', iconName: 'plus', onClick: () => chooseLibrary(this),
      });
      this.addError = el('p', { class: 'form-error', hidden: true });
      this.notice = el('div', { class: 'notice', hidden: true });
      this.list = el('div');
      this.footer = el('div', { class: 'pl-footer' });
      this.root = el('div', { class: 'pl-editor' },
        el('div', { class: 'pl-add' }, this.libraryButton,
          el('span', { class: 'muted-text', text: 'ارفع الملفات من تبويب مكتبة الوسائط؛ ما تحتاج روابط.' })),
        this.addError, this.notice, this.list, this.footer);
      this.render();
    }

    setRemote(list) {
      if (sameList(list, this.remote)) return;
      this.remote = cloneList(list);
      if (!this.dirty) {
        this.items = cloneList(list);
        this.conflict = false;
      } else if (sameList(list, this.items)) {
        this.dirty = false;
        this.conflict = false;
      } else {
        this.conflict = true;
      }
      this.render(this.dirty);
    }

    replaceItems(list) {
      this.items = list.map((entry) => ({ ...entry, id: newId() }));
      this.changed();
    }

    changed(preserveList = false) {
      this.dirty = !sameList(this.items, this.remote);
      if (!this.dirty) this.conflict = false;
      this.render(preserveList);
    }

    discard() {
      this.items = cloneList(this.remote);
      this.dirty = false;
      this.conflict = false;
      showError(this.addError, '');
      this.render();
    }

    addEntry(asset) {
      if (!pinUnlocked || this.saving) return;
      const entry = mediaEntry(asset, newId());
      if (!entry) { showError(this.addError, 'الملف غير صالح. أعد رفعه من المكتبة.'); return; }
      entry.id = newId();
      this.items.push(entry);
      this.changed();
    }

    settings(entry) {
      const fit = el('select', { 'aria-label': `طريقة عرض ${entry.name}` },
        el('option', { value: 'contain', text: 'كامل المحتوى' }),
        el('option', { value: 'cover', text: 'ملء الشاشة / قص' }));
      fit.value = entry.fit;
      fit.addEventListener('change', () => { entry.fit = fit.value; this.changed(true); });
      const fields = [el('label', { class: 'field' }, el('span', { text: 'طريقة العرض' }), fit)];
      if (entry.kind === 'image') {
        const unit = el('select', { 'aria-label': 'وحدة مدة الصورة' },
          el('option', { value: '1000', text: 'ثانية' }), el('option', { value: '60000', text: 'دقيقة' }));
        const amount = el('input', { type: 'number', min: '0.001', step: 'any', value: entry.duration_ms / 1000, dir: 'ltr', 'aria-label': `مدة ${entry.name}` });
        const updateDuration = () => {
          entry.duration_ms = Math.round(Number(amount.value) * Number(unit.value));
          showError(this.addError, validEntry(entry) ? '' : 'مدة الصورة من ثانية إلى 24 ساعة، ومجموع الدخول والخروج ما يتجاوز المدة.');
          this.changed(true);
        };
        amount.addEventListener('input', updateDuration);
        unit.addEventListener('change', () => { amount.value = String(entry.duration_ms / Number(unit.value)); });
        fields.push(el('label', { class: 'field' }, el('span', { text: 'مدة الصورة' }), el('div', { class: 'duration-input' }, amount, unit)));
        for (const [key, label] of [['fade_in_ms', 'تلاشي الدخول (ثانية)'], ['fade_out_ms', 'تلاشي الخروج (ثانية)']]) {
          const input = el('input', { type: 'number', min: '0', max: '5', step: '0.1', value: entry[key] / 1000, dir: 'ltr', 'aria-label': `${label} ${entry.name}` });
          input.addEventListener('input', () => {
            entry[key] = Math.round(Number(input.value) * 1000);
            showError(this.addError, validEntry(entry) ? '' : 'كل تلاشي من 0 إلى 5 ثواني، ومجموع الدخول والخروج ما يتجاوز مدة الصورة.');
            this.changed(true);
          });
          fields.push(el('label', { class: 'field' }, el('span', { text: label }), input));
        }
      }
      return el('div', { class: 'media-settings' }, fields);
    }

    move(index, delta) {
      const target = index + delta;
      if (target < 0 || target >= this.items.length) return;
      [this.items[index], this.items[target]] = [this.items[target], this.items[index]];
      this.changed();
    }

    remove(index) {
      this.items.splice(index, 1);
      this.changed();
    }

    async save() {
      if (this.saving || !pinUnlocked) return;
      const epoch = sessionEpoch;
      const ids = new Set(this.items.map((entry) => entry.id));
      if (this.items.some((entry) => !validEntry(entry)) || ids.size !== this.items.length) {
        showError(this.addError, 'صحّح الوسائط والمدة والتلاشي قبل الحفظ. الروابط لازم تكون HTTPS ومعرّفات العناصر مستقلة.');
        return;
      }
      if (!this.items.length && this.confirmEmpty && !(await this.confirmEmpty())) return;
      if (this.conflict && !(await confirmBox({ title: 'القائمة تغيّرت', message: 'تريد تستبدل النسخة السحابية الحالية بتعديلاتك؟', okText: 'استبدل واحفظ' }))) return;
      if (epoch !== sessionEpoch || !pinUnlocked) return;
      this.saving = true;
      this.root.inert = true;
      this.render();
      try {
        const saved = cloneList(this.items);
        await managerWrite(() => this.onSave(saved));
        if (epoch !== sessionEpoch) return;
        this.remote = saved;
        this.dirty = false;
        this.conflict = false;
        toast('انحفظت القائمة. الشاشات راح تتحدث خلال ثواني.', 'ok');
      } catch (e) {
        if (epoch === sessionEpoch) toast(errorText(e), 'bad');
      } finally {
        if (epoch === sessionEpoch) {
          this.saving = false;
          this.root.inert = false;
          this.render();
        }
      }
    }

    render(preserveList = false) {
      this.notice.hidden = !(this.dirty && this.conflict);
      this.notice.replaceChildren(
        el('span', { text: 'القائمة تغيّرت من مكان ثاني وانت جاي تعدّل. إذا تحفظ، راح تكتب تعديلك فوقها.' }),
        button('اعرض النسخة الجديدة', { kind: 'sm', onClick: () => this.discard() }));

      if (!preserveList) {
        if (!this.items.length) {
          this.list.replaceChildren(el('div', { class: 'pl-empty', text: this.emptyText }));
        } else {
          const last = this.items.length - 1;
          this.list.replaceChildren(el('ol', { class: 'pl-list' }, this.items.map((entry, i) => {
            return el('li', { class: 'pl-item media-item' },
              el('div', { class: 'media-row' },
                el('span', { class: 'pl-num', text: String(i + 1) }),
                el('div', { class: 'pl-info' },
                  el('strong', { title: entry.name, text: entry.name }),
                  el('small', { text: entry.kind === 'image' ? 'صورة' : `فيديو · ${entry.duration_ms ? clock(entry.duration_ms) : 'المدة من الشاشة'}` })),
                el('div', { class: 'pl-actions' },
                  button('معاينة', { kind: 'ghost sm', iconName: 'eye', iconOnly: true, onClick: () => previewMedia(entry) }),
                  button('لفوق', { kind: 'ghost sm', iconName: 'up', iconOnly: true, disabled: i === 0, onClick: () => this.move(i, -1) }),
                  button('لجوة', { kind: 'ghost sm', iconName: 'down', iconOnly: true, disabled: i === last, onClick: () => this.move(i, 1) }),
                  button('حذف', { kind: 'danger sm', iconName: 'trash', iconOnly: true, onClick: () => this.remove(i) }))),
              this.settings(entry));
          })));
        }
      }

      this.footer.replaceChildren(
        el('div', { class: 'group' },
          el('span', { class: 'muted-text', text: `${this.items.length} عنصر` }),
          this.dirty ? el('span', { class: 'dirty-note', text: 'في تغييرات ما محفوظة' }) : null),
        el('div', { class: 'group' },
          this.extraActions(),
          this.dirty ? button('تراجع', { kind: 'ghost', disabled: this.saving, onClick: () => this.discard() }) : null,
          button(this.saving ? 'جاري الحفظ…' : 'حفظ القائمة', {
            kind: 'primary',
            disabled: !this.dirty || this.saving,
            onClick: () => this.save(),
          })));
    }
  }

  const globalEditor = new PlaylistEditor({
    emptyText: 'القائمة فاضية. اختَر فيديوهات أو صور مرفوعة من المكتبة.',
    onSave: (urls) => db.ref('playlist').set(urls.length ? urls : null),
    confirmEmpty: () => confirmBox({
      title: 'القائمة فاضية',
      message: 'إذا تحفظ قائمة فاضية، الشاشات اللي ما عدها قائمة خاصة راح توقف العرض. متأكد؟',
      okText: 'احفظ فاضية',
      danger: true,
    }),
  });
  $('global-playlist').append(globalEditor.root);

  function openDevicePlaylist(id) {
    const v = deviceView(id);
    const ref = db.ref(`device_playlists/${id}`);
    const editor = new PlaylistEditor({
      emptyText: 'هاي الشاشة تعرض القائمة العامة. اختَر فيديوهات وصور من المكتبة لقائمة خاصة.',
      onSave: (urls) => (urls.length ? ref.set(urls) : ref.remove()),
      extraActions: () => [
        button('نسخ القائمة العامة', {
          kind: 'ghost',
          iconName: 'copy',
          disabled: !state.playlist.length,
          onClick: () => editor.replaceItems(state.playlist),
        }),
      ],
    });
    editor.setRemote(toMediaList(state.devicePlaylists[id]));
    state.deviceEditor = { id, editor };

    const backToGlobal = async () => {
      if (!(await confirmBox({
        title: 'رجوع للقائمة العامة',
        message: `«${v.title}» راح ترجع تعرض القائمة العامة، وقائمتها الخاصة تنمسح.`,
        okText: 'رجّعها',
      }))) return;
      try {
        await managerWrite(() => ref.remove());
        editor.discard();
        toast('رجعت الشاشة للقائمة العامة.', 'ok');
      } catch (e) {
        toast(errorText(e), 'bad');
      }
    };

    openModal({
      title: `قائمة تشغيل خاصة — ${v.title}`,
      wide: true,
      body: [
        el('p', { class: 'muted-text', style: 'margin:0', text: 'إذا القائمة الخاصة بيها وسائط، هاي الشاشة تعرضها بدال القائمة العامة. إذا فاضية، ترجع للعامة.' }),
        editor.root,
      ],
      actions: [button('رجوع للقائمة العامة', { kind: 'danger', onClick: backToGlobal })],
      guard: async () => !editor.dirty || confirmBox({
        title: 'تغييرات ما محفوظة',
        message: 'عندك تغييرات بالقائمة ما حفظتها. تريد تسكّر وتضيعها؟',
        okText: 'سكّر بدون حفظ',
        danger: true,
      }),
      onClose: () => {
        if (state.deviceEditor && state.deviceEditor.editor === editor) state.deviceEditor = null;
      },
    });
  }

  // ---------- Config form ----------

  const configForm = $('config-form');
  const cfgVolume = $('cfg-volume');
  const cfgMuted = $('cfg-muted');
  const cfgInterval = $('cfg-interval');
  const cfgOrder = $('cfg-order');
  const cfgDisplay = $('cfg-display');
  let configDirty = false;

  function currentConfig() {
    const c = state.config || {};
    const volume = num(c.volume);
    const interval = num(c.update_check_interval_minutes);
    return {
      volume: volume == null ? DEFAULT_CONFIG.volume : Math.min(1, Math.max(0, volume)),
      muted: typeof c.muted === 'boolean' ? c.muted : DEFAULT_CONFIG.muted,
      update_check_interval_minutes: interval == null ? DEFAULT_CONFIG.update_check_interval_minutes : interval,
      playback_order: c.playback_order === 'shuffle' ? 'shuffle' : DEFAULT_CONFIG.playback_order,
      display_mode: c.display_mode === 'cover' ? 'cover' : DEFAULT_CONFIG.display_mode,
    };
  }

  function fillConfigForm(force) {
    if (configDirty && !force) {
      $('config-state').textContent = 'الإعدادات تغيّرت من مكان ثاني. إذا تحفظ، تعديلك يكتب فوقها.';
      return;
    }
    const c = currentConfig();
    cfgVolume.value = String(Math.round(c.volume * 100));
    cfgMuted.checked = c.muted;
    cfgInterval.value = String(c.update_check_interval_minutes);
    cfgOrder.value = c.playback_order;
    cfgDisplay.value = c.display_mode;
    $('volume-value').textContent = `${cfgVolume.value}%`;
    configDirty = false;
    $('config-state').textContent = state.config ? '' : 'هاي القيم الافتراضية، ما محفوظة بعد.';
    showError($('config-error'), '');
  }

  configForm.addEventListener('input', () => {
    $('volume-value').textContent = `${cfgVolume.value}%`;
    configDirty = true;
    $('config-state').textContent = 'في تغييرات ما محفوظة';
  });

  configForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const interval = Number(cfgInterval.value);
    if (!Number.isInteger(interval) || interval < 5 || interval > 10080) {
      showError($('config-error'), 'فحص التحديثات لازم يكون رقم صحيح بين 5 و 10080 دقيقة.');
      return;
    }
    showError($('config-error'), '');
    const saveBtn = $('config-save');
    saveBtn.disabled = true;
    try {
      await managerWrite(() => db.ref('config').update({
        volume: Math.round(Number(cfgVolume.value)) / 100,
        muted: cfgMuted.checked,
        update_check_interval_minutes: interval,
        playback_order: cfgOrder.value === 'shuffle' ? 'shuffle' : 'sequential',
        display_mode: cfgDisplay.value === 'cover' ? 'cover' : 'contain',
      }));
      configDirty = false;
      fillConfigForm(true);
      toast('انحفظت الإعدادات.', 'ok');
    } catch (e) {
      showError($('config-error'), errorText(e));
    } finally {
      saveBtn.disabled = false;
    }
  });

  // ---------- Update tab ----------

  let updateRenderSignature = '';

  function renderUpdateTab() {
    const devices = allDevices();
    const signature = JSON.stringify([state.appVersion, devices.map((v) => [v.id, v.title, v.online, deviceVersion(v.d), v.d.version_name])]);
    if (signature === updateRenderSignature) return;
    updateRenderSignature = signature;
    const info = state.appVersion;
    const code = num(info && info.version_code);
    const url = str(info && info.apk_url);
    const sha = str(info && info.sha256);
    const box = $('current-update');

    if (code == null) {
      box.replaceChildren(el('p', { class: 'muted-text', style: 'margin:0', text: 'ما كو تحديث منشور. الشاشات تبقى على النسخة اللي عدها.' }));
    } else {
      const known = devices.filter((v) => deviceVersion(v.d) != null);
      const done = known.filter((v) => deviceVersion(v.d) >= code).length;
      box.replaceChildren(el('div', { class: 'info-grid' },
        kv('رقم الإصدار', el('b', { text: String(code) })),
        kv('الرابط', isHttpsUrl(url)
          ? el('a', { href: url, target: '_blank', rel: 'noopener noreferrer', dir: 'ltr', title: url, text: fileName(url) })
          : el('span', { dir: 'ltr', text: url || '—' })),
        kv('البصمة SHA-256', sha ? el('code', { dir: 'ltr', title: sha, text: `${sha.slice(0, 16)}…` }) : 'بدون'),
        kv('الشاشات المتحدثة', `${done} من ${known.length}`)),
      el('div', { class: 'form-actions' },
        button('إلغاء التحديث المنشور', { kind: 'danger sm', iconName: 'trash', onClick: unpublishUpdate })));
    }

    const codeInput = $('upd-code');
    const highest = Math.max(code || 0, ...devices.map((v) => deviceVersion(v.d) || 0));
    codeInput.placeholder = highest ? `مثلاً ${highest + 1}` : 'مثلاً 2';

    const table = $('version-table');
    if (!devices.length) {
      table.replaceChildren(el('p', { class: 'muted-text', style: 'margin:0', text: 'ما كو شاشات بعد.' }));
      return;
    }
    table.replaceChildren(el('table', { class: 'simple' },
      el('thead', null, el('tr', null,
        el('th', { text: 'الشاشة' }), el('th', { text: 'الإصدار' }), el('th', { text: 'الحالة' }))),
      el('tbody', null, devices.map((v) => {
        const vc = deviceVersion(v.d);
        let status;
        if (vc == null) status = pill('غير معروف', 'muted');
        else if (code != null && vc < code) status = pill(v.online ? 'ينتظر التحديث' : 'ينتظر التحديث (غير متصلة)', 'warn');
        else status = pill('محدّث', 'ok');
        return el('tr', null,
          el('td', null, v.title, ' ', el('span', { class: 'code-tag', dir: 'ltr', text: v.code })),
          el('td', { dir: 'ltr', style: 'text-align:right', text: vc != null ? versionLabel(v.d) : '—' }),
          el('td', null, status, ' ', vc == null || vc < 2 ? pill('بدون صور وقياس مباشر — حدّث إلى 2+', 'warn') : null));
      }))));
  }

  async function unpublishUpdate() {
    const ok = await confirmBox({
      title: 'إلغاء التحديث المنشور',
      message: 'الشاشات اللي ما تحدثت بعد راح تبقى على نسختها. الشاشات اللي تحدثت ما تتأثر.',
      okText: 'إلغاء التحديث',
      danger: true,
    });
    if (!ok) return;
    try {
      await managerWrite(() => db.ref('app_version').remove());
      toast('انلغى التحديث المنشور.', 'ok');
    } catch (e) {
      toast(errorText(e), 'bad');
    }
  }

  $('upd-file').addEventListener('change', async (event) => {
    const file = event.target.files && event.target.files[0];
    const epoch = sessionEpoch;
    const info = $('upd-file-info');
    event.target.value = '';
    if (!file) return;
    if (!(window.crypto && crypto.subtle)) {
      info.textContent = 'هذا المتصفح ما يكدر يحسب البصمة. افتح اللوحة بـ Chrome أو Edge.';
      return;
    }
    info.textContent = `جاري حساب بصمة ${file.name}…`;
    try {
      const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
      if (epoch !== sessionEpoch || !pinUnlocked) return;
      $('upd-sha').value = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
      info.textContent = `${file.name} · ${formatMb(file.size / (1024 * 1024))} · انحسبت البصمة`;
    } catch (e) {
      if (epoch === sessionEpoch && pinUnlocked) info.textContent = `ما كدرت أقرا الملف: ${e.message || e}`;
    }
  });

  $('update-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorBox = $('update-error');
    const code = Number($('upd-code').value);
    const url = $('upd-url').value.trim();
    const sha = $('upd-sha').value.trim().toLowerCase();
    const problems = [];
    if (!Number.isInteger(code) || code < 1) problems.push('رقم الإصدار لازم يكون رقم صحيح أكبر من صفر.');
    const published = num(state.appVersion?.version_code);
    if (published != null && Number.isInteger(code) && code <= published) {
      problems.push(`رقم الإصدار لازم يكون أكبر من الإصدار المنشور حالياً (${published}).`);
    }
    const installed = allDevices().map((v) => deviceVersion(v.d)).filter((n) => n != null);
    if (Number.isInteger(code) && installed.length && code <= Math.min(...installed)) {
      problems.push(`كل الشاشات عدها الإصدار ${Math.min(...installed)} أو أحدث، فهذا التحديث ما راح ينزل على أي شاشة. ارفع رقم versionCode بالمشروع وصدّر النسخة من جديد.`);
    }
    if (!isHttpsUrl(url)) problems.push('رابط الملف لازم يكون رابط https كامل.');
    if (sha && !/^[0-9a-f]{64}$/.test(sha)) problems.push('البصمة لازم تكون 64 حرف (أرقام وحروف a-f). اتركها فاضية أو احسبها من الملف.');
    if (problems.length) {
      showError(errorBox, problems.join('\n'));
      return;
    }
    showError(errorBox, '');
    const ok = await confirmBox({
      title: `نشر الإصدار ${code}`,
      message: 'الشاشات راح تنزّل الملف وتطلب التثبيت، وبعض الأجهزة تحتاج موافقة على الشاشة.\nتأكد إن النسخة موقّعة بنفس مفتاح النسخة المثبّتة، وإلا التنصيب يفشل.',
      okText: 'انشر',
    });
    if (!ok) return;
    const payload = { version_code: code, apk_url: url };
    if (sha) payload.sha256 = sha;
    try {
      await managerWrite(() => db.ref('app_version').set(payload));
      event.target.reset();
      $('upd-file-info').textContent = '';
      toast(`انتشر الإصدار ${code}.`, 'ok');
    } catch (e) {
      showError(errorBox, errorText(e));
    }
  });

  // ---------- Server-validated keypad login ----------

  function authErrorText(error) {
    const code = str(error?.code);
    if (/too-many-requests/i.test(code)) return 'محاولات كثيرة. انتظر شوية ثم أعد المحاولة.';
    if (/wrong-password|invalid-credential|invalid-login-credentials|user-not-found|invalid-password|invalid-email/i.test(code)) return 'الرمز مو صحيح، جرّب مرة ثانية.';
    if (/operation-not-allowed|configuration-not-found|admin-restricted-operation|user-disabled/i.test(code)) {
      return 'الدخول غير مُعَدّ بعد على Firebase (حساب المدير أو تسجيل الدخول بالبريد مو مفعّل). يحتاج مسؤول المشروع يكمل الإعداد.';
    }
    if (/network/i.test(code)) return 'تعذر الوصول لـ Firebase. افحص الإنترنت وأعد المحاولة.';
    return `تعذر تسجيل الدخول: ${code || str(error?.message) || 'خطأ غير معروف'}.`;
  }

  function setRetryDelay(error) {
    if (/too-many-requests/.test(str(error?.code))) retryUntil = Date.now() + 60000;
    if (retryUntil > Date.now()) {
      clearInterval(retryTimer);
      retryTimer = setInterval(() => {
        if (Date.now() >= retryUntil) { clearInterval(retryTimer); retryTimer = null; retryUntil = 0; }
        renderPin();
      }, 1000);
    }
  }

  function renderPin() {
    $('pin-dots').replaceChildren(...Array.from({ length: PIN_LENGTH }, (_, i) =>
      el('span', { class: `pin-dot${i < pinValue.length ? ' filled' : ''}`, 'aria-hidden': 'true' })));
    $('pin-dots').setAttribute('aria-label', `دخلت ${pinValue.length} من ${PIN_LENGTH} أرقام`);
    const waiting = Math.max(0, Math.ceil((retryUntil - Date.now()) / 1000));
    const disabled = pinBusy || !startupReady || waiting > 0;
    $('pin-keypad').querySelectorAll('button').forEach((key) => { key.disabled = disabled; });
    $('pin-delete').disabled = disabled || !pinValue.length;
    $('pin-status').textContent = pinBusy ? 'جاري التحقق من الخادم…' : waiting ? `أعد المحاولة بعد ${waiting} ثانية` : !startupReady ? 'جاري تهيئة الدخول…' : '';
  }

  async function unlockPanel() {
    if (pinBusy || !startupReady || Date.now() < retryUntil || pinValue.length !== PIN_LENGTH) return;
    pinBusy = true;
    const epoch = ++sessionEpoch;
    renderPin();
    showError($('login-error'), '');
    try {
      const pin = pinValue;
      pinValue = '';
      await auth.setPersistence(firebase.auth.Auth.Persistence.NONE);
      if (epoch !== sessionEpoch) return;
      // The rules expire the session 8h after auth_time; stop a minute early.
      sessionDeadline = Date.now() + SESSION_MS - 60000;
      const result = await auth.signInWithEmailAndPassword(ADMIN_EMAIL, pin);
      if (epoch !== sessionEpoch || Date.now() >= sessionDeadline) { await auth.signOut(); return; }
      pinUnlocked = true;
      startApp(result.user);
    } catch (error) {
      if (epoch !== sessionEpoch) return;
      pinUnlocked = false;
      sessionDeadline = 0;
      await auth.signOut().catch(() => {});
      setRetryDelay(error);
      showError($('login-error'), authErrorText(error));
      const card = document.querySelector('.pin-card');
      card.classList.add('pin-wrong');
      setTimeout(() => card.classList.remove('pin-wrong'), 350);
    } finally {
      pinBusy = false;
      pinValue = '';
      renderPin();
    }
  }

  $('pin-keypad').addEventListener('click', (event) => {
    if (pinBusy || !startupReady || Date.now() < retryUntil) return;
    const key = event.target.closest('button[data-digit]');
    if (!key || !/^\d$/.test(key.dataset.digit) || pinValue.length >= PIN_LENGTH) return;
    showError($('login-error'), '');
    pinValue += key.dataset.digit;
    renderPin();
    if (pinValue.length === PIN_LENGTH) unlockPanel();
  });

  $('pin-delete').addEventListener('click', () => {
    if (pinBusy || !startupReady || Date.now() < retryUntil) return;
    pinValue = pinValue.slice(0, -1);
    showError($('login-error'), '');
    renderPin();
  });

  $('logout-btn').addEventListener('click', async () => {
    if ((globalEditor.dirty || configDirty || state.deviceEditor?.editor.dirty || Array.from(uploads.values()).some((job) => job.running))
      && !(await confirmBox({ title: 'قفل اللوحة', message: 'القفل يضيّع التغييرات غير المحفوظة ويلغي الرفع الجاري. تريد تقفلها؟', okText: 'قفل اللوحة', danger: true }))) return;
    await stopApp();
  });

  window.addEventListener('beforeunload', (event) => {
    if (globalEditor.dirty || configDirty || state.deviceEditor?.editor.dirty || Array.from(uploads.values()).some((job) => job.running)) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  function resetState() {
    Object.assign(state, {
      connected: false,
      everConnected: false,
      serverOffset: 0,
      search: '',
      filter: 'all',
      devices: {},
      names: {},
      devicePlaylists: {},
      playlist: [],
      config: null,
      appVersion: null,
      openMenu: null,
      library: {},
      deviceEditor: null,
      sync: null,
      githubToken: '',
    });
    state.loaded.clear();
    state.denied.clear();
  }

  function startApp(user) {
    state.user = user;
    $('boot-view').hidden = true;
    $('login-view').hidden = true;
    $('app-view').hidden = false;
    renderConnection();
    renderBanner();
    renderGlobalCommands();
    globalEditor.discard();
    fillConfigForm(true);
    db.goOnline();
    startListening();
    selectTab(location.hash.slice(1));
    clearInterval(tickTimer);
    tickTimer = setInterval(scheduleRender, 1000);
    clearTimeout(expiryTimer);
    expiryTimer = setTimeout(() => stopApp('انتهت جلسة الثماني ساعات. أدخل الرمز مرة ثانية.'), Math.max(0, sessionDeadline - Date.now()));
  }

  let signingOut = null;

  function stopApp(message = '') {
    pinUnlocked = false;
    pinValue = '';
    ++sessionEpoch;
    sessionDeadline = 0;
    configDirty = false;
    // Cancel transfers and release local file URLs BEFORE private state is cleared.
    cancelUploads();
    stopListening();
    db.goOffline();
    clearInterval(tickTimer);
    clearTimeout(expiryTimer);
    tickTimer = expiryTimer = null;
    if (libraryPickerClose) libraryPickerClose();
    document.querySelectorAll('dialog.modal[open]').forEach((dialog) => dialog.close('cancel'));
    for (const cleanup of Array.from(activePreviews)) cleanup();
    finishModal();
    confirmDialog.replaceChildren();
    resetState();
    state.user = null;
    $('device-search').value = '';
    $('device-filter').querySelectorAll('[data-filter]').forEach((node) => node.classList.toggle('active', node.dataset.filter === 'all'));
    deviceCards.clear();
    $('device-grid').replaceChildren();
    globalEditor.remote = [];
    globalEditor.saving = false;
    globalEditor.root.inert = false;
    globalEditor.discard();
    updateRenderSignature = '';
    syncSignature = '';
    syncLive = null;
    $('sync-panel').replaceChildren();
    githubSignature = '';
    renderGithubSetup();
    renderDevices();
    renderUpdateTab();
    renderLibrary();
    fillConfigForm(true);
    renderBanner();
    $('global-commands').replaceChildren();
    $('toasts').replaceChildren();
    if (supportsPopover && toastBox.matches(':popover-open')) toastBox.hidePopover();
    $('boot-view').hidden = true;
    $('app-view').hidden = true;
    $('login-view').hidden = false;
    $('update-form').reset();
    $('upd-file-info').textContent = '';
    showError($('update-error'), '');
    showError($('login-error'), message);
    startupReady = false;
    renderPin();
    if (!signingOut) {
      signingOut = auth.signOut().catch((error) => {
        showError($('login-error'), `تعذر إنهاء جلسة الدخول: ${errorText(error)}. أعد تحميل الصفحة قبل تسجيل الدخول.`);
        throw error;
      }).then(() => { startupReady = true; }, () => {}).finally(() => { signingOut = null; renderPin(); });
    }
    return signingOut;
  }

  document.querySelectorAll('[data-icon]').forEach((node) => node.append(icon(node.dataset.icon)));

  renderPin();

  auth.onAuthStateChanged((user) => {
    if (pinUnlocked && !user) stopApp('انتهت جلسة الربط. أدخل الرمز مرة ثانية.');
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && pinUnlocked && Date.now() >= sessionDeadline) stopApp('انتهت الجلسة. أدخل الرمز مرة ثانية.');
  });
  window.addEventListener('pagehide', () => { stopApp(); });

  // Every navigation/reload starts locked, even if an older page stored an identity.
  auth.setPersistence(firebase.auth.Auth.Persistence.NONE).then(() => stopApp()).catch((error) => {
    $('boot-view').hidden = true;
    $('login-view').hidden = false;
    showError($('login-error'), `تعذر تهيئة جلسة غير دائمة: ${authErrorText(error)}`);
  });
})();
