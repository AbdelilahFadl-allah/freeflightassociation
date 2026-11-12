import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createPool } from "./db";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool = createPool(process.env.DATABASE_URL);
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const directory = fileURLToPath(new URL("./migrations/", import.meta.url));
  const files = (await readdir(directory)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
  // Every migration is replayed; SQL must be idempotent and preserve its own one-time guards.
  for (const file of files) {
    await client.query(await readFile(new URL(`./migrations/${file}`, import.meta.url), "utf8"));
  }
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
