import type { Food, FoodCategory } from "@/lib/platefix/data/foods";
import { FOODS, foodById } from "@/lib/platefix/data/foods";
import { NUTRIENTS, requirementsFor } from "@/lib/platefix/data/nutrients";
import type {
  HiddenMemberInsight,
  Household,
  HouseholdMemberProfile,
  MemberGroup,
  MemberGapView,
  MinimumChangePlan,
  PlanChange,
  PotLine,
  PriceEntry,
  SpendTouchingNoGaps,
  StiglerResult,
} from "@/lib/platefix/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Baby,
  Candy,
  Carrot,
  Check,
  CircleDollarSign,
  Droplet,
  Drumstick,
  Egg,
  Eye,
  FlaskConical,
  Leaf,
  MessageCircle,
  Milk,
  Plus,
  Table2,
  Tag,
  Trash2,
  UserPlus,
  Users,
  Wheat,
} from "lucide-react";
import { motion } from "framer-motion";
import { useState } from "react";

const nutrientName = new Map(NUTRIENTS.map((n) => [n.id, n]));
const nutrientUnit = new Map(NUTRIENTS.map((n) => [n.id, n.unit]));

export function nutrientLabel(id: string): string {
  return nutrientName.get(id)?.name ?? id;
}

export function formatValue(v: number, unit: string | undefined): string {
  const decimals =
    unit === "mcg" || unit === "mcg-RAE" || unit === "mcg-DFE" ? 0 : unit === "kcal" ? 0 : v < 10 ? 1 : 0;
  return v.toFixed(decimals);
}

export function unitOf(id: string): string {
  return nutrientUnit.get(id) ?? "";
}

// ---- Category icon -------------------------------------------------------

const CATEGORY_ICON: Record<FoodCategory, typeof Wheat> = {
  grain: Wheat,
  pulse: Leaf,
  vegetable: Carrot,
  greens: Leaf,
  dairy: Milk,
  egg: Egg,
  meat: Drumstick,
  fat: Droplet,
  sugar: Candy,
};

export function FoodIcon({ category, className }: { category: FoodCategory; className?: string }) {
  const Icon = CATEGORY_ICON[category] ?? Wheat;
  return <Icon className={className} />;
}

// ---- Gap meter -----------------------------------------------------------

/** Red → amber → green bar for one nutrient vs RDA. */
export function GapMeter({
  frac,
  label,
  detail,
  animate = true,
}: {
  frac: number;
  label: string;
  detail?: string;
  animate?: boolean;
}) {
  const pct = Math.min(100, Math.max(0, frac * 100));
  const color =
    frac >= 1
      ? "bg-emerald-600"
      : frac >= 0.75
        ? "bg-amber-500"
        : frac >= 0.5
          ? "bg-orange-500"
          : "bg-red-600";
  const status =
    frac >= 1 ? "met" : frac >= 0.75 ? "close" : frac >= 0.5 ? "low" : "critical";
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">{detail}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <motion.div
          className={`h-full rounded-full ${color}`}
          initial={animate ? { width: 0 } : false}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          style={animate ? undefined : { width: `${pct}%` }}
        />
      </div>
      <span className="sr-only">{status}</span>
    </div>
  );
}

// ---- Member gap card -----------------------------------------------------

export function MemberGapCard({
  view,
  showAll = false,
}: {
  view: MemberGapView;
  showAll?: boolean;
}) {
  const rows = showAll
    ? view.gaps
    : view.gaps.slice(0, 4);
  return (
    <div className="rounded-xl border border-border/70 bg-card p-4 shadow-none">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-semibold">{view.name}</h4>
        {view.gaps.length > 0 ? (
          <Badge variant="destructive" className="text-[10px]">
            {view.gaps.length} short
          </Badge>
        ) : (
          <Badge className="bg-emerald-600 text-[10px] text-white">covered</Badge>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Every tracked nutrient meets its threshold.
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((g) => (
            <GapMeter
              key={g.nutrientId}
              frac={g.frac}
              label={nutrientLabel(g.nutrientId)}
              detail={`${formatValue(g.got, unitOf(g.nutrientId))} / ${formatValue(g.rda, unitOf(g.nutrientId))} ${unitOf(g.nutrientId)}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Plan change row -----------------------------------------------------

const KIND_STYLE: Record<
  PlanChange["kind"],
  { label: string; icon: string; className: string }
> = {
  add: { label: "Add", icon: "+", className: "bg-emerald-600/15 text-emerald-700 dark:text-emerald-400" },
  increase: { label: "Increase", icon: "↑", className: "bg-sky-600/15 text-sky-700 dark:text-sky-400" },
  reduce: { label: "Reduce", icon: "↓", className: "bg-amber-600/15 text-amber-700 dark:text-amber-500" },
  remove: { label: "Remove", icon: "−", className: "bg-red-600/15 text-red-700 dark:text-red-400" },
};

export function PlanChangeRow({ change, currency }: { change: PlanChange; currency: string }) {
  const food = foodById(change.foodId);
  const style = KIND_STYLE[change.kind];
  const money = (v: number) =>
    `${v >= 0 ? "+" : "−"}${currency === "INR" ? "₹" : currency}${Math.abs(v).toFixed(0)}`;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-card p-3">
      <span
        className={`flex size-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${style.className}`}
        aria-hidden
      >
        {style.icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">
          {style.label} {food?.name ?? change.foodId}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {change.kind === "add"
            ? `${change.toG} g/day to the shared pot`
            : change.kind === "remove"
              ? `drop ${change.fromG} g/day from the pot`
              : `${change.fromG} → ${change.toG} g/day`}
          {food?.localName ? ` · ${food.localName}` : ""}
        </p>
      </div>
      <span
        className={`shrink-0 text-sm font-semibold tabular-nums ${
          change.costDelta > 0.5
            ? "text-red-600 dark:text-red-400"
            : change.costDelta < -0.5
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-muted-foreground"
        }`}
      >
        {money(change.costDelta)}
      </span>
    </div>
  );
}

// ---- Pot editor ----------------------------------------------------------

export function PotEditor({
  pot,
  onChange,
  currency,
}: {
  pot: PotLine[];
  onChange: (next: PotLine[]) => void;
  currency: string;
}) {
  const [addId, setAddId] = useState<string>("");

  const updateQty = (foodId: string, qty: number) => {
    onChange(
      pot.map((l) => (l.foodId === foodId ? { ...l, qtyPerDayG: Math.max(0, Math.round(qty) || 0) } : l)),
    );
  };

  const removeLine = (foodId: string) => onChange(pot.filter((l) => l.foodId !== foodId));

  const addLine = () => {
    if (!addId || pot.some((l) => l.foodId === addId)) return;
    onChange([...pot, { foodId: addId, qtyPerDayG: 100 }]);
    setAddId("");
  };

  const available = FOODS.filter((f) => !pot.some((l) => l.foodId === f.id));
  const symbol = currency === "INR" ? "₹" : currency;

  return (
    <div className="space-y-2">
      {pot.map((line) => {
        const food = foodById(line.foodId);
        if (!food) return null;
        return (
          <div
            key={line.foodId}
            className="flex items-center gap-2 rounded-lg border border-border/70 bg-card px-3 py-2"
          >
            <FoodIcon category={food.category} className="size-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{food.name}</p>
              {food.localName && (
                <p className="truncate text-[11px] text-muted-foreground">{food.localName}</p>
              )}
            </div>
            <div className="flex items-center gap-1">
              <Input
                type="number"
                min={0}
                step={10}
                value={line.qtyPerDayG}
                onChange={(e) => updateQty(line.foodId, Number(e.target.value))}
                className="h-8 w-20 text-right tabular-nums"
                aria-label={`${food.name} grams per day`}
              />
              <span className="w-6 text-xs text-muted-foreground">g</span>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground hover:text-destructive"
                onClick={() => removeLine(line.foodId)}
                aria-label={`Remove ${food.name}`}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </div>
        );
      })}

      <div className="flex items-center gap-2 pt-1">
        <Select value={addId} onValueChange={setAddId}>
          <SelectTrigger className="h-9 flex-1" aria-label="Add a food to the pot">
            <SelectValue placeholder="Add a food…" />
          </SelectTrigger>
          <SelectContent>
            {available.map((f: Food) => (
              <SelectItem key={f.id} value={f.id}>
                {f.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-1"
          onClick={addLine}
          disabled={!addId}
        >
          <Plus className="size-3.5" />
          Add
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Quantities are the whole household&apos;s grams per day, split by each member&apos;s share of the pot. Prices in {symbol}/kg feed the budget.
      </p>
    </div>
  );
}

// ---- Household builder ---------------------------------------------------

export const MEMBER_GROUP_OPTIONS: { group: MemberGroup; label: string }[] = [
  { group: "child1-3", label: "Child · 1–3 yrs" },
  { group: "boy4-6", label: "Boy · 4–6 yrs" },
  { group: "girl4-6", label: "Girl · 4–6 yrs" },
  { group: "boy7-9", label: "Boy · 7–9 yrs" },
  { group: "girl7-9", label: "Girl · 7–9 yrs" },
  { group: "boy10-12", label: "Boy · 10–12 yrs" },
  { group: "girl10-12", label: "Girl · 10–12 yrs" },
  { group: "boy13-15", label: "Boy · 13–15 yrs" },
  { group: "girl13-15", label: "Girl · 13–15 yrs" },
  { group: "boy16-17", label: "Boy · 16–17 yrs" },
  { group: "girl16-17", label: "Girl · 16–17 yrs" },
  { group: "man", label: "Adult man" },
  { group: "woman", label: "Adult woman" },
  { group: "pregnant", label: "Pregnant woman" },
  { group: "lactating", label: "Lactating mother" },
];

export function groupLabel(group: string): string {
  return MEMBER_GROUP_OPTIONS.find((g) => g.group === group)?.label ?? group;
}

export function createMember(
  name: string,
  group: MemberGroup,
  potShare: number,
): HouseholdMemberProfile {
  return {
    id: `m-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
    name: name.trim() || "Family member",
    group,
    potShare,
    requirements: requirementsFor(group),
  };
}

/** Assembles the live household from the builder state. */
export function buildHousehold(
  name: string,
  currency: string,
  dailyBudget: number,
  members: { id: string; name: string; group: MemberGroup; potShare: number }[],
): Household {
  return {
    id: "my-household",
    name,
    currency,
    dailyBudget: Math.max(0, dailyBudget || 0),
    members: members.map((m) => ({
      ...m,
      requirements: requirementsFor(m.group),
    })),
  };
}

export function MemberIcon({ group, className }: { group: string; className?: string }) {
  const Icon =
    group === "man" || group === "woman" || group === "pregnant" || group === "lactating"
      ? Users
      : group.startsWith("child") || group.endsWith("4-6")
        ? Baby
        : Users;
  return <Icon className={className} />;
}

export function MembersEditor({
  members,
  onChange,
}: {
  members: HouseholdMemberProfile[];
  onChange: (next: HouseholdMemberProfile[]) => void;
}) {
  const shareTotal = members.reduce((s, m) => s + m.potShare, 0);
  const setMember = (id: string, patch: Partial<HouseholdMemberProfile>) =>
    onChange(members.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  const addMember = () => {
    const remaining = Math.max(0, 1 - shareTotal);
    const share = members.length === 0 ? 1 : Math.min(remaining > 0 ? remaining : 0.25, 0.25);
    onChange([...members, createMember("", "woman", Math.round(share * 100) / 100)]);
  };

  return (
    <div className="space-y-2">
      {members.map((m, i) => (
        <div
          key={m.id}
          className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-card px-3 py-2"
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
            {i + 1}
          </span>
          <Input
            value={m.name}
            onChange={(e) => setMember(m.id, { name: e.target.value })}
            placeholder="Name"
            className="h-8 w-32 flex-1 sm:w-40"
            aria-label={`Name of member ${i + 1}`}
          />
          <Select
            value={m.group}
            onValueChange={(g) => setMember(m.id, { group: g as MemberGroup })}
          >
            <SelectTrigger
              className="h-8 w-full sm:w-[170px]"
              aria-label={`Age/sex group of member ${i + 1}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MEMBER_GROUP_OPTIONS.map((g) => (
                <SelectItem key={g.group} value={g.group}>
                  {g.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div
            className="flex items-center gap-1 rounded-lg border border-border/70 px-1"
            title="Share of the shared pot"
          >
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground"
              onClick={() =>
                setMember(m.id, { potShare: Math.max(0.05, Math.round((m.potShare - 0.05) * 100) / 100) })
              }
              aria-label={`Decrease pot share of member ${i + 1}`}
            >
              −
            </Button>
            <span className="w-10 text-center text-xs font-semibold tabular-nums">
              {Math.round(m.potShare * 100)}%
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground"
              onClick={() =>
                setMember(m.id, { potShare: Math.min(1, Math.round((m.potShare + 0.05) * 100) / 100) })
              }
              aria-label={`Increase pot share of member ${i + 1}`}
            >
              +
            </Button>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-destructive"
            onClick={() => onChange(members.filter((x) => x.id !== m.id))}
            aria-label={`Remove ${m.name || `member ${i + 1}`}`}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ))}

      <div className="flex items-center justify-between pt-1">
        <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={addMember}>
          <UserPlus className="size-3.5" />
          Add member
        </Button>
        <p
          className={`text-xs tabular-nums ${
            shareTotal > 1.001 ? "font-semibold text-amber-700 dark:text-amber-400" : "text-muted-foreground"
          }`}
        >
          {Math.round(shareTotal * 100)}% of the pot shared
        </p>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Each member&apos;s share is how much of the shared pot they eat. Requirements update
        automatically from their age/sex group.
      </p>
    </div>
  );
}

// ---- Price editor ---------------------------------------------------------

export function PricesEditor({
  prices,
  onChange,
  currency,
}: {
  prices: PriceEntry[];
  onChange: (next: PriceEntry[]) => void;
  currency: string;
}) {
  const symbol = currency === "INR" ? "₹" : currency;
  const setPrice = (foodId: string, v: number) =>
    onChange(
      prices.map((p) =>
        p.foodId === foodId ? { ...p, pricePerKg: Math.max(0, v || 0) } : p,
      ),
    );

  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        {FOODS.map((f) => {
          const entry = prices.find((p) => p.foodId === f.id);
          return (
            <div
              key={f.id}
              className="flex items-center gap-2 rounded-lg border border-border/70 bg-card px-3 py-1.5"
            >
              <FoodIcon category={f.category} className="size-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{f.name}</p>
              </div>
              <div className="relative w-24 shrink-0">
                <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  {symbol}
                </span>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={entry?.pricePerKg ?? 0}
                  onChange={(e) => setPrice(f.id, Number(e.target.value))}
                  className="h-7 pl-6 pr-6 text-right text-xs tabular-nums"
                  aria-label={`${f.name} price per kilogram`}
                />
                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
                  /kg
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Enter what these foods cost at your local market today — the plan and budget math
        update instantly.
      </p>
    </div>
  );
}

export function PricesDialog({
  prices,
  onChange,
  currency,
}: {
  prices: PriceEntry[];
  onChange: (next: PriceEntry[]) => void;
  currency: string;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5">
          <Tag className="size-3.5" />
          Edit prices
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="size-4 text-primary" />
            Local market prices
          </DialogTitle>
          <DialogDescription>
            Per-kilogram prices used for the budget and every cost estimate.
          </DialogDescription>
        </DialogHeader>
        <PricesEditor prices={prices} onChange={onChange} currency={currency} />
      </DialogContent>
    </Dialog>
  );
}

// ---- Stigler diet comparison ----------------------------------------------

/**
 * The 1945 Stigler diet, computed live on this household's own data: same
 * solver, same food list, same nutrient targets — objective swapped for the
 * one every cost-only diet optimizer uses: minimize spend, full stop.
 * Framing rule: this is what the machine recommends, never a judgment on the
 * family. Copy stays exact, not preachy.
 */
export function StiglerCompareCard({
  stigler,
  planCost,
  planCovered,
  currency,
}: {
  stigler: StiglerResult;
  /** PlateFix plan's daily cost, shown right next to the pure-cost answer. */
  planCost: number;
  /** Whether the plan closes every gap — copy stays honest when it doesn't. */
  planCovered: boolean;
  currency: string;
}) {
  const [open, setOpen] = useState(false);
  const symbol = currency === "INR" ? "₹" : currency;
  const money = (v: number) => `${symbol}${v.toFixed(0)}`;

  return (
    <div className="rounded-xl border border-border/70 bg-muted/30 shadow-none">
      <div className="flex flex-wrap items-center justify-between gap-2 p-3">
        <div className="flex min-w-0 items-center gap-2">
          <Table2 className="size-4 shrink-0 text-muted-foreground" />
          <p className="text-sm font-medium">Why not just minimize cost?</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <FlaskConical className="size-3.5" />
          {open ? "Hide the cost-only answer" : "See what a spreadsheet would tell you to eat"}
        </Button>
      </div>

      {open && (
        <div className="border-t border-border/70 p-4">
          <p className="text-xs leading-5 text-muted-foreground">
            The exact same solver, the exact same food list, the exact same nutrient
            targets — one different instruction: minimize cost, full stop. This is the
            1945 Stigler diet problem, the original cost-only diet optimization, recomputed
            live on your household&apos;s data.
          </p>

          {!stigler.feasible ? (
            <p className="mt-3 text-sm text-muted-foreground">
              With this food list and these requirements, no basket meets every member&apos;s
              needs — even with unlimited money. The minimum-change plan already reports
              this honestly.
            </p>
          ) : (
            <>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {/* The pure-cost answer */}
                <div className="rounded-lg border border-border/70 bg-card p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Cost-only optimizer says
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {stigler.items.map((it) => {
                      const food = foodById(it.foodId);
                      return (
                        <li key={it.foodId} className="flex items-baseline justify-between gap-2 text-sm">
                          <span className="min-w-0 truncate font-medium">
                            {food?.name ?? it.foodId}
                            {food?.localName ? (
                              <span className="ml-1 text-[11px] text-muted-foreground">{food.localName}</span>
                            ) : null}
                          </span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            {it.gPerDay.toLocaleString()} g/day
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="mt-2 border-t border-border/60 pt-2 text-sm">
                    <span className="font-bold tabular-nums">{money(stigler.totalCostPerDay)}</span>
                    <span className="text-muted-foreground">/day, nothing else</span>
                  </p>
                </div>

                {/* PlateFix's answer, same frame */}
                <div className="rounded-lg border border-primary/40 bg-primary/5 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">
                    PlateFix says
                  </p>
                  <ul className="mt-2 space-y-1.5 text-sm">
                    <li className="flex items-baseline justify-between gap-2">
                      <span className="font-medium">Small changes to the food you already cook</span>
                    </li>
                    <li className="flex items-baseline justify-between gap-2">
                      <span className="text-muted-foreground">Nothing new to learn, nothing wasted</span>
                    </li>
                  </ul>
                  <p className="mt-2 border-t border-primary/20 pt-2 text-sm">
                    <span className="font-bold tabular-nums text-primary">{money(planCost)}</span>
                    <span className="text-muted-foreground">
                      {planCovered
                        ? "/day — the whole family, covered"
                        : "/day — plus an honest report of what food alone can't fix"}
                    </span>
                  </p>
                </div>
              </div>

              <p className="mt-3 text-xs italic leading-5 text-muted-foreground">
                Mathematically perfect — every requirement met at the lowest possible spend.
                And nobody would actually eat it. That&apos;s the whole point: the missing
                ingredient in a spreadsheet was never math, it was the family.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Hidden member insight -------------------------------------------------

/**
 * The card that makes the "shared pot" abstraction visible: the member whose
 * requirement per 1000 kcal is furthest above the household average. Every
 * number on it is computed live from the RDA table and the current pot —
 * nothing here is a claim.
 */
export function HiddenMemberCard({ insight }: { insight: HiddenMemberInsight }) {
  const pct = Math.round(insight.fracNow * 100);
  return (
    <div className="rounded-xl border border-violet-600/40 bg-violet-600/5 p-4">
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <Eye className="size-4 text-violet-600 dark:text-violet-400" />
        The average hides someone
      </p>
      <p className="mt-1.5 text-sm leading-6">
        <span className="font-semibold">{insight.memberName}</span> needs{" "}
        <span className="font-semibold tabular-nums">{insight.ratio.toFixed(1)}×</span> the
        household&apos;s average {nutrientLabel(insight.nutrientId)} per calorie they eat.
        Sharing the pot by share, not by need, misses them first.
      </p>
      <p className="mt-1.5 text-sm">
        Today they get{" "}
        <span
          className={`font-semibold tabular-nums ${
            pct >= 70
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-amber-700 dark:text-amber-400"
          }`}
        >
          {pct}%
        </span>{" "}
        of their {nutrientLabel(insight.nutrientId)} requirement.
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        Computed from the RDA table: their need per 1000 kcal vs the potShare-weighted
        household average, checked against the actual pot.
      </p>
    </div>
  );
}

// ---- Spend aimed at nothing -------------------------------------------------

/**
 * The what-if every judge asks: how much of today's spend touches no open
 * gap. Renders nothing when the pot is fully aimed — honesty cuts both ways.
 */
export function NoGapSpendStrip({
  info,
  currency,
}: {
  info: SpendTouchingNoGaps;
  currency: string;
}) {
  const symbol = currency === "INR" ? "₹" : currency;
  const pct = Math.round(info.wasteFrac * 100);
  if (info.totalSpend <= 0 || pct < 1) return null;
  const working = Math.max(0, 100 - pct);
  const names = (id: string) => foodById(id)?.name ?? id;
  return (
    <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <CircleDollarSign className="size-4 text-muted-foreground" />
        Where today&apos;s food money actually points
      </p>
      <div className="mt-2.5 flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-emerald-600" style={{ width: `${working}%` }} />
        <div className="h-full bg-amber-500" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-sm leading-6">
        <span className="font-semibold tabular-nums">
          {symbol}
          {info.spendTouchingNothing.toFixed(0)} — {pct}%
        </span>{" "}
        goes to foods that do nothing for any open gap:
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {info.offenders.slice(0, 4).map((o) => (
          <span
            key={o.foodId}
            className="rounded-full border border-amber-600/40 bg-amber-600/10 px-2 py-0.5 text-xs"
          >
            {names(o.foodId)} · {symbol}
            {o.spend.toFixed(0)}
          </span>
        ))}
        {info.offenders.length > 4 && (
          <span className="px-1 py-0.5 text-xs text-muted-foreground">
            +{info.offenders.length - 4} more
          </span>
        )}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        It&apos;s already in the kitchen. The plan doesn&apos;t ask for more money — it re-aims
        what&apos;s there.
      </p>
    </div>
  );
}

// ---- WhatsApp share ---------------------------------------------------------

const SHARE_KIND: Record<PlanChange["kind"], string> = {
  add: "Add",
  increase: "More",
  reduce: "Less",
  remove: "Stop",
};

/**
 * Shares the plan where family food decisions actually happen: WhatsApp. The
 * message is built from the computed plan — kind, grams, cost deltas — and the
 * same honest copy as the screen, feasible or not. The clipboard copy is a
 * convenience; the wa.me URL carries the text either way.
 */
export function CopyPlanButton({
  householdName,
  plan,
  currency,
  extra,
}: {
  householdName: string;
  plan: MinimumChangePlan;
  currency: string;
  /** One extra computed insight line, e.g. the hidden-member sentence. */
  extra?: string;
}) {
  const [copied, setCopied] = useState(false);
  const symbol = currency === "INR" ? "₹" : currency;

  const lines: string[] = [`PlateFix plan — ${householdName}`];
  if (plan.changes.length > 0) {
    lines.push("");
    for (const c of plan.changes) {
      const food = foodById(c.foodId)?.name ?? c.foodId;
      const grams =
        c.kind === "add"
          ? `${c.toG} g/day`
          : c.kind === "remove"
            ? `drop ${c.fromG} g/day`
            : `${c.fromG} → ${c.toG} g/day`;
      const cost =
        c.costDelta >= 0.5
          ? ` (+${symbol}${c.costDelta.toFixed(0)})`
          : c.costDelta <= -0.5
            ? ` (−${symbol}${Math.abs(c.costDelta).toFixed(0)})`
            : "";
      lines.push(`• ${SHARE_KIND[c.kind]} ${food} — ${grams}${cost}`);
    }
  }
  lines.push("");
  if (plan.feasible) {
    lines.push(
      `Every nutrient gap closes for about ${symbol}${plan.costAfter.toFixed(0)}/day (from ${symbol}${plan.costBefore.toFixed(0)} today).`,
    );
  } else {
    for (const g of plan.openGaps) {
      lines.push(
        `Still short: ${Math.round(g.shortfallFrac * 100)}% of the ${nutrientLabel(g.nutrientId)} requirement.`,
      );
    }
    if (plan.needsBudget !== undefined) {
      lines.push(
        `Closing every gap food can close needs about ${symbol}${Math.ceil(plan.needsBudget)}/day.`,
      );
    }
  }
  if (extra) lines.push(extra);
  lines.push("");
  lines.push("Smallest change to the family pot, from PlateFix.");

  const share = () => {
    const text = lines.join("\n");
    try {
      void navigator.clipboard?.writeText(text);
    } catch {
      // Clipboard can be blocked — WhatsApp still gets the text via the URL.
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  };

  return (
    <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" onClick={share}>
      {copied ? (
        <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
      ) : (
        <MessageCircle className="size-3.5" />
      )}
      {copied ? "Copied — finish in WhatsApp" : "Share the plan on WhatsApp"}
    </Button>
  );
}
