import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MemberGapCard, PlanChangeRow, PotEditor, nutrientLabel } from "@/components/platefix";
import { DEMO_HOUSEHOLDS, DEFAULT_POT, defaultPrices } from "@/lib/platefix/data/households";
import { IFCT_2017_CITATION } from "@/lib/platefix/data/foods";
import { NIN_RDA_2020_CITATION } from "@/lib/platefix/data/nutrients";
import type { Household } from "@/lib/platefix/types";
import { potCost, solve } from "@/lib/platefix/engine";
import { useAuth } from "@/hooks/use-auth";
import {
  AlertTriangle,
  CookingPot,
  Link2,
  LogOut,
  RotateCcw,
  Sparkles,
  Users,
} from "lucide-react";
import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";

const currencySymbol = (c: string) => (c === "INR" ? "₹" : c);

// Budget presets relative to the current pot cost.
function budgetOptions(cost: number): { label: string; value: number }[] {
  return [
    { label: "−10%", value: Math.round(cost * 0.9) },
    { label: "Current", value: Math.round(cost) },
    { label: "+10%", value: Math.round(cost * 1.1) },
    { label: "+25%", value: Math.round(cost * 1.25) },
  ];
}

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const prices = useMemo(() => defaultPrices(), []);

  const [householdId, setHouseholdId] = useState(DEMO_HOUSEHOLDS[0].id);
  const household: Household =
    DEMO_HOUSEHOLDS.find((h) => h.id === householdId) ?? DEMO_HOUSEHOLDS[0];

  const [pot, setPot] = useState(DEFAULT_POT);
  const [budgetInput, setBudgetInput] = useState<string>(String(household.dailyBudget));

  const costNow = useMemo(() => potCost(pot, prices), [pot, prices]);

  const result = useMemo(() => {
    const budget = Number(budgetInput);
    const hh: Household = {
      ...household,
      dailyBudget: Number.isFinite(budget) && budget > 0 ? budget : household.dailyBudget,
    };
    try {
      return solve({ household: hh, pot, prices });
    } catch (err) {
      console.error("PlateFix solve failed", err);
      return null;
    }
  }, [household, pot, prices, budgetInput]);

  const plan = result?.plan;
  const gapsBefore = result?.gapsBefore ?? [];
  const totalGapsBefore = gapsBefore.reduce((s, m) => s + m.gaps.length, 0);

  const budgetOpts = budgetOptions(costNow);
  const overBudgetNow = costNow > (Number(budgetInput) || household.dailyBudget);

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const resetPot = () => {
    setPot(DEFAULT_POT);
    setBudgetInput(String(household.dailyBudget));
  };

  const memberName = (id: string) => household.members.find((m) => m.id === id)?.name ?? id;
  const limitingFor = (memberId: string) =>
    plan?.limitingMembers.find((l) => l.memberId === memberId)?.nutrientId;

  return (
    <main className="min-h-screen text-foreground">
      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <CookingPot className="size-5 text-primary" />
            <span className="text-lg font-bold tracking-tight">PlateFix</span>
            <Badge variant="outline" className="ml-1 hidden text-[10px] sm:inline-flex">
              beta
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            {user?.name || user?.email ? (
              <span className="hidden max-w-[180px] truncate text-sm text-muted-foreground sm:block">
                {user.name ?? user.email}
              </span>
            ) : null}
            <Button type="button" variant="ghost" size="sm" className="gap-2" onClick={handleSignOut}>
              <LogOut className="size-4" />
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        {/* Heading */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            The smallest change that fixes the family pot
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            Pick a household, check the pot matches a usual day of cooking, set the daily budget —
            PlateFix finds the minimum change that covers everyone at the table.
          </p>
        </div>

        {/* Step 1 — household */}
        <Card className="mb-6 border-border/70 shadow-none">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                1
              </span>
              <CardTitle className="text-base">Who eats from the pot</CardTitle>
            </div>
            <CardDescription>
              The pot is sized for the average member — the highest-need one hides inside it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-3">
              {DEMO_HOUSEHOLDS.map((h) => {
                const active = h.id === householdId;
                return (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => {
                      setHouseholdId(h.id);
                      setBudgetInput(String(h.dailyBudget));
                    }}
                    className={`rounded-xl border p-4 text-left transition-colors ${
                      active
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "border-border/70 bg-card hover:border-primary/40"
                    }`}
                    aria-pressed={active}
                  >
                    <div className="flex items-center gap-2">
                      <Users className="size-4 text-primary" />
                      <span className="text-sm font-semibold">{h.name}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {h.members.length} members · budget {currencySymbol(h.currency)}
                      {h.dailyBudget}/day
                    </p>
                    <ul className="mt-2 space-y-0.5">
                      {h.members.map((m) => (
                        <li key={m.id} className="text-xs text-muted-foreground">
                          {m.name} · {Math.round(m.potShare * 100)}% of pot
                        </li>
                      ))}
                    </ul>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Step 2 — pot + Step 3 — budget */}
        <div className="mb-6 grid gap-6 lg:grid-cols-5">
          <Card className="border-border/70 shadow-none lg:col-span-3">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                    2
                  </span>
                  <CardTitle className="text-base">A usual day of cooking</CardTitle>
                </div>
                <Button variant="ghost" size="sm" className="gap-1.5" onClick={resetPot}>
                  <RotateCcw className="size-3.5" />
                  Reset
                </Button>
              </div>
              <CardDescription>
                Household grams per day. Adjust what the family actually cooks.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PotEditor pot={pot} onChange={setPot} currency={household.currency} />
            </CardContent>
          </Card>

          <Card className="border-border/70 shadow-none lg:col-span-2">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <span className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                  3
                </span>
                <CardTitle className="text-base">Daily food budget</CardTitle>
              </div>
              <CardDescription>
                The pot costs {currencySymbol(household.currency)}
                {costNow.toFixed(0)}/day at snapshot prices.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  {currencySymbol(household.currency)}
                </span>
                <Input
                  type="number"
                  min={0}
                  value={budgetInput}
                  onChange={(e) => setBudgetInput(e.target.value)}
                  className="pl-8 text-right text-base font-semibold tabular-nums"
                  aria-label="Daily food budget for the whole household"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {budgetOpts.map((opt) => {
                  const active = Number(budgetInput) === opt.value;
                  return (
                    <Button
                      key={opt.label}
                      type="button"
                      variant={active ? "default" : "outline"}
                      size="sm"
                      className="h-7 px-2.5 text-xs"
                      onClick={() => setBudgetInput(String(opt.value))}
                    >
                      {opt.label} · {currencySymbol(household.currency)}
                      {opt.value}
                    </Button>
                  );
                })}
              </div>
              {overBudgetNow && (
                <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  The current pot already exceeds this budget. PlateFix keeps the family fed and
                  reports spend honestly.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Results */}
        <div className="grid gap-6 lg:grid-cols-5">
          {/* Gaps before */}
          <section className="lg:col-span-2">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                The gaps today
              </h2>
              {result && (
                <Badge
                  variant={totalGapsBefore > 0 ? "destructive" : "default"}
                  className={`text-[10px] ${totalGapsBefore === 0 ? "bg-emerald-600 text-white" : ""}`}
                >
                  {totalGapsBefore > 0
                    ? `${totalGapsBefore} nutrient gaps`
                    : "everyone covered"}
                </Badge>
              )}
            </div>
            {gapsBefore.length === 0 ? (
              <Card className="border-border/70 shadow-none">
                <CardContent className="p-4 text-sm text-muted-foreground">
                  Add household members and pot items to see gaps.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {gapsBefore.map((m) => (
                  <MemberGapCard key={m.memberId} view={m} />
                ))}
              </div>
            )}
          </section>

          {/* The plan */}
          <section className="lg:col-span-3">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <Sparkles className="size-4 text-primary" />
                The minimum change
              </h2>
              {plan && (
                <span className="text-xs text-muted-foreground">
                  solved in {plan.meta.solveMs} ms · {plan.meta.iterations} simplex steps
                </span>
              )}
            </div>

            {!plan ? (
              <Card className="border-border/70 shadow-none">
                <CardContent className="flex items-center gap-2 p-4 text-sm text-destructive">
                  <AlertTriangle className="size-4" />
                  Solver error — check the pot quantities and try again.
                </CardContent>
              </Card>
            ) : plan.changes.length === 0 ? (
              <Card className="border-emerald-600/40 bg-emerald-600/5 shadow-none">
                <CardContent className="p-4 text-sm">
                  <p className="font-semibold text-emerald-700 dark:text-emerald-400">
                    This pot already covers everyone.
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    No changes needed — every tracked nutrient meets its threshold for every
                    member.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                <div className="space-y-2">
                  {plan.changes.map((c, i) => (
                    <motion.div
                      key={`${c.foodId}-${c.kind}`}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.07, duration: 0.3 }}
                    >
                      <PlanChangeRow change={c} currency={household.currency} />
                    </motion.div>
                  ))}
                </div>

                {/* Cost summary */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-xl border border-border/70 bg-card p-3 text-center">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Now</p>
                    <p className="text-sm font-bold tabular-nums">
                      {currencySymbol(household.currency)}
                      {plan.costBefore.toFixed(0)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-primary/40 bg-primary/5 p-3 text-center">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">After</p>
                    <p className="text-sm font-bold tabular-nums text-primary">
                      {currencySymbol(household.currency)}
                      {plan.costAfter.toFixed(0)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-card p-3 text-center">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Budget</p>
                    <p className="text-sm font-bold tabular-nums">
                      {currencySymbol(household.currency)}
                      {plan.budget.toFixed(0)}
                    </p>
                  </div>
                </div>

                {/* Status banner */}
                {plan.feasible ? (
                  <div className="rounded-xl border border-emerald-600/40 bg-emerald-600/10 p-4">
                    <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
                      Every gap closes.
                    </p>
                    <p className="mt-0.5 text-xs text-emerald-800/80 dark:text-emerald-300/80">
                      {plan.costAfter >= plan.costBefore
                        ? `For about ${currencySymbol(household.currency)}${(plan.costAfter - plan.costBefore).toFixed(0)} more per day, the whole family is covered.`
                        : `And it saves about ${currencySymbol(household.currency)}${(plan.costBefore - plan.costAfter).toFixed(0)} per day.`}
                    </p>
                  </div>
                ) : (
                  <div className="rounded-xl border border-amber-600/40 bg-amber-600/10 p-4">
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-800 dark:text-amber-300">
                      <AlertTriangle className="size-4" />
                      Food alone can&apos;t close everything — and we won&apos;t fake it.
                    </p>
                    <ul className="mt-2 space-y-1.5">
                      {plan.openGaps.map((g) => (
                        <li key={`${g.memberId}-${g.nutrientId}`} className="text-xs text-amber-900/90 dark:text-amber-200/90">
                          <span className="font-semibold">{memberName(g.memberId)}</span> is still{" "}
                          <span className="font-semibold tabular-nums">
                            {Math.round(g.shortfallFrac * 100)}%
                          </span>{" "}
                          short of the {nutrientLabel(g.nutrientId)} requirement.
                          {limitingFor(g.memberId) === g.nutrientId && (
                            <> Their need per calorie is the highest at the table — household averages hide them.</>
                          )}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-xs text-amber-900/80 dark:text-amber-200/80">
                      {plan.needsBudget !== undefined
                        ? `A budget of about ${currencySymbol(household.currency)}${Math.ceil(plan.needsBudget)}/day would close every gap that food can close.`
                        : "Even with more money, food alone can't close these gaps at reasonable change limits — fortified staples or supplements may be needed."}
                      Options beyond the pot: fortified staples, supplements, or a higher budget.
                    </p>
                  </div>
                )}

                {plan.costAfter > plan.budget + 0.01 && (
                  <p className="text-xs text-muted-foreground">
                    Note: the cheapest complete fix costs{" "}
                    {currencySymbol(household.currency)}
                    {(plan.costAfter - plan.budget).toFixed(0)} above the stated budget.
                  </p>
                )}
              </div>
            )}
          </section>
        </div>

        {/* Data provenance */}
        <Card className="mt-8 border-border/70 shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Link2 className="size-3.5 text-primary" />
              Where the numbers come from
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs leading-5 text-muted-foreground">
            <p>
              Nutrient values: {IFCT_2017_CITATION}. Requirements: {NIN_RDA_2020_CITATION}.
              Prices: dated local-market snapshot, entered for the demo and marked unverified
              until checked against a primary source. Demo households are illustrative fixtures,
              not factual claims. Values with <code className="text-[11px]">verified:false</code>{" "}
              are excluded from all statistical claims.
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
