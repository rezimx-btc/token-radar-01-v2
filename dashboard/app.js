// Launch Radar v2 dashboard. Reads window.RADAR (written beside dashboard/ by main.ts) and renders the
// ranked board, the KPI strip, the model-and-validation panel, a per-protocol detail drawer with the
// model's own inputs and the protocol's costed farm plan, and the live-token tab. No network: every
// byte it shows is in data.js. State lives in the URL hash so a view can be linked and screenshotted.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  app.setAttribute('aria-busy', 'false');
  var MODEL = DATA.model;
  var state = { q: '', category: 'all', verdict: 'all', tab: 'pre-token', sort: 'implied', selected: null };

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtOdds(o) { return (o * 100).toFixed(1) + '%'; }

  // The model in one function: the page recomputes a row from the snapshot figures and checks the
  // number data.js carries, so the page's code and the board's data are visibly the same arithmetic.
  // launch = exp(a + b ln TVL) x growth x maturity x exp(category adjustment); implied = launch x odds.
  function launchOf(row) {
    var growth = Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, row.change_7d === null ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * MODEL.growth_weight;
    var age = row.age_days === null ? MODEL.unknown_age_days : row.age_days;
    var maturity = MODEL.maturity_floor + (Math.min(Math.max(age, 0), MODEL.maturity_days) / MODEL.maturity_days) * MODEL.maturity_range;
    var curve = Math.exp(MODEL.log_intercept + MODEL.log_slope * Math.log(row.tvl_usd));
    return Math.max(1, Math.round(curve * growthMult * maturity * Math.exp(row.category_adjustment || 0)));
  }
  function impliedOf(row) { return Math.max(1, Math.round(launchOf(row) * row.launch_odds)); }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: capital tier by TVL, hold by
  // age, verdict from net value per farmer, category action. Regenerated here so the detail view and
  // the board can never disagree about what a farm costs.
  function capitalFor(row) {
    if (row.tvl_usd >= 5000000000) return 250;
    if (row.tvl_usd >= 1000000000) return 150;
    if (row.tvl_usd >= 100000000) return 100;
    return 50;
  }
  function holdFor(row) {
    var age = row.age_days === null ? 365 : row.age_days;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function farmersFor(row) {
    return Math.min(MODEL.farmers_max, Math.max(MODEL.farmers_min, Math.round(row.tvl_usd / MODEL.farmers_per_tvl_usd)));
  }
  function actionFor(row, capital, chain) {
    var c = (row.category || '').toLowerCase();
    var name = row.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + '\'s main pool on ' + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake $' + capital + ' of the chain\'s staking asset through ' + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + ' of the protocol\'s yield asset on ' + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function farmSteps(row) {
    var capital = capitalFor(row);
    var hold = holdFor(row);
    var chain = row.chains && row.chains.length > 0 ? row.chains[0] : 'its main chain';
    var perFarmer = row.net_farmer_usd + row.farm_cost_usd;
    var cost0 = row.farm_cost_usd.toFixed(0);
    var verdictLine;
    if (row.verdict === 'FARM') verdictLine = 'Verdict FARM: about $' + Math.round(perFarmer) + ' of expected value per farmer against about $' + cost0 + ' of cost, net about $' + Math.round(row.net_farmer_usd) + '.';
    else if (row.verdict === 'THIN') verdictLine = 'Verdict THIN: about $' + Math.round(perFarmer) + ' of expected value per farmer against about $' + cost0 + ' of cost, net about $' + Math.round(row.net_farmer_usd) + '; farm small or wait for a better entry.';
    else verdictLine = 'Verdict SKIP: about $' + Math.round(perFarmer) + ' of expected value per farmer against about $' + cost0 + ' of cost, net about $' + Math.round(row.net_farmer_usd) + '; the farm does not pay for itself at this size.';
    return [
      { text: verdictLine + ' Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(row, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: 'Before you withdraw, open the protocol\'s own points or rewards page and claim only from the link it publishes.', cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ];
  }

  // ---- Hash state: #tab, #q, #cat, #verdict, #sort, #detail=slug ----
  // Query state (?shot=board|detail|filtered&detail=<slug>&verdict=FARM) is for
  // deep-linked views and the entry's own screenshots: in shot mode the long
  // model/integrity panels hide so the requested view sits in the first viewport.
  var shotMode = null;
  function readQuery() {
    var search = window.location.search.replace(/^\?/, '');
    if (!search) return;
    var params = new URLSearchParams(search);
    shotMode = params.get('shot');
    if (params.get('detail')) state.selected = params.get('detail');
    if (params.get('verdict')) state.verdict = params.get('verdict');
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('cat')) state.category = params.get('cat');
    if (params.get('sort')) state.sort = params.get('sort');
  }
  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    state.q = params.get('q') || '';
    state.category = params.get('cat') || 'all';
    state.verdict = params.get('verdict') || 'all';
    state.tab = params.get('tab') || 'pre-token';
    state.sort = params.get('sort') || 'implied';
    state.selected = params.get('detail') || null;
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('cat', state.category);
    if (state.verdict !== 'all') params.set('verdict', state.verdict);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.sort !== 'implied') params.set('sort', state.sort);
    if (state.selected) params.set('detail', state.selected);
    var s = params.toString();
    if (window.history.replaceState) {
      window.history.replaceState(null, '', s ? '#' + s : window.location.pathname + window.location.search);
    }
  }

  // ---- KPI strip, validation table, accounted line ----
  function renderKpis() {
    var kpis = document.getElementById('kpis');
    var vc = DATA.verdict_counts || {};
    var tiles = [
      { k: 'Protocols in snapshot', n: String(DATA.rows.length + DATA.live_total + DATA.excluded_total), d: '758 frozen at fetch' },
      { k: 'Ranked pre-token', n: String(DATA.board_size), d: DATA.watchlist_size + ' watchlist + ' + DATA.early_size + ' early' },
      { k: 'Total expected value', n: fmtUsd(DATA.total_expected_usd), d: 'sum of implied values' },
      { k: 'Farm verdicts', n: (vc.FARM || 0) + ' / ' + (vc.THIN || 0) + ' / ' + (vc.SKIP || 0), d: 'FARM / THIN / SKIP' },
      { k: 'Already trading', n: String(DATA.live_total), d: 'record a token; top ' + DATA.live_size + ' shown' },
      { k: 'Excluded with reason', n: String(DATA.excluded_total), d: 'wrapped / staked / bridged / versioned' },
      { k: 'Median launch odds', n: fmtOdds(medianOf(DATA.rows.map(function (r) { return r.launch_odds; }))), d: 'category x age peers' },
      { k: 'Top row implied', n: fmtUsd(DATA.rows.length ? DATA.rows[0].implied_value_usd : 0), d: DATA.rows.length ? DATA.rows[0].name : '' }
    ];
    kpis.innerHTML = '';
    tiles.forEach(function (t) {
      kpis.appendChild(el('div', { class: 'kpi' },
        el('div', { class: 'k', text: t.k }), el('div', { class: 'n', text: t.n }), el('div', { class: 'd', text: t.d })));
    });
    document.getElementById('source-line').textContent = 'Source: ' + DATA.source + ' — as of ' + DATA.as_of + ', floor $' + DATA.floor_usd.toLocaleString('en-US') + '.';
    document.getElementById('asof-badge').textContent = 'as of ' + DATA.as_of + ' · model ' + DATA.model_version;
    var accounted = document.getElementById('accounted-line');
    var parts = Object.keys(DATA.excluded_by_reason || {}).sort().map(function (k) { return DATA.excluded_by_reason[k] + ' ' + k; });
    accounted.textContent = 'Accounted for: ' + DATA.board_size + ' ranked + ' + DATA.live_total + ' already trading + ' +
      DATA.excluded_total + ' excluded (' + parts.join('; ') + ') = ' +
      (DATA.board_size + DATA.live_total + DATA.excluded_total) + ' of ' +
      (DATA.rows.length + DATA.live_total + DATA.excluded_total) + ' protocols in the snapshot.';
    var tbody = document.querySelector('#valid-table tbody');
    tbody.innerHTML = '';
    var meanS = 0, meanF = 0;
    (DATA.validation || []).forEach(function (t) {
      meanS += t.starter_med_log_err; meanF += t.fitted_med_log_err;
      var better = Math.round((1 - t.fitted_med_log_err / t.starter_med_log_err) * 100);
      tbody.appendChild(el('tr', {},
        el('td', { text: t.name }), el('td', { text: String(t.n_test) }),
        el('td', { text: t.starter_med_log_err.toFixed(3) }),
        el('td', { class: 'better', text: t.fitted_med_log_err.toFixed(3) }),
        el('td', { class: 'better', text: better + '% lower' })));
    });
    if (DATA.validation && DATA.validation.length) {
      meanS /= DATA.validation.length; meanF /= DATA.validation.length;
      document.getElementById('valid-note').textContent = 'Mean across the ' + DATA.validation.length +
        ' tests: fitted ' + meanF.toFixed(3) + ' vs starter ' + meanS.toFixed(3) +
        ' median |log error| — about ' + Math.round((1 - meanF / meanS) * 100) +
        '% lower. A log error of 1.2 means the typical launch value lands within about a factor of 3.3 of the real market cap.';
    }
  }
  function medianOf(values) {
    if (!values.length) return 0;
    var s = values.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(s.length / 2);
    return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  // ---- Board, filters, live tab ----
  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var rows = DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || '') !== state.category) return false;
      if (state.verdict !== 'all' && r.verdict !== state.verdict) return false;
      if (q) {
        var hay = (r.name + ' ' + (r.category || '') + ' ' + r.chains.join(' ') + ' ' + r.slug).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    var key = state.sort;
    rows.sort(function (a, b) {
      var va = key === 'launch' ? a.launch_value_usd : key === 'odds' ? a.launch_odds : key === 'tvl' ? a.tvl_usd : key === 'net' ? a.net_farmer_usd : a.implied_value_usd;
      var vb = key === 'launch' ? b.launch_value_usd : key === 'odds' ? b.launch_odds : key === 'tvl' ? b.tvl_usd : key === 'net' ? b.net_farmer_usd : b.implied_value_usd;
      return vb - va || (a.slug < b.slug ? -1 : 1);
    });
    return rows;
  }
  function renderBoard() {
    var tbody = document.querySelector('#board-table tbody');
    tbody.innerHTML = '';
    var rows = state.tab === 'live' ? [] : filteredRows();
    rows.forEach(function (r) {
      var tr = el('tr', { 'data-slug': r.slug, onclick: function () { select(r.slug); } });
      if (state.selected === r.slug) tr.className = 'sel';
      tr.appendChild(el('td', { class: 'num', text: String(r.rank) }));
      tr.appendChild(el('td', { class: 'name' }, document.createTextNode(r.name), el('small', { text: r.slug })));
      tr.appendChild(el('td', { text: r.category || '—' }));
      tr.appendChild(el('td', { text: r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') }));
      tr.appendChild(el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }));
      tr.appendChild(el('td', { class: 'num', text: fmtPct(r.change_7d) }));
      tr.appendChild(el('td', { class: 'num', text: fmtAge(r.age_days) }));
      tr.appendChild(el('td', { class: 'num', text: fmtUsd(r.launch_value_usd) }));
      tr.appendChild(el('td', { class: 'odds', text: fmtOdds(r.launch_odds) }));
      tr.appendChild(el('td', { class: 'num', text: fmtUsd(r.implied_value_usd) }));
      var vtd = el('td', {});
      vtd.appendChild(el('span', { class: 'verdict ' + r.verdict, text: r.verdict }));
      tr.appendChild(vtd);
      tr.appendChild(el('td', { class: 'num', text: (r.net_farmer_usd >= 0 ? '+' : '') + '$' + Math.round(r.net_farmer_usd) }));
      tbody.appendChild(tr);
    });
    document.getElementById('board-table').hidden = state.tab === 'live';
    document.getElementById('live-table').hidden = state.tab !== 'live';
    document.getElementById('empty-line').hidden = state.tab === 'live' || rows.length > 0;
    document.getElementById('count-line').textContent = state.tab === 'live'
      ? 'Showing the top ' + DATA.live.length + ' of ' + DATA.live_total + ' protocols that already trade, by market cap. They are the comparables the curve was fitted on — never mixed into the ranked board.'
      : 'Showing ' + rows.length + ' of ' + DATA.rows.length + ' ranked protocols' +
        (state.sort !== 'implied' ? ' (sorted by ' + state.sort + ')' : ' (ranked by implied value)') + '. Click a row for its detail and farm plan.';
    if (state.tab === 'live') renderLive();
  }
  function renderLive() {
    var tbody = document.querySelector('#live-table tbody');
    tbody.innerHTML = '';
    DATA.live.forEach(function (p, i) {
      var tr = el('tr', {});
      tr.appendChild(el('td', { class: 'num', text: String(i + 1) }));
      tr.appendChild(el('td', { class: 'name' }, document.createTextNode(p.name), el('small', { text: p.slug })));
      tr.appendChild(el('td', { text: p.category || '—' }));
      tr.appendChild(el('td', { text: p.chains.slice(0, 3).join(', ') }));
      tr.appendChild(el('td', { class: 'num', text: fmtUsd(p.tvl_usd) }));
      tr.appendChild(el('td', { class: 'num', text: fmtUsd(p.mcap_usd) }));
      tr.appendChild(el('td', { class: 'num', text: fmtPct(p.change_7d) }));
      tbody.appendChild(tr);
    });
  }

  // ---- Detail drawer ----
  function select(slug) {
    state.selected = slug;
    writeHash();
    renderBoard();
    renderDetail();
    if (slug) {
      var d = document.getElementById('detail');
      if (d && d.scrollIntoView) d.scrollIntoView({ block: 'nearest' });
    }
  }
  function renderDetail() {
    var box = document.getElementById('detail');
    var row = null;
    if (state.selected) {
      for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === state.selected) { row = DATA.rows[i]; break; }
    }
    if (!row) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = '';
    var check = impliedOf(row);
    var agrees = check === row.implied_value_usd;
    box.appendChild(el('button', { class: 'close', text: 'Close', onclick: function () { select(null); } }));
    box.appendChild(el('h2', {}, document.createTextNode('#' + row.rank + ' ' + row.name + ' '),
      el('small', { text: row.slug + ' · ' + (row.category || 'no category') + ' · ' + row.chains.join(', ') })));
    box.appendChild(el('p', {},
      el('span', { class: 'verdict ' + row.verdict, text: row.verdict }),
      document.createTextNode('  Implied value ' + fmtUsd(row.implied_value_usd) + ' = launch value ' + fmtUsd(row.launch_value_usd) +
        ' × launch odds ' + fmtOdds(row.launch_odds) + '. Net per farmer ' +
        (row.net_farmer_usd >= 0 ? '+' : '') + '$' + Math.round(row.net_farmer_usd) + ' against $' + row.farm_cost_usd.toFixed(2) + ' of cost.')));
    var grid = el('div', { class: 'grid' });
    grid.appendChild(el('div', { class: 'cell' }, el('div', { class: 'k', text: 'TVL' }), el('div', { class: 'n', text: fmtUsd(row.tvl_usd) })));
    grid.appendChild(el('div', { class: 'cell' }, el('div', { class: 'k', text: '7d change' }), el('div', { class: 'n', text: fmtPct(row.change_7d) })));
    grid.appendChild(el('div', { class: 'cell' }, el('div', { class: 'k', text: 'Age, no token' }), el('div', { class: 'n', text: fmtAge(row.age_days) })));
    grid.appendChild(el('div', { class: 'cell' }, el('div', { class: 'k', text: 'Category adj.' }), el('div', { class: 'n', text: (row.category_adjustment >= 0 ? '+' : '') + row.category_adjustment.toFixed(3) + ' log' })));
    grid.appendChild(el('div', { class: 'cell' }, el('div', { class: 'k', text: 'Growth mult.' }), el('div', { class: 'n', text: '×' + row.growth_multiplier.toFixed(3) })));
    grid.appendChild(el('div', { class: 'cell' }, el('div', { class: 'k', text: 'Maturity mult.' }), el('div', { class: 'n', text: '×' + row.maturity_multiplier.toFixed(3) })));
    grid.appendChild(el('div', { class: 'cell' }, el('div', { class: 'k', text: 'Launch value' }), el('div', { class: 'n', text: fmtUsd(row.launch_value_usd) })));
    grid.appendChild(el('div', { class: 'cell' }, el('div', { class: 'k', text: 'Est. farmers' }), el('div', { class: 'n', text: farmersFor(row).toLocaleString('en-US') })));
    box.appendChild(grid);
    box.appendChild(el('p', { class: 'note' }, 'Model check: this page recomputes the implied value from the row’s own figures as ' +
      fmtUsd(check) + ' — ' + (agrees ? 'it agrees with board.json.' : 'it differs from board.json; do not trust this row.')));
    box.appendChild(el('h3', { text: 'Farm plan — costed, ' + holdFor(row) + ' days, $' + capitalFor(row) + ' of capital' }));
    var ol = el('ol', { class: 'steps' });
    farmSteps(row).forEach(function (s) {
      var li = el('li', {});
      li.appendChild(el('b', { text: s.text + ' ' }));
      li.appendChild(document.createTextNode('Cost: ' + s.cost + '. Time: ' + s.time + '.'));
      ol.appendChild(li);
    });
    box.appendChild(ol);
    box.appendChild(el('p', { class: 'note' }, '“Records no token” is DefiLlama’s record, not proof: verify on the protocol’s own page before you deposit anything, and never pay to claim.'));
  }

  // ---- Wire up controls, then render ----
  function init() {
    readQuery();
    readHash();
    if (shotMode) document.body.classList.add('shot');
    if (shotMode === 'detail') {
      var controls = document.getElementById('controls');
      var detail = document.getElementById('detail');
      if (controls && detail) controls.parentNode.insertBefore(detail, controls);
    }
    var cats = [];
    DATA.rows.forEach(function (r) { if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category); });
    cats.sort();
    var catSel = document.getElementById('cat');
    cats.forEach(function (c) { catSel.appendChild(el('option', { value: c, text: c })); });
    var q = document.getElementById('q');
    q.value = state.q;
    q.addEventListener('input', function () { state.q = q.value; writeHash(); renderBoard(); });
    catSel.value = state.category;
    catSel.addEventListener('change', function () { state.category = catSel.value; writeHash(); renderBoard(); });
    var vSel = document.getElementById('verdict');
    vSel.value = state.verdict;
    vSel.addEventListener('change', function () { state.verdict = vSel.value; writeHash(); renderBoard(); });
    var sSel = document.getElementById('sort');
    sSel.value = state.sort;
    sSel.addEventListener('change', function () { state.sort = sSel.value; writeHash(); renderBoard(); });
    document.getElementById('tab-pre').addEventListener('click', function () { state.tab = 'pre-token'; writeHash(); render(); });
    document.getElementById('tab-live').addEventListener('click', function () { state.tab = 'live'; writeHash(); render(); });
    render();
  }
  function render() {
    document.getElementById('tab-pre').className = 'tab' + (state.tab === 'pre-token' ? ' active' : '');
    document.getElementById('tab-live').className = 'tab' + (state.tab === 'live' ? ' active' : '');
    renderKpis();
    renderBoard();
    renderDetail();
  }
  init();
})();
