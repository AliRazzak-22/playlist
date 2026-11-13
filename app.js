'use strict';

(() => {
  const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyACHSjXB-UVG418YSsyedNPV48QbIB9OWA',
    authDomain: 'send-files-to-tv-d371a.firebaseapp.com',
    databaseURL: 'https://send-files-to-tv-d371a-default-rtdb.firebaseio.com',
    projectId: 'send-files-to-tv-d371a',
  };
  const DB_NAMESPACE = 'send-files-to-tv-d371a-default-rtdb';
  const USE_EMULATOR = new URLSearchParams(location.search).has('emulator');
  // Screens heartbeat every 60 s; three missed beats means the screen is gone.
  const ONLINE_WINDOW_MS = 3 * 60 * 1000;
  const MAX_URL_LENGTH = 2048;
  const DEFAULT_CONFIG = { volume: 1, muted: false, update_check_interval_minutes: 30 };
  const ACCESS_PIN = '20271511';
  let pinValue = '';
  let pinBusy = false;
  let pinUnlocked = false;

  if (!window.firebase || typeof firebase.auth !== 'function' || typeof firebase.database !== 'function') {
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

  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const str = (v) => (typeof v === 'string' ? v : '');
  const shortCode = (id) => id.slice(0, 6).toUpperCase();

  // Firebase orders integer-like keys numerically first, then the rest lexicographically.
  function firebaseKeyOrder(a, b) {
    const ia = /^-?\d+$/.test(a);
    const ib = /^-?\d+$/.test(b);
    if (ia && ib) return Number(a) - Number(b);
    if (ia !== ib) return ia ? -1 : 1;
    return a < b ? -1 : a > b ? 1 : 0;
  }

  function toUrlList(value) {
    if (!value || typeof value !== 'object') return [];
    const raw = Array.isArray(value)
      ? value
      : Object.keys(value).sort(firebaseKeyOrder).map((key) => value[key]);
    return raw
      .map((item) => (typeof item === 'string' ? item : item && typeof item.url === 'string' ? item.url : ''))
      .map((url) => url.trim())
      .filter(Boolean);
  }

  const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

  function errorText(error) {
    const code = (error && (error.code || error.message)) || '';
    if (/permission[_-]denied/i.test(code)) {
      return 'هذا المتصفح ما عنده صلاحية. انشر القواعد الموجودة بتبويب الحماية بـ Firebase.';
    }
    if (/network|disconnected/i.test(code)) return 'ما كو اتصال بالإنترنت.';
    return `صار خطأ: ${code || 'غير معروف'}`;
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
    rulesApplied: null,
    deviceEditor: null,
  };

  let unsubscribers = [];
  let tickTimer = null;
  let renderQueued = false;

  function listen(path, onValue) {
    const ref = db.ref(path);
    const callback = ref.on('value', (snap) => {
      state.loaded.add(path);
      if (state.denied.delete(path)) renderBanner();
      onValue(snap.val());
      scheduleRender();
    }, (error) => {
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
        state.deviceEditor.editor.setRemote(toUrlList(state.devicePlaylists[state.deviceEditor.id]));
      }
    });
    listen('playlist', (v) => {
      state.playlist = toUrlList(v);
      globalEditor.setRemote(state.playlist);
    });
    listen('config', (v) => {
      state.config = v && typeof v === 'object' ? v : null;
      fillConfigForm(false);
    });
    listen('app_version', (v) => { state.appVersion = v && typeof v === 'object' ? v : null; });
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
      renderDevices();
      renderUpdateTab();
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
    const goSecurity = button('روح لتبويب الحماية', { kind: 'sm', onClick: () => selectTab('security') });
    if (state.denied.size) {
      banner.className = 'banner bad';
      banner.replaceChildren(
        el('span', { text: 'هذا المتصفح بعده ما عنده صلاحية التحكم. انسخ قواعده من تبويب الحماية وانشرها بـ Firebase، وبعدين اضغط فحص مرة ثانية.' }),
        goSecurity);
      banner.hidden = false;
    } else if (state.rulesApplied === false) {
      banner.className = 'banner';
      banner.replaceChildren(
        el('span', { text: 'تنبيه: قاعدة البيانات مفتوحة لأي شخص (وضع التجربة)، وFirebase راح يقفلها لوحده بعد انتهاء مدة التجربة وتوقف الشاشات. طبّق القواعد هسه.' }),
        goSecurity);
      banner.hidden = false;
    } else {
      banner.hidden = true;
      banner.replaceChildren();
    }
  }

  // ---------- Tabs ----------

  const TAB_NAMES = ['screens', 'playlist', 'control', 'update', 'security'];

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
    if (name === 'security') checkRules();
  }

  document.querySelectorAll('.tabs [data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => selectTab(btn.dataset.tab));
  });

  // ---------- Commands ----------

  const ACTIONS = {
    play: { label: 'تشغيل', icon: 'play' },
    pause: { label: 'إيقاف مؤقت', icon: 'pause' },
    next: { label: 'الفيديو التالي', icon: 'next' },
    previous: { label: 'الفيديو السابق', icon: 'prev' },
    restart: { label: 'إعادة القائمة من الأول', icon: 'restart' },
    reload: { label: 'إعادة تشغيل التطبيق', icon: 'reload' },
    check_update: { label: 'فحص التحديث هسه', icon: 'download' },
    identify: { label: 'إظهار رمز الشاشة', icon: 'eye' },
    clear_cache: {
      label: 'مسح الفيديوهات المحفوظة',
      icon: 'broom',
      confirm: 'الشاشة راح تمسح كل الفيديوهات المحفوظة عدها وترجع تنزلها من جديد، وهذا يصرف إنترنت.\nمتأكد؟',
    },
  };

  async function sendCommand(path, action, targetLabel, offline = false) {
    const meta = ACTIONS[action];
    if (meta.confirm && !(await confirmBox({ title: meta.label, message: meta.confirm, okText: 'نعم، امسح', danger: true }))) {
      return;
    }
    const id = db.ref().push().key;
    try {
      await db.ref(path).set({ id, action, ts: firebase.database.ServerValue.TIMESTAMP });
      toast(offline
        ? `${targetLabel} غير متصلة هسه. الأمر «${meta.label}» راح يتنفذ أول ما ترجع.`
        : `انرسل «${meta.label}» إلى ${targetLabel}.`, offline ? '' : 'ok');
    } catch (error) {
      toast(errorText(error), 'bad');
    }
  }

  function renderGlobalCommands() {
    const grid = $('global-commands');
    grid.replaceChildren(...Object.entries(ACTIONS).map(([action, meta]) =>
      button(meta.label, { iconName: meta.icon, onClick: () => sendCommand('commands', action, 'كل الشاشات') })));
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
    const lastSeen = num(d.last_seen);
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
    $('device-grid').replaceChildren(...visible.map(deviceCard));
  }

  function kv(label, ...value) {
    return el('div', { class: 'kv' }, el('span', { text: label }), el('span', null, ...value));
  }

  const ltr = (text) => el('bdi', { dir: 'ltr', text });
  const versionLabel = (d) => `${str(d.version_name) || '?'} (${num(d.version_code)})`;

  function deviceCard(v) {
    const d = v.d;
    const [stateLabel, tone] = v.online ? (STATES[v.state] || ['غير معروف', 'muted']) : ['غير متصلة', 'bad'];
    const size = num(d.playlist_size) || 0;
    const index = num(d.now_index) || 0;
    const nowPlaying = str(d.now_playing);
    const cached = num(d.cached) || 0;
    const freeMb = num(d.free_mb);
    const versionCode = num(d.version_code);
    const target = num(state.appVersion && state.appVersion.version_code);
    const outdated = versionCode != null && target != null && versionCode < target;
    const custom = toUrlList(state.devicePlaylists[v.id]);
    const startedAt = num(d.started_at);
    const target_ = `الشاشة «${v.title}»`;
    const send = (action) => sendCommand(`device_commands/${v.id}`, action, target_, !v.online);

    const body = el('div', { class: 'device-body' });
    if (v.online && nowPlaying) {
      body.append(el('div', { class: 'now-playing' },
        el('small', { text: `${v.state === 'playing' ? 'يعرض هسه' : 'الفيديو الحالي'} (${index + 1} من ${size})` }),
        el('strong', { title: nowPlaying, text: fileName(nowPlaying) })));
    }
    body.append(kv('قائمة التشغيل', custom.length
      ? el('b', { text: `خاصة بيها (${custom.length} فيديو)` })
      : `العامة (${state.playlist.length} فيديو)`));
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
        if (name) await db.ref(`device_names/${id}`).set(name);
        else await db.ref(`device_names/${id}`).remove();
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
      await db.ref().update({
        [`devices/${id}`]: null,
        [`device_names/${id}`]: null,
        [`device_playlists/${id}`]: null,
        [`device_commands/${id}`]: null,
      });
      toast('انحذفت الشاشة من اللوحة.', 'ok');
    } catch (e) {
      toast(errorText(e), 'bad');
    }
  }

  // ---------- Playlist editor ----------

  function parseUrls(text) {
    const tokens = text.split(/\s+/).map((t) => t.trim()).filter(Boolean);
    const urls = [];
    const problems = [];
    const rejected = [];
    const reject = (token, message) => {
      rejected.push(token);
      problems.push(message);
    };
    for (const token of tokens) {
      let parsed;
      try {
        parsed = new URL(token);
      } catch {
        reject(token, `«${token}» مو رابط.`);
        continue;
      }
      const host = parsed.hostname.toLowerCase();
      if (parsed.protocol !== 'https:') {
        reject(token, `«${token}» لازم يبدي بـ https://`);
      } else if (/(^|\.)(youtube\.com|youtu\.be)$/.test(host)) {
        reject(token, `«${token}» رابط يوتيوب ما يشتغل. لازم رابط مباشر لملف الفيديو (mp4).`);
      } else if (host === 'drive.google.com' || host === 'docs.google.com') {
        reject(token, `«${token}» رابط Google Drive ما يشتغل مباشرة. لازم رابط مباشر لملف الفيديو (mp4).`);
      } else {
        if (/(^|\.)dropbox\.com$/.test(host) && parsed.searchParams.get('dl') === '0') {
          parsed.searchParams.set('dl', '1');
        }
        const url = parsed.href;
        if (url.length > MAX_URL_LENGTH) reject(token, `«${token.slice(0, 60)}…» طويل كلش.`);
        else urls.push(url);
      }
    }
    return { urls, problems, rejected };
  }

  function previewVideo(url) {
    if (!isHttpsUrl(url)) {
      toast('هذا الرابط ما يتعرض بالمتصفح لأنه مو https.', 'bad');
      return;
    }
    const note = el('p', { class: 'muted-text', style: 'margin:0', dir: 'ltr', text: url });
    const video = el('video', { src: url, controls: true, autoplay: true, playsinline: true, preload: 'metadata' });
    video.addEventListener('error', () => {
      note.dir = 'rtl';
      note.textContent = 'المتصفح ما كدر يشغّل هذا الفيديو. تأكد إن الرابط يفتح ملف الفيديو نفسه مو صفحة.';
      note.style.color = 'var(--bad)';
    });
    // Its own stacked dialog, so previewing never closes an open playlist editor.
    const dialog = el('dialog', { class: 'modal' }, el('div', { class: 'modal-card wide' },
      el('div', { class: 'modal-head' },
        el('h2', { text: fileName(url) }),
        button('إغلاق', { kind: 'ghost sm', iconName: 'x', iconOnly: true, onClick: () => dialog.close() })),
      el('div', { class: 'modal-body' }, video, note)));
    dialog.addEventListener('close', () => {
      video.pause();
      video.removeAttribute('src');
      video.load();
      dialog.remove();
    });
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

      this.input = el('textarea', {
        rows: '2',
        dir: 'ltr',
        placeholder: 'https://example.com/video.mp4\nتكدر تلصق أكثر من رابط، كل رابط بسطر',
      });
      this.input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) this.addFromInput();
      });
      this.addError = el('p', { class: 'form-error', hidden: true });
      this.notice = el('div', { class: 'notice', hidden: true });
      this.list = el('div');
      this.footer = el('div', { class: 'pl-footer' });
      this.root = el('div', { class: 'pl-editor' },
        el('div', { class: 'pl-add' }, this.input,
          button('إضافة', { kind: 'primary', iconName: 'plus', onClick: () => this.addFromInput() })),
        this.addError, this.notice, this.list, this.footer);
      this.render();
    }

    setRemote(list) {
      this.remote = list.slice();
      if (!this.dirty) {
        this.items = list.slice();
        this.conflict = false;
      } else if (sameList(list, this.items)) {
        this.dirty = false;
        this.conflict = false;
      } else {
        this.conflict = true;
      }
      this.render();
    }

    replaceItems(list) {
      this.items = list.slice();
      this.changed();
    }

    changed() {
      this.dirty = !sameList(this.items, this.remote);
      if (!this.dirty) this.conflict = false;
      this.render();
    }

    discard() {
      this.items = this.remote.slice();
      this.dirty = false;
      this.conflict = false;
      this.render();
    }

    addFromInput() {
      const { urls, problems, rejected } = parseUrls(this.input.value);
      if (!urls.length && !problems.length) {
        showError(this.addError, 'الصق رابط فيديو أولاً.');
        return;
      }
      showError(this.addError, problems.join('\n'));
      if (urls.length) {
        this.items.push(...urls);
        this.input.value = rejected.join('\n');
        this.changed();
      }
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
      const invalid = this.items.filter((url) => !isHttpsUrl(url));
      if (invalid.length) {
        toast('بالقائمة روابط مو https. احذفها وارجع احفظ.', 'bad');
        return;
      }
      if (!this.items.length && this.confirmEmpty && !(await this.confirmEmpty())) return;
      if (this.saving) return;
      this.saving = true;
      this.root.inert = true;
      this.render();
      try {
        await this.onSave(this.items.slice());
        this.remote = this.items.slice();
        this.dirty = false;
        this.conflict = false;
        toast('انحفظت القائمة. الشاشات راح تتحدث خلال ثواني.', 'ok');
      } catch (e) {
        toast(errorText(e), 'bad');
      } finally {
        this.saving = false;
        this.root.inert = false;
        this.render();
      }
    }

    render() {
      this.notice.hidden = !(this.dirty && this.conflict);
      this.notice.replaceChildren(
        el('span', { text: 'القائمة تغيّرت من مكان ثاني وانت جاي تعدّل. إذا تحفظ، راح تكتب تعديلك فوقها.' }),
        button('اعرض النسخة الجديدة', { kind: 'sm', onClick: () => this.discard() }));

      if (!this.items.length) {
        this.list.replaceChildren(el('div', { class: 'pl-empty', text: this.emptyText }));
      } else {
        const last = this.items.length - 1;
        this.list.replaceChildren(el('ol', { class: 'pl-list' }, this.items.map((url, i) => {
          let host = '';
          try { host = new URL(url).hostname; } catch { host = ''; }
          return el('li', { class: 'pl-item' },
            el('span', { class: 'pl-num', text: String(i + 1) }),
            el('div', { class: 'pl-info' },
              el('strong', { title: url, text: fileName(url) }),
              el('small', { title: url, text: host || url })),
            el('div', { class: 'pl-actions' },
              button('معاينة', { kind: 'ghost sm', iconName: 'eye', iconOnly: true, onClick: () => previewVideo(url) }),
              button('لفوق', { kind: 'ghost sm', iconName: 'up', iconOnly: true, disabled: i === 0, onClick: () => this.move(i, -1) }),
              button('لجوة', { kind: 'ghost sm', iconName: 'down', iconOnly: true, disabled: i === last, onClick: () => this.move(i, 1) }),
              button('حذف', { kind: 'danger sm', iconName: 'trash', iconOnly: true, onClick: () => this.remove(i) })));
        })));
      }

      this.footer.replaceChildren(
        el('div', { class: 'group' },
          el('span', { class: 'muted-text', text: `${this.items.length} فيديو` }),
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
    emptyText: 'ما كو فيديوهات بعد. الصق رابط فيديو فوق واضغط إضافة.',
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
      emptyText: 'هاي الشاشة تعرض القائمة العامة. أضف فيديوهات هنا إذا تريدها تعرض شي خاص بيها.',
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
    editor.setRemote(toUrlList(state.devicePlaylists[id]));
    state.deviceEditor = { id, editor };

    const backToGlobal = async () => {
      if (!(await confirmBox({
        title: 'رجوع للقائمة العامة',
        message: `«${v.title}» راح ترجع تعرض القائمة العامة، وقائمتها الخاصة تنمسح.`,
        okText: 'رجّعها',
      }))) return;
      try {
        await ref.remove();
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
        el('p', { class: 'muted-text', style: 'margin:0', text: 'إذا القائمة الخاصة بيها فيديوهات، هاي الشاشة تعرضها بدال القائمة العامة. إذا فاضية، ترجع للعامة.' }),
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
  let configDirty = false;

  function currentConfig() {
    const c = state.config || {};
    const volume = num(c.volume);
    const interval = num(c.update_check_interval_minutes);
    return {
      volume: volume == null ? DEFAULT_CONFIG.volume : Math.min(1, Math.max(0, volume)),
      muted: typeof c.muted === 'boolean' ? c.muted : DEFAULT_CONFIG.muted,
      update_check_interval_minutes: interval == null ? DEFAULT_CONFIG.update_check_interval_minutes : interval,
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
      await db.ref('config').set({
        volume: Math.round(Number(cfgVolume.value)) / 100,
        muted: cfgMuted.checked,
        update_check_interval_minutes: interval,
      });
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

  function renderUpdateTab() {
    const devices = allDevices();
    const info = state.appVersion;
    const code = num(info && info.version_code);
    const url = str(info && info.apk_url);
    const sha = str(info && info.sha256);
    const box = $('current-update');

    if (code == null) {
      box.replaceChildren(el('p', { class: 'muted-text', style: 'margin:0', text: 'ما كو تحديث منشور. الشاشات تبقى على النسخة اللي عدها.' }));
    } else {
      const known = devices.filter((v) => num(v.d.version_code) != null);
      const done = known.filter((v) => num(v.d.version_code) >= code).length;
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
    const highest = Math.max(code || 0, ...devices.map((v) => num(v.d.version_code) || 0));
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
        const vc = num(v.d.version_code);
        let status;
        if (vc == null) status = pill('غير معروف', 'muted');
        else if (code != null && vc < code) status = pill(v.online ? 'ينتظر التحديث' : 'ينتظر التحديث (غير متصلة)', 'warn');
        else status = pill('محدّث', 'ok');
        return el('tr', null,
          el('td', null, v.title, ' ', el('span', { class: 'code-tag', dir: 'ltr', text: v.code })),
          el('td', { dir: 'ltr', style: 'text-align:right', text: vc != null ? versionLabel(v.d) : '—' }),
          el('td', null, status));
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
      await db.ref('app_version').remove();
      toast('انلغى التحديث المنشور.', 'ok');
    } catch (e) {
      toast(errorText(e), 'bad');
    }
  }

  $('upd-file').addEventListener('change', async (event) => {
    const file = event.target.files && event.target.files[0];
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
      $('upd-sha').value = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
      info.textContent = `${file.name} · ${formatMb(file.size / (1024 * 1024))} · انحسبت البصمة`;
    } catch (e) {
      info.textContent = `ما كدرت أقرا الملف: ${e.message || e}`;
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
    const installed = allDevices().map((v) => num(v.d.version_code)).filter((n) => n != null);
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
      await db.ref('app_version').set(payload);
      event.target.reset();
      $('upd-file-info').textContent = '';
      toast(`انتشر الإصدار ${code}.`, 'ok');
    } catch (e) {
      showError(errorBox, errorText(e));
    }
  });

  // ---------- Security tab ----------

  let rulesCheckSeq = 0;

  async function checkRules() {
    const status = $('rules-status');
    const seq = ++rulesCheckSeq;
    status.className = 'rules-status muted';
    status.textContent = 'جاري الفحص…';
    const url = USE_EMULATOR
      ? `http://127.0.0.1:9000/devices.json?ns=${DB_NAMESPACE}&shallow=true`
      : `${FIREBASE_CONFIG.databaseURL}/devices.json?shallow=true`;
    let applied = null;
    try {
      // Anonymous read of an admin-only node: refused means the rules are live.
      const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (res.status === 401 || res.status === 403) applied = true;
      else if (res.ok) applied = false;
    } catch {
      applied = null;
    }
    if (seq !== rulesCheckSeq) return;
    state.rulesApplied = applied;
    if (applied === true) {
      status.className = 'rules-status ok';
      status.textContent = 'قراءة سجل الشاشات بدون تعريف مرفوضة. تأكد من نشر القواعد الموجودة جوة بالكامل حتى تنطي الصلاحية لهذا المتصفح.';
    } else if (applied === false) {
      status.className = 'rules-status bad';
      status.textContent = 'قاعدة البيانات مفتوحة لأي شخص هسه. طبّق القواعد بالخطوات اللي جوة.';
    } else {
      status.className = 'rules-status muted';
      status.textContent = 'ما كدرت أفحص (تأكد من الإنترنت واضغط فحص مرة ثانية).';
    }
    renderBanner();
  }

  $('rules-recheck').addEventListener('click', async () => {
    await checkRules();
    if (state.user && state.denied.size) {
      stopListening();
      state.denied.clear();
      startListening();
      renderBanner();
    }
  });

  $('rules-copy').addEventListener('click', async () => {
    const text = $('rules-text').value;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = $('rules-text');
      area.focus();
      area.select();
      if (!document.execCommand('copy')) {
        toast('ما كدرت أنسخ. حدّد النص بنفسك وانسخه (Ctrl+C).', 'bad');
        return;
      }
    }
    toast('انتسخت القواعد. هسه الصقها بصفحة القواعد بـ Firebase.', 'ok');
  });

  function authErrorText(error) {
    const code = error?.code || '';
    const message = error?.message || '';
    if (/CONFIGURATION_NOT_FOUND|OPERATION_NOT_ALLOWED|ADMIN_ONLY_OPERATION/i.test(message)
      || code === 'auth/configuration-not-found' || code === 'auth/operation-not-allowed' || code === 'auth/admin-restricted-operation') {
      return 'الرمز صحيح، بس الربط التلقائي مو مفعّل بـ Firebase.\nافتح Authentication ثم Sign-in method، وفعّل Anonymous واضغط Save. ما تحتاج بريد أو كلمة سر.';
    }
    if (code === 'auth/too-many-requests') return 'طلبات كثيرة. انتظر شوية وجرّب مرة ثانية.';
    if (code === 'auth/network-request-failed') return 'الرمز صحيح، بس ما كو اتصال بـ Firebase. تأكد من الإنترنت وجرّب مرة ثانية.';
    return `ما كدرت أربط اللوحة بـ Firebase: ${code || message || 'خطأ غير معروف'}`;
  }

  function renderPin() {
    $('pin-dots').replaceChildren(...Array.from({ length: ACCESS_PIN.length }, (_, i) =>
      el('span', { class: `pin-dot${i < pinValue.length ? ' filled' : ''}`, 'aria-hidden': 'true' })));
    $('pin-dots').setAttribute('aria-label', `دخلت ${pinValue.length} من ${ACCESS_PIN.length} أرقام`);
    $('pin-keypad').querySelectorAll('button').forEach((key) => { key.disabled = pinBusy; });
    $('pin-delete').disabled = pinBusy || !pinValue.length;
    $('pin-status').textContent = pinBusy ? 'جاري فتح اللوحة…' : '';
  }

  async function unlockPanel() {
    if (pinBusy) return;
    if (pinValue !== ACCESS_PIN) {
      pinValue = '';
      renderPin();
      showError($('login-error'), 'الرمز مو صحيح، جرّب مرة ثانية.');
      const card = document.querySelector('.pin-card');
      card.classList.add('pin-wrong');
      setTimeout(() => card.classList.remove('pin-wrong'), 350);
      return;
    }
    pinBusy = true;
    renderPin();
    showError($('login-error'), '');
    try {
      const user = auth.currentUser?.isAnonymous
        ? auth.currentUser
        : (await auth.signInAnonymously()).user;
      pinUnlocked = true;
      startApp(user);
    } catch (error) {
      showError($('login-error'), authErrorText(error));
    } finally {
      pinBusy = false;
      pinValue = '';
      renderPin();
    }
  }

  $('pin-keypad').addEventListener('click', (event) => {
    if (pinBusy) return;
    const key = event.target.closest('button[data-digit]');
    if (!key || pinValue.length >= ACCESS_PIN.length) return;
    showError($('login-error'), '');
    pinValue += key.dataset.digit;
    renderPin();
    if (pinValue.length === ACCESS_PIN.length) unlockPanel();
  });

  $('pin-delete').addEventListener('click', () => {
    if (pinBusy) return;
    pinValue = pinValue.slice(0, -1);
    showError($('login-error'), '');
    renderPin();
  });

  $('logout-btn').addEventListener('click', async () => {
    if ((globalEditor.dirty || configDirty || state.deviceEditor?.editor.dirty)
      && !(await confirmBox({ title: 'تغييرات ما محفوظة', message: 'قفل اللوحة راح يضيّع التغييرات اللي ما حفظتها. تريد تقفلها؟', okText: 'قفل اللوحة', danger: true }))) return;
    stopApp();
  });

  window.addEventListener('beforeunload', (event) => {
    if (globalEditor.dirty || configDirty || state.deviceEditor?.editor.dirty) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  function resetState() {
    Object.assign(state, {
      connected: false,
      everConnected: false,
      devices: {},
      names: {},
      devicePlaylists: {},
      playlist: [],
      config: null,
      appVersion: null,
      openMenu: null,
      rulesApplied: null,
      deviceEditor: null,
    });
    state.loaded.clear();
    state.denied.clear();
  }

  function startApp(user) {
    state.user = user;
    $('boot-view').hidden = true;
    $('login-view').hidden = true;
    $('app-view').hidden = false;
    $('admin-uid').textContent = user.uid;
    $('rules-text').value = JSON.stringify(window.buildDatabaseRules([user.uid]), null, 2);
    renderConnection();
    renderBanner();
    renderGlobalCommands();
    globalEditor.discard();
    fillConfigForm(true);
    startListening();
    selectTab(location.hash.slice(1));
    if (location.hash.slice(1) !== 'security') checkRules();
    clearInterval(tickTimer);
    tickTimer = setInterval(scheduleRender, 30000);
  }

  function stopApp() {
    pinUnlocked = false;
    pinValue = '';
    ++rulesCheckSeq;
    configDirty = false;
    stopListening();
    clearInterval(tickTimer);
    tickTimer = null;
    document.querySelectorAll('dialog.modal[open]').forEach((dialog) => dialog.close('cancel'));
    resetState();
    globalEditor.setRemote([]);
    globalEditor.discard();
    globalEditor.input.value = '';
    showError(globalEditor.addError, '');
    renderDevices();
    renderUpdateTab();
    fillConfigForm(true);
    renderBanner();
    state.user = null;
    $('boot-view').hidden = true;
    $('app-view').hidden = true;
    $('login-view').hidden = false;
    $('admin-uid').textContent = '';
    $('rules-text').value = '';
    $('update-form').reset();
    $('upd-file-info').textContent = '';
    showError($('login-error'), '');
    renderPin();
  }

  document.querySelectorAll('[data-icon]').forEach((node) => node.append(icon(node.dataset.icon)));

  renderPin();

  auth.onAuthStateChanged((user) => {
    if (!pinUnlocked) {
      if (!pinBusy) stopApp();
    } else if (!user?.isAnonymous || user.uid !== state.user?.uid) {
      stopApp();
      showError($('login-error'), 'انتهت جلسة الربط. أدخل الرمز مرة ثانية.');
    }
  });
})();
