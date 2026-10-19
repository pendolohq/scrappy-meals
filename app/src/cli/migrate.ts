// Applies pending migrations. Runs on every container start before the server.
import path from "node:path";

import { runMigrations } from "../server/db/migrate";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL must be set");
  process.exit(1);
}
const folder =
  process.env.MIGRATIONS_DIR ?? path.join(process.cwd(), "drizzle");

runMigrations(url, folder).then(
  () => console.log("migrations: up to date"),
  (err) => {
    console.error("migrations failed:", err);
    process.exit(1);
  }
);
