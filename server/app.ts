import { randomUUID } from "node:crypto";
import express from "express";
import { z } from "zod";
import type { Authenticate, Identity } from "./auth";
import type { Db } from "./db";
import { createOperationsRouter } from "./operations";
import { createFinanceRouter } from "./finance";
import { createWhatsAppCallbackRouter, createWhatsAppRouter, type WhatsAppProvider } from "./whatsapp";
import { sitePermissions } from "./site-permissions";

const memberSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  phone: z.string().trim().max(40).nullable(),
  email: z.string().trim().email().max(254).nullable(),
  active: z.boolean(),
  details: z.object({
    birthDate: z.iso.date().nullable(), birthPlace: z.string().trim().max(200),
    nationality: z.string().trim().max(100), profession: z.string().trim().max(200),
    address: z.string().trim().max(500), emergencyContact: z.string().trim().max(300),
    qualification: z.string().trim().max(200), licenceNumber: z.string().trim().max(100),
    licenceExpiresOn: z.iso.date().nullable(), insuranceProvider: z.string().trim().max(200),
    insuranceReference: z.string().trim().max(100),
  }).strict().default({
    birthDate: null, birthPlace: "", nationality: "", profession: "", address: "",
    emergencyContact: "", qualification: "", licenceNumber: "", licenceExpiresOn: null,
    insuranceProvider: "", insuranceReference: "",
  }),
}).strict();
const idSchema = z.string().uuid();

export function createApp(db: Db, authenticate: Authenticate, whatsapp?: WhatsAppProvider) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));
  // Provider callbacks authenticate by signature, before the administrator bearer-token middleware.
  app.use("/api", createWhatsAppCallbackRouter(db, whatsapp));
  app.use("/api", async (req, res, next) => {
    try {
      const identity = await authenticate(req.get("authorization"));
      if (!identity) { res.status(401).json({ error: "unauthorized" }); return; }
      res.locals.identity = identity;
      next();
    } catch (error) { next(error); }
  });
  app.use("/api", createOperationsRouter(db));
  app.use("/api", createFinanceRouter(db));
  app.use("/api", createWhatsAppRouter(db, whatsapp));

  app.get("/api/me", async (_req, res) => {
    const identity = res.locals.identity as Identity;
    res.json({ ...identity, sitePermissions: await sitePermissions(db, identity) });
  });

  app.get("/api/administrators", async (_req, res) => {
    if ((res.locals.identity as Identity).role !== "special_admin") {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const result = await db.query(
      `SELECT a.object_id AS "objectId",a.role,a.active,
       COALESCE(p.site_team,false) AS "siteTeam",COALESCE(p.security_manager,false) AS "securityManager"
       FROM administrators a LEFT JOIN administrator_site_permissions p ON p.administrator_id=a.object_id ORDER BY a.created_at,a.object_id`,
    );
    res.json(result.rows);
  });

  app.put("/api/administrators/:id/site-permissions", async (req, res) => {
    const actor = res.locals.identity as Identity;
    if (actor.role !== "special_admin") { res.status(403).json({ error: "forbidden" }); return; }
    const id = idSchema.safeParse(req.params.id);
    const input = z.object({ siteTeam: z.boolean(), securityManager: z.boolean() }).strict().safeParse(req.body);
    if (!id.success || !input.success) { res.status(400).json({ error: "invalid_site_permissions" }); return; }
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const admin = await client.query("SELECT role FROM administrators WHERE object_id=$1 FOR UPDATE", [id.data]);
      if (!admin.rowCount) { await client.query("ROLLBACK"); res.status(404).json({ error: "administrator_not_found" }); return; }
      if (admin.rows[0].role === "special_admin") { await client.query("ROLLBACK"); res.status(409).json({ error: "special_admin_protected" }); return; }
      const previous = await client.query("SELECT site_team,security_manager FROM administrator_site_permissions WHERE administrator_id=$1", [id.data]);
      await client.query(`INSERT INTO administrator_site_permissions(administrator_id,site_team,security_manager) VALUES($1,$2,$3)
        ON CONFLICT(administrator_id) DO UPDATE SET site_team=$2,security_manager=$3`, [id.data, input.data.siteTeam, input.data.securityManager]);
      await client.query("INSERT INTO audit_events(actor_id,action,entity_type,entity_id,details) VALUES($1,'set_permissions','administrator',$2,$3)",
        [actor.objectId, id.data, JSON.stringify({ before: previous.rows[0] ?? null, after: input.data })]);
      await client.query("COMMIT");
      res.json(input.data);
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  });

  app.get("/api/audit", async (_req, res) => {
    if ((res.locals.identity as Identity).role !== "special_admin") {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const result = await db.query(
      `SELECT id,actor_id AS "actorId",action,entity_type AS "entityType",entity_id AS "entityId",
       occurred_at AS "occurredAt",details FROM audit_events ORDER BY id DESC LIMIT 200`,
    );
    res.json(result.rows);
  });

  app.put("/api/administrators/:id", async (req, res) => {
    const actor = res.locals.identity as Identity;
    if (actor.role !== "special_admin") { res.status(403).json({ error: "forbidden" }); return; }
    const id = idSchema.safeParse(req.params.id);
    const input = z.object({ active: z.boolean() }).strict().safeParse(req.body);
    if (!id.success || !input.success) { res.status(400).json({ error: "invalid_administrator" }); return; }
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const previous = await client.query<{ role: string; active: boolean }>(
        "SELECT role, active FROM administrators WHERE object_id=$1 FOR UPDATE", [id.data],
      );
      if (previous.rows[0]?.role === "special_admin") {
        await client.query("ROLLBACK");
        res.status(409).json({ error: "special_admin_protected" });
        return;
      }
      const saved = await client.query(
        `INSERT INTO administrators(object_id, role, active) VALUES($1,'admin',$2)
         ON CONFLICT (object_id) DO UPDATE SET active=EXCLUDED.active
         WHERE administrators.role='admin' RETURNING object_id`,
        [id.data, input.data.active],
      );
      if (!saved.rowCount) {
        await client.query("ROLLBACK");
        res.status(409).json({ error: "special_admin_protected" });
        return;
      }
      await client.query(
        "INSERT INTO audit_events (actor_id, action, entity_type, entity_id, details) VALUES ($1,'set_access','administrator',$2,$3)",
        [actor.objectId, id.data, JSON.stringify({ before: previous.rows[0] ?? null, after: { role: "admin", active: input.data.active } })],
      );
      await client.query("COMMIT");
      res.json({ objectId: id.data, role: "admin", active: input.data.active });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  });

  app.get("/api/members", async (_req, res) => {
    const result = await db.query(
      `SELECT id, first_name AS "firstName", last_name AS "lastName",
        phone, email, active,details FROM members WHERE archived_at IS NULL
        ORDER BY last_name, first_name, id`,
    );
    res.json(result.rows);
  });

  app.post("/api/members", async (req, res) => {
    const parsed = memberSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "invalid_member" }); return; }
    const { firstName, lastName, phone, email, active, details } = parsed.data;
    const id = randomUUID();
    const actor = (res.locals.identity as Identity).objectId;
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO members (id, first_name, last_name, phone, email, active,details) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [id, firstName, lastName, phone, email, active, JSON.stringify(details)],
      );
      await client.query(
        "INSERT INTO audit_events (actor_id, action, entity_type, entity_id, details) VALUES ($1,'create','member',$2,$3)",
        [actor, id, JSON.stringify({ after: parsed.data })],
      );
      await client.query("COMMIT");
      res.status(201).json({ id, ...parsed.data });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  });

  app.put("/api/members/:id", async (req, res) => {
    const id = idSchema.safeParse(req.params.id);
    const parsed = memberSchema.safeParse(req.body);
    if (!id.success || !parsed.success) { res.status(400).json({ error: "invalid_member" }); return; }
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const previous = await client.query(
        `SELECT first_name AS "firstName", last_name AS "lastName", phone, email, active,details
         FROM members WHERE id=$1 AND archived_at IS NULL FOR UPDATE`,
        [id.data],
      );
      if (!previous.rows[0]) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "member_not_found" });
        return;
      }
      const { firstName, lastName, phone, email, active } = parsed.data;
      const details = Object.hasOwn(req.body, "details") ? parsed.data.details : previous.rows[0].details;
      await client.query(
        `UPDATE members SET first_name=$2, last_name=$3, phone=$4, email=$5,
         active=$6, details=$7, updated_at=now() WHERE id=$1`,
        [id.data, firstName, lastName, phone, email, active, JSON.stringify(details)],
      );
      await client.query(
        "INSERT INTO audit_events (actor_id, action, entity_type, entity_id, details) VALUES ($1,'update','member',$2,$3)",
        [(res.locals.identity as Identity).objectId, id.data, JSON.stringify({ before: previous.rows[0], after: { ...parsed.data, details } })],
      );
      await client.query("COMMIT");
      res.json({ id: id.data, ...parsed.data, details });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  });

  app.post("/api/members/:id/archive", async (req, res) => {
    if ((res.locals.identity as Identity).role !== "special_admin") {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) { res.status(400).json({ error: "invalid_id" }); return; }
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        "UPDATE members SET archived_at=now(), updated_at=now() WHERE id=$1 AND archived_at IS NULL RETURNING id",
        [id.data],
      );
      if (!result.rowCount) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "member_not_found" });
        return;
      }
      await client.query(
        "INSERT INTO audit_events (actor_id, action, entity_type, entity_id) VALUES ($1,'archive','member',$2)",
        [(res.locals.identity as Identity).objectId, id.data],
      );
      await client.query("COMMIT");
      res.status(204).end();
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  });

  app.use("/api", (_req, res) => { res.status(404).json({ error: "not_found" }); });
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof SyntaxError && "status" in error && error.status === 400) {
      res.status(400).json({ error: "invalid_json" }); return;
    }
    console.error("API request failed:", error instanceof Error ? error.name : "unknown error");
    res.status(500).json({ error: "server_error" });
  });
  return app;
}
