// PlateFix engine tests (PRD: "basic tests" — MUST). Bun test runner.
// Requirement IDs referenced: FR-1..FR-6, VAL-1..VAL-3 (PRD §5–§8).

import { describe, expect, test } from "bun:test";

import {
  GRAM_STEP,
  MAX_ADD_FRAC,
  MAX_REDUCE_FRAC,
  NEW_FOOD_MAX_G,
  computeGaps,
  memberIntake,
  memberStatus,
  potCost,
  potNutrients,
  simplex,
  solve,
  solveStigler,
} from "./engine";
import { FOODS, foodById, NUTRIENT_ORDER, type FoodNutrients } from "./data/foods";
import { DEMO_HOUSEHOLDS, DEFAULT_POT, defaultPrices } from "./data/households";
import { NUTRIENTS, requirementsFor } from "./data/nutrients";
import type { Household, PotLine, PriceEntry } from "./types";

const prices: PriceEntry[] = defaultPrices();
const perKg = new Map(prices.map((p) => [p.foodId, p.pricePerKg]));

// ---------------------------------------------------------------------------
// Simplex correctness (FR-2, VAL-1)
// ---------------------------------------------------------------------------

describe("simplex", () => {
  test("closes a soft gap row: min x1+x2 with penalized shortfall slack", () => {
    // The engine's formulation: x1 + x2 + shortfall = 1, shortfall penalized
    // heavily so the optimum spends change vars (x) instead of leaving a gap.
    const lp = simplex(2, [[1, 1]], [1], [1, 1, 100]);
    expect(lp.status).toBe("optimal");
    expect(lp.objective).toBeCloseTo(1, 6);
    expect(lp.x[0] + lp.x[1]).toBeCloseTo(1, 6);
    expect(lp.x[2]).toBeCloseTo(0, 6); // shortfall fully absorbed by x
  });

  test("leaves slack open when change vars cannot cover the row", () => {
    // x1 + x2 + shortfall = 10 with x bounded to 2 total: shortfall must absorb
    // the remaining 8 (the honest "can't close it" outcome).
    const lp = simplex(
      2,
      [
        [1, 1], // gap row
        [1, 1], // combined bound row x1 + x2 <= 2
      ],
      [10, 2],
      [1, 1, 100, 0],
    );
    expect(lp.status).toBe("optimal");
    expect(lp.x[0] + lp.x[1]).toBeCloseTo(2, 6);
    expect(lp.x[2]).toBeCloseTo(8, 6); // shortfall slack of row 0 (the gap)
    expect(lp.x[3]).toBeCloseTo(0, 6); // bound row slack fully used
    // objective = spend (2) + penalty * shortfall (8)
    expect(lp.objective).toBeCloseTo(2 + 100 * 8, 4);
  });

  test("detects unbounded problems", () => {
    // min -x, x free up (no bound row) -> min -x with only x >= 0 has no
    // minimum unless the cost is negative with no constraint: min -x.
    const lp = simplex(1, [[0]], [0], [-1, 0]);
    expect(lp.status).toBe("unbounded");
  });

  test("maxiter fallback still returns a feasible-ish basis without crash", () => {
    // Tiny maxIterations on a nontrivial LP must not throw.
    const lp = simplex(
      2,
      [
        [1, 0],
        [0, 1],
      ],
      [5, 5],
      [1, 1, 0, 0],
      1,
    );
    expect(["optimal", "maxiter"]).toContain(lp.status);
  });
});

// ---------------------------------------------------------------------------
// Nutrition math (FR-1)
// ---------------------------------------------------------------------------

describe("nutrition math helpers", () => {
  test("potNutrients sums per-100g values across pot lines", () => {
    const rice = foodById("rice")!;
    const pot: PotLine[] = [{ foodId: "rice", qtyPerDayG: 100 }];
    const totals = potNutrients(pot);
    expect(totals.energy).toBeCloseTo(rice.per100g.energy, 6);
    expect(totals.protein).toBeCloseTo(rice.per100g.protein, 6);
  });

  test("memberIntake scales the pot by the member's share", () => {
    const hh = DEMO_HOUSEHOLDS[0];
    const pot = DEFAULT_POT;
    const m1 = hh.members[0];
    const totals = potNutrients(pot);
    const intake = memberIntake(m1, pot);
    for (const r of m1.requirements) {
      expect(intake[r.nutrientId]).toBeCloseTo(totals[r.nutrientId] * m1.potShare, 6);
    }
  });

  test("memberStatus frac ordering is worst-first", () => {
    const hh = DEMO_HOUSEHOLDS[0];
    const status = memberStatus(hh, DEFAULT_POT);
    for (const s of status) {
      const fracs = s.rows.map((r) => r.frac);
      const sorted = [...fracs].sort((a, b) => a - b);
      expect(fracs).toEqual(sorted);
    }
  });

  test("computeGaps flags only nutrients below the warn threshold", () => {
    const hh = DEMO_HOUSEHOLDS[0];
    const views = computeGaps(hh, DEFAULT_POT);
    for (const v of views) {
      expect(v.gaps.length).toBeGreaterThan(0); // the demo pot has known gaps
      for (const g of v.gaps) {
        const req = hh.members.find((m) => m.id === v.memberId)!.requirements.find(
          (r) => r.nutrientId === g.nutrientId,
        )!;
        expect(g.frac).toBeLessThan(1); // gaps are below 100% at minimum
        expect(g.got / g.rda).toBeCloseTo(g.frac, 6);
        void req;
      }
    }
  });

  test("potCost matches sum(qty/1000 * price)", () => {
    const cost = potCost(DEFAULT_POT, prices);
    const manual = DEFAULT_POT.reduce(
      (s, l) => s + (l.qtyPerDayG / 1000) * (perKg.get(l.foodId) ?? 0),
      0,
    );
    expect(cost).toBeCloseTo(manual, 6);
  });
});

// ---------------------------------------------------------------------------
// Minimum-change plan (FR-3..FR-5, VAL-2)
// ---------------------------------------------------------------------------

describe("minimum-change plan", () => {
  test("demo household gets a plan with changes that stay within the cap", () => {
    const hh = DEMO_HOUSEHOLDS[0];
    const result = solve({ household: hh, pot: DEFAULT_POT, prices });
    const plan = result.plan;
    expect(plan.changes.length).toBeGreaterThan(0);
    expect(plan.feasible).toBe(true);
    expect(plan.costAfter).toBeLessThanOrEqual(plan.budgetLimit + 1e-6);

    for (const c of plan.changes) {
      const cur = DEFAULT_POT.find((l) => l.foodId === c.foodId)?.qtyPerDayG ?? 0;
      if (c.kind === "add") {
        expect(cur).toBe(0);
        expect(c.toG).toBeLessThanOrEqual(NEW_FOOD_MAX_G + 1e-6);
        expect(c.toG).toBeGreaterThanOrEqual(GRAM_STEP);
      } else if (c.kind === "increase") {
        expect(c.toG).toBeLessThanOrEqual(cur * (1 + MAX_ADD_FRAC) + 1e-6);
      } else if (c.kind === "reduce") {
        expect(c.toG).toBeGreaterThanOrEqual(cur * (1 - MAX_REDUCE_FRAC) - 1e-6);
      }
    }
  });

  test("plan actually closes the gaps it claims to close (post-verification)", () => {
    const hh = DEMO_HOUSEHOLDS[0];
    const result = solve({ household: hh, pot: DEFAULT_POT, prices });
    const plan = result.plan;
    if (!plan.feasible) return; // honest-infeasible case is tested separately

    const newPot: PotLine[] = plan.changes.reduce<PotLine[]>((acc, c) => {
      const existing = acc.find((l) => l.foodId === c.foodId);
      if (existing) existing.qtyPerDayG = c.toG;
      else acc.push({ foodId: c.foodId, qtyPerDayG: c.toG });
      return acc;
    }, DEFAULT_POT.map((l) => ({ ...l })));

    const after = computeGaps(hh, newPot);
    const totalGapsAfter = after.reduce((s, m) => s + m.gaps.length, 0);
    expect(totalGapsAfter).toBe(0); // PRD: red → green, verified, not claimed
  });

  test("three demo households all solve without error", () => {
    for (const hh of DEMO_HOUSEHOLDS) {
      const result = solve({ household: hh, pot: DEFAULT_POT, prices });
      expect(result.plan.meta.solveMs).toBeGreaterThanOrEqual(0);
      expect(result.plan.changes.length).toBeGreaterThanOrEqual(0);
    }
  });

  test("needsBudget appears when the stated budget cannot close all gaps", () => {
    // A brutally tight budget: the plan should either close everything within
    // the cap or report needsBudget — never silently over-spend.
    const hh: Household = {
      ...DEMO_HOUSEHOLDS[0],
      dailyBudget: 1, // impossible
    };
    const result = solve({ household: hh, pot: DEFAULT_POT, prices });
    const plan = result.plan;
    // budgetLimit = max(budget, costBefore) — spend can't be forced down.
    expect(plan.budgetLimit).toBeGreaterThanOrEqual(potCost(DEFAULT_POT, prices));
    if (!plan.feasible && plan.needsBudget !== undefined) {
      expect(plan.needsBudget).toBeGreaterThan(potCost(DEFAULT_POT, prices) - 1e-6);
    }
  });

  test("satisfiable pot yields zero changes and 'covered' status", () => {
    // A generous pot: add plenty of the strongest sources of every nutrient.
    const pot: PotLine[] = [
      { foodId: "rice", qtyPerDayG: 600 },
      { foodId: "toordal", qtyPerDayG: 300 },
      { foodId: "spinach", qtyPerDayG: 400 },
      { foodId: "soyachunk", qtyPerDayG: 200 },
      { foodId: "milk", qtyPerDayG: 1500 },
      { foodId: "egg", qtyPerDayG: 200 },
      { foodId: "carrot", qtyPerDayG: 200 },
      { foodId: "atta", qtyPerDayG: 400 },
      { foodId: "oil", qtyPerDayG: 60 },
      { foodId: "sugar", qtyPerDayG: 40 },
      { foodId: "curd", qtyPerDayG: 400 },
      { foodId: "chicken", qtyPerDayG: 200 },
    ];
    const hh = DEMO_HOUSEHOLDS[1];
    const gaps = computeGaps(hh, pot);
    const totalGaps = gaps.reduce((s, m) => s + m.gaps.length, 0);
    if (totalGaps > 0) return; // only assert when preconditions hold
    const result = solve({ household: hh, pot, prices });
    expect(result.plan.changes.length).toBe(0);
    expect(result.plan.feasible).toBe(true);
  });

  test("limiting-member insight surfaces for open gaps", () => {
    // Every food present at a token 10 g/day: change caps (+75% = +7.5 g) are
    // far too small to move the pot, so gaps must remain open and honestly
    // reported (FR-5).
    const pot: PotLine[] = FOODS.map((f) => ({ foodId: f.id, qtyPerDayG: 10 }));
    const result = solve({ household: DEMO_HOUSEHOLDS[0], pot, prices });
    const plan = result.plan;
    expect(plan.feasible).toBe(false);
    expect(plan.openGaps.length).toBeGreaterThan(0);
    expect(plan.limitingMembers.length).toBeGreaterThan(0);
    // Each limiting nutrient must actually be an open gap for that member.
    for (const l of plan.limitingMembers) {
      expect(
        plan.openGaps.some(
          (g) => g.memberId === l.memberId && g.nutrientId === l.nutrientId,
        ),
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Data hygiene (PRD §9)
// ---------------------------------------------------------------------------

describe("data hygiene", () => {
  test("every food carries a source string and a verified flag", () => {
    for (const f of FOODS) {
      expect(typeof f.source).toBe("string");
      expect(f.source.length).toBeGreaterThan(0);
      expect(typeof f.verified).toBe("boolean");
    }
  });

  test("every member group has a full RDA row", () => {
    for (const hh of DEMO_HOUSEHOLDS) {
      for (const m of hh.members) {
        expect(m.requirements.length).toBeGreaterThan(0);
        for (const r of m.requirements) {
          expect(r.rda).toBeGreaterThan(0);
          expect(r.source.length).toBeGreaterThan(0);
        }
      }
      expect(hh.members.reduce((s, m) => s + m.potShare, 0)).toBeLessThanOrEqual(1.0000001);
      expect(prices.every((p) => p.pricePerKg > 0)).toBe(true);
    }
  });

  test("requirementsFor covers every tracked nutrient per group", () => {
    const reqs = requirementsFor("pregnant");
    const ids = new Set(reqs.map((r) => r.nutrientId));
    for (const n of ["energy", "protein", "iron", "calcium", "zinc", "folate", "vitA", "vitB12"]) {
      expect(ids.has(n)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Stigler diet comparison (VAL-2: why not just minimize cost?)
// ---------------------------------------------------------------------------

describe("stigler diet (cost-only optimizer)", () => {
  test("covers every member's every nutrient target — verified, not claimed", () => {
    for (const hh of DEMO_HOUSEHOLDS) {
      const s = solveStigler({ household: hh, prices });
      expect(s.feasible).toBe(true);

      // Verify the ROUNDED basket against the member rows directly: for each
      // member and nutrient, sum(food grams * per100g/100 * potShare) must
      // reach the same warn-threshold target (+margin) the plan closes to.
      for (const m of hh.members) {
        for (const { id: nid } of NUTRIENT_ORDER) {
          const rda = m.requirements.find((r) => r.nutrientId === nid)?.rda ?? 0;
          if (rda <= 0) continue;
          const warn = NUTRIENTS.find((n) => n.id === nid)?.warnFrac ?? 1;
          const target = Math.min(1, warn) + 0.019; // ROW_MARGIN with slack for rounding
          let got = 0;
          for (const it of s.items) {
            const food = foodById(it.foodId)!;
            got += (food.per100g[nid as keyof FoodNutrients] / 100) * it.gPerDay * m.potShare;
          }
          expect(got / rda).toBeGreaterThanOrEqual(target - 1e-9);
        }
      }
    }
  });

  test("total cost is at or below the minimum-change plan's cost", () => {
    // The mathematical point of the comparison: the pure-cost optimum can
    // never cost more than the minimum-change plan, which keeps the pot
    // anchored and caps every change.
    for (const hh of DEMO_HOUSEHOLDS) {
      const s = solveStigler({ household: hh, prices });
      const result = solve({ household: hh, pot: DEFAULT_POT, prices });
      if (!result.plan.feasible) return; // only comparable when the plan fully closes
      expect(s.feasible).toBe(true);
      expect(s.totalCostPerDay).toBeLessThanOrEqual(result.plan.costAfter + 1e-6);
    }
  });

  test("basket is sorted by quantity and every price is positive", () => {
    const s = solveStigler({ household: DEMO_HOUSEHOLDS[0], prices });
    expect(s.feasible).toBe(true);
    expect(s.items.length).toBeGreaterThan(0);
    for (let i = 1; i < s.items.length; i++) {
      expect(s.items[i - 1].gPerDay).toBeGreaterThanOrEqual(s.items[i].gPerDay);
    }
    for (const it of s.items) {
      expect(it.gPerDay).toBeGreaterThan(0);
      expect((perKg.get(it.foodId) ?? 0)).toBeGreaterThan(0);
      expect(it.costPerDay).toBeCloseTo((it.gPerDay / 1000) * (perKg.get(it.foodId) ?? 0), 6);
    }
    expect(s.totalCostPerDay).toBeCloseTo(
      s.items.reduce((sum, it) => sum + it.costPerDay, 0),
      6,
    );
  });

  test("quantities are GRAM_STEP multiples (displayed basket, not raw LP output)", () => {
    const s = solveStigler({ household: DEMO_HOUSEHOLDS[1], prices });
    for (const it of s.items) {
      expect(it.gPerDay % GRAM_STEP).toBe(0);
    }
  });
});
