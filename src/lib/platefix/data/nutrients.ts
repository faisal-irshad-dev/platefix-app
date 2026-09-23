import type { MemberGroup, Nutrient, NutrientRequirement } from "../types";

// PlateFix data file — NUTRIENT REQUIREMENTS.
// Source of truth: ICMR-NIN "Nutrient Requirements for Indians" (RDA 2020).
// PRD §9 rule: values are copied from cited sources, never typed from memory.
// VERIFICATION STATUS: these constants were entered under time pressure during
// EurekaDev and MUST be re-verified against the primary source (or replaced by
// values copied directly from the report) before final submission. Any value
// with verified:false is excluded from README statistics claims.
// Primary source: https://www.nin.res.in/RDA2020.jsp (ICMR-NIN 2020 report).

export const NIN_RDA_2020_URL = "https://www.nin.res.in/RDA2020.jsp";
export const NIN_RDA_2020_CITATION =
  "ICMR-NIN Expert Group, Nutrient Requirements for Indians (RDA), 2020";

export const NUTRIENTS: Nutrient[] = [
  { id: "energy", name: "Energy", unit: "kcal", warnFrac: 0.9 },
  { id: "protein", name: "Protein", unit: "g", warnFrac: 0.8 },
  { id: "iron", name: "Iron", unit: "mg", warnFrac: 0.7 },
  { id: "calcium", name: "Calcium", unit: "mg", warnFrac: 0.7 },
  { id: "zinc", name: "Zinc", unit: "mg", warnFrac: 0.7 },
  { id: "folate", name: "Folate", unit: "mcg", warnFrac: 0.7 },
  { id: "vitA", name: "Vitamin A", unit: "mcg-RAE", warnFrac: 0.7 },
  { id: "vitB12", name: "Vitamin B12", unit: "mcg", warnFrac: 0.7 },
];

type RdaTable = Record<MemberGroup, Record<string, number>>;

// RDA table as entered from the NIN 2020 report; VERIFY each cell before
// submission (mark verified:true only after checking against the source).
// Columns: energy kcal, protein g, iron mg, calcium mg, zinc mg,
// folate mcg, vitA mcg-RAE, vitB12 mcg.
const RDA: RdaTable = {
  "child1-3": { energy: 1010, protein: 13, iron: 4, calcium: 500, zinc: 3, folate: 120, vitA: 390, vitB12: 0.5 },
  "boy4-6":   { energy: 1360, protein: 17, iron: 9,  calcium: 600, zinc: 4, folate: 150, vitA: 440, vitB12: 0.8 },
  "girl4-6":  { energy: 1240, protein: 16, iron: 9,  calcium: 600, zinc: 4, folate: 150, vitA: 440, vitB12: 0.8 },
  "boy7-9":   { energy: 1700, protein: 21, iron: 13, calcium: 700, zinc: 5, folate: 200, vitA: 480, vitB12: 1.0 },
  "girl7-9":  { energy: 1550, protein: 19, iron: 13, calcium: 700, zinc: 5, folate: 200, vitA: 480, vitB12: 1.0 },
  "boy10-12": { energy: 2230, protein: 32, iron: 16, calcium: 800, zinc: 7, folate: 250, vitA: 560, vitB12: 1.2 },
  "girl10-12":{ energy: 1960, protein: 29, iron: 27, calcium: 800, zinc: 7, folate: 250, vitA: 560, vitB12: 1.2 },
  "boy13-15": { energy: 2860, protein: 44, iron: 21, calcium: 850, zinc: 10, folate: 300, vitA: 640, vitB12: 1.5 },
  "girl13-15":{ energy: 2410, protein: 39, iron: 27, calcium: 850, zinc: 8,  folate: 300, vitA: 640, vitB12: 1.5 },
  "boy16-17": { energy: 3080, protein: 50, iron: 31, calcium: 850, zinc: 11, folate: 340, vitA: 700, vitB12: 1.7 },
  "girl16-17":{ energy: 2570, protein: 41, iron: 27, calcium: 850, zinc: 8,  folate: 340, vitA: 700, vitB12: 1.7 },
  man:        { energy: 2110, protein: 54, iron: 19, calcium: 1000, zinc: 13, folate: 340, vitA: 810, vitB12: 2.0 },
  woman:      { energy: 1660, protein: 46, iron: 29, calcium: 1000, zinc: 9,  folate: 340, vitA: 640, vitB12: 2.0 },
  pregnant:   { energy: 2170, protein: 61, iron: 42, calcium: 1000, zinc: 11, folate: 570, vitA: 800, vitB12: 2.2 },
  lactating:  { energy: 2640, protein: 68, iron: 20, calcium: 1000, zinc: 12, folate: 530, vitA: 950, vitB12: 2.4 },
};

const rdaVerified: Record<string, boolean> = Object.fromEntries(
  NUTRIENTS.map((n) => [n.id, false]),
);

export function requirementsFor(group: MemberGroup): NutrientRequirement[] {
  const row = RDA[group];
  return NUTRIENTS.map((n) => ({
    nutrientId: n.id,
    rda: row[n.id],
    source: NIN_RDA_2020_CITATION,
    verified: rdaVerified[n.id],
  }));
}
