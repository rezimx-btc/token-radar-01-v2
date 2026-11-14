// Radar-3: the valuation model behind the Token Radar board (v2).
//
// The board answers one question: if a protocol with no token today launched one
// tomorrow, what would it be worth, and what should an Agent ID holder do to farm
// the launch? The answer is computed from the sealed snapshot's own figures only —
// TVL, 7-day change, age since listing, and what the market already pays for
// issued tokens in the same category. No protocol name is ever hardcoded: the
// model has no list of names to prefer, so a new protocol scores on its numbers
// alone.
//
//   comparable multiple = median market-cap / TVL over the category's live tokens,
//     shrunk toward the global median with a prior of 5 protocols, clamped to
//     [0.05, 2.5]; a category with fewer than 2 live comparables never sets its
//     own price — it uses the global median (one outlier, however large, cannot
//     price a category)
//   growth    = 1 + clamp(change_7d, -50 %, +150 %) / 100 * 0.6
//   maturity  = 0.6 + 0.4 * min(age_days, 1460) / 1460      (age counts more than v1)
//   chains    = 1 + 0.04 * min(chains - 1, 5)
//   implied   = max(1, round(TVL * multiple * growth * maturity * chains)), capped $1e14
//
// A protocol whose token already trades has a market price, so its board value is
// its market cap, not a model estimate — and the board shows the model estimate
// next to the market cap as a calibration check. The board is therefore two
// populations on one scale: 342 pre-token protocols valued by the model, and the
// 128 traded tokens valued by the market. A row is never both.
//
// A protocol is a launch candidate ("Launch radar" view) only when it is
// pre-token AND passes the watchlist rule: it is not a bridge, a centralised
// exchange, a liquid-staking wrapper, a versioned pool, or a wrapped/staked
// token. Everything else pre-token is still on the board, flagged with the
// exact reason it is not a launch candidate, so the board never pretends a
// bridge or an exchange is a launch.

export const MODEL = {
  version: 'radar-3',
  watchlist_floor_usd: 50_000_000,
  /** A token's market cap is trusted only when both halves of the ratio exist. */
  live_requires: 'mcap_usd > 0 and tvl_usd > 0',
  /** Prior weight: the category median counts 5 protocols against the global median. */
  shrink_prior: 5,
  multiple: { clamp_low: 0.05, clamp_high: 2.5, min_live_comps: 2 },
  growth: { slope: 0.6, clip_low: -50, clip_high: 150 },
  maturity: { low: 0.6, high: 1.0, horizon_days: 1_460, default_age_days: 365 },
  chains: { per_extra: 0.04, cap_extra: 5 },
  implied: { floor_usd: 1, cap_usd: 1e14 },
} as const;

export interface ProtocolSnapshot {
  slug: string;
  name: string;
  symbol: string | null;
  gecko_id: string | null;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
}

export interface Snapshot {
  as_of: string;
  protocols: ProtocolSnapshot[];
  watchlist: string[];
}

export interface CategoryComparable {
  category: string;
  live_count: number;
  /** Median mcap/TVL of the category's live tokens; the global median when none. */
  median_multiple: number;
  /** The multiple the model actually used (shrinkage, floor, clamp applied). */
  used_multiple: number;
}

export interface ModelInput {
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  /** Days the maturity factor was computed from (365 when the listing date is unknown). */
  maturity_days: number;
  chains_count: number;
  category: string;
  comparable_multiple: number;
  comparable_count: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
}

export type TokenStatus = 'pre-token' | 'token';

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  /** Value on the board: the model estimate for pre-token, the market cap for token rows. */
  implied_value_usd: number;
  token_status: TokenStatus;
  /** Pre-token + passes the watchlist rule. The "Launch radar" view is this set. */
  launch: boolean;
  /** Why a pre-token row is not a launch candidate; null when it is one or has a token. */
  not_launch_reason: string | null;
  watchlisted: boolean;
  /** The live market cap, only for token rows. */
  mcap_usd: number | null;
  /** The model estimate, only for token rows (a calibration check, never the board value). */
  model_usd: number | null;
  /** model_usd / mcap_usd, only for token rows. */
  model_vs_market: number | null;
  model: ModelInput;
  farm_steps: string[];
}

export interface Radar {
  model_version: string;
  as_of: string;
  rows: RadarRow[];
  comparables: CategoryComparable[];
  global_median: number;
  launch_count: number;
  token_count: number;
  excluded_count: number;
  excluded_reasons: { no_value_anchor: number; mcap_not_positive: number };
  watchlist: string[];
  top_launch: RadarRow[];
  total_board_value_usd: number;
  calibration: { token_rows: number; median_abs_log_ratio: number; within_2x: number };
}

/** Number of whole days between a yyyy-mm-dd date and the snapshot date. */
export function daysBetween(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.floor((a - b) / 86_400_000));
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  const m = Math.floor(n / 2);
  return n % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

export function clamp(n: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, n));
}

/** A traded token whose market cap and TVL are both real, positive numbers. */
export function isLiveComparable(protocol: ProtocolSnapshot): boolean {
  return (
    typeof protocol.mcap_usd === 'number' &&
    protocol.mcap_usd > 0 &&
    typeof protocol.tvl_usd === 'number' &&
    protocol.tvl_usd > 0 &&
    protocol.gecko_id !== null &&
    protocol.symbol !== null
  );
}

/** No token exists for this protocol yet: all three token fields are null. */
export function isPreToken(protocol: ProtocolSnapshot): boolean {
  return protocol.mcap_usd === null && protocol.gecko_id === null && protocol.symbol === null;
}

const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_OR_STAKED_NAME = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** The rule the watchlist was built on: launch candidates are real protocols, not wrappers. */
export function notLaunchReason(protocol: ProtocolSnapshot): string | null {
  const category = protocol.category ?? 'Other';
  if (EXCLUDED_CATEGORIES.has(category)) {
    return category === 'CEX'
      ? 'centralised exchange — not a token launch'
      : category === 'Bridge' || category === 'Canonical Bridge'
        ? 'bridge — a transfer service, not a protocol launch'
        : 'liquid-staking wrapper — the wrapped asset, not a new launch';
  }
  if (VERSIONED_NAME.test(protocol.name)) return 'versioned pool — a numbered release, not a fresh protocol';
  if (WRAPPED_OR_STAKED_NAME.test(protocol.name)) return 'wrapped or staked token — the wrapper, not a launch';
  if (EXCHANGE_PREFIX.test(protocol.name)) return 'exchange product — not a token launch';
  return null;
}

export function isLaunchCandidate(protocol: ProtocolSnapshot): boolean {
  return isPreToken(protocol) && notLaunchReason(protocol) === null;
}

/** The category's price, from its live tokens — or the global median when too thin. */
export function comparablesOf(protocols: ProtocolSnapshot[]): {
  comparables: CategoryComparable[];
  globalMedian: number;
} {
  const live = protocols.filter(isLiveComparable);
  const globalMedian = round4(median(live.map((p) => p.mcap_usd! / p.tvl_usd)));
  const byCategory = new Map<string, number[]>();
  for (const p of live) byCategory.set(p.category ?? 'Other', [...(byCategory.get(p.category ?? 'Other') ?? []), p.mcap_usd! / p.tvl_usd]);
  const categories = [...new Set(protocols.map((p) => p.category ?? 'Other'))].sort();
  const comparables: CategoryComparable[] = categories.map((category) => {
    const ratios = byCategory.get(category) ?? [];
    const medianMultiple = ratios.length > 0 ? round4(median(ratios)) : globalMedian;
    let used: number;
    if (ratios.length < MODEL.multiple.min_live_comps) {
      used = globalMedian;
    } else {
      used = (ratios.length * medianMultiple + MODEL.shrink_prior * globalMedian) / (ratios.length + MODEL.shrink_prior);
    }
    return {
      category,
      live_count: ratios.length,
      median_multiple: medianMultiple,
      used_multiple: round4(clamp(used, MODEL.multiple.clamp_low, MODEL.multiple.clamp_high)),
    };
  });
  return { comparables, globalMedian };
}

/** The full working of the model for one pre-token protocol — every input and factor. */
export function priceProtocol(p: ProtocolSnapshot, asOf: string, comparables: CategoryComparable[], globalMedian: number): {
  impliedUsd: number;
  input: ModelInput;
} {
  const category = p.category ?? 'Other';
  const comparable = comparables.find((c) => c.category === category);
  const multiple = comparable?.used_multiple ?? globalMedian;
  const comparableCount = comparable?.live_count ?? 0;
  const growthPct = clamp(p.change_7d ?? 0, MODEL.growth.clip_low, MODEL.growth.clip_high);
  const growthMultiplier = round4(1 + (growthPct / 100) * MODEL.growth.slope);
  const ageDays = daysBetween(asOf, p.listed_at);
  const maturityDays = ageDays ?? MODEL.maturity.default_age_days;
  const maturityMultiplier = round4(
    MODEL.maturity.low + ((MODEL.maturity.high - MODEL.maturity.low) * Math.min(maturityDays, MODEL.maturity.horizon_days)) / MODEL.maturity.horizon_days,
  );
  const chainMultiplier = round4(1 + MODEL.chains.per_extra * Math.min(Math.max(p.chains.length - 1, 0), MODEL.chains.cap_extra));
  const raw = p.tvl_usd * multiple * growthMultiplier * maturityMultiplier * chainMultiplier;
  const impliedUsd = Math.min(MODEL.implied.cap_usd, Math.max(MODEL.implied.floor_usd, Math.round(raw)));
  return {
    impliedUsd,
    input: {
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_days: ageDays,
      maturity_days: maturityDays,
      chains_count: p.chains.length,
      category,
      comparable_multiple: multiple,
      comparable_count: comparableCount,
      growth_multiplier: growthMultiplier,
      maturity_multiplier: maturityMultiplier,
      chain_multiplier: chainMultiplier,
    },
  };
}

/** The deposit the farm plans size around: a small position scaled to the protocol's TVL. */
export function planCapitalUsd(tvlUsd: number): number {
  if (tvlUsd >= 1e9) return 500;
  if (tvlUsd >= 1e8) return 250;
  if (tvlUsd >= 1e7) return 100;
  if (tvlUsd >= 1e6) return 25;
  return 10;
}

function dollars(usd: number): string {
  return usd >= 100 ? `$${Math.round(usd)}` : `$${usd}`;
}

const VERB_FOR_CATEGORY: Record<string, { main: string; second: string }> = {
  Lending: { main: 'supply', second: 'borrow a small amount against the supply' },
  Dexs: { main: 'swap', second: 'add a small position to the deepest pool' },
  Yield: { main: 'deposit into the highest-APY vault', second: 'deposit into a second vault' },
  'Yield Aggregator': { main: 'deposit into the highest-APY vault', second: 'deposit into a second vault' },
  'Risk Curators': { main: 'deposit into a curated vault', second: 'deposit into a vault run by a second curator' },
  'Onchain Capital Allocator': { main: 'deposit into an allocation vault', second: 'check the allocation report and deposit into a second vault' },
  CDP: { main: 'open a collateralised position', second: 'mint a small amount against a second collateral' },
  Derivatives: { main: 'open a small position', second: 'open a second position on the opposite side' },
  'Basis Trading': { main: 'deposit into a basis vault', second: 'deposit into a second basis vault' },
  'Liquid Staking': { main: 'stake into the liquid-staking vault', second: 'stake a second tranche' },
  'Liquid Restaking': { main: 'restake into the vault', second: 'restake a second tranche' },
  Restaking: { main: 'restake into the vault', second: 'restake a second tranche' },
  RWA: { main: 'buy into the tokenised asset', second: 'buy into a second tokenised asset' },
  'Prediction Market': { main: 'take a small position on a market', second: 'take a position on a second market' },
  'NFT Marketplace': { main: 'list or buy a small item', second: 'place a bid on a second item' },
  Payments: { main: 'send a small payment through the app', second: 'send a second payment on another chain' },
  Privacy: { main: 'run a private transfer through the app', second: 'run a second private transfer' },
  Launchpad: { main: 'join the active launch', second: 'complete the launch quest' },
  Farm: { main: 'deposit into the farm', second: 'deposit into a second farm' },
  Synthetics: { main: 'mint a small synthetic position', second: 'mint a second synthetic' },
  Options: { main: 'buy a small option', second: 'sell a covered option' },
  Bridge: { main: 'bridge funds to a second chain', second: 'bridge funds back through a different route' },
  'Canonical Bridge': { main: 'bridge funds to the destination chain', second: 'bridge funds back through a different route' },
  CEX: { main: 'place a small spot trade on the exchange', second: 'trade a second pair' },
  'Stablecoin Issuer': { main: 'mint a small amount of the stablecoin', second: 'redeem a small amount' },
  Staking: { main: 'stake a small amount', second: 'stake a second tranche' },
};

function actionFor(protocol: ProtocolSnapshot): { main: string; second: string } {
  return (
    VERB_FOR_CATEGORY[protocol.category ?? ''] ?? {
      main: 'deposit into the main vault',
      second: 'use a second feature of the app',
    }
  );
}

/** Ten concrete steps for a pre-token launch candidate, every step carrying cost + time. */
export function farmStepsForLaunch(protocol: ProtocolSnapshot): string[] {
  const capital = planCapitalUsd(protocol.tvl_usd);
  const half = Math.max(5, Math.round(capital / 2));
  const small = Math.max(5, Math.round(capital / 5));
  const action = actionFor(protocol);
  const chainList = protocol.chains.filter((c) => c !== 'Ethereum').slice(0, 2);
  const otherChain = chainList[0] ?? 'a second chain the protocol supports';
  const holdDays = 90;
  return [
    `Set up a fresh wallet for this protocol only and fund it with ${dollars(capital)} plus ${dollars(15)} kept aside for gas. Cost: ${dollars(capital + 15)} total. Time: 5 minutes.`,
    `From that wallet, ${action.main} ${dollars(capital)} into ${protocol.name} on its main chain and keep the receipt. Cost: ${dollars(capital)} plus about $2 gas. Time: 15 minutes.`,
    `Then ${action.second} with ${dollars(small)}. Cost: ${dollars(small)} plus about $2 gas. Time: 10 minutes.`,
    `Use the protocol on ${otherChain}: repeat the main action there with ${dollars(half)} so the position is visible on two chains. Cost: ${dollars(half)} plus about $2 gas. Time: 15 minutes.`,
    `Once a week, do one small real action in the app — a swap, a supply or a claim — so the wallet is not a one-day visitor. Cost: about $2 gas per week. Time: 10 minutes per week.`,
    `Find the protocol's points page or quest page from its own docs and finish one listed task, such as a quiz or a social task. Cost: about $2 gas. Time: 15 minutes.`,
    `Hold the position for at least ${holdDays} days without withdrawing; airdrop snapshots reward patience, not one-day deposits. Cost: the ${dollars(capital)} stays deployed. Time: ${holdDays} days.`,
    `Read the protocol's own docs for the token or points rules and confirm the contract address there — never trust a contract pasted in a chat. Cost: nothing. Time: 15 minutes.`,
    `When the claim opens, use only the claim link the protocol publishes on its own site; a claim that asks you to pay first is a scam. Cost: no fee to claim. Time: 10 minutes.`,
    `Write the wallet address, the deposit amounts and the dates in a farm log, then unwind in reverse order if the token never comes. Cost: nothing. Time: 5 minutes.`,
  ];
}

/** Ten concrete steps for a protocol whose token already trades — the ongoing incentives. */
export function farmStepsForToken(protocol: ProtocolSnapshot): string[] {
  const capital = planCapitalUsd(protocol.tvl_usd);
  const half = Math.max(5, Math.round(capital / 2));
  const small = Math.max(5, Math.round(capital / 5));
  const action = actionFor(protocol);
  const token = protocol.symbol ?? 'the token';
  return [
    `Set up a fresh wallet for this protocol only and fund it with ${dollars(capital)} plus ${dollars(15)} kept aside for gas. Cost: ${dollars(capital + 15)} total. Time: 5 minutes.`,
    `Buy ${dollars(capital)} of ${token} on the chain where the protocol runs, through its own swap page or a decentralised exchange. Cost: ${dollars(capital)} plus about $5 gas and slippage. Time: 15 minutes.`,
    `Stake or provide liquidity with ${dollars(capital)} of ${token} in the protocol's own app and keep the receipt. Cost: ${dollars(capital)} plus about $2 gas. Time: 15 minutes.`,
    `Vote once in the next governance proposal with the staked position. Cost: about $2 gas. Time: 10 minutes.`,
    `Once a week, ${action.main} with ${dollars(small)} in the app so the wallet keeps earning incentives. Cost: ${dollars(small)} plus about $2 gas per week. Time: 10 minutes per week.`,
    `Open a second position of ${dollars(half)} — a different pool, vault or market — so the wallet is not single-position. Cost: ${dollars(half)} plus about $2 gas. Time: 15 minutes.`,
    `Hold the position for at least 30 days so the incentive snapshots see a long-lived user. Cost: the ${dollars(capital)} stays deployed. Time: 30 days.`,
    `Claim rewards only from the protocol's own rewards page; a claim link from a chat or an ad is not the protocol. Cost: about $2 gas to claim. Time: 10 minutes.`,
    `Track the position weekly: write down the reward rate and the token price, and note any loss from price moves. Cost: nothing. Time: 10 minutes per week.`,
    `Write the wallet address, the deposit amounts and the dates in a farm log, then unwind in reverse order if the incentives dry up. Cost: nothing. Time: 5 minutes.`,
  ];
}

export function buildRadar(snapshot: Snapshot): { board: RadarRow[]; radar: Radar } {
  const { comparables, globalMedian } = comparablesOf(snapshot.protocols);
  const watchSet = new Set(snapshot.watchlist);
  const rows: RadarRow[] = [];
  let excludedNoAnchor = 0;
  let excludedMcap = 0;
  for (const p of snapshot.protocols) {
    if (isPreToken(p)) {
      const { impliedUsd, input } = priceProtocol(p, snapshot.as_of, comparables, globalMedian);
      const launch = notLaunchReason(p) === null;
      rows.push({
        rank: 0,
        slug: p.slug,
        name: p.name,
        category: p.category ?? 'Other',
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        change_7d: p.change_7d,
        age_days: input.age_days,
        implied_value_usd: impliedUsd,
        token_status: 'pre-token',
        launch,
        not_launch_reason: launch ? null : notLaunchReason(p),
        watchlisted: watchSet.has(p.slug),
        mcap_usd: null,
        model_usd: null,
        model_vs_market: null,
        model: input,
        farm_steps: farmStepsForLaunch(p),
      });
    } else if (typeof p.mcap_usd === 'number' && p.mcap_usd > 0) {
      const { impliedUsd: modelUsd, input } = priceProtocol(p, snapshot.as_of, comparables, globalMedian);
      const vsMarket = round4(modelUsd / p.mcap_usd);
      rows.push({
        rank: 0,
        slug: p.slug,
        name: p.name,
        category: p.category ?? 'Other',
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        change_7d: p.change_7d,
        age_days: input.age_days,
        implied_value_usd: Math.min(MODEL.implied.cap_usd, Math.max(MODEL.implied.floor_usd, Math.round(p.mcap_usd))),
        token_status: 'token',
        launch: false,
        not_launch_reason: null,
        watchlisted: watchSet.has(p.slug),
        mcap_usd: p.mcap_usd,
        model_usd: modelUsd,
        model_vs_market: vsMarket,
        model: input,
        farm_steps: farmStepsForToken(p),
      });
    } else if (p.mcap_usd === null) {
      excludedNoAnchor += 1;
    } else {
      excludedMcap += 1;
    }
  }
  // Rank by board value, ties broken by slug so the order is deterministic.
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || a.slug.localeCompare(b.slug));
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });
  const launchCount = rows.filter((r) => r.launch).length;
  const tokenCount = rows.filter((r) => r.token_status === 'token').length;
  const tokenRows = rows.filter((r) => r.token_status === 'token');
  const logRatios = tokenRows
    .map((r) => Math.abs(Math.log(r.model_usd! / r.mcap_usd!)))
    .sort((a, b) => a - b);
  const medianLog = logRatios.length > 0 ? logRatios[Math.floor(logRatios.length / 2)]! : 0;
  const within2x = logRatios.length > 0 ? logRatios.filter((r) => r <= Math.log(2)).length / logRatios.length : 0;
  const radar: Radar = {
    model_version: MODEL.version,
    as_of: snapshot.as_of,
    rows,
    comparables,
    global_median: globalMedian,
    launch_count: launchCount,
    token_count: tokenCount,
    excluded_count: excludedNoAnchor + excludedMcap,
    excluded_reasons: { no_value_anchor: excludedNoAnchor, mcap_not_positive: excludedMcap },
    watchlist: snapshot.watchlist,
    top_launch: rows.filter((r) => r.launch).slice(0, 12),
    total_board_value_usd: rows.reduce((s, r) => s + r.implied_value_usd, 0),
    calibration: {
      token_rows: tokenRows.length,
      median_abs_log_ratio: round4(medianLog),
      within_2x: round4(within2x),
    },
  };
  return { board: rows, radar };
}

/** The gate's own checks, run before anything is written: a board the gate refuses never ships. */
export function boardIssue(board: RadarRow[], snapshot: Snapshot): string | null {
  if (board.length < 400 || board.length > 600) return `board has ${board.length} rows, the gate wants 400-600`;
  const watchSet = new Set(snapshot.watchlist);
  const covered = board.filter((r) => watchSet.has(r.slug));
  if (covered.length !== snapshot.watchlist.length) return `board covers ${covered.length}/${snapshot.watchlist.length} of the watchlist`;
  const byRank = new Map<number, number>();
  for (const r of board) {
    if (r.rank < 1 || r.rank > board.length) return `row ${r.slug} has rank ${r.rank} outside 1..${board.length}`;
    if (byRank.has(r.rank)) return `rank ${r.rank} appears twice`;
    byRank.set(r.rank, 1);
  }
  for (let i = 1; i < board.length; i += 1) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `implied values rise at rank ${board[i]!.rank}`;
    if (board[i]!.implied_value_usd <= 0) return `row ${board[i]!.slug} has a non-positive implied value`;
  }
  const costRe = /cost:/i;
  const timeRe = /time:/i;
  for (const r of board) {
    if (r.farm_steps.length < 8 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps, the gate wants 8-12`;
    for (const step of r.farm_steps) {
      if (step.length < 20 || step.length > 600) return `${r.slug} has a farm step of ${step.length} chars, the gate wants 20-600`;
      if (!costRe.test(step) || !timeRe.test(step)) return `${r.slug} has a farm step without cost or time`;
    }
    if (r.token_status !== 'pre-token' && r.token_status !== 'token') return `${r.slug} has token status ${r.token_status}`;
    if (r.token_status === 'token' && r.mcap_usd === null) return `${r.slug} is a token row without a market cap`;
    if (r.token_status === 'pre-token' && r.mcap_usd !== null) return `${r.slug} is a pre-token row with a market cap`;
    if (r.launch && r.token_status !== 'pre-token') return `${r.slug} is a launch candidate with a token`;
    if (r.implied_value_usd > MODEL.implied.cap_usd) return `${r.slug} exceeds the implied-value cap`;
  }
  if (board.filter((r) => r.launch).length < 100) return `only ${board.filter((r) => r.launch).length} launch candidates`;
  return null;
}

/** The snapshot on disk, checked against itself before the model touches it. */
export function parseSnapshot(text: string): Snapshot {
  const parsed = JSON.parse(text) as Snapshot;
  const missing = ['as_of', 'protocols', 'watchlist'].filter((key) => !(key in parsed));
  if (missing.length > 0) throw new Error(`Snapshot is missing these fields: ${missing.join(', ')}`);
  const slugs = new Set<string>();
  for (const p of parsed.protocols) {
    if (typeof p.slug !== 'string') throw new Error('Snapshot has a protocol with no slug');
    if (slugs.has(p.slug)) throw new Error(`Duplicate slug: ${p.slug}`);
    if (!Number.isFinite(p.tvl_usd) || p.tvl_usd < 0) throw new Error(`Bad TVL on ${p.slug}`);
    slugs.add(p.slug);
  }
  for (const slug of parsed.watchlist) {
    if (!slugs.has(slug)) throw new Error(`Watchlist slug missing from the snapshot: ${slug}`);
  }
  return parsed;
}

/** The dashboard's data file: window.RADAR, nothing else, no network anywhere. */
export function dataScript(radar: Radar): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
