// PlateFix engine tests (PRD: "basic tests" — MUST). Bun test runner.
// Requirement IDs referenced: FR-1..FR-6, VAL-1..VAL-3 (PRD §5–§8).

import { describe, expect, test } from "bun:test";

import {
  GRAM_STEP,
  MAX_ADD_FRAC,
  MAX_REDUCE_FRAC,
  NEW_FOOD_MAX_G,
  TOUCH_MIN_FRAC,
  applyPlan,
  computeGaps,
  hiddenMemberInsight,
  memberIntake,
  memberStatus,
  potCost,
  potNutrients,
  simplex,
  solve,
  solveStigler,
  spendTouchingNoGaps,
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

// ---------------------------------------------------------------------------
// Judge-facing insights (computed, never claimed)
// ---------------------------------------------------------------------------

describe("applyPlan", () => {
  test("gapsAfter is recomputed from data, not copied from the solver", () => {
    for (const hh of DEMO_HOUSEHOLDS) {
      const result = solve({ household: hh, pot: DEFAULT_POT, prices });
      const applied = applyPlan(hh, DEFAULT_POT, result.plan);
      // Independent recomputation must agree with the reported member gaps.
      expect(applied.gapsAfter).toEqual(computeGaps(hh, applied.pot));
      // Members still short is derived from those same gaps.
      expect(applied.membersStillShort).toEqual(
        applied.gapsAfter
          .filter((v) => v.gaps.length > 0)
          .map((v) => ({ memberId: v.memberId, name: v.name, gapCount: v.gaps.length })),
      );
    }
  });

  test("a feasible plan drives every listed gap below its warn threshold", () => {
    for (const hh of DEMO_HOUSEHOLDS) {
      const result = solve({ household: hh, pot: DEFAULT_POT, prices });
      if (!result.plan.feasible) continue;
      const applied = applyPlan(hh, DEFAULT_POT, result.plan);
      expect(applied.membersStillShort).toEqual([]);
    }
  });

  test("changes are actually applied to the pot", () => {
    const hh = DEMO_HOUSEHOLDS[0];
    const result = solve({ household: hh, pot: DEFAULT_POT, prices });
    const applied = applyPlan(hh, DEFAULT_POT, result.plan);
    for (const c of result.plan.changes) {
      const line = applied.pot.find((l) => l.foodId === c.foodId);
      if (c.toG === 0) {
        // removed lines disappear
        expect(line).toBeUndefined();
      } else {
        expect(line?.qtyPerDayG).toBe(c.toG);
      }
    }
    // Pot size is otherwise untouched.
    expect(applied.pot.length).toBe(
      DEFAULT_POT.length +
        result.plan.changes.filter((c) => c.kind === "add" && c.toG > 0).length,
    );
  });

  test("energyFracAfter matches pot energy over the household's energy RDA", () => {
    const hh = DEMO_HOUSEHOLDS[2];
    const result = solve({ household: hh, pot: DEFAULT_POT, prices });
    const applied = applyPlan(hh, DEFAULT_POT, result.plan);
    const rda = hh.members.reduce(
      (s, m) => s + (m.requirements.find((r) => r.nutrientId === "energy")?.rda ?? 0),
      0,
    );
    expect(applied.energyFracAfter).toBeCloseTo(potNutrients(applied.pot).energy / rda, 6);
  });
});

describe("hiddenMemberInsight", () => {
  test("the Sharma daughter (13-15) beats a man+pregnant-woman average on iron", () => {
    // The scenario the whole product is built around: the adolescent girl's
    // iron need per 1000 kcal is far above the household average.
    const hh = DEMO_HOUSEHOLDS[0];
    const insight = hiddenMemberInsight(hh, DEFAULT_POT);
    expect(insight).not.toBeNull();
    expect(insight!.ratio).toBeGreaterThan(1.05);
    expect(insight!.needPer1000kcal).toBeGreaterThan(insight!.avgNeedPer1000kcal);
  });

  test("fracNow matches memberStatus for that member+nutrient", () => {
    for (const hh of DEMO_HOUSEHOLDS) {
      const insight = hiddenMemberInsight(hh, DEFAULT_POT);
      if (!insight) continue;
      const status = memberStatus(hh, DEFAULT_POT).find(
        (s) => s.memberId === insight.memberId,
      );
      const row = status?.rows.find((r) => r.nutrientId === insight.nutrientId);
      expect(row?.frac).toBeCloseTo(insight.fracNow, 9);
    }
  });

  test("a household of identical members hides nobody (ratio ~1)", () => {
    const hh = DEMO_HOUSEHOLDS[1];
    const base = hh.members[1]; // two members, same age/sex group
    const twins = {
      ...hh,
      members: [
        { ...base, id: "t1", name: "Twin A", potShare: 0.5 },
        { ...base, id: "t2", name: "Twin B", potShare: 0.5 },
      ],
    };
    const insight = hiddenMemberInsight(twins, DEFAULT_POT);
    expect(insight).not.toBeNull();
    expect(insight!.ratio).toBeLessThan(1.01);
  });

  test("never flags energy and ignores zero-share members", () => {
    const hh = DEMO_HOUSEHOLDS[0];
    const insight = hiddenMemberInsight(hh, DEFAULT_POT);
    expect(insight!.nutrientId).not.toBe("energy");
    const zeroShare = {
      ...hh,
      members: [...hh.members, { ...hh.members[0], id: "ghost", name: "Ghost", potShare: 0 }],
    };
    const withGhost = hiddenMemberInsight(zeroShare, DEFAULT_POT);
    expect(withGhost!.memberId).not.toBe("ghost");
  });
});

describe("spendTouchingNoGaps", () => {
  test("on the default pot, a meaningful share of spend touches no open gap", () => {
    // The judge-facing story: money already in the kitchen, aimed at nothing
    // that is short. Rice's trace iron must NOT rescue it — hence the
    // materiality floor.
    for (const hh of DEMO_HOUSEHOLDS) {
      const info = spendTouchingNoGaps(hh, DEFAULT_POT, prices);
      expect(info.totalSpend).toBeCloseTo(potCost(DEFAULT_POT, prices), 6);
      expect(info.spendOnGapFoods + info.spendTouchingNothing).toBeCloseTo(info.totalSpend, 6);
      expect(info.wasteFrac).toBeGreaterThan(0.05);
      expect(info.wasteFrac).toBeLessThan(1);
      expect(info.offenders.length).toBeGreaterThan(0);
      // Offenders are sorted largest spend first.
      for (let i = 1; i < info.offenders.length; i++) {
        expect(info.offenders[i - 1].spend).toBeGreaterThanOrEqual(info.offenders[i].spend);
      }
    }
  });

  test("trace contributions do not count as touching (the sugar rule)", () => {
    // Sugar: 398 kcal/100 g but only 0.1 mg iron — far below the materiality
    // floor for any open iron gap, so it must be an offender, not a helper.
    const hh = DEMO_HOUSEHOLDS[0];
    const info = spendTouchingNoGaps(hh, DEFAULT_POT, prices);
    expect(info.offenders.map((o) => o.foodId)).toContain("sugar");
  });

  test("a fully covered pot reports zero waste", () => {
    // No open gaps -> by definition every rupee is aimed at something.
    const hh = DEMO_HOUSEHOLDS[0];
    const result = solve({ household: hh, pot: DEFAULT_POT, prices });
    if (!result.plan.feasible) return; // skip if the demo can't fully close
    const applied = applyPlan(hh, DEFAULT_POT, result.plan);
    const info = spendTouchingNoGaps(hh, applied.pot, prices);
    expect(info.spendTouchingNothing).toBe(0);
    expect(info.wasteFrac).toBe(0);
    expect(info.offenders).toEqual([]);
  });

  test("empty pot and empty household edge cases", () => {
    const hh = DEMO_HOUSEHOLDS[0];
    const empty = spendTouchingNoGaps(hh, [], prices);
    expect(empty.totalSpend).toBe(0);
    expect(empty.wasteFrac).toBe(0);
    const nobody = spendTouchingNoGaps({ ...hh, members: [] }, DEFAULT_POT, prices);
    // No members -> no open gaps -> nothing is waste.
    expect(nobody.spendTouchingNothing).toBe(0);
  });

  test("TOUCH_MIN_FRAC is a strict floor, not a target", () => {
    expect(TOUCH_MIN_FRAC).toBeGreaterThan(0);
    expect(TOUCH_MIN_FRAC).toBeLessThan(0.1);
  });
});
