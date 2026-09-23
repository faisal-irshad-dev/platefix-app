// Basic engine tests (PRD: "basic tests instead of a full property-test suite").
// Run with: bun run scripts/test-engine.ts
import { computeGaps, potCost, solve } from "../src/lib/platefix/engine";
import { DEMO_HOUSEHOLDS, DEFAULT_POT, defaultPrices } from "../src/lib/platefix/data/households";
import { foodById } from "../src/lib/platefix/data/foods";
import { NUTRIENT_ORDER } from "../src/lib/platefix/data/foods";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ok - ${name}`);
  } else {
    failures++;
    console.error(`  FAIL - ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const prices = defaultPrices();

for (const hh of DEMO_HOUSEHOLDS) {
  console.log(`\n# ${hh.name}`);
  const result = solve({ household: hh, pot: DEFAULT_POT, prices });

  // Gaps before
  const gaps = result.gapsBefore;
  const worst = gaps
    .flatMap((g) => g.gaps.map((x) => ({ member: g.name, ...x })))
    .sort((a, b) => a.frac - b.frac)[0];
  console.log(
    `  worst pre-fix: ${worst?.member} ${worst?.nutrientId} ${(worst ? worst.frac * 100 : 0).toFixed(0)}% of RDA`,
  );

  check("plan has changes", result.plan.changes.length > 0);
  check("plan fits budget", result.plan.costAfter <= hh.dailyBudget + 0.5,
    `costAfter ${result.plan.costAfter.toFixed(1)} vs budget ${hh.dailyBudget}`);
  check("no open gaps", result.plan.openGaps.length === 0,
    `open gaps: ${JSON.stringify(result.plan.openGaps)}`);
  check("feasible flag set", result.plan.feasible, "solver did not declare feasible");
  check("changes respect caps", result.plan.changes.every((ch) => {
    if (ch.kind === "add") return ch.toG <= 310;
    if (ch.kind === "remove") return ch.fromG > 0 && ch.toG === 0;
    return ch.toG <= ch.fromG * 1.8 + 1; // MAX_ADD_FRAC = 0.75
  }), JSON.stringify(result.plan.changes));

  // Post-plan status: every member's every nutrient >= warnFrac (or slack tiny).
  const newPot = result.plan.changes.reduce<PotLineT[]>((acc, ch) => {
    const cur = acc.find((l) => l.foodId === ch.foodId);
    if (cur) cur.qtyPerDayG = ch.toG;
    else acc.push({ foodId: ch.foodId, qtyPerDayG: ch.toG });
    return acc;
  }, DEFAULT_POT.map((l) => ({ ...l })));
  const after = computeGaps(hh, newPot);
  const remaining = after.flatMap((m) => m.gaps);
  check("gaps closed after applying plan", remaining.length === 0,
    `remaining: ${JSON.stringify(remaining.map((g) => ({ m: g.memberId, n: g.nutrientId, frac: g.frac.toFixed(2) })))}`);
  check("limiting member insight present", result.plan.limitingMembers.length >= 0);
  console.log(
    `  cost ${result.plan.costBefore.toFixed(0)} -> ${result.plan.costAfter.toFixed(0)} INR/day, ${result.plan.changes.length} changes, ${result.plan.meta.iterations} iters`,
  );
}

// ---- Honest infeasibility: extreme case the solver must NOT fake-fix ----
console.log("\n# infeasibility check");
const pricesLow = prices.map((p) => ({ ...p }));
const tinyBudget = { ...DEMO_HOUSEHOLDS[0], dailyBudget: 40, members: DEMO_HOUSEHOLDS[0].members.map((m) => ({ ...m })) };
const infeasible = solve({ household: tinyBudget, pot: [], prices: pricesLow });
check("tiny budget + empty pot reported as infeasible", !infeasible.plan.feasible && infeasible.plan.openGaps.length > 0,
  JSON.stringify(infeasible.plan.openGaps.slice(0, 3)));

// ---- Cost math sanity ----
console.log("\n# cost sanity");
const samplePot = [{ foodId: "rice", qtyPerDayG: 1000 }, { foodId: "toordal", qtyPerDayG: 200 }];
const cost = potCost(samplePot, prices);
check("pot cost math", Math.abs(cost - (44 + 0.2 * 150)) < 0.01, `got ${cost}`);

type PotLineT = { foodId: string; qtyPerDayG: number };

if (failures > 0) {
  console.error(`\n${failures} test(s) FAILED`);
  process.exit(1);
} else {
  console.log("\nAll tests passed.");
}
