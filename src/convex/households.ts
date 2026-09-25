import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// One saved household per user. The whole PlateFix state (members, pot,
// prices, budget) is stored as a single document keyed by userId.

const memberValidator = v.object({
  id: v.string(),
  name: v.string(),
  group: v.string(),
  potShare: v.number(),
});

export const householdValidator = v.object({
  name: v.string(),
  currency: v.string(),
  dailyBudget: v.number(),
  members: v.array(memberValidator),
  pot: v.array(v.object({ foodId: v.string(), qtyPerDayG: v.number() })),
  prices: v.array(
    v.object({ foodId: v.string(), pricePerKg: v.number() }),
  ),
});

export type SavedHousehold = {
  _id: string;
  _creationTime: number;
  userId: string;
  data: {
    name: string;
    currency: string;
    dailyBudget: number;
    members: { id: string; name: string; group: string; potShare: number }[];
    pot: { foodId: string; qtyPerDayG: number }[];
    prices: { foodId: string; pricePerKg: number }[];
  };
};

export const getMy = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    return await ctx.db
      .query("households")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
  },
});

export const save = mutation({
  args: { data: householdValidator },
  handler: async (ctx, { data }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in");

    const existing = await ctx.db
      .query("households")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { data });
      return existing._id;
    }
    return await ctx.db.insert("households", { userId, data });
  },
});
