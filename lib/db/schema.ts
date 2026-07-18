import {
  sqliteTable,
  text,
  integer,
  real,
  primaryKey,
} from "drizzle-orm/sqlite-core";

/**
 * Auth.js core tables (SQLite). The `user` row is also the player profile,
 * so the brief's separate `profiles` table folds into this one (same id).
 */
export const users = sqliteTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: integer("emailVerified", { mode: "timestamp_ms" }),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).$defaultFn(
    () => new Date(),
  ),
});

export const accounts = sqliteTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => [
    primaryKey({ columns: [account.provider, account.providerAccountId] }),
  ],
);

// Auth.js database sessions. Named `session` in SQL; distinct from the
// practice `sessions` table below.
export const authSessions = sqliteTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: integer("expires", { mode: "timestamp_ms" }).notNull(),
});

export const verificationTokens = sqliteTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: integer("expires", { mode: "timestamp_ms" }).notNull(),
  },
  (vt) => [primaryKey({ columns: [vt.identifier, vt.token] })],
);

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

/**
 * One practice session summary, POSTed by the coach station.
 */
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
