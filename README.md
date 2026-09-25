# PlateFix — *the smallest change that fixes the family pot*

PlateFix finds the smallest, cheapest change to a family's shared meals that
closes what each member is missing. A household enters who eats from the shared
pot, what a usual day of cooking looks like, and local prices. PlateFix shows,
per member, which nutrients fall short — then computes a **minimum-change plan**:
a short list of add / increase / reduce changes that closes those gaps within
budget. If foods alone can't close a gap, it says so plainly instead of faking
a fix.

Built for **EurekaDev · Coding Track · "Problem in the Community"**.

---

## Why

- **~2.7 billion people (~1 in 3)** can't afford a healthy diet
  (FAO et al., *The State of Food Security and Nutrition in the World*, SOFI 2026).
- Existing tools **list gaps but don't say what to change**; cost-minimizing
  optimizers produce diets nobody would actually eat.
- **Nobody models the household.** The shared pot is sized for the average
  member — but the member with the highest requirement per calorie (often a
  teenage girl, for iron) sets the floor for the whole pot, and household
  averages hide her.

PlateFix layers a **minimum-change objective** and a **limiting-member insight**
onto proven optimization math (linear programming, solved in the browser).

## What it does

1. **Describe the table** — who eats from the pot and each member's share.
2. **A usual day of cooking** — the pot as it is, in household grams/day, with
   local per-kg prices.
3. **The minimum change** — a red-to-green plan: the fewest, cheapest changes
   that cover everyone within budget, or an honest shortfall report naming the
   limiting member.

The app is browser-only: the solver runs client-side in milliseconds
(no network round-trip per solve).

## How the solver works

Each food gets a pair of non-negative variables — increase `p_f` and decrease
`m_f`, bounded by change caps relative to the current pot (existing foods can
move ±75%; new foods up to 300 g/day). For every member–nutrient pair with a
shortfall there is a soft constraint:

```
Σ_f (a_fn · share_m / RDA_mn) · (p_f − m_f) + shortfall_mn = gap_mn
```

in units of *fraction of that member's RDA*. A large penalty on `shortfall`
makes gap-closing lexicographically dominate cost; the objective otherwise
prefers **small + cheap** changes. The budget row is a hard cap (the plan never
spends below what the family already spends — it can only change foods). A
second LP pass lifts the cap and minimizes pure spend to report the **minimum
budget that would close all closable gaps** — surfaced honestly, never hidden.

Implementation: dense tableau simplex from the all-slack basis (always
primal-feasible, no Phase 1), Dantzig pricing with Bland's-rule fallback.
Problem sizes are tiny (tens of variables, ~80 rows), so this is the right tool.

## Repo layout

```
src/
  lib/platefix/
    engine.ts            # nutrition math + simplex + minimum-change solver
    engine.test.ts       # 18 unit tests (bun test)
    types.ts             # domain types (Household, PotLine, PlanChange, …)
    data/
      foods.ts           # 23 regional foods, IFCT 2017 values + citations
      nutrients.ts       # 8 nutrients × 15 member groups, NIN RDA 2020
      households.ts      # 3 demo households, pot fixture, price snapshot
  pages/
    Landing.tsx          # marketing page → /auth and /dashboard
    Dashboard.tsx        # the product: household → pot → budget → plan
    Auth.tsx             # email-OTP / guest sign-in
  components/platefix.tsx # gap meters, plan rows, pot editor
```

## Running

```bash
bun install
bun run dev        # the app (Vite)
bun run test       # engine unit tests
bun tsc -b --noEmit  # typecheck
```

Sign-in is email OTP or one-click guest (Convex Auth) — the dashboard route is
protected.

## Data hygiene (PRD §9 rule)

No nutrient value, requirement, or price is typed from memory into app logic.
Every value lives in a data file and carries its own citation and
`verified` flag:

| Data | Source | Status |
| --- | --- | --- |
| Food composition (23 foods × 8 nutrients) | ICMR-NIN, *Indian Food Composition Tables (IFCT)*, 2017 — <https://ifct2017.com/> | entered under time pressure; **re-verify before submission** |
| Requirements (8 nutrients × 15 groups) | ICMR-NIN Expert Group, *Nutrient Requirements for Indians (RDA)*, 2020 — <https://www.nin.res.in/RDA2020.jsp> | **re-verify before submission** |
| Prices (₹/kg, Sep 2026 snapshot) | Local retail market snapshot; reference: consumer affairs daily price dashboard — <https://consumeraffairs.nic.in/> | **re-verify with a dated source** |
| ~2.7 bn can't afford a healthy diet | FAO et al., SOFI 2026 | cite the primary report page in the submission |

`verified:false` values are excluded from all statistical claims. Demo
households are illustrative fixtures, not factual claims. The app is **not
medical advice**.

## Scope notes

- 3 demo households (Sharma / Khan / Rao) cover the interesting cases: a
  pregnant mother, a lactating mother, and teenage girls whose iron need per
  calorie is the binding constraint the household average hides.
- The plan rounds changes to 5 g, biased in the gap-closing direction so
  rounding never un-closes a gap.
- If the stated budget can't close every gap, the plan still reports the
  cheapest complete fix (`needsBudget`) and names the limiting member.
