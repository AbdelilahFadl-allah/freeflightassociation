import { randomUUID } from "node:crypto";
import express, { Router, type Request, type Response, type NextFunction } from "express";
import twilio from "twilio";
import { z } from "zod";
import type { Db } from "./db";
import type { Identity } from "./auth";

type Template = { id: string; label: string; contentSid: string };
export type WhatsAppProvider = {
  templates: Template[];
  callbackUrl: (id: string) => string;
  verify: (signature: string, url: string, body: Record<string, string>) => boolean;
  send: (phone: string, template: Template, callbackUrl: string) => Promise<{ sid: string }>;
};

export function createTwilioProvider(env: NodeJS.ProcessEnv): WhatsAppProvider | undefined {
  const keys = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_WHATSAPP_FROM", "TWILIO_CALLBACK_BASE_URL", "WHATSAPP_TEMPLATES_JSON"] as const;
  if (keys.every((key) => !env[key])) return undefined;
  const config = z.object({
    TWILIO_ACCOUNT_SID: z.string().regex(/^AC[0-9a-fA-F]{32}$/),
    TWILIO_AUTH_TOKEN: z.string().min(1),
    TWILIO_WHATSAPP_FROM: z.string().regex(/^whatsapp:\+[1-9]\d{7,14}$/),
    TWILIO_CALLBACK_BASE_URL: z.url().refine((value) => {
      const url = new URL(value);
      return url.protocol === "https:" && !url.search && !url.hash && url.pathname === "/";
    }),
    WHATSAPP_TEMPLATES_JSON: z.string().min(1),
  }).parse(env);
  const templates = z.array(z.object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,60}$/),
    label: z.string().trim().min(1).max(100),
    contentSid: z.string().regex(/^HX[0-9a-fA-F]{32}$/),
  }).strict()).min(1).parse(JSON.parse(config.WHATSAPP_TEMPLATES_JSON));
  if (new Set(templates.map((t) => t.id)).size !== templates.length) throw new Error("Duplicate WhatsApp template IDs");
  // Unknown provider outcomes must be reconciled manually, not retried automatically.
  const client = twilio(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN, { timeout: 10000, autoRetry: false });
  const base = config.TWILIO_CALLBACK_BASE_URL.replace(/\/$/, "");
  return {
    templates,
    callbackUrl: (id) => `${base}/api/whatsapp/callback/${id}`,
    verify: (signature, url, body) => twilio.validateRequest(config.TWILIO_AUTH_TOKEN, signature, url, body),
    send: async (phone, template, callbackUrl) => {
      const sent = await client.messages.create({
        from: config.TWILIO_WHATSAPP_FROM, to: `whatsapp:${phone}`, contentSid: template.contentSid,
        statusCallback: callbackUrl,
      });
      return { sid: sent.sid };
    },
  };
}

export function createWhatsAppCallbackRouter(db: Db, provider?: WhatsAppProvider) {
  const router = Router();
  router.post("/whatsapp/callback/:id", express.urlencoded({ extended: false, limit: "16kb" }), async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    const body = z.record(z.string(), z.string()).safeParse(req.body);
    const signature = req.get("X-Twilio-Signature");
    if (!provider || !id.success || !body.success || !signature ||
        !provider.verify(signature, provider.callbackUrl(id.data), body.data)) {
      res.status(403).end(); return;
    }
    if (!/^SM[0-9a-fA-F]{32}$/.test(body.data.MessageSid ?? "")) { res.status(400).end(); return; }
    const status = body.data.MessageStatus;
    const mapped: Record<string, string> = { sent: "submitted", delivered: "delivered", read: "read", failed: "failed", undelivered: "failed" };
    if (mapped[status]) {
      await db.query(
        `UPDATE notification_recipients SET state=$2,provider_message_id=COALESCE(provider_message_id,$3),updated_at=now()
         WHERE id=$1 AND (provider_message_id IS NULL OR provider_message_id=$3)
         AND state NOT IN ('read','failed','excluded') AND NOT (state='delivered' AND $2='submitted')`,
        [id.data, mapped[status], body.data.MessageSid ?? null],
      );
    }
    res.status(204).end();
  });
  return router;
}

const uuid = z.string().uuid();
export function createWhatsAppRouter(db: Db, provider?: WhatsAppProvider) {
  const router = Router();
  router.get("/whatsapp/event-settings", async (_req, res) => {
    if ((res.locals.identity as Identity).role !== "special_admin") { res.status(403).json({ error: "forbidden" }); return; }
    const settings = await db.query('SELECT event,enabled,template_id AS "templateId" FROM notification_event_settings ORDER BY event');
    const contacts = await db.query(`SELECT a.object_id AS "administratorId",a.active,c.phone,c.opted_in AS "optedIn",c.evidence
      FROM administrators a LEFT JOIN admin_whatsapp_contacts c ON c.administrator_id=a.object_id ORDER BY a.created_at,a.object_id`);
    res.json({ settings: settings.rows, contacts: contacts.rows });
  });
  router.put("/whatsapp/event-settings/:event", async (req, res) => {
    if ((res.locals.identity as Identity).role !== "special_admin") { res.status(403).json({ error: "forbidden" }); return; }
    const event = z.enum(["flight_planned", "goods_trade", "gear_added", "gear_removed", "financial_operation"]).safeParse(req.params.event);
    const input = z.object({ enabled: z.boolean(), templateId: z.string().max(60) }).strict().safeParse(req.body);
    if (!event.success || !input.success || (input.data.enabled && !provider?.templates.some((t) => t.id === input.data.templateId))) {
      res.status(400).json({ error: "invalid_event_settings" }); return;
    }
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE notification_event_settings SET enabled=$2,template_id=$3 WHERE event=$1",
        [event.data, input.data.enabled, input.data.templateId]);
      await client.query("INSERT INTO audit_events(actor_id,action,entity_type,entity_id,details) VALUES($1,'update','notification_settings',$2,$3)",
        [(res.locals.identity as Identity).objectId, randomUUID(), JSON.stringify({ event: event.data, ...input.data })]);
      await client.query("COMMIT");
      res.status(204).end();
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  });
  router.put("/whatsapp/admin-contacts/:id", async (req, res) => {
    const actor = res.locals.identity as Identity;
    if (actor.role !== "special_admin") { res.status(403).json({ error: "forbidden" }); return; }
    const id = uuid.safeParse(req.params.id);
    const input = z.object({ phone: z.string().regex(/^\+[1-9]\d{7,14}$/), optedIn: z.boolean(),
      evidence: z.string().trim().min(1).max(500) }).strict().safeParse(req.body);
    if (!id.success || !input.success) { res.status(400).json({ error: "invalid_contact" }); return; }
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const admin = await client.query("SELECT object_id FROM administrators WHERE object_id=$1", [id.data]);
      if (!admin.rowCount) { await client.query("ROLLBACK"); res.status(404).json({ error: "administrator_not_found" }); return; }
      await client.query(`INSERT INTO admin_whatsapp_contacts(administrator_id,phone,opted_in,evidence,updated_by)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(administrator_id) DO UPDATE SET phone=$2,opted_in=$3,evidence=$4,updated_by=$5,updated_at=now()`,
        [id.data, input.data.phone, input.data.optedIn, input.data.evidence, actor.objectId]);
      await client.query("INSERT INTO audit_events(actor_id,action,entity_type,entity_id,details) VALUES($1,'consent','administrator',$2,$3)",
        [actor.objectId, id.data, JSON.stringify({ optedIn: input.data.optedIn })]);
      await client.query("COMMIT");
      res.status(204).end();
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  });
  router.get("/whatsapp/templates", (_req, res) => {
    res.json({ configured: !!provider, templates: provider?.templates.map(({ id, label }) => ({ id, label })) ?? [] });
  });
  router.get("/whatsapp/consents", async (_req, res) => {
    const result = await db.query(
      `SELECT m.id,m.first_name AS "firstName",m.last_name AS "lastName",m.phone,m.active,
       c.opted_in AS "optedIn",c.evidence FROM members m LEFT JOIN whatsapp_consent c ON c.member_id=m.id
       WHERE m.archived_at IS NULL ORDER BY m.last_name,m.first_name`,
    );
    res.json(result.rows);
  });
  router.put("/whatsapp/consents/:id", async (req, res) => {
    const id = uuid.safeParse(req.params.id);
    const input = z.object({ optedIn: z.boolean(), evidence: z.string().trim().min(1).max(500) }).strict().safeParse(req.body);
    if (!id.success || !input.success) { res.status(400).json({ error: "invalid_consent" }); return; }
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const member = await client.query("SELECT id FROM members WHERE id=$1 AND archived_at IS NULL", [id.data]);
      if (!member.rowCount) { await client.query("ROLLBACK"); res.status(404).json({ error: "member_not_found" }); return; }
      const before = await client.query("SELECT opted_in,evidence FROM whatsapp_consent WHERE member_id=$1 FOR UPDATE", [id.data]);
      await client.query(
        `INSERT INTO whatsapp_consent(member_id,opted_in,evidence,updated_by) VALUES($1,$2,$3,$4)
         ON CONFLICT(member_id) DO UPDATE SET opted_in=EXCLUDED.opted_in,evidence=EXCLUDED.evidence,
         updated_at=now(),updated_by=EXCLUDED.updated_by`,
        [id.data, input.data.optedIn, input.data.evidence, (res.locals.identity as Identity).objectId],
      );
      await client.query(
        "INSERT INTO audit_events(actor_id,action,entity_type,entity_id,details) VALUES($1,'consent','member',$2,$3)",
        [(res.locals.identity as Identity).objectId, id.data, JSON.stringify({ before: before.rows[0] ?? null, after: input.data })],
      );
      await client.query("COMMIT");
      res.status(204).end();
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  });
  router.get("/whatsapp/batches", async (_req, res) => {
    const batches = await db.query('SELECT id,template_id AS "templateId",event,source_id AS "sourceId",created_at AS "createdAt" FROM notification_batches ORDER BY created_at DESC');
    const recipients = await db.query(
      `SELECT id,batch_id AS "batchId",member_id AS "memberId",administrator_id AS "administratorId",state,reason,provider_message_id AS "providerMessageId"
       FROM notification_recipients ORDER BY updated_at`,
    );
    res.json(batches.rows.map((b) => ({ ...b, recipients: recipients.rows.filter((r) => r.batchId === b.id) })));
  });
  router.post("/whatsapp/batches", async (req, res) => {
    if (!provider) { res.status(503).json({ error: "provider_not_configured" }); return; }
    const input = z.object({ templateId: z.string().min(1), memberIds: z.array(uuid).min(1).max(500) }).strict()
      .refine((v) => new Set(v.memberIds).size === v.memberIds.length).safeParse(req.body);
    if (!input.success || !provider.templates.some((t) => t.id === input.data.templateId)) {
      res.status(400).json({ error: "invalid_batch" }); return;
    }
    const batch = randomUUID();
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO notification_batches(id,template_id,created_by) VALUES($1,$2,$3)",
        [batch, input.data.templateId, (res.locals.identity as Identity).objectId]);
      for (const id of input.data.memberIds) {
        const found = await client.query<{ phone: string | null; active: boolean; archived_at: Date | null; opted_in: boolean | null }>(
          `SELECT m.phone,m.active,m.archived_at,c.opted_in FROM members m LEFT JOIN whatsapp_consent c ON c.member_id=m.id WHERE m.id=$1`, [id],
        );
        if (!found.rows[0]) { await client.query("ROLLBACK"); res.status(400).json({ error: "invalid_member" }); return; }
        const m = found.rows[0];
        const reason = m.archived_at ? "archived" : !m.active ? "inactive" : !m.opted_in ? "no_consent"
          : !m.phone || !/^\+[1-9]\d{7,14}$/.test(m.phone) ? "invalid_phone" : null;
        await client.query("INSERT INTO notification_recipients(id,batch_id,member_id,phone,state,reason) VALUES($1,$2,$3,$4,$5,$6)",
          [randomUUID(), batch, id, m.phone ?? "", reason ? "excluded" : "queued", reason]);
      }
      await client.query("INSERT INTO audit_events(actor_id,action,entity_type,entity_id,details) VALUES($1,'create','notification_batch',$2,$3)",
        [(res.locals.identity as Identity).objectId, batch, JSON.stringify({ templateId: input.data.templateId, count: input.data.memberIds.length })]);
      await client.query("COMMIT");
      res.status(201).json({ id: batch });
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  });
  router.post("/whatsapp/batches/:id/dispatch", async (req, res) => {
    if (!provider) { res.status(503).json({ error: "provider_not_configured" }); return; }
    const id = uuid.safeParse(req.params.id);
    if (!id.success) { res.status(400).json({ error: "invalid_batch" }); return; }
    const batch = await db.query<{ template_id: string }>("SELECT template_id FROM notification_batches WHERE id=$1", [id.data]);
    if (!batch.rowCount) { res.status(404).json({ error: "batch_not_found" }); return; }
    const template = provider.templates.find((t) => t.id === batch.rows[0].template_id);
    if (!template) { res.status(409).json({ error: "template_not_configured" }); return; }
    const queued = await db.query<{ id: string }>("SELECT id FROM notification_recipients WHERE batch_id=$1 AND state='queued' ORDER BY id LIMIT 10", [id.data]);
    await db.query(
      "INSERT INTO audit_events(actor_id,action,entity_type,entity_id,details) VALUES($1,'dispatch','notification_batch',$2,$3)",
      [(res.locals.identity as Identity).objectId, id.data, JSON.stringify({ queuedCount: queued.rows.length })],
    );
    for (const recipient of queued.rows) {
      const claimed = await db.query<{ phone: string }>(
        `UPDATE notification_recipients SET state='sending',updated_at=now()
         WHERE id=$1 AND state='queued' RETURNING phone`, [recipient.id],
      );
      if (!claimed.rowCount) continue;
      const eligible = await db.query(
        `SELECT r.id FROM notification_recipients r
         LEFT JOIN members m ON m.id=r.member_id LEFT JOIN whatsapp_consent c ON c.member_id=m.id
         LEFT JOIN administrators a ON a.object_id=r.administrator_id
         LEFT JOIN admin_whatsapp_contacts ac ON ac.administrator_id=a.object_id
         WHERE r.id=$1 AND ((m.active=true AND m.archived_at IS NULL AND c.opted_in=true AND m.phone=r.phone)
         OR (a.active=true AND ac.opted_in=true AND ac.phone=r.phone))`,
        [recipient.id],
      );
      if (!eligible.rowCount) {
        await db.query("UPDATE notification_recipients SET state='excluded',reason='eligibility_changed',updated_at=now() WHERE id=$1 AND state='sending'", [recipient.id]);
        continue;
      }
      try {
        const sent = await provider.send(claimed.rows[0].phone, template, provider.callbackUrl(recipient.id));
        await db.query(
          `UPDATE notification_recipients SET state=CASE WHEN state='sending' THEN 'submitted' ELSE state END,
           provider_message_id=COALESCE(provider_message_id,$2),updated_at=now() WHERE id=$1`, [recipient.id, sent.sid],
        );
      } catch (error) {
        console.error("WhatsApp send outcome unknown for recipient", recipient.id, error instanceof Error ? error.name : "unknown error");
        await db.query("UPDATE notification_recipients SET state='unknown',reason='provider_outcome_unknown',updated_at=now() WHERE id=$1 AND state='sending'", [recipient.id]);
      }
    }
    res.status(204).end();
  });
  router.post("/whatsapp/recipients/:id/mark-unknown", async (req, res) => {
    const actor = res.locals.identity as Identity;
    if (actor.role !== "special_admin") { res.status(403).json({ error: "forbidden" }); return; }
    const id = uuid.safeParse(req.params.id);
    if (!id.success) { res.status(400).json({ error: "invalid_recipient" }); return; }
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        "UPDATE notification_recipients SET state='unknown',reason='provider_outcome_unknown',updated_at=now() WHERE id=$1 AND state='sending' RETURNING id",
        [id.data],
      );
      if (!result.rowCount) { await client.query("ROLLBACK"); res.status(409).json({ error: "recipient_not_sending" }); return; }
      await client.query("INSERT INTO audit_events(actor_id,action,entity_type,entity_id,details) VALUES($1,'mark_unknown','notification_recipient',$2,$3)",
        [actor.objectId, id.data, JSON.stringify({ reason: "manual_reconciliation_required" })]);
      await client.query("COMMIT");
      res.status(204).end();
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  });
  router.use((error: unknown, _req: Request, _res: Response, next: NextFunction) => next(error));
  return router;
}
