import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("PostgreSQL constraints and transactions", () => {
  let db: PGlite;
  const migrations = ["001_foundation.sql", "002_operations.sql", "003_finance.sql", "004_notifications.sql", "005_receipts.sql", "006_member_details.sql", "007_admin_constraint.sql", "008_corrections.sql", "009_flight_revisions.sql", "010_opening_balances.sql", "011_flight_sites.sql", "012_admin_notifications.sql", "013_site_validation.sql"];
  beforeEach(async () => {
    db = new PGlite();
    for (const name of migrations) {
      await db.exec(await readFile(new URL(`../server/migrations/${name}`, import.meta.url), "utf8"));
    }
  });
  afterEach(async () => { await db.close(); });

  it("can safely rerun all migrations", async () => {
    for (const name of migrations) await db.exec(await readFile(new URL(`../server/migrations/${name}`, import.meta.url), "utf8"));
    expect((await db.query("SELECT id FROM accounts")).rows).toHaveLength(2);
  });

  it("rolls back both stock and financial records after a constraint failure", async () => {
    const admin = "00000000-0000-4000-8000-000000000001";
    const product = "00000000-0000-4000-8000-000000000002";
    const op = "00000000-0000-4000-8000-000000000003";
    await db.query("INSERT INTO administrators(object_id,role) VALUES($1,'admin')", [admin]);
    await db.query("INSERT INTO products(id,name,quantity) VALUES($1,'Helmet',1)", [product]);
    await expect(db.transaction(async (tx) => {
      await tx.query("INSERT INTO financial_operations(id,kind,business_date,description,created_by) VALUES($1,'sale','2026-11-01','sale',$2)", [op, admin]);
      await tx.query("UPDATE products SET quantity=quantity-2 WHERE id=$1", [product]);
    })).rejects.toThrow();
    expect((await db.query<{ quantity: string }>("SELECT quantity FROM products WHERE id=$1", [product])).rows[0].quantity).toBe(1);
    expect((await db.query("SELECT id FROM financial_operations WHERE id=$1", [op])).rows).toHaveLength(0);
  });

  it("enforces one open loan and permits another after return", async () => {
    const item = "00000000-0000-4000-8000-000000000010";
    await db.query("INSERT INTO equipment(id,identifier,designation,condition) VALUES($1,'E1','Gear','Good')", [item]);
    await db.query("INSERT INTO equipment_loans(id,equipment_id,borrower_name,loaned_on,condition_out) VALUES('00000000-0000-4000-8000-000000000011',$1,'A','2026-01-01','Good')", [item]);
    await expect(db.query("INSERT INTO equipment_loans(id,equipment_id,borrower_name,loaned_on,condition_out) VALUES('00000000-0000-4000-8000-000000000012',$1,'B','2026-01-01','Good')", [item])).rejects.toThrow();
    await db.query("UPDATE equipment_loans SET returned_on='2026-01-02',condition_in='Good' WHERE equipment_id=$1", [item]);
    await db.query("INSERT INTO equipment_loans(id,equipment_id,borrower_name,loaned_on,condition_out) VALUES('00000000-0000-4000-8000-000000000012',$1,'B','2026-01-02','Good')", [item]);
    expect((await db.query("SELECT id FROM equipment_loans WHERE equipment_id=$1", [item])).rows).toHaveLength(2);
  });
});
