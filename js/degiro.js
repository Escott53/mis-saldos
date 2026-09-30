/* Importación del CSV de cartera de DEGIRO (Cartera → Exportar → CSV, "Portfolio.csv").
   Tolerante a idioma (ES/EN/NL/DE/PT/FR), separador (, ; tab), comillas y formato numérico (1.234,56 / 1,234.56). */
(function (global) {
  'use strict';
  const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

  function parseNum(v) {
    if (v == null) return NaN;
    let s = String(v).replace(/\s|\u00a0/g, '').replace(/[^\d,.\-]/g, '');
    if (!s || !/\d/.test(s)) return NaN;
    const hasC = s.includes(','), hasD = s.includes('.');
    if (hasC && hasD) {
      if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (hasC) {
      s = (s.match(/,/g).length > 1) ? s.replace(/,/g, '') : s.replace(',', '.');
    } else if (hasD && s.match(/\./g).length > 1) {
      s = s.replace(/\./g, '');
    }
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : NaN;
  }

  function detectDelimiter(text) {
    const line = text.split(/\r?\n/).find((l) => l.trim()) || '';
    let inQ = false; const cnt = { ',': 0, ';': 0, '\t': 0 };
    for (const ch of line) { if (ch === '"') inQ = !inQ; else if (!inQ && ch in cnt) cnt[ch]++; }
    return Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0];
  }

  function parseCSV(text, delim) {
    const rows = []; let row = [], cell = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
        else cell += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim() !== ''));
  }

  const COLS = {
    product: /^(producto|product|produkt|produit|produto|nombre|name)\b/,
    symbol: /(symbol|simbolo|symbool|isin|ticker)/,
    qty: /^(cantidad|quantity|amount|aantal|anzahl|quantite|quantidade|numero|n\.?º?|unidades)/,
    price: /(precio|closing|cierre|slotkoers|schlusskurs|kurs|cloture|fecho|price)/,
    local: /(valor local|local value|lokale waarde|lokaler wert|valeur locale|valor local)/,
    eur: /((valor|value|waarde|wert|valeur)\s*(en|in|em)?\s*eur)|^eur$|valor eur/,
  };

  function parsePortfolio(text) {
    text = String(text).replace(/^\uFEFF/, '');
    const delim = detectDelimiter(text);
    const rows = parseCSV(text, delim);
    const hi = rows.findIndex((r) => r.some((c) => COLS.product.test(norm(c))) && r.some((c) => COLS.eur.test(norm(c)) || COLS.qty.test(norm(c))));
    if (hi < 0) throw new Error('No se reconoce el formato. Exporta la cartera desde DEGIRO (Cartera → Exportar → CSV).');
    const H = rows[hi].map(norm);
    const find = (re, not) => H.findIndex((h, i) => re.test(h) && !(not && not.includes(i)));
    const iP = find(COLS.product), iS = find(COLS.symbol), iQ = find(COLS.qty), iPr = find(COLS.price), iL = find(COLS.local);
    const iE = find(COLS.eur, [iL]);
    const positions = [];
    for (const r of rows.slice(hi + 1)) {
      const product = (r[iP] || '').trim();
      if (!product) continue;
      if (/^total\b/i.test(product)) continue;
      let eur = iE >= 0 ? parseNum(r[iE]) : NaN;
      if (!Number.isFinite(eur)) { // alternativa: último valor numérico de la fila
        for (let k = r.length - 1; k > iP; k--) { const n = parseNum(r[k]); if (Number.isFinite(n)) { eur = n; break; } }
      }
      if (!Number.isFinite(eur)) continue;
      let cur = '', local = NaN;
      if (iL >= 0) {
        const lv = (r[iL] || '').trim();
        const m = lv.match(/[A-Z]{3}/); if (m) cur = m[0];
        local = /\d/.test(lv) ? parseNum(lv) : parseNum(r[iL + 1]);
      }
      const symbol = iS >= 0 ? (r[iS] || '').trim() : '';
      const qty = iQ >= 0 ? parseNum(r[iQ]) : NaN;
      const cash = /cash|efectivo|liquidez|geldmarkt|money market|fondo del mercado monetario/i.test(product) || (!symbol && !Number.isFinite(qty));
      positions.push({ product, symbol, qty: Number.isFinite(qty) ? qty : null, price: iPr >= 0 && Number.isFinite(parseNum(r[iPr])) ? parseNum(r[iPr]) : null, cur: cur || (cash ? 'EUR' : ''), local: Number.isFinite(local) ? local : null, eur, cash });
    }
    if (!positions.length) throw new Error('El archivo no contiene posiciones.');
    const total = Math.round(positions.reduce((s, p) => s + p.eur, 0) * 100) / 100;
    return { positions, total };
  }

  global.Degiro = { parsePortfolio, parseNum };
})(typeof window !== 'undefined' ? window : globalThis);
