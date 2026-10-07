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

## Positioning

**Who it's for:** budget-constrained households — regional, cost-sensitive
families who can't afford a dietitian, a premium nutrition subscription, or the
time and money to cook separate meals for different needs. Today they either
overspend on specialized apps and meal kits, or just eat what they eat and
absorb the health cost. Nothing meets them where their actual grocery budget
and actual meal already are.

**The core insight:** the optimization math isn't the innovation — nobody
disputes that multi-person nutrient optimization is a known operations-research
problem. The innovation is collapsing it into something a family with zero
nutrition background can use in 30 seconds: not a new meal plan, not a new app
habit — **the one swap, ranked by cost-per-nutrient-gap-closed, starting from
the meal they already cook.**

**How that differs from prior work:**

| Prior work | What it is | What PlateFix does differently |
| --- | --- | --- |
| The 2011 patent on computer-implemented meal selection | A general dish-selection engine choosing from a broad catalog | A minimal swap to the family's *existing* pot with an explicit cost lens — never a catalog to browse |
| Academic multi-objective diet optimization papers | Published but unproductized research | Shipped, browser-only, swap-based, budget-first — usable by someone who has never heard of linear programming |
| FamilyPlate.ai and similar meal planners | Generates a whole new meal plan for dietary compatibility | A single minimal change to what is already on the table, for nutrient-gap closure |

The messaging leads with cost, not math — the app's own words are
"no new recipes, no new shopping list — just swap X for Y, a few paise more,
closes most of the gap."

## Prepared answer: "Isn't this just the 2011 patent / the academic research?"

> The underlying optimization isn't new — multi-person nutrient balancing has
> existed in research for over a decade. What doesn't exist is a shipped product
> that applies it as a single, minimal, affordable swap to a family's existing
> meal instead of asking them to adopt a whole new meal plan. That's the gap:
> **not the math, the accessibility.**

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

The app runs in **guest mode** — no sign-in required. Data is stored in
localStorage per browser. Shareable household links encode the full household
in the URL hash.

---

## Deployment to Vercel (one-click)

This project is configured for **pure one-click deployment to Vercel**.
No backend, no database, no environment variables required — just deploy
and it works.

### How it works

- The app is a static React + Vite SPA — no server needed.
- **Auth:** guest mode only, no sign-in. Data lives in the browser's
  localStorage. Shareable links encode households in the URL hash.
- **Data persistence:** localStorage (per browser). Clearing browser data
  resets the household.
- **The solver runs entirely in the browser** — no backend, no API calls.

### Deploy to Vercel

1. Push this repo to GitHub.
2. In the Vercel dashboard, click **Add New → Project** and select your repo.
3. Vercel auto-detects the Vite framework from `vercel.json`.
4. Click **Deploy** — no environment variables needed.

That's it. No backend setup, no database, no API keys.

### Required environment variables

**None.** The app works out of the box.

| Variable | Required? | Notes |
| --- | --- | --- |
| `VITE_VLY_APP_ID` | optional | Only needed for Vly toolbar features |
| `VITE_VLY_MONITORING_URL` | optional | Only needed for Vly error monitoring |

### How the code adapts to Vercel

- `vite.config.ts` guards the `@vly-ai/integrations` plugin so a direct
  Vercel deploy (which has no Vly tooling) builds cleanly.
- `src/main.tsx` guards `VITE_VLY_*` env vars; on Vercel those are absent
  and the toolbar/monitoring become no-ops.
- `vly-toolbar-readonly.tsx` checks `window.location.hostname` and only
  activates on the Freebuff preview host.
- `src/instrumentation.tsx` only fires when `VITE_VLY_APP_ID` and
  `VITE_VLY_MONITORING_URL` are both set.
- The app is a standard client-side React Router SPA. `vercel.json` rewrites
  all paths to `/` so refreshes and direct links to `/dashboard` never 404.
- No Convex dependency — the app uses localStorage for persistence.

### Local testing of the Vercel build

```bash
bun run build:vercel   # produces dist/ identical to what Vercel builds
bunx serve dist        # preview the static output locally on :3000
```

### Troubleshooting

- **Blank page after deploy:** check the browser console for errors.
- **404 on refresh:** verify `vercel.json` rewrites are present (they are
  committed in this repo).
- **Data not persisting:** localStorage is per-browser — open the same
  browser to keep your household.

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

- Every household is real and user-built: add any number of members (15
  age/sex groups), set each one's share of the pot, edit the pot, the daily
  budget and per-kg market prices. Requirements update automatically from each
  member's group.
- Everything is saved per-account (Convex) and recalculates live on every
  edit — the plan, gaps and costs update as you type.
- The plan rounds changes to 5 g, biased in the gap-closing direction so
  rounding never un-closes a gap.
- If the stated budget can't close every gap, the plan still reports the
  cheapest complete fix (`needsBudget`) and names the limiting member.
- Sign-in is email OTP or one-click guest; data is private to the account.
