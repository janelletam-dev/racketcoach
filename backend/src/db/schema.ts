import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

/** A player. Auth is token-based, so this is just the identity + profile. */
export const users = sqliteTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).$defaultFn(
    () => new Date(),
  ),
});

/**
 * A pairing code links a physical paddle / coach station to a user.
 * The code exists first (shown as a QR); user_id is null until claimed.
 */
export const pairings = sqliteTable("pairings", {
  code: text("code").primaryKey(),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).$defaultFn(
    () => new Date(),
  ),
});

/** One practice session summary, POSTed by the coach station. */
export const sessions = sqliteTable("sessions", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  playedAt: integer("played_at", { mode: "timestamp_ms" }).notNull(),
  goodReps: integer("good_reps").notNull(),
  totalReps: integer("total_reps").notNull(),
  bestStreak: integer("best_streak").notNull(),
  commonFault: text("common_fault"),
  avgSpeed: real("avg_speed"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).$defaultFn(
    () => new Date(),
  ),
});

export type SessionRow = typeof sessions.$inferSelect;
export type UserRow = typeof users.$inferSelect;
