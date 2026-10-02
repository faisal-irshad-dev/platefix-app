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
import {
  CopyPlanButton,
  HiddenMemberCard,
  MemberGapCard,
  MembersEditor,
  MEMBER_GROUP_OPTIONS,
  NoGapSpendStrip,
  PlanChangeRow,
  PotEditor,
  PricesDialog,
  ProofReceiptDialog,
  StiglerCompareCard,
  buildHousehold,
  nutrientLabel,
} from "@/components/platefix";
import { DEFAULT_POT, DEMO_HOUSEHOLDS, defaultPrices } from "@/lib/platefix/data/households";
import { FOODS, IFCT_2017_CITATION, foodById } from "@/lib/platefix/data/foods";
import { NIN_RDA_2020_CITATION } from "@/lib/platefix/data/nutrients";
import type {
  Household,
  HouseholdMemberProfile,
  MemberGroup,
  PotLine,
  PriceEntry,
} from "@/lib/platefix/types";
import {
  applyPlan,
  hiddenMemberInsight,
  potCost,
  solve,
  solveStigler,
  spendTouchingNoGaps,
} from "@/lib/platefix/engine";
import { oneSwap, proofReceipt, shockPrices } from "@/lib/platefix/proof";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { LoadingScreen } from "@/components/LoadingScreen";
import {
  AlertTriangle,
  Link2,
  LogOut,
  Save,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery } from "convex/react";
import logo from "@/assets/logo.svg";

const currencySymbol = (c: string) => (c === "INR" ? "₹" : c === "USD" ? "$" : c === "EUR" ? "€" : c);

const CURRENCIES = ["INR", "USD", "EUR", "GBP", "NGN", "KES", "BDT", "PHP", "IDR", "BRL"];

const LOCAL_STORAGE_KEY = "platefix-household-v1";

// ---- Shareable household link (#h= base64url of a slim state) -------------

function encodeSharedHousehold(s: BuilderState): string {
  const slim = {
    v: 1,
    name: s.name,
    currency: s.currency,
    dailyBudget: s.dailyBudget,
    members: s.members.map((m) => ({ name: m.name, group: m.group, potShare: m.potShare })),
    pot: s.pot,
    prices: s.prices.map((p) => ({ foodId: p.foodId, pricePerKg: p.pricePerKg })),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(slim));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeSharedHousehold(hash: string): BuilderState | null {
  try {
    const b64 = hash.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    const data = JSON.parse(new TextDecoder().decode(bytes)) as {
      name?: string;
      currency?: string;
      dailyBudget?: number;
      members?: { name?: string; group?: string; potShare?: number }[];
      pot?: { foodId: string; qtyPerDayG: number }[];
      prices?: { foodId: string; pricePerKg: number }[];
    } | null;
    if (!data || !Array.isArray(data.members) || data.members.length === 0) return null;
    const validGroups = new Set(MEMBER_GROUP_OPTIONS.map((g) => g.group));
    const members: HouseholdMemberProfile[] = data.members
      .filter((m) => !!m && validGroups.has(m.group as MemberGroup))
      .map((m, i) => ({
        id: `m-${i + 1}`,
        name: (m.name || `Member ${i + 1}`).slice(0, 40),
        group: m.group as MemberGroup,
        potShare:
          typeof m.potShare === "number" && m.potShare > 0 && m.potShare <= 1
            ? m.potShare
            : 1 / data.members!.length,
        requirements: [],
      }));
    if (members.length === 0) return null;
    const knownFood = new Set(FOODS.map((f) => f.id));
    return {
      name: typeof data.name === "string" && data.name ? data.name.slice(0, 60) : "Shared household",
      currency: typeof data.currency === "string" && data.currency ? data.currency : "INR",
      dailyBudget:
        typeof data.dailyBudget === "number" && data.dailyBudget >= 0 ? data.dailyBudget : 320,
      members,
      pot: Array.isArray(data.pot)
        ? data.pot.filter(
            (l) =>
              !!l && knownFood.has(l.foodId) && typeof l.qtyPerDayG === "number" && l.qtyPerDayG > 0,
          )
        : DEFAULT_POT.map((l) => ({ ...l })),
      prices:
        Array.isArray(data.prices) && data.prices.length > 0
          ? data.prices
              .filter(
                (p) =>
                  !!p && knownFood.has(p.foodId) && typeof p.pricePerKg === "number" && p.pricePerKg >= 0,
              )
              .map((p) => ({ foodId: p.foodId, pricePerKg: p.pricePerKg, source: "shared link", verified: false }))
          : defaultPrices(),
    };
  } catch {
    return null;
  }
}

interface BuilderState {
  name: string;
  currency: string;
  dailyBudget: number;
  members: HouseholdMemberProfile[];
  pot: PotLine[];
  prices: PriceEntry[];
}

// A sensible starting point for a first-time user (edit everything live).
function startingState(): BuilderState {
  return {
    name: "My household",
    currency: "INR",
    dailyBudget: 320,
    members: [
      { id: "m-1", name: "Father", group: "man", potShare: 0.34, requirements: [] },
      { id: "m-2", name: "Mother", group: "woman", potShare: 0.3, requirements: [] },
      { id: "m-3", name: "Daughter (14)", group: "girl13-15", potShare: 0.36, requirements: [] },
    ],
    pot: DEFAULT_POT.map((l) => ({ ...l })),
    prices: defaultPrices(),
  } as BuilderState;
}

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  // Saved state from Convex (reactive). Null until loaded.
  const saved = useQuery(api.households.getMy);
  const saveHousehold = useMutation(api.households.save);

  const [state, setState] = useState<BuilderState | null>(null);
  const hydratedRef = useRef(false);

  // Hydrate once: saved doc if present, else the starting household.
  useEffect(() => {
    if (saved === undefined || hydratedRef.current) return;
    hydratedRef.current = true;
    // A shared link loads the sender's household without any sign-in step.
    if (window.location.hash.startsWith("#h=")) {
      const shared = decodeSharedHousehold(window.location.hash.slice(3));
      if (shared) {
        setState(shared);
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
        return;
      }
    }
    if (saved) {
      setState({
        name: saved.data.name,
        currency: saved.data.currency,
        dailyBudget: saved.data.dailyBudget,
        members: saved.data.members as HouseholdMemberProfile[],
        pot: saved.data.pot,
        prices: saved.data.prices as PriceEntry[],
      });
    } else {
      // Try the local draft first (covers anonymous/guest sessions), else default.
      try {
        const draft = localStorage.getItem(LOCAL_STORAGE_KEY);
        setState(draft ? (JSON.parse(draft) as BuilderState) : startingState());
      } catch {
        setState(startingState());
      }
    }
  }, [saved]);

  const [saveError, setSaveError] = useState(false);
  const lastSavedRef = useRef<string>("");

  // Persist every change (debounced 600ms). Local draft always mirrors state.
  useEffect(() => {
    if (!state) return;
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(state));
    const t = setTimeout(() => {
      const payload = JSON.stringify({
        name: state.name,
        currency: state.currency,
        dailyBudget: state.dailyBudget,
        members: state.members.map(({ id, name, group, potShare }) => ({ id, name, group, potShare })),
        pot: state.pot,
        prices: state.prices.map(({ foodId, pricePerKg }) => ({ foodId, pricePerKg })),
      });
      if (payload === lastSavedRef.current) return;
      lastSavedRef.current = payload;
      saveHousehold({ data: JSON.parse(payload) })
        .then(() => setSaveError(false))
        .catch(() => setSaveError(true));
    }, 600);
    return () => clearTimeout(t);
  }, [state, saveHousehold]);

  const patch = (p: Partial<BuilderState>) => setState((s) => (s ? { ...s, ...p } : s));

  // ---- LIVE computation: every edit re-solves instantly ----
  const household = useMemo(() => {
    if (!state) return null;
    return buildHousehold(
      state.name || "My household",
      state.currency || "INR",
      state.dailyBudget,
      state.members,
    );
  }, [state]);

  const result = useMemo(() => {
    if (!household || !state) return null;
    if (household.members.length === 0 || state.pot.length === 0) return { empty: true as const };
    try {
      return { empty: false as const, ...solve({ household, pot: state.pot, prices: state.prices }) };
    } catch (err) {
      console.error("PlateFix solve failed", err);
      return null;
    }
  }, [household, state]);

  // The Stigler comparison needs members + prices only (no pot), so it
  // re-solves live from the same state whenever the household or prices change.
  // Cheap: the same tiny LP machinery as the main solve.
  const stigler = useMemo(() => {
    if (!household) return null;
    if (household.members.length === 0) return null;
    try {
      return solveStigler({ household, prices: state?.prices ?? [] });
    } catch (err) {
      console.error("Stigler solve failed", err);
      return null;
    }
  }, [household, state]);

  // Today / After-the-plan toggle for the gaps column.
  const [view, setView] = useState<"today" | "after">("today");

  // The plan applied to the pot, with gaps recomputed from data — the "After"
  // view shows these, so the payoff is verified, not claimed.
  const applied = useMemo(() => {
    if (!household || !state || !result || result.empty) return null;
    try {
      return applyPlan(household, state.pot, result.plan);
    } catch (err) {
      console.error("applyPlan failed", err);
      return null;
    }
  }, [household, state, result]);

  // The member the household average hides (highest need-per-calorie ratio).
  const hiddenInsight = useMemo(() => {
    if (!household || !state || household.members.length === 0) return null;
    return hiddenMemberInsight(household, state.pot);
  }, [household, state]);

  // Share of today's spend that touches no open gap.
  const spendInfo = useMemo(() => {
    if (
      !household ||
      !state ||
      household.members.length === 0 ||
      state.pot.length === 0
    )
      return null;
    return spendTouchingNoGaps(household, state.pot, state.prices);
  }, [household, state]);

  // Proof receipt: per-change arithmetic recomputed from the same data files
  // the solver reads — shown in the "Show the math" dialog.
  const receipt = useMemo(() => {
    if (!household || !state || !result || result.empty) return null;
    if (result.plan.changes.length === 0) return null;
    try {
      return proofReceipt(household, state.pot, state.prices, result.plan);
    } catch (err) {
      console.error("proofReceipt failed", err);
      return null;
    }
  }, [household, state, result]);

  // The ONE swap: each plan change applied alone, ranked by cost per gap
  // closed — the 30-second answer for a family cooking the same meal tonight.
  const swaps = useMemo(() => {
    if (!household || !state || !result || result.empty) return [];
    if (result.plan.changes.length === 0) return [];
    try {
      return oneSwap(household, state.pot, state.prices, result.plan);
    } catch (err) {
      console.error("oneSwap failed", err);
      return [];
    }
  }, [household, state, result]);

  // Market shock: "what if prices move tomorrow?" — the full plan re-solved
  // at shocked prices, live. Never a claim, always a computation.
  const [shockPct, setShockPct] = useState(0);
  const shock = useMemo(() => {
    if (!household || !state || shockPct === 0) return null;
    if (household.members.length === 0 || state.pot.length === 0) return null;
    try {
      return shockPrices(household, state.pot, state.prices, 1 + shockPct / 100);
    } catch (err) {
      console.error("shockPrices failed", err);
      return null;
    }
  }, [household, state, shockPct]);

  // Shareable link: the whole household (members, pot, budget, prices) in the URL.
  const [linkCopied, setLinkCopied] = useState(false);
  const shareLink = () => {
    if (!state) return;
    const url = `${window.location.origin}${window.location.pathname}#h=${encodeSharedHousehold(state)}`;
    try {
      void navigator.clipboard?.writeText(url);
    } catch {
      // Clipboard blocked — nothing else to do; the URL is still in the bar.
    }
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  // Quick-start scenarios: load a demo household into the live editor.
  const loadScenario = (hh: Household) => {
    setState({
      name: hh.name,
      currency: hh.currency,
      dailyBudget: hh.dailyBudget,
      members: hh.members.map(({ id, name, group, potShare }) => ({
        id,
        name,
        group,
        potShare,
        requirements: [],
      })),
      pot: DEFAULT_POT.map((l) => ({ ...l })),
      prices: defaultPrices(),
    });
    setView("today");
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  if (!state || !household) {
    return <LoadingScreen label="setting the table…" />;
  }

  const symbol = currencySymbol(household.currency);
  const plan = result && !result.empty ? result.plan : undefined;
  const gapsBefore = result && !result.empty ? result.gapsBefore : [];
  const gapsShown = view === "after" && applied ? applied.gapsAfter : gapsBefore;
  const totalGapsShown = gapsShown.reduce((s, m) => s + m.gaps.length, 0);
  const costNow = potCost(state.pot, state.prices);

  const memberName = (id: string) =>
    state.members.find((m) => m.id === id)?.name || id;
  const limitingFor = (memberId: string) =>
    plan?.limitingMembers.find((l) => l.memberId === memberId)?.nutrientId;

  return (
    <main className="min-h-screen text-foreground">
      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="flex cursor-pointer items-center gap-2"
            aria-label="PlateFix home"
          >
            <img src={logo} alt="PlateFix logo" className="size-7 text-primary" />
            <span className="text-lg font-bold tracking-tight">PlateFix</span>
          </button>
          <div className="flex items-center gap-2">
            <span className="hidden max-w-[180px] truncate text-sm text-muted-foreground sm:block">
              {user?.name ?? user?.email ?? ""}
            </span>
            <Button type="button" variant="ghost" size="sm" className="gap-2" onClick={handleSignOut}>
              <LogOut className="size-4" />
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        {/* Heading */}
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              The smallest, cheapest fix for every plate at the table
            </h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              No new recipes, no new shopping list — the smallest, cheapest change to the pot
              you already cook, recalculated live as you edit members, pot, budget and prices,
              and saved automatically.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {saveError ? (
              <span className="flex items-center gap-1 text-amber-700 dark:text-amber-400">
                <AlertTriangle className="size-3.5" /> offline — saved locally
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <Save className="size-3.5" /> auto-saved
              </span>
            )}
          </div>
        </div>

        {/* Quick-start scenarios — the 30-second demo path */}
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            Try a real scenario:
          </span>
          {DEMO_HOUSEHOLDS.map((hh) => (
            <Button
              key={hh.id}
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => loadScenario(hh)}
            >
              <Users className="size-3.5" />
              {hh.name}
              <span className="text-xs font-normal text-muted-foreground">
                · {hh.members.length} at the table
              </span>
            </Button>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-muted-foreground"
            onClick={shareLink}
          >
            <Link2 className="size-3.5" />
            {linkCopied ? "Link copied" : "Copy share link"}
          </Button>
        </div>

        {/* Step 1 — household identity + members */}
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
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Household name
                </label>
                <Input
                  value={state.name}
                  onChange={(e) => patch({ name: e.target.value })}
                  placeholder="e.g. Sharma family"
                  aria-label="Household name"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Currency
                </label>
                <select
                  value={state.currency}
                  onChange={(e) => patch({ currency: e.target.value })}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  aria-label="Currency"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <MembersEditor
              members={state.members}
              onChange={(members) => patch({ members })}
            />
          </CardContent>
        </Card>

        {/* Step 2 — pot + Step 3 — budget + prices */}
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
              </div>
              <CardDescription>
                The whole household&apos;s grams per day. Add or remove any food.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PotEditor
                pot={state.pot}
                onChange={(pot) => patch({ pot })}
                currency={household.currency}
              />
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
                The pot costs {symbol}
                {costNow.toFixed(0)}/day at your prices.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  {symbol}
                </span>
                <Input
                  type="number"
                  min={0}
                  value={state.dailyBudget}
                  onChange={(e) => patch({ dailyBudget: Number(e.target.value) })}
                  className="pl-8 text-right text-base font-semibold tabular-nums"
                  aria-label="Daily food budget for the whole household"
                />
              </div>
              {costNow > household.dailyBudget && (
                <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  The current pot exceeds this budget. PlateFix keeps the family fed and reports
                  spend honestly.
                </p>
              )}
              <div className="pt-1">
                <PricesDialog
                  prices={state.prices}
                  onChange={(prices) => patch({ prices })}
                  currency={household.currency}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Results */}
        <div className="grid gap-6 lg:grid-cols-5">
          {/* Gaps — today vs after the plan */}
          <section className="lg:col-span-2">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold">
                {view === "after" ? "After the plan" : "The gaps today"}
              </h2>
              <div className="flex items-center gap-2">
                {plan && plan.changes.length > 0 && applied && (
                  <div
                    className="flex rounded-lg border border-border/70 p-0.5"
                    role="group"
                    aria-label="Show gaps today or after the plan"
                  >
                    {(["today", "after"] as const).map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setView(v)}
                        aria-pressed={view === v}
                        className={`cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                          view === v
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {v === "today" ? "Today" : "After the plan"}
                      </button>
                    ))}
                  </div>
                )}
                {household.members.length > 0 && (
                  <Badge
                    variant={totalGapsShown > 0 ? "destructive" : "default"}
                    className={`text-[10px] ${totalGapsShown === 0 ? "bg-emerald-600 text-white" : ""}`}
                  >
                    {totalGapsShown > 0 ? `${totalGapsShown} nutrient gaps` : "everyone covered"}
                  </Badge>
                )}
              </div>
            </div>
            {household.members.length === 0 ? (
              <Card className="border-border/70 shadow-none">
                <CardContent className="p-4 text-sm text-muted-foreground">
                  Add family members above to see who is missing what.
                </CardContent>
              </Card>
            ) : state.pot.length === 0 ? (
              <Card className="border-border/70 shadow-none">
                <CardContent className="p-4 text-sm text-muted-foreground">
                  Add the foods your family cooks in a usual day to see the gaps.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {gapsShown.map((m) => (
                  <MemberGapCard key={m.memberId} view={m} />
                ))}
                {view === "after" && applied && applied.membersStillShort.length > 0 && (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    {applied.membersStillShort.map((m) => m.name).join(", ")}{" "}
                    {applied.membersStillShort.length === 1 ? "is" : "are"} still short — food
                    alone can&apos;t close every gap at these change limits. The honest report is
                    on the right.
                  </p>
                )}
                {view === "today" && hiddenInsight && (
                  <HiddenMemberCard insight={hiddenInsight}
                  />
                )}
                {view === "today" && spendInfo && (
                  <NoGapSpendStrip info={spendInfo} currency={household.currency} />
                )}
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

            {!result ? (
              <Card className="border-border/70 shadow-none">
                <CardContent className="flex items-center gap-2 p-4 text-sm text-destructive">
                  <AlertTriangle className="size-4" />
                  Solver error — check the pot quantities and try again.
                </CardContent>
              </Card>
            ) : result.empty ? (
              <Card className="border-border/70 shadow-none">
                <CardContent className="p-4 text-sm text-muted-foreground">
                  Add members and pot items to compute the plan.
                </CardContent>
              </Card>
            ) : plan!.changes.length === 0 ? (
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
                {swaps.length > 0 && swaps[0].gapsClosed > 0 && (
                  <div className="rounded-xl border border-primary/40 bg-primary/5 p-4">
                    <p className="flex items-center gap-1.5 text-sm font-semibold">
                      <Sparkles className="size-4 text-primary" />
                      Start tonight with one swap
                    </p>
                    <p className="mt-1 text-sm">
                      {swaps[0].change.kind === "add"
                        ? "Add"
                        : swaps[0].change.kind === "increase"
                          ? "Increase"
                          : swaps[0].change.kind === "reduce"
                            ? "Reduce"
                            : "Drop"}{" "}
                      {foodById(swaps[0].change.foodId)?.name ?? swaps[0].change.foodId} —{" "}
                      {swaps[0].summary}.
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      No new recipes, no new shopping list — one change to the pot you already
                      cook. The full minimum-change plan follows.
                    </p>
                  </div>
                )}
                <div className="space-y-2">
                  {plan!.changes.map((c, i) => (
                    <motion.div
                      key={`${c.foodId}-${c.kind}`}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(i * 0.05, 0.3), duration: 0.3 }}
                    >
                      <PlanChangeRow
                        change={c}
                        currency={household.currency}
                        closesGaps={
                          swaps.find(
                            (s) => s.change.foodId === c.foodId && s.change.kind === c.kind,
                          )?.gapsClosed
                        }
                      />
                    </motion.div>
                  ))}
                </div>

                {/* Cost summary */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-xl border border-border/70 bg-card p-3 text-center">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Now</p>
                    <p className="text-sm font-bold tabular-nums">
                      {symbol}
                      {plan!.costBefore.toFixed(0)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-primary/40 bg-primary/5 p-3 text-center">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">After</p>
                    <p className="text-sm font-bold tabular-nums text-primary">
                      {symbol}
                      {plan!.costAfter.toFixed(0)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-card p-3 text-center">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Budget</p>
                    <p className="text-sm font-bold tabular-nums">
                      {symbol}
                      {plan!.budget.toFixed(0)}
                    </p>
                  </div>
                </div>
                {(() => {
                  const d = plan!.costAfter - plan!.costBefore;
                  const sign = d >= 0 ? "+" : "−";
                  const a = Math.abs(d);
                  return (
                    <p className="text-center text-xs text-muted-foreground">
                      {sign}
                      {symbol}
                      {a.toFixed(0)}/day ≈ {sign}
                      {symbol}
                      {(a * 7).toFixed(0)}/week · {sign}
                      {symbol}
                      {(a * 30).toFixed(0)}/month for the whole family
                    </p>
                  );
                })()}

                {/* Status banner */}
                {plan!.feasible ? (
                  <div className="rounded-xl border border-emerald-600/40 bg-emerald-600/10 p-4">
                    <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
                      Every gap closes.
                    </p>
                    <p className="mt-0.5 text-xs text-emerald-800/80 dark:text-emerald-300/80">
                      {plan!.costAfter >= plan!.costBefore
                        ? `For about ${symbol}${(plan!.costAfter - plan!.costBefore).toFixed(0)} more per day, the whole family is covered.`
                        : `And it saves about ${symbol}${(plan!.costBefore - plan!.costAfter).toFixed(0)} per day.`}
                    </p>
                  </div>
                ) : (
                  <div className="rounded-xl border border-amber-600/40 bg-amber-600/10 p-4">
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-800 dark:text-amber-300">
                      <AlertTriangle className="size-4" />
                      Food alone can&apos;t close everything — and we won&apos;t fake it.
                    </p>
                    <ul className="mt-2 space-y-1.5">
                      {plan!.openGaps.map((g) => (
                        <li
                          key={`${g.memberId}-${g.nutrientId}`}
                          className="text-xs text-amber-900/90 dark:text-amber-200/90"
                        >
                          <span className="font-semibold">{memberName(g.memberId)}</span> is still{" "}
                          <span className="font-semibold tabular-nums">
                            {Math.round(g.shortfallFrac * 100)}%
                          </span>{" "}
                          short of the {nutrientLabel(g.nutrientId)} requirement.
                          {limitingFor(g.memberId) === g.nutrientId && (
                            <>
                              {" "}
                              Their need per calorie is the highest at the table — household
                              averages hide them.
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-xs text-amber-900/80 dark:text-amber-200/80">
                      {plan!.needsBudget !== undefined
                        ? `A budget of about ${symbol}${Math.ceil(plan!.needsBudget)}/day would close every gap that food can close. `
                        : "Even with more money, food alone can't close these gaps at reasonable change limits — fortified staples or supplements may be needed. "}
                      Options beyond the pot: fortified staples, supplements, or a higher budget.
                    </p>
                  </div>
                )}

                {plan!.costAfter > plan!.budget + 0.01 && (
                  <p className="text-xs text-muted-foreground">
                    Note: the cheapest complete fix costs {symbol}
                    {(plan!.costAfter - plan!.budget).toFixed(0)} above the stated budget.
                  </p>
                )}
              </div>
            )}

            {plan && plan.changes.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <CopyPlanButton
                  householdName={state.name}
                  plan={plan}
                  currency={household.currency}
                  extra={
                    hiddenInsight
                      ? `${hiddenInsight.memberName} needs ${hiddenInsight.ratio.toFixed(1)}× the household's average ${nutrientLabel(hiddenInsight.nutrientId)} per calorie.`
                      : undefined
                  }
                />
                <ProofReceiptDialog receipt={receipt} />
              </div>
            )}

            {stigler && (
              <div className="mt-4">
                <StiglerCompareCard
                  stigler={stigler}
                  planCost={plan?.costAfter ?? costNow}
                  planCovered={plan?.feasible ?? false}
                  currency={household.currency}
                />
              </div>
            )}
          </section>
        </div>

        {/* Market shock — "what if prices move?" answered live, not claimed */}
        <Card className="mt-8 border-border/70 shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <TrendingUp className="size-3.5 text-primary" />
              What if prices move?
            </CardTitle>
            <CardDescription>
              The full plan, re-solved at different price levels from your own price list.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3">
              <Slider
                value={[shockPct]}
                onValueChange={(v) => setShockPct(v[0] ?? 0)}
                min={-30}
                max={30}
                step={5}
                aria-label="Price change percent"
                className="max-w-md flex-1"
              />
              <span className="w-16 shrink-0 text-right text-sm font-semibold tabular-nums">
                {shockPct > 0 ? "+" : ""}
                {shockPct}%
              </span>
            </div>
            {shock ? (
              shock.stillFeasible ? (
                <p className="text-sm text-emerald-700 dark:text-emerald-400">
                  At {shockPct > 0 ? "+" : ""}
                  {shockPct}% prices the plan still closes every gap: the fixed pot costs{' '}
                  {symbol}
                  {shock.costAfter.toFixed(0)}/day (today&apos;s pot would cost {symbol}
                  {shock.costBefore.toFixed(0)}).
                </p>
              ) : (
                <p className="text-sm text-amber-700 dark:text-amber-400">
                  At {shockPct > 0 ? "+" : ""}
                  {shockPct}% prices the plan can no longer close every gap — and the app says so
                  plainly instead of pretending otherwise.
                </p>
              )
            ) : (
              <p className="text-xs text-muted-foreground">
                Drag the slider to stress-test the plan against price swings.
              </p>
            )}
          </CardContent>
        </Card>

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
              Prices are yours — what these foods cost at your market. Requirements update
              automatically from each member&apos;s age/sex group. This tool is guidance, not
              medical advice.
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
