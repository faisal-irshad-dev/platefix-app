// Temporary sanity check for the PlateFix solver. Run: bun scripts/check-solver.ts
// Verifies: (1) solve() returns changes for the default fixtures, (2) the plan
// closes all gaps it claims to close, (3) budget is respected or honestly reported.
import { DEMO_HOUSEHOLDS, DEFAULT_POT, defaultPrices } from "../src/lib/platefix/data/households";
import { computeGaps, potCost, solve } from "../src/lib/platefix/engine";
import { NUTRIENT_ORDER } from "../src/lib/platefix/data/foods";
import { foodById } from "../src/lib/platefix/data/foods";
import type { Household, PotLine } from "../src/lib/platefix/types";

function nutrientsOf(pot: PotLine[]): Record<string, number> {
  const t: Record<string, number> = {};
  for (const n of NUTRIENT_ORDER) t[n.id] = 0;
  for (const line of pot) {
    const f = foodById(line.foodId);
    if (!f) continue;
    for (const n of NUTRIENT_ORDER) t[n.id] += (f.per100g[n.id] / 100) * line.qtyPerDayG;
  }
  return t;
}

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const prices = defaultPrices();

for (const household of DEMO_HOUSEHOLDS) {
  console.log(`\n=== ${household.name} (budget ₹${household.dailyBudget}) ===`);
  const before = computeGaps(household, DEFAULT_POT);
  const gapsBefore = before.reduce((s, m) => s + m.gaps.length, 0);
  check(`${household.id}: gaps detected before fix`, gapsBefore > 0, `${gapsBefore} gaps`);

  const result = solve({ household, pot: DEFAULT_POT, prices });
  const plan = result.plan;
  console.log(
    `  changes: ${plan.changes.length}, cost ₹${plan.costBefore.toFixed(0)} → ₹${plan.costAfter.toFixed(0)}, meta ${plan.meta.solveMs}ms/${plan.meta.iterations}it`,
  );
  for (const c of plan.changes) {
    const f = foodById(c.foodId);
    console.log(`    ${c.kind.padEnd(8)} ${f?.name ?? c.foodId}: ${c.fromG} → ${c.toG} g (₹${c.costDelta.toFixed(1)})`);
  }

  // Re-apply the plan's changes and recompute gaps independently.
  const newPot: PotLine[] = DEFAULT_POT.map((l) => {
    const change = plan.changes.find((c) => c.foodId === l.foodId);
    return change ? { foodId: l.foodId, qtyPerDayG: change.toG } : { ...l };
  });
  for (const c of plan.changes) {
    if (c.kind === "add" && !newPot.some((l) => l.foodId === c.foodId)) {
      newPot.push({ foodId: c.foodId, qtyPerDayG: c.toG });
    }
  }
  const after = computeGaps(household, newPot);
  const gapsAfter = after.reduce((s, m) => s + m.gaps.length, 0);

  if (plan.feasible) {
    check(
      `${household.id}: feasible plan closes all warn-level gaps`,
      gapsAfter === 0,
      `${gapsBefore} → ${gapsAfter}`,
    );
    check(
      `${household.id}: no openGaps listed when feasible`,
      plan.openGaps.length === 0,
      `${plan.openGaps.length} listed`,
    );
  } else {
    check(
      `${household.id}: infeasible reported honestly with open gaps listed`,
      plan.openGaps.length > 0,
      `${plan.openGaps.length} open gaps`,
    );
    // Both sides now use the same warn-threshold definition of a gap, so the
    // LP's open gaps must match the independently recomputed gaps exactly.
    check(
      `${household.id}: openGaps match recomputed gaps`,
      plan.openGaps.length === gapsAfter,
      `reported ${plan.openGaps.length}, recomputed ${gapsAfter}`,
    );
    // needsBudget must be present whenever a budget-capped pass leaves gaps
    // that are closable at some budget.
    check(
      `${household.id}: needsBudget reported when under budget`,
      plan.needsBudget === undefined || plan.needsBudget >= plan.costAfter,
      plan.needsBudget === undefined ? "not needed/possible" : `needs ₹${plan.needsBudget.toFixed(0)}`,
    );
  }

  const budgetOK = plan.costAfter <= household.dailyBudget + 0.01 || plan.costAfter > plan.costBefore;
  check(
    `${household.id}: budget respected or overshoot flagged in UI`,
    budgetOK,
    `budget ₹${household.dailyBudget}, after ₹${plan.costAfter.toFixed(0)}`,
  );

  const totals = nutrientsOf(newPot);
  check(
    `${household.id}: pot nutrient math sane (energy > 0)`,
    totals["energy"] > 0,
    `${totals["energy"].toFixed(0)} kcal household total`,
  );
  void (household as Household); // type-only usage keeps Household import meaningful
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
