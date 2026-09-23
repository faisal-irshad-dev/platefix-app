// PlateFix core domain types.
// Data hygiene rule (PRD §9): no nutrient value, requirement, or price is
// typed anywhere in app logic — they live only in the data files, each value
// carrying its source + verified flag.

export type NutrientUnit = "kcal" | "g" | "mg" | "mcg" | "mcg-RAE" | "mcg-DFE";

export interface Nutrient {
  id: string;
  name: string;
  unit: NutrientUnit;
  /** Early-warning threshold (fraction of RDA, 0..1). Below this = at risk. */
  warnFrac: number;
}

export type MemberGroup =
  | "child1-3"
  | "boy4-6"
  | "girl4-6"
  | "boy7-9"
  | "girl7-9"
  | "boy10-12"
  | "girl10-12"
  | "boy13-15"
  | "girl13-15"
  | "boy16-17"
  | "girl16-17"
  | "man"
  | "woman"
  | "pregnant"
  | "lactating";

export interface Member {
  id: string;
  name: string;
  group: MemberGroup;
}

export interface NutrientRequirement {
  nutrientId: string;
  rda: number;
  source: string;
  verified: boolean;
}

export interface HouseholdMemberProfile extends Member {
  /** Per-nutrient RDA for this member (copied from nutrients data, per group). */
  requirements: NutrientRequirement[];
  /** Cooked-meal intake share, 0..1. Household shares sum to <= 1. */
  potShare: number;
}

export interface Household {
  id: string;
  name: string;
  /** Local currency code, e.g. "INR". */
  currency: string;
  /** Daily food budget for the whole household, in `currency`. */
  dailyBudget: number;
  members: HouseholdMemberProfile[];
}

// ---------- The pot (a usual day of cooking) ----------

export type PotLineUnit = "g" | "ml" | "unit";

export interface PotLine {
  foodId: string;
  /** Per-day household quantity in grams (ml treated 1:1 as g, unit via gramWeight). */
  qtyPerDayG: number;
}

// ---------- Prices ----------

export interface PriceEntry {
  foodId: string;
  /** Price per kg (or per litre), in household currency. */
  pricePerKg: number;
  source: string;
  verified: boolean;
}

// ---------- Minimum-change plan (solver output) ----------

export type ChangeKind = "add" | "increase" | "reduce" | "remove";

export interface PlanChange {
  foodId: string;
  kind: ChangeKind;
  /** Current household grams/day (0 for add). */
  fromG: number;
  /** Proposed household grams/day (0 for remove). */
  toG: number;
  /** Daily household cost delta for this change, in currency. */
  costDelta: number;
}

export interface GapAfter {
  memberId: string;
  nutrientId: string;
  /** Remaining shortfall fraction of RDA after the plan (0 if closed). */
  shortfallFrac: number;
}

export interface MinimumChangePlan {
  feasible: boolean;
  changes: PlanChange[];
  /** Total daily household cost before/after, in currency. */
  costBefore: number;
  costAfter: number;
  budget: number;
  /** Gaps that remain open, with honest per-gap explanation. */
  openGaps: GapAfter[];
  /** Per-member limiting nutrient (highest requirement-per-calorie deficit). */
  limitingMembers: { memberId: string; nutrientId: string }[];
  /** Solver diagnostics (ms, objective value, iterations). */
  meta: { solveMs: number; objective: number; iterations: number };
}

export interface PlanResult {
  household: Household;
  pot: PotLine[];
  prices: PriceEntry[];
  /** Per-member gap view before any fix. */
  gapsBefore: MemberGapView[];
  plan: MinimumChangePlan;
}

export interface MemberGapView {
  memberId: string;
  name: string;
  /** Nutrients below warnFrac of RDA, sorted worst first. */
  gaps: { nutrientId: string; got: number; rda: number; frac: number }[];
}
