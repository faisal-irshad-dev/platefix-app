import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// Shape of the saved household document (kept in sync with households.ts).
const householdData = v.object({
  name: v.string(),
  currency: v.string(),
  dailyBudget: v.number(),
  members: v.array(
    v.object({
      id: v.string(),
      name: v.string(),
      group: v.string(),
      potShare: v.number(),
    }),
  ),
  pot: v.array(v.object({ foodId: v.string(), qtyPerDayG: v.number() })),
  prices: v.array(v.object({ foodId: v.string(), pricePerKg: v.number() })),
});

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // role of the user. do not remove
    }).index("email", ["email"]), // index for the email. do not remove or modify

    // add other tables here

    // One saved PlateFix household per user (members, pot, prices, budget).
    households: defineTable({
      userId: v.id("users"),
      data: householdData,
    }).index("by_user", ["userId"]),

    // tableName: defineTable({
    //   ...
    //   // table fields
    // }).index("by_field", ["field"])
  },
  {
    schemaValidation: false,
  },
);

export default schema;
