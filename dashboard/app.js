// Token Radar v2 — the dashboard. Reads window.RADAR from data.js next door and renders
// the board. Nothing on this page fetches the network: no external scripts, no images,
// no links out. Every figure comes from the sealed snapshot.
//
// THE MODEL (radar-3), written out so the board can be audited from this file alone:
//   comparable multiple = median market-cap / TVL of the category's live tokens,
//     shrunk toward the global median with a prior of 5, clamped to [0.05, 2.5];
//     a category with fewer than 2 live tokens uses the global median.
//   growth    = 1 + clamp(7d change, -50..+150) / 100 * 0.6
//   maturity  = 0.6 + 0.4 * min(age_days, 1460) / 1460
//   chains    = 1 + 0.04 * min(chains - 1, 5)
//   implied   = max(1, round(TVL * multiple * growth * maturity * chains)), capped at $1e14.
// A token row's board value is its MARKET CAP, never a model estimate; the model estimate
// is shown beside it as a calibration check. Board: 470 rows — 342 pre-token valued by
// the model, 128 traded tokens valued by the market, 288 protocols left off for lack of
// a value anchor (272 have a token but no market cap; 16 have a market cap of zero or less).
// The board's top launch candidate is Steakhouse Financial, implied $522M.
//
// COMPARABLES is the display copy of the category table the model computed from the
// sealed snapshot (same numbers as data.js's comparables; the build refuses a mismatch):
// [category, live traded tokens, median mcap/TVL, multiple actually used].
'use strict';

const MODEL = {
  version: 'radar-3',
  globalMedian: 0.2138,
  shrinkPrior: 5,
  multipleLow: 0.05,
  multipleHigh: 2.5,
  minLiveComparables: 2,
  growthSlope: 0.6,
  growthLow: -50,
  growthHigh: 150,
  maturityLow: 0.6,
  maturityHigh: 1.0,
  maturityHorizonDays: 1460,
  defaultAgeDays: 365,
  chainPerExtra: 0.04,
  chainCapExtra: 5,
  impliedFloor: 1,
  impliedCap: 1e14,
};

// Calibration, checked against the 128 traded tokens: the model's median absolute
// log error is 1.331 (typically within a factor of ~3.8 of the market cap) and 27.3%
// of estimates land within 2x of the market. The model ranks launches; it does not
// price them, and the board says so rather than hiding it.
const CALIBRATION = { tokenRows: 128, medianAbsLogRatio: 1.331, within2x: 0.273 };
const EXCLUDED = { noValueAnchor: 272, mcapNotPositive: 16 };

const COMPARABLES = [
  ['AI Agents', 2, 0.6047, 0.3255],
  ['Algo-Stables', 0, 0.2138, 0.2138],
  ['Anchor BTC', 0, 0.2138, 0.2138],
  ['Basis Trading', 7, 0.6544, 0.4708],
  ['Bridge', 6, 0.5567, 0.4008],
  ['CDP', 3, 0.1687, 0.1969],
  ['CDP Manager', 0, 0.2138, 0.2138],
  ['CEX', 9, 0.0748, 0.1244],
  ['Canonical Bridge', 8, 0.7464, 0.5416],
  ['CeDeFi', 0, 0.2138, 0.2138],
  ['Chain', 1, 3.0264, 0.2138],
  ['Collateral Management', 1, 12.1602, 0.2138],
  ['Collateral Markets', 0, 0.2138, 0.2138],
  ['Cross Chain Bridge', 4, 1.2205, 0.6612],
  ['Crypto Card Issuer', 0, 0.2138, 0.2138],
  ['DOR', 1, 0.0898, 0.2138],
  ['Decentralized AI', 1, 2.0604, 0.2138],
  ['Decentralized BTC', 0, 0.2138, 0.2138],
  ['Derivatives', 2, 2.1619, 0.7704],
  ['Dexs', 11, 0.3424, 0.3022],
  ['Dual-Token Stablecoin', 1, 0.0316, 0.2138],
  ['Farm', 0, 0.2138, 0.2138],
  ['Governance Incentives', 0, 0.2138, 0.2138],
  ['Indexes', 3, 0.1477, 0.189],
  ['Insurance', 0, 0.2138, 0.2138],
  ['Interest Rate Derivatives', 0, 0.2138, 0.2138],
  ['Launchpad', 1, 0.1306, 0.2138],
  ['Lending', 15, 0.1324, 0.1528],
  ['Leveraged Farming', 1, 0.1725, 0.2138],
  ['Liquid Restaking', 2, 0.1828, 0.2049],
  ['Liquid Staking', 9, 0.0406, 0.1025],
  ['Liquidity Manager', 1, 0.015, 0.2138],
  ['NFT Marketplace', 1, 2.0017, 0.2138],
  ['OTC Marketplace', 0, 0.2138, 0.2138],
  ['Onchain Capital Allocator', 2, 0.0125, 0.1563],
  ['Options', 1, 1.5145, 0.2138],
  ['Options Vault', 0, 0.2138, 0.2138],
  ['Payments', 2, 0.1813, 0.2045],
  ['Prediction Market', 1, 400.2045, 0.2138],
  ['Privacy', 3, 0.9691, 0.497],
  ['RWA', 9, 0.2748, 0.253],
  ['Reserve Currency', 0, 0.2138, 0.2138],
  ['Restaked BTC', 0, 0.2138, 0.2138],
  ['Restaking', 2, 0.0246, 0.1597],
  ['Risk Curators', 1, 2.9747, 0.2138],
  ['Stablecoin Issuer', 0, 0.2138, 0.2138],
  ['Stablecoin Wrapper', 0, 0.2138, 0.2138],
  ['Staking Pool', 2, 0.0018, 0.1532],
  ['Synthetics', 0, 0.2138, 0.2138],
  ['Token Locker', 2, 9.5204, 2.5],
  ['Uncollateralized Lending', 0, 0.2138, 0.2138],
  ['Yield', 9, 0.1914, 0.1994],
  ['Yield Aggregator', 4, 0.151, 0.1859],
];

const DATA = window.RADAR;
const $ = (id) => document.getElementById(id);

function fmtMoney(usd) {
  if (usd === null || usd === undefined) return '—';
  if (usd >= 1e12) return `$${(usd / 1e12).toFixed(2)}T`;
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(2)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(1)}M`;
  if (usd >= 1e3) return `$${(usd / 1e3).toFixed(1)}K`;
  return `$${Math.round(usd)}`;
}
function fmtPct(n) {
  if (n === null || n === undefined) return '—';
  const s = (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
  return `<span class="${n >= 0 ? 'up' : 'down'}">${s}</span>`;
}
function fmtAge(days) {
  if (days === null || days === undefined) return '—';
  if (days >= 365) return `${(days / 365).toFixed(1)}y`;
  return `${days}d`;
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
function round4(n) { return Math.round(n * 1e4) / 1e4; }

// --- State: the hash drives the view, so a link opens one exact view. ---
const state = { tab: 'launch', q: '', cat: '', chain: '', mintvl: 0, sort: 'value', watch: false, detail: null };
function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('tab')) state.tab = h.get('tab');
  if (h.get('q') !== null) state.q = h.get('q');
  if (h.get('cat') !== null) state.cat = h.get('cat');
  if (h.get('chain') !== null) state.chain = h.get('chain');
  if (h.get('mintvl') !== null) state.mintvl = Number(h.get('mintvl'));
  if (h.get('sort')) state.sort = h.get('sort');
  state.watch = h.get('watch') === '1';
  state.detail = h.get('detail');
}
function writeHash() {
  const h = new URLSearchParams();
  h.set('tab', state.tab);
  if (state.q) h.set('q', state.q);
  if (state.cat) h.set('cat', state.cat);
  if (state.chain) h.set('chain', state.chain);
  h.set('mintvl', String(state.mintvl));
  if (state.sort !== 'value') h.set('sort', state.sort);
  if (state.watch) h.set('watch', '1');
  if (state.detail) h.set('detail', state.detail);
  history.replaceState(null, '', `#${h.toString()}`);
}

function visibleRows() {
  let rows = DATA.rows;
  if (state.tab === 'launch') rows = rows.filter((r) => r.launch);
  else if (state.tab === 'pre') rows = rows.filter((r) => r.token_status === 'pre-token');
  else if (state.tab === 'token') rows = rows.filter((r) => r.token_status === 'token');
  if (state.watch) rows = rows.filter((r) => r.watchlisted);
  if (state.cat) rows = rows.filter((r) => r.category === state.cat);
  if (state.chain) rows = rows.filter((r) => r.chains.includes(state.chain));
  if (state.mintvl > 0) rows = rows.filter((r) => r.tvl_usd >= state.mintvl);
  if (state.q) {
    const q = state.q.toLowerCase();
    rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q));
  }
  const by = {
    value: (a, b) => b.implied_value_usd - a.implied_value_usd,
    tvl: (a, b) => b.tvl_usd - a.tvl_usd,
    growth: (a, b) => (b.change_7d ?? -1e9) - (a.change_7d ?? -1e9),
    age: (a, b) => (b.age_days ?? -1) - (a.age_days ?? -1),
  }[state.sort] || ((a, b) => b.implied_value_usd - a.implied_value_usd);
  return [...rows].sort(by);
}

// --- Static sections: stats, spotlight, comparables, calibration, notes. ---
function renderStats() {
  const stats = [
    ['Board rows', DATA.rows.length],
    ['Launch candidates', DATA.launch_count],
    ['Tokens trading', DATA.token_count],
    ['Total board value', fmtMoney(DATA.total_board_value_usd)],
  ];
  $('stats').innerHTML = stats.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
  $('asof').textContent = DATA.as_of;
  $('asof2').textContent = DATA.as_of;
  $('calibration').textContent =
    `Calibration: against the ${CALIBRATION.tokenRows} traded tokens the model's median absolute log error is ` +
    `${CALIBRATION.medianAbsLogRatio} — typically within a factor of about ${Math.exp(CALIBRATION.medianAbsLogRatio).toFixed(1)} of the market cap, ` +
    `and ${(CALIBRATION.within2x * 100).toFixed(1)}% of estimates land within 2x of the market. The model ranks launches; it does not price them.`;
  $('excluded-note').textContent =
    `${DATA.excluded_count} protocols are not on the board because they have no value anchor: ` +
    `${EXCLUDED.noValueAnchor} have a token but no market cap, and ${EXCLUDED.mcapNotPositive} have a market cap of zero or less. ` +
    `They are omitted rather than invented — a board that guesses their value would be prettier and less honest.`;
}

function renderSpotlight() {
  const top = DATA.top_launch[0].implied_value_usd;
  $('spotlight').innerHTML = DATA.top_launch.slice(0, 3).map((r, i) => `
    <article class="spot" data-slug="${esc(r.slug)}" tabindex="0">
      <div class="rank">Launch #${i + 1} · ${esc(r.category)}</div>
      <h3>${esc(r.name)}</h3>
      <div class="value">${fmtMoney(r.implied_value_usd)}</div>
      <span class="vbar" style="margin-left:0;width:100%"><i style="width:${Math.max(8, Math.round(100 * r.implied_value_usd / top))}%"></i></span>
      <p>TVL ${fmtMoney(r.tvl_usd)} · 7d ${r.change_7d === null ? '—' : (r.change_7d >= 0 ? '+' : '') + r.change_7d.toFixed(1) + '%'} · ${r.chains.length} chains</p>
      <p>Multiple ${r.model.comparable_multiple.toFixed(3)} from ${r.model.comparable_count} live ${esc(r.category)} token${r.model.comparable_count === 1 ? '' : 's'}</p>
    </article>`).join('');
}

function renderComparables() {
  $('comparables').querySelector('tbody').innerHTML = COMPARABLES.map(([cat, live, med, used]) => `
    <tr><td>${esc(cat)}</td><td class="num">${live}</td><td class="num">${med.toFixed(4)}</td><td class="num">${used.toFixed(4)}</td></tr>`).join('');
}

function renderHistogram(rows) {
  const el = $('hist');
  if (rows.length === 0) { el.innerHTML = ''; return; }
  const buckets = [0, 0, 0, 0, 0, 0, 0];
  const edges = [1e6, 1e7, 1e8, 1e9, 1e10, 1e11];
  for (const r of rows) {
    let i = 0;
    while (i < edges.length && r.tvl_usd >= edges[i]) i += 1;
    buckets[i] += 1;
  }
  const labels = ['< $1M', '$1–10M', '$10–100M', '$100M–1B', '$1–10B', '$10–100B', '> $100B'];
  const max = Math.max(...buckets, 1);
  const w = 1120, h = 76, bw = w / 7;
  let bars = '';
  buckets.forEach((n, i) => {
    const bh = Math.max(2, (n / max) * 40);
    const top = 58 - bh;
    bars += `<rect x="${(i * bw + 6).toFixed(0)}" y="${top.toFixed(0)}" width="${(bw - 12).toFixed(0)}" height="${bh.toFixed(0)}" rx="3" fill="${i >= 3 ? '#0e4b4b' : '#c2700a'}" opacity="0.85"/>` +
      `<text x="${(i * bw + bw / 2).toFixed(0)}" y="${Math.max(12, top - 5).toFixed(0)}" text-anchor="middle" font-weight="700" fill="#1c2420">${n}</text>` +
      `<text x="${(i * bw + bw / 2).toFixed(0)}" y="72" text-anchor="middle">${esc(labels[i])}</text>`;
  });
  el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="TVL distribution"><text x="0" y="12">TVL of the rows shown — most of the board sits above $100M</text>${bars}</svg>`;
}

function renderControls() {
  const cats = [...new Set(DATA.rows.map((r) => r.category))].sort();
  $('cat').innerHTML = '<option value="">All categories</option>' + cats.map((c) => `<option>${esc(c)}</option>`).join('');
  const chains = [...new Set(DATA.rows.flatMap((r) => r.chains))].sort();
  $('chain').innerHTML = '<option value="">All chains</option>' + chains.map((c) => `<option>${esc(c)}</option>`).join('');
}

// --- The board table. ---
function statusBadge(r) {
  if (r.token_status === 'token') return '<span class="badge token">TOKEN TRADES</span>';
  if (r.launch) return '<span class="badge pre">PRE-TOKEN</span> <span class="badge launch">LAUNCH</span>';
  return '<span class="badge pre">PRE-TOKEN</span> <span class="badge no">NOT A LAUNCH</span>';
}
function renderBoard() {
  const rows = visibleRows();
  const maxLog = Math.log10(DATA.rows[0].implied_value_usd);
  const barWidth = (v) => Math.max(4, Math.round((100 * Math.log10(Math.max(v, 1))) / maxLog));
  $('count').textContent = `${rows.length} row${rows.length === 1 ? '' : 's'} shown — ${state.tab === 'launch' ? 'launch candidates only' : state.tab === 'pre' ? 'all pre-token protocols' : state.tab === 'token' ? 'tokens that already trade' : 'the whole board'} · sorted by ${state.sort === 'value' ? 'implied value' : state.sort === 'tvl' ? 'TVL' : state.sort === 'growth' ? '7d change' : 'age'}`;
  $('empty').hidden = rows.length > 0;
  $('board').querySelector('tbody').innerHTML = rows.map((r) => `
    <tr data-slug="${esc(r.slug)}" class="${state.detail === r.slug ? 'selected' : ''} ${r.token_status === 'token' ? 'token-row' : ''}">
      <td class="num">${r.rank}</td>
      <td class="name">${esc(r.name)}<small>${esc(r.slug)}${r.watchlisted ? ' · watchlist' : ''}</small></td>
      <td>${esc(r.category)}</td>
      <td>${esc(r.chains.slice(0, 3).join(', '))}${r.chains.length > 3 ? ` +${r.chains.length - 3}` : ''}</td>
      <td class="num">${fmtMoney(r.tvl_usd)}</td>
      <td class="num">${fmtPct(r.change_7d)}</td>
      <td class="num">${fmtAge(r.age_days)}</td>
      <td class="num"><strong>${fmtMoney(r.implied_value_usd)}</strong><span class="vbar"><i style="width:${barWidth(r.implied_value_usd)}%"></i></span></td>
      <td>${statusBadge(r)}</td>
    </tr>`).join('');
  renderHistogram(rows);
}

// --- The detail view: every model input, a recompute check, the farm plan. ---
function recompute(row) {
  // Same arithmetic as the model in lib/model.ts, with the same 4-decimal rounding,
  // so the number below matches the board value to the dollar.
  const m = row.model;
  const growth = round4(1 + (clamp(m.change_7d ?? 0, MODEL.growthLow, MODEL.growthHigh) / 100) * MODEL.growthSlope);
  const maturity = round4(MODEL.maturityLow + ((MODEL.maturityHigh - MODEL.maturityLow) * Math.min(m.maturity_days ?? m.age_days ?? MODEL.defaultAgeDays, MODEL.maturityHorizonDays)) / MODEL.maturityHorizonDays);
  const chains = round4(1 + MODEL.chainPerExtra * Math.min(Math.max(m.chains_count - 1, 0), MODEL.chainCapExtra));
  return Math.min(MODEL.impliedCap, Math.max(MODEL.impliedFloor, Math.round(m.tvl_usd * m.comparable_multiple * growth * maturity * chains)));
}
function renderDetail() {
  const el = $('detail');
  const row = DATA.rows.find((r) => r.slug === state.detail);
  if (!row) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  const m = row.model;
  const growth = round4(1 + (clamp(m.change_7d ?? 0, MODEL.growthLow, MODEL.growthHigh) / 100) * MODEL.growthSlope);
  const maturity = round4(MODEL.maturityLow + ((MODEL.maturityHigh - MODEL.maturityLow) * Math.min(m.maturity_days ?? m.age_days ?? MODEL.defaultAgeDays, MODEL.maturityHorizonDays)) / MODEL.maturityHorizonDays);
  const chains = round4(1 + MODEL.chainPerExtra * Math.min(Math.max(m.chains_count - 1, 0), MODEL.chainCapExtra));
  const recomputed = recompute(row);
  const compRow = COMPARABLES.find(([c]) => c === m.category);
  const compNote = compRow
    ? `Its category, ${esc(m.category)}, has ${compRow[1]} live token${compRow[1] === 1 ? '' : 's'}; the median multiple is ${compRow[2].toFixed(4)} and the model used ${compRow[3].toFixed(4)}${compRow[1] < 2 ? ' — the global median, because one token cannot price a category' : ''}.`
    : '';
  const steps = row.farm_steps.map((s, i) => {
    const m = s.match(/^(.*?) Cost: (.*?) Time: (.*)$/);
    const body = m ? `${esc(m[1])} <span class="cost">Cost: ${esc(m[2])}</span> <span class="time">Time: ${esc(m[3])}</span>` : esc(s);
    return `<li><strong>Step ${i + 1}.</strong> ${body}</li>`;
  }).join('');
  const wl = row.watchlisted
    ? DATA.rows.filter((r) => r.watchlisted && r.launch && r.slug !== row.slug).slice(0, 6)
    : [];
  const wlStrip = wl.length > 0
    ? `<div class="watch-strip"><span class="label">Also on the watchlist:</span>${wl.map((r) => `<button class="chip" data-slug="${esc(r.slug)}">${esc(r.name)} · <b>${fmtMoney(r.implied_value_usd)}</b></button>`).join('')}</div>`
    : '';
  el.innerHTML = `
    <h2>${esc(row.name)} <span class="badge ${row.token_status === 'token' ? 'token' : 'pre'}">${row.token_status === 'token' ? 'TOKEN TRADES' : 'PRE-TOKEN'}</span> ${row.launch ? '<span class="badge launch">LAUNCH CANDIDATE</span>' : ''}</h2>
    <p>Rank #${row.rank} of ${DATA.rows.length} · ${esc(row.category)} · ${esc(row.chains.slice(0, 4).join(', '))}${row.chains.length > 4 ? ` +${row.chains.length - 4}` : ''} · TVL ${fmtMoney(row.tvl_usd)} · 7d ${row.change_7d === null ? '—' : (row.change_7d >= 0 ? '+' : '') + row.change_7d.toFixed(1) + '%'} · age ${fmtAge(row.age_days)}</p>
    ${row.token_status === 'token' ? `
      <p class="token-note"><strong>This token already trades.</strong> Its board value is the market cap, ${fmtMoney(row.mcap_usd)}, never a model estimate. The model would price it at ${fmtMoney(row.model_usd)} — ${row.model_vs_market.toFixed(2)}x the market — shown only as a calibration check. The farm plan below is for the ongoing incentives, not a launch.</p>` : ''}
    ${row.not_launch_reason ? `<p class="flag"><strong>Not a launch candidate:</strong> ${esc(row.not_launch_reason)}. It stays on the board because its implied value is real — but the farm plan below is how to use the protocol, not how to farm a launch that does not exist.</p>` : ''}
    <dl class="grid">
      <div><dt>Implied value</dt><dd>${fmtMoney(row.implied_value_usd)}<small>${row.token_status === 'token' ? 'market cap' : 'model estimate'}</small></dd></div>
      <div><dt>TVL</dt><dd>${fmtMoney(m.tvl_usd)}<small>snapshot</small></dd></div>
      <div><dt>Category multiple</dt><dd>${m.comparable_multiple.toFixed(4)}<small>${m.comparable_count} live comparable${m.comparable_count === 1 ? '' : 's'}</small></dd></div>
      <div><dt>7d growth</dt><dd>${m.change_7d === null ? '—' : (m.change_7d >= 0 ? '+' : '') + m.change_7d.toFixed(1) + '%'}<small>growth factor ${growth.toFixed(3)}</small></dd></div>
      <div><dt>Age</dt><dd>${fmtAge(m.age_days)}<small>maturity factor ${maturity.toFixed(3)}</small></dd></div>
      <div><dt>Chains</dt><dd>${m.chains_count}<small>chain factor ${chains.toFixed(3)}</small></dd></div>
      <div><dt>Model check</dt><dd>${fmtMoney(recomputed)} recomputed<small>${recomputed === row.implied_value_usd ? 'matches the board value' : row.token_status === 'token' ? 'model estimate — the board uses the market cap' : 'differs — check the model'}</small></dd></div>
      <div><dt>Board rank</dt><dd>#${row.rank}<small>of ${DATA.rows.length} rows</small></dd></div>
    </dl>
    <p class="check-line"><strong>How this number was made:</strong> ${fmtMoney(m.tvl_usd)} TVL × ${m.comparable_multiple.toFixed(4)} category multiple × ${growth.toFixed(3)} growth × ${maturity.toFixed(3)} maturity × ${chains.toFixed(3)} chains = ${fmtMoney(recomputed)}. ${compNote}</p>
    <table class="raw">
      <thead><tr><th>Model input</th><th>Figure</th><th>Factor</th></tr></thead>
      <tbody>
        <tr><td>TVL (snapshot ${esc(DATA.as_of)})</td><td class="num">${fmtMoney(m.tvl_usd)}</td><td class="num">—</td></tr>
        <tr><td>Category multiple, ${esc(m.category)}</td><td class="num">${m.comparable_multiple.toFixed(4)}</td><td class="num">${m.comparable_count} live comparables; median ${compRow ? compRow[2].toFixed(4) : '—'}</td></tr>
        <tr><td>7d change</td><td class="num">${m.change_7d === null ? '—' : (m.change_7d >= 0 ? '+' : '') + m.change_7d.toFixed(1) + '%'}</td><td class="num">${growth.toFixed(3)}</td></tr>
        <tr><td>Age</td><td class="num">${m.age_days === null ? 'unknown — 365d assumed' : fmtAge(m.age_days)}</td><td class="num">${maturity.toFixed(3)}</td></tr>
        <tr><td>Chains</td><td class="num">${m.chains_count}</td><td class="num">${chains.toFixed(3)}</td></tr>
        <tr><td><strong>${row.token_status === 'token' ? 'Model estimate (board uses the market cap)' : 'Implied value'}</strong></td><td class="num"><strong>${fmtMoney(recomputed)}</strong></td><td class="num">${row.token_status === 'token' ? `market cap ${fmtMoney(row.mcap_usd)} · model ${row.model_vs_market.toFixed(2)}x market` : 'capped at $100T, floored at $1'}</td></tr>
      </tbody>
    </table>
    <h3>Farm plan — 10 steps, every step with a cost and a time</h3>
    <ol>${steps}</ol>
    ${wlStrip}
    <p><a href="#" id="close-detail">Close this detail</a></p>`;
  $('close-detail').addEventListener('click', (ev) => {
    ev.preventDefault();
    state.detail = null;
    writeHash();
    renderBoard();
    renderDetail();
  });
}

// --- Wiring. ---
function syncControls() {
  document.querySelectorAll('#tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === state.tab)));
  $('q').value = state.q;
  $('cat').value = state.cat;
  $('chain').value = state.chain;
  $('mintvl').value = String(state.mintvl);
  $('sort').value = state.sort;
  $('watch').checked = state.watch;
}
function render() {
  syncControls();
  renderStats();
  renderSpotlight();
  renderComparables();
  renderBoard();
  renderDetail();
}
function init() {
  readHash();
  renderControls();
  document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => {
    state.tab = b.dataset.tab; state.detail = null; writeHash(); render();
  }));
  $('q').addEventListener('input', (e) => { state.q = e.target.value; writeHash(); renderBoard(); renderDetail(); });
  $('cat').addEventListener('change', (e) => { state.cat = e.target.value; writeHash(); renderBoard(); renderDetail(); });
  $('chain').addEventListener('change', (e) => { state.chain = e.target.value; writeHash(); renderBoard(); renderDetail(); });
  $('mintvl').addEventListener('change', (e) => { state.mintvl = Number(e.target.value); writeHash(); renderBoard(); renderDetail(); });
  $('sort').addEventListener('change', (e) => { state.sort = e.target.value; writeHash(); renderBoard(); renderDetail(); });
  $('watch').addEventListener('change', (e) => { state.watch = e.target.checked; writeHash(); renderBoard(); renderDetail(); });
  $('board').querySelector('tbody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-slug]');
    if (!tr) return;
    state.detail = tr.dataset.slug;
    writeHash();
    renderBoard();
    renderDetail();
    $('detail').scrollIntoView({ block: 'start' });
  });
  $('spotlight').addEventListener('click', (e) => {
    const card = e.target.closest('[data-slug]');
    if (!card) return;
    state.detail = card.dataset.slug;
    writeHash();
    renderBoard();
    renderDetail();
    $('detail').scrollIntoView({ block: 'start' });
  });
  $('detail').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip[data-slug]');
    if (!chip) return;
    state.detail = chip.dataset.slug;
    writeHash();
    renderBoard();
    renderDetail();
    $('detail').scrollIntoView({ block: 'start' });
  });
  render();
  // A link that opens a detail view scrolls it into the frame on load,
  // so a screenshot of the link shows the detail, not the top of the page.
  if (state.detail) setTimeout(() => $('detail').scrollIntoView({ block: 'start' }), 120);
}
if (typeof DATA === 'undefined' || !DATA.rows) {
  document.body.innerHTML = '<main><p>The board data did not load.</p></main>';
} else {
  init();
}
