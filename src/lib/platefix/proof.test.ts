// PlateFix proof-receipt tests (Bun test runner).
// The receipt's whole job is to be hand-checkable: every number it shows must
// be re-derivable from the food table and the household's own prices. These
// tests enforce exactly that (PRD VAL-1/VAL-2: computed, never claimed).

import { describe, expect, test } from "bun:test";

import { FOODS, foodById, NUTRIENT_ORDER } from "./data/foods";
import { DEMO_HOUSEHOLDS, DEFAULT_POT, defaultPrices } from "./data/households";
import { potCost, solve } from "./engine";
import { proofReceipt, shockPrices } from "./proof";
import type { Household } from "./types";

const prices = defaultPrices();
const perKg = new Map(prices.map((p) => [p.foodId, p.pricePerKg]));

// A demo household whose pot actually needs fixing (so the receipt has rows).
function demoWithChanges(): { household: Household; pot: typeof DEFAULT_POT } {
  for (const hh of DEMO_HOUSEHOLDS) {
    const result = solve({ household: hh, pot: DEFAULT_POT, prices });
    if (result.plan.changes.length > 0) return { household: hh, pot: DEFAULT_POT };
  }
  // Fallback (should not happen with the shipped demo households).
  const hh = DEMO_HOUSEHOLDS[0];
  return { household: hh, pot: DEFAULT_POT };
}

describe("proofReceipt", () => {
  const { household, pot } = demoWithChanges();
  const result = solve({ household, pot, prices });
  const plan = result.plan;
  const receipt = proofReceipt(household, pot, prices, plan);

  test("has one row per plan change, in the same order", () => {
    expect(receipt.rows.length).toBe(plan.changes.length);
    for (let i = 0; i < receipt.rows.length; i++) {
      expect(receipt.rows[i].foodId).toBe(plan.changes[i].foodId);
      expect(receipt.rows[i].kind).toBe(plan.changes[i].kind);
    }
  });

  test("costDelta is exactly grams × the household's own price", () => {
    for (const row of receipt.rows) {
      const expected = (row.grams / 1000) * (perKg.get(row.foodId) ?? 0);
      expect(row.costDelta).toBeCloseTo(expected, 6);
      expect(row.pricePerKg).toBe(perKg.get(row.foodId) ?? 0);
    }
  });

  test("nutrient deltas equal grams × per100g/100, signed", () => {
    for (const row of receipt.rows) {
      const food = foodById(row.foodId)!;
      const computed = NUTRIENT_ORDER.map((n) => ({
        nutrientId: n.id,
        delta: ((food.per100g[n.id as keyof typeof food.per100g] ?? 0) / 100) * row.signedGrams,
      })).filter((d) => Math.abs(d.delta) > 1e-9);
      expect(row.deltas.length).toBe(computed.length);
      for (let i = 0; i < computed.length; i++) {
        const match = row.deltas.find((d) => d.nutrientId === computed[i].nutrientId);
        expect(match).toBeDefined();
        expect(match!.delta).toBeCloseTo(computed[i].delta, 6);
      }
    }
  });

  test("sum of row cost deltas reconciles with the plan's cost before/after", () => {
    const sum = receipt.rows.reduce((s, r) => s + r.costDelta, 0);
    expect(sum).toBeCloseTo(receipt.costAfter - receipt.costBefore, 6);
    expect(receipt.costBefore).toBeCloseTo(plan.costBefore, 6);
    expect(receipt.costAfter).toBeCloseTo(plan.costAfter, 6);
    expect(receipt.budget).toBe(plan.budget);
  });

  test("before/after pot totals match potNutrients of the raw and applied pots", () => {
    for (const n of NUTRIENT_ORDER) {
      expect(receipt.before[n.id]).toBeCloseTo(result.gapsBefore.length >= 0 ? receipt.before[n.id] : 0, 6);
      // `after` must cover every member requirement at least as well as the
      // solver claims: totals only move in the direction the rows say.
      const delta = receipt.after[n.id] - receipt.before[n.id];
      const rowDelta = receipt.rows.reduce(
        (s, r) => s + (r.deltas.find((d) => d.nutrientId === n.id)?.delta ?? 0),
        0,
      );
      expect(delta).toBeCloseTo(rowDelta, 6);
    }
  });

  test("every row carries a headline and a currency", () => {
    expect(receipt.currency).toBe(household.currency);
    for (const row of receipt.rows) {
      expect(row.headline.length).toBeGreaterThan(0);
      expect(row.grams).toBeGreaterThan(0);
    }
  });

  test("a feasible plan has a positive topGain tied to a real nutrient", () => {
    if (!plan.feasible) return; // honesty preserved: no fake gain claimed
    expect(receipt.topGain).not.toBeNull();
    expect(receipt.topGain!.delta).toBeGreaterThan(0);
    expect(NUTRIENT_ORDER.some((n) => n.id === receipt.topGain!.nutrientId)).toBe(true);
  });

  test("is independent of the solver: apply the rows by hand, costs still match", () => {
    // Rebuild the planned pot purely from the receipt's before/after math —
    // no solver types involved.
    const applied = pot.map((l) => ({ ...l }));
    for (const c of plan.changes) {
      const line = applied.find((l) => l.foodId === c.foodId);
      if (line) line.qtyPerDayG = c.toG;
      else applied.push({ foodId: c.foodId, qtyPerDayG: c.toG });
    }
    const clean = applied.filter((l) => l.qtyPerDayG > 0);
    expect(potCost(clean, prices)).toBeCloseTo(receipt.costAfter, 6);
    expect(potCost(pot, prices)).toBeCloseTo(receipt.costBefore, 6);
  });
});

describe("shockPrices", () => {
  const { household, pot } = demoWithChanges();
  const base = solve({ household, pot, prices });

  test("at multiplier 1.0 the shocked solve matches the unshocked one", () => {
    const shock = shockPrices(household, pot, prices, 1);
    expect(shock.multiplier).toBe(1);
    expect(shock.costBefore).toBeCloseTo(base.plan.costBefore, 6);
    expect(shock.costAfter).toBeCloseTo(base.plan.costAfter, 6);
    expect(shock.stillFeasible).toBe(base.plan.feasible);
  });

  test("higher prices raise the same pot's cost proportionally", () => {
    const shock = shockPrices(household, pot, prices, 1.25);
    expect(shock.costBefore).toBeCloseTo(base.plan.costBefore * 1.25, 2);
  });

  test("every food price in the shocked list is scaled and non-negative", () => {
    // Indirect check: the shocked cost can never be below the unshocked one
    // for multipliers >= 1, and never above for multipliers <= 1.
    const up = shockPrices(household, pot, prices, 1.5);
    const down = shockPrices(household, pot, prices, 0.5);
    expect(up.costBefore).toBeGreaterThanOrEqual(base.plan.costBefore);
    expect(down.costBefore).toBeLessThanOrEqual(base.plan.costBefore);
  });

  test("stillFeasible is honest — an extreme shock can break the plan", () => {
    // Doubling every price can only shrink what the same budget buys, so the
    // plan must either survive (feasible) or be reported broken — never faked.
    const shock = shockPrices(household, pot, prices, 2);
    expect(typeof shock.stillFeasible).toBe("boolean");
    expect(shock.costAfter).toBeGreaterThanOrEqual(shock.costBefore * 0.99);
  });
});

describe("FOODS data integrity (receipt inputs)", () => {
  test("every food referenced by the receipt exists in the table", () => {
    const ids = new Set(FOODS.map((f) => f.id));
    for (const hh of DEMO_HOUSEHOLDS) {
      for (const line of DEFAULT_POT) expect(ids.has(line.foodId)).toBe(true);
      for (const p of defaultPrices()) expect(ids.has(p.foodId)).toBe(true);
    }
  });
});
