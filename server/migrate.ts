import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config";
import { createPool } from "./db";

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const directory = fileURLToPath(new URL("./migrations/", import.meta.url));
  const files = (await readdir(directory)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
  // Every migration is replayed; SQL must be idempotent and preserve its own one-time guards.
  for (const file of files) {
    await client.query(await readFile(new URL(`./migrations/${file}`, import.meta.url), "utf8"));
  }
  await client.query(
    "INSERT INTO administrators (object_id, role) VALUES ($1, 'special_admin') ON CONFLICT (object_id) DO NOTHING",
    [config.BOOTSTRAP_ADMIN_OBJECT_ID],
  );
  await client.query("COMMIT");
  console.log("Foundation migration applied.");
} catch (error) {
  await client.query("ROLLBACK");
  console.error("Migration failed:", error);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
