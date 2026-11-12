import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import EmbeddedPostgres from "embedded-postgres";
import { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../server/app";

const details = { ownerAgreement: "", access: "", launchAltitude: "", launchOrientation: "", windLimits: "",
  hazards: "", restrictedAreas: "", minimumLevel: "", tandem: "unknown", emergencyServices: "", phoneCoverage: "" };
const polygon = [{ latitude: 34, longitude: -5 }, { latitude: 34, longitude: -4.99 },
  { latitude: 34.01, longitude: -4.99 }, { latitude: 34.01, longitude: -5 }];
const signature = [[{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5 }]];

describe("native PostgreSQL concurrency", () => {
  let directory = "";
  let postgres: EmbeddedPostgres | undefined;
  let started = false;
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let specialApp: ReturnType<typeof createApp>;
  const actor = "00000000-0000-4000-8000-000000000001";

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "volubilis-postgres-test-"));
    const portServer = createServer();
    await new Promise<void>((resolve) => portServer.listen(0, "127.0.0.1", resolve));
    const address = portServer.address();
    if (!address || typeof address === "string") throw new Error("Unable to allocate test port");
    const port = address.port;
    await new Promise<void>((resolve, reject) => portServer.close((err) => err ? reject(err) : resolve()));

    postgres = new EmbeddedPostgres({
      databaseDir: join(directory, "data"), port, user: "testuser", password: "local-test-only",
      persistent: true, autoRehydrateSymlinks: true,
      postgresFlags: ["-h", "127.0.0.1"],
      onLog: () => {}, onError: (message) => console.error("Test PostgreSQL:", message),
    });
    await postgres.initialise();
    await postgres.start();
    started = true;
    pool = new Pool({ host: "127.0.0.1", port, user: "testuser", password: "local-test-only", database: "postgres", max: 10 });
    const folder = new URL("../server/migrations/", import.meta.url);
    for (const name of (await readdir(folder)).filter((n) => /^\d+_.+\.sql$/.test(n)).sort()) {
      if (name === "011_flight_sites.sql") {
        await pool.query(`INSERT INTO flight_activities(id,starts_at,site) VALUES('00000000-0000-4000-8000-000000000030',now(),'Legacy');
          INSERT INTO flight_participants(id,activity_id,name,role) VALUES
          ('00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000030','Pilot','pilot'),
          ('00000000-0000-4000-8000-000000000032','00000000-0000-4000-8000-000000000030','Passenger','passenger');
          INSERT INTO tandem_flights(id,activity_id,pilot_id,passenger_id) VALUES
          ('00000000-0000-4000-8000-000000000033','00000000-0000-4000-8000-000000000030',
           '00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000032')`);
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query(await readFile(new URL(name, folder), "utf8"));
          await client.query("ROLLBACK");
        } finally { client.release(); }
        expect((await pool.query("SELECT id FROM flight_activities")).rowCount).toBe(1);
      }
      await pool.query(await readFile(new URL(name, folder), "utf8"));
    }
    expect((await pool.query("SELECT id FROM flight_activities")).rowCount).toBe(0);
    expect((await pool.query("SELECT id FROM flight_participants")).rowCount).toBe(0);
    expect((await pool.query("SELECT id FROM tandem_flights")).rowCount).toBe(0);
    await pool.query("INSERT INTO administrators(object_id,role) VALUES($1,'admin')", [actor]);
    await pool.query("INSERT INTO administrator_site_permissions(administrator_id,site_team,security_manager) VALUES($1,true,true)", [actor]);
    await pool.query("UPDATE accounts SET opening_set=true");
    app = createApp(pool, async () => ({ objectId: actor, role: "admin" }));
    specialApp = createApp(pool, async () => ({ objectId: actor, role: "special_admin" }));
  }, 120_000);

  afterAll(async () => {
    if (pool) await pool.end();
    if (started && postgres) await postgres.stop();
    if (directory) await rm(directory, { recursive: true, force: true });
  }, 60_000);

  it("allows only one concurrent sale of the last item", async () => {
    const product = await request(app).post("/api/products")
      .send({ name: "One helmet", initialQuantity: 1, businessDate: "2026-01-01" });
    expect(product.status).toBe(201);
    const sale = { businessDate: "2026-01-01", description: "Sale", counterparty: "", paymentMethod: "",
      kind: "sale", account: "cash", lines: [{ productId: product.body.id, quantity: 1, unitPriceCents: 500 }] };
    const results = await Promise.all([
      request(app).post("/api/finance/trades").send(sale),
      request(app).post("/api/finance/trades").send(sale),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    const stock = await pool.query("SELECT quantity FROM products WHERE id=$1", [product.body.id]);
    expect(stock.rows[0].quantity).toBe("0");
    expect((await pool.query("SELECT id FROM financial_operations WHERE kind='sale'")).rowCount).toBe(1);
    expect((await pool.query("SELECT id FROM ledger_entries")).rowCount).toBe(1);
  });

  it("allows only one concurrent open equipment loan", async () => {
    const item = await request(app).post("/api/equipment").send({
      identifier: "CONCURRENT-1", designation: "Glider", makeModel: "", sizeRating: "",
      acquiredOn: null, lastInspectionOn: null, reserveRepackedOn: null, condition: "Good",
    });
    expect(item.status).toBe(201);
    const loan = { equipmentId: item.body.id, borrowerName: "Pilot", memberId: null,
      loanedOn: "2026-01-01", expectedReturnOn: null, conditionOut: "Good" };
    const results = await Promise.all([
      request(app).post("/api/loans").send(loan),
      request(app).post("/api/loans").send(loan),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect((await pool.query("SELECT id FROM equipment_loans WHERE equipment_id=$1 AND returned_on IS NULL", [item.body.id])).rowCount).toBe(1);
  });

  it("allows only one concurrent correction of an operation", async () => {
    const original = {
      kind: "income", account: "cash", amountCents: 500, businessDate: "2026-01-01",
      description: "Concurrent correction", counterparty: "", paymentMethod: "",
    };
    const income = await request(app).post("/api/finance/direct").send(original);
    expect(income.status).toBe(201);
    const correction = {
      businessDate: "2026-01-02", reason: "Correction",
      replacement: { ...original, amountCents: 700 },
    };
    const results = await Promise.all([
      request(app).post(`/api/finance/${income.body.id}/correct`).send(correction),
      request(app).post(`/api/finance/${income.body.id}/correct`).send(correction),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    const reversal = await pool.query("SELECT id FROM financial_operations WHERE reverses_id=$1", [income.body.id]);
    const replacement = await pool.query("SELECT id FROM financial_operations WHERE replaces_id=$1", [income.body.id]);
    expect(reversal.rowCount).toBe(1);
    expect(replacement.rowCount).toBe(1);
    const entries = await pool.query(
      "SELECT sum(amount_cents) AS total FROM ledger_entries WHERE operation_id = ANY($1::uuid[])",
      [[income.body.id, reversal.rows[0].id, replacement.rows[0].id]],
    );
    expect(entries.rows[0].total).toBe("700");
  });

  it("assigns distinct receipt numbers to concurrent income operations", async () => {
    const income = {
      kind: "income", account: "cash", amountCents: 100, businessDate: "2026-01-01",
      description: "Concurrent receipts", counterparty: "", paymentMethod: "",
    };
    const results = await Promise.all(
      Array.from({ length: 5 }, () => request(app).post("/api/finance/direct").send(income)),
    );
    expect(results.map((result) => result.status)).toEqual([201, 201, 201, 201, 201]);
    const receipts = await pool.query<{ number: string }>(
      "SELECT number FROM receipts WHERE operation_id = ANY($1::uuid[])",
      [results.map((result) => result.body.id)],
    );
    expect(receipts.rowCount).toBe(5);
    expect(new Set(receipts.rows.map((receipt) => receipt.number)).size).toBe(5);
  });

  it("validates sites, flight finalization, notes and migration reruns", async () => {
    const landingId = "00000000-0000-4000-8000-000000000022";
    const site = { name: "Test site", latitude: 34.1, longitude: -5.2, municipality: "",
      status: "open", windDirections: ["N", "NE"], details, landings: [{ id: landingId, name: "Landing", type: "primary", polygon }] };
    expect((await request(app).post("/api/sites").send({ ...site, latitude: 91 })).status).toBe(400);
    const created = await request(app).post("/api/sites").send(site);
    expect(created.status).toBe(201);
    const siteId = created.body.id;
    expect((await request(app).post(`/api/sites/${siteId}/validate`).send({ expectedRevision: 1, validated: true, signature })).status).toBe(204);
    expect((await request(app).post(`/api/sites/${siteId}/archive`)).status).toBe(403);
    const flight = { startsAt: "2026-11-11T09:30:00+00:00", siteId, status: "planned",
      notes: "Original", participants: [], tandemFlights: [] };
    const saved = await request(app).post("/api/flights").send(flight);
    expect(saved.status).toBe(201);
    const id = saved.body.id;
    const migration = await readFile(new URL("../server/migrations/011_flight_sites.sql", import.meta.url), "utf8");
    await pool.query(migration);
    expect((await pool.query("SELECT id FROM flight_activities WHERE id=$1", [id])).rowCount).toBe(1);
    expect((await request(app).put(`/api/sites/${siteId}`).send({ ...site, status: "closed", expectedRevision: 2 })).status).toBe(200);
    expect((await request(app).put(`/api/flights/${id}`).send({ ...flight, expectedRevision: 1 })).status).toBe(409);
    expect((await request(app).put(`/api/sites/${siteId}`).send({ ...site, name: "Renamed", expectedRevision: 3 })).status).toBe(200);
    expect((await request(app).post(`/api/sites/${siteId}/validate`).send({ expectedRevision: 4, validated: true, signature })).status).toBe(204);
    const transitions = await Promise.all([
      request(app).put(`/api/flights/${id}`).send({ ...flight, status: "done", expectedRevision: 1 }),
      request(app).put(`/api/flights/${id}`).send({ ...flight, status: "cancelled", expectedRevision: 1 }),
    ]);
    expect(transitions.map((response) => response.status).sort()).toEqual([200, 409]);
    expect((await request(app).put(`/api/flights/${id}`).send({ ...flight, expectedRevision: 2 })).status).toBe(409);
    expect((await request(app).post(`/api/flights/${id}/notes`).send({ body: "Additional" })).status).toBe(201);
    expect((await request(app).put(`/api/sites/${siteId}`).send({ ...site, name: "Renamed", landings: [], expectedRevision: 5 })).status).toBe(200);
    expect((await request(specialApp).post(`/api/sites/${siteId}/archive`)).status).toBe(204);
    const listed = (await request(app).get("/api/flights")).body.find((item: { id: string }) => item.id === id);
    expect(listed.site).toBe("Renamed");
    expect(listed.additionalNotes[0].body).toBe("Additional");
    expect((await pool.query("SELECT removed_at FROM site_landings WHERE id=$1", [landingId])).rows[0].removed_at).not.toBeNull();
  });

  it("preserves legacy landings and enforces site permissions and revision-bound validation", async () => {
    const user = "00000000-0000-4000-8000-000000000050";
    const siteId = "00000000-0000-4000-8000-000000000051";
    const landingId = "00000000-0000-4000-8000-000000000052";
    await pool.query("INSERT INTO administrators(object_id,role) VALUES($1,'admin')", [user]);
    await pool.query("INSERT INTO flight_sites(id,name,latitude,longitude) VALUES($1,'Legacy',34,-5)", [siteId]);
    await pool.query("INSERT INTO site_landings(id,site_id,name,latitude,longitude) VALUES($1,$2,'Old landing',34,-5)", [landingId, siteId]);
    const migration = await readFile(new URL("../server/migrations/013_site_validation.sql", import.meta.url), "utf8");
    await pool.query(migration);
    expect((await pool.query("SELECT polygon,latitude FROM site_landings WHERE id=$1", [landingId])).rows[0]).toMatchObject({ polygon: null, latitude: "34.0000000" });
    const restricted = createApp(pool, async () => ({ objectId: user, role: "admin" }));
    const site = { name: "Legacy", latitude: 34, longitude: -5, municipality: "", status: "open", windDirections: [],
      details, landings: [{ id: landingId, name: "Old landing", type: "emergency", polygon }] };
    const flight = { startsAt: "2026-11-11T09:30:00+00:00", siteId, status: "planned", notes: "", participants: [], tandemFlights: [] };
    const validation = { expectedRevision: 1, validated: true, signature };
    expect((await request(restricted).put(`/api/sites/${siteId}`).send({ ...site, expectedRevision: 1 })).status).toBe(403);
    expect((await request(restricted).post(`/api/sites/${siteId}/validate`).send(validation)).status).toBe(403);
    expect((await request(restricted).post("/api/flights").send(flight)).status).toBe(409);
    expect((await request(specialApp).put(`/api/administrators/${user}/site-permissions`).send({ siteTeam: true, securityManager: false })).status).toBe(200);
    expect((await request(restricted).post(`/api/sites/${siteId}/validate`).send(validation)).status).toBe(403);
    expect((await request(app).post(`/api/sites/${siteId}/validate`).send(validation)).status).toBe(409);
    expect((await request(restricted).put(`/api/sites/${siteId}`).send({ ...site, landings: [{ ...site.landings[0], polygon: null }], expectedRevision: 1 })).status).toBe(400);
    expect((await request(restricted).put(`/api/sites/${siteId}`).send({ ...site, landings: [{ ...site.landings[0], polygon: [polygon[0], polygon[2], polygon[1], polygon[3]] }], expectedRevision: 1 })).status).toBe(400);
    expect((await request(restricted).put(`/api/sites/${siteId}`).send({ ...site, expectedRevision: 1 })).status).toBe(200);
    expect((await request(app).post(`/api/sites/${siteId}/validate`).send(validation)).status).toBe(409);
    expect((await request(specialApp).put(`/api/administrators/${user}/site-permissions`).send({ siteTeam: true, securityManager: true })).status).toBe(200);
    expect((await request(restricted).post(`/api/sites/${siteId}/validate`).send({ expectedRevision: 2, validated: true, signature: [] })).status).toBe(400);
    const results = await Promise.all([
      request(restricted).post(`/api/sites/${siteId}/validate`).send({ ...validation, expectedRevision: 2 }),
      request(restricted).put(`/api/sites/${siteId}`).send({ ...site, name: "Changed", expectedRevision: 2 }),
    ]);
    expect(results.map((result) => result.status).filter((status) => status === 409)).toHaveLength(1);
    expect(results.map((result) => result.status).filter((status) => status === 200 || status === 204)).toHaveLength(1);
    const current = (await pool.query("SELECT revision,validated_at FROM flight_sites WHERE id=$1", [siteId])).rows[0];
    if (!current.validated_at) expect((await request(restricted).post(`/api/sites/${siteId}/validate`).send({ ...validation, expectedRevision: current.revision })).status).toBe(204);
    expect((await request(restricted).post("/api/flights").send(flight)).status).toBe(201);
    const saved = (await request(restricted).get("/api/sites")).body.find((item: { id: string }) => item.id === siteId);
    const noOp = { ...site, name: saved.name, expectedRevision: saved.revision };
    expect((await request(restricted).put(`/api/sites/${siteId}`).send(noOp)).status).toBe(200);
    expect((await pool.query("SELECT validated_at FROM flight_sites WHERE id=$1", [siteId])).rows[0].validated_at).not.toBeNull();
    expect((await request(restricted).put(`/api/sites/${siteId}`).send({ ...noOp, name: "Edited" })).status).toBe(200);
    expect((await pool.query("SELECT validated_at,signature FROM flight_sites WHERE id=$1", [siteId])).rows[0]).toEqual({ validated_at: null, signature: null });
    expect((await request(restricted).post("/api/flights").send(flight)).status).toBe(409);
    const empty = await request(restricted).post("/api/sites").send({ ...site, name: "Empty", landings: [] });
    expect(empty.status).toBe(201);
    expect((await request(restricted).post(`/api/sites/${empty.body.id}/validate`).send(validation)).status).toBe(409);
    expect((await request(restricted).get("/api/members")).status).toBe(200);
  });

  it("queues event notifications for administrator contacts and safely dispatches opted-in recipients", async () => {
    const sent: string[] = [];
    const provider = {
      templates: [{ id: "event", label: "Event", contentSid: "HX00000000000000000000000000000000" }],
      callbackUrl: (id: string) => `https://example.test/api/whatsapp/callback/${id}`,
      verify: () => true,
      send: async (phone: string) => { sent.push(phone); return { sid: `SM${"0".repeat(32)}` }; },
    };
    const adminApp = createApp(pool, async () => ({ objectId: actor, role: "special_admin" }), provider);
    const ordinaryApp = createApp(pool, async () => ({ objectId: actor, role: "admin" }), provider);
    const ids = Array.from({ length: 7 }, (_, i) => `00000000-0000-4000-8000-${String(i + 100).padStart(12, "0")}`);
    for (const id of ids) await pool.query("INSERT INTO administrators(object_id,role) VALUES($1,'admin')", [id]);
    expect((await request(ordinaryApp).get("/api/whatsapp/event-settings")).status).toBe(403);
    expect((await request(ordinaryApp).put("/api/whatsapp/event-settings/gear_added").send({ enabled: true, templateId: "event" })).status).toBe(403);
    expect((await request(ordinaryApp).put(`/api/whatsapp/admin-contacts/${ids[0]}`)
      .send({ phone: "+212600000000", optedIn: true, evidence: "Test consent" })).status).toBe(403);
    for (let i = 0; i < ids.length; i++) {
      const result = await request(adminApp).put(`/api/whatsapp/admin-contacts/${ids[i]}`)
        .send({ phone: `+2126000000${String(i).padStart(2, "0")}`, optedIn: i !== 6, evidence: "Test consent" });
      expect(result.status).toBe(204);
    }
    for (const event of ["flight_planned", "goods_trade", "gear_added", "gear_removed", "financial_operation"]) {
      expect((await request(adminApp).put(`/api/whatsapp/event-settings/${event}`).send({ enabled: true, templateId: "event" })).status).toBe(204);
    }
    const equipment = await request(adminApp).post("/api/equipment").send({ identifier: "EVENT-GEAR", designation: "Gear",
      makeModel: "", sizeRating: "", acquiredOn: null, lastInspectionOn: null, reserveRepackedOn: null, condition: "Good" });
    expect(equipment.status).toBe(201);
    const batch = await pool.query<{ id: string }>("SELECT id FROM notification_batches WHERE event='gear_added' AND source_id=$1", [equipment.body.id]);
    expect(batch.rowCount).toBe(1);
    const recipients = await pool.query<{ state: string }>("SELECT state FROM notification_recipients WHERE batch_id=$1", [batch.rows[0].id]);
    expect(recipients.rows.filter((r) => r.state === "queued")).toHaveLength(6);
    expect(recipients.rows.filter((r) => r.state === "excluded")).toHaveLength(1);
    const migration = await readFile(new URL("../server/migrations/012_admin_notifications.sql", import.meta.url), "utf8");
    await pool.query(migration);
    expect((await pool.query("SELECT enabled FROM notification_event_settings WHERE event='gear_added'")).rows[0].enabled).toBe(true);
    expect((await pool.query("SELECT id FROM notification_recipients WHERE batch_id=$1", [batch.rows[0].id])).rowCount).toBe(7);
    await expect(pool.query("INSERT INTO notification_recipients(id,batch_id,phone,state) VALUES(gen_random_uuid(),$1,'+212600000000','queued')", [batch.rows[0].id])).rejects.toThrow();
    expect(sent).toHaveLength(0);
    await request(adminApp).put(`/api/whatsapp/admin-contacts/${ids[0]}`)
      .send({ phone: "+212600000000", optedIn: false, evidence: "Withdrawn" });
    expect((await request(adminApp).post(`/api/whatsapp/batches/${batch.rows[0].id}/dispatch`)).status).toBe(204);
    expect(sent).toHaveLength(5);
    expect((await request(adminApp).post(`/api/equipment/${equipment.body.id}/archive`)).status).toBe(204);
    expect((await pool.query("SELECT id FROM notification_batches WHERE event='gear_removed' AND source_id=$1", [equipment.body.id])).rowCount).toBe(1);
    const income = await request(adminApp).post("/api/finance/direct").send({ kind: "income", account: "cash",
      amountCents: 500, businessDate: "2026-01-01", description: "Test", counterparty: "", paymentMethod: "" });
    expect(income.status).toBe(201);
    expect((await pool.query("SELECT id FROM notification_batches WHERE event='financial_operation' AND source_id=$1", [income.body.id])).rowCount).toBe(1);
    const product = await request(adminApp).post("/api/products").send({ name: "Event item", initialQuantity: 0, businessDate: "2026-01-01" });
    const trade = { kind: "sale", account: "cash", businessDate: "2026-01-01", description: "Test", counterparty: "", paymentMethod: "",
      lines: [{ productId: product.body.id, quantity: 1, unitPriceCents: 100 }] };
    const before = (await pool.query("SELECT id FROM notification_batches WHERE event='goods_trade'")).rowCount;
    expect((await request(adminApp).post("/api/finance/trades").send(trade)).status).toBe(409);
    expect((await pool.query("SELECT id FROM notification_batches WHERE event='goods_trade'")).rowCount).toBe(before);
    const purchase = await request(adminApp).post("/api/finance/trades").send({ ...trade, kind: "purchase" });
    expect(purchase.status).toBe(201);
    expect((await pool.query("SELECT id FROM notification_batches WHERE event='goods_trade' AND source_id=$1", [purchase.body.id])).rowCount).toBe(1);
    expect((await pool.query("SELECT id FROM notification_batches WHERE event='financial_operation' AND source_id=$1", [purchase.body.id])).rowCount).toBe(0);
    expect((await request(adminApp).put("/api/whatsapp/event-settings/goods_trade").send({ enabled: false, templateId: "event" })).status).toBe(204);
    const fallbackPurchase = await request(adminApp).post("/api/finance/trades").send({ ...trade, kind: "purchase" });
    expect(fallbackPurchase.status).toBe(201);
    expect((await pool.query("SELECT event FROM notification_batches WHERE source_id=$1", [fallbackPurchase.body.id])).rows).toEqual([{ event: "financial_operation" }]);
    const site = await request(adminApp).post("/api/sites").send({ name: "Event site", latitude: 34, longitude: -5, municipality: "",
      status: "open", windDirections: [], details, landings: [{ id: "00000000-0000-4000-8000-000000000023", name: "Zone", type: "primary", polygon }] });
    expect((await request(adminApp).post(`/api/sites/${site.body.id}/validate`).send({ expectedRevision: 1, validated: true, signature })).status).toBe(204);
    const flight = await request(adminApp).post("/api/flights").send({ startsAt: "2026-11-11T09:30:00+00:00", siteId: site.body.id,
      status: "planned", notes: "", participants: [], tandemFlights: [] });
    expect(flight.status).toBe(201);
    expect((await pool.query("SELECT id FROM notification_batches WHERE event='flight_planned' AND source_id=$1", [flight.body.id])).rowCount).toBe(1);
  });
});
