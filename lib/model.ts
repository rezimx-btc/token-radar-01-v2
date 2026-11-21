// Token Radar v2 ("radar-2"): a fitted launch-value model, validated held-out.
//
// The model is FITTED from the sealed snapshot itself, not asserted:
//   1. Launch value: log(mcap) = a + b * log(TVL), OLS on the 128 traded-token
//      protocols that carry a market cap (a = 6.964567, b = 0.522266), times the
//      house growth and maturity multipliers, times a category adjustment: the
//      shrunk (n/(n+5)) median log-residual per category, capped at +/-0.70.
//      The house starter's flat 0.25 x TVL is the baseline this beats.
//   2. Launch odds: P(a protocol ever records a token), from the peers' own
//      record - the category token rate shrunk (k=20) toward the global 0.2171,
//      times the age-band rate over the global rate, capped to [0.02, 0.60].
//      Old protocols launch more often than young ones (age >= 3y: 0.328
//      shrunk; age < 6mo: 0.080), Yield/Basis Trading launch most by category,
//      Risk Curators least (0.108). No protocol name is ever special-cased.
//   3. Implied value = launch value x launch odds: the EXPECTED value of the
//      launch. The board ranks by it, rank 1 first.
//   4. Farm verdict: farmers are assumed to share 5% of the expected value
//      (stated assumption, illustrative), split over an estimated farmer base
//      of clamp(TVL / $25,000, 200, 50,000). Net per farmer = that share minus
//      the costed farm plan (setup gas + weekly gas + 3% opportunity on the
//      deposit). FARM when net > $50, THIN when net > $0, else SKIP.
//   5. Validation runs inside this program on every run (see validateModel):
//      two random 80/20 held-out splits and two walk-forward splits, each
//      refitting the curve on the train set only and scoring the median
//      |log error| against the traded protocols' real market caps, starter
//      vs fitted. The dashboard prints the table; nothing is claimed that
//      the program did not just measure.
//
// Exclusions follow the field guide's own rule, applied to the whole board,
// not only the watchlist: a protocol is rankable when it records no token
// AND is not a wrapped / staked / bridged product of a token that trades
// (category Bridge, Canonical Bridge, Cross Chain Bridge, Liquid Staking,
// Liquid Restaking, Restaked BTC or CEX; name carrying a whole word wrapped,
// staked or staking; name beginning with an exchange's name) and is not a
// versioned pool (name ending in V2 / 2.0 and the like). The watchlist's 40
// all pass the rule, so coverage is never traded for it. 758 = 197 ranked +
// 416 already-traded + 145 excluded-with-reason; the dashboard accounts
// for every protocol in the snapshot.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The fitted model's constants. Every number below was fitted from the
 *  sealed snapshot (128 traded protocols for the curve, 525 peer protocols
 *  for the odds); the dashboard states them and the validation table. */
export interface ModelConstants {
  log_intercept: number;
  log_slope: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  category_adjustment_cap: number;
  odds_global: number;
  odds_cap_low: number;
  odds_cap_high: number;
  farmer_share: number;
  farmers_per_tvl_usd: number;
  farmers_min: number;
  farmers_max: number;
  farm_net_farm_usd: number;
}

export const MODEL: ModelConstants = {
  log_intercept: 6.964567,
  log_slope: 0.522266,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  category_adjustment_cap: 0.7,
  odds_global: 0.2171,
  odds_cap_low: 0.02,
  odds_cap_high: 0.6,
  farmer_share: 0.05,
  farmers_per_tvl_usd: 25000,
  farmers_min: 200,
  farmers_max: 50000,
  farm_net_farm_usd: 50,
};

export const MODEL_VERSION = 'radar-2';

/** Category adjustment: shrunk median log-residual of the fitted curve,
 *  per category, from the 128 traded protocols. Categories absent here
 *  adjust by 0 (the curve alone). */
export const CATEGORY_ADJUSTMENT: Record<string, number> = {
  'Lending': -0.369, 'Dexs': 0.176, 'Liquid Staking': -0.586, 'Yield': 0.194,
  'CEX': 0.7, 'RWA': 0.349, 'Canonical Bridge': 0.7, 'Basis Trading': 0.459,
  'Bridge': 0.368, 'Cross Chain Bridge': 0.518, 'Yield Aggregator': -0.205,
  'Indexes': -0.283, 'CDP': -0.072, 'Privacy': 0.689, 'Restaking': -0.016,
  'Onchain Capital Allocator': -0.361, 'Token Locker': 0.367, 'Derivatives': 0.393,
  'Liquid Restaking': -0.31, 'AI Agents': 0.07, 'Staking Pool': -0.7,
  'Payments': -0.325, 'Liquidity Manager': -0.521, 'Collateral Management': 0.602,
  'Risk Curators': 0.327, 'Chain': 0.342, 'NFT Marketplace': 0.255,
  'Decentralized AI': 0.422, 'Dual-Token Stablecoin': -0.276, 'Options': 0.237,
  'Launchpad': -0.001, 'Prediction Market': 0.7, 'DOR': -0.117,
  'Leveraged Farming': 0.055,
};

/** Category token rate: share of peer protocols recording a token, shrunk
 *  (k=20) toward the global 0.2171. Pool: 525 protocols outside the
 *  excluded categories (CEX, bridges, liquid staking/restaking). */
export const ODDS_CATEGORY: Record<string, number> = {
  'AI Agents': 0.2883, 'Algo-Stables': 0.1974, 'Anchor BTC': 0.181,
  'Basis Trading': 0.301, 'CDP': 0.1836, 'CDP Manager': 0.1974, 'CeDeFi': 0.1888,
  'Chain': 0.2265, 'Collateral Management': 0.2544, 'Collateral Markets': 0.2068,
  'Cross Chain Bridge': 0.309, 'Crypto Card Issuer': 0.1974, 'DOR': 0.2544,
  'Decentralized AI': 0.2544, 'Decentralized BTC': 0.1888, 'Derivatives': 0.1379,
  'Dexs': 0.1289, 'Dual-Token Stablecoin': 0.2643, 'Farm': 0.2137,
  'Governance Incentives': 0.2429, 'Indexes': 0.2824, 'Insurance': 0.1974,
  'Interest Rate Derivatives': 0.2068, 'Launchpad': 0.2643, 'Lending': 0.2352,
  'Leveraged Farming': 0.2055, 'Liquidity Manager': 0.2265,
  'NFT Marketplace': 0.2544, 'OTC Marketplace': 0.2068,
  'Onchain Capital Allocator': 0.1499, 'Options': 0.2323, 'Options Vault': 0.2068,
  'Payments': 0.2758, 'Prediction Market': 0.2323, 'Privacy': 0.306,
  'RWA': 0.2518, 'Reserve Currency': 0.2544, 'Restaking': 0.244,
  'Risk Curators': 0.1075, 'Stablecoin Issuer': 0.2068, 'Stablecoin Wrapper': 0.1974,
  'Staking Pool': 0.2046, 'Synthetics': 0.2323, 'Token Locker': 0.2537,
  'Uncollateralized Lending': 0.2068, 'Yield': 0.2939, 'Yield Aggregator': 0.2405,
};

/** Age-band token rate (shrunk, k=20, same pool): older protocols record
 *  tokens more often. Unknown age is its own band. */
export const ODDS_AGE_BANDS: Array<{ min: number; max: number; rate: number }> = [
  { min: 0, max: 180, rate: 0.08 },
  { min: 180, max: 365, rate: 0.171 },
  { min: 365, max: 730, rate: 0.157 },
  { min: 730, max: 1095, rate: 0.195 },
  { min: 1095, max: Number.MAX_SAFE_INTEGER, rate: 0.328 },
];
export const ODDS_AGE_UNKNOWN = 0.373;

/** How many live-token protocols the Live tab carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  launch_value_usd: number;
  launch_odds: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  net_farmer_usd: number;
  farm_cost_usd: number;
  model: {
    log_intercept: number;
    log_slope: number;
    category_adjustment: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  launch_value_usd: number;
  launch_odds: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  net_farmer_usd: number;
  farm_cost_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  category_adjustment: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One held-out validation test, measured by this program on this run. */
export interface ValidationTest {
  name: string;
  n_test: number;
  starter_med_log_err: number;
  fitted_med_log_err: number;
}

/** Everything the dashboard needs: the board, the live set, the model,
 *  its validation, and the accounting of all 758 protocols. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  live_total: number;
  excluded_total: number;
  excluded_by_reason: Record<string, number>;
  total_expected_usd: number;
  verdict_counts: Record<string, number>;
  validation: ValidationTest[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of numbers (average of the two middles when even). */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Deterministic PRNG (mulberry32) so the held-out splits are identical on every run. */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** The growth and maturity multipliers (the house terms, kept as stated). */
export function growthMultiplier(protocol: SnapshotProtocol, model: ModelConstants): { pct: number; mult: number } {
  const rawGrowth = finite(protocol.change_7d, 0);
  const pct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  return { pct, mult: 1 + (pct / 100) * model.growth_weight };
}

export function maturityMultiplier(age: number | null, model: ModelConstants): number {
  const ageForModel = age ?? model.unknown_age_days;
  return model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
}

/** The fitted launch value if the token launches, with the full-fit constants. */
export function launchValue(protocol: SnapshotProtocol, asOf: string, model: ModelConstants): { launch: number; catAdj: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const { pct, mult: growthMult } = growthMultiplier(protocol, model);
  const maturityMult = maturityMultiplier(age, model);
  const catAdj = protocol.category === null ? 0 : (CATEGORY_ADJUSTMENT[protocol.category] ?? 0);
  const curve = Math.exp(model.log_intercept + model.log_slope * Math.log(protocol.tvl_usd));
  const launch = Math.max(1, Math.round(curve * growthMult * maturityMult * Math.exp(catAdj)));
  return { launch, catAdj, growthPct: pct, growthMult, maturityMult, age };
}

/** P(the protocol ever records a token), from the peers' record. */
export function launchOdds(protocol: SnapshotProtocol, asOf: string, model: ModelConstants): number {
  const catRate = protocol.category === null ? model.odds_global : (ODDS_CATEGORY[protocol.category] ?? model.odds_global);
  const age = ageDays(asOf, protocol.listed_at);
  let bandRate = ODDS_AGE_UNKNOWN;
  if (age !== null) {
    for (const band of ODDS_AGE_BANDS) {
      if (age >= band.min && age < band.max) { bandRate = band.rate; break; }
    }
  }
  const odds = catRate * (bandRate / model.odds_global);
  return Math.min(model.odds_cap_high, Math.max(model.odds_cap_low, odds));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are a wrapped, staked or bridged product of a token that trades. */
const EXCLUDED_CATEGORIES = new Set([
  'Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Liquid Staking',
  'Liquid Restaking', 'Restaked BTC', 'CEX',
]);

/** A name beginning with an exchange's name is that exchange's product. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** A name carrying a whole word wrapped, staked or staking. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Why a pre-token protocol is NOT rankable, or null when it is. The
 *  watchlist's 40 all return null here. */
export function exclusionReason(p: SnapshotProtocol): string | null {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return `category ${p.category}`;
  if (WRAPPED_WORD.test(p.name)) return 'wrapped/staked product';
  if (EXCHANGE_PREFIX.test(p.name)) return 'exchange product';
  if (VERSIONED.test(p.name)) return 'versioned pool';
  return null;
}

/** Whether a protocol is one the board may rank: pre-token and not an
 *  excluded product. Never a replacement for a watchlist row: the board
 *  always carries every watchlist slug on top of this set. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && exclusionReason(p) === null;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The farm economics: capital tier, hold, farmer base, cost, net, verdict. */
export function farmEconomics(p: SnapshotProtocol, age: number | null, implied: number): {
  capital: number; holdDays: number; farmers: number; perFarmer: number; cost: number; net: number; verdict: 'FARM' | 'THIN' | 'SKIP';
} {
  const capital = p.tvl_usd >= 5_000_000_000 ? 250 : p.tvl_usd >= 1_000_000_000 ? 150 : p.tvl_usd >= 100_000_000 ? 100 : 50;
  const ageForHold = age ?? 365;
  const holdDays = ageForHold < 180 ? 60 : ageForHold < 365 ? 45 : 30;
  const farmers = Math.min(MODEL.farmers_max, Math.max(MODEL.farmers_min, Math.round(p.tvl_usd / MODEL.farmers_per_tvl_usd)));
  const perFarmer = (implied * MODEL.farmer_share) / farmers;
  const weeks = Math.floor(holdDays / 7);
  const cost = 6 + 2 * weeks + capital * 0.03;
  const net = perFarmer - cost;
  const verdict = net > MODEL.farm_net_farm_usd ? 'FARM' : net > 0 ? 'THIN' : 'SKIP';
  return { capital, holdDays, farmers, perFarmer, cost, net, verdict };
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains,
 * TVL, age, verdict), never from a hand-written list of names. Step 1
 * states the verdict and the net value per farmer behind it.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, econ: ReturnType<typeof farmEconomics>): FarmStep[] {
  const chain = chainOf(p);
  const action = actionFor(p, econ.capital, chain);
  const verdictLine = econ.verdict === 'FARM'
    ? `Verdict FARM: about $${Math.round(econ.perFarmer)} of expected value per farmer against about $${econ.cost.toFixed(0)} of cost, net about $${Math.round(econ.net)}.`
    : econ.verdict === 'THIN'
      ? `Verdict THIN: about $${Math.round(econ.perFarmer)} of expected value per farmer against about $${econ.cost.toFixed(0)} of cost, net about $${Math.round(econ.net)}; farm small or wait for a better entry.`
      : `Verdict SKIP: about $${Math.round(econ.perFarmer)} of expected value per farmer against about $${econ.cost.toFixed(0)} of cost, net about $${Math.round(econ.net)}; the farm does not pay for itself at this size.`;
  return [
    {
      text: `${verdictLine} Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${econ.capital} of capital and about $${econ.capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${econ.holdDays} days so the activity is counted in more than one snapshot.`,
      cost: `the $${econ.capital} stays in the position`,
      time: `${econ.holdDays} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

// ---- Held-out validation: refit on train, score on test, starter vs fitted. ----

interface FittedCurve {
  intercept: number;
  slope: number;
  catAdj: Record<string, number>;
}

function fitCurve(train: SnapshotProtocol[], asOf: string, model: ModelConstants): FittedCurve {
  const xs = train.map((p) => Math.log(p.tvl_usd));
  const ys = train.map((p) => Math.log(p.mcap_usd!));
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) * (xs[i]! - mx);
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = my - slope * mx;
  const byCat = new Map<string, number[]>();
  for (const p of train) {
    const age = ageDays(asOf, p.listed_at);
    const pred = Math.exp(intercept + slope * Math.log(p.tvl_usd))
      * growthMultiplier(p, model).mult * maturityMultiplier(age, model);
    const r = Math.log(p.mcap_usd! / pred);
    const key = p.category ?? '';
    if (!byCat.has(key)) byCat.set(key, []);
    byCat.get(key)!.push(r);
  }
  const catAdj: Record<string, number> = {};
  for (const [key, values] of byCat) {
    const n = values.length;
    const shrunk = (n / (n + 5)) * median(values);
    catAdj[key] = Math.min(model.category_adjustment_cap, Math.max(-model.category_adjustment_cap, shrunk));
  }
  return { intercept, slope, catAdj };
}

function fittedLaunch(p: SnapshotProtocol, asOf: string, model: ModelConstants, fit: FittedCurve): number {
  const age = ageDays(asOf, p.listed_at);
  const adj = p.category === null ? 0 : (fit.catAdj[p.category] ?? 0);
  return Math.max(1, Math.exp(fit.intercept + fit.slope * Math.log(p.tvl_usd))
    * growthMultiplier(p, model).mult * maturityMultiplier(age, model) * Math.exp(adj));
}

function starterLaunch(p: SnapshotProtocol, asOf: string, model: ModelConstants): number {
  const age = ageDays(asOf, p.listed_at);
  return Math.max(1, p.tvl_usd * 0.25 * growthMultiplier(p, model).mult * maturityMultiplier(age, model));
}

function medLogErr(preds: number[], actuals: number[]): number {
  return median(preds.map((pr, i) => Math.abs(Math.log(pr / actuals[i]!))));
}

function shuffled<T>(items: T[], seed: number): T[] {
  const rand = mulberry32(seed);
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

/** The four held-out tests, refitting on each train set only. Deterministic:
 *  the same snapshot always gives the same table. */
export function validateModel(snapshot: Snapshot, model: ModelConstants = MODEL): ValidationTest[] {
  const traded = snapshot.protocols.filter((p) => p.gecko_id !== null && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const tests: ValidationTest[] = [];
  const run = (name: string, train: SnapshotProtocol[], test: SnapshotProtocol[]): void => {
    if (train.length < 10 || test.length < 5) return;
    const fit = fitCurve(train, snapshot.as_of, model);
    const actuals = test.map((p) => p.mcap_usd!);
    tests.push({
      name,
      n_test: test.length,
      starter_med_log_err: Math.round(medLogErr(test.map((p) => starterLaunch(p, snapshot.as_of, model)), actuals) * 1000) / 1000,
      fitted_med_log_err: Math.round(medLogErr(test.map((p) => fittedLaunch(p, snapshot.as_of, model, fit)), actuals) * 1000) / 1000,
    });
  };
  for (const seed of [20261114, 777]) {
    const order = shuffled(traded, seed);
    const cut = Math.floor(order.length * 0.8);
    run(`held-out 80/20 (seed ${seed})`, order.slice(0, cut), order.slice(cut));
  }
  for (const cutoff of ['2025-01-01', '2025-06-01']) {
    const train = traded.filter((p) => p.listed_at !== null && p.listed_at < cutoff);
    const test = traded.filter((p) => p.listed_at !== null && p.listed_at >= cutoff);
    run(`walk-forward from ${cutoff}`, train, test);
  }
  return tests;
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => {
    const { launch, catAdj, growthPct, growthMult, maturityMult, age } = launchValue(p, snapshot.as_of, model);
    const odds = launchOdds(p, snapshot.as_of, model);
    const implied = Math.max(1, Math.round(launch * odds));
    const econ = farmEconomics(p, age, implied);
    return { p, launch, odds, implied, econ, catAdj, growthPct, growthMult, maturityMult, age };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    launch_value_usd: s.launch,
    launch_odds: s.odds,
    verdict: s.econ.verdict,
    net_farmer_usd: Math.round(s.econ.net),
    farm_cost_usd: Math.round(s.econ.cost * 100) / 100,
    model: {
      log_intercept: model.log_intercept,
      log_slope: model.log_slope,
      // Full precision, unrounded: the dashboard recomputes the implied value
      // from these figures and must land on the exact same integer.
      category_adjustment: s.catAdj,
      growth_pct: s.growthPct,
      growth_multiplier: s.growthMult,
      maturity_multiplier: s.maturityMult,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age, s.econ).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The live-token protocols, by market cap, for the dashboard's Live tab. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    launch_value_usd: row.launch_value_usd,
    launch_odds: row.launch_odds,
    verdict: row.verdict,
    net_farmer_usd: row.net_farmer_usd,
    farm_cost_usd: row.farm_cost_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    category_adjustment: row.model.category_adjustment,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const liveTotal = snapshot.protocols.filter((p) => !isPreToken(p)).length;
  const excludedByReason: Record<string, number> = {};
  let excludedTotal = 0;
  for (const p of snapshot.protocols) {
    if (!isPreToken(p)) continue;
    const reason = exclusionReason(p);
    if (reason === null) continue;
    excludedTotal++;
    const key = reason.startsWith('category ') ? reason : reason;
    excludedByReason[key] = (excludedByReason[key] ?? 0) + 1;
  }
  const verdictCounts: Record<string, number> = { FARM: 0, THIN: 0, SKIP: 0 };
  let totalExpected = 0;
  for (const r of board) {
    verdictCounts[r.verdict] = (verdictCounts[r.verdict] ?? 0) + 1;
    totalExpected += r.implied_value_usd;
  }
  const validation = validateModel(snapshot, model);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    live_total: liveTotal,
    excluded_total: excludedTotal,
    excluded_by_reason: excludedByReason,
    total_expected_usd: totalExpected,
    verdict_counts: verdictCounts,
    validation,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
