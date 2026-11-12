import type { Db } from "./db";

export async function bootstrapAdmin(db: Db, id: string): Promise<void> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("LOCK TABLE administrators IN EXCLUSIVE MODE");
    const existing = await client.query("SELECT 1 FROM administrators LIMIT 1");
    if (existing.rowCount) throw new Error("Bootstrap requires an empty administrators table; existing access was not changed.");
    await client.query("INSERT INTO administrators(object_id, role) VALUES ($1, 'special_admin')", [id]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
