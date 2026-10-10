# PlateFix

**The smallest, cheapest fix for every plate at the table.**

Built solo for **EurekaDev 2026** · Coding Track

---

## The problem

Families with more than one person at the table rarely have one set of nutrition needs. One member might need more iron, another might be managing a sodium limit — on the same shared meal, the same grocery budget.

Most tools solve this by generating a whole new meal plan, or by assuming the household will just cook separately. Neither is realistic for a family that doesn't have the time, money, or motivation to run two kitchens. The tools built for this specific problem — personalized dietitians, premium meal-kit subscriptions, enterprise nutrition platforms — are priced for households that aren't the ones actually feeling the squeeze.

## The idea

A household shares one pot, split by portion — but nutrient needs aren't proportional to portion size. **The average hides someone.** A mother can eat her fair share of the meal and still get 64% of her iron requirement, because sharing by *how much* someone eats isn't the same as sharing by *how much they need*.

PlateFix doesn't rebuild your meal plan. It looks at what the household is already cooking and computes the **minimum-change plan** — the smallest, cheapest set of additions or quantity increases to the existing pot that closes the most nutrient gaps across every member at once, ranked by cost per gap closed.

The underlying technique (multi-person weighted nutrient optimization) isn't new — it has prior art in both patents and academic research. What's new here is making it usable: your real pot in, a ranked, costed, minimum-change plan out, no nutrition background required.

## How it works

1. **Set up the household** — name each member, pick their age/sex group (RDA targets load automatically), and set their share of the shared pot.
2. **Log today's pot** — the foods the household already cooks, in grams per day, plus the daily food budget.
3. **See the gaps** — per-member nutrient shortfalls against RDA, computed from each person's actual share of what's cooked.
4. **Solve** — a linear program (simplex method) finds the minimum set of food additions or quantity increases that closes the most gaps for the least added cost, across every member simultaneously.
5. **Recalculate live** — edit a member, a quantity, or a price, and the whole plan re-solves instantly, with before/after cost shown against the household's actual budget.

## Key features

- Per-member RDA targets by age/sex group, not a generic one-size target
- Minimum-change plan: ranked additions/increases to the existing pot, not a new meal plan
- Live cost comparison — now vs. after vs. budget, projected to weekly/monthly
- "The average hides someone" — surfaces exactly who the shared-pot average is under-feeding, and by how much
- Regional food dataset (~25–30 items) with Hindi names alongside English
- Guest mode with autosave, shareable plan links, and direct WhatsApp sharing
- Preset real-household scenarios to try before entering your own

## Tech stack

- **Optimization engine:** [`javascript-lp-solver`](https://www.npmjs.com/package/javascript-lp-solver) — pure JS linear programming via the simplex method, no WASM dependency (solve times and simplex step counts are shown live in the UI)
- **Food dataset:** ~25–30 regional foods with nutrient and local (₹) cost data, Hindi names included
- **Validation:** tested against 3 representative households (Sharma, Khan, Rao) covering single- and multi-member gap scenarios
- **Frontend:** TypeScript
- **Storage:** browser-only guest mode with autosave; no account required

## Running locally

```bash
git clone <your-repo-url>
cd platefix
npm install
npm run dev
```

> Replace the commands above with whatever your actual `package.json` scripts are — this is a placeholder until you confirm the real setup steps.

## Why this, not an existing app

A fair question, since family nutrition apps already exist. The ones on the market solve a different problem: they split portions of a shared meal, or generate separate meal plans per person's diet. None of them take an existing meal and find the one minimal, cost-ranked swap that resolves competing needs without asking the family to change how they cook. That's the gap PlateFix fills.

## Built for EurekaDev 2026

Solo build, Coding Track submission. Judged on Innovation, Impact, Execution, and Presentation — PlateFix is aimed squarely at Impact: the households priced out of every other solution to this problem.

## License

MIT — see [LICENSE](./LICENSE).
