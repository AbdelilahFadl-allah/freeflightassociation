import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { newDb } from "pg-mem";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app";
import type { Authenticate } from "../server/auth";
import type { WhatsAppProvider } from "../server/whatsapp";

const ordinary = "00000000-0000-4000-8000-000000000001";
const special = "00000000-0000-4000-8000-000000000002";
const authenticate: Authenticate = async (header) => {
  if (header === "Bearer admin") return { objectId: ordinary, role: "admin" };
  if (header === "Bearer special") return { objectId: special, role: "special_admin" };
  return null;
};

describe("member API", () => {
  let app: ReturnType<typeof createApp>;
  let pool: InstanceType<ReturnType<ReturnType<typeof newDb>["adapters"]["createPg"]>["Pool"]>;
  beforeEach(async () => {
    const memory = newDb();
    const pg = memory.adapters.createPg();
    pool = new pg.Pool();
    const sql = await readFile(fileURLToPath(new URL("../server/migrations/001_foundation.sql", import.meta.url)), "utf8");
    await pool.query(sql);
    await pool.query(await readFile(fileURLToPath(new URL("../server/migrations/002_operations.sql", import.meta.url)), "utf8"));
    await pool.query(await readFile(fileURLToPath(new URL("../server/migrations/003_finance.sql", import.meta.url)), "utf8"));
    await pool.query(await readFile(fileURLToPath(new URL("../server/migrations/004_notifications.sql", import.meta.url)), "utf8"));
    await pool.query(await readFile(fileURLToPath(new URL("../server/migrations/005_receipts.sql", import.meta.url)), "utf8"));
    await pool.query(await readFile(fileURLToPath(new URL("../server/migrations/006_member_details.sql", import.meta.url)), "utf8"));
    await pool.query(await readFile(fileURLToPath(new URL("../server/migrations/007_admin_constraint.sql", import.meta.url)), "utf8"));
    await pool.query(await readFile(fileURLToPath(new URL("../server/migrations/008_corrections.sql", import.meta.url)), "utf8"));
    await pool.query(await readFile(fileURLToPath(new URL("../server/migrations/009_flight_revisions.sql", import.meta.url)), "utf8"));
    await pool.query(await readFile(fileURLToPath(new URL("../server/migrations/010_opening_balances.sql", import.meta.url)), "utf8"));
    await pool.query(`CREATE TABLE flight_sites (id uuid PRIMARY KEY, name text NOT NULL, status text NOT NULL, archived_at timestamptz, validated_at timestamptz);
      CREATE TABLE administrator_site_permissions(administrator_id uuid PRIMARY KEY, site_team boolean NOT NULL DEFAULT false,security_manager boolean NOT NULL DEFAULT false);
      ALTER TABLE flight_activities ADD COLUMN site_id uuid REFERENCES flight_sites(id);
      ALTER TABLE flight_activities ADD COLUMN status text NOT NULL DEFAULT 'planned';
      CREATE TABLE flight_notes (id uuid PRIMARY KEY, flight_id uuid NOT NULL REFERENCES flight_activities(id),
        author_id uuid NOT NULL REFERENCES administrators(object_id), body text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`);
    await pool.query(`CREATE TABLE notification_event_settings(event text PRIMARY KEY,enabled boolean NOT NULL,template_id text NOT NULL);
      ALTER TABLE notification_batches ADD COLUMN event text;
      ALTER TABLE notification_batches ADD COLUMN source_id uuid;
      ALTER TABLE notification_recipients ADD COLUMN administrator_id uuid REFERENCES administrators(object_id);
      CREATE TABLE admin_whatsapp_contacts(administrator_id uuid PRIMARY KEY,phone text,opted_in boolean,evidence text)`);
    await pool.query("INSERT INTO administrators(object_id, role) VALUES ($1,'admin'),($2,'special_admin')", [ordinary, special]);
    await pool.query("UPDATE accounts SET opening_set=true");
    app = createApp(pool, authenticate);
  });

  it("denies unauthenticated access and validates input", async () => {
    expect((await request(app).get("/api/members")).status).toBe(401);
    expect((await request(app).post("/api/members").set("Authorization", "Bearer admin").send({ firstName: "" })).status).toBe(400);
    expect((await pool.query("SELECT * FROM members")).rows).toHaveLength(0);
  });

  it("creates and deactivates a member, recording both changes", async () => {
    const member = { firstName: "Amina", lastName: "Test", phone: null, email: null, active: true };
    const created = await request(app).post("/api/members").set("Authorization", "Bearer admin").send(member);
    expect(created.status).toBe(201);
    const updated = await request(app).put(`/api/members/${created.body.id}`).set("Authorization", "Bearer admin").send({ ...member, active: false });
    expect(updated.status).toBe(200);
    const list = await request(app).get("/api/members").set("Authorization", "Bearer admin");
    expect(list.body).toHaveLength(1);
    expect(list.body[0].active).toBe(false);
    const audit = await pool.query("SELECT action, details FROM audit_events ORDER BY id");
    expect(audit.rows.map((row: { action: string }) => row.action)).toEqual(["create", "update"]);
    expect(audit.rows[1].details.before.active).toBe(true);
    expect(audit.rows[1].details.after.active).toBe(false);
  });

  it("only lets the special admin archive and preserves the record and audit", async () => {
    const created = await request(app).post("/api/members").set("Authorization", "Bearer admin")
      .send({ firstName: "Amina", lastName: "Test", phone: null, email: null, active: true });
    const url = `/api/members/${created.body.id}/archive`;
    expect((await request(app).post(url).set("Authorization", "Bearer admin")).status).toBe(403);
    expect((await request(app).post(url).set("Authorization", "Bearer special")).status).toBe(204);
    expect((await request(app).get("/api/members").set("Authorization", "Bearer admin")).body).toHaveLength(0);
    expect((await pool.query("SELECT id FROM members")).rows).toHaveLength(1);
    expect((await pool.query("SELECT id FROM audit_events")).rows).toHaveLength(2);
  });

  it("limits administrator access management to the special admin", async () => {
    const newId = "00000000-0000-4000-8000-000000000003";
    expect((await request(app).get("/api/administrators").set("Authorization", "Bearer admin")).status).toBe(403);
    expect((await request(app).get("/api/audit").set("Authorization", "Bearer admin")).status).toBe(403);
    expect((await request(app).put(`/api/administrators/${newId}`).set("Authorization", "Bearer admin").send({ active: true })).status).toBe(403);
    expect((await request(app).put(`/api/administrators/${special}`).set("Authorization", "Bearer special").send({ active: false })).status).toBe(409);
    expect((await request(app).put(`/api/administrators/${newId}`).set("Authorization", "Bearer special").send({ active: true })).status).toBe(200);
    expect((await request(app).put(`/api/administrators/${newId}`).set("Authorization", "Bearer special").send({ active: false })).status).toBe(200);
    const result = await request(app).get("/api/administrators").set("Authorization", "Bearer special");
    expect(result.body.find((item: { objectId: string }) => item.objectId === newId).active).toBe(false);
    expect((await pool.query("SELECT action FROM audit_events")).rows).toHaveLength(2);
    expect((await request(app).get("/api/audit").set("Authorization", "Bearer special")).body).toHaveLength(2);
  });

  it("records flight roles and validates tandem pairs", async () => {
    const pilot = "00000000-0000-4000-8000-000000000011";
    const passenger = "00000000-0000-4000-8000-000000000012";
    const siteId = "00000000-0000-4000-8000-000000000015";
    await pool.query("INSERT INTO flight_sites(id,name,status,validated_at) VALUES($1,'Zerhoun','open',now())", [siteId]);
    const data = {
      startsAt: "2026-11-11T09:30:00+00:00", siteId, status: "planned", notes: "",
      participants: [{ id: pilot, memberId: null, name: "Pilot", role: "pilot" }, { id: passenger, memberId: null, name: "Passenger", role: "passenger" }],
      tandemFlights: [{ pilotId: pilot, passengerId: passenger, durationMinutes: 15, passengerFormCompleted: true, receiptReference: null, observations: "" }],
    };
    const created = await request(app).post("/api/flights").set("Authorization", "Bearer admin").send(data);
    expect(created.status).toBe(201);
    const result = await request(app).get("/api/flights").set("Authorization", "Bearer admin");
    expect(result.body[0].participants).toHaveLength(2);
    expect(result.body[0].tandemFlights[0].passengerFormCompleted).toBe(true);
    const invalid = { ...data, tandemFlights: [{ ...data.tandemFlights[0], pilotId: passenger }] };
    expect((await request(app).post("/api/flights").set("Authorization", "Bearer admin").send(invalid)).status).toBe(400);
    expect((await request(app).post("/api/flights").set("Authorization", "Bearer admin").send({ ...data, startsAt: "2026-11-11T09:30:00+01:00" })).status).toBe(400);
    const newPilot = "00000000-0000-4000-8000-000000000013";
    const newPassenger = "00000000-0000-4000-8000-000000000014";
    const changed = { ...data, expectedRevision: 1,
      participants: [{ ...data.participants[0], id: newPilot }, { ...data.participants[1], id: newPassenger }],
      tandemFlights: [{ ...data.tandemFlights[0], pilotId: newPilot, passengerId: newPassenger }] };
    expect((await request(app).put(`/api/flights/${created.body.id}`).set("Authorization", "Bearer admin").send(changed)).status).toBe(200);
    expect((await request(app).put(`/api/flights/${created.body.id}`).set("Authorization", "Bearer admin").send(changed)).status).toBe(409);
    const after = await request(app).get("/api/flights").set("Authorization", "Bearer admin");
    expect(after.body[0].revision).toBe(2);
    expect(after.body[0].participants).toHaveLength(2);
    expect((await pool.query("SELECT id FROM flight_participants")).rows).toHaveLength(4);
  });

  it("prevents overlapping equipment loans and records returns", async () => {
    const item = await request(app).post("/api/equipment").set("Authorization", "Bearer admin").send({
      identifier: "GL-01", designation: "Glider", makeModel: "", sizeRating: "",
      acquiredOn: null, lastInspectionOn: null, reserveRepackedOn: null, condition: "Good",
    });
    expect(item.status).toBe(201);
    const body = { equipmentId: item.body.id, borrowerName: "Pilot", memberId: null, loanedOn: "2026-11-01", expectedReturnOn: "2026-11-05", conditionOut: "Good" };
    const first = await request(app).post("/api/loans").set("Authorization", "Bearer admin").send(body);
    expect(first.status).toBe(201);
    expect((await request(app).post("/api/loans").set("Authorization", "Bearer admin").send(body)).status).toBe(409);
    expect((await request(app).post(`/api/loans/${first.body.id}/return`).set("Authorization", "Bearer admin")
      .send({ returnedOn: "2026-10-31", conditionIn: "Good" })).status).toBe(400);
    expect((await request(app).post(`/api/loans/${first.body.id}/return`).set("Authorization", "Bearer admin")
      .send({ returnedOn: "2026-11-04", conditionIn: "Good" })).status).toBe(204);
    expect((await request(app).post("/api/loans").set("Authorization", "Bearer admin").send(body)).status).toBe(201);
  });

  it("records paid trades, transfers and reversal entries", async () => {
    const product = await request(app).post("/api/products").set("Authorization", "Bearer admin")
      .send({ name: "Helmet", initialQuantity: 3, businessDate: "2026-11-01" });
    expect(product.status).toBe(201);
    const base = { businessDate: "2026-11-02", description: "Helmets", counterparty: "A", paymentMethod: "Cash" };
    const sale = await request(app).post("/api/finance/trades").set("Authorization", "Bearer admin").send({
      ...base, kind: "sale", account: "cash", lines: [{ productId: product.body.id, quantity: 2, unitPriceCents: 15000 }],
    });
    expect(sale.status).toBe(201);
    const receipts = await request(app).get("/api/receipts").set("Authorization", "Bearer admin");
    expect(receipts.body).toHaveLength(1);
    expect(receipts.body[0].number).toBe("1");
    expect(receipts.body[0].amountCents).toBe(30000);
    expect((await request(app).get("/api/products").set("Authorization", "Bearer admin")).body[0].quantity).toBe(1);
    const transfer = await request(app).post("/api/finance/transfers").set("Authorization", "Bearer admin")
      .send({ ...base, from: "cash", to: "bank", amountCents: 10000 });
    expect(transfer.status).toBe(201);
    let balances = (await request(app).get("/api/accounts").set("Authorization", "Bearer admin")).body;
    expect(balances.find((a: { id: string }) => a.id === "cash").balanceCents).toBe(20000);
    expect(balances.find((a: { id: string }) => a.id === "bank").balanceCents).toBe(10000);
    expect((await request(app).post(`/api/finance/${sale.body.id}/reverse`).set("Authorization", "Bearer admin")
      .send({ businessDate: "2026-11-03", reason: "Correction" })).status).toBe(201);
    expect((await request(app).get("/api/products").set("Authorization", "Bearer admin")).body[0].quantity).toBe(3);
    balances = (await request(app).get("/api/accounts").set("Authorization", "Bearer admin")).body;
    expect(balances.find((a: { id: string }) => a.id === "cash").balanceCents).toBe(-10000);
    expect((await request(app).post(`/api/finance/${sale.body.id}/reverse`).set("Authorization", "Bearer admin")
      .send({ businessDate: "2026-11-03", reason: "Again" })).status).toBe(409);
  });

  it("rejects sales exceeding stock and same-account transfers", async () => {
    const product = await request(app).post("/api/products").set("Authorization", "Bearer admin")
      .send({ name: "Gloves", initialQuantity: 1, businessDate: "2026-11-01" });
    const base = { businessDate: "2026-11-02", description: "Test", counterparty: "", paymentMethod: "" };
    expect((await request(app).post("/api/finance/trades").set("Authorization", "Bearer admin").send({
      ...base, kind: "sale", account: "cash", lines: [{ productId: product.body.id, quantity: 2, unitPriceCents: 100 }],
    })).status).toBe(409);
    expect((await request(app).post("/api/finance/transfers").set("Authorization", "Bearer admin")
      .send({ ...base, from: "cash", to: "cash", amountCents: 100 })).status).toBe(400);
    expect((await request(app).get("/api/products").set("Authorization", "Bearer admin")).body[0].quantity).toBe(1);
  });

  it("excludes unconsented recipients and processes signed delivery callbacks", async () => {
    const sent: string[] = [];
    const provider: WhatsAppProvider = {
      templates: [{ id: "notice", label: "Notice", contentSid: "HX00000000000000000000000000000000" }],
      callbackUrl: (id) => `https://example.test/api/whatsapp/callback/${id}`,
      verify: (signature) => signature === "valid",
      send: async (phone) => { sent.push(phone); return { sid: "SM00000000000000000000000000000000" }; },
    };
    app = createApp(pool, authenticate, provider);
    async function member(name: string) {
      return (await request(app).post("/api/members").set("Authorization", "Bearer admin")
        .send({ firstName: name, lastName: "Test", phone: "+212612345678", email: null, active: true })).body.id as string;
    }
    const optedIn = await member("Opted");
    const notOpted = await member("Unconsented");
    expect((await request(app).put(`/api/whatsapp/consents/${optedIn}`).set("Authorization", "Bearer admin")
      .send({ optedIn: true, evidence: "Signed form" })).status).toBe(204);
    const batch = await request(app).post("/api/whatsapp/batches").set("Authorization", "Bearer admin")
      .send({ templateId: "notice", memberIds: [optedIn, notOpted] });
    expect(batch.status).toBe(201);
    expect((await request(app).post(`/api/whatsapp/batches/${batch.body.id}/dispatch`).set("Authorization", "Bearer admin").send({})).status).toBe(204);
    expect(sent).toEqual(["+212612345678"]);
    let list = (await request(app).get("/api/whatsapp/batches").set("Authorization", "Bearer admin")).body;
    expect(list[0].recipients.map((r: { state: string }) => r.state).sort()).toEqual(["excluded", "submitted"]);
    const delivered = list[0].recipients.find((r: { memberId: string }) => r.memberId === optedIn);
    const callback = `/api/whatsapp/callback/${delivered.id}`;
    expect((await request(app).post(callback).type("form").send({ MessageSid: "SM00000000000000000000000000000000", MessageStatus: "delivered" })).status).toBe(403);
    expect((await request(app).post(callback).set("X-Twilio-Signature", "valid").type("form")
      .send({ MessageSid: "SM00000000000000000000000000000000", MessageStatus: "delivered" })).status).toBe(204);
    list = (await request(app).get("/api/whatsapp/batches").set("Authorization", "Bearer admin")).body;
    expect(list[0].recipients.find((r: { memberId: string }) => r.memberId === optedIn).state).toBe("delivered");
    const second = await request(app).post("/api/whatsapp/batches").set("Authorization", "Bearer admin")
      .send({ templateId: "notice", memberIds: [optedIn] });
    expect((await request(app).put(`/api/whatsapp/consents/${optedIn}`).set("Authorization", "Bearer admin")
      .send({ optedIn: false, evidence: "Requested withdrawal" })).status).toBe(204);
    expect((await request(app).post(`/api/whatsapp/batches/${second.body.id}/dispatch`).set("Authorization", "Bearer admin").send({})).status).toBe(204);
    expect(sent).toHaveLength(1);
    list = (await request(app).get("/api/whatsapp/batches").set("Authorization", "Bearer admin")).body;
    expect(list.find((b: { id: string }) => b.id === second.body.id).recipients[0].state).toBe("excluded");
  });
});
