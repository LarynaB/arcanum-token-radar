(() => {
  const data = window.__TOKEN_RADAR__;
  const root = document.getElementById('app');
  if (!data || !root) {
    if (root) root.textContent = 'Missing radar data (../data.js).';
    return;
  }

  const state = {
    search: '',
    tier: 'all', // all | watchlist | early_radar
    category: 'all',
    chain: 'all',
    sortKey: 'rank', // rank | implied_value_usd | tvl_usd | change_7d | effective_multiple | age_days
    sortDir: 'asc',
    selectedSlug: null,
  };

  // Support URL hash presets for reproducible views (e.g. #detail=gauntlet or #tier=watchlist&sort=change_7d&dir=desc)
  function applyHash() {
    const raw = window.location.hash.replace(/^#/, '');
    if (!raw) return;
    const params = new URLSearchParams(raw);
    if (params.has('tier')) state.tier = params.get('tier');
    if (params.has('category')) state.category = params.get('category');
    if (params.has('chain')) state.chain = params.get('chain');
    if (params.has('search')) state.search = params.get('search');
    if (params.has('sort')) state.sortKey = params.get('sort');
    if (params.has('dir')) state.sortDir = params.get('dir');
    if (params.has('detail')) state.selectedSlug = params.get('detail');
  }
  applyHash();

  function fmtUsd(n) {
    if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
    return `$${n}`;
  }

  function fmtPct(n) {
    if (n === null || n === undefined) return '—';
    return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getFiltered() {
    const q = state.search.trim().toLowerCase();
    const out = data.rows.filter((r) => {
      if (state.tier !== 'all' && r.tier !== state.tier) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && !r.chains.includes(state.chain)) return false;
      if (q && !r.name.toLowerCase().includes(q) && !r.slug.includes(q) && !r.category.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });

    const dir = state.sortDir === 'asc' ? 1 : -1;
    out.sort((a, b) => {
      const av = a[state.sortKey] ?? -999999;
      const bv = b[state.sortKey] ?? -999999;
      if (av === bv) return a.rank - b.rank;
      return av < bv ? -dir : dir;
    });
    return out;
  }

  function renderDetail(row) {
    if (!row) return '';
    const peersHtml =
      row.peers.length > 0
        ? row.peers
            .map(
              (p) => `
          <div class="peer-card">
            <div>
              <div class="peer-name">${esc(p.name)} <span class="peer-sub">(${esc(p.symbol)})</span></div>
              <div class="peer-sub">TVL ${fmtUsd(p.tvl_usd)} · MCap ${fmtUsd(p.mcap_usd)}</div>
            </div>
            <div class="peer-mult">${p.multiple.toFixed(2)}x</div>
          </div>`,
            )
            .join('')
        : `<div class="proto-meta">No direct live-token peers in ${esc(row.category)}; shrunk to global median (${data.global_median_multiple.toFixed(2)}x).</div>`;

    const stepsHtml = row.farm_plan
      .map(
        (s, idx) => `
      <div class="step-item">
        <div class="step-top">
          <span class="step-num">STEP ${idx + 1}</span>
          <div class="step-tags">
            <span class="step-tag">${esc(s.cost)}</span>
            <span class="step-tag">${esc(s.horizon)}</span>
          </div>
        </div>
        <div class="step-text">${esc(s.step)}</div>
      </div>`,
      )
      .join('');

    return `
      <aside class="detail-card">
        <div class="detail-head">
          <div>
            <div class="brand-kicker">Rank #${row.rank} · ${row.tier === 'watchlist' ? 'Watchlist ($50M+)' : 'Early Radar'} · ${esc(row.category)}</div>
            <h2 class="detail-title">${esc(row.name)}</h2>
            <div class="proto-meta">${esc(row.chains.join(' · '))} · Listed ${esc(row.listed_at ?? 'Unknown')} (${row.age_days}d tokenless)</div>
          </div>
          <button class="close-btn" data-action="close-detail">Close</button>
        </div>

        <div class="section-label">Empirical Valuation Waterfall</div>
        <div class="waterfall">
          <div class="wf-box"><div class="wf-k">TVL</div><div class="wf-v">${fmtUsd(row.tvl_usd)}</div></div>
          <div class="wf-box"><div class="wf-k">Peer Mult</div><div class="wf-v">${row.peer_multiple.toFixed(2)}x</div></div>
          <div class="wf-box"><div class="wf-k">7d Mom</div><div class="wf-v">${row.momentum_mult.toFixed(2)}x</div></div>
          <div class="wf-box"><div class="wf-k">Maturity</div><div class="wf-v">${row.maturity_mult.toFixed(2)}x</div></div>
          <div class="wf-box"><div class="wf-k">Implied FDV</div><div class="wf-v" style="color:var(--emerald)">${fmtUsd(row.implied_value_usd)}</div></div>
        </div>
        <div class="formula-line">
          ${fmtUsd(row.tvl_usd)} × ${row.peer_multiple.toFixed(3)} (peer) × ${row.momentum_mult.toFixed(3)} (7d) × ${row.maturity_mult.toFixed(3)} (age) × ${row.chain_mult.toFixed(3)} (chains) = <strong>${fmtUsd(row.implied_value_usd)}</strong>
        </div>

        <div class="section-label">Concrete Farm Plan (${esc(row.est_capital)} · ${esc(row.est_horizon)})</div>
        <div class="step-list">${stepsHtml}</div>

        <div class="section-label">Live-Token Category Peers (${esc(row.category)})</div>
        <div class="peer-grid">${peersHtml}</div>
      </aside>`;
  }

  function render() {
    const rows = getFiltered();
    const selected = state.selectedSlug ? data.rows.find((r) => r.slug === state.selectedSlug) ?? null : null;
    const totalPreTvl = rows.reduce((acc, r) => acc + r.tvl_usd, 0);
    const totalImplied = rows.reduce((acc, r) => acc + r.implied_value_usd, 0);
    const topVal = data.rows[0]?.implied_value_usd ?? 1;
    const fastest = [...rows].filter((r) => r.change_7d !== null).sort((a, b) => b.change_7d - a.change_7d)[0];

    const sortArrow = (k) => (state.sortKey === k ? (state.sortDir === 'asc' ? ' ▲' : ' ▼') : '');
    const sortCls = (k) => (state.sortKey === k ? 'active-sort' : '');

    const tableRows = rows
      .slice(0, 80)
      .map((r) => {
        const chgCls = r.change_7d === null ? 'flat' : r.change_7d > 0 ? 'pos' : r.change_7d < 0 ? 'neg' : 'flat';
        const barPct = Math.max(4, Math.min(100, Math.round((Math.log10(r.implied_value_usd) / Math.log10(topVal)) * 100)));
        const convCls = r.conviction === 'High' ? 'badge-high' : r.conviction === 'Medium' ? 'badge-med' : 'badge-spec';
        return `
        <tr data-slug="${esc(r.slug)}" class="${selected && selected.slug === r.slug ? 'selected' : ''}">
          <td class="num">#${r.rank}</td>
          <td>
            <span class="proto-name">${esc(r.name)}</span>
            <span class="proto-meta">${esc(r.category)} · ${esc(r.chains.slice(0, 2).join(', '))}${r.chains.length > 2 ? ` +${r.chains.length - 2}` : ''}</span>
          </td>
          <td><span class="badge ${r.tier === 'watchlist' ? 'badge-wl' : 'badge-early'}">${r.tier === 'watchlist' ? 'Watchlist' : 'Early'}</span></td>
          <td class="num">
            <div class="val-bar-wrap">
              <strong>${fmtUsd(r.implied_value_usd)}</strong>
              <div class="val-bar"><div class="val-bar-fill" style="width:${barPct}%"></div></div>
            </div>
          </td>
          <td class="num">${fmtUsd(r.tvl_usd)}</td>
          <td class="num ${chgCls}">${fmtPct(r.change_7d)}</td>
          <td class="num">${r.effective_multiple.toFixed(2)}x</td>
          <td><span class="badge ${convCls}">${r.conviction}</span></td>
          <td class="proto-meta">${esc(r.est_capital)} · ${esc(r.est_horizon)}</td>
        </tr>`;
      })
      .join('');

    root.innerHTML = `
      <header class="topbar">
        <div>
          <div class="brand-kicker">Token Launch Radar · Empirical Peer-Multiple Model</div>
          <h1 class="brand-title">Pre-Token Protocol Valuation &amp; Farm Board</h1>
          <p class="brand-sub">Ranks ${data.rows.length} pre-token protocols (${data.watchlist_count} watchlist + ${data.rows.length - data.watchlist_count} early radar) using live-token category multiples from ${data.live_token_count} DefiLlama peers.</p>
        </div>
        <div class="meta-pills">
          <span class="pill">Snapshot <strong>${esc(data.as_of)}</strong></span>
          <span class="pill">Watchlist Floor <strong>${fmtUsd(data.floor_usd)}</strong></span>
          <span class="pill">Global Peer Median <strong>${data.global_median_multiple.toFixed(2)}x</strong></span>
        </div>
      </header>

      <section class="kpis">
        <div class="kpi">
          <div class="kpi-label">Filtered Pre-Token TVL</div>
          <div class="kpi-val">${fmtUsd(totalPreTvl)}</div>
          <div class="kpi-sub">${rows.length} protocols in view (${rows.filter((r) => r.tier === 'watchlist').length} watchlist)</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">Aggregate Implied FDV</div>
          <div class="kpi-val" style="color:var(--cyan)">${fmtUsd(totalImplied)}</div>
          <div class="kpi-sub">Derived strictly from TVL × peer × 7d × age × chains</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">Top 7d TVL Momentum</div>
          <div class="kpi-val pos">${fastest ? fmtPct(fastest.change_7d) : '—'}</div>
          <div class="kpi-sub">${fastest ? `${esc(fastest.name)} (${fmtUsd(fastest.tvl_usd)} TVL)` : 'No momentum data'}</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">Live-Token Separation</div>
          <div class="kpi-val">${data.live_token_count}</div>
          <div class="kpi-sub">Live tokens excluded from board &amp; used as valuation comps</div>
        </div>
      </section>

      <section class="controls">
        <input id="q" class="search-input" type="search" placeholder="Search protocol, slug, category..." value="${esc(state.search)}" />
        <div class="tier-group">
          <button class="tier-btn ${state.tier === 'all' ? 'active' : ''}" data-tier="all">All (${data.rows.length})</button>
          <button class="tier-btn ${state.tier === 'watchlist' ? 'active' : ''}" data-tier="watchlist">Watchlist (${data.watchlist_count})</button>
          <button class="tier-btn ${state.tier === 'early_radar' ? 'active' : ''}" data-tier="early_radar">Early Radar (${data.rows.length - data.watchlist_count})</button>
        </div>
        <select id="cat" class="select-input">
          <option value="all">All Categories</option>
          ${data.categories.map((c) => `<option value="${esc(c)}" ${state.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
        </select>
        <select id="chain" class="select-input">
          <option value="all">All Chains</option>
          ${data.chains.map((c) => `<option value="${esc(c)}" ${state.chain === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
        </select>
        <span class="result-count">Showing ${Math.min(rows.length, 80)} of ${rows.length}</span>
        <button class="reset-btn" data-action="reset">Reset</button>
      </section>

      <main class="workspace ${selected ? 'has-detail' : ''}">
        <div class="board-card">
          <table>
            <thead>
              <tr>
                <th class="num ${sortCls('rank')}" data-sort="rank">Rank${sortArrow('rank')}</th>
                <th>Protocol</th>
                <th>Tier</th>
                <th class="num ${sortCls('implied_value_usd')}" data-sort="implied_value_usd">Implied FDV${sortArrow('implied_value_usd')}</th>
                <th class="num ${sortCls('tvl_usd')}" data-sort="tvl_usd">TVL${sortArrow('tvl_usd')}</th>
                <th class="num ${sortCls('change_7d')}" data-sort="change_7d">7d TVL${sortArrow('change_7d')}</th>
                <th class="num ${sortCls('effective_multiple')}" data-sort="effective_multiple">Eff. Mult${sortArrow('effective_multiple')}</th>
                <th>Conviction</th>
                <th>Farm Budget</th>
              </tr>
            </thead>
            <tbody>${tableRows}</tbody>
          </table>
        </div>
        ${renderDetail(selected)}
      </main>

      <footer class="footer-note">
        <span>Data: ${esc(data.source)}</span>
        <span>Note: "Records no token" reflects DefiLlama snapshot metadata; implied FDV is a model estimate, not investment advice.</span>
      </footer>
    `;

    // Wire events
    const qEl = document.getElementById('q');
    if (qEl) {
      qEl.addEventListener('input', (e) => {
        const pos = e.target.selectionStart;
        state.search = e.target.value;
        render();
        const nextQ = document.getElementById('q');
        if (nextQ) {
          nextQ.focus();
          if (typeof pos === 'number') nextQ.setSelectionRange(pos, pos);
        }
      });
    }
    const catEl = document.getElementById('cat');
    if (catEl) {
      catEl.addEventListener('change', (e) => {
        state.category = e.target.value;
        render();
      });
    }
    const chainEl = document.getElementById('chain');
    if (chainEl) {
      chainEl.addEventListener('change', (e) => {
        state.chain = e.target.value;
        render();
      });
    }
    root.querySelectorAll('[data-tier]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.tier = btn.getAttribute('data-tier');
        render();
      });
    });
    root.querySelectorAll('[data-sort]').forEach((th) => {
      th.addEventListener('click', () => {
        const key = th.getAttribute('data-sort');
        if (state.sortKey === key) {
          state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.sortKey = key;
          state.sortDir = key === 'rank' ? 'asc' : 'desc';
        }
        render();
      });
    });
    root.querySelectorAll('tbody tr[data-slug]').forEach((tr) => {
      tr.addEventListener('click', () => {
        state.selectedSlug = tr.getAttribute('data-slug');
        render();
      });
    });
    const closeBtn = root.querySelector('[data-action="close-detail"]');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        state.selectedSlug = null;
        render();
      });
    }
    const resetBtn = root.querySelector('[data-action="reset"]');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        state.search = '';
        state.tier = 'all';
        state.category = 'all';
        state.chain = 'all';
        state.sortKey = 'rank';
        state.sortDir = 'asc';
        state.selectedSlug = null;
        render();
      });
    }
  }

  render();
})();
