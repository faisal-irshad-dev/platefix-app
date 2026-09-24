// Debug probe for the PlateFix simplex + LP construction. Run: bun scripts/debug-simplex.ts
import { simplex } from "../src/lib/platefix/engine";

function report(name: string, r: ReturnType<typeof simplex>, expect: number[], expectObj: number) {
  const got = r.x.slice(0, expect.length).map((v) => Number(v.toFixed(4)));
  const ok =
    r.status === "optimal" &&
    Math.abs(r.objective - expectObj) < 1e-6 &&
    expect.every((e, i) => Math.abs(e - got[i]) < 1e-3);
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}: status=${r.status} obj=${r.objective.toFixed(4)} (want ${expectObj}) x=[${got}] iters=${r.iterations}`,
  );
}

// --- Test 1: trivial 1-var min ---
// min 2x, x <= 3 (bound row), slack cost 0 → x = 0, obj 0.
{
  const r = simplex(1, [[1]], [3], [2, 0]);
  report("T1 min 2x with upper bound", r, [0], 0);
}

// --- Test 2: gap-style equality with penalty slack ---
// min x s.t. 0.5x + s = 1, x <= 10, s cost 1e6 → x = 2, obj 2.
{
  const r = simplex(1, [[0.5], [1]], [1, 10], [1, 1e6, 0]);
  report("T2 gap row closes via x", r, [2], 2);
}

// --- Test 3: two vars, pick the denser one ---
// min 1.1a + 1.2b s.t. 0.1a + 0.2b + s = 0.5, bounds a,b <= 10, budget 0.01a + 0.02b + e = 100 (e cost 0).
// Optimal: b = 2.5, obj 3.
{
  const A = [
    [0.1, 0.2],
    [1, 0],
    [0, 1],
    [0.01, 0.02],
  ];
  const b = [0.5, 10, 10, 100];
  const c = [1.1, 1.2, 1e6, 0, 0, 0];
  const r = simplex(2, A, b, c);
  report("T3 chooses densest var", r, [0, 2.5], 3);
}

// --- Test 4: down-var must never be attractive on its own ---
// Pot has 100g of rice-ish food; reducing it (down var) hurts the gap row.
// min ... gap: 0.001*up - 0.001*down + s = 0.5 ; bounds 75/75 ; budget: 0.044*(up-down) + e = 50.
// Optimal: up=500? bound 75 → up=75 closes 0.075, s=0.425; down must be 0. obj=75*1.044 + 0.425e6.
{
  const A = [
    [0.001, -0.001],
    [1, 0],
    [0, 1],
    [0.044, -0.044],
  ];
  const b = [0.5, 75, 75, 50];
  const c = [1.044, 1.044, 1e6, 0, 0, 0];
  const r = simplex(2, A, b, c);
  report("T4 down var stays 0", r, [75, 0], 75 * 1.044 + 0.425e6);
}

// --- Test 5: budget must be spent when slack penalty dominates ---
// min 1.1a + 1.2b, gap: 0.1a + 0.2b + s = 0.5, bounds 10/10 (can't close: max 0.1*10+0.2*10=3? closes fully at a+b=... 0.1a+0.2b=0.5 closable), budget: 0.5a + 0.9b + e = 3.
// Cheapest close: use b (0.2/gap per g): b=2.5 costs 2.25 ≤ 3 → feasible, e=0.75, obj 3.
{
  const A = [
    [0.1, 0.2],
    [1, 0],
    [0, 1],
    [0.5, 0.9],
  ];
  const b = [0.5, 10, 10, 3];
  const c = [1.1, 1.2, 1e6, 0, 0, 0];
  const r = simplex(2, A, b, c);
  report("T5 cheapest closure within budget", r, [0, 2.5], 3);
}

// --- Test 6: genuinely infeasible → partial closure, spend everything useful ---
// Same as T5 but bounds 1/1: max closure 0.1+0.2=0.3 < 0.5 → s=0.2. Uses both at bounds.
// Best: a=1, b=1 (closure 0.3), s=0.2, obj = 1.1+1.2+0.2e6 = 200002.3
{
  const A = [
    [0.1, 0.2],
    [1, 0],
    [0, 1],
    [0.5, 0.9],
  ];
  const b = [0.5, 1, 1, 3];
  const c = [1.1, 1.2, 1e6, 0, 0, 0];
  const r = simplex(2, A, b, c);
  report("T6 infeasible partial closure", r, [1, 1], 1.1 + 1.2 + 0.2e6);
}
