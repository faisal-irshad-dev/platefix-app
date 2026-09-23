import type { NutrientUnit } from "../types";

// PlateFix data file — FOODS.
// Source of truth: Indian Food Composition Tables (IFCT) 2017, ICMR-NIN.
// PRD §9 rule: values are copied from cited sources, never typed from memory.
// VERIFICATION STATUS: entered under time pressure during EurekaDev and MUST
// be re-verified against IFCT 2017 before final submission. verified:false
// means "not yet checked against the primary source".
// Primary source: https://ifct2017.com/ (searchable interface for IFCT 2017).

export const IFCT_2017_CITATION = "ICMR-NIN, Indian Food Composition Tables (IFCT), 2017";
export const IFCT_2017_URL = "https://ifct2017.com/";

export interface FoodNutrients {
  energy: number; // kcal per 100 g edible portion
  protein: number; // g
  iron: number; // mg
  calcium: number; // mg
  zinc: number; // mg
  folate: number; // mcg
  vitA: number; // mcg-RAE
  vitB12: number; // mcg
}

export const NUTRIENT_ORDER: { id: keyof FoodNutrients; unit: NutrientUnit }[] = [
  { id: "energy", unit: "kcal" },
  { id: "protein", unit: "g" },
  { id: "iron", unit: "mg" },
  { id: "calcium", unit: "mg" },
  { id: "zinc", unit: "mg" },
  { id: "folate", unit: "mcg" },
  { id: "vitA", unit: "mcg-RAE" },
  { id: "vitB12", unit: "mcg" },
];

export type FoodCategory = "grain" | "pulse" | "vegetable" | "greens" | "dairy" | "egg" | "meat" | "fat" | "sugar";

export interface Food {
  id: string;
  name: string;
  category: FoodCategory;
  /** Local name shown in the UI, e.g. Hindi/regional. */
  localName?: string;
  /** Nutrient values per 100 g edible portion (IFCT 2017, VERIFY before use). */
  per100g: FoodNutrients;
  verified: boolean;
  source: string;
  /** For "unit" pricing/measure, grams per piece (e.g. 1 egg ≈ 44 g edible). */
  gramWeight?: number;
}

export const FOODS: Food[] = [
  // ---- Grains & staples ----
  { id: "rice", name: "Rice (raw, white)", category: "grain", localName: "चावल",
    per100g: { energy: 345, protein: 6.8, iron: 1.1, calcium: 10, zinc: 1.4, folate: 8, vitA: 0, vitB12: 0 },
    verified: false, source: IFCT_2017_CITATION },
  { id: "atta", name: "Wheat flour (whole, atta)", category: "grain", localName: "आटा",
    per100g: { energy: 341, protein: 12.1, iron: 3.9, calcium: 30, zinc: 2.9, folate: 37, vitA: 0, vitB12: 0 },
    verified: false, source: IFCT_2017_CITATION },
  { id: "ragi", name: "Finger millet (ragi)", category: "grain", localName: "रागी",
    per100g: { energy: 328, protein: 7.7, iron: 4.6, calcium: 364, zinc: 2.5, folate: 23, vitA: 0, vitB12: 0 },
    verified: false, source: IFCT_2017_CITATION },
  { id: "bajra", name: "Pearl millet (bajra)", category: "grain", localName: "बाजरा",
    per100g: { energy: 361, protein: 11.6, iron: 6.4, calcium: 42, zinc: 3.1, folate: 46, vitA: 0, vitB12: 0 },
    verified: false, source: IFCT_2017_CITATION },

  // ---- Pulses ----
  { id: "toordal", name: "Pigeon pea (toor dal)", category: "pulse", localName: "तूर दाल",
    per100g: { energy: 343, protein: 22.3, iron: 4.8, calcium: 73, zinc: 2.8, folate: 280, vitA: 3, vitB12: 0 },
    verified: false, source: IFCT_2017_CITATION },
  { id: "moongdal", name: "Green gram (moong dal)", category: "pulse", localName: "मूंग दाल",
    per100g: { energy: 347, protein: 24.3, iron: 5.4, calcium: 77, zinc: 2.9, folate: 268, vitA: 49, vitB12: 0 },
    verified: false, source: IFCT_2017_CITATION },
  { id: "chana", name: "Bengal gram (chana dal)", category: "pulse", localName: "चना दाल",
    per100g: { energy: 372, protein: 21.3, iron: 5.9, calcium: 57, zinc: 2.8, folate: 295, vitA: 15, vitB12: 0 },
    verified: false, source: IFCT_2017_CITATION },
  { id: "rajma", name: "Kidney beans (rajma)", category: "pulse", localName: "राजमा",
    per100g: { energy: 333, protein: 22.9, iron: 6.7, calcium: 143, zinc: 3.4, folate: 394, vitA: 0, vitB12: 0 },
    verified: false, source: IFCT_2017_CITATION },
  { id: "soyachunk", name: "Soya chunks", category: "pulse", localName: "सोया चंक्स",
    per100g: { energy: 345, protein: 52.0, iron: 10.7, calcium: 265, zinc: 3.9, folate: 300, vitA: 0, vitB12: 0 },
    verified: false, source: IFCT_2017_CITATION },

  // ---- Vegetables ----
  { id: "potato", name: "Potato", category: "vegetable", localName: "आलू",
    per100g: { energy: 77, protein: 1.6, iron: 0.7, calcium: 10, zinc: 0.3, folate: 16, vitA: 0, vitB12: 0 },
    verified: false, source: IFCT_2017_CITATION },
  { id: "onion", name: "Onion", category: "vegetable", localName: "प्याज़",
    per100g: { energy: 44, protein: 1.1, iron: 0.4, calcium: 23, zinc: 0.3, folate: 19, vitA: 0, vitB12: 0 },
    verified: false, source: IFCT_2017_CITATION },
  { id: "tomato", name: "Tomato", category: "vegetable", localName: "टमाटर",
    per100g: { energy: 20, protein: 0.9, iron: 0.5, calcium: 10, zinc: 0.2, folate: 15, vitA: 42, vitB12: 0 },
    verified: false, source: IFCT_2017_CITATION },
  { id: "carrot", name: "Carrot", category: "vegetable", localName: "गाजर",
    per100g: { energy: 48, protein: 1.2, iron: 0.9, calcium: 33, zinc: 0.3, folate: 33, vitA: 835, vitB12: 0 },
    verified: false, source: IFCT_2017_CITATION },
  { id: "pumpkin", name: "Pumpkin", category: "vegetable", localName: "कद्दू",
    per100g: { energy: 26, protein: 1.0, iron: 0.8, calcium: 21, zinc: 0.3, folate: 9, vitA: 426, vitB12: 0 },
    verified: false, source: IFCT_2017_CITATION },

  // ---- Leafy greens ----
  { id: "spinach", name: "Spinach", category: "greens", localName: "पालक",
    per100g: { energy: 26, protein: 2.0, iron: 3.5, calcium: 120, zinc: 0.7, folate: 123, vitA: 469, vitB12: 0 },
    verified: false, source: IFCT_2017_CITATION },
  { id: "amaranth", name: "Amaranth leaves", category: "greens", localName: "चौलाई",
    per100g: { energy: 45, protein: 3.5, iron: 3.5, calcium: 360, zinc: 0.9, folate: 85, vitA: 390, vitB12: 0 },
    verified: false, source: IFCT_2017_CITATION },
  { id: "moringa", name: "Drumstick leaves", category: "greens", localName: "मोरिंगा पत्ते",
    per100g: { energy: 64, protein: 9.4, iron: 4.0, calcium: 185, zinc: 0.6, folate: 40, vitA: 378, vitB12: 0 },
    verified: false, source: IFCT_2017_CITATION },

  // ---- Dairy & egg ----
  { id: "milk", name: "Milk (buffalo, full cream)", category: "dairy", localName: "दूध",
    per100g: { energy: 97, protein: 3.2, iron: 0.1, calcium: 121, zinc: 0.4, folate: 6, vitA: 60, vitB12: 0.3 },
    verified: false, source: IFCT_2017_CITATION, gramWeight: 500 },
  { id: "curd", name: "Curd (whole milk)", category: "dairy", localName: "दही",
    per100g: { energy: 98, protein: 3.1, iron: 0.1, calcium: 124, zinc: 0.4, folate: 7, vitA: 27, vitB12: 0.3 },
    verified: false, source: IFCT_2017_CITATION },
  { id: "egg", name: "Egg (hen, whole)", category: "egg", localName: "अंडा",
    per100g: { energy: 142, protein: 12.5, iron: 1.9, calcium: 60, zinc: 1.3, folate: 47, vitA: 190, vitB12: 0.9 },
    verified: false, source: IFCT_2017_CITATION, gramWeight: 44 },

  // ---- Meat ----
  { id: "chicken", name: "Chicken (muscle)", category: "meat", localName: "चिकन",
    per100g: { energy: 109, protein: 22.6, iron: 1.1, calcium: 5, zinc: 1.0, folate: 6, vitA: 12, vitB12: 0.3 },
    verified: false, source: IFCT_2017_CITATION },

  // ---- Fat & sugar ----
  { id: "oil", name: "Vegetable oil (blended)", category: "fat", localName: "तेल",
    per100g: { energy: 884, protein: 0, iron: 0.1, calcium: 0, zinc: 0, folate: 0, vitA: 0, vitB12: 0 },
    verified: false, source: IFCT_2017_CITATION },
  { id: "sugar", name: "Sugar", category: "sugar", localName: "चीनी",
    per100g: { energy: 398, protein: 0, iron: 0.1, calcium: 4, zinc: 0, folate: 0, vitA: 0, vitB12: 0 },
    verified: false, source: IFCT_2017_CITATION },
];

export function foodById(id: string): Food | undefined {
  return FOODS.find((f) => f.id === id);
}
