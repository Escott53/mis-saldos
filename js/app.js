/* Mis Saldos — panel personal de patrimonio. Todo local y cifrado en el dispositivo. */
(() => {
  'use strict';
  const APP_VERSION = '1.1.0';
  const LOCK_AFTER_BG_MS = 60 * 1000;      // bloquear al volver tras >1 min en segundo plano
  const IDLE_LOCK_MS = 5 * 60 * 1000;      // bloquear tras 5 min sin tocar la pantalla
  const AUTO_REFRESH_MS = 15 * 60 * 1000;  // refrescar datos automáticos al desbloquear si han pasado >15 min
  const PIN_LEN = 6;

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const app = $('#app');
  const P = window.Providers;

  // ---------- Formato ----------
  let eurFmt;
  try { eurFmt = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', useGrouping: 'always' }); eurFmt.format(1); }
  catch (_) { eurFmt = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }); }
  const numFmt = (d = 2) => { try { return new Intl.NumberFormat('es-ES', { maximumFractionDigits: d, useGrouping: 'always' }); } catch (_) { return new Intl.NumberFormat('es-ES', { maximumFractionDigits: d }); } };
  const hidden = () => S && S.settings.hide;
  const eur = (v, force) => (v == null || !Number.isFinite(v)) ? '—' : (hidden() && !force ? '•••••• €' : eurFmt.format(v));
  const num = (v, d = 8) => (v == null || !Number.isFinite(v)) ? '—' : (hidden() ? '••••' : numFmt(d).format(v));
  const pct = (v) => (v >= 0 ? '+' : '') + numFmt(2).format(v) + ' %';
  const signedEur = (v) => hidden() ? '•••• €' : (v >= 0 ? '+' : '−') + eurFmt.format(Math.abs(v));
  const dFmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' });
  const dFmtY = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
  const dtFmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const dateStr = (t) => { const d = new Date(t); return d.getFullYear() === new Date().getFullYear() ? dFmt.format(d) : dFmtY.format(d); };
  const ymdToEs = (s) => s ? s.split('-').reverse().join('/') : '';
  function ago(t) {
    if (!t) return 'nunca';
    const s = (Date.now() - t) / 1000;
    if (s < 60) return 'ahora mismo';
    if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
    if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
    if (s < 172800) return 'ayer';
    if (s < 7 * 86400) return `hace ${Math.floor(s / 86400)} días`;
    return dateStr(t);
  }
  const parseAmount = (v) => window.Degiro.parseNum(v);
  let mxnFmt;
  try { mxnFmt = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'MXN', useGrouping: 'always' }); mxnFmt.format(1); }
  catch (_) { mxnFmt = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'MXN' }); }
  const mxn = (v, force) => (v == null || !Number.isFinite(v)) ? '—' : (hidden() && !force ? '•••••• MXN' : mxnFmt.format(v));
  const r2 = (v) => Math.round(v * 100) / 100;
  const todayYmd = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  function addMonths(ymd, n) {
    const [y, m, d] = ymd.split('-').map(Number); const t = new Date(y, m - 1 + n, 1);
    const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
  }

  // ---------- Paletas y cuentas predefinidas ----------
  const COLORS = {
    ledger: ['#64748b', '#0f172a'], degiro: ['#38bdf8', '#1d4ed8'], mapfre: ['#fb7185', '#be123c'], horos: ['#e0567a', '#7f1d3a'],
    violeta: ['#a78bfa', '#7c3aed'], esmeralda: ['#34d399', '#047857'], ambar: ['#fbbf24', '#ea580c'], oceano: ['#22d3ee', '#0e7490'],
    indigo: ['#818cf8', '#4338ca'], rosa: ['#f472b6', '#be185d'], grafito: ['#94a3b8', '#334155'], lima: ['#a3e635', '#3f6212'],
  };
  const EMOJIS = ['💶', '🏦', '💳', '🐷', '💰', '📈', '🏠', '🚗', '🪙', '💎', '🛡️', '🧾', '🎓', '👶', '🌍', '⭐'];
  const BUILTIN = {
    ledger: { name: 'Ledger Nano', emoji: '🔐', color: 'ledger', link: 'ledgerlive://', fallback: 'https://www.ledger.com/ledger-live', sub: 'Criptomonedas · direcciones públicas' },
    degiro: { name: 'DEGIRO', emoji: '📈', color: 'degiro', link: 'https://trader.degiro.nl', sub: 'Bróker · acciones y ETF' },
    mapfre: { name: 'Mapfre', emoji: '🛡️', color: 'mapfre', link: 'https://www.mapfre.es/particulares/area-clientes/', sub: 'Seguros de ahorro · planes' },
    horos: { name: 'Horos AM', emoji: '🦉', color: 'horos', link: 'https://horosam.com/portal/#/login', sub: 'Fondos de inversión · pensiones' },
    terreno: { name: 'Terreno', emoji: '🌴', color: 'esmeralda', link: '', sub: 'Terreno en pagos · MXN · fuera del total' },
  };
  function newAccount(type) {
    const b = BUILTIN[type];
    const base = { id: type, type, name: b.name, emoji: b.emoji, color: b.color, link: b.link, updated: null };
    if (type === 'ledger') return { ...base, entries: [] };
    if (type === 'degiro') return { ...base, source: null, manual: null, manualAt: null, positions: [], csvTotal: null, csvAt: null, csvName: '' };
    if (type === 'mapfre') return { ...base, products: [], history: [] };
    if (type === 'horos') return { ...base, funds: [] };
    if (type === 'terreno') return { ...base, currency: 'MXN', plot: {}, price: null, plan: {}, payments: [], statement: null, terms: [], docs: [] };
  }
  const defaultData = () => ({ v: 1, settings: { hide: false, range: '3M' }, accounts: ['ledger', 'degiro', 'mapfre', 'horos'].map(newAccount), snapshots: [], prices: {}, lastRefresh: 0 });

  // ---------- Estado ----------
  let S = null;            // datos descifrados (solo en memoria mientras está desbloqueado)
  let refreshing = false;
  let hiddenAt = 0;
  let idleTimer = null;

  const persist = async () => { try { await Vault.save(S); } catch (e) { toast('No se pudo guardar: ' + e.message); } };
  const acc = (id) => S.accounts.find((a) => a.id === id);
  const colorOf = (a) => COLORS[a.color] || COLORS.violeta;

  function ledgerLines(a) {
    return a.entries.map((e) => {
      const price = S.prices[e.coin] ? S.prices[e.coin].eur : null;
      return { e, price, value: e.amount != null && price != null ? e.amount * price : null };
    });
  }
  const horosNavOf = (f) => f.nav;
  function balanceOf(a) {
    switch (a.type) {
      case 'ledger': { const l = ledgerLines(a); if (!l.length || l.every((x) => x.value == null)) return null; return l.reduce((s, x) => s + (x.value || 0), 0); }
      case 'degiro': return a.source === 'csv' ? a.csvTotal : a.source === 'manual' ? a.manual : null;
      case 'mapfre': return a.products.length ? a.products.reduce((s, p) => s + (p.amount || 0), 0) : null;
      case 'horos': { if (!a.funds.length) return null; const v = a.funds.map((f) => (f.units != null && horosNavOf(f) != null ? f.units * horosNavOf(f) : null)); if (v.every((x) => x == null)) return null; return v.reduce((s, x) => s + (x || 0), 0); }
      default: return a.balance ?? null;
    }
  }
  // El terreno (MXN, aún en pago) se muestra aparte y no se suma al patrimonio en euros.
  const inTotal = (a) => a.type !== 'terreno';
  const total = () => S.accounts.filter(inTotal).reduce((s, a) => s + (balanceOf(a) || 0), 0);

  function terrInfo(a) {
    const pays = (a.payments || []).slice().sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
    const paid = r2(pays.reduce((s, p) => s + (p.amount || 0), 0));
    const price = a.price != null ? a.price : null;
    const pending = price != null ? r2(Math.max(0, price - paid)) : null;
    const pctPaid = price ? Math.min(100, paid / price * 100) : 0;
    const p = a.plan || {}; let next = null;
    if (pending > 0.005 && p.installment && p.firstDue) {
      const toInst = paid - (p.downPayment || 0);
      if (toInst < -0.005) next = { date: p.downDue || null, amount: r2(-toInst), label: 'Resto del enganche' };
      else {
        const n = Math.floor((toInst + 0.005) / p.installment);
        next = { date: addMonths(p.firstDue, n), amount: r2(Math.min(pending, p.installment - (toInst - n * p.installment))), label: `Mensualidad ${n + 1}${p.nInstallments ? ' de ' + p.nInstallments : ''}`, covered: n };
      }
    }
    const remInst = p.installment && pending != null ? Math.ceil((pending - 0.01) / p.installment) : null;
    let run = price;
    const rows = pays.map((x) => { if (run != null) run = r2(run - x.amount); return { ...x, after: run }; });
    return { pays, rows, paid, price, pending, pctPaid, next, remInst };
  }

  function recordSnapshot() {
    const t = Date.now();
    const by = {}; S.accounts.filter(inTotal).forEach((a) => { const b = balanceOf(a); if (b != null) by[a.id] = Math.round(b * 100) / 100; });
    const snap = { t, total: Math.round(total() * 100) / 100, by };
    const last = S.snapshots[S.snapshots.length - 1];
    if (last && Math.abs(last.total - snap.total) < 0.005) { last.t = t; last.by = by; return; }
    if (last && t - last.t < 10 * 60 * 1000 && S.snapshots.length > 1) S.snapshots[S.snapshots.length - 1] = snap;
    else S.snapshots.push(snap);
    if (S.snapshots.length > 3000) S.snapshots.splice(0, S.snapshots.length - 3000);
  }
  async function changed() { recordSnapshot(); await persist(); render(); }

  // ---------- Toast / hojas ----------
  function toast(msg, action) {
    const root = $('#toast-root'); root.innerHTML = '';
    const el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status');
    el.innerHTML = `<span>${esc(msg)}</span>`;
    if (action) { const b = document.createElement('button'); b.textContent = action.label; b.onclick = () => { action.fn(); el.remove(); }; el.appendChild(b); }
    root.appendChild(el);
    setTimeout(() => el.remove(), action ? 8000 : 3200);
  }
  function openSheet(html, mount) {
    closeSheet(true);
    const root = $('#sheet-root');
    root.innerHTML = `<div class="backdrop" data-act="close-sheet"></div><div class="sheet" role="dialog" aria-modal="true"><div class="grabber"></div>${html}</div>`;
    const sheet = $('.sheet', root);
    mount && mount(sheet);
    const f = sheet.querySelector('[autofocus]'); if (f) setTimeout(() => f.focus(), 250);
    return sheet;
  }
  function closeSheet(instant) {
    const root = $('#sheet-root'); if (!root.firstChild) return;
    if (instant) { root.innerHTML = ''; return; }
    $$('.sheet, .backdrop', root).forEach((e) => e.classList.add('closing'));
    setTimeout(() => { root.innerHTML = ''; }, 200);
  }

  // ---------- Iconos SVG ----------
  const I = {
    eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>',
    eyeOff: '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
    refresh: '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6"/></svg>',
    gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>',
    more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>',
    ext: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
    lock: '<svg viewBox="0 0 24 24"><rect x="4" y="10" width="16" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
    finger: '<svg viewBox="0 0 24 24"><path d="M12 11v3a8 8 0 0 1-1.5 4.7M8.5 21A12 12 0 0 0 9 14v-3a3 3 0 0 1 6 0v1M18 13.5V11a6 6 0 0 0-10.3-4.2M5.3 17A10 10 0 0 0 6 13v-2a6 6 0 0 1 .5-2.4M15 16.5a17 17 0 0 1-1 4.5M18 18v.5"/></svg>',
    del: '<svg viewBox="0 0 24 24"><path d="M21 5H8l-6 7 6 7h13a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1ZM17 9l-6 6M11 9l6 6"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    shield: '<svg viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3Z"/><path d="M9 12l2 2 4-4"/></svg>',
    warn: '<svg viewBox="0 0 24 24"><path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17h.01"/></svg>',
    file: '<svg viewBox="0 0 24 24"><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8l-5-5Z"/><path d="M14 3v5h5M12 11v6M9 14l3 3 3-3"/></svg>',
  };
  const LOGO = '<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b5cf6"/><stop offset="1" stop-color="#06b6d4"/></linearGradient></defs><rect width="64" height="64" rx="18" fill="url(#lg)"/><path d="M14 44l10-11 8 7 16-18" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="48" cy="22" r="4" fill="#fff"/></svg>';

  // =====================================================================
  //  BLOQUEO / CONFIGURACIÓN INICIAL
  // =====================================================================
  const lockState = { mode: 'unlock', step: 'pin', buf: '', first: '', usePassword: false, busy: false };

  async function showLock(mode, autoBio = true) {
    closeSheet(true);
    Object.assign(lockState, { mode, step: mode === 'setup' ? 'intro' : 'pin', buf: '', first: '', busy: false });
    if (mode === 'unlock') lockState.usePassword = (Vault.meta && Vault.meta.secretType === 'password');
    lockState.bioOn = mode === 'unlock' && !!(Vault.meta && Vault.meta.bio) && await Vault.bioAvailable();
    renderLock();
    if (autoBio && lockState.bioOn && !document.hidden) setTimeout(() => bioUnlock(true), 350);
  }

  function renderLock(err = '') {
    document.body.classList.add('locked');
    const L = lockState;
    let title = 'Mis Saldos', msg = '', body = '';
    if (L.mode === 'setup' && L.step === 'intro') {
      app.innerHTML = `<section class="lock intro">
        <div class="lock-logo">${LOGO}</div>
        <h1>Mis Saldos</h1>
        <p class="lock-lead">Tu patrimonio de un vistazo, <b>cifrado y guardado solo en este dispositivo</b>.</p>
        <ul class="intro-list">
          <li><span>🔒</span><div><b>Protegido con PIN</b><small>Cifrado AES-256 con clave derivada de tu PIN. Opcionalmente, huella o Face ID.</small></div></li>
          <li><span>📵</span><div><b>Sin servidores ni cuentas</b><small>Nada se sube a internet. Solo se consultan precios y saldos públicos.</small></div></li>
          <li><span>🙅</span><div><b>Nunca te pediremos contraseñas</b><small>Ni de DEGIRO, Mapfre u Horos, ni la frase semilla de tu Ledger.</small></div></li>
        </ul>
        <button class="btn primary big" data-act="setup-start">Crear PIN y empezar</button>
      </section>`;
      return;
    }
    if (L.mode === 'setup' && L.step === 'bio') {
      app.innerHTML = `<section class="lock intro">
        <div class="lock-logo bio">${I.finger}</div>
        <h1>¿Desbloquear con huella o Face ID?</h1>
        <p class="lock-lead">Podrás abrir la app con la biometría de tu móvil. El PIN seguirá funcionando siempre como alternativa.</p>
        <button class="btn primary big" data-act="setup-bio">Activar biometría</button>
        <button class="btn ghost big" data-act="setup-done">Ahora no</button>
        <p class="lock-err">${esc(err)}</p>
      </section>`;
      return;
    }
    if (L.mode === 'setup') { title = L.step === 'confirm' ? 'Repite el PIN' : 'Crea tu PIN'; msg = L.usePassword ? 'Mínimo 8 caracteres. Úsala solo aquí.' : `${PIN_LEN} dígitos. No uses tu fecha de nacimiento.`; if (L.usePassword) title = L.step === 'confirm' ? 'Repite la contraseña' : 'Crea una contraseña'; }
    else { msg = L.usePassword ? 'Introduce tu contraseña' : 'Introduce tu PIN'; }
    const wait = L.mode === 'unlock' ? Vault.lockoutRemaining() : 0;
    if (wait > 0 && !err) err = `Demasiados intentos. Espera ${Math.ceil(wait / 1000)} s.`;
    if (L.usePassword) {
      body = `<form class="pw-form" data-form="lock-pw">
          <input class="field" type="password" name="pw" autocomplete="${L.mode === 'setup' ? 'new-password' : 'current-password'}" placeholder="Contraseña" autofocus aria-label="Contraseña" ${L.busy ? 'disabled' : ''}>
          <button class="btn primary big" ${L.busy ? 'disabled' : ''}>${L.busy ? '<span class="spin"></span> Descifrando…' : L.mode === 'setup' ? 'Continuar' : 'Desbloquear'}</button>
          ${L.bioOn ? `<button type="button" class="btn ghost big" data-act="bio-unlock">${I.finger} Huella / Face ID</button>` : ''}
        </form>`;
    } else {
      const dots = Array.from({ length: PIN_LEN }, (_, i) => `<i class="${i < L.buf.length ? 'on' : ''}"></i>`).join('');
      const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', L.bioOn ? 'bio' : '', '0', 'del'];
      body = `<div class="dots ${err ? 'shake' : ''} ${L.busy ? 'busy' : ''}" aria-label="PIN introducido: ${L.buf.length} de ${PIN_LEN}">${dots}</div>
        <div class="pad" role="group" aria-label="Teclado numérico">${keys.map((k) => k === '' ? '<span></span>'
          : k === 'bio' ? `<button class="key fn" data-act="bio-unlock" aria-label="Desbloquear con huella o Face ID">${I.finger}</button>`
          : k === 'del' ? `<button class="key fn" data-act="pin-del" aria-label="Borrar">${I.del}</button>`
          : `<button class="key" data-act="pin-key" data-k="${k}">${k}</button>`).join('')}</div>`;
    }
    app.innerHTML = `<section class="lock">
      <div class="lock-head">
        <div class="lock-logo small">${L.mode === 'unlock' ? `<span class="lock-ico">${I.lock}</span>` : LOGO}</div>
        <h1>${esc(title)}</h1>
        <p class="lock-msg">${L.busy && !L.usePassword ? '<span class="spin dark"></span> Descifrando…' : esc(msg)}</p>
        <p class="lock-err" role="alert">${esc(err)}</p>
      </div>
      ${body}
      <button class="link" data-act="toggle-pw">${L.mode === 'setup' ? (L.usePassword ? 'Usar un PIN numérico' : 'Prefiero una contraseña alfanumérica') : ''}</button>
    </section>`;
    if (L.usePassword) { const inp = $('input[name=pw]', app); if (inp && !L.busy) setTimeout(() => inp.focus(), 50); }
  }

  async function submitSecret(secret) {
    const L = lockState;
    if (L.mode === 'setup') {
      if (L.step === 'pin') {
        if (L.usePassword && secret.length < 8) return renderLock('La contraseña debe tener al menos 8 caracteres.');
        if (!L.usePassword && /^(\d)\1+$|^(012345|123456|234567|345678|456789|987654|654321)$/.test(secret)) { L.buf = ''; return renderLock('Ese PIN es demasiado fácil de adivinar.'); }
        L.first = secret; L.step = 'confirm'; L.buf = ''; return renderLock();
      }
      if (secret !== L.first) { L.step = 'pin'; L.first = ''; L.buf = ''; return renderLock('No coinciden. Vuelve a empezar.'); }
      L.busy = true; renderLock();
      try {
        await Vault.setup(secret, L.usePassword ? 'password' : 'pin');
        S = defaultData(); await persist();
        L.first = ''; L.busy = false;
        if (await Vault.bioAvailable()) { L.step = 'bio'; L.secretTmp = secret; return renderLock(); }
        return enterApp(false);
      } catch (e) { L.busy = false; L.step = 'pin'; L.buf = ''; return renderLock('Error: ' + e.message); }
    }
    L.busy = true; renderLock();
    try {
      const data = await Vault.unlockWithSecret(secret);
      S = migrate(data);
      L.busy = false; L.buf = '';
      enterApp(true);
    } catch (e) {
      L.busy = false; L.buf = '';
      if (e.message === 'lockout' || e.wait) return renderLock(`Demasiados intentos. Espera ${Math.ceil(e.wait / 1000)} s.`);
      renderLock(e.message === 'bad-secret' ? `${L.usePassword ? 'Contraseña' : 'PIN'} incorrecto${e.fails >= 3 ? ` (${e.fails} intentos)` : ''}` : 'Error: ' + e.message);
    }
  }

  async function bioUnlock(auto) {
    if (lockState.busy) return;
    try {
      lockState.busy = true;
      const data = await Vault.unlockWithBio();
      S = migrate(data); lockState.busy = false;
      enterApp(true);
    } catch (e) {
      lockState.busy = false;
      if (!auto) renderLock(e.name === 'NotAllowedError' ? 'Cancelado. Usa el PIN.' : 'Biometría no disponible: ' + e.message);
      else renderLock();
    }
  }

  function migrate(d) {
    if (!d) return defaultData();
    d.settings = { hide: false, range: '3M', ...(d.settings || {}) };
    d.accounts = d.accounts || []; d.snapshots = d.snapshots || []; d.prices = d.prices || {};
    return d;
  }

  function enterApp(fromUnlock) {
    document.body.classList.remove('locked');
    lockState.secretTmp = null;
    if (!location.hash || location.hash === '#') history.replaceState(null, '', '#/');
    render();
    armIdle();
    maybeTerrImport();
    if (fromUnlock && Date.now() - (S.lastRefresh || 0) > AUTO_REFRESH_MS && hasAutoSources()) refreshAll(true);
  }

  function lockNow(autoBio = false) {
    if (!Vault.isUnlocked() && !S) return;
    Vault.lock(); S = null;
    clearTimeout(idleTimer);
    $('#toast-root').innerHTML = '';
    showLock('unlock', autoBio);
  }
  function armIdle() { clearTimeout(idleTimer); if (S) idleTimer = setTimeout(() => lockNow(false), IDLE_LOCK_MS); }
  ['pointerdown', 'keydown', 'scroll'].forEach((ev) => document.addEventListener(ev, () => { if (S) armIdle(); }, { passive: true, capture: true }));

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); document.body.classList.add('privacy'); }
    else {
      document.body.classList.remove('privacy');
      if (S && hiddenAt && Date.now() - hiddenAt > LOCK_AFTER_BG_MS) lockNow(true);
      else if (!S && lockState.bioOn && lockState.mode === 'unlock' && hiddenAt && Date.now() - hiddenAt > 1500) setTimeout(() => bioUnlock(true), 300);
    }
  });

  // =====================================================================
  //  VISTAS
  // =====================================================================
  function render() {
    if (!S) return;
    const m = location.hash.match(/^#\/cuenta\/([\w-]+)/);
    if (m && acc(m[1])) renderAccount(acc(m[1]));
    else renderHome();
  }
  window.addEventListener('hashchange', () => { if (captureTerrLink()) { if (S) { render(); maybeTerrImport(); } return; } if (S) { closeSheet(true); render(); window.scrollTo(0, 0); } });

  function greeting() { const h = new Date().getHours(); return h < 6 ? 'Buenas noches' : h < 13 ? 'Buenos días' : h < 21 ? 'Buenas tardes' : 'Buenas noches'; }

  function hasAutoSources() {
    return S.accounts.some((a) => (a.type === 'ledger' && a.entries.length) || (a.type === 'horos' && a.funds.length));
  }

  function chartSVG() {
    const range = S.settings.range || '3M';
    const days = { '1M': 31, '3M': 92, '1A': 366, Todo: 1e6 }[range];
    const from = Date.now() - days * 86400000;
    let pts = S.snapshots.filter((s) => s.t >= from);
    const before = S.snapshots.filter((s) => s.t < from).pop();
    if (before && pts.length) pts = [{ ...before, t: from }, ...pts];
    const tabs = `<div class="ranges" role="tablist">${['1M', '3M', '1A', 'Todo'].map((r) => `<button role="tab" aria-selected="${r === range}" class="${r === range ? 'on' : ''}" data-act="range" data-r="${r}">${r}</button>`).join('')}</div>`;
    if (pts.length < 2) return `<div class="chart empty-chart"><span>📊 La gráfica aparecerá tras dos o más actualizaciones de saldo.</span></div>${tabs}`;
    const W = 320, H = 96, pad = 6;
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1;
    const vs = pts.map((p) => p.total); let lo = Math.min(...vs), hi = Math.max(...vs);
    const span = hi - lo; if (span < 1) { hi += 1; lo -= 1; } else { lo -= span * 0.08; hi += span * 0.08; }
    const x = (t) => pad + (W - 2 * pad) * ((t - t0) / Math.max(1, t1 - t0));
    const y = (v) => pad + (H - 2 * pad) * (1 - (v - lo) / (hi - lo));
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.total).toFixed(1)}`).join(' ');
    const area = `${line} L${x(t1).toFixed(1)},${H} L${x(t0).toFixed(1)},${H} Z`;
    const lp = pts[pts.length - 1];
    const maxV = Math.max(...vs);
    return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Evolución del patrimonio total">
      <defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".45"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
      <path d="${area}" fill="url(#cg)"/><path d="${line}" fill="none" stroke="#fff" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
      </svg><i class="chart-dot" style="left:${(x(lp.t) / W * 100).toFixed(2)}%;top:${(y(lp.total) / H * 100).toFixed(2)}%"></i>
      <div class="chart-axis"><span>${dateStr(t0)}</span><span>${hidden() ? '' : 'máx. ' + eurFmt.format(maxV)}</span><span>${dateStr(t1)}</span></div></div>${tabs}`;
  }

  function changeLine() {
    const sn = S.snapshots;
    if (sn.length < 2) return `<span class="chg neutral">${sn.length ? 'Primer registro · ' + ago(sn[0].t) : 'Añade tus saldos para empezar'}</span>`;
    const cur = sn[sn.length - 1], prev = sn[sn.length - 2];
    const d = cur.total - prev.total, p = prev.total ? d / prev.total * 100 : 0;
    return `<span class="chg ${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '▲' : '▼'} ${signedEur(d)}${prev.total ? ` · ${pct(p)}` : ''}</span><span class="chg-since">desde ${dtFmt.format(prev.t)}</span>`;
  }

  function accSubtitle(a) {
    switch (a.type) {
      case 'ledger': { if (!a.entries.length) return 'Sin direcciones · toca para añadir'; const coins = [...new Set(a.entries.map((e) => P.COINS[e.coin].sym))]; const err = a.entries.some((e) => e.error); return coins.join(' · ') + (err ? ' · ⚠︎ error al actualizar' : ''); }
      case 'degiro': return a.source === 'csv' ? `${a.positions.filter((p) => !p.cash).length} posiciones · CSV` : a.source === 'manual' ? 'Saldo manual' : 'Importa el CSV o introduce el saldo';
      case 'mapfre': return a.products.length ? `${a.products.length} producto${a.products.length > 1 ? 's' : ''}` : 'Sin productos · toca para añadir';
      case 'horos': { if (!a.funds.length) return 'Sin fondos · toca para añadir'; const d = a.funds.map((f) => f.navDate).filter(Boolean).sort().pop(); return `${a.funds.length} fondo${a.funds.length > 1 ? 's' : ''}${d ? ' · VL ' + ymdToEs(d).slice(0, 5) : ''}`; }
      case 'terreno': { const t = terrInfo(a); if (t.price == null) return 'Toca para configurar'; return `Pagado ${Math.floor(t.pctPaid)} % · pendiente ${mxn(t.pending)}`; }
      default: return a.balance != null ? 'Saldo manual' : 'Sin saldo';
    }
  }

  function renderHome() {
    const T = total();
    const withBal = S.accounts.map((a) => ({ a, b: balanceOf(a) }));
    app.innerHTML = `<main class="view home">
      <header class="home-head">
        <div><div class="date">${esc(greeting())} · ${esc(new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()))}</div>
        <h1>Mis <span>saldos</span></h1></div>
        <div class="head-btns">
          <button class="icon-btn" data-act="toggle-hide" aria-label="${hidden() ? 'Mostrar importes' : 'Ocultar importes'}" aria-pressed="${hidden()}">${hidden() ? I.eyeOff : I.eye}</button>
          <button class="icon-btn ${refreshing ? 'spinning' : ''}" data-act="refresh" aria-label="Actualizar saldos">${I.refresh}</button>
          <button class="icon-btn" data-act="settings" aria-label="Ajustes">${I.gear}</button>
        </div>
      </header>
      <section class="hero" aria-label="Patrimonio total">
        <div class="hero-label">Patrimonio total</div>
        <div class="hero-total ${hidden() ? 'masked' : ''}">${eur(T)}</div>
        <div class="hero-chg">${changeLine()}</div>
        ${chartSVG()}
      </section>
      <div class="section-title"><span>Cuentas</span><span class="muted-small">${S.lastRefresh ? 'Auto: ' + ago(S.lastRefresh) : ''}</span></div>
      <div class="accounts">
        ${withBal.map(({ a, b }, i) => { const [g1, g2] = colorOf(a); const tr = a.type === 'terreno' ? terrInfo(a) : null; const share = tr ? tr.pctPaid : T > 0 && b > 0 ? b / T * 100 : 0; return `
        <article class="acc" style="--g1:${g1};--g2:${g2};--i:${i}" data-act="open-acc" data-id="${esc(a.id)}" tabindex="0" role="button" aria-label="${esc(a.name)}: ${b == null ? 'sin configurar' : eur(b)}">
          <div class="acc-top">
            <div class="acc-ico">${esc(a.emoji)}</div>
            <div class="acc-main"><div class="acc-name">${esc(a.name)}</div><div class="acc-sub">${esc(accSubtitle(a))}</div></div>
            <div class="acc-right"><div class="acc-bal ${b == null && !(tr && tr.price != null) ? 'none' : ''}">${tr ? (tr.price == null ? 'Configurar' : mxn(tr.paid)) : b == null ? 'Configurar' : eur(b)}</div><div class="acc-upd">${a.updated ? esc(ago(a.updated)) : ''}</div></div>
          </div>
          <div class="acc-foot">
            <div class="share"><i style="width:${share.toFixed(1)}%"></i></div><span class="share-t">${tr ? (tr.price != null ? Math.floor(share) + ' % pagado' : '') : b != null && T > 0 ? Math.round(share) + ' %' : ''}</span>
            ${a.link ? `<button class="open-app" data-act="open-app" data-id="${esc(a.id)}">Abrir app ${I.ext}</button>` : ''}
          </div>
        </article>`; }).join('')}
        <button class="acc add" data-act="add-account"><span class="plus">${I.plus}</span><span>Añadir cuenta</span></button>
      </div>
      ${(() => { const ta = S.accounts.find((x) => x.type === 'terreno'); if (!ta) return ''; const t = terrInfo(ta); return t.price == null ? '' : `<p class="note center">🌴 El terreno no se suma al patrimonio total (MXN, en pago): pagado ${esc(mxn(t.paid))} · pendiente ${esc(mxn(t.pending))}.</p>`; })()}
      <p class="foot-note">${I.shield} Datos cifrados solo en este dispositivo</p>
    </main>`;
  }

  function heroFor(a, extra = '', balHTML = null, label = '') {
    const [g1, g2] = colorOf(a); const b = balanceOf(a);
    return `<section class="a-hero" style="--g1:${g1};--g2:${g2}">
      <div class="a-top">
        <button class="icon-btn glass" data-act="back" aria-label="Volver">${I.back}</button>
        <div class="a-top-r">
          <button class="icon-btn glass" data-act="toggle-hide" aria-label="Ocultar importes">${hidden() ? I.eyeOff : I.eye}</button>
          <button class="icon-btn glass" data-act="edit-acc" data-id="${esc(a.id)}" aria-label="Opciones de la cuenta">${I.more}</button>
        </div>
      </div>
      <div class="a-title"><div class="emoji">${esc(a.emoji)}</div><div><h2>${esc(a.name)}</h2><div class="type">${esc((BUILTIN[a.type] && BUILTIN[a.type].sub) || 'Cuenta personalizada')}</div></div></div>
      ${label ? `<div class="a-lbl">${esc(label)}</div>` : ''}<div class="a-bal">${balHTML != null ? balHTML : b == null ? '—' : eur(b)}</div>
      <div class="a-upd">${a.updated ? 'Actualizado ' + esc(ago(a.updated)) + ' · ' + esc(dtFmt.format(a.updated)) : 'Sin datos todavía'}</div>
      <div class="a-actions">${extra}${a.link ? `<button class="chip-btn" data-act="open-app" data-id="${esc(a.id)}">Abrir app ${I.ext}</button>` : ''}</div>
    </section>`;
  }

  function renderAccount(a) {
    let body = '', extra = '';
    if (a.type === 'ledger') {
      extra = a.entries.some((e) => e.kind !== 'manual') ? `<button class="chip-btn ${refreshing ? 'spinning' : ''}" data-act="refresh">${I.refresh} Actualizar</button>` : '';
      const lines = ledgerLines(a);
      body = `<div class="warn-card">${I.warn}<div><b>Nunca introduzcas tus 24 palabras</b>Aquí solo se usan direcciones públicas o xpub (solo lectura). Ninguna web o app legítima te pedirá la frase de recuperación de tu Ledger.</div></div>
        <div class="section-title"><span>Activos</span></div>
        <div class="list">${lines.length ? lines.map(({ e, price, value }) => { const c = P.COINS[e.coin]; return `
          <div class="item" data-act="edit-entry" data-id="${e.id}" role="button" tabindex="0">
            <div class="coin" style="--c:${c.color}">${c.icon}</div>
            <div class="body"><div class="txt">${esc(e.label || c.name)} <small class="tag">${e.kind === 'xpub' ? esc(e.value.slice(0, 4)) : e.kind === 'manual' ? 'manual' : c.sym}</small></div>
              <div class="sub mono">${e.kind === 'manual' ? 'Cantidad introducida a mano' : esc(e.value.slice(0, 10) + '…' + e.value.slice(-6))}</div>
              ${e.error ? `<div class="sub err">⚠︎ ${esc(e.error)}</div>` : ''}</div>
            <div class="amt"><b>${eur(value)}</b><small>${num(e.amount, 8)} ${c.sym}</small>${price ? `<small class="px">1 ${c.sym} = ${eur(price, true)}</small>` : ''}</div>
          </div>`; }).join('') : `<div class="empty"><span class="big">🔐</span><b>Añade tus direcciones públicas</b>En Ledger Live: Cuenta → Recibir → copia la dirección. También puedes usar la xpub (Cuenta → ⋯ → Editar cuenta → Avanzado).</div>`}</div>
        <button class="btn primary wide" data-act="add-entry">${I.plus} Añadir dirección o activo</button>
        ${lines.length ? `<p class="note">Precios: ${esc([...new Set(a.entries.map((e) => S.prices[e.coin] && S.prices[e.coin].src).filter(Boolean))].join(', ') || '—')}. Saldos: mempool.space / blockchain.info (BTC), PublicNode (ETH, SOL). Solo se consultan direcciones; la xpub se procesa en el móvil.</p>` : ''}`;
    } else if (a.type === 'degiro') {
      extra = `<button class="chip-btn" data-act="degiro-csv">${I.file} Importar CSV</button><button class="chip-btn" data-act="manual-balance" data-id="${a.id}">✏️ Manual</button>`;
      const pos = a.positions || [];
      body = `<div class="info-card">🔑 Esta app <b>nunca</b> te pedirá tu usuario ni contraseña de DEGIRO. Para actualizar: en la app o web de DEGIRO ve a <b>Cartera → Exportar → CSV</b> e impórtalo aquí.</div>
        <div class="seg"><button class="${a.source === 'csv' ? 'on' : ''}" data-act="degiro-source" data-s="csv" ${a.csvTotal == null ? 'disabled' : ''}>Cartera CSV<small>${a.csvTotal == null ? 'sin importar' : eur(a.csvTotal)}</small></button><button class="${a.source === 'manual' ? 'on' : ''}" data-act="degiro-source" data-s="manual" ${a.manual == null ? 'disabled' : ''}>Saldo manual<small>${a.manual == null ? 'sin introducir' : eur(a.manual)}</small></button></div>
        ${pos.length ? `<div class="section-title"><span>Posiciones (${esc(a.csvName || 'CSV')})</span><span class="muted-small">${a.csvAt ? esc(dtFmt.format(a.csvAt)) : ''}</span></div>
        <div class="list">${pos.slice().sort((x, y) => y.eur - x.eur).map((p) => `
          <div class="item"><div class="coin sq" style="--c:${p.cash ? '#10b981' : '#2563eb'}">${p.cash ? '€' : esc((p.product.match(/[A-Za-z0-9]/) || ['?'])[0].toUpperCase())}</div>
            <div class="body"><div class="txt">${esc(p.product)}</div><div class="sub wrap">${esc([p.symbol, p.qty != null ? num(p.qty, 4) + ' uds' : '', p.price != null ? '× ' + num(p.price, 4) + ' ' + (p.cur || '') : ''].filter(Boolean).join(' · '))}</div></div>
            <div class="amt"><b>${eur(p.eur)}</b>${p.cur && p.cur !== 'EUR' && p.local != null ? `<small>${num(p.local, 2)} ${esc(p.cur)}</small>` : ''}</div></div>`).join('')}
          <div class="item total-row"><div class="body"><div class="txt"><b>Total cartera</b></div></div><div class="amt"><b>${eur(a.csvTotal)}</b></div></div></div>` : `<div class="empty"><span class="big">📄</span><b>Importa tu cartera</b>Formato: Portfolio.csv exportado desde DEGIRO (columnas Producto, Symbol/ISIN, Cantidad, Precio de cierre, Valor local, Valor en EUR).</div>`}
        <input type="file" id="degiro-file" accept=".csv,text/csv,text/plain" hidden>`;
    } else if (a.type === 'mapfre') {
      body = `<div class="info-card">🔑 Esta app <b>nunca</b> te pedirá tus credenciales de Mapfre. Consulta el saldo en el área de clientes y actualízalo aquí.</div>
        <div class="section-title"><span>Productos</span></div>
        <div class="list">${a.products.length ? a.products.map((p) => `
          <div class="item" data-act="edit-product" data-id="${p.id}" role="button" tabindex="0"><div class="coin sq" style="--c:#e11d48">🛡️</div>
            <div class="body"><div class="txt">${esc(p.name)}</div><div class="sub">Actualizado ${esc(ago(p.updated))}</div></div>
            <div class="amt"><b>${eur(p.amount)}</b></div></div>`).join('') : `<div class="empty"><span class="big">🛡️</span><b>Añade tus productos</b>Por ejemplo: plan de pensiones, seguro de ahorro, PIAS…</div>`}</div>
        <button class="btn primary wide" data-act="add-product">${I.plus} Añadir producto</button>
        ${a.history.length ? `<div class="section-title"><span>Historial</span></div><div class="list compact">${a.history.slice(-40).reverse().map((h) => `
          <div class="item hist"><div class="body"><div class="txt">${esc(h.name)}</div><div class="sub">${esc(dtFmt.format(h.t))}</div></div><div class="amt"><b>${eur(h.amount)}</b>${h.delta != null ? `<small class="${h.delta >= 0 ? 'pos' : 'neg'}">${signedEur(h.delta)}</small>` : '<small>alta</small>'}</div></div>`).join('')}</div>` : ''}`;
    } else if (a.type === 'horos') {
      extra = a.funds.length ? `<button class="chip-btn ${refreshing ? 'spinning' : ''}" data-act="refresh">${I.refresh} Actualizar VL</button>` : '';
      body = `<div class="info-card">🔑 Esta app <b>nunca</b> te pedirá tus credenciales de Horos. Solo necesitas el número de participaciones (lo ves en tu extracto o en la app de Horos). El valor liquidativo se descarga de la web pública de Horos.</div>
        <div class="section-title"><span>Fondos y planes</span></div>
        <div class="list">${a.funds.length ? a.funds.map((f) => { const d = P.HOROS_FUNDS.find((x) => x.key === f.key) || { name: f.key, isin: '' }; const nav = horosNavOf(f); return `
          <div class="item fund" data-act="edit-fund" data-key="${f.key}" role="button" tabindex="0"><div class="coin sq" style="--c:#9f1239">🦉</div>
            <div class="body"><div class="txt">${esc(d.name)}</div><div class="sub">${esc(d.isin)}${d.isin ? ' · ' : ''}${f.units != null ? num(f.units, 6) + ' part.' : 'sin participaciones'}</div>
              <div class="sub wrap">${nav != null ? `VL ${hidden() ? '••••' : numFmt(4).format(nav) + ' €'} a ${esc(ymdToEs(f.navDate))} <small class="tag">${f.navSrc === 'manual' ? 'manual' : 'auto'}</small>` : 'VL pendiente'}</div>
              ${f.error ? `<div class="sub err">⚠︎ ${esc(f.error)}</div>` : ''}</div>
            <div class="amt"><b>${eur(f.units != null && nav != null ? f.units * nav : null)}</b></div></div>`; }).join('') : `<div class="empty"><span class="big">🦉</span><b>Añade tus fondos de Horos</b>Indica cuántas participaciones tienes y la app calculará el valor con el último VL publicado.</div>`}</div>
        <button class="btn primary wide" data-act="add-fund">${I.plus} Añadir fondo o plan</button>
        <p class="note">Fuente del VL: horosam.com (JSON público que usa su propia web). Si falla, puedes introducir el VL a mano desde la ficha de cada fondo.</p>`;
    } else if (a.type === 'terreno') {
      return renderTerreno(a);
    } else {
      extra = `<button class="chip-btn" data-act="manual-balance" data-id="${esc(a.id)}">✏️ Actualizar saldo</button>`;
      const h = a.history || [];
      body = `<div class="section-title"><span>Historial de saldo</span></div>
        <div class="list compact">${h.length ? h.slice(-40).reverse().map((x, i, arr) => { const prev = arr[i + 1]; const dd = prev ? x.amount - prev.amount : null; return `
          <div class="item hist"><div class="body"><div class="txt">${esc(dtFmt.format(x.t))}</div></div><div class="amt"><b>${eur(x.amount)}</b>${dd != null ? `<small class="${dd >= 0 ? 'pos' : 'neg'}">${signedEur(dd)}</small>` : ''}</div></div>`; }).join('') : `<div class="empty"><span class="big">${esc(a.emoji)}</span><b>Sin saldo todavía</b>Pulsa «Actualizar saldo» para introducirlo.</div>`}</div>`;
    }
    app.innerHTML = `<main class="view detail">${heroFor(a, extra)}${body}</main>`;
  }

  function renderTerreno(a) {
    const t = terrInfo(a); const pl = a.plot || {}; const p = a.plan || {}; const st = a.statement;
    const extra = `<button class="chip-btn" data-act="terr-pay">${I.plus} Pago</button><button class="chip-btn" data-act="terr-doc-add">📎 Documento</button><button class="chip-btn" data-act="terr-stmt">✏️ Saldo</button>`;
    const kv = (k, v) => v == null || v === '' ? '' : `<div class="kv"><span>${esc(k)}</span><b>${esc(v)}</b></div>`;
    const stOk = st && st.balance != null && t.pending != null ? Math.abs(st.balance - t.pending) < 1 : null;
    const body = `
      <section class="terr-card">
        <div class="terr-row"><div><small>Pagado</small><b>${mxn(t.paid)}</b></div><div class="r"><small>Precio total</small><b>${mxn(t.price)}</b></div></div>
        <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${t.pctPaid.toFixed(1)}"><i style="width:${t.pctPaid.toFixed(2)}%"></i></div>
        <div class="terr-row"><span class="pctb">${hidden() ? '••' : numFmt(1).format(t.pctPaid)} % pagado</span><span>Pendiente <b>${mxn(t.pending)}</b></span></div>
        ${t.remInst != null ? `<p class="terr-hint">≈ ${t.remInst} mensualidades de ${mxn(p.installment)} por pagar${p.lastDue ? ' · última prevista ' + esc(ymdToEs(p.lastDue)) : ''}</p>` : ''}
      </section>
      ${t.next ? `<section class="terr-card next"><div class="terr-row"><div><small>Próximo pago según calendario</small><b>${esc(ymdToEs(t.next.date) || '—')}</b><span class="terr-hint">${esc(t.next.label)}${t.next.covered ? ` · llevas ${t.next.covered} mensualidades cubiertas` : ''}</span></div><div class="r"><small>Importe</small><b>${mxn(t.next.amount)}</b></div></div></section>` : t.price != null && t.pending <= 0.005 ? '<section class="terr-card next"><b>🎉 Terreno pagado por completo</b></section>' : ''}
      ${st ? `<div class="info-card">🧾 <b>Último estado de cuenta (${esc(ymdToEs(st.date))})</b>: total pagado ${mxn(st.paid)} · saldo ${mxn(st.balance)}${st.overdue != null ? ' · vencido ' + mxn(st.overdue) : ''}. ${stOk === true ? '✅ Coincide con tus pagos registrados.' : stOk === false ? '⚠️ No coincide con la suma de pagos registrados: revisa.' : ''}</div>` : ''}
      <div class="section-title"><span>Pagos (${t.rows.length})</span><span class="muted-small">saldo tras cada pago</span></div>
      <div class="list compact">${t.rows.length ? t.rows.slice().reverse().map((x) => `
        <div class="item hist" data-act="terr-pay-edit" data-id="${esc(x.id)}" role="button" tabindex="0"><div class="body"><div class="txt">${esc(ymdToEs(x.date))}</div><div class="sub">${esc([x.concept, x.method, x.folio ? 'folio ' + x.folio : ''].filter(Boolean).join(' · '))}</div></div>
          <div class="amt"><b>${mxn(x.amount)}</b><small>${x.after != null ? 'queda ' + mxn(x.after) : ''}</small></div></div>`).join('') : '<div class="empty"><span class="big">🌴</span><b>Sin pagos todavía</b>Pulsa «Pago» para añadir uno o abre el enlace de importación.</div>'}
        ${t.rows.length ? `<div class="item total-row"><div class="body"><div class="txt"><b>Total pagado</b></div></div><div class="amt"><b>${mxn(t.paid)}</b></div></div>` : ''}</div>
      <button class="btn primary wide" data-act="terr-pay">${I.plus} Añadir pago</button>
      <div class="section-title"><span>Documentos</span><span class="muted-small">cifrados en el móvil</span></div>
      <div class="list compact">${(a.docs || []).length ? a.docs.map((d) => `
        <div class="item" data-act="terr-doc" data-id="${esc(d.id)}" role="button" tabindex="0"><div class="coin sq" style="--c:#047857">${/pdf/i.test(d.mime) ? '📄' : '🖼️'}</div>
          <div class="body"><div class="txt">${esc(d.label || d.name)}</div><div class="sub">${esc(d.name)} · ${(d.size / 1048576).toFixed(1).replace('.', ',')} MB · ${esc(dateStr(d.added))}</div></div>
          <div class="amt"><button class="open-app" data-act="terr-doc-open" data-id="${esc(d.id)}">Abrir ${I.ext}</button></div></div>`).join('') : '<div class="empty"><span class="big">📎</span><b>Adjunta el contrato y los estados de cuenta</b>Se guardan cifrados solo en este móvil.</div>'}</div>
      <button class="btn wide" data-act="terr-doc-add">📎 Adjuntar documento (PDF o foto)</button>
      <input type="file" id="terr-file" accept="application/pdf,image/*" hidden>
      <div class="section-title"><span>El terreno</span></div>
      <section class="terr-card kvs">${kv('Desarrollo', pl.development)}${kv('Unidad / lote interno', pl.unit)}${kv('Lote', pl.lot)}${kv('Tablaje', pl.tablaje)}${kv('Subcondominio', pl.subcondo)}${kv('Ubicación', pl.location)}${kv('Superficie', pl.area)}${kv('Medidas', pl.dims)}${kv('Precio de lista', a.listPrice != null ? mxn(a.listPrice) : '')}${kv('Descuento', a.discount != null ? mxn(a.discount) + (p.discountPct ? ' (' + p.discountPct + ')' : '') : '')}${kv('Precio final', a.price != null ? mxn(a.price) : '')}${kv('Enganche', p.downPayment != null ? mxn(p.downPayment) : '')}${kv('Financiado', p.financed != null ? mxn(p.financed) : '')}${kv('Mensualidad', p.installment != null ? mxn(p.installment) + (p.nInstallments ? ' × ' + p.nInstallments : '') : '')}${kv('Día de pago', p.firstDue ? 'el ' + Number(p.firstDue.slice(8)) + ' de cada mes (desde ' + ymdToEs(p.firstDue) + ')' : '')}${kv('Escrituración', pl.deedDate)}${kv('Contrato firmado', pl.signed)}${kv('Vendedor', pl.seller)}</section>
      ${(a.terms || []).length ? `<div class="section-title"><span>Condiciones clave del contrato</span></div><section class="terr-card"><ul class="terms">${a.terms.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></section>` : ''}
      <p class="note">Este terreno está en pesos mexicanos y no se suma al patrimonio total en euros. Los importes proceden de tus documentos; actualízalos con cada nuevo pago o estado de cuenta.</p>`;
    app.innerHTML = `<main class="view detail">${heroFor(a, extra, mxn(t.pending), 'Pendiente de pago')}${body}</main>`;
  }

  async function openDoc(id, share) {
    const a = S.accounts.find((x) => x.type === 'terreno'); const d = a && a.docs.find((x) => x.id === id); if (!d) return;
    try {
      const bytes = await Vault.readDoc(id); if (!bytes) return toast('Documento no encontrado en este dispositivo');
      const file = new File([bytes], d.name, { type: d.mime || 'application/octet-stream' });
      if (share && navigator.canShare && navigator.canShare({ files: [file] })) return navigator.share({ files: [file], title: d.label || d.name }).catch(() => {});
      const u = URL.createObjectURL(file);
      const w = window.open(u, '_blank');
      if (!w) { const el = document.createElement('a'); el.href = u; el.download = d.name; document.body.appendChild(el); el.click(); el.remove(); }
      setTimeout(() => URL.revokeObjectURL(u), 120000);
    } catch (e) { toast('No se pudo abrir: ' + e.message); }
  }

  // ---------- Enlace de importación del terreno (#importar-terreno=<base64url JSON>) ----------
  // El fragmento nunca llega al servidor; se procesa solo tras desbloquear y se borra de la barra de direcciones.
  let pendingTerr = null;
  function captureTerrLink() {
    const m = location.hash.match(/^#importar-terreno=([\w-]+)/); if (!m) return false;
    pendingTerr = m[1]; history.replaceState(null, '', location.pathname + location.search + (S ? '#/' : '')); return true;
  }
  function decodeTerr(s) {
    const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(b, (c) => c.charCodeAt(0))));
  }
  function maybeTerrImport() {
    if (!pendingTerr || !S) return;
    let d; try { d = decodeTerr(pendingTerr); } catch (_) { pendingTerr = null; return toast('El enlace de importación no es válido'); }
    if (!d || d.kind !== 'terreno') { pendingTerr = null; return toast('El enlace de importación no es válido'); }
    pendingTerrData = d; pendingTerr = null;
    openSheet(`<h3>Importar terreno</h3><p class="note">${esc((d.plot && d.plot.development) || 'Terreno')} · unidad ${esc((d.plot && d.plot.unit) || '')}: ${(d.payments || []).length} pagos, precio ${esc(mxn(d.price, true))}${d.statement ? ', estado de cuenta del ' + esc(ymdToEs(d.statement.date)) : ''}. Se sustituirán los datos del terreno (los documentos adjuntos se conservan).</p>
      <div class="sheet-actions"><button class="btn" data-act="close-sheet">Cancelar</button><button class="btn primary" data-act="terr-import-ok">Importar</button></div>`);
  }
  let pendingTerrData = null;

  // =====================================================================
  //  ACTUALIZACIÓN AUTOMÁTICA (Ledger + Horos)
  // =====================================================================
  async function refreshLedger(a) {
    const coins = [...new Set(a.entries.map((e) => e.coin))];
    const tasks = a.entries.filter((e) => e.kind !== 'manual').map(async (e) => {
      try {
        let r;
        if (e.kind === 'xpub') r = await P.btcExtKey(e.value, e.scriptType);
        else if (e.coin === 'btc') r = await P.btcAddress(e.value);
        else if (e.coin === 'eth') r = await P.ethAddress(e.value);
        else if (e.coin === 'sol') r = await P.solAddress(e.value);
        e.amount = r.amount; e.updated = Date.now(); e.error = null; return true;
      } catch (err) { e.error = 'No se pudo consultar (' + (err.name === 'AbortError' ? 'tiempo agotado' : err.message) + ')'; return false; }
    });
    let priceOk = false;
    const fresh = coins.every((c) => S.prices[c] && Date.now() - S.prices[c].t < 60000);
    const pr = coins.length && !fresh ? P.prices(coins).then((p) => { const t = Date.now(); for (const [k, v] of Object.entries(p)) S.prices[k] = { ...v, t }; priceOk = true; }).catch(() => {}) : Promise.resolve();
    const res = await Promise.all(tasks); await pr;
    if (res.some(Boolean) || priceOk) a.updated = Date.now();
    return { ok: res.filter(Boolean).length, fail: res.filter((x) => !x).length, priceOk: priceOk || fresh || !coins.length };
  }
  async function refreshHoros(a) {
    let ok = 0, fail = 0;
    await Promise.all(a.funds.map(async (f) => {
      const d = P.HOROS_FUNDS.find((x) => x.key === f.key); if (!d) return;
      try {
        const r = await P.horosNav(d);
        if (!f.navDate || r.date >= f.navDate || f.navSrc !== 'manual') { f.nav = r.nav; f.navDate = r.date; f.navSrc = 'auto'; }
        f.error = null; ok++;
      } catch (e) { f.error = 'VL no disponible: introdúcelo a mano'; fail++; }
    }));
    if (ok) a.updated = Date.now();
    return { ok, fail };
  }
  async function refreshAll(silent) {
    if (refreshing || !S) return;
    refreshing = true; render();
    let ok = 0, fail = 0, priceFail = false;
    try {
      await Promise.all(S.accounts.map(async (a) => {
        if (a.type === 'ledger' && a.entries.length) { const r = await refreshLedger(a); ok += r.ok; fail += r.fail; if (!r.priceOk) priceFail = true; }
        if (a.type === 'horos' && a.funds.length) { const r = await refreshHoros(a); ok += r.ok; fail += r.fail; }
      }));
      if (!S) return;
      S.lastRefresh = Date.now();
      recordSnapshot(); await persist();
    } finally { refreshing = false; }
    if (!S) return;
    render();
    if (!silent || fail || priceFail) toast(fail || priceFail ? `Actualizado con avisos: ${fail} fallo${fail === 1 ? '' : 's'}${priceFail ? ', sin precios' : ''}` : (ok ? 'Saldos actualizados' : 'Nada que actualizar automáticamente'));
  }

  // =====================================================================
  //  HOJAS / FORMULARIOS
  // =====================================================================
  const SEED_RE = /^\s*([a-zA-Z]{3,8}\s+){11,}[a-zA-Z]{3,8}\s*$/;
  const PRIV_RE = /^([xyzt]prv|[5KL][1-9A-HJ-NP-Za-km-z]{50,51}$|(0x)?[0-9a-fA-F]{64}$)/;
  function dangerCheck(v) {
    if (SEED_RE.test(v)) return '⛔ Eso parece una frase de recuperación (semilla). NUNCA la escribas en ninguna app ni web. Si la has compartido, mueve tus fondos a una cartera nueva.';
    if (PRIV_RE.test(v.trim())) return '⛔ Eso parece una clave PRIVADA. Esta app solo necesita direcciones públicas o xpub.';
    return '';
  }

  function entrySheet(a, e) {
    const isNew = !e; e = e || { coin: 'btc', kind: 'address', value: '', label: '', scriptType: 'p2wpkh' };
    const kind = e.kind === 'xpub' ? 'xpub' : e.kind === 'manual' ? 'manual' : e.coin;
    return openSheet(`<h3>${isNew ? 'Añadir activo' : 'Editar activo'}</h3>
      <div class="warn-card small">${I.warn}<div><b>Solo datos públicos.</b> Nunca escribas tus 24 palabras ni claves privadas. Una dirección pública o xpub solo permite <u>ver</u> saldos, nunca mover fondos.</div></div>
      <form data-form="entry" data-acc="${a.id}" data-id="${e.id || ''}">
        <label class="lbl">Tipo</label>
        <div class="type-grid">
          ${[['btc', '₿ Bitcoin', 'Dirección 1…, 3…, bc1…'], ['xpub', '₿ Bitcoin xpub', 'xpub / ypub / zpub'], ['eth', 'Ξ Ethereum', 'Dirección 0x… (solo ETH)'], ['sol', '◎ Solana', 'Dirección pública'], ['manual', '🪙 Otra cripto', 'Cantidad a mano']]
            .map(([k, t, s]) => `<button type="button" class="${kind === k ? 'on' : ''}" data-act="entry-kind" data-k="${k}"><b>${t}</b><small>${s}</small></button>`).join('')}
        </div>
        <input type="hidden" name="kind" value="${kind}">
        <div class="f-addr"><label class="lbl" for="e-val">Dirección pública</label>
          <textarea class="field mono small" id="e-val" name="value" rows="2" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="bc1q…">${esc(e.kind !== 'manual' ? e.value : '')}</textarea></div>
        <div class="f-script"><label class="lbl" for="e-st">Tipo de direcciones</label>
          <select class="field" id="e-st" name="scriptType">
            ${[['p2wpkh', 'Native SegWit (bc1q…) · Ledger Live'], ['p2tr', 'Taproot (bc1p…)'], ['p2sh-p2wpkh', 'SegWit anidada (3…)'], ['p2pkh', 'Legacy (1…)']].map(([v, t]) => `<option value="${v}" ${e.scriptType === v ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
          <p class="hint">Ledger Live muestra la clave como «xpub» incluso en cuentas Native SegWit: elige aquí el tipo de la cuenta. Las direcciones se derivan en tu móvil (la xpub no se envía a ningún servidor) y se escanean recepción y cambio con margen de 20.</p></div>
        <div class="f-manual"><label class="lbl" for="e-coin">Criptomoneda</label>
          <select class="field" id="e-coin" name="coin">${Object.entries(P.COINS).map(([k, c]) => `<option value="${k}" ${e.coin === k ? 'selected' : ''}>${c.name} (${c.sym})</option>`).join('')}</select>
          <label class="lbl" for="e-amt">Cantidad</label>
          <input class="field" id="e-amt" name="amount" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${e.kind === 'manual' && e.amount != null ? String(e.amount).replace('.', ',') : ''}"></div>
        <label class="lbl" for="e-label">Nombre (opcional)</label>
        <input class="field" id="e-label" name="label" maxlength="40" placeholder="Ej. Ahorro BTC" value="${esc(e.label)}">
        <p class="lock-err form-err" role="alert"></p>
        <div class="sheet-actions">${isNew ? '<button type="button" class="btn" data-act="close-sheet">Cancelar</button>' : `<button type="button" class="btn danger-soft" data-act="del-entry" data-acc="${a.id}" data-id="${e.id}">Eliminar</button>`}<button class="btn primary">${isNew ? 'Añadir' : 'Guardar'}</button></div>
      </form>`, (sh) => updateEntryKind(sh, kind));
  }
  function updateEntryKind(sh, k) {
    sh.querySelector('[name=kind]').value = k;
    $$('[data-act=entry-kind]', sh).forEach((b) => b.classList.toggle('on', b.dataset.k === k));
    sh.querySelector('.f-addr').classList.toggle('hidden', k === 'manual');
    sh.querySelector('.f-script').classList.toggle('hidden', k !== 'xpub');
    sh.querySelector('.f-manual').classList.toggle('hidden', k !== 'manual');
    const ta = sh.querySelector('[name=value]');
    ta.placeholder = { btc: 'bc1q… / 3… / 1…', xpub: 'xpub… / ypub… / zpub…', eth: '0x…', sol: 'Dirección Solana' }[k] || '';
    sh.querySelector('label[for=e-val]').textContent = k === 'xpub' ? 'Clave pública extendida (xpub)' : 'Dirección pública';
  }

  function amountSheet({ title, label = 'Saldo (€)', value, form, data = {}, extraHTML = '', danger = '' }) {
    openSheet(`<h3>${esc(title)}</h3><form data-form="${form}" ${Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')}>
      ${extraHTML}
      <label class="lbl" for="amt">${esc(label)}</label>
      <input class="field big-num" id="amt" name="amount" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${value != null ? esc(numFmt(2).format(value)) : ''}" ${extraHTML ? '' : 'autofocus'}>
      <p class="lock-err form-err" role="alert"></p>
      <div class="sheet-actions">${danger || '<button type="button" class="btn" data-act="close-sheet">Cancelar</button>'}<button class="btn primary">Guardar</button></div></form>`);
  }

  function accountFormHTML(a) {
    a = a || { name: '', emoji: '💶', color: 'violeta', link: '', balance: null };
    return `<label class="lbl" for="ac-name">Nombre</label><input class="field" id="ac-name" name="name" maxlength="30" required value="${esc(a.name)}" placeholder="Ej. Cuenta nómina">
      <label class="lbl">Emoji</label><div class="emoji-grid">${EMOJIS.concat(EMOJIS.includes(a.emoji) ? [] : [a.emoji]).map((e) => `<button type="button" class="${e === a.emoji ? 'on' : ''}" data-act="pick-emoji" data-v="${esc(e)}">${esc(e)}</button>`).join('')}</div>
      <input type="hidden" name="emoji" value="${esc(a.emoji)}">
      <label class="lbl">Color</label><div class="color-grid">${Object.entries(COLORS).map(([k, [c1, c2]]) => `<button type="button" aria-label="${k}" class="${k === a.color ? 'on' : ''}" style="background:linear-gradient(135deg,${c1},${c2})" data-act="pick-color" data-v="${k}"></button>`).join('')}</div>
      <input type="hidden" name="color" value="${esc(a.color)}">
      <label class="lbl" for="ac-link">Enlace a la app o web (opcional)</label><input class="field" id="ac-link" name="link" inputmode="url" autocapitalize="off" value="${esc(a.link || '')}" placeholder="https://…">`;
  }

  // ---------- Ajustes ----------
  async function settingsSheet() {
    const bioAvail = await Vault.bioAvailable();
    const bio = Vault.meta && Vault.meta.bio;
    openSheet(`<h3>Ajustes</h3>
      <div class="menu-list">
        <div class="menu-sec">Seguridad</div>
        <button data-act="lock-now"><span class="mi">🔒</span>Bloquear ahora</button>
        <button data-act="change-secret"><span class="mi">🔢</span>Cambiar ${Vault.meta.secretType === 'password' ? 'contraseña' : 'PIN'}</button>
        <button data-act="toggle-bio" ${bioAvail || bio ? '' : 'disabled'}><span class="mi">👆</span><span class="grow">Huella / Face ID<small>${!bioAvail && !bio ? 'No disponible en este navegador' : bio ? (bio.mode === 'prf' ? 'Activada · clave derivada del autenticador (PRF)' : 'Activada · modo comodidad (clave del dispositivo)') : 'Desactivada'}</small></span><span class="switch ${bio ? 'on' : ''}"></span></button>
        <div class="menu-sec">Copias de seguridad</div>
        <button data-act="export"><span class="mi">📤</span><span class="grow">Exportar copia cifrada<small>Archivo protegido con contraseña</small></span></button>
        <button data-act="import"><span class="mi">📥</span><span class="grow">Importar copia<small>Sustituye los datos actuales</small></span></button>
        <input type="file" id="import-file" accept=".json,application/json" hidden>
        <div class="menu-sec">Datos</div>
        <button data-act="security-info"><span class="mi">ℹ️</span>Cómo se protegen tus datos</button>
        <button class="danger" data-act="wipe"><span class="mi">🗑️</span>Borrar todos los datos</button>
      </div>
      <p class="note center">Mis Saldos v${APP_VERSION} · sin servidores · sin rastreo</p>`);
  }

  function secretFields(prefix, label, type) {
    const isPin = type === 'pin';
    return `<label class="lbl" for="${prefix}">${label}</label><input class="field" id="${prefix}" name="${prefix}" type="password" ${isPin ? `inputmode="numeric" pattern="[0-9]*" maxlength="${PIN_LEN}"` : ''} autocomplete="off" required>`;
  }

  function download(name, text) {
    const blob = new Blob([text], { type: 'application/json' });
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
      return navigator.share({ files: [file], title: 'Copia de Mis Saldos' }).catch(() => {});
    }
    const u = URL.createObjectURL(blob); const aEl = document.createElement('a'); aEl.href = u; aEl.download = name; document.body.appendChild(aEl); aEl.click(); aEl.remove();
    setTimeout(() => URL.revokeObjectURL(u), 5000);
  }

  function openApp(a) {
    const b = BUILTIN[a.type];
    if (/^ledgerlive:/.test(a.link)) {
      let left = false; const onHide = () => { left = true; };
      document.addEventListener('visibilitychange', onHide, { once: true });
      location.href = a.link;
      setTimeout(() => { document.removeEventListener('visibilitychange', onHide); if (!left && !document.hidden) window.open((b && b.fallback) || 'https://www.ledger.com/ledger-live', '_blank', 'noopener'); }, 1600);
      return;
    }
    if (!/^https?:\/\//i.test(a.link)) return toast('Enlace no válido');
    window.open(a.link, '_blank', 'noopener');
  }

  function fundSheet(key, isNew) {
    const a = acc('horos'); const d = P.HOROS_FUNDS.find((f) => f.key === key);
    const f = a.funds.find((x) => x.key === key) || { key, units: null, nav: null, navDate: null };
    openSheet(`<h3>${esc(d.name)}</h3><p class="note">${esc(d.kind)}${d.isin ? ' · ' + esc(d.isin) : ''}</p>
      <form data-form="fund" data-key="${key}" data-new="${isNew ? 1 : 0}">
        <label class="lbl" for="f-units">Número de participaciones</label>
        <input class="field big-num" id="f-units" name="units" inputmode="decimal" autocomplete="off" placeholder="0,000000" value="${f.units != null ? String(f.units).replace('.', ',') : ''}" autofocus>
        <label class="lbl" for="f-nav">Valor liquidativo manual (€) · opcional</label>
        <input class="field" id="f-nav" name="nav" inputmode="decimal" autocomplete="off" placeholder="${f.nav != null ? 'Actual: ' + String(f.nav.toFixed(4)).replace('.', ',') + ' (' + ymdToEs(f.navDate) + ')' : 'Vacío = automático'}">
        <p class="hint">El VL se descarga automáticamente de horosam.com. Si no está disponible, consúltalo en <a href="${esc(d.url)}" target="_blank" rel="noopener">la ficha del fondo</a> y escríbelo aquí.</p>
        <p class="lock-err form-err"></p>
        <div class="sheet-actions">${isNew ? '<button type="button" class="btn" data-act="close-sheet">Cancelar</button>' : `<button type="button" class="btn danger-soft" data-act="del-fund" data-key="${key}">Quitar</button>`}<button class="btn primary">Guardar</button></div>
      </form>`);
  }

  // =====================================================================
  //  ACCIONES (delegación de eventos)
  // =====================================================================
  const A = {
    'setup-start': () => { lockState.step = 'pin'; renderLock(); },
    'toggle-pw': () => { if (lockState.mode !== 'setup') return; lockState.usePassword = !lockState.usePassword; lockState.step = 'pin'; lockState.buf = ''; lockState.first = ''; renderLock(); },
    'pin-key': (el) => {
      const L = lockState; if (L.busy || L.buf.length >= PIN_LEN) return;
      if (L.mode === 'unlock' && Vault.lockoutRemaining() > 0) return renderLock();
      L.buf += el.dataset.k; if (navigator.vibrate) navigator.vibrate(8);
      renderLock();
      if (L.buf.length === PIN_LEN) { const s = L.buf; setTimeout(() => submitSecret(s), 120); }
    },
    'pin-del': () => { lockState.buf = lockState.buf.slice(0, -1); renderLock(); },
    'bio-unlock': () => bioUnlock(false),
    'setup-bio': async () => {
      try { const mode = await Vault.enableBio(lockState.secretTmp); lockState.secretTmp = null; enterApp(false); toast(mode === 'prf' ? 'Biometría activada (clave PRF)' : 'Biometría activada (modo comodidad)'); }
      catch (e) { renderLock(e.name === 'NotAllowedError' ? 'Cancelado.' : 'No se pudo activar: ' + e.message); }
    },
    'setup-done': () => enterApp(false),
    'toggle-hide': async () => { S.settings.hide = !S.settings.hide; await persist(); render(); },
    refresh: () => refreshAll(false),
    settings: () => settingsSheet(),
    range: async (el) => { S.settings.range = el.dataset.r; await persist(); render(); },
    'open-acc': (el, ev) => { if (ev.target.closest('[data-act=open-app]')) return; location.hash = '#/cuenta/' + el.dataset.id; },
    'open-app': (el, ev) => { ev.stopPropagation(); openApp(acc(el.dataset.id)); },
    back: () => { location.hash = '#/'; },
    'close-sheet': () => closeSheet(),
    'add-account': () => {
      const missing = Object.keys(BUILTIN).filter((k) => !acc(k));
      openSheet(`<h3>Añadir cuenta</h3><div class="menu-list">${missing.map((k) => `<button data-act="add-builtin" data-k="${k}"><span class="mi">${BUILTIN[k].emoji}</span><span class="grow">${BUILTIN[k].name}<small>${BUILTIN[k].sub}</small></span></button>`).join('')}
        <button data-act="add-custom"><span class="mi">✨</span><span class="grow">Cuenta personalizada<small>Banco, efectivo, inmueble… con saldo manual</small></span></button></div>`);
    },
    'add-builtin': async (el) => { S.accounts.push(newAccount(el.dataset.k)); closeSheet(); await persist(); render(); },
    'add-custom': () => openSheet(`<h3>Nueva cuenta</h3><form data-form="account">${accountFormHTML()}
      <label class="lbl" for="ac-bal">Saldo actual (€)</label><input class="field" id="ac-bal" name="balance" inputmode="decimal" placeholder="0,00">
      <p class="lock-err form-err"></p><div class="sheet-actions"><button type="button" class="btn" data-act="close-sheet">Cancelar</button><button class="btn primary">Crear</button></div></form>`),
    'pick-emoji': (el) => { const f = el.closest('form'); f.emoji.value = el.dataset.v; $$('[data-act=pick-emoji]', f).forEach((b) => b.classList.toggle('on', b === el)); },
    'pick-color': (el) => { const f = el.closest('form'); f.color.value = el.dataset.v; $$('[data-act=pick-color]', f).forEach((b) => b.classList.toggle('on', b === el)); },
    'edit-acc': (el) => { const a = acc(el.dataset.id); openSheet(`<h3>Editar cuenta</h3><form data-form="account" data-id="${esc(a.id)}">${accountFormHTML(a)}
      <p class="lock-err form-err"></p><div class="sheet-actions"><button type="button" class="btn danger-soft" data-act="del-acc" data-id="${esc(a.id)}">Eliminar</button><button class="btn primary">Guardar</button></div></form>`); },
    'del-acc': (el) => { const a = acc(el.dataset.id); openSheet(`<h3>¿Eliminar «${esc(a.name)}»?</h3><p class="note">Se borrarán sus datos de este dispositivo. El historial del total se conserva.</p>
      <div class="sheet-actions"><button class="btn" data-act="close-sheet">Cancelar</button><button class="btn danger" data-act="del-acc-ok" data-id="${esc(a.id)}">Eliminar</button></div>`); },
    'del-acc-ok': async (el) => { S.accounts = S.accounts.filter((a) => a.id !== el.dataset.id); closeSheet(true); location.hash = '#/'; await changed(); },
    'manual-balance': (el) => { const a = acc(el.dataset.id); amountSheet({ title: a.type === 'degiro' ? 'Saldo total de DEGIRO' : 'Actualizar saldo', value: a.type === 'degiro' ? a.manual : a.balance, form: 'manual-balance', data: { id: a.id } }); },
    // Ledger
    'add-entry': () => entrySheet(S.accounts.find((a) => a.type === 'ledger')),
    'edit-entry': (el) => { const a = S.accounts.find((x) => x.type === 'ledger'); entrySheet(a, a.entries.find((e) => e.id === el.dataset.id)); },
    'entry-kind': (el) => updateEntryKind(el.closest('.sheet'), el.dataset.k),
    'del-entry': async (el) => { const a = acc(el.dataset.acc); a.entries = a.entries.filter((e) => e.id !== el.dataset.id); closeSheet(); await changed(); },
    // DEGIRO
    'degiro-csv': () => { const inp = $('#degiro-file'); inp.value = ''; inp.click(); },
    'degiro-source': async (el) => { const a = acc('degiro'); a.source = el.dataset.s; a.updated = Date.now(); await changed(); },
    // Mapfre
    'add-product': () => amountSheet({ title: 'Nuevo producto Mapfre', form: 'product', label: 'Saldo actual (€)', extraHTML: `<label class="lbl" for="p-name">Nombre del producto</label><input class="field" id="p-name" name="name" maxlength="40" required placeholder="Ej. Plan de pensiones" autofocus>` }),
    'edit-product': (el) => { const a = acc('mapfre'); const p = a.products.find((x) => x.id === el.dataset.id); amountSheet({ title: p.name, form: 'product', data: { id: p.id }, value: p.amount, label: 'Saldo actual (€)', extraHTML: `<label class="lbl" for="p-name">Nombre</label><input class="field" id="p-name" name="name" maxlength="40" required value="${esc(p.name)}">`, danger: `<button type="button" class="btn danger-soft" data-act="del-product" data-id="${p.id}">Eliminar</button>` }); },
    'del-product': async (el) => { const a = acc('mapfre'); a.products = a.products.filter((p) => p.id !== el.dataset.id); a.updated = Date.now(); closeSheet(); await changed(); },
    // Horos
    'add-fund': () => { const a = acc('horos'); const avail = P.HOROS_FUNDS.filter((f) => !a.funds.some((x) => x.key === f.key));
      openSheet(`<h3>Añadir fondo o plan</h3><div class="menu-list">${avail.map((f) => `<button data-act="pick-fund" data-key="${f.key}"><span class="mi">🦉</span><span class="grow">${esc(f.name)}<small>${esc(f.kind)}${f.isin ? ' · ' + esc(f.isin) : ''}</small></span></button>`).join('') || '<p class="note">Ya has añadido todos los fondos disponibles.</p>'}</div>`); },
    'pick-fund': (el) => fundSheet(el.dataset.key, true),
    'edit-fund': (el) => fundSheet(el.dataset.key, false),
    'del-fund': async (el) => { const a = acc('horos'); a.funds = a.funds.filter((f) => f.key !== el.dataset.key); a.updated = Date.now(); closeSheet(); await changed(); },
    // Terreno
    'terr-pay': () => terrPaySheet(null),
    'terr-pay-edit': (el) => terrPaySheet(el.dataset.id),
    'del-terr-pay': async (el) => { const a = acc('terreno'); a.payments = a.payments.filter((x) => x.id !== el.dataset.id); a.updated = Date.now(); closeSheet(); await persist(); render(); },
    'terr-stmt': () => { const a = acc('terreno'); const st = a.statement || {}; const v = (x) => (x != null ? esc(numFmt(2).format(x)) : '');
      openSheet(`<h3>Estado de cuenta</h3><p class="note">Copia los datos del último estado de cuenta del promotor.</p><form data-form="terr-stmt">
        <label class="lbl" for="ts-d">Fecha</label><input class="field" id="ts-d" name="date" type="date" value="${esc(st.date || todayYmd())}">
        <label class="lbl" for="ts-b">Saldo pendiente (MXN)</label><input class="field big-num" id="ts-b" name="balance" inputmode="decimal" value="${v(st.balance)}" placeholder="0,00">
        <label class="lbl" for="ts-p">Total pagado (MXN)</label><input class="field" id="ts-p" name="paid" inputmode="decimal" value="${v(st.paid)}" placeholder="0,00">
        <label class="lbl" for="ts-o">Saldo vencido (MXN)</label><input class="field" id="ts-o" name="overdue" inputmode="decimal" value="${v(st.overdue)}" placeholder="0,00">
        <label class="lbl" for="ts-t">Precio total del terreno (MXN)</label><input class="field" id="ts-t" name="price" inputmode="decimal" value="${v(a.price)}" placeholder="0,00">
        <p class="lock-err form-err"></p><div class="sheet-actions"><button type="button" class="btn" data-act="close-sheet">Cancelar</button><button class="btn primary">Guardar</button></div></form>`); },
    'terr-doc-add': () => { const inp = $('#terr-file'); if (!inp) return; inp.value = ''; inp.click(); },
    'terr-doc-open': (el, ev) => { ev.stopPropagation(); openDoc(el.dataset.id, false); },
    'terr-doc-share': (el) => openDoc(el.dataset.id, true),
    'terr-doc': (el, ev) => { if (ev.target.closest('[data-act=terr-doc-open]')) return; const d = acc('terreno').docs.find((x) => x.id === el.dataset.id);
      openSheet(`<h3>${esc(d.label || d.name)}</h3><form data-form="terr-doc" data-id="${esc(d.id)}"><label class="lbl" for="td-l">Nombre</label><input class="field" id="td-l" name="label" maxlength="60" value="${esc(d.label || '')}" placeholder="${esc(d.name)}">
        <div class="sheet-actions"><button type="button" class="btn" data-act="terr-doc-open" data-id="${esc(d.id)}">Abrir</button><button type="button" class="btn" data-act="terr-doc-share" data-id="${esc(d.id)}">Compartir / guardar</button></div>
        <div class="sheet-actions"><button type="button" class="btn danger-soft" data-act="del-terr-doc" data-id="${esc(d.id)}">Eliminar</button><button class="btn primary">Guardar</button></div></form>`); },
    'del-terr-doc': async (el) => { const a = acc('terreno'); await Vault.delDoc(el.dataset.id); a.docs = a.docs.filter((x) => x.id !== el.dataset.id); closeSheet(); await persist(); render(); toast('Documento eliminado'); },
    'terr-import-ok': async () => {
      const d = pendingTerrData; pendingTerrData = null; if (!d) return closeSheet();
      let a = acc('terreno'); if (!a) { a = newAccount('terreno'); S.accounts.push(a); }
      Object.assign(a, { name: d.name || a.name, currency: 'MXN', plot: d.plot || {}, price: d.price ?? null, listPrice: d.listPrice ?? null, discount: d.discount ?? null, plan: d.plan || {}, statement: d.statement || null, terms: d.terms || [],
        payments: (d.payments || []).map((x) => ({ id: uid(), date: x.date, amount: x.amount, method: x.method || '', folio: x.folio || '', concept: x.concept || '' })), updated: Date.now() });
      a.docs = a.docs || [];
      closeSheet(); await persist(); location.hash = '#/cuenta/terreno'; render(); toast('Terreno importado');
    },
    // Ajustes
    'lock-now': () => lockNow(false),
    'change-secret': () => { const cur = Vault.meta.secretType; openSheet(`<h3>Cambiar ${cur === 'password' ? 'contraseña' : 'PIN'}</h3><form data-form="change-secret">
      ${secretFields('old', cur === 'password' ? 'Contraseña actual' : 'PIN actual', cur)}
      <label class="lbl">Nuevo tipo</label><div class="seg small"><button type="button" class="on" data-act="secret-type" data-t="pin">PIN (${PIN_LEN} dígitos)</button><button type="button" data-act="secret-type" data-t="password">Contraseña</button></div>
      <input type="hidden" name="type" value="pin">
      <div class="new-fields">${secretFields('n1', 'Nuevo PIN', 'pin')}${secretFields('n2', 'Repite el nuevo PIN', 'pin')}</div>
      <p class="lock-err form-err"></p><div class="sheet-actions"><button type="button" class="btn" data-act="close-sheet">Cancelar</button><button class="btn primary">Cambiar</button></div></form>`); },
    'secret-type': (el) => { const f = el.closest('form'); const t = el.dataset.t; f.type.value = t; $$('[data-act=secret-type]', f).forEach((b) => b.classList.toggle('on', b === el));
      $('.new-fields', f).innerHTML = secretFields('n1', t === 'pin' ? 'Nuevo PIN' : 'Nueva contraseña (mín. 8)', t) + secretFields('n2', t === 'pin' ? 'Repite el nuevo PIN' : 'Repite la contraseña', t); },
    'toggle-bio': async () => {
      if (Vault.meta.bio) { await Vault.disableBio(); toast('Biometría desactivada'); return settingsSheet(); }
      const t = Vault.meta.secretType;
      openSheet(`<h3>Activar huella / Face ID</h3><p class="note">Confirma tu ${t === 'password' ? 'contraseña' : 'PIN'} para autorizar el desbloqueo biométrico.</p><form data-form="enable-bio">${secretFields('old', t === 'password' ? 'Contraseña' : 'PIN', t)}
        <p class="lock-err form-err"></p><div class="sheet-actions"><button type="button" class="btn" data-act="close-sheet">Cancelar</button><button class="btn primary">Continuar</button></div></form>`);
    },
    export: () => openSheet(`<h3>Exportar copia cifrada</h3><p class="note">El archivo se cifra con AES-256 y una contraseña que elijas ahora. Guárdala bien: sin ella la copia no se puede abrir.</p>
      <form data-form="export">${secretFields('p1', 'Contraseña de la copia (mín. 8)', 'password')}${secretFields('p2', 'Repite la contraseña', 'password')}
      <p class="lock-err form-err"></p><div class="sheet-actions"><button type="button" class="btn" data-act="close-sheet">Cancelar</button><button class="btn primary">Exportar</button></div></form>`),
    import: () => { const inp = $('#import-file'); inp.value = ''; inp.click(); },
    'security-info': () => openSheet(`<h3>Cómo se protegen tus datos</h3><div class="prose">
      <p>🔐 <b>Cifrado local.</b> Todos tus datos se guardan cifrados con AES-GCM de 256 bits en este dispositivo (IndexedDB). La clave se protege con tu ${Vault.meta.secretType === 'password' ? 'contraseña' : 'PIN'} mediante PBKDF2-SHA256 (600.000 iteraciones).</p>
      <p>👆 <b>Biometría.</b> ${Vault.meta.bio ? (Vault.meta.bio.mode === 'prf' ? 'Activada con WebAuthn PRF: el autenticador del móvil genera una clave que descifra tus datos.' : 'Activada en modo comodidad: tu navegador no ofrece PRF, así que la huella solo abre una clave del dispositivo no exportable guardada en el navegador.') : 'Desactivada.'}</p>
      <p>📵 <b>Sin servidores.</b> La app no tiene backend. Solo consulta APIs públicas de precios (CoinGecko/Coinbase), de blockchain (con tus direcciones públicas) y el valor liquidativo de Horos.</p>
      <p>🙅 <b>Nunca</b> te pedirá contraseñas de DEGIRO, Mapfre u Horos, ni la frase semilla de tu Ledger.</p>
      <p>⏱️ Se bloquea al abrirla, tras 1 minuto en segundo plano y tras 5 minutos sin uso.</p>
      <p>⚠️ Un PIN de ${PIN_LEN} dígitos frena a quien coja tu móvil, pero alguien con acceso técnico a los datos del navegador podría probar todos los PIN. Para máxima seguridad usa una contraseña larga.</p></div>
      <div class="sheet-actions"><button class="btn primary" data-act="close-sheet">Entendido</button></div>`),
    wipe: () => openSheet(`<h3>Borrar todos los datos</h3><p class="note">Se eliminarán las cuentas, el historial y el PIN de este dispositivo. No se puede deshacer. Escribe <b>BORRAR</b> para confirmar.</p>
      <form data-form="wipe"><input class="field" name="c" autocomplete="off" autocapitalize="characters" placeholder="BORRAR"><div class="sheet-actions"><button type="button" class="btn" data-act="close-sheet">Cancelar</button><button class="btn danger">Borrar todo</button></div></form>`),
  };

  const F = {
    'lock-pw': (f) => { const v = f.pw.value; if (!v) return; submitSecret(v); },
    entry: async (f) => {
      const err = (m) => { $('.form-err', f).textContent = m; };
      const a = acc(f.dataset.acc); const kind = f.kind.value; const raw = (f.value.value || '').trim().replace(/\s+/g, '');
      const danger = dangerCheck(f.value.value || ''); if (danger) { f.value.value = ''; return err(danger); }
      let e = a.entries.find((x) => x.id === f.dataset.id);
      const data = { label: f.label.value.trim().slice(0, 40) };
      if (kind === 'manual') {
        const amt = parseAmount(f.amount.value); if (!Number.isFinite(amt) || amt < 0) return err('Cantidad no válida');
        Object.assign(data, { kind: 'manual', coin: f.coin.value, value: '', amount: amt, updated: Date.now(), error: null });
      } else if (kind === 'xpub') {
        if (!BTC.isExtKey(raw)) return err('Introduce una xpub, ypub o zpub válida (clave pública, empieza por xpub/ypub/zpub).');
        try { await BTC.parseExtKey(raw); } catch (x) { return err('Clave no válida: ' + x.message); }
        let st = f.scriptType.value; if (raw.startsWith('ypub')) st = 'p2sh-p2wpkh'; if (raw.startsWith('zpub')) st = 'p2wpkh';
        Object.assign(data, { kind: 'xpub', coin: 'btc', value: raw, scriptType: st });
      } else {
        const ok = kind === 'btc' ? BTC.isAddress(raw) : kind === 'eth' ? /^0x[0-9a-fA-F]{40}$/.test(raw) : /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(raw);
        if (!ok) return err(kind === 'btc' && BTC.isExtKey(raw) ? 'Eso es una xpub: elige el tipo «Bitcoin xpub».' : 'La dirección no parece válida para ' + P.COINS[kind].name + '.');
        Object.assign(data, { kind: 'address', coin: kind, value: raw });
      }
      const changedSource = !e || e.value !== data.value || e.kind !== data.kind || e.scriptType !== data.scriptType;
      if (!e) { e = { id: uid(), amount: null, updated: null, error: null }; a.entries.push(e); }
      Object.assign(e, data);
      if (changedSource && kind !== 'manual') { e.amount = null; e.error = null; }
      closeSheet();
      await persist(); render();
      if (kind === 'manual') { if (!S.prices[e.coin]) await refreshAll(true); else { a.updated = Date.now(); await changed(); } }
      else if (changedSource) await refreshAll(false);
    },
    'manual-balance': async (f) => {
      const v = parseAmount(f.amount.value); if (!Number.isFinite(v)) { $('.form-err', f).textContent = 'Importe no válido'; return; }
      const a = acc(f.dataset.id); const t = Date.now();
      if (a.type === 'degiro') { a.manual = v; a.manualAt = t; a.source = 'manual'; }
      else { a.balance = v; a.history = a.history || []; a.history.push({ t, amount: v }); }
      a.updated = t; closeSheet(); await changed(); toast('Saldo actualizado');
    },
    account: async (f) => {
      const name = f.name.value.trim(); if (!name) return;
      let link = f.link.value.trim();
      if (link && /^(javascript|data|vbscript|file):/i.test(link)) { $('.form-err', f).textContent = 'Enlace no permitido'; return; }
      if (link && !/^(https?:\/\/|[a-z][a-z0-9+.-]*:\/\/)/i.test(link)) link = 'https://' + link;
      if (f.dataset.id) { const a = acc(f.dataset.id); Object.assign(a, { name, emoji: f.emoji.value, color: f.color.value, link }); closeSheet(); await persist(); render(); return; }
      const bal = f.balance && f.balance.value.trim() ? parseAmount(f.balance.value) : null;
      if (bal != null && !Number.isFinite(bal)) { $('.form-err', f).textContent = 'Saldo no válido'; return; }
      const t = Date.now();
      S.accounts.push({ id: 'c' + uid(), type: 'custom', name, emoji: f.emoji.value, color: f.color.value, link, balance: bal, updated: bal != null ? t : null, history: bal != null ? [{ t, amount: bal }] : [] });
      closeSheet(); await changed();
    },
    product: async (f) => {
      const a = acc('mapfre'); const name = f.name.value.trim(); const v = parseAmount(f.amount.value);
      if (!name || !Number.isFinite(v)) { $('.form-err', f).textContent = 'Revisa el nombre y el importe'; return; }
      const t = Date.now(); let p = a.products.find((x) => x.id === f.dataset.id);
      const prev = p ? p.amount : null;
      if (!p) { p = { id: uid() }; a.products.push(p); }
      Object.assign(p, { name, amount: v, updated: t });
      if (prev !== v) a.history.push({ t, pid: p.id, name, amount: v, delta: prev == null ? null : Math.round((v - prev) * 100) / 100 });
      a.updated = t; closeSheet(); await changed();
    },
    fund: async (f) => {
      const a = acc('horos'); const key = f.dataset.key;
      const units = parseAmount(f.units.value); if (!Number.isFinite(units) || units < 0) { $('.form-err', f).textContent = 'Número de participaciones no válido'; return; }
      const nav = f.nav.value.trim() ? parseAmount(f.nav.value) : null;
      if (nav != null && (!Number.isFinite(nav) || nav <= 0)) { $('.form-err', f).textContent = 'VL no válido'; return; }
      let x = a.funds.find((y) => y.key === key); if (!x) { x = { key, units: null, nav: null, navDate: null, navSrc: null }; a.funds.push(x); }
      x.units = units;
      if (nav != null) { const d = new Date(); x.nav = nav; x.navDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; x.navSrc = 'manual'; x.error = null; }
      a.updated = Date.now(); closeSheet();
      if (x.nav == null) { await persist(); render(); await refreshAll(true); } else await changed();
    },
    'change-secret': async (f) => {
      const err = (m) => { $('.form-err', f).textContent = m; };
      const t = f.type.value, n1 = f.n1.value, n2 = f.n2.value;
      if (t === 'pin' && !new RegExp(`^\\d{${PIN_LEN}}$`).test(n1)) return err(`El PIN debe tener ${PIN_LEN} dígitos`);
      if (t === 'password' && n1.length < 8) return err('Mínimo 8 caracteres');
      if (n1 !== n2) return err('No coinciden');
      err('Comprobando…');
      try { await Vault.changeSecret(f.old.value, n1, t); closeSheet(); toast('Actualizado correctamente'); }
      catch (_) { err('El actual no es correcto'); }
    },
    'enable-bio': async (f) => {
      const err = (m) => { $('.form-err', f).textContent = m; };
      if (!(await Vault.verifySecret(f.old.value))) return err('No es correcto');
      try { const mode = await Vault.enableBio(f.old.value); closeSheet(); toast(mode === 'prf' ? 'Biometría activada (clave PRF)' : 'Biometría activada (modo comodidad)'); }
      catch (e) { err(e.name === 'NotAllowedError' ? 'Cancelado' : 'No se pudo activar: ' + e.message); }
    },
    export: async (f) => {
      const err = (m) => { $('.form-err', f).textContent = m; };
      if (f.p1.value.length < 8) return err('Mínimo 8 caracteres'); if (f.p1.value !== f.p2.value) return err('No coinciden');
      err('Cifrando…');
      const text = await Vault.exportBackup(S, f.p1.value);
      const d = new Date(); download(`mis-saldos-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`, text);
      closeSheet(); toast('Copia cifrada exportada');
    },
    'import-pw': async (f) => {
      const err = (m) => { $('.form-err', f).textContent = m; };
      err('Descifrando…');
      try { const data = await Vault.importBackup(pendingImport, f.pw.value); S = migrate(data); pendingImport = null; await persist(); closeSheet(); location.hash = '#/'; render(); toast('Copia restaurada'); }
      catch (e) { err(e.message); }
    },
    'terr-pay': async (f) => {
      const a = acc('terreno'); const v = parseAmount(f.amount.value); const date = f.date.value;
      if (!Number.isFinite(v) || v <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { $('.form-err', f).textContent = 'Revisa la fecha y el importe'; return; }
      let x = a.payments.find((y) => y.id === f.dataset.id); if (!x) { x = { id: uid(), concept: '' }; a.payments.push(x); }
      Object.assign(x, { date, amount: r2(v), method: f.method.value.trim().slice(0, 30), folio: f.folio.value.trim().slice(0, 20) });
      a.updated = Date.now(); closeSheet(); await persist(); render(); toast('Pago guardado · pendiente ' + mxn(terrInfo(a).pending, true));
    },
    'terr-stmt': async (f) => {
      const a = acc('terreno'); const n = (el) => (el.value.trim() ? parseAmount(el.value) : null);
      const bal = n(f.balance), paid = n(f.paid), od = n(f.overdue), price = n(f.price);
      if ([bal, paid, od, price].some((x) => x != null && !Number.isFinite(x))) { $('.form-err', f).textContent = 'Algún importe no es válido'; return; }
      a.statement = { date: f.date.value || todayYmd(), balance: bal, paid, overdue: od }; if (price != null) a.price = price;
      a.updated = Date.now(); closeSheet(); await persist(); render(); toast('Estado de cuenta guardado');
    },
    'terr-doc': async (f) => { const a = acc('terreno'); const d = a.docs.find((x) => x.id === f.dataset.id); d.label = f.label.value.trim().slice(0, 60); closeSheet(); await persist(); render(); },
    wipe: async (f) => { if (f.c.value.trim().toUpperCase() !== 'BORRAR') return; S = null; await Vault.wipe(); closeSheet(true); history.replaceState(null, '', location.pathname); showLock('setup'); },
  };
  let pendingImport = null;

  function terrPaySheet(id) {
    const a = acc('terreno'); const x = id ? a.payments.find((y) => y.id === id) : null; const t = terrInfo(a);
    const sug = x ? x.amount : (t.next ? t.next.amount : (a.plan && a.plan.installment) || null);
    openSheet(`<h3>${x ? 'Editar pago' : 'Nuevo pago'}</h3><form data-form="terr-pay" data-id="${esc(id || '')}">
      <label class="lbl" for="tp-d">Fecha</label><input class="field" id="tp-d" name="date" type="date" required value="${esc(x ? x.date : todayYmd())}">
      <label class="lbl" for="amt">Importe (MXN)</label><input class="field big-num" id="amt" name="amount" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${sug != null ? esc(numFmt(2).format(sug)) : ''}">
      <label class="lbl" for="tp-m">Forma de pago (opcional)</label><input class="field" id="tp-m" name="method" maxlength="30" value="${esc(x ? x.method : 'Transferencia')}">
      <label class="lbl" for="tp-f">Folio del recibo (opcional)</label><input class="field" id="tp-f" name="folio" maxlength="20" inputmode="numeric" value="${esc(x ? x.folio : '')}">
      <p class="lock-err form-err"></p>
      <div class="sheet-actions">${x ? `<button type="button" class="btn danger-soft" data-act="del-terr-pay" data-id="${esc(x.id)}">Eliminar</button>` : '<button type="button" class="btn" data-act="close-sheet">Cancelar</button>'}<button class="btn primary">Guardar</button></div></form>`);
  }

  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]'); if (!el || el.disabled) return;
    const fn = A[el.dataset.act]; if (!fn) return;
    if (el.tagName === 'BUTTON' && el.type !== 'submit') ev.preventDefault();
    fn(el, ev);
  });
  document.addEventListener('keydown', (ev) => {
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches('[role=button][data-act]')) { ev.preventDefault(); ev.target.click(); }
    if (!S && !lockState.usePassword && $('.pad')) {
      if (/^\d$/.test(ev.key)) A['pin-key']({ dataset: { k: ev.key } });
      else if (ev.key === 'Backspace') A['pin-del']();
    }
    if (ev.key === 'Escape') closeSheet();
  });
  document.addEventListener('submit', (ev) => { ev.preventDefault(); const f = ev.target; const fn = F[f.dataset.form]; if (fn) fn(f); });
  document.addEventListener('change', async (ev) => {
    if (ev.target.id === 'degiro-file') {
      const file = ev.target.files[0]; if (!file) return;
      try {
        const text = await file.text();
        const r = Degiro.parsePortfolio(text);
        const a = acc('degiro'); Object.assign(a, { positions: r.positions, csvTotal: r.total, csvAt: Date.now(), csvName: file.name.slice(0, 40), source: 'csv', updated: Date.now() });
        await changed(); toast(`Importadas ${r.positions.length} líneas · ${eur(r.total)}`);
      } catch (e) { toast(e.message); }
    }
    if (ev.target.id === 'terr-file') {
      const file = ev.target.files[0]; if (!file) return;
      if (file.size > 30 * 1048576) return toast('Archivo demasiado grande (máx. 30 MB)');
      try {
        toast('Cifrando y guardando…');
        const id = uid(); await Vault.saveDoc(id, new Uint8Array(await file.arrayBuffer()));
        const a = acc('terreno'); a.docs = a.docs || [];
        a.docs.push({ id, name: file.name.slice(0, 80), label: /contrat/i.test(file.name) ? 'Contrato firmado' : /estado|cuenta/i.test(file.name) ? 'Estado de cuenta' : /recibo/i.test(file.name) ? 'Recibo' : '', mime: file.type || 'application/pdf', size: file.size, added: Date.now() });
        await persist(); render(); toast('Documento guardado (cifrado)');
      } catch (e) { toast('No se pudo guardar: ' + e.message); }
    }
    if (ev.target.id === 'import-file') {
      const file = ev.target.files[0]; if (!file) return;
      pendingImport = await file.text();
      openSheet(`<h3>Importar copia</h3><p class="note">Se sustituirán todos los datos actuales por los de «${esc(file.name)}».</p><form data-form="import-pw">${secretFields('pw', 'Contraseña de la copia', 'password')}
        <p class="lock-err form-err"></p><div class="sheet-actions"><button type="button" class="btn" data-act="close-sheet">Cancelar</button><button class="btn primary">Importar</button></div></form>`);
    }
  });

  // ---------- Arranque ----------
  captureTerrLink();
  (async function boot() {
    if (!window.crypto || !crypto.subtle || !window.indexedDB) { app.innerHTML = '<p class="empty">Este navegador no soporta cifrado seguro (WebCrypto). Abre la app en HTTPS con un navegador moderno.</p>'; return; }
    showLock((await Vault.exists()) ? 'unlock' : 'setup');
  })();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) toast('Nueva versión disponible', { label: 'Recargar', fn: () => location.reload() }); });
  }
})();
