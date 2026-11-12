import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { Identity } from "./auth";

export type NotificationEvent = "flight_planned" | "goods_trade" | "gear_added" | "gear_removed" | "financial_operation";

export async function queueEvent(client: PoolClient, actor: Identity, event: NotificationEvent, sourceId: string) {
  // Use the caller's transaction so a rolled-back operation cannot leave a notification behind.
  const setting = await client.query<{ enabled: boolean; template_id: string }>(
    "SELECT enabled,template_id FROM notification_event_settings WHERE event=$1", [event],
  );
  if (!setting.rows[0]?.enabled) return false;
  const batch = randomUUID();
  await client.query("INSERT INTO notification_batches(id,template_id,created_by,event,source_id) VALUES($1,$2,$3,$4,$5)",
    [batch, setting.rows[0].template_id, actor.objectId, event, sourceId]);
  const contacts = await client.query<{ administrator_id: string; phone: string; opted_in: boolean; active: boolean }>(
    `SELECT c.administrator_id,c.phone,c.opted_in,a.active FROM admin_whatsapp_contacts c
     JOIN administrators a ON a.object_id=c.administrator_id ORDER BY c.administrator_id`,
  );
  for (const contact of contacts.rows) {
    const reason = !contact.active ? "inactive" : !contact.opted_in ? "no_consent"
      : !/^\+[1-9]\d{7,14}$/.test(contact.phone) ? "invalid_phone" : null;
    await client.query(`INSERT INTO notification_recipients(id,batch_id,administrator_id,phone,state,reason)
      VALUES($1,$2,$3,$4,$5,$6)`, [randomUUID(), batch, contact.administrator_id, contact.phone, reason ? "excluded" : "queued", reason]);
  }
  return true;
}
