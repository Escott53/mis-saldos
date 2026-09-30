/* Fuentes de datos públicas, gratuitas, sin clave y con CORS (verificadas en navegador).
   Solo se envían direcciones PÚBLICAS; nunca claves privadas ni semillas. */
(function (global) {
  'use strict';
  async function fetchJSON(url, opts = {}, ms = 12000) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(url, { ...opts, signal: ctl.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }
  async function firstOk(fns) {
    let last;
    for (const fn of fns) { try { return await fn(); } catch (e) { last = e; } }
    throw last || new Error('Sin respuesta');
  }
  const rpc = (url, method, params) => fetchJSON(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
    .then((j) => { if (j.error) throw new Error(j.error.message || 'RPC'); return j.result; });

  // ---------- Criptoactivos disponibles ----------
  const COINS = {
    btc: { name: 'Bitcoin', sym: 'BTC', cg: 'bitcoin', dec: 8, icon: '₿', color: '#f7931a' },
    eth: { name: 'Ethereum', sym: 'ETH', cg: 'ethereum', dec: 18, icon: 'Ξ', color: '#627eea' },
    sol: { name: 'Solana', sym: 'SOL', cg: 'solana', dec: 9, icon: '◎', color: '#14f195' },
    ltc: { name: 'Litecoin', sym: 'LTC', cg: 'litecoin', icon: 'Ł', color: '#345d9d' },
    xrp: { name: 'XRP', sym: 'XRP', cg: 'ripple', icon: '✕', color: '#23292f' },
    ada: { name: 'Cardano', sym: 'ADA', cg: 'cardano', icon: '₳', color: '#0033ad' },
    dot: { name: 'Polkadot', sym: 'DOT', cg: 'polkadot', icon: '●', color: '#e6007a' },
    doge: { name: 'Dogecoin', sym: 'DOGE', cg: 'dogecoin', icon: 'Ð', color: '#c2a633' },
    avax: { name: 'Avalanche', sym: 'AVAX', cg: 'avalanche-2', icon: '▲', color: '#e84142' },
    usdc: { name: 'USD Coin', sym: 'USDC', cg: 'usd-coin', icon: '$', color: '#2775ca' },
    usdt: { name: 'Tether', sym: 'USDT', cg: 'tether', icon: '₮', color: '#26a17b' },
  };

  // Precios en EUR: CoinGecko y, si falla (límite de peticiones), Coinbase.
  async function prices(keys) {
    keys = [...new Set(keys)].filter((k) => COINS[k]);
    if (!keys.length) return {};
    return firstOk([
      async () => {
        const ids = keys.map((k) => COINS[k].cg).join(',');
        const j = await fetchJSON(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=eur&include_24hr_change=true`);
        const out = {}; for (const k of keys) { const v = j[COINS[k].cg]; if (v && v.eur) out[k] = { eur: v.eur, ch24: v.eur_24h_change ?? null, src: 'CoinGecko' }; }
        if (!Object.keys(out).length) throw new Error('Sin precios');
        return out;
      },
      async () => {
        const j = await fetchJSON('https://api.coinbase.com/v2/exchange-rates?currency=EUR');
        const out = {}; for (const k of keys) { const r = parseFloat(j.data.rates[COINS[k].sym]); if (r > 0) out[k] = { eur: 1 / r, ch24: null, src: 'Coinbase' }; }
        if (!Object.keys(out).length) throw new Error('Sin precios');
        return out;
      },
    ]);
  }

  // ---------- Bitcoin ----------
  const esplora = (base, a) => fetchJSON(`${base}/api/address/${a}`).then((j) => (j.chain_stats.funded_txo_sum - j.chain_stats.spent_txo_sum + j.mempool_stats.funded_txo_sum - j.mempool_stats.spent_txo_sum));
  async function btcAddress(a) {
    const sats = await firstOk([() => esplora('https://mempool.space', a), () => esplora('https://blockstream.info', a),
      () => fetchJSON(`https://blockchain.info/balance?cors=true&active=${a}`).then((j) => j[a].final_balance)]);
    return { amount: sats / 1e8 };
  }
  // Varias direcciones en una sola petición (blockchain.info) con alternativa por dirección (mempool.space).
  async function btcBalances(addrs) {
    try {
      const j = await fetchJSON(`https://blockchain.info/balance?cors=true&active=${addrs.join('|')}`);
      return addrs.map((a) => ({ a, sats: j[a] ? j[a].final_balance : 0, used: j[a] ? j[a].n_tx > 0 : false }));
    } catch (_) {
      const out = [];
      for (const a of addrs) {
        const j = await firstOk([() => fetchJSON(`https://mempool.space/api/address/${a}`), () => fetchJSON(`https://blockstream.info/api/address/${a}`)]);
        out.push({ a, sats: j.chain_stats.funded_txo_sum - j.chain_stats.spent_txo_sum + j.mempool_stats.funded_txo_sum - j.mempool_stats.spent_txo_sum, used: j.chain_stats.tx_count + j.mempool_stats.tx_count > 0 });
      }
      return out;
    }
  }
  // xpub/ypub/zpub: las direcciones se derivan EN EL DISPOSITIVO (la clave extendida no se envía a ningún servidor).
  async function btcExtKey(key, type, onProgress) {
    const GAP = 20, BATCH = 20;
    let total = 0, used = 0, scanned = 0;
    for (const change of [0, 1]) {
      let start = 0, lastUsed = -1;
      while (start - (lastUsed + 1) < GAP && start < 2000) {
        const addrs = await global.BTC.derive(key, type, change, start, BATCH);
        const res = await btcBalances(addrs);
        res.forEach((r, i) => { total += r.sats; if (r.used) { used++; lastUsed = start + i; } });
        start += BATCH; scanned += BATCH;
        onProgress && onProgress(scanned);
      }
    }
    return { amount: total / 1e8, usedAddresses: used };
  }

  // ---------- Ethereum ----------
  const ETH_RPCS = ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org', 'https://cloudflare-eth.com'];
  async function ethAddress(a) {
    const hex = await firstOk(ETH_RPCS.map((u) => () => rpc(u, 'eth_getBalance', [a, 'latest'])));
    const wei = BigInt(hex);
    return { amount: Number(wei / 10n ** 9n) / 1e9 };
  }

  // ---------- Solana ----------
  const SOL_RPCS = ['https://solana-rpc.publicnode.com', 'https://api.mainnet-beta.solana.com'];
  async function solAddress(a) {
    const r = await firstOk(SOL_RPCS.map((u) => () => rpc(u, 'getBalance', [a])));
    return { amount: r.value / 1e9 };
  }

  // ---------- Horos AM: valor liquidativo ----------
  // Endpoint JSON público que usa la propia web de horosam.com (Access-Control-Allow-Origin: *).
  // No está documentado oficialmente: si cambia, la app permite introducir el VL a mano.
  const HOROS_FUNDS = [
    { key: 'hvi', name: 'Horos Value Internacional FI', short: 'Value Internacional', isin: 'ES0146309002', kind: 'Fondo · RV global', api: '5a017ae36ccb761f259a0435', url: 'https://horosam.com/producto/horos-value-internacional/' },
    { key: 'hvib', name: 'Horos Value Iberia FI', short: 'Value Iberia', isin: 'ES0146311008', kind: 'Fondo · RV ibérica', api: '5acf59f6bf4c77472b24604e', url: 'https://horosam.com/producto/horos-value-iberia/' },
    { key: 'hpa', name: 'Horos Patrimonio FI · Clase A', short: 'Patrimonio A', isin: 'ES0146296001', kind: 'Fondo · RF mixta', api: '68ee056f0a76bc2aac4570dd', url: 'https://horosam.com/producto/horos-patrimonio/' },
    { key: 'hpi', name: 'Horos Patrimonio FI · Clase I', short: 'Patrimonio I', isin: 'ES0146296019', kind: 'Fondo · RF mixta', api: '68ee05a90a76bc2aac45711e', url: 'https://horosam.com/producto/horos-patrimonio/' },
    { key: 'hpp', name: 'Horos Internacional, PP', short: 'Internacional PP', isin: 'DGS N5263', kind: 'Plan de pensiones individual', api: '5a72ee1de80f510f3c273aed', url: 'https://horosam.com/planes-de-pensiones/' },
    { key: 'hppe', name: 'Horos Internacional Empleo, PPE', short: 'Internacional Empleo', isin: '', kind: 'Plan de pensiones de empleo', api: '649d7e1165569400089ec6f8', url: 'https://horosam.com/planes-de-pensiones/' },
    { key: 'hppes', name: 'Horos Internacional Autónomos, PPES', short: 'Internacional Autónomos', isin: '', kind: 'Plan de pensiones autónomos', api: '65f1e33cb391e502edcc575f', url: 'https://horosam.com/planes-de-pensiones/' },
  ];
  async function horosNav(fund) {
    const j = await fetchJSON(`https://horosam.com/api/pricesLast_${fund.api}.json`);
    if (!(j.price > 0)) throw new Error('VL no válido');
    const d = j.dateAsString; // AAAAMMDD
    return { nav: j.price, date: d ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : j.date.slice(0, 10) };
  }

  global.Providers = { COINS, prices, btcAddress, btcExtKey, ethAddress, solAddress, HOROS_FUNDS, horosNav };
})(window);
