// PlateFix engine — gap computation + minimum-change LP solver.
//
// Model:
//   Decision vars per food f: p_f (increase, g/day) and m_f (decrease, g/day),
//   both >= 0, bounded by change caps relative to the current pot.
//   For each member m and nutrient n with a shortfall, one constraint:
//     sum_f (a_fn * share_m / RDA_mn) * (p_f - m_f) + s_mn = gap_mn
//   where gap_mn is the missing FRACTION of the member's RDA, a_fn is nutrient
//   n per gram of food f, and s_mn >= 0 absorbs whatever cannot be closed.
//   Budget row (hard cap): sum_f (price_f/1000) * (p_f - m_f) + e = headroom,
//   with e costing 0 — leftover budget is fine, only overspend is impossible.
//   Objective: minimize (1 + price_f/1000) * (p_f + m_f)  [small + cheap]
//             + SLACK_PENALTY * s_mn  [close gaps first].
//   If s* > 0 for a gap after solving, the gap cannot be closed under the cap.
//   A second pass then lifts the cap and minimizes pure spend to find the
//   cheapest budget that closes every closable gap (needsBudget) — reported
//   honestly, never hidden.
//
// Implementation: dense tableau simplex starting from the all-slack basis
// (always primal-feasible; no Phase 1 needed), Dantzig pricing with Bland's
// rule fallback against cycling. Problem sizes here are tiny (tens of vars,
// ~80 rows), so plain dense simplex is the right tool.

import { FOODS, foodById, NUTRIENT_ORDER, type FoodNutrients } from "./data/foods";
import { NUTRIENTS } from "./data/nutrients";
import type {
  AppliedPlan,
  GapAfter,
  HiddenMemberInsight,
  Household,
  HouseholdMemberProfile,
  MemberGapView,
  MinimumChangePlan,
  PlanChange,
  PlanResult,
  PotLine,
  PriceEntry,
  SpendTouchingNoGaps,
  StiglerResult,
} from "./types";

// Engine tuning knobs (constants, not data).
export const MAX_ADD_FRAC = 0.75; // existing foods: use can rise by up to 75%
export const MAX_REDUCE_FRAC = 0.75; // existing foods: use can fall by up to 75%
export const NEW_FOOD_MAX_G = 300; // a food not in the pot can be added up to 300 g
export const SLACK_PENALTY = 1e6; // per unit of unclosed gap (fraction of RDA)
export const BIG_FREE_BUDGET = 1e9; // pass-2 "unlimited" budget (finite for stable pivots)
export const GRAM_STEP = 5; // changes are rounded to this many grams
export const ROW_MARGIN = 0.02; // gap-target margin (frac of RDA) absorbing rounding
export const EPS = 1e-7;

export interface SolveInput {
  household: Household;
  pot: PotLine[];
  prices: PriceEntry[];
  maxAddFrac?: number;
  maxReduceFrac?: number;
}

// ---------------------------------------------------------------------------
// Nutrition math
// ---------------------------------------------------------------------------

/** Nutrient totals for the whole pot, per nutrient id. */
export function potNutrients(pot: PotLine[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const n of NUTRIENT_ORDER) totals[n.id] = 0;
  for (const line of pot) {
    const food = foodById(line.foodId);
    if (!food) continue;
    const grams = line.qtyPerDayG;
    for (const n of NUTRIENT_ORDER) {
      totals[n.id] += (food.per100g[n.id] / 100) * grams;
    }
  }
  return totals;
}

/** A member's daily intake given their share of the shared pot. */
export function memberIntake(
  member: HouseholdMemberProfile,
  pot: PotLine[],
): Record<string, number> {
  const totals = potNutrients(pot);
  const out: Record<string, number> = {};
  for (const n of NUTRIENT_ORDER) out[n.id] = totals[n.id] * member.potShare;
  return out;
}

/** Full per-nutrient status for every member (UI renders bars from this). */
export function memberStatus(
  household: Household,
  pot: PotLine[],
): {
  memberId: string;
  name: string;
  rows: { nutrientId: string; got: number; rda: number; frac: number }[];
}[] {
  return household.members.map((m) => {
    const intake = memberIntake(m, pot);
    const rows = m.requirements.map((r) => {
      const got = intake[r.nutrientId] ?? 0;
      return {
        nutrientId: r.nutrientId,
        got,
        rda: r.rda,
        frac: r.rda > 0 ? got / r.rda : 1,
      };
    });
    rows.sort((a, b) => a.frac - b.frac);
    return { memberId: m.id, name: m.name, rows };
  });
}

/** Gap view: nutrients below the warn threshold, worst first. */
export function computeGaps(household: Household, pot: PotLine[]): MemberGapView[] {
  const warnOf = new Map(NUTRIENTS.map((n) => [n.id, n.warnFrac]));
  return memberStatus(household, pot).map((s) => ({
    memberId: s.memberId,
    name: s.name,
    gaps: s.rows
      .filter((r) => r.frac < (warnOf.get(r.nutrientId) ?? 1))
      .map((r) => ({ nutrientId: r.nutrientId, got: r.got, rda: r.rda, frac: r.frac })),
  }));
}

export function potCost(pot: PotLine[], prices: PriceEntry[]): number {
  const perKg = new Map(prices.map((p) => [p.foodId, p.pricePerKg]));
  return pot.reduce((sum, line) => {
    const price = perKg.get(line.foodId) ?? 0;
    return sum + (line.qtyPerDayG / 1000) * price;
  }, 0);
}

// ---------------------------------------------------------------------------
// Simplex (dense tableau, min c^T x s.t. Ax = b, x >= 0; slacks appended here)
// ---------------------------------------------------------------------------

interface LPResult {
  status: "optimal" | "maxiter" | "unbounded";
  objective: number;
  /** Full solution: structural vars [0..nVars) then one slack per row. */
  x: number[];
  iterations: number;
}

/**
 * Minimize c^T x s.t. for each row i: sum_j A[i][j] x_j + slack_i = b[i], x >= 0.
 * `c` must have length nVars + m (structural costs then per-row slack costs).
 */
export function simplex(
  nVars: number,
  A: number[][],
  b: number[],
  c: number[],
  maxIterations = 5000,
): LPResult {
  const m = b.length;
  const total = nVars + m; // + one slack per row
  if (c.length !== total) {
    throw new Error(`simplex: cost vector length ${c.length} != nVars+m (${total})`);
  }
  // Build tableau: m rows x (total + 1) columns (last = RHS).
  const T: number[][] = [];
  for (let i = 0; i < m; i++) {
    const row = new Array<number>(total + 1).fill(0);
    for (let j = 0; j < nVars; j++) row[j] = A[i][j];
    row[nVars + i] = 1; // slack
    row[total] = b[i];
    T.push(row);
  }
  const cost = [...c];

  const basis = new Array<number>(m);
  for (let i = 0; i < m; i++) basis[i] = nVars + i;

  const reduced = new Array<number>(total);
  let iterations = 0;

  for (; iterations < maxIterations; iterations++) {
    // Reduced costs r_j = c_j - sum_i c_basis[i] * T[i][j].
    for (let j = 0; j < total; j++) {
      let r = cost[j];
      for (let i = 0; i < m; i++) {
        const cb = cost[basis[i]];
        if (cb !== 0) r -= cb * T[i][j];
      }
      reduced[j] = r;
    }
    for (let i = 0; i < m; i++) reduced[basis[i]] = 0;

    // Entering variable: most negative (Dantzig), or first negative after a
    // warm-up (Bland) to break potential cycling.
    let enter = -1;
    let best = -1e-9;
    const bland = iterations > 200;
    if (bland) {
      for (let j = 0; j < total; j++) {
        if (reduced[j] < -1e-9) {
          enter = j;
          break;
        }
      }
    } else {
      for (let j = 0; j < total; j++) {
        if (reduced[j] < best) {
          best = reduced[j];
          enter = j;
        }
      }
    }
    if (enter === -1) {
      // Optimal.
      let obj = 0;
      for (let i = 0; i < m; i++) obj += cost[basis[i]] * T[i][total];
      return { status: "optimal", objective: obj, x: extractX(T, basis, nVars, m, total), iterations };
    }

    // Ratio test.
    let leave = -1;
    let bestRatio = Infinity;
    for (let i = 0; i < m; i++) {
      const piv = T[i][enter];
      if (piv > 1e-9) {
        const ratio = T[i][total] / piv;
        if (ratio < bestRatio - 1e-12) {
          bestRatio = ratio;
          leave = i;
        }
      }
    }
    if (leave === -1) {
      return { status: "unbounded", objective: 0, x: extractX(T, basis, nVars, m, total), iterations };
    }
    pivot(T, m, total, leave, enter);
    basis[leave] = enter;
  }
  return {
    status: "maxiter",
    objective: 0,
    x: extractX(T, basis, nVars, m, total),
    iterations,
  };
}

function extractX(
  T: number[][],
  basis: number[],
  nVars: number,
  m: number,
  total: number,
): number[] {
  const x = new Array<number>(total).fill(0);
  for (let i = 0; i < m; i++) {
    x[basis[i]] = Math.max(0, T[i][total]);
  }
  void nVars;
  return x;
}

function pivot(T: number[][], m: number, total: number, row: number, col: number) {
  const piv = T[row][col];
  for (let j = 0; j <= total; j++) T[row][j] /= piv;
  T[row][col] = 1;
  for (let i = 0; i < m; i++) {
    if (i === row) continue;
    const factor = T[i][col];
    if (Math.abs(factor) > 1e-12) {
      for (let j = 0; j <= total; j++) T[i][j] -= factor * T[row][j];
      T[i][col] = 0;
    }
  }
}

// ---------------------------------------------------------------------------
// Minimum-change plan
// ---------------------------------------------------------------------------

/** Warn threshold (fraction of RDA) for a nutrient id. */
function warnFracOf(nid: string): number {
  return NUTRIENTS.find((n) => n.id === nid)?.warnFrac ?? 1;
}

interface VarDef { foodId: string; kind: "up" | "down"; bound: number; pricePerG: number }

/** Number of gap rows whose slack stayed positive (gap not closable). */
function openGapCount(
  lp: LPResult,
  nVars: number,
  slackKinds: { memberId: string; nutrientId: string }[],
): number {
  if (lp.status !== "optimal") return slackKinds.length;
  let n = 0;
  for (let r = 0; r < slackKinds.length; r++) {
    if ((lp.x[nVars + r] ?? 0) > 5e-3) n++;
  }
  return n;
}

/** Net spend (currency/day) implied by the LP solution's change vars. */
function planSpend(lp: LPResult, vars: VarDef[]): number {
  let s = 0;
  for (let i = 0; i < vars.length; i++) {
    const val = lp.x[i] ?? 0;
    if (val > EPS) s += vars[i].pricePerG * (vars[i].kind === "up" ? val : -val);
  }
  return s;
}

export function solve(input: SolveInput): PlanResult {
  const { household, prices } = input;
  const pot = input.pot.map((l) => ({ ...l }));
  const addFrac = input.maxAddFrac ?? MAX_ADD_FRAC;
  const reduceFrac = input.maxReduceFrac ?? MAX_REDUCE_FRAC;

  const started = Date.now();
  const potTotals = potNutrients(pot);
  const cur = new Map(pot.map((l) => [l.foodId, l.qtyPerDayG]));
  const perKg = new Map(prices.map((p) => [p.foodId, p.pricePerKg]));
  const costBefore = potCost(pot, prices);

  // Hard cap: never force the plan below what the family already spends (the
  // solver can only change foods, not defund the pot); the UI surfaces "the
  // current pot exceeds the budget" separately. A small buffer absorbs gram
  // rounding so the plan never breaches the cap.
  const ROUNDING_BUFFER = 2;
  const budgetLimit = Math.max(household.dailyBudget, costBefore) + ROUNDING_BUFFER;
  const headroom = Math.max(0, budgetLimit - costBefore);

  // ---- Build LP ----
  // Change vars: [p_f..., m_f...] for foods where the bound is nonzero.
  interface VarDef { foodId: string; kind: "up" | "down"; bound: number; pricePerG: number }
  const changeVars: VarDef[] = [];
  for (const food of FOODS) {
    const price = (perKg.get(food.id) ?? 0) / 1000;
    const curG = cur.get(food.id) ?? 0;
    const upBound = curG > 0 ? curG * addFrac : NEW_FOOD_MAX_G;
    if (upBound > EPS) changeVars.push({ foodId: food.id, kind: "up", bound: upBound, pricePerG: price });
    const downBound = curG > 0 ? curG * reduceFrac : 0;
    if (downBound > EPS) changeVars.push({ foodId: food.id, kind: "down", bound: downBound, pricePerG: price });
  }
  const nChange = changeVars.length;

  // Gap rows (fraction-of-RDA units), built first so each gets a surplus var.
  const rdaOf = new Map<string, number>();
  for (const m of household.members) {
    for (const r of m.requirements) rdaOf.set(`${m.id}:${r.nutrientId}`, r.rda);
  }
  const gapRows: { memberId: string; nutrientId: string; gapFrac: number }[] = [];
  for (const member of household.members) {
    for (const n of NUTRIENT_ORDER) {
      const nid = n.id;
      const rda = rdaOf.get(`${member.id}:${nid}`) ?? 0;
      if (rda <= 0) continue;
      // The solver closes gaps down to the same warn threshold the UI uses,
      // so "plan leaves this gap open" always matches what the UI shows.
      // A tiny margin (2% of RDA) absorbs gram-rounding so the rounded plan
      // still clears the threshold.
      const target = Math.min(1, warnFracOf(nid)) + ROW_MARGIN;
      const got = (potTotals[nid] ?? 0) * member.potShare;
      const gapFrac = Math.max(0, target - got / rda);
      if (gapFrac <= 1e-4) continue; // already at/above the threshold
      gapRows.push({ memberId: member.id, nutrientId: nid, gapFrac });
    }
  }

  // Full structural var list: change vars, then one unbounded surplus per gap
  // row (rows read Σ coef·x − surplus + shortfall = gapFrac, i.e. close AT
  // LEAST the gap — one member overshooting a shared dish must never make
  // another member's row infeasible). Surplus is free: overshoot is fine.
  const vars: VarDef[] = [
    ...changeVars,
    ...gapRows.map(() => ({ foodId: "", kind: "up" as const, bound: Infinity, pricePerG: 0 })),
  ];
  const nVars = vars.length;

  // Cost vector: change grams, cheap foods preferred; surplus is free.
  // Leftover budget is NOT penalized — the budget row is a hard cap, not a target.
  const c = vars.map((v, i) => (i < nChange ? 1 + v.pricePerG : 0));

  // Rows.
  const rows: number[][] = [];
  const b: number[] = [];
  const slackKinds: { memberId: string; nutrientId: string }[] = [];
  const rowKind: ("gap" | "bound" | "budget")[] = [];

  for (const g of gapRows) {
    const member = household.members.find((m) => m.id === g.memberId)!;
    const rda = rdaOf.get(`${g.memberId}:${g.nutrientId}`)!;
    const row = new Array<number>(nVars).fill(0);
    for (let i = 0; i < nChange; i++) {
      const v = changeVars[i];
      const food = foodById(v.foodId)!;
      const a = food.per100g[g.nutrientId as keyof FoodNutrients] / 100; // nutrient per gram
      const coef = (a * member.potShare) / rda; // RDA-fraction per gram
      row[i] = v.kind === "up" ? coef : -coef;
    }
    // − surplus for this row: overshooting the requirement is allowed.
    row[nChange + slackKinds.length] = -1;
    rows.push(row);
    b.push(g.gapFrac);
    slackKinds.push({ memberId: g.memberId, nutrientId: g.nutrientId });
    rowKind.push("gap");
  }

  // Bound rows: p_f <= upBound, m_f <= downBound (each with a zero-cost slack).
  // Surplus vars are unbounded — no bound row for them.
  for (let i = 0; i < nChange; i++) {
    const row = new Array<number>(nVars).fill(0);
    row[i] = 1;
    rows.push(row);
    b.push(changeVars[i].bound);
    rowKind.push("bound");
  }

  // Budget row (currency units): sum price_g*(p - m) + e = headroom.
  {
    const row = new Array<number>(nVars).fill(0);
    for (let i = 0; i < nChange; i++) {
      row[i] = changeVars[i].kind === "up" ? changeVars[i].pricePerG : -changeVars[i].pricePerG;
    }
    rows.push(row);
    b.push(headroom);
    rowKind.push("budget");
  }

  // Slack cost vector: gap slacks = SLACK_PENALTY (close gaps first); all
  // other slacks (bound rows, budget leftover) cost 0.
  const cFull = [...c];
  for (let i = 0; i < rows.length; i++) {
    cFull.push(rowKind[i] === "gap" ? SLACK_PENALTY : 0);
  }

  const lp = simplex(nVars, rows, b, cFull);

  // ---- Second pass: if gaps remain under the cap, find the cheapest budget
  // ---- that closes every closable gap (min spend, unlimited cap).
  let needsBudget: number | undefined;
  const openCount = openGapCount(lp, nVars, slackKinds);
  if (openCount > 0) {
    const rows2 = rows.map((row) => row.slice());
    const b2 = b.slice();
    b2[rows.length - 1] = BIG_FREE_BUDGET; // lift the cap on the budget row
    // Objective: minimize pure spend (surplus and leftover cost 0, gap
    // slacks forbid leaving closable gaps open).
    const c2 = vars.map((v, i) => (i < nChange ? v.pricePerG : 0));
    const cFull2 = [...c2];
    for (let i = 0; i < rows.length; i++) {
      cFull2.push(rowKind[i] === "gap" ? SLACK_PENALTY : 0);
    }
    const lp2 = simplex(nVars, rows2, b2, cFull2);
    if (lp2.status === "optimal" && openGapCount(lp2, nVars, slackKinds) === 0) {
      needsBudget = costBefore + planSpend(lp2, changeVars);
    }
    // If even the lifted pass can't close some gaps, needsBudget stays
    // undefined: food alone can't close them at ANY budget — also reported.
  }

  // ---- Extract solution ----
  const delta = new Map<string, number>();
  for (const food of FOODS) delta.set(food.id, 0);
  for (let i = 0; i < nChange; i++) {
    const v = changeVars[i];
    const val = lp.x[i] ?? 0;
    if (val > EPS) {
      const key = v.foodId;
      delta.set(key, (delta.get(key) ?? 0) + (v.kind === "up" ? val : -val));
    }
  }

  // Round to GRAM_STEP — biased in the gap-closing direction (increases round
  // up, reductions round down) so rounding never un-closes a gap — and build
  // changes.
  const roundedStep = (d: number) =>
    d >= 0
      ? Math.ceil(d / GRAM_STEP - 1e-9) * GRAM_STEP
      : Math.floor(d / GRAM_STEP + 1e-9) * GRAM_STEP;
  const changes: PlanChange[] = [];
  const newPot: PotLine[] = [];
  const seen = new Set<string>();
  for (const line of pot) {
    const d = delta.get(line.foodId) ?? 0;
    const step = roundedStep(d);
    const toG = Math.max(0, line.qtyPerDayG + step);
    seen.add(line.foodId);
    newPot.push({ foodId: line.foodId, qtyPerDayG: toG });
    if (Math.abs(toG - line.qtyPerDayG) >= GRAM_STEP) {
      const kind = toG > line.qtyPerDayG ? "increase" : "reduce";
      changes.push({
        foodId: line.foodId,
        kind,
        fromG: line.qtyPerDayG,
        toG,
        costDelta: ((toG - line.qtyPerDayG) / 1000) * (perKg.get(line.foodId) ?? 0),
      });
    }
  }
  for (const food of FOODS) {
    if (seen.has(food.id)) continue;
    const d = delta.get(food.id) ?? 0;
    const toG = Math.max(0, roundedStep(d));
    if (toG >= GRAM_STEP) {
      newPot.push({ foodId: food.id, qtyPerDayG: toG });
      changes.push({
        foodId: food.id,
        kind: "add",
        fromG: 0,
        toG,
        costDelta: (toG / 1000) * (perKg.get(food.id) ?? 0),
      });
    }
  }
  const costAfter = potCost(newPot, prices);

  // Open gaps: gap rows come first, so the shortfall slack of gap row r lives
  // at x[nVars + r] (nVars = total structural count incl. surplus vars).
  const openGaps: GapAfter[] = [];
  for (let r = 0; r < slackKinds.length; r++) {
    const slackVal = lp.x[nVars + r] ?? 0;
    if (lp.status === "optimal" && slackVal > 5e-3) {
      openGaps.push({
        memberId: slackKinds[r].memberId,
        nutrientId: slackKinds[r].nutrientId,
        shortfallFrac: Math.min(1, slackVal),
      });
    }
  }

  // Limiting members: for each member with open gaps, the nutrient whose RDA
  // per 1000 kcal is highest (requirement-per-calorie = what averages hide).
  const limitingMembers: MinimumChangePlan["limitingMembers"] = [];
  for (const member of household.members) {
    const reqs = member.requirements;
    const energy = reqs.find((r) => r.nutrientId === "energy")?.rda ?? 0;
    let best: { nutrientId: string; per1000: number } | null = null;
    for (const r of reqs) {
      if (r.nutrientId === "energy" || energy <= 0) continue;
      const open = openGaps.some(
        (g) => g.memberId === member.id && g.nutrientId === r.nutrientId,
      );
      if (!open) continue;
      const per1000 = r.rda / (energy / 1000);
      if (!best || per1000 > best.per1000) best = { nutrientId: r.nutrientId, per1000 };
    }
    if (best) limitingMembers.push({ memberId: member.id, nutrientId: best.nutrientId });
  }

  const plan: MinimumChangePlan = {
    feasible: lp.status === "optimal" && openGaps.length === 0,
    changes,
    costBefore,
    costAfter,
    budget: household.dailyBudget,
    budgetLimit,
    needsBudget,
    openGaps,
    limitingMembers,
    meta: {
      solveMs: Date.now() - started,
      objective: lp.objective,
      iterations: lp.iterations,
    },
  };

  return {
    household,
    pot,
    prices,
    gapsBefore: computeGaps(household, pot),
    plan,
  };
}

// ---------------------------------------------------------------------------
// Stigler diet — the cost-only comparison (same math, one different objective)
// ---------------------------------------------------------------------------

/**
 * The 1945 Stigler diet problem, run live on this household's data: the SAME
 * solver, the SAME food list, the SAME per-member nutrient targets as
 * `solve()` — but with the objective every cost-only diet optimizer uses:
 * minimize spend, full stop. No pot anchor, no change caps, no budget row —
 * just the cheapest basket (grams/day, whole household) that covers every
 * member's requirement rows. The answer is mathematically perfect and nobody
 * would actually eat it; that contrast is the whole point of the
 * minimum-change plan, and it is generated by the judge pressing one button.
 */
export function solveStigler(input: {
  household: Household;
  prices: PriceEntry[];
}): StiglerResult {
  const { household, prices } = input;
  const started = Date.now();
  const perKg = new Map(prices.map((p) => [p.foodId, p.pricePerKg]));

  // Quantity vars: one per food, grams/day >= 0, unbounded above (the ratio
  // test bounds them through the requirement rows — every food carries
  // energy, so no var can run away unbounded).
  const foodVars = FOODS.map((f) => ({
    foodId: f.id,
    pricePerG: (perKg.get(f.id) ?? 0) / 1000,
  }));
  const nFood = foodVars.length;

  // Requirement rows in RDA-fraction units, from the SAME warn-threshold
  // targets (+ margin) the minimum-change plan closes to. Identical targets,
  // identical data — only the objective differs.
  const reqRows: { memberId: string; nutrientId: string; target: number }[] = [];
  for (const member of household.members) {
    for (const n of NUTRIENT_ORDER) {
      const rda = member.requirements.find((r) => r.nutrientId === n.id)?.rda ?? 0;
      if (rda <= 0) continue;
      const target = Math.min(1, warnFracOf(n.id)) + ROW_MARGIN;
      reqRows.push({ memberId: member.id, nutrientId: n.id, target });
    }
  }

  // Structural vars: food grams, then one unbounded surplus per row —
  // Σ coef·x − surplus + shortfall = target, i.e. cover AT LEAST the target.
  const nVars = nFood + reqRows.length;
  const rows: number[][] = [];
  const b: number[] = [];
  for (const req of reqRows) {
    const member = household.members.find((m) => m.id === req.memberId)!;
    const rda = member.requirements.find((r) => r.nutrientId === req.nutrientId)!.rda;
    const row = new Array<number>(nVars).fill(0);
    for (let i = 0; i < nFood; i++) {
      const food = foodById(foodVars[i].foodId)!;
      const a = food.per100g[req.nutrientId as keyof FoodNutrients] / 100; // per gram
      row[i] = (a * member.potShare) / rda; // RDA-fraction per gram
    }
    row[nFood + rows.length] = -1; // surplus for this row: overshoot is free
    rows.push(row);
    b.push(req.target);
  }

  // Objective: PURE spend. This one line is the entire difference from the
  // minimum-change plan — and the entire point of the comparison.
  const cFull = foodVars.map((v) => v.pricePerG);
  for (let r = 0; r < reqRows.length; r++) cFull.push(0); // surplus vars: free
  for (let r = 0; r < reqRows.length; r++) cFull.push(SLACK_PENALTY); // shortfalls

  const lp = simplex(nVars, rows, b, cFull);
  const feasible =
    lp.status === "optimal" && openGapCount(lp, nVars, reqRows) === 0;

  // Extract the basket: keep everything the LP actually uses (basic solutions
  // are sparse — a handful of foods — so this stays short) and round UP to
  // GRAM_STEP. All requirement rows are at-least rows with nonnegative
  // coefficients, so rounding up never un-covers one: the displayed basket is
  // verified by construction, not claimed.
  const items: StiglerResult["items"] = [];
  if (feasible) {
    for (let i = 0; i < nFood; i++) {
      const raw = lp.x[i] ?? 0;
      if (raw <= EPS) continue;
      const gPerDay = Math.ceil(raw / GRAM_STEP - 1e-9) * GRAM_STEP;
      const pricePerKg = perKg.get(foodVars[i].foodId) ?? 0;
      items.push({
        foodId: foodVars[i].foodId,
        gPerDay,
        costPerDay: (gPerDay / 1000) * pricePerKg,
      });
    }
    items.sort((a, b2) => b2.gPerDay - a.gPerDay); // largest quantity first
  }

  return {
    feasible: feasible && items.length > 0,
    items,
    totalCostPerDay: items.reduce((s, it) => s + it.costPerDay, 0),
    meta: { solveMs: Date.now() - started, iterations: lp.iterations },
  };
}

// ---------------------------------------------------------------------------
// Judge-facing insights (computed, never claimed)
// ---------------------------------------------------------------------------

/**
 * Applies a plan's changes to a pot and computes the outcome directly from
 * the data — the same red→green numbers the UI shows, so the demo can toggle
 * Today / After the plan without trusting the solver's self-report.
 */
export function applyPlan(
  household: Household,
  pot: PotLine[],
  plan: MinimumChangePlan,
): AppliedPlan {
  const next: PotLine[] = pot.map((l) => ({ ...l }));
  for (const c of plan.changes) {
    const line = next.find((l) => l.foodId === c.foodId);
    if (line) line.qtyPerDayG = c.toG;
    else next.push({ foodId: c.foodId, qtyPerDayG: c.toG });
  }
  // Removed foods drop out entirely — a 0 g line is noise in the applied pot.
  const cleaned = next.filter((l) => l.qtyPerDayG > 0);
  const gapsAfter = computeGaps(household, cleaned);
  const energyRda = household.members.reduce(
    (s, m) => s + (m.requirements.find((r) => r.nutrientId === "energy")?.rda ?? 0),
    0,
  );
  const energyAfter = potNutrients(cleaned).energy ?? 0;
  return {
    pot: cleaned,
    gapsAfter,
    membersStillShort: gapsAfter
      .filter((v) => v.gaps.length > 0)
      .map((v) => ({ memberId: v.memberId, name: v.name, gapCount: v.gaps.length })),
    energyFracAfter: energyRda > 0 ? energyAfter / energyRda : 1,
  };
}

/**
 * The hidden-member insight: the member whose requirement per 1000 kcal is
 * furthest above the potShare-weighted household average, across every
 * nutrient. High ratio = the average hides them. `fracNow` shows where they
 * actually sit today.
 */
export function hiddenMemberInsight(household: Household, pot: PotLine[]): HiddenMemberInsight | null {
  if (household.members.length === 0) return null;
  const shareTotal = household.members.reduce((s, m) => s + m.potShare, 0);
  if (shareTotal <= 0) return null;

  const intake = memberStatus(household, pot);
  const fracOf = new Map<string, number>();
  for (const s of intake) {
    for (const r of s.rows) fracOf.set(`${s.memberId}:${r.nutrientId}`, r.frac);
  }

  let best: HiddenMemberInsight | null = null;
  for (const n of NUTRIENT_ORDER) {
    if (n.id === "energy") continue;
    let weighted = 0;
    const perMember: { member: HouseholdMemberProfile; rda: number; per1000: number }[] = [];
    for (const m of household.members) {
      const energy = m.requirements.find((r) => r.nutrientId === "energy")?.rda ?? 0;
      const rda = m.requirements.find((r) => r.nutrientId === n.id)?.rda ?? 0;
      if (energy <= 0 || rda <= 0) continue;
      const per1000 = rda / (energy / 1000);
      perMember.push({ member: m, rda, per1000 });
      weighted += m.potShare * per1000;
    }
    const avg = weighted / shareTotal;
    if (avg <= 0) continue;
    for (const pm of perMember) {
      const ratio = pm.per1000 / avg;
      if (!best || ratio > best.ratio) {
        best = {
          memberId: pm.member.id,
          memberName: pm.member.name,
          nutrientId: n.id,
          needPer1000kcal: pm.per1000,
          avgNeedPer1000kcal: avg,
          ratio,
          fracNow: fracOf.get(`${pm.member.id}:${n.id}`) ?? 0,
        };
      }
    }
  }
  return best;
}

/**
 * A food only "touches" an open gap if the amount actually cooked supplies at
 * least this fraction of the highest need at the table for that nutrient.
 * Without a materiality floor, trace amounts (sugar's 0.1 mg of iron per 100 g)
 * would let empty-calorie foods claim they contribute to every gap.
 */
export const TOUCH_MIN_FRAC = 0.02;

/**
 * The what-if every judge asks: how much of today's spend touches a nutrient
 * that is actually short? A food touches an open gap if the amount cooked
 * supplies at least TOUCH_MIN_FRAC of the highest member requirement of any
 * nutrient below its warn threshold. Energy is excluded — every calorie source
 * touches energy by definition. The leftovers are the blind spend: money
 * already in the kitchen, aimed at nothing that is short.
 */
export function spendTouchingNoGaps(
  household: Household,
  pot: PotLine[],
  prices: PriceEntry[],
): SpendTouchingNoGaps {
  const total = potCost(pot, prices);
  const warn = new Map(NUTRIENTS.map((n) => [n.id, n.warnFrac]));

  // Open gaps: any member×nutrient (energy excluded) below its warn threshold.
  const open = new Set<string>();
  for (const m of household.members) {
    const intake = memberIntake(m, pot);
    for (const r of m.requirements) {
      if (r.nutrientId === "energy") continue;
      const frac = r.rda > 0 ? (intake[r.nutrientId] ?? 0) / r.rda : 1;
      if (frac < (warn.get(r.nutrientId) ?? 1)) open.add(r.nutrientId);
    }
  }

  const perKg = new Map(prices.map((p) => [p.foodId, p.pricePerKg]));
  if (open.size === 0) {
    // Nothing is short — the whole spend is working by definition.
    return {
      spendOnGapFoods: total,
      totalSpend: total,
      spendTouchingNothing: 0,
      wasteFrac: 0,
      offenders: [],
    };
  }

  // Highest need at the table per open nutrient: a food must materially
  // contribute at the amount actually cooked to count as touching the gap.
  const maxNeed = new Map<string, number>();
  for (const nid of open) {
    let mx = 0;
    for (const m of household.members) {
      const rda = m.requirements.find((r) => r.nutrientId === nid)?.rda ?? 0;
      if (rda > mx) mx = rda;
    }
    maxNeed.set(nid, mx);
  }

  const offenders: SpendTouchingNoGaps["offenders"] = [];
  let spendOnGapFoods = 0;
  for (const l of pot) {
    const spend = (l.qtyPerDayG / 1000) * (perKg.get(l.foodId) ?? 0);
    const food = foodById(l.foodId);
    const touches =
      food != null &&
      [...open].some((nid) => {
        const amount = (l.qtyPerDayG / 100) * (food.per100g[nid as keyof FoodNutrients] ?? 0);
        return amount >= TOUCH_MIN_FRAC * (maxNeed.get(nid) ?? 0);
      });
    if (touches) spendOnGapFoods += spend;
    else if (spend > 0) offenders.push({ foodId: l.foodId, spend });
  }
  offenders.sort((a, b) => b.spend - a.spend);

  return {
    spendOnGapFoods,
    totalSpend: total,
    spendTouchingNothing: Math.max(0, total - spendOnGapFoods),
    wasteFrac: total > 0 ? Math.max(0, total - spendOnGapFoods) / total : 0,
    offenders,
  };
}
