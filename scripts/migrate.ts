import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { createClient } from "@libsql/client";

const url = process.env.DATABASE_URL ?? "file:./racketcoach.db";

async function main() {
  const client = createClient({ url });
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: "drizzle" });
  console.log(`[migrate] applied migrations to ${url}`);
  client.close();
}

main().catch((err) => {
  console.error("[migrate] failed:", err);
  process.exit(1);
});
