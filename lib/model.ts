// Empirical Token Launch Valuation & Farm-Plan Engine v2 (Node 22, stdlib only).
// Derives implied FDV + Bear/Base/Bull range strictly from snapshot.json figures:
//   implied_value_usd = tvl_usd * peer_multiple * momentum_mult * maturity_mult * chain_mult
// Peer multiples (P25 / P50 / P75) are computed empirically from live-token protocols in the same category,
// with Bayesian shrinkage toward global live-token percentiles when peer sample size is small.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface FarmStepDetail {
  step: string;
  cost: string;
  horizon: string;
  priority: 'Core' | 'Multiplier' | 'Guardrail';
}

export interface PeerComp {
  slug: string;
  name: string;
  symbol: string;
  category: string;
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
  change_7d: number | null;
}

export interface RadarRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  // Extended model fields
  bear_value_usd: number;
  bull_value_usd: number;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number;
  tier: 'watchlist' | 'early_radar';
  peer_multiple: number;
  peer_count: number;
  momentum_mult: number;
  maturity_mult: number;
  chain_mult: number;
  effective_multiple: number;
  conviction: 'High' | 'Medium' | 'Speculative';
  catalyst_signal: string;
  est_capital: string;
  est_horizon: string;
  farm_plan: FarmStepDetail[];
  peers: PeerComp[];
}

export interface RadarPayload {
  as_of: string;
  source: string;
  floor_usd: number;
  total_protocols: number;
  watchlist_count: number;
  pre_token_count: number;
  live_token_count: number;
  global_p25: number;
  global_median_multiple: number;
  global_p75: number;
  categories: string[];
  top_categories: { category: string; count: number; tvl_usd: number }[];
  chains: string[];
  rows: RadarRow[];
  live_peers: PeerComp[];
  live_peers_summary: { category: string; count: number; median_multiple: number }[];
}

const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

export function parseSnapshot(raw: string): Snapshot {
  const data = JSON.parse(raw) as Snapshot;
  if (!data || !Array.isArray(data.protocols) || !Array.isArray(data.watchlist)) {
    throw new Error('Invalid snapshot.json structure');
  }
  return data;
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0.25;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const lo = sorted[base]!;
  const hi = sorted[Math.min(sorted.length - 1, base + 1)]!;
  return lo + rest * (hi - lo);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function daysBetween(asOf: string, listedAt: string | null): number {
  if (!listedAt) return 180;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 180;
  return Math.max(1, Math.round((a - b) / 86_400_000));
}

function isCleanPreToken(p: SnapshotProtocol, watchlistSet: Set<string>): boolean {
  if (watchlistSet.has(p.slug)) return true;
  if (p.gecko_id !== null || p.symbol !== null || p.mcap_usd !== null) return false;
  if (p.category && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (EXCHANGE_PREFIX.test(p.name) || WRAPPED_WORD.test(p.name) || VERSION_SUFFIX.test(p.name)) return false;
  return true;
}

function primaryChainCost(chains: string[]): { chain: string; gas: string } {
  const c = chains[0] ?? 'Ethereum';
  if (c === 'Ethereum') return { chain: c, gas: '$8-$25 gas' };
  if (c === 'Solana') return { chain: c, gas: '<$0.05 gas' };
  if (c === 'Base' || c === 'Arbitrum' || c === 'Optimism' || c === 'Polygon' || c === 'Avalanche') {
    return { chain: c, gas: '$0.10-$1.50 gas' };
  }
  return { chain: c, gas: '$0.25-$3.00 gas' };
}

function deriveCatalyst(p: SnapshotProtocol, ageDays: number, tier: 'watchlist' | 'early_radar'): string {
  const chg = p.change_7d ?? 0;
  if (tier === 'watchlist' && chg >= 5) return 'Watchlist TVL Surge';
  if (tier === 'watchlist' && ageDays >= 365) return 'Mature Tokenless Leader';
  if (chg >= 15) return 'Rapid 7d Inflow';
  if (p.chains.length >= 5) return 'Multi-Chain Expansion';
  if (ageDays >= 365) return 'Long Tokenless Runway';
  return 'Early TVL Accumulation';
}

function buildFarmPlan(p: SnapshotProtocol, ageDays: number, tier: 'watchlist' | 'early_radar'): {
  steps: FarmStepDetail[];
  estCapital: string;
  estHorizon: string;
} {
  const cat = p.category ?? 'DeFi';
  const { chain, gas } = primaryChainCost(p.chains);
  const capital = tier === 'watchlist' ? '$500-$2,500' : '$250-$1,000';
  const horizon = ageDays >= 365 ? '30-60 days' : '60-120 days';
  const chg = p.change_7d;
  const flowAdvice =
    chg !== null && chg >= 10
      ? `7d TVL jumped +${chg.toFixed(1)}% — enter early before points dilution accelerates.`
      : chg !== null && chg <= -10
        ? `7d TVL dipped ${chg.toFixed(1)}% — scale in over 2 tranches and cap exposure until TVL stabilizes.`
        : `7d TVL is steady (${chg === null ? 'n/a' : `${chg >= 0 ? '+' : ''}${chg.toFixed(1)}%`}) — ideal for steady epoch-weighted farming.`;

  const multiChainNote =
    p.chains.length >= 3
      ? `Split activity across ${p.chains.slice(0, 3).join(', ')} (${p.chains.length} chains live) to capture cross-chain multipliers.`
      : `Concentrate activity on ${chain} where ${p.name} holds its core TVL.`;

  let coreAction: FarmStepDetail;
  let secondaryAction: FarmStepDetail;

  if (cat === 'Dexs' || cat === 'Derivatives' || cat === 'Perpetuals') {
    coreAction = {
      step: `Execute 4-6 organic swaps or perp trades on ${p.name} (${chain}) totaling $2,000+ cumulative volume across separate days.`,
      cost: `${capital} + ${gas}`,
      horizon: '14-30 days',
      priority: 'Core',
    };
    secondaryAction = {
      step: `Provide blue-chip LP on ${p.name} and hold through at least two weekly epoch snapshots without withdrawing.`,
      cost: `${capital} LP`,
      horizon: '30-60 days',
      priority: 'Multiplier',
    };
  } else if (cat === 'Lending' || cat === 'CDP' || cat === 'RWA') {
    coreAction = {
      step: `Supply stablecoin or blue-chip collateral on ${p.name} (${chain}) above dust thresholds ($250+) to start accruing epoch weight.`,
      cost: `${capital} + ${gas}`,
      horizon: '30-90 days',
      priority: 'Core',
    };
    secondaryAction = {
      step: `Borrow 20-35% LTV against supplied collateral (keeping health factor > 2.0) to capture borrower-weighted points.`,
      cost: '1-4% net borrow APR',
      horizon: '30-60 days',
      priority: 'Multiplier',
    };
  } else if (cat === 'Risk Curators' || cat === 'Onchain Capital Allocator' || cat === 'Yield' || cat === 'Yield Aggregator') {
    coreAction = {
      step: `Deposit into ${p.name}'s flagship curated vault on ${chain} and keep receipt tokens in your wallet (avoid secondary transfers).`,
      cost: `${capital} + ${gas}`,
      horizon: '30-90 days',
      priority: 'Core',
    };
    secondaryAction = {
      step: `Compound or rebalance once per epoch to register recurring on-chain interaction across consecutive weeks.`,
      cost: gas,
      horizon: 'Bi-weekly',
      priority: 'Multiplier',
    };
  } else {
    coreAction = {
      step: `Deploy ${capital} into ${p.name}'s primary ${cat} contract on ${chain} from an established wallet with prior on-chain history.`,
      cost: `${capital} + ${gas}`,
      horizon: '30-60 days',
      priority: 'Core',
    };
    secondaryAction = {
      step: `Log at least 4 distinct weekly transactions on ${p.name} to clear standard Sybil and one-shot filters.`,
      cost: gas,
      horizon: '4+ weeks',
      priority: 'Multiplier',
    };
  }

  const steps: FarmStepDetail[] = [
    {
      step: `Verify ${p.name}'s official ${chain} contracts and fund a dedicated farming wallet with ${capital} plus ${gas}.`,
      cost: `${capital} + ${gas}`,
      horizon: 'Day 1 (15 min)',
      priority: 'Core',
    },
    coreAction,
    secondaryAction,
    {
      step: `${multiChainNote} ${flowAdvice} Exit if protocol TVL drops >35%.`,
      cost: '$0 monitoring',
      horizon: horizon,
      priority: 'Guardrail',
    },
  ];

  return { steps, estCapital: capital, estHorizon: horizon };
}

export function buildRadar(snapshot: Snapshot): { board: RadarRow[]; radar: RadarPayload } {
  const watchlistSet = new Set(snapshot.watchlist);

  // 1. Empirical peer multiples from live-token protocols in this exact snapshot
  const liveProtocols = snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && (p.gecko_id !== null || p.symbol !== null),
  );

  const allMultiples = liveProtocols.map((p) => clamp(p.mcap_usd! / p.tvl_usd, 0.03, 3.0));
  const globalP25 = round4(quantile(allMultiples, 0.25));
  const globalMedian = round4(quantile(allMultiples, 0.5));
  const globalP75 = round4(quantile(allMultiples, 0.75));

  const livePeersAll: PeerComp[] = [];
  const catPeers = new Map<string, PeerComp[]>();
  for (const p of liveProtocols) {
    const cat = p.category ?? 'Other';
    const mult = clamp(p.mcap_usd! / p.tvl_usd, 0.03, 3.0);
    const comp: PeerComp = {
      slug: p.slug,
      name: p.name,
      symbol: p.symbol ?? p.gecko_id ?? 'TOKEN',
      category: cat,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      multiple: round4(mult),
      change_7d: p.change_7d,
    };
    livePeersAll.push(comp);
    const list = catPeers.get(cat) ?? [];
    list.push(comp);
    catPeers.set(cat, list);
  }
  livePeersAll.sort((a, b) => b.mcap_usd - a.mcap_usd || a.slug.localeCompare(b.slug));

  const catStatsMap = new Map<string, { p25: number; p50: number; p75: number; count: number }>();
  for (const [cat, peers] of catPeers.entries()) {
    peers.sort((a, b) => b.tvl_usd - a.tvl_usd);
    const vals = peers.map((x) => x.multiple);
    const n = peers.length;
    const shrink = (raw: number, prior: number) => round4((n * raw + 3 * prior) / (n + 3));
    catStatsMap.set(cat, {
      p25: shrink(quantile(vals, 0.25), globalP25),
      p50: shrink(quantile(vals, 0.5), globalMedian),
      p75: shrink(quantile(vals, 0.75), globalP75),
      count: n,
    });
  }

  // 2. Select all 40 watchlist protocols + top 180 clean pre-token early protocols by TVL
  const candidates = snapshot.protocols.filter((p) => isCleanPreToken(p, watchlistSet));
  const watchlistProts = candidates.filter((p) => watchlistSet.has(p.slug));
  const earlyProts = candidates
    .filter((p) => !watchlistSet.has(p.slug))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || a.slug.localeCompare(b.slug))
    .slice(0, 180);

  const selected = [...watchlistProts, ...earlyProts];

  // 3. Score each protocol strictly from snapshot figures
  const scored: RadarRow[] = selected.map((p) => {
    const cat = p.category ?? 'Other';
    const tier: 'watchlist' | 'early_radar' = watchlistSet.has(p.slug) ? 'watchlist' : 'early_radar';
    const ageDays = daysBetween(snapshot.as_of, p.listed_at);

    const catInfo = catStatsMap.get(cat);
    const peerP25 = catInfo ? catInfo.p25 : globalP25;
    const peerMultiple = catInfo ? catInfo.p50 : globalMedian;
    const peerP75 = catInfo ? catInfo.p75 : globalP75;
    const peerCount = catInfo ? catInfo.count : 0;

    const chg = p.change_7d ?? 0;
    const momentumMult = round4(clamp(1 + chg / 100, 0.8, 1.35));
    const maturityMult = round4(clamp(0.88 + 0.11 * Math.log10(Math.max(10, ageDays) / 10), 0.88, 1.25));
    const chainMult = round4(clamp(1 + 0.04 * Math.log2(Math.max(1, p.chains.length)), 1.0, 1.18));

    const factor = momentumMult * maturityMult * chainMult;
    const effectiveMultiple = round4(peerMultiple * factor);
    const impliedValue = Math.max(100_000, Math.round(p.tvl_usd * effectiveMultiple));
    const bearValue = Math.max(50_000, Math.round(p.tvl_usd * peerP25 * factor));
    const bullValue = Math.max(impliedValue, Math.round(p.tvl_usd * peerP75 * factor));

    const conviction: 'High' | 'Medium' | 'Speculative' =
      tier === 'watchlist' && ageDays >= 180
        ? 'High'
        : tier === 'watchlist' || p.tvl_usd >= 20_000_000
          ? 'Medium'
          : 'Speculative';

    const { steps, estCapital, estHorizon } = buildFarmPlan(p, ageDays, tier);
    const farmSteps = steps.map((s) => `${s.step} [Cost: ${s.cost} | Horizon: ${s.horizon}]`);
    const peers = (catPeers.get(cat) ?? []).slice(0, 4);

    return {
      slug: p.slug,
      name: p.name,
      rank: 0,
      implied_value_usd: impliedValue,
      farm_steps: farmSteps,
      bear_value_usd: bearValue,
      bull_value_usd: bullValue,
      category: cat,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      age_days: ageDays,
      tier,
      peer_multiple: peerMultiple,
      peer_count: peerCount,
      momentum_mult: momentumMult,
      maturity_mult: maturityMult,
      chain_mult: chainMult,
      effective_multiple: effectiveMultiple,
      conviction,
      catalyst_signal: deriveCatalyst(p, ageDays, tier),
      est_capital: estCapital,
      est_horizon: estHorizon,
      farm_plan: steps,
      peers,
    };
  });

  scored.sort((a, b) => b.implied_value_usd - a.implied_value_usd || b.tvl_usd - a.tvl_usd || a.slug.localeCompare(b.slug));
  scored.forEach((row, idx) => {
    row.rank = idx + 1;
  });

  const catAgg = new Map<string, { count: number; tvl_usd: number }>();
  const chainCounts = new Map<string, number>();
  for (const r of scored) {
    const cur = catAgg.get(r.category) ?? { count: 0, tvl_usd: 0 };
    cur.count += 1;
    cur.tvl_usd += r.tvl_usd;
    catAgg.set(r.category, cur);
    for (const c of r.chains) chainCounts.set(c, (chainCounts.get(c) ?? 0) + 1);
  }

  const categories = [...catAgg.keys()].sort();
  const topCategories = [...catAgg.entries()]
    .map(([category, v]) => ({ category, count: v.count, tvl_usd: v.tvl_usd }))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || a.category.localeCompare(b.category))
    .slice(0, 8);

  const chains = [...chainCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 20)
    .map(([c]) => c);

  const livePeersSummary = [...catStatsMap.entries()]
    .map(([category, info]) => ({ category, count: info.count, median_multiple: info.p50 }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));

  const radar: RadarPayload = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    total_protocols: snapshot.protocols.length,
    watchlist_count: snapshot.watchlist.length,
    pre_token_count: candidates.length,
    live_token_count: liveProtocols.length,
    global_p25: globalP25,
    global_median_multiple: globalMedian,
    global_p75: globalP75,
    categories,
    top_categories: topCategories,
    chains,
    rows: scored,
    live_peers: livePeersAll,
    live_peers_summary: livePeersSummary,
  };

  return { board: scored, radar };
}

export function boardIssue(board: RadarRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `row count ${board.length} outside [100, 4000]`;
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  let prevVal = Infinity;
  let allSame = true;
  const firstVal = board[0]?.implied_value_usd;

  for (let i = 0; i < board.length; i++) {
    const r = board[i]!;
    if (!known.has(r.slug)) return `unknown slug ${r.slug}`;
    if (seen.has(r.slug)) return `duplicate slug ${r.slug}`;
    seen.add(r.slug);
    if (r.rank !== i + 1) return `rank mismatch at ${i}: got ${r.rank}`;
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `invalid implied_value_usd on ${r.slug}`;
    if (r.implied_value_usd > prevVal) return `non-monotonic implied_value_usd at rank ${r.rank}`;
    if (r.implied_value_usd !== firstVal) allSame = false;
    prevVal = r.implied_value_usd;
    if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) {
      return `invalid farm_steps count on ${r.slug}`;
    }
    for (const s of r.farm_steps) {
      const len = s.trim().length;
      if (len < 20 || len > 600) return `farm_step length ${len} out of range on ${r.slug}`;
    }
  }
  if (allSame) return 'all implied_value_usd values are identical';
  for (const w of snapshot.watchlist) {
    if (!seen.has(w)) return `missing watchlist slug ${w}`;
  }
  return null;
}

export function dataScript(radar: RadarPayload): string {
  return `window.__TOKEN_RADAR__ = ${JSON.stringify(radar)};\n`;
}
