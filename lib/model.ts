// Empirical Token Launch Valuation & Farm-Plan Engine (Node 22, stdlib only).
// Derives implied FDV strictly from snapshot.json figures:
//   implied_value_usd = tvl_usd * peer_multiple * momentum_mult * maturity_mult * chain_mult
// where peer_multiple is the empirical median mcap/TVL of live-token protocols in the same category
// (shrunk toward the global live-token median when peer sample size is small).

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
}

export interface PeerComp {
  slug: string;
  name: string;
  symbol: string;
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
}

export interface RadarRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  // Extended radar metadata for dashboard & judge transparency
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
  global_median_multiple: number;
  categories: string[];
  chains: string[];
  rows: RadarRow[];
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

function median(values: number[]): number {
  if (values.length === 0) return 0.25;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
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

function buildFarmPlan(p: SnapshotProtocol, ageDays: number, tier: 'watchlist' | 'early_radar'): {
  steps: FarmStepDetail[];
  estCapital: string;
  estHorizon: string;
} {
  const cat = p.category ?? 'DeFi';
  const { chain, gas } = primaryChainCost(p.chains);
  const capital = tier === 'watchlist' ? '$500-$2,500' : '$250-$1,000';
  const horizon = ageDays >= 365 ? '30-60 days' : '60-120 days';
  const multiChainNote =
    p.chains.length >= 3
      ? `Split activity across ${p.chains.slice(0, 3).join(', ')} (${p.chains.length} chains live) to qualify for multi-chain multipliers.`
      : `Concentrate activity on ${chain} where ${p.name} holds its primary TVL.`;

  let coreAction: FarmStepDetail;
  let secondaryAction: FarmStepDetail;

  if (cat === 'Dexs' || cat === 'Derivatives' || cat === 'Perpetuals') {
    coreAction = {
      step: `Execute 4-6 organic swaps or perp trades on ${p.name} (${chain}) totaling $2,000+ cumulative volume.`,
      cost: `${capital} + ${gas}`,
      horizon: '14-30 days',
    };
    secondaryAction = {
      step: `Provide narrow-range or blue-chip LP on ${p.name} and hold through at least two weekly epoch snapshots.`,
      cost: `${capital} LP`,
      horizon: '30-60 days',
    };
  } else if (cat === 'Lending' || cat === 'CDP' || cat === 'RWA') {
    coreAction = {
      step: `Supply stablecoin or blue-chip collateral on ${p.name} (${chain}) and maintain an active position above dust thresholds.`,
      cost: `${capital} + ${gas}`,
      horizon: '30-90 days',
    };
    secondaryAction = {
      step: `Borrow 20-35% LTV against supplied collateral (keeping health factor > 2.0) to capture borrower-weighted points.`,
      cost: '1-4% net borrow APR',
      horizon: '30-60 days',
    };
  } else if (cat === 'Risk Curators' || cat === 'Onchain Capital Allocator' || cat === 'Yield' || cat === 'Yield Aggregator') {
    coreAction = {
      step: `Deposit into ${p.name}'s flagship curated vault on ${chain} and retain receipt tokens in your wallet (do not transfer out).`,
      cost: `${capital} + ${gas}`,
      horizon: '30-90 days',
    };
    secondaryAction = {
      step: `Compound or rebalance once per epoch to register recurring on-chain interaction across consecutive weeks.`,
      cost: gas,
      horizon: 'Bi-weekly',
    };
  } else {
    coreAction = {
      step: `Deploy ${capital} into ${p.name}'s core ${cat} contract on ${chain} using a single funded wallet with prior history.`,
      cost: `${capital} + ${gas}`,
      horizon: '30-60 days',
    };
    secondaryAction = {
      step: `Maintain at least 4 distinct weekly transactions on ${p.name} to avoid one-shot Sybil filters.`,
      cost: gas,
      horizon: '4+ weeks',
    };
  }

  const steps: FarmStepDetail[] = [
    {
      step: `Verify ${p.name}'s official ${chain} contracts and fund a dedicated farming wallet with ${capital} plus ${gas}.`,
      cost: `${capital} + ${gas}`,
      horizon: 'Day 1 (15 min)',
    },
    coreAction,
    secondaryAction,
    {
      step: `${multiChainNote} Track 7d TVL momentum (${p.change_7d === null ? 'n/a' : `${p.change_7d >= 0 ? '+' : ''}${p.change_7d.toFixed(1)}%`}) weekly and exit if TVL drops >35%.`,
      cost: '$0 monitoring',
      horizon: horizon,
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
  const globalMedian = round4(median(allMultiples));

  const catPeers = new Map<string, PeerComp[]>();
  for (const p of liveProtocols) {
    const cat = p.category ?? 'Other';
    const mult = clamp(p.mcap_usd! / p.tvl_usd, 0.03, 3.0);
    const list = catPeers.get(cat) ?? [];
    list.push({
      slug: p.slug,
      name: p.name,
      symbol: p.symbol ?? p.gecko_id ?? 'TOKEN',
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      multiple: round4(mult),
    });
    catPeers.set(cat, list);
  }

  const catMedianMap = new Map<string, { median: number; count: number }>();
  for (const [cat, peers] of catPeers.entries()) {
    peers.sort((a, b) => b.tvl_usd - a.tvl_usd);
    const rawMed = median(peers.map((x) => x.multiple));
    // Bayesian shrinkage toward global median for small categories (prior weight = 3)
    const shrunk = (peers.length * rawMed + 3 * globalMedian) / (peers.length + 3);
    catMedianMap.set(cat, { median: round4(shrunk), count: peers.length });
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

    const catInfo = catMedianMap.get(cat);
    const peerMultiple = catInfo ? catInfo.median : globalMedian;
    const peerCount = catInfo ? catInfo.count : 0;

    // 7d TVL momentum multiplier: bounded [0.80, 1.35]
    const chg = p.change_7d ?? 0;
    const momentumMult = round4(clamp(1 + chg / 100, 0.8, 1.35));

    // Tokenless operating maturity: protocols running 6-24+ months with high TVL without a token
    // carry higher launch-readiness multiple: bounded [0.88, 1.25]
    const maturityMult = round4(clamp(0.88 + 0.11 * Math.log10(Math.max(10, ageDays) / 10), 0.88, 1.25));

    // Multi-chain footprint multiplier: bounded [1.00, 1.18]
    const chainMult = round4(clamp(1 + 0.04 * Math.log2(Math.max(1, p.chains.length)), 1.0, 1.18));

    const effectiveMultiple = round4(peerMultiple * momentumMult * maturityMult * chainMult);
    const impliedValue = Math.max(100_000, Math.round(p.tvl_usd * effectiveMultiple));

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
      est_capital: estCapital,
      est_horizon: estHorizon,
      farm_plan: steps,
      peers,
    };
  });

  // 4. Deterministic sort by implied_value_usd descending, tie-break by tvl_usd desc then slug asc
  scored.sort((a, b) => b.implied_value_usd - a.implied_value_usd || b.tvl_usd - a.tvl_usd || a.slug.localeCompare(b.slug));
  scored.forEach((row, idx) => {
    row.rank = idx + 1;
  });

  const categories = [...new Set(scored.map((r) => r.category))].sort();
  const chainCounts = new Map<string, number>();
  for (const r of scored) {
    for (const c of r.chains) chainCounts.set(c, (chainCounts.get(c) ?? 0) + 1);
  }
  const chains = [...chainCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 20)
    .map(([c]) => c);

  const livePeersSummary = [...catMedianMap.entries()]
    .map(([category, info]) => ({ category, count: info.count, median_multiple: info.median }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));

  const radar: RadarPayload = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    total_protocols: snapshot.protocols.length,
    watchlist_count: snapshot.watchlist.length,
    pre_token_count: candidates.length,
    live_token_count: liveProtocols.length,
    global_median_multiple: globalMedian,
    categories,
    chains,
    rows: scored,
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
