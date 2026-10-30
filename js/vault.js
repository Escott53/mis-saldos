/* Almacén cifrado local.
   - Los datos se cifran con una clave de datos aleatoria (DK, AES-GCM 256).
   - La DK se guarda cifrada ("envuelta") con una clave derivada del PIN/contraseña (PBKDF2-SHA256).
   - Opcional: la DK también se envuelve con una clave derivada de WebAuthn PRF (huella/Face ID),
     o, si PRF no está disponible, con una clave del dispositivo no exportable guardada en IndexedDB
     (en ese caso la biometría es solo una "puerta" de comodidad; ver README).
   Nada sale del dispositivo. */
(function (global) {
  'use strict';
  const DB_NAME = 'mis-saldos';
  const STORE = 'kv';
  const PBKDF2_ITER = 600000;
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const subtle = crypto.subtle;

  const b64 = (u8) => { let s = ''; const b = new Uint8Array(u8); for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); };
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const rand = (n) => crypto.getRandomValues(new Uint8Array(n));

  // ---------- IndexedDB ----------
  let dbp = null;
  const db = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const tx = async (mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction(STORE, mode); const s = t.objectStore(STORE); const r = fn(s); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); }); };
  const get = (k) => tx('readonly', (s) => s.get(k));
  const put = (k, v) => tx('readwrite', (s) => s.put(v, k));
  const del = (k) => tx('readwrite', (s) => s.delete(k));

  // ---------- Primitivas ----------
  async function kekFromSecret(secret, salt, iter) {
    const base = await subtle.importKey('raw', enc.encode(secret.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
    return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function kekFromPrf(prfOut, salt) {
    const base = await subtle.importKey('raw', prfOut, 'HKDF', false, ['deriveKey']);
    return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('mis-saldos/bio-kek/v1') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function seal(key, bytes, aad) {
    const iv = rand(12);
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad ? enc.encode(aad) : undefined }, key, bytes);
    return { iv: b64(iv), ct: b64(ct) };
  }
  async function open(key, box, aad) {
    return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv), additionalData: aad ? enc.encode(aad) : undefined }, key, unb64(box.ct)));
  }
  const importDK = (raw) => subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);

  // ---------- Sesión (solo en memoria) ----------
  let dataKey = null;
  let meta = null;

  async function loadMeta() { meta = (await get('meta')) || null; return meta; }
  async function saveMeta() { await put('meta', meta); }

  async function exists() { return !!(await loadMeta()); }

  async function setup(secret, secretType) {
    const raw = rand(32);
    const salt = rand(16);
    const kek = await kekFromSecret(secret, salt, PBKDF2_ITER);
    meta = { v: 1, secretType, kdf: { salt: b64(salt), iter: PBKDF2_ITER }, wrapPin: await seal(kek, raw, 'dk-pin'), bio: null, fails: 0, lockUntil: 0, created: Date.now() };
    await saveMeta();
    dataKey = await importDK(raw);
    raw.fill(0);
  }

  async function rawFromSecret(secret) {
    const kek = await kekFromSecret(secret, unb64(meta.kdf.salt), meta.kdf.iter);
    return open(kek, meta.wrapPin, 'dk-pin');
  }

  function lockoutRemaining() { return meta && meta.lockUntil ? Math.max(0, meta.lockUntil - Date.now()) : 0; }

  async function unlockWithSecret(secret) {
    await loadMeta();
    if (lockoutRemaining() > 0) { const e = new Error('lockout'); e.wait = lockoutRemaining(); throw e; }
    try {
      const raw = await rawFromSecret(secret);
      dataKey = await importDK(raw); raw.fill(0);
      if (meta.fails) { meta.fails = 0; meta.lockUntil = 0; await saveMeta(); }
      return readData();
    } catch (err) {
      if (err.message === 'lockout') throw err;
      meta.fails = (meta.fails || 0) + 1;
      if (meta.fails >= 5) meta.lockUntil = Date.now() + Math.min(15 * 60e3, 30e3 * 2 ** (meta.fails - 5));
      await saveMeta();
      const e = new Error('bad-secret'); e.fails = meta.fails; e.wait = lockoutRemaining(); throw e;
    }
  }

  // ---------- Datos ----------
  async function readData() {
    const box = await get('vault');
    if (!box) return null;
    return JSON.parse(dec.decode(await open(dataKey, box, 'vault')));
  }
  async function save(data) {
    if (!dataKey) throw new Error('Bloqueado');
    await put('vault', await seal(dataKey, enc.encode(JSON.stringify(data)), 'vault'));
  }
  // Documentos adjuntos (PDF, imágenes): cifrados con la misma clave de datos, uno por entrada.
  async function saveDoc(id, bytes) { if (!dataKey) throw new Error('Bloqueado'); await put('doc:' + id, await seal(dataKey, bytes, 'doc:' + id)); }
  async function readDoc(id) { if (!dataKey) throw new Error('Bloqueado'); const box = await get('doc:' + id); return box ? open(dataKey, box, 'doc:' + id) : null; }
  const delDoc = (id) => del('doc:' + id);
  function lock() { dataKey = null; }
  const isUnlocked = () => !!dataKey;

  async function changeSecret(oldSecret, newSecret, newType) {
    const raw = await rawFromSecret(oldSecret);
    const salt = rand(16);
    const kek = await kekFromSecret(newSecret, salt, PBKDF2_ITER);
    meta.secretType = newType; meta.kdf = { salt: b64(salt), iter: PBKDF2_ITER }; meta.wrapPin = await seal(kek, raw, 'dk-pin');
    raw.fill(0);
    await saveMeta();
  }
  async function verifySecret(secret) { try { (await rawFromSecret(secret)).fill(0); return true; } catch (_) { return false; } }

  // ---------- WebAuthn (huella / Face ID) ----------
  async function bioAvailable() {
    try { return !!(global.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); }
    catch (_) { return false; }
  }
  async function assertion(credId, prfSalt) {
    const opts = { publicKey: { challenge: rand(32), allowCredentials: [{ type: 'public-key', id: unb64(credId), transports: ['internal', 'hybrid'] }], userVerification: 'required', timeout: 60000 } };
    if (prfSalt) opts.publicKey.extensions = { prf: { eval: { first: unb64(prfSalt) } } };
    const cred = await navigator.credentials.get(opts);
    if (!cred) throw new Error('Cancelado');
    const ext = cred.getClientExtensionResults ? cred.getClientExtensionResults() : {};
    const flags = new Uint8Array(cred.response.authenticatorData)[32];
    if (!(flags & 0x04)) throw new Error('El dispositivo no verificó al usuario');
    return ext && ext.prf && ext.prf.results && ext.prf.results.first ? new Uint8Array(ext.prf.results.first) : null;
  }

  // Requiere el PIN actual para poder envolver la DK con la nueva clave.
  async function enableBio(secret) {
    const raw = await rawFromSecret(secret);
    const prfSalt = rand(32);
    const cred = await navigator.credentials.create({ publicKey: {
      rp: { name: 'Mis Saldos' },
      user: { id: rand(16), name: 'mis-saldos', displayName: 'Mis Saldos' },
      challenge: rand(32),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      attestation: 'none', timeout: 60000,
      extensions: { prf: { eval: { first: prfSalt } } },
    } });
    if (!cred) throw new Error('Cancelado');
    const credId = b64(cred.rawId);
    const ext = cred.getClientExtensionResults ? cred.getClientExtensionResults() : {};
    let prfOut = ext.prf && ext.prf.results && ext.prf.results.first ? new Uint8Array(ext.prf.results.first) : null;
    if (!prfOut && !(ext.prf && ext.prf.enabled === false)) {
      // Algunos navegadores solo devuelven el PRF en get(): se pide una segunda verificación.
      try { prfOut = await assertion(credId, b64(prfSalt)); } catch (_) { prfOut = null; }
    }
    let bio;
    if (prfOut) {
      const hk = rand(16);
      const kek = await kekFromPrf(prfOut, hk);
      bio = { mode: 'prf', credId, prfSalt: b64(prfSalt), hkdfSalt: b64(hk), wrap: await seal(kek, raw, 'dk-bio') };
    } else {
      const devKey = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      await put('deviceKey', devKey);
      bio = { mode: 'device', credId, wrap: await seal(devKey, raw, 'dk-dev') };
    }
    raw.fill(0);
    meta.bio = bio; await saveMeta();
    return bio.mode;
  }
  async function disableBio() { meta.bio = null; await saveMeta(); await del('deviceKey'); }

  async function unlockWithBio() {
    await loadMeta();
    const bio = meta && meta.bio; if (!bio) throw new Error('Biometría no configurada');
    if (lockoutRemaining() > 0) { const e = new Error('lockout'); e.wait = lockoutRemaining(); throw e; }
    let raw;
    if (bio.mode === 'prf') {
      const prfOut = await assertion(bio.credId, bio.prfSalt);
      if (!prfOut) throw new Error('El autenticador no devolvió la clave PRF');
      raw = await open(await kekFromPrf(prfOut, unb64(bio.hkdfSalt)), bio.wrap, 'dk-bio');
    } else {
      await assertion(bio.credId, null);
      const devKey = await get('deviceKey'); if (!devKey) throw new Error('Falta la clave del dispositivo');
      raw = await open(devKey, bio.wrap, 'dk-dev');
    }
    dataKey = await importDK(raw); raw.fill(0);
    return readData();
  }

  // ---------- Copias de seguridad cifradas ----------
  async function exportBackup(data, password) {
    const salt = rand(16);
    const key = await kekFromSecret(password, salt, PBKDF2_ITER);
    const box = await seal(key, enc.encode(JSON.stringify(data)), 'mis-saldos-backup');
    return JSON.stringify({ format: 'mis-saldos-backup', v: 1, created: new Date().toISOString(), kdf: { name: 'PBKDF2-SHA256', iter: PBKDF2_ITER, salt: b64(salt) }, cipher: 'AES-GCM-256', ...box });
  }
  async function importBackup(text, password) {
    let j; try { j = JSON.parse(text); } catch (_) { throw new Error('El archivo no es una copia válida'); }
    if (j.format !== 'mis-saldos-backup') throw new Error('El archivo no es una copia de Mis Saldos');
    const key = await kekFromSecret(password, unb64(j.kdf.salt), j.kdf.iter);
    try { return JSON.parse(dec.decode(await open(key, j, 'mis-saldos-backup'))); }
    catch (_) { throw new Error('Contraseña incorrecta o archivo dañado'); }
  }

  async function wipe() {
    dataKey = null; meta = null;
    const d = await db(); d.close(); dbp = null;
    await new Promise((res) => { const r = indexedDB.deleteDatabase(DB_NAME); r.onsuccess = r.onerror = r.onblocked = () => res(); });
  }

  global.Vault = {
    exists, setup, unlockWithSecret, unlockWithBio, save, lock, isUnlocked, changeSecret, verifySecret,
    saveDoc, readDoc, delDoc, bioAvailable, enableBio, disableBio, exportBackup, importBackup, wipe, lockoutRemaining,
    get meta() { return meta; },
  };
})(window);
