import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createServer } from "pglite-server";
import { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../server/app";
import { createSupabaseAuthenticate } from "../server/supabase-auth";
import { generateKeyPair, SignJWT } from "jose";

describe("API against embedded PostgreSQL", () => {
  const database = new PGlite();
  const server = createServer(database);
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  const actor = "00000000-0000-4000-8000-000000000001";

  beforeAll(async () => {
    for (const name of ["001_foundation.sql", "002_operations.sql", "003_finance.sql", "004_notifications.sql", "005_receipts.sql", "006_member_details.sql", "007_admin_constraint.sql", "008_corrections.sql", "009_flight_revisions.sql", "010_opening_balances.sql", "011_flight_sites.sql", "012_admin_notifications.sql", "013_site_validation.sql"]) {
      await database.exec(await readFile(new URL(`../server/migrations/${name}`, import.meta.url), "utf8"));
    }
    await database.query("INSERT INTO administrators(object_id,role) VALUES($1,'admin')", [actor]);
    await database.query("UPDATE accounts SET opening_set=true WHERE id='cash'");
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test server address");
    pool = new Pool({ host: "127.0.0.1", port: address.port, user: "postgres", database: "postgres", max: 1 });
    app = createApp(pool, async () => ({ objectId: actor, role: "admin" }));
  }, 30000);

  afterAll(async () => {
    if (pool) await pool.end();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await database.close();
  });

  it("rolls back a multi-line trade if a later line has insufficient stock", async () => {
    const first = "00000000-0000-4000-8000-000000000010";
    const second = "00000000-0000-4000-8000-000000000011";
    await pool.query("INSERT INTO products(id,name,quantity) VALUES ($1,'First',5),($2,'Second',0)", [first, second]);
    const result = await request(app).post("/api/finance/trades").send({
      businessDate: "2026-11-02", description: "Test", counterparty: "", paymentMethod: "",
      kind: "sale", account: "cash",
      lines: [{ productId: first, quantity: 1, unitPriceCents: 500 }, { productId: second, quantity: 1, unitPriceCents: 500 }],
    });
    expect(result.status).toBe(409);
    expect((await pool.query("SELECT quantity FROM products WHERE id=$1", [first])).rows[0].quantity).toBe("5");
    expect((await pool.query("SELECT id FROM financial_operations")).rows).toHaveLength(0);
    expect((await pool.query("SELECT id FROM stock_movements")).rows).toHaveLength(0);
    expect((await pool.query("SELECT id FROM ledger_entries")).rows).toHaveLength(0);
  }, 30000);

  it("requires and records a one-time opening balance", async () => {
    const body = { kind: "income", account: "bank", amountCents: 500, businessDate: "2026-11-02", description: "Income", counterparty: "", paymentMethod: "" };
    expect((await request(app).post("/api/finance/direct").send(body)).status).toBe(409);
    expect((await pool.query("SELECT id FROM financial_operations WHERE description='Income'")).rows).toHaveLength(0);
    const opening = { amountCents: 1000, businessDate: "2026-11-01", description: "Opening" };
    expect((await request(app).post("/api/accounts/bank/opening").send(opening)).status).toBe(204);
    expect((await request(app).post("/api/accounts/bank/opening").send(opening)).status).toBe(409);
    expect((await request(app).post("/api/finance/direct").send(body)).status).toBe(201);
    const balances = (await request(app).get("/api/accounts")).body;
    expect(balances.find((a: { id: string }) => a.id === "bank").balanceCents).toBe(1500);
  }, 30000);

  it("verifies Supabase JWTs against PostgreSQL administrator access", async () => {
    const issuer = "https://example.supabase.co/auth/v1";
    const keys = await generateKeyPair("RS256");
    const authenticate = createSupabaseAuthenticate(issuer, pool, async () => keys.publicKey);
    const token = (aal: string) => new SignJWT({ role: "authenticated", aal, amr: [{ method: "totp" }] })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" }).setIssuer(issuer).setSubject(actor)
      .setAudience("authenticated").setIssuedAt().setExpirationTime("1h").sign(keys.privateKey);
    expect(await authenticate(`Bearer ${await token("aal2")}`)).toEqual({ objectId: actor, role: "admin" });
    expect(await authenticate(`Bearer ${await token("aal1")}`)).toBeNull();
  }, 30000);

  it("atomically reverses and replaces a sale, rolling back a failed correction", async () => {
    const product = (await request(app).post("/api/products").send({ name: "Wing", initialQuantity: 5, businessDate: "2026-11-01" })).body.id as string;
    const base = { businessDate: "2026-11-02", description: "Wing", counterparty: "", paymentMethod: "cash", kind: "sale", account: "cash" };
    const sale = await request(app).post("/api/finance/trades").send({ ...base, lines: [{ productId: product, quantity: 2, unitPriceCents: 500 }] });
    expect(sale.status).toBe(201);
    const path = `/api/finance/${sale.body.id}/correct`;
    const failed = await request(app).post(path).send({ businessDate: "2026-11-03", reason: "Correction",
      replacement: { ...base, lines: [{ productId: product, quantity: 6, unitPriceCents: 500 }] } });
    expect(failed.status).toBe(409);
    expect((await pool.query("SELECT quantity FROM products WHERE id=$1", [product])).rows[0].quantity).toBe("3");
    expect((await pool.query("SELECT id FROM financial_operations WHERE reverses_id=$1", [sale.body.id])).rows).toHaveLength(0);
    const corrected = await request(app).post(path).send({ businessDate: "2026-11-03", reason: "Correction",
      replacement: { ...base, lines: [{ productId: product, quantity: 3, unitPriceCents: 500 }] } });
    expect(corrected.status).toBe(201);
    expect((await pool.query("SELECT quantity FROM products WHERE id=$1", [product])).rows[0].quantity).toBe("2");
    const linked = await pool.query("SELECT replaces_id FROM financial_operations WHERE id=$1", [corrected.body.replacementId]);
    expect(linked.rows[0].replaces_id).toBe(sale.body.id);
  }, 30000);
});
