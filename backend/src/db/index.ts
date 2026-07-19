import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema";

// SQLite via libSQL. Local dev uses a plain file; on Modal the same URL
// points at a file on a mounted Volume (file:/data/racketcoach.db).
const url = process.env.DATABASE_URL ?? "file:./racketcoach.db";

const client = createClient({ url });

export const db = drizzle(client, { schema });
export { schema };
