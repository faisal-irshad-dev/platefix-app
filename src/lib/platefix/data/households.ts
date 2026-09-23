import type { Household, MemberGroup, PotLine, PriceEntry } from "../types";
import { requirementsFor } from "./nutrients";

// PlateFix data file — DEMO HOUSEHOLDS & LOCAL PRICES.
// Households are illustrative fixtures for the demo (not factual claims).
// Prices are market snapshots entered during EurekaDev: VERIFY before final
// submission and replace with a dated local-market reference (e.g. consumer
// affairs daily retail price dashboard for your city).
// Price source placeholder: https://consumeraffairs.nic.in/ (daily retail prices).

export const PRICE_CITATION =
  "Local retail market snapshot (verify: consumer affairs daily price dashboard)";
export const PRICE_URL = "https://consumeraffairs.nic.in/";

// Per-kg prices in INR as of Sep 2026 [VERIFY].
const BASE_PRICES: Record<string, number> = {
  rice: 44, atta: 32, ragi: 50, bajra: 46,
  toordal: 150, moongdal: 130, chana: 90, rajma: 160, soyachunk: 110,
  potato: 28, onion: 30, tomato: 40, carrot: 50, pumpkin: 30,
  spinach: 20, amaranth: 24, moringa: 20,
  milk: 66, curd: 90, egg: 108, chicken: 280,
  oil: 140, sugar: 45,
};

export function defaultPrices(): PriceEntry[] {
  return Object.entries(BASE_PRICES).map(([foodId, pricePerKg]) => ({
    foodId,
    pricePerKg,
    source: PRICE_CITATION,
    verified: false,
  }));
}

function member(
  id: string,
  name: string,
  group: MemberGroup,
  potShare: number,
): Household["members"][number] {
  return { id, name, group, potShare, requirements: requirementsFor(group) };
}

// ---- Household 1: Sharma family (the classic shared pot) ----
// A father, a pregnant mother, and a 14-year-old daughter — the daughter's
// iron need per calorie is the binding constraint the average hides.
function sharmaFamily(): Household {
  return {
    id: "hh-sharma",
    name: "Sharma family",
    currency: "INR",
    dailyBudget: 320,
    members: [
      member("m1", "Ramesh (father)", "man", 0.34),
      member("m2", "Sunita (mother, pregnant)", "pregnant", 0.3),
      member("m3", "Ananya (14, girl)", "girl13-15", 0.36),
    ],
  };
}

// ---- Household 2: Khan family (growing kids + toddler) ----
function khanFamily(): Household {
  return {
    id: "hh-khan",
    name: "Khan family",
    currency: "INR",
    dailyBudget: 260,
    members: [
      member("m1", "Imran (father)", "man", 0.32),
      member("m2", "Ayesha (mother)", "woman", 0.28),
      member("m3", "Zoya (11, girl)", "girl10-12", 0.22),
      member("m4", "Aman (4, boy)", "boy4-6", 0.18),
    ],
  };
}

// ---- Household 3: Rao family (lactating mother + teens) ----
function raoFamily(): Household {
  return {
    id: "hh-rao",
    name: "Rao family",
    currency: "INR",
    dailyBudget: 350,
    members: [
      member("m1", "Lakshmi (mother, lactating)", "lactating", 0.32),
      member("m2", "Karthik (16, boy)", "boy16-17", 0.38),
      member("m3", "Divya (16, girl)", "girl16-17", 0.3),
    ],
  };
}

// ---- A usual day of cooking (shared pot, grams/day for the household) ----
// Rice-dominant, dal-once-a-day, some veg + milk: a typical budget pot.
export const DEFAULT_POT: PotLine[] = [
  { foodId: "rice", qtyPerDayG: 900 },
  { foodId: "atta", qtyPerDayG: 400 },
  { foodId: "toordal", qtyPerDayG: 200 },
  { foodId: "potato", qtyPerDayG: 250 },
  { foodId: "onion", qtyPerDayG: 100 },
  { foodId: "tomato", qtyPerDayG: 150 },
  { foodId: "oil", qtyPerDayG: 60 },
  { foodId: "sugar", qtyPerDayG: 40 },
  { foodId: "milk", qtyPerDayG: 500 },
];

export const DEMO_HOUSEHOLDS: Household[] = [sharmaFamily(), khanFamily(), raoFamily()];

export function demoHousehold(id: string): Household | undefined {
  return DEMO_HOUSEHOLDS.find((h) => h.id === id);
}
