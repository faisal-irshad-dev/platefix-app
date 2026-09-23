// PlateFix engine — gap computation + minimum-change LP solver.
//
// Model:
//   Decision vars per food f: p_f (increase, g/day) and m_f (decrease, g/day),
//   both >= 0, bounded by change caps relative to the current pot.
//   For each member m and nutrient n with a shortfall, one constraint:
//     sum_f (a_fn * share_m / RDA_mn) * (p_f - m_f) + s_mn = gap_mn
//   where gap_mn is the missing FRACTION of the member's RDA, a_fn is nutrient
//   n per gram of food f, and s_mn >= 0 absorbs whatever cannot be closed.
//   Budget row: sum_f (price_f/1000) * (p_f - m_f) + e = budgetHeadroom.
//   Objective: minimize (1 + price_f/1000) * (p_f + m_f)  [small + cheap]
//             + SLACK_PENALTY * s_mn  [close gaps first]
//             + BUDGET_PENALTY * e    [prefer raising spend over leaving gaps].
//   If s* > 0 for a gap after solving, the gap honestly cannot be closed.
//   If e* > 0, the plan fits only above the stated budget — reported, not hidden.
//
// Implementation: dense tableau simplex starting from the all-slack basis
// (always primal-feasible; no Phase 1 needed), Dantzig pricing with Bland's
// rule fallback against cycling. Problem sizes here are tiny (tens of vars,
// ~80 rows), so plain dense simplex is the right tool.

import { FOODS, foodById, NUTRIENT_ORDER } from "./data/foods";
import { NUTRIENTS } from "./data/nutrients";
import type {
  GapAfter,
  Household,
  HouseholdMemberProfile,
  MemberGapView,
  MinimumChangePlan,
  PlanChange,
  PlanResult,
  PotLine,
  PriceEntry,
} from "./types";

// Engine tuning knobs (constants, not data).
export const MAX_ADD_FRAC = 0.75; // existing foods: use can rise by up to 75%
export const MAX_REDUCE_FRAC = 0.75; // existing foods: use can fall by up to 75%
export const NEW_FOOD_MAX_G = 300; // a food not in the pot can be added up to 300 g
export const SLACK_PENALTY = 1e6; // per unit of unclosed gap (fraction of RDA)
export const BUDGET_PENALTY = 1e4; // per currency unit of budget overshoot
export const GRAM_STEP = 5; // changes are rounded to this many grams
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

  // Effective budget: never force the plan below what the family already
  // spends (that would make the LP infeasible for accounting reasons); the UI
  // surfaces "current pot already exceeds budget" separately. A small buffer
  // absorbs gram-rounding so the stated budget is never breached.
  const ROUNDING_BUFFER = 2;
  const budget = Math.max(household.dailyBudget, costBefore) + 1e-6;
  const headroom = Math.max(0, budget - costBefore - ROUNDING_BUFFER);

  // ---- Build LP ----
  // Structural vars: [p_f..., m_f...] for foods where the bound is nonzero.
  interface VarDef { foodId: string; kind: "up" | "down"; bound: number; pricePerG: number }
  const vars: VarDef[] = [];
  for (const food of FOODS) {
    const price = (perKg.get(food.id) ?? 0) / 1000;
    const curG = cur.get(food.id) ?? 0;
    const upBound = curG > 0 ? curG * addFrac : NEW_FOOD_MAX_G;
    if (upBound > EPS) vars.push({ foodId: food.id, kind: "up", bound: upBound, pricePerG: price });
    const downBound = curG > 0 ? curG * reduceFrac : 0;
    if (downBound > EPS) vars.push({ foodId: food.id, kind: "down", bound: downBound, pricePerG: price });
  }
  const varIndex = new Map<string, number>();
  vars.forEach((v, i) => varIndex.set(`${v.foodId}:${v.kind}`, i));
  const nVars = vars.length;

  // Cost vector.
  const c = vars.map((v) => 1 + v.pricePerG); // grams changed, cheap preferred

  // Rows.
  const rows: number[][] = [];
  const b: number[] = [];
  const slackKinds: { memberId: string; nutrientId: string }[] = [];
  const rowKind: ("gap" | "budget")[] = [];

  // Gap rows (fraction-of-RDA units).
  const rdaOf = new Map<string, number>();
  for (const m of household.members) {
    for (const r of m.requirements) rdaOf.set(`${m.id}:${r.nutrientId}`, r.rda);
  }
  for (const member of household.members) {
    for (const n of NUTRIENT_ORDER) {
      const nid = n.id;
      const rda = rdaOf.get(`${member.id}:${nid}`) ?? 0;
      if (rda <= 0) continue;
      const got = (potTotals[nid] ?? 0) * member.potShare;
      const gapFrac = (rda - got) / rda;
      if (gapFrac <= 1e-4) continue; // already met
      const row = new Array<number>(nVars).fill(0);
      for (let i = 0; i < nVars; i++) {
        const v = vars[i];
        const food = foodById(v.foodId)!;
        const a = food.per100g[nid] / 100; // nutrient per gram
        const coef = (a * member.potShare) / rda; // RDA-fraction per gram
        row[i] = v.kind === "up" ? coef : -coef;
      }
      rows.push(row);
      b.push(gapFrac);
      slackKinds.push({ memberId: member.id, nutrientId: nid });
      rowKind.push("gap");
    }
  }

  // Bound rows: p_f <= upBound, m_f <= downBound (each with a zero-cost slack).
  for (let i = 0; i < nVars; i++) {
    const row = new Array<number>(nVars).fill(0);
    row[i] = 1;
    rows.push(row);
    b.push(vars[i].bound);
    rowKind.push("bound");
  }

  // Budget row (currency units): sum price_g*(p - m) + e = headroom.
  {
    const row = new Array<number>(nVars).fill(0);
    for (let i = 0; i < nVars; i++) {
      row[i] = vars[i].kind === "up" ? vars[i].pricePerG : -vars[i].pricePerG;
    }
    rows.push(row);
    b.push(headroom);
    rowKind.push("budget");
  }

  // Slack cost vector (gap slacks = SLACK_PENALTY, budget excess =
  // BUDGET_PENALTY, bound slacks = 0).
  const cFull = [...c];
  for (let i = 0; i < rows.length; i++) {
    cFull.push(
      rowKind[i] === "gap"
        ? SLACK_PENALTY
        : rowKind[i] === "budget"
          ? BUDGET_PENALTY
          : 0,
    );
  }

  const lp = simplex(nVars, rows, b, cFull);

  // ---- Extract solution ----
  const delta = new Map<string, number>();
  for (const food of FOODS) delta.set(food.id, 0);
  for (let i = 0; i < nVars; i++) {
    const v = vars[i];
    const val = lp.x[i] ?? 0;
    if (val > EPS) {
      const key = v.foodId;
      delta.set(key, (delta.get(key) ?? 0) + (v.kind === "up" ? val : -val));
    }
  }

  // Round to GRAM_STEP and build changes.
  const changes: PlanChange[] = [];
  const newPot: PotLine[] = [];
  const seen = new Set<string>();
  for (const line of pot) {
    const d = delta.get(line.foodId) ?? 0;
    const step = Math.round(d / GRAM_STEP) * GRAM_STEP;
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
    const toG = Math.max(0, Math.round(d / GRAM_STEP) * GRAM_STEP);
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

  // Open gaps: gap rows whose slack stayed positive (slack r lives at x[nVars+r]).
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
  const budgetExceeded = costAfter > household.dailyBudget + 0.01;

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
    openGaps,
    limitingMembers,
    meta: {
      solveMs: Date.now() - started,
      objective: lp.objective,
      iterations: lp.iterations,
    },
  };
  void budgetExceeded; // surfaced via costAfter vs budget in the UI

  return {
    household,
    pot,
    prices,
    gapsBefore: computeGaps(household, pot),
    plan,
  };
}
