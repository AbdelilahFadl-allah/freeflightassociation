import { randomUUID } from "node:crypto";
import { Router, type Request, type Response, type NextFunction } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import type { Db } from "./db";
import type { Identity } from "./auth";
import { queueEvent } from "./notification-events";

const uuid = z.string().uuid();
const date = z.iso.date();
const account = z.enum(["cash", "bank"]);
const description = z.string().trim().min(1).max(500);
const amount = z.number().int().positive().max(100_000_000);
const quantity = z.number().int().positive().max(1_000_000);
const base = { businessDate: date, description, counterparty: z.string().trim().max(200), paymentMethod: z.string().trim().max(100) };
const direct = z.object({ ...base, kind: z.enum(["income", "expense"]), account, amountCents: amount }).strict();
const transfer = z.object({ ...base, from: account, to: account, amountCents: amount }).strict().refine((v) => v.from !== v.to);
const trade = z.object({
  ...base, kind: z.enum(["sale", "purchase"]), account,
  lines: z.array(z.object({ productId: uuid, quantity, unitPriceCents: amount }).strict()).min(1).max(50),
}).strict().refine((v) => new Set(v.lines.map((l) => l.productId)).size === v.lines.length);
const product = z.object({ name: z.string().trim().min(1).max(200), initialQuantity: z.number().int().min(0).max(1_000_000), businessDate: date }).strict();
const adjustment = z.object({ quantity: z.number().int().min(-1_000_000).max(1_000_000).refine((n) => n !== 0), businessDate: date, reason: description }).strict();
const correction = z.object({
  businessDate: date, reason: description,
  replacement: z.union([direct, trade, transfer.safeExtend({ kind: z.literal("transfer") })]),
}).strict();

class FinanceError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
async function transaction<T>(db: Db, work: (client: PoolClient) => Promise<T>): Promise<T> {
  // Ledger, inventory and notification changes commit or roll back together.
  const client = await db.connect();
  try { await client.query("BEGIN"); const result = await work(client); await client.query("COMMIT"); return result; }
  catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
async function audit(client: PoolClient, actor: Identity, action: string, type: string, id: string, details: unknown) {
  await client.query("INSERT INTO audit_events(actor_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5)",
    [actor.objectId, action, type, id, JSON.stringify(details)]);
}
async function changeStock(client: PoolClient, productId: string, delta: number, businessDate: string, reason: string, operationId: string | null) {
  const current = await client.query("SELECT quantity FROM products WHERE id=$1 FOR UPDATE", [productId]);
  if (!current.rows[0]) throw new FinanceError(404, "product_not_found");
  const changed = await client.query(
    "UPDATE products SET quantity=quantity+$2 WHERE id=$1 AND quantity+$2 BETWEEN 0 AND 9007199254740991 RETURNING id",
    [productId, delta],
  );
  if (!changed.rowCount) throw new FinanceError(409, "stock_out_of_range");
  await client.query("INSERT INTO stock_movements(id,product_id,quantity,business_date,reason,operation_id) VALUES($1,$2,$3,$4,$5,$6)",
    [randomUUID(), productId, delta, businessDate, reason, operationId]);
}
async function operation(client: PoolClient, actor: Identity, id: string, kind: string, data: { businessDate: string; description: string; counterparty: string; paymentMethod: string }, reversesId: string | null = null) {
  await client.query(
    `INSERT INTO financial_operations(id,kind,business_date,description,counterparty,payment_method,reverses_id,created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, kind, data.businessDate, data.description, data.counterparty, data.paymentMethod, reversesId, actor.objectId],
  );
}
async function entry(client: PoolClient, operationId: string, accountId: string, cents: number) {
  const account = await client.query<{ opening_set: boolean }>("SELECT opening_set FROM accounts WHERE id=$1 FOR UPDATE", [accountId]);
  if (!account.rows[0]?.opening_set) throw new FinanceError(409, "opening_balance_required");
  await client.query("INSERT INTO ledger_entries(id,operation_id,account_id,amount_cents) VALUES($1,$2,$3,$4)",
    [randomUUID(), operationId, accountId, cents]);
}
async function reverse(client: PoolClient, actor: Identity, originalId: string, reversalId: string, businessDate: string, reason: string) {
  const original = await client.query<{ kind: string }>("SELECT kind FROM financial_operations WHERE id=$1 FOR UPDATE", [originalId]);
  if (!original.rowCount) throw new FinanceError(404, "transaction_not_found");
  if (original.rows[0].kind === "reversal") throw new FinanceError(409, "cannot_reverse_reversal");
  if ((await client.query("SELECT id FROM financial_operations WHERE reverses_id=$1", [originalId])).rowCount) throw new FinanceError(409, "already_reversed");
  const entries = await client.query<{ account_id: string; amount_cents: string }>("SELECT account_id,amount_cents FROM ledger_entries WHERE operation_id=$1 ORDER BY account_id", [originalId]);
  const movements = await client.query<{ product_id: string; quantity: string }>("SELECT product_id,quantity FROM stock_movements WHERE operation_id=$1 ORDER BY product_id", [originalId]);
  await operation(client, actor, reversalId, "reversal", { businessDate, description: reason, counterparty: "", paymentMethod: "" }, originalId);
  for (const movement of movements.rows) await changeStock(client, movement.product_id, -Number(movement.quantity), businessDate, "reversal", reversalId);
  for (const e of entries.rows) await entry(client, reversalId, e.account_id, -Number(e.amount_cents));
  await audit(client, actor, "reverse", "financial_operation", reversalId, { reversesId: originalId, businessDate, reason });
  return original.rows[0].kind;
}

export function createFinanceRouter(db: Db) {
  const router = Router();
  router.get("/products", async (_req, res) => {
    const result = await db.query('SELECT id,name,quantity FROM products ORDER BY name,id');
    res.json(result.rows.map((v) => ({ ...v, quantity: Number(v.quantity) })));
  });
  router.get("/stock-movements", async (_req, res) => {
    const result = await db.query(
      `SELECT m.id,m.product_id AS "productId",p.name,m.quantity,m.business_date AS "businessDate",
       m.reason,m.operation_id AS "operationId" FROM stock_movements m
       JOIN products p ON p.id=m.product_id ORDER BY m.business_date DESC,m.created_at DESC`,
    );
    res.json(result.rows.map((row) => ({ ...row, quantity: Number(row.quantity) })));
  });
  router.post("/products", async (req, res) => {
    const p = product.safeParse(req.body);
    if (!p.success) { res.status(400).json({ error: "invalid_product" }); return; }
    const id = randomUUID();
    await transaction(db, async (client) => {
      await client.query("INSERT INTO products(id,name) VALUES($1,$2)", [id, p.data.name]);
      if (p.data.initialQuantity) await changeStock(client, id, p.data.initialQuantity, p.data.businessDate, "opening", null);
      await audit(client, res.locals.identity, "create", "product", id, p.data);
    });
    res.status(201).json({ id });
  });
  router.post("/products/:id/adjustments", async (req, res) => {
    const id = uuid.safeParse(req.params.id); const p = adjustment.safeParse(req.body);
    if (!id.success || !p.success) { res.status(400).json({ error: "invalid_adjustment" }); return; }
    await transaction(db, async (client) => {
      await changeStock(client, id.data, p.data.quantity, p.data.businessDate, p.data.reason, null);
      await audit(client, res.locals.identity, "adjust", "product", id.data, p.data);
    });
    res.status(204).end();
  });
  router.get("/accounts", async (_req, res) => {
    const accounts = await db.query("SELECT id,opening_cents,opening_set FROM accounts ORDER BY id");
    const entries = await db.query("SELECT account_id,amount_cents FROM ledger_entries");
    res.json(accounts.rows.map((a) => {
      const balance = entries.rows.filter((e) => e.account_id === a.id)
        .reduce((sum, e) => sum + BigInt(e.amount_cents), BigInt(a.opening_cents));
      const value = Number(balance);
      if (!Number.isSafeInteger(value)) throw new Error("Account balance exceeds supported range");
      return { id: a.id, balanceCents: value, openingSet: a.opening_set };
    }));
  });
  router.post("/accounts/:id/opening", async (req, res) => {
    const id = account.safeParse(req.params.id);
    const input = z.object({
      amountCents: z.number().int().min(-100_000_000).max(100_000_000),
      businessDate: date, description,
    }).strict().safeParse(req.body);
    if (!id.success || !input.success) { res.status(400).json({ error: "invalid_opening_balance" }); return; }
    const openingId = randomUUID();
    await transaction(db, async (client) => {
      const current = await client.query<{ opening_set: boolean }>("SELECT opening_set FROM accounts WHERE id=$1 FOR UPDATE", [id.data]);
      if (!current.rows[0]) throw new FinanceError(404, "account_not_found");
      if (current.rows[0].opening_set) throw new FinanceError(409, "opening_balance_already_set");
      await client.query("UPDATE accounts SET opening_cents=$2,opening_set=true WHERE id=$1", [id.data, input.data.amountCents]);
      await audit(client, res.locals.identity, "opening", "account", openingId, { account: id.data, ...input.data });
      await queueEvent(client, res.locals.identity, "financial_operation", openingId);
    });
    res.status(204).end();
  });
  router.get("/finance", async (_req, res) => {
    const operations = await db.query(
      `SELECT id,kind,business_date AS "businessDate",description,counterparty,payment_method AS "paymentMethod",
       reverses_id AS "reversesId",replaces_id AS "replacesId",created_at AS "createdAt" FROM financial_operations ORDER BY business_date DESC,created_at DESC`,
    );
    const entries = await db.query('SELECT operation_id AS "operationId",account_id AS "accountId",amount_cents AS "amountCents" FROM ledger_entries');
    res.json(operations.rows.map((o) => ({ ...o, entries: entries.rows.filter((e) => e.operationId === o.id)
      .map((e) => ({ ...e, amountCents: Number(e.amountCents) })) })));
  });
  router.get("/receipts", async (_req, res) => {
    const receipts = await db.query(
      `SELECT r.number,r.operation_id AS "operationId",f.business_date AS "businessDate",f.description,
       f.counterparty,f.payment_method AS "paymentMethod",e.amount_cents AS "amountCents",e.account_id AS "accountId"
       FROM receipts r JOIN financial_operations f ON f.id=r.operation_id
       JOIN ledger_entries e ON e.operation_id=f.id WHERE e.amount_cents > 0 ORDER BY r.number DESC`,
    );
    res.json(receipts.rows.map((r) => ({ ...r, number: String(r.number), amountCents: Number(r.amountCents) })));
  });
  router.post("/finance/direct", async (req, res) => {
    const p = direct.safeParse(req.body);
    if (!p.success) { res.status(400).json({ error: "invalid_transaction" }); return; }
    const d = p.data; const id = randomUUID();
    await transaction(db, async (client) => {
      await operation(client, res.locals.identity, id, d.kind, d);
      await entry(client, id, d.account, d.amountCents * (d.kind === "income" ? 1 : -1));
      if (d.kind === "income") await client.query("INSERT INTO receipts(operation_id) VALUES($1)", [id]);
      await audit(client, res.locals.identity, "create", "financial_operation", id, d);
      await queueEvent(client, res.locals.identity, "financial_operation", id);
    });
    res.status(201).json({ id });
  });
  router.post("/finance/transfers", async (req, res) => {
    const p = transfer.safeParse(req.body);
    if (!p.success) { res.status(400).json({ error: "invalid_transfer" }); return; }
    const d = p.data; const id = randomUUID();
    await transaction(db, async (client) => {
      await operation(client, res.locals.identity, id, "transfer", d);
      await entry(client, id, d.from, -d.amountCents);
      await entry(client, id, d.to, d.amountCents);
      await audit(client, res.locals.identity, "create", "financial_operation", id, d);
      await queueEvent(client, res.locals.identity, "financial_operation", id);
    });
    res.status(201).json({ id });
  });
  router.post("/finance/trades", async (req, res) => {
    const p = trade.safeParse(req.body);
    if (!p.success) { res.status(400).json({ error: "invalid_trade" }); return; }
    const d = p.data; const id = randomUUID();
    const total = d.lines.reduce((sum, line) => sum + line.quantity * line.unitPriceCents, 0);
    if (!Number.isSafeInteger(total)) { res.status(400).json({ error: "amount_too_large" }); return; }
    await transaction(db, async (client) => {
      await operation(client, res.locals.identity, id, d.kind, d);
      for (const line of [...d.lines].sort((a, b) => a.productId.localeCompare(b.productId))) {
        await changeStock(client, line.productId, line.quantity * (d.kind === "sale" ? -1 : 1), d.businessDate, d.kind, id);
        await client.query("INSERT INTO trade_lines(operation_id,product_id,quantity,unit_price_cents) VALUES($1,$2,$3,$4)",
          [id, line.productId, line.quantity, line.unitPriceCents]);
      }
      await entry(client, id, d.account, total * (d.kind === "sale" ? 1 : -1));
      if (d.kind === "sale") await client.query("INSERT INTO receipts(operation_id) VALUES($1)", [id]);
      await audit(client, res.locals.identity, "create", "financial_operation", id, d);
      if (!await queueEvent(client, res.locals.identity, "goods_trade", id)) {
        await queueEvent(client, res.locals.identity, "financial_operation", id);
      }
    });
    res.status(201).json({ id });
  });
  router.post("/finance/:id/reverse", async (req, res) => {
    const id = uuid.safeParse(req.params.id);
    const p = z.object({ businessDate: date, reason: description }).strict().safeParse(req.body);
    if (!id.success || !p.success) { res.status(400).json({ error: "invalid_reversal" }); return; }
    const reversalId = randomUUID();
    await transaction(db, async (client) => {
      await reverse(client, res.locals.identity, id.data, reversalId, p.data.businessDate, p.data.reason);
      await queueEvent(client, res.locals.identity, "financial_operation", reversalId);
    });
    res.status(201).json({ id: reversalId });
  });
  router.post("/finance/:id/correct", async (req, res) => {
    const id = uuid.safeParse(req.params.id); const p = correction.safeParse(req.body);
    if (!id.success || !p.success) { res.status(400).json({ error: "invalid_correction" }); return; }
    const d = p.data.replacement;
    if ("lines" in d && !Number.isSafeInteger(d.lines.reduce((sum, line) => sum + line.quantity * line.unitPriceCents, 0))) {
      res.status(400).json({ error: "amount_too_large" }); return;
    }
    const reversalId = randomUUID(); const replacementId = randomUUID();
    await transaction(db, async (client) => {
      const originalKind = await reverse(client, res.locals.identity, id.data, reversalId, p.data.businessDate, p.data.reason);
      if (originalKind !== d.kind) throw new FinanceError(400, "correction_kind_mismatch");
      await operation(client, res.locals.identity, replacementId, d.kind, d);
      await client.query("UPDATE financial_operations SET replaces_id=$2 WHERE id=$1", [replacementId, id.data]);
      if ("lines" in d) {
        let total = 0;
        for (const line of [...d.lines].sort((a, b) => a.productId.localeCompare(b.productId))) {
          await changeStock(client, line.productId, line.quantity * (d.kind === "sale" ? -1 : 1), d.businessDate, d.kind, replacementId);
          await client.query("INSERT INTO trade_lines(operation_id,product_id,quantity,unit_price_cents) VALUES($1,$2,$3,$4)",
            [replacementId, line.productId, line.quantity, line.unitPriceCents]);
          total += line.quantity * line.unitPriceCents;
        }
        await entry(client, replacementId, d.account, total * (d.kind === "sale" ? 1 : -1));
        if (d.kind === "sale") await client.query("INSERT INTO receipts(operation_id) VALUES($1)", [replacementId]);
      } else if (d.kind === "transfer") {
        await entry(client, replacementId, d.from, -d.amountCents);
        await entry(client, replacementId, d.to, d.amountCents);
      } else {
        await entry(client, replacementId, d.account, d.amountCents * (d.kind === "income" ? 1 : -1));
        if (d.kind === "income") await client.query("INSERT INTO receipts(operation_id) VALUES($1)", [replacementId]);
      }
      await audit(client, res.locals.identity, "replace", "financial_operation", replacementId, { replacesId: id.data, replacement: d });
      await queueEvent(client, res.locals.identity, "financial_operation", replacementId);
    });
    res.status(201).json({ reversalId, replacementId });
  });
  router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (error instanceof FinanceError) { res.status(error.status).json({ error: error.code }); return; }
    next(error);
  });
  return router;
}
