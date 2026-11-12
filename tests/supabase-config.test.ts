import { PGlite } from "@electric-sql/pglite";
import { createServer } from "pglite-server";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { bootstrapAdmin } from "../server/bootstrap-admin";
import { loadConfig } from "../server/config";

describe("Supabase configuration and bootstrap", () => {
  it("uses a fixed HTTPS project origin for the issuer", () => {
    const env = { DATABASE_URL: "postgresql://localhost/test", SUPABASE_URL: "https://example.supabase.co/" };
    expect(loadConfig(env).issuer).toBe("https://example.supabase.co/auth/v1");
    for (const invalid of ["http://example.test", "https://example.test/path", "https://example.test/?x=1", "https://user:pass@example.test"]) {
      expect(() => loadConfig({ ...env, SUPABASE_URL: invalid })).toThrow();
    }
  });

  it("bootstraps only an empty administrator table and never changes an existing account", async () => {
    const database = new PGlite();
    const server = createServer(database);
    await database.exec("CREATE TABLE administrators (object_id uuid PRIMARY KEY, role text NOT NULL, active boolean NOT NULL DEFAULT true)");
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test server address");
    const pool = new Pool({ host: "127.0.0.1", port: address.port, user: "postgres", database: "postgres", max: 1 });
    const first = "00000000-0000-4000-8000-000000000001";
    try {
      await bootstrapAdmin(pool, first);
      await expect(bootstrapAdmin(pool, first)).rejects.toThrow("empty administrators");
      await expect(bootstrapAdmin(pool, "00000000-0000-4000-8000-000000000002")).rejects.toThrow("empty administrators");
      expect((await pool.query("SELECT object_id,role,active FROM administrators")).rows).toEqual([
        { object_id: first, role: "special_admin", active: true },
      ]);
    } finally {
      await pool.end();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await database.close();
    }
  }, 30000);
});
