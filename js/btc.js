/* Derivación de direcciones Bitcoin a partir de claves públicas extendidas (xpub/ypub/zpub).
   Solo claves PÚBLICAS: esta app nunca pide ni maneja semillas ni claves privadas.
   Implementa secp256k1 (suma de puntos), RIPEMD-160, Base58Check, Bech32/Bech32m. */
(function (global) {
  'use strict';
  const P = 2n ** 256n - 2n ** 32n - 977n;
  const N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
  const G = [0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798n, 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8n];
  const mod = (a, m = P) => { const r = a % m; return r >= 0n ? r : r + m; };
  const inv = (a) => { let [lm, hm, low, high] = [1n, 0n, mod(a), P]; while (low > 1n) { const r = high / low; [lm, hm] = [hm - lm * r, lm]; [low, high] = [high - low * r, low]; } return mod(lm); };
  // Coordenadas jacobianas
  const jDouble = ([x, y, z]) => {
    if (y === 0n) return [0n, 0n, 0n];
    const ysq = mod(y * y), S = mod(4n * x * ysq), M = mod(3n * x * x);
    const nx = mod(M * M - 2n * S), ny = mod(M * (S - nx) - 8n * ysq * ysq), nz = mod(2n * y * z);
    return [nx, ny, nz];
  };
  const jAdd = (p, q) => {
    if (p[2] === 0n) return q; if (q[2] === 0n) return p;
    const z1s = mod(p[2] * p[2]), z2s = mod(q[2] * q[2]);
    const U1 = mod(p[0] * z2s), U2 = mod(q[0] * z1s), S1 = mod(p[1] * z2s * q[2]), S2 = mod(q[1] * z1s * p[2]);
    if (U1 === U2) return S1 === S2 ? jDouble(p) : [0n, 0n, 0n];
    const H = mod(U2 - U1), R = mod(S2 - S1), H2 = mod(H * H), H3 = mod(H * H2), U1H2 = mod(U1 * H2);
    const nx = mod(R * R - H3 - 2n * U1H2), ny = mod(R * (U1H2 - nx) - S1 * H3), nz = mod(H * p[2] * q[2]);
    return [nx, ny, nz];
  };
  const toAff = ([x, y, z]) => { const zi = inv(z), zi2 = mod(zi * zi); return [mod(x * zi2), mod(y * zi2 * zi)]; };
  const mulG = (k) => { let R = [0n, 0n, 0n], Q = [G[0], G[1], 1n]; while (k > 0n) { if (k & 1n) R = jAdd(R, Q); Q = jDouble(Q); k >>= 1n; } return toAff(R); };
  const addAff = (a, b) => toAff(jAdd([a[0], a[1], 1n], [b[0], b[1], 1n]));

  const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, '0')).join('');
  const big = (u8) => BigInt('0x' + (hex(u8) || '0'));
  const bytes32 = (n) => { const h = n.toString(16).padStart(64, '0'); return Uint8Array.from(h.match(/../g), (x) => parseInt(x, 16)); };
  const concat = (...a) => { const out = new Uint8Array(a.reduce((s, x) => s + x.length, 0)); let o = 0; for (const x of a) { out.set(x, o); o += x.length; } return out; };
  const decompress = (c) => {
    const x = big(c.slice(1)); const y2 = mod(x * x * x + 7n);
    let y = 1n, b = y2, e = (P + 1n) / 4n; while (e > 0n) { if (e & 1n) y = mod(y * b); b = mod(b * b); e >>= 1n; }
    if (mod(y * y) !== y2) throw new Error('Punto no válido');
    if ((y & 1n) !== BigInt(c[0] & 1)) y = P - y;
    return [x, y];
  };
  const compress = ([x, y]) => concat(Uint8Array.of(y & 1n ? 3 : 2), bytes32(x));

  // ---------- RIPEMD-160 ----------
  function ripemd160(msg) {
    const rl = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,7,4,13,1,10,6,15,3,12,0,9,5,2,14,11,8,3,10,14,4,9,15,8,1,2,7,0,6,13,11,5,12,1,9,11,10,0,8,12,4,13,3,7,15,14,5,6,2,4,0,5,9,7,12,2,10,14,1,3,8,11,6,15,13];
    const rr = [5,14,7,0,9,2,11,4,13,6,15,8,1,10,3,12,6,11,3,7,0,13,5,10,14,15,8,12,4,9,1,2,15,5,1,3,7,14,6,9,11,8,12,2,10,0,4,13,8,6,4,1,3,11,15,0,5,12,2,13,9,7,10,14,12,15,10,4,1,5,8,7,6,2,13,14,0,3,9,11];
    const sl = [11,14,15,12,5,8,7,9,11,13,14,15,6,7,9,8,7,6,8,13,11,9,7,15,7,12,15,9,11,7,13,12,11,13,6,7,14,9,13,15,14,8,13,6,5,12,7,5,11,12,14,15,14,15,9,8,9,14,5,6,8,6,5,12,9,15,5,11,6,8,13,12,5,12,13,14,11,8,5,6];
    const sr = [8,9,9,11,13,15,15,5,7,7,8,11,14,14,12,6,9,13,15,7,12,8,9,11,7,7,12,7,6,15,13,11,9,7,15,11,8,6,6,14,12,13,5,14,13,13,7,5,15,5,8,11,14,14,6,14,6,9,12,9,12,5,15,8,8,5,12,9,12,5,14,6,8,13,6,5,15,13,11,11];
    const KL = [0, 0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xa953fd4e], KR = [0x50a28be6, 0x5c4dd124, 0x6d703ef3, 0x7a6d76e9, 0];
    const f = (j, x, y, z) => j < 16 ? x ^ y ^ z : j < 32 ? (x & y) | (~x & z) : j < 48 ? (x | ~y) ^ z : j < 64 ? (x & z) | (y & ~z) : x ^ (y | ~z);
    const rotl = (x, n) => (x << n) | (x >>> (32 - n));
    const len = msg.length, padLen = ((len + 8) >> 6 << 6) + 64;
    const m = new Uint8Array(padLen); m.set(msg); m[len] = 0x80;
    const dv = new DataView(m.buffer); dv.setUint32(padLen - 8, (len * 8) >>> 0, true); dv.setUint32(padLen - 4, Math.floor(len / 0x20000000), true);
    let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
    for (let o = 0; o < padLen; o += 64) {
      const X = []; for (let i = 0; i < 16; i++) X.push(dv.getUint32(o + i * 4, true));
      let al = h0, bl = h1, cl = h2, dl = h3, el = h4, ar = h0, br = h1, cr = h2, dr = h3, er = h4;
      for (let j = 0; j < 80; j++) {
        const r = j >> 4;
        let t = (rotl((al + f(j, bl, cl, dl) + X[rl[j]] + KL[r]) | 0, sl[j]) + el) | 0;
        al = el; el = dl; dl = rotl(cl, 10); cl = bl; bl = t;
        t = (rotl((ar + f(79 - j, br, cr, dr) + X[rr[j]] + KR[r]) | 0, sr[j]) + er) | 0;
        ar = er; er = dr; dr = rotl(cr, 10); cr = br; br = t;
      }
      const t = (h1 + cl + dr) | 0; h1 = (h2 + dl + er) | 0; h2 = (h3 + el + ar) | 0; h3 = (h4 + al + br) | 0; h4 = (h0 + bl + cr) | 0; h0 = t;
    }
    const out = new Uint8Array(20); const odv = new DataView(out.buffer);
    [h0, h1, h2, h3, h4].forEach((h, i) => odv.setUint32(i * 4, h >>> 0, true));
    return out;
  }

  const subtle = () => global.crypto.subtle;
  const sha256 = async (u8) => new Uint8Array(await subtle().digest('SHA-256', u8));
  const hash160 = async (u8) => ripemd160(await sha256(u8));
  const hmac512 = async (key, data) => {
    const k = await subtle().importKey('raw', key, { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
    return new Uint8Array(await subtle().sign('HMAC', k, data));
  };
  const taggedHash = async (tag, data) => { const t = await sha256(new TextEncoder().encode(tag)); return sha256(concat(t, t, data)); };

  // ---------- Base58 ----------
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const b58decode = (s) => {
    let n = 0n; for (const c of s) { const i = B58.indexOf(c); if (i < 0) throw new Error('Carácter no válido'); n = n * 58n + BigInt(i); }
    let h = n.toString(16); if (h.length % 2) h = '0' + h; if (n === 0n) h = '';
    const body = h ? Uint8Array.from(h.match(/../g), (x) => parseInt(x, 16)) : new Uint8Array();
    let z = 0; while (s[z] === '1') z++;
    return concat(new Uint8Array(z), body);
  };
  const b58encode = (u8) => { let n = big(u8), s = ''; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; } for (const b of u8) { if (b) break; s = '1' + s; } return s; };
  const b58check = async (payload) => b58encode(concat(payload, (await sha256(await sha256(payload))).slice(0, 4)));
  const b58checkDecode = async (s) => {
    const raw = b58decode(s); const payload = raw.slice(0, -4);
    const cs = (await sha256(await sha256(payload))).slice(0, 4);
    if (hex(cs) !== hex(raw.slice(-4))) throw new Error('Checksum incorrecto');
    return payload;
  };

  // ---------- Bech32 / Bech32m ----------
  const CH = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  const polymod = (v) => { const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]; let c = 1; for (const x of v) { const b = c >> 25; c = ((c & 0x1ffffff) << 5) ^ x; for (let i = 0; i < 5; i++) if ((b >> i) & 1) c ^= GEN[i]; } return c; };
  const hrpExp = (h) => [...[...h].map((c) => c.charCodeAt(0) >> 5), 0, ...[...h].map((c) => c.charCodeAt(0) & 31)];
  const convertBits = (data, from, to) => { let acc = 0, bits = 0; const out = []; const maxv = (1 << to) - 1; for (const v of data) { acc = (acc << from) | v; bits += from; while (bits >= to) { bits -= to; out.push((acc >> bits) & maxv); } } if (bits > 0) out.push((acc << (to - bits)) & maxv); return out; };
  const segwitAddr = (ver, prog) => {
    const hrp = 'bc'; const data = [ver, ...convertBits(prog, 8, 5)]; const K = ver === 0 ? 1 : 0x2bc830a3;
    const pm = polymod([...hrpExp(hrp), ...data, 0, 0, 0, 0, 0, 0]) ^ K;
    const cs = []; for (let i = 0; i < 6; i++) cs.push((pm >> (5 * (5 - i))) & 31);
    return hrp + '1' + [...data, ...cs].map((d) => CH[d]).join('');
  };

  // ---------- Claves extendidas ----------
  const VERSIONS = { '0488b21e': 'xpub', '049d7cb2': 'ypub', '04b24746': 'zpub' };
  async function parseExtKey(str) {
    const p = await b58checkDecode(str.trim());
    if (p.length !== 78) throw new Error('Longitud incorrecta');
    const ver = hex(p.slice(0, 4));
    if (!VERSIONS[ver]) throw new Error('Solo se admiten claves públicas xpub, ypub o zpub');
    return { kind: VERSIONS[ver], depth: p[4], chain: p.slice(13, 45), key: p.slice(45, 78) };
  }
  async function ckd(node, i) {
    const I = await hmac512(node.chain, concat(node.key, Uint8Array.of(i >>> 24, (i >>> 16) & 255, (i >>> 8) & 255, i & 255)));
    const il = big(I.slice(0, 32)); if (il >= N) throw new Error('Índice no válido');
    const pt = addAff(mulG(il), decompress(node.key));
    return { chain: I.slice(32), key: compress(pt) };
  }
  async function addressFor(pub, type) {
    if (type === 'p2pkh') return b58check(concat(Uint8Array.of(0), await hash160(pub)));
    if (type === 'p2sh-p2wpkh') { const redeem = concat(Uint8Array.of(0, 20), await hash160(pub)); return b58check(concat(Uint8Array.of(5), await hash160(redeem))); }
    if (type === 'p2wpkh') return segwitAddr(0, await hash160(pub));
    if (type === 'p2tr') {
      const P0 = decompress(pub); const x = bytes32(P0[0]);
      const Peven = P0[1] & 1n ? [P0[0], P - P0[1]] : P0;
      const t = big(await taggedHash('TapTweak', x));
      const Q = addAff(Peven, mulG(t));
      return segwitAddr(1, bytes32(Q[0]));
    }
    throw new Error('Tipo desconocido');
  }
  const DEFAULT_TYPE = { xpub: 'p2wpkh', ypub: 'p2sh-p2wpkh', zpub: 'p2wpkh' };
  // Deriva direcciones [change]/[start..start+count)
  async function derive(extKey, type, change, start, count) {
    const root = await parseExtKey(extKey);
    const branch = await ckd(root, change);
    const out = [];
    for (let i = start; i < start + count; i++) out.push(await addressFor((await ckd(branch, i)).key, type));
    return out;
  }
  const isAddress = (s) => /^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/.test(s.trim());
  const isExtKey = (s) => /^[xyz]pub[1-9A-HJ-NP-Za-km-z]{100,112}$/.test(s.trim());
  global.BTC = { parseExtKey, derive, isAddress, isExtKey, DEFAULT_TYPE };
})(typeof window !== 'undefined' ? window : globalThis);
