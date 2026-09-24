import type { Food, FoodCategory } from "@/lib/platefix/data/foods";
import { FOODS, foodById } from "@/lib/platefix/data/foods";
import { NUTRIENTS } from "@/lib/platefix/data/nutrients";
import type { MemberGapView, PlanChange, PotLine } from "@/lib/platefix/types";
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
  Candy,
  Carrot,
  Droplet,
  Drumstick,
  Egg,
  Leaf,
  Milk,
  Plus,
  Trash2,
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
