import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import type { PoolClient } from "pg";
import type { Db } from "./db";
import type { Identity } from "./auth";
import { queueEvent } from "./notification-events";
import { validPolygon } from "../src/siteGeometry";
import { sitePermissions } from "./site-permissions";

const uuid = z.string().uuid();
const short = z.string().trim().min(1).max(200);
const optionalDate = z.iso.date().nullable();
const coordinates = { latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180) };
const landing = z.object({ id: uuid, name: short, type: z.enum(["primary", "emergency"]),
  polygon: z.array(z.object(coordinates).strict()).min(4).max(7).refine(validPolygon) }).strict();
const siteDetails = z.object({
  ownerAgreement: z.string().trim().max(2000), access: z.string().trim().max(2000),
  launchAltitude: z.string().trim().max(200), launchOrientation: z.string().trim().max(200),
  windLimits: z.string().trim().max(2000), hazards: z.string().trim().max(2000),
  restrictedAreas: z.string().trim().max(2000), minimumLevel: z.string().trim().max(500),
  tandem: z.enum(["unknown", "yes", "no"]), emergencyServices: z.string().trim().max(2000),
  phoneCoverage: z.string().trim().max(2000),
}).strict();
const siteSchema = z.object({
  name: short, ...coordinates, municipality: z.string().trim().max(200),
  status: z.enum(["open", "closed", "maintenance"]),
  windDirections: z.array(z.enum(["N", "NE", "E", "SE", "S", "SW", "W", "NW"])).max(8)
    .refine((directions) => new Set(directions).size === directions.length),
  landings: z.array(landing).max(100).refine((items) => new Set(items.map((item) => item.id)).size === items.length),
  details: siteDetails,
}).strict();
const signature = z.array(z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict()).min(2).max(600))
  .min(1).max(100).refine((strokes) => strokes.reduce((n, stroke) => n + stroke.length, 0) <= 600 &&
    strokes.some((stroke) => stroke.some((point) => point.x !== stroke[0].x || point.y !== stroke[0].y)));
const participant = z.object({
  id: uuid,
  memberId: uuid.nullable(),
  name: short,
  role: z.enum(["pilot", "passenger", "coordinator", "driver"]),
}).strict();
const flight = z.object({
  startsAt: z.iso.datetime({ offset: true }),
  siteId: uuid,
  status: z.enum(["planned", "done", "cancelled"]),
  notes: z.string().trim().max(4000),
  participants: z.array(participant).max(200),
  tandemFlights: z.array(z.object({
    pilotId: uuid,
    passengerId: uuid,
    durationMinutes: z.number().int().min(0).max(10000).nullable(),
    passengerFormCompleted: z.boolean(),
    receiptReference: z.string().trim().max(100).nullable(),
    observations: z.string().trim().max(4000),
  }).strict()).max(100),
}).strict().superRefine((value, context) => {
  const local = value.startsAt.slice(0, 16);
  const instant = new Date(value.startsAt);
  if (!Number.isNaN(instant.getTime())) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Casablanca", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(instant);
    const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value;
    if (`${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}` !== local) {
      context.addIssue({ code: "custom", message: "Offset does not match Casablanca time" });
    }
  }
  const people = new Map(value.participants.map((p) => [p.id, p]));
  if (people.size !== value.participants.length) {
    context.addIssue({ code: "custom", message: "Duplicate participant ID" });
  }
  for (const tandem of value.tandemFlights) {
    if (people.get(tandem.pilotId)?.role !== "pilot" || people.get(tandem.passengerId)?.role !== "passenger") {
      context.addIssue({ code: "custom", message: "Invalid tandem participants" });
    }
  }
});
const equipment = z.object({
  identifier: short, designation: short,
  makeModel: z.string().trim().max(200), sizeRating: z.string().trim().max(200),
  acquiredOn: optionalDate, lastInspectionOn: optionalDate, reserveRepackedOn: optionalDate,
  condition: short,
}).strict();
const loan = z.object({
  equipmentId: uuid, borrowerName: short, memberId: uuid.nullable(),
  loanedOn: z.iso.date(), expectedReturnOn: optionalDate, conditionOut: short,
}).strict().refine((v) => !v.expectedReturnOn || v.expectedReturnOn >= v.loanedOn);
const loanReturn = z.object({ returnedOn: z.iso.date(), conditionIn: short }).strict();

async function audit(client: PoolClient, actor: Identity, action: string, type: string, id: string, details: unknown) {
  await client.query(
    "INSERT INTO audit_events(actor_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5)",
    [actor.objectId, action, type, id, JSON.stringify(details)],
  );
}

async function transaction<T>(db: Db, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

class OperationError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

export function createOperationsRouter(db: Db) {
  const router = Router();

  router.get("/sites", async (_req, res) => {
    const sites = await db.query(`SELECT id,name,latitude::float8,longitude::float8,municipality,status,
      wind_directions AS "windDirections",details,revision,validated_at AS "validatedAt",validated_by AS "validatedBy",signature
      FROM flight_sites WHERE archived_at IS NULL ORDER BY name,id`);
    const landings = await db.query(`SELECT id,site_id AS "siteId",name,latitude::float8,longitude::float8,landing_type AS type,polygon
      FROM site_landings WHERE removed_at IS NULL ORDER BY name,id`);
    res.json(sites.rows.map((site) => ({ ...site, landings: landings.rows.filter((item) => item.siteId === site.id) })));
  });

  async function saveSite(client: PoolClient, id: string, data: z.infer<typeof siteSchema>) {
    const existing = await client.query<{ id: string }>("SELECT id FROM site_landings WHERE site_id=$1 AND removed_at IS NULL FOR UPDATE", [id]);
    const keep = new Set(data.landings.map((item) => item.id));
    for (const item of existing.rows) {
      if (!keep.has(item.id)) await client.query("UPDATE site_landings SET removed_at=now() WHERE id=$1", [item.id]);
    }
    for (const item of data.landings) {
      if (existing.rows.some((previous) => previous.id === item.id)) {
        await client.query("UPDATE site_landings SET name=$2,landing_type=$3,polygon=$4 WHERE id=$1",
          [item.id, item.name, item.type, JSON.stringify(item.polygon)]);
      } else {
        await client.query("INSERT INTO site_landings(id,site_id,name,latitude,longitude,landing_type,polygon) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [item.id, id, item.name, item.polygon[0].latitude, item.polygon[0].longitude, item.type, JSON.stringify(item.polygon)]);
      }
    }
  }

  router.post("/sites", async (req, res) => {
    const permission = await sitePermissions(db, res.locals.identity as Identity);
    if (!permission.siteTeam && !permission.securityManager) { res.status(403).json({ error: "forbidden" }); return; }
    const parsed = siteSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "invalid_site" }); return; }
    const d = parsed.data; const id = randomUUID();
    await transaction(db, async (client) => {
      await client.query(`INSERT INTO flight_sites(id,name,latitude,longitude,municipality,status,wind_directions,details)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [id, d.name, d.latitude, d.longitude, d.municipality, d.status, d.windDirections, JSON.stringify(d.details)]);
      await saveSite(client, id, d);
      await audit(client, res.locals.identity, "create", "site", id, d);
    });
    res.status(201).json({ id });
  });

  router.put("/sites/:id", async (req, res) => {
    const permission = await sitePermissions(db, res.locals.identity as Identity);
    if (!permission.siteTeam && !permission.securityManager) { res.status(403).json({ error: "forbidden" }); return; }
    const id = uuid.safeParse(req.params.id); const parsed = siteSchema.safeExtend({ expectedRevision: z.number().int().positive() }).safeParse(req.body);
    if (!id.success || !parsed.success) { res.status(400).json({ error: "invalid_site" }); return; }
    const d = parsed.data;
    await transaction(db, async (client) => {
      const before = await client.query("SELECT * FROM flight_sites WHERE id=$1 AND archived_at IS NULL FOR UPDATE", [id.data]);
      if (!before.rowCount) throw new OperationError(404, "site_not_found");
      if (before.rows[0].revision !== d.expectedRevision) throw new OperationError(409, "site_changed");
      const previousLandings = await client.query("SELECT * FROM site_landings WHERE site_id=$1 AND removed_at IS NULL", [id.data]);
      const old = before.rows[0];
      const sameDetails = Object.entries(d.details).every(([key, value]) => (old.details[key] ?? (key === "tandem" ? "unknown" : "")) === value);
      const sameLandings = previousLandings.rows.length === d.landings.length && d.landings.every((item) => {
        const previous = previousLandings.rows.find((row) => row.id === item.id);
        return previous && previous.name === item.name && previous.landing_type === item.type &&
          JSON.stringify(previous.polygon) === JSON.stringify(item.polygon);
      });
      if (old.name === d.name && Number(old.latitude) === d.latitude && Number(old.longitude) === d.longitude &&
          old.municipality === d.municipality && old.status === d.status && sameDetails && sameLandings &&
          JSON.stringify([...old.wind_directions].sort()) === JSON.stringify([...d.windDirections].sort())) return;
      // Row locks serialize edits, validation and flight creation against the same revision.
      await client.query(`UPDATE flight_sites SET name=$2,latitude=$3,longitude=$4,municipality=$5,status=$6,
        wind_directions=$7,details=$8,revision=revision+1,validated_at=NULL,validated_by=NULL,signature=NULL,updated_at=now() WHERE id=$1`,
      [id.data, d.name, d.latitude, d.longitude, d.municipality, d.status, d.windDirections, JSON.stringify(d.details)]);
      await saveSite(client, id.data, d);
      await audit(client, res.locals.identity, "update", "site", id.data, { before: before.rows[0], landings: previousLandings.rows, after: d });
    });
    res.json({ id: id.data });
  });

  router.post("/sites/:id/validate", async (req, res) => {
      const permission = await sitePermissions(db, res.locals.identity as Identity);
      if (!permission.securityManager) { res.status(403).json({ error: "forbidden" }); return; }
      const id = uuid.safeParse(req.params.id);
      const parsed = z.object({ expectedRevision: z.number().int().positive(), validated: z.literal(true), signature }).strict().safeParse(req.body);
      if (!id.success || !parsed.success) { res.status(400).json({ error: "invalid_validation" }); return; }
      await transaction(db, async (client) => {
        const current = await client.query("SELECT revision FROM flight_sites WHERE id=$1 AND archived_at IS NULL FOR UPDATE", [id.data]);
        if (!current.rowCount) throw new OperationError(404, "site_not_found");
        if (current.rows[0].revision !== parsed.data.expectedRevision) throw new OperationError(409, "site_changed");
        const landings = await client.query<{ polygon: unknown }>("SELECT polygon FROM site_landings WHERE site_id=$1 AND removed_at IS NULL", [id.data]);
        if (!landings.rowCount || landings.rows.some((row) => !z.array(z.object(coordinates).strict()).min(4).max(7).refine(validPolygon).safeParse(row.polygon).success)) {
          throw new OperationError(409, "valid_landings_required");
        }
        await client.query("UPDATE flight_sites SET validated_at=now(),validated_by=$2,signature=$3,revision=revision+1,updated_at=now() WHERE id=$1",
          [id.data, (res.locals.identity as Identity).objectId, JSON.stringify(parsed.data.signature)]);
        await audit(client, res.locals.identity, "validate", "site", id.data, { revision: parsed.data.expectedRevision });
      });
      res.status(204).end();
  });

  router.post("/sites/:id/archive", async (req, res) => {
    if ((res.locals.identity as Identity).role !== "special_admin") { res.status(403).json({ error: "forbidden" }); return; }
    const id = uuid.safeParse(req.params.id);
    if (!id.success) { res.status(400).json({ error: "invalid_id" }); return; }
    await transaction(db, async (client) => {
      const result = await client.query("UPDATE flight_sites SET archived_at=now(),updated_at=now() WHERE id=$1 AND archived_at IS NULL RETURNING id", [id.data]);
      if (!result.rowCount) throw new OperationError(404, "site_not_found");
      await audit(client, res.locals.identity, "archive", "site", id.data, {});
    });
    res.status(204).end();
  });

  router.get("/flights", async (_req, res) => {
    const activities = await db.query(
      `SELECT id, starts_at AS "startsAt", site,site_id AS "siteId",status,notes,revision FROM flight_activities ORDER BY starts_at DESC, id`,
    );
    const participants = await db.query(
      `SELECT p.id,p.activity_id AS "activityId",p.member_id AS "memberId",p.name,p.role
       FROM flight_participants p JOIN flight_activities a ON a.id=p.activity_id AND a.revision=p.revision ORDER BY p.name,p.id`,
    );
    const tandems = await db.query(
      `SELECT t.id,t.activity_id AS "activityId",t.pilot_id AS "pilotId",t.passenger_id AS "passengerId",
       t.duration_minutes AS "durationMinutes",t.passenger_form_completed AS "passengerFormCompleted",
       t.receipt_reference AS "receiptReference",t.observations FROM tandem_flights t
       JOIN flight_activities a ON a.id=t.activity_id AND a.revision=t.revision`,
    );
    const notes = await db.query(`SELECT id,flight_id AS "flightId",author_id AS "authorId",body,created_at AS "createdAt"
      FROM flight_notes ORDER BY created_at,id`);
    res.json(activities.rows.map((item) => ({
      ...item,
      participants: participants.rows.filter((p) => p.activityId === item.id),
      tandemFlights: tandems.rows.filter((t) => t.activityId === item.id),
      additionalNotes: notes.rows.filter((note) => note.flightId === item.id),
    })));
  });

  router.put("/flights/:id", async (req, res) => {
    const id = uuid.safeParse(req.params.id);
    const parsed = flight.safeExtend({ expectedRevision: z.number().int().positive() }).safeParse(req.body);
    if (!id.success || !parsed.success) { res.status(400).json({ error: "invalid_flight" }); return; }
    const data = parsed.data;
    await transaction(db, async (client) => {
      const current = await client.query<{ revision: number; status: string }>("SELECT * FROM flight_activities WHERE id=$1 FOR UPDATE", [id.data]);
      if (!current.rowCount) throw new OperationError(404, "flight_not_found");
      if (current.rows[0].revision !== data.expectedRevision) throw new OperationError(409, "flight_changed");
      if (current.rows[0].status !== "planned") throw new OperationError(409, "flight_final");
      const site = await client.query<{ name: string }>("SELECT name FROM flight_sites WHERE id=$1 AND status='open' AND archived_at IS NULL AND validated_at IS NOT NULL FOR UPDATE", [data.siteId]);
      if (!site.rowCount) throw new OperationError(409, "site_not_open");
      const revision = current.rows[0].revision + 1;
      for (const person of data.participants) {
        if (person.memberId) {
          const member = await client.query("SELECT id FROM members WHERE id=$1", [person.memberId]);
          if (!member.rowCount) throw new OperationError(400, "invalid_member");
        }
        await client.query("INSERT INTO flight_participants(id,activity_id,member_id,name,role,revision) VALUES($1,$2,$3,$4,$5,$6)",
          [person.id, id.data, person.memberId, person.name, person.role, revision]);
      }
      for (const tandem of data.tandemFlights) {
        await client.query(
          `INSERT INTO tandem_flights(id,activity_id,pilot_id,passenger_id,duration_minutes,passenger_form_completed,receipt_reference,observations,revision)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [randomUUID(), id.data, tandem.pilotId, tandem.passengerId, tandem.durationMinutes,
            tandem.passengerFormCompleted, tandem.receiptReference, tandem.observations, revision],
        );
      }
      await client.query("UPDATE flight_activities SET starts_at=$2,site=$3,site_id=$4,status=$5,notes=$6,revision=$7,updated_at=now() WHERE id=$1",
        [id.data, data.startsAt, site.rows[0].name, data.siteId, data.status, data.notes, revision]);
      await audit(client, res.locals.identity, "update", "flight", id.data, { before: current.rows[0], after: data, revision });
    });
    res.json({ id: id.data });
  });

  router.post("/flights", async (req, res) => {
    const parsed = flight.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "invalid_flight" }); return; }
    const data = parsed.data;
    if (data.status !== "planned") { res.status(400).json({ error: "flight_must_start_planned" }); return; }
    const id = randomUUID();
    await transaction(db, async (client) => {
      const site = await client.query<{ name: string }>("SELECT name FROM flight_sites WHERE id=$1 AND status='open' AND archived_at IS NULL AND validated_at IS NOT NULL FOR UPDATE", [data.siteId]);
      if (!site.rowCount) throw new OperationError(409, "site_not_open");
      for (const person of data.participants) {
        if (person.memberId) {
          const member = await client.query("SELECT id FROM members WHERE id=$1 AND archived_at IS NULL", [person.memberId]);
          if (!member.rowCount) throw new OperationError(400, "invalid_member");
        }
      }
      await client.query("INSERT INTO flight_activities(id,starts_at,site,site_id,status,notes) VALUES ($1,$2,$3,$4,$5,$6)", [id, data.startsAt, site.rows[0].name, data.siteId, data.status, data.notes]);
      for (const person of data.participants) {
        await client.query("INSERT INTO flight_participants(id,activity_id,member_id,name,role) VALUES($1,$2,$3,$4,$5)",
          [person.id, id, person.memberId, person.name, person.role]);
      }
      for (const tandem of data.tandemFlights) {
        await client.query(
          `INSERT INTO tandem_flights(id,activity_id,pilot_id,passenger_id,duration_minutes,passenger_form_completed,receipt_reference,observations)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
          [randomUUID(), id, tandem.pilotId, tandem.passengerId, tandem.durationMinutes,
            tandem.passengerFormCompleted, tandem.receiptReference, tandem.observations],
        );
      }
      await audit(client, res.locals.identity, "create", "flight", id, data);
      await queueEvent(client, res.locals.identity, "flight_planned", id);
    });
    res.status(201).json({ id });
  });

  router.post("/flights/:id/notes", async (req, res) => {
    const id = uuid.safeParse(req.params.id);
    const body = z.object({ body: z.string().trim().min(1).max(4000) }).strict().safeParse(req.body);
    if (!id.success || !body.success) { res.status(400).json({ error: "invalid_note" }); return; }
    const noteId = randomUUID();
    await transaction(db, async (client) => {
      const flight = await client.query<{ status: string }>("SELECT status FROM flight_activities WHERE id=$1 FOR UPDATE", [id.data]);
      if (!flight.rowCount) throw new OperationError(404, "flight_not_found");
      if (flight.rows[0].status === "planned") throw new OperationError(409, "flight_not_final");
      await client.query("INSERT INTO flight_notes(id,flight_id,author_id,body) VALUES($1,$2,$3,$4)", [noteId, id.data, (res.locals.identity as Identity).objectId, body.data.body]);
      await audit(client, res.locals.identity, "create", "flight_note", noteId, { flightId: id.data });
    });
    res.status(201).json({ id: noteId });
  });

  router.get("/equipment", async (_req, res) => {
    const result = await db.query(
      `SELECT id,identifier,designation,make_model AS "makeModel",size_rating AS "sizeRating",
        acquired_on AS "acquiredOn",last_inspection_on AS "lastInspectionOn",reserve_repacked_on AS "reserveRepackedOn",
        condition FROM equipment WHERE archived_at IS NULL ORDER BY identifier`,
    );
    res.json(result.rows);
  });

  router.post("/equipment", async (req, res) => {
    const parsed = equipment.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "invalid_equipment" }); return; }
    const d = parsed.data;
    const id = randomUUID();
    await transaction(db, async (client) => {
      await client.query(
        `INSERT INTO equipment(id,identifier,designation,make_model,size_rating,acquired_on,last_inspection_on,reserve_repacked_on,condition)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id, d.identifier, d.designation, d.makeModel, d.sizeRating, d.acquiredOn, d.lastInspectionOn, d.reserveRepackedOn, d.condition],
      );
      await audit(client, res.locals.identity, "create", "equipment", id, d);
      await queueEvent(client, res.locals.identity, "gear_added", id);
    });
    res.status(201).json({ id, ...d });
  });

  router.post("/equipment/:id/archive", async (req, res) => {
    if ((res.locals.identity as Identity).role !== "special_admin") { res.status(403).json({ error: "forbidden" }); return; }
    const id = uuid.safeParse(req.params.id);
    if (!id.success) { res.status(400).json({ error: "invalid_id" }); return; }
    await transaction(db, async (client) => {
      const item = await client.query("SELECT id FROM equipment WHERE id=$1 AND archived_at IS NULL FOR UPDATE", [id.data]);
      if (!item.rowCount) throw new OperationError(404, "equipment_not_found");
      if ((await client.query("SELECT id FROM equipment_loans WHERE equipment_id=$1 AND returned_on IS NULL", [id.data])).rowCount) {
        throw new OperationError(409, "equipment_already_loaned");
      }
      await client.query("UPDATE equipment SET archived_at=now(),updated_at=now() WHERE id=$1", [id.data]);
      await audit(client, res.locals.identity, "archive", "equipment", id.data, {});
      await queueEvent(client, res.locals.identity, "gear_removed", id.data);
    });
    res.status(204).end();
  });

  router.put("/equipment/:id", async (req, res) => {
    const id = uuid.safeParse(req.params.id);
    const parsed = equipment.safeParse(req.body);
    if (!id.success || !parsed.success) { res.status(400).json({ error: "invalid_equipment" }); return; }
    const d = parsed.data;
    await transaction(db, async (client) => {
      const previous = await client.query("SELECT * FROM equipment WHERE id=$1 AND archived_at IS NULL FOR UPDATE", [id.data]);
      if (!previous.rowCount) throw new OperationError(404, "equipment_not_found");
      await client.query(
        `UPDATE equipment SET identifier=$2,designation=$3,make_model=$4,size_rating=$5,acquired_on=$6,
         last_inspection_on=$7,reserve_repacked_on=$8,condition=$9,updated_at=now() WHERE id=$1`,
        [id.data, d.identifier, d.designation, d.makeModel, d.sizeRating, d.acquiredOn, d.lastInspectionOn, d.reserveRepackedOn, d.condition],
      );
      await audit(client, res.locals.identity, "update", "equipment", id.data, { before: previous.rows[0], after: d });
    });
    res.json({ id: id.data, ...d });
  });

  router.get("/loans", async (_req, res) => {
    const result = await db.query(
      `SELECT l.id,l.equipment_id AS "equipmentId",e.identifier,l.borrower_name AS "borrowerName",
       l.member_id AS "memberId",l.loaned_on AS "loanedOn",l.expected_return_on AS "expectedReturnOn",
       l.returned_on AS "returnedOn",l.condition_out AS "conditionOut",l.condition_in AS "conditionIn"
       FROM equipment_loans l JOIN equipment e ON e.id=l.equipment_id ORDER BY l.loaned_on DESC,l.id`,
    );
    res.json(result.rows);
  });

  router.post("/loans", async (req, res) => {
    const parsed = loan.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "invalid_loan" }); return; }
    const d = parsed.data;
    const id = randomUUID();
    await transaction(db, async (client) => {
      const item = await client.query("SELECT id FROM equipment WHERE id=$1 AND archived_at IS NULL FOR UPDATE", [d.equipmentId]);
      if (!item.rowCount) throw new OperationError(404, "equipment_not_found");
      if (d.memberId) {
        const member = await client.query("SELECT id FROM members WHERE id=$1 AND archived_at IS NULL", [d.memberId]);
        if (!member.rowCount) throw new OperationError(400, "invalid_member");
      }
      const existing = await client.query("SELECT id FROM equipment_loans WHERE equipment_id=$1 AND returned_on IS NULL", [d.equipmentId]);
      if (existing.rowCount) throw new OperationError(409, "equipment_already_loaned");
      await client.query(
        `INSERT INTO equipment_loans(id,equipment_id,borrower_name,member_id,loaned_on,expected_return_on,condition_out)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [id, d.equipmentId, d.borrowerName, d.memberId, d.loanedOn, d.expectedReturnOn, d.conditionOut],
      );
      await audit(client, res.locals.identity, "create", "loan", id, d);
    });
    res.status(201).json({ id, ...d });
  });

  router.post("/loans/:id/return", async (req, res) => {
    const id = uuid.safeParse(req.params.id);
    const parsed = loanReturn.safeParse(req.body);
    if (!id.success || !parsed.success) { res.status(400).json({ error: "invalid_return" }); return; }
    const d = parsed.data;
    await transaction(db, async (client) => {
      const result = await client.query<{ loaned_on: Date | string; returned_on: Date | string | null }>(
        "SELECT loaned_on,returned_on FROM equipment_loans WHERE id=$1 FOR UPDATE", [id.data],
      );
      if (!result.rows[0]) throw new OperationError(404, "loan_not_found");
      if (result.rows[0].returned_on) throw new OperationError(409, "loan_already_returned");
      const loanedDate = result.rows[0].loaned_on;
      const day = loanedDate instanceof Date ? loanedDate.toISOString().slice(0, 10) : String(loanedDate).slice(0, 10);
      if (d.returnedOn < day) throw new OperationError(400, "invalid_return_date");
      await client.query("UPDATE equipment_loans SET returned_on=$2,condition_in=$3 WHERE id=$1", [id.data, d.returnedOn, d.conditionIn]);
      await audit(client, res.locals.identity, "return", "loan", id.data, d);
    });
    res.status(204).end();
  });

  router.use((error: unknown, _req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
    if (error instanceof OperationError) { res.status(error.status).json({ error: error.code }); return; }
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      res.status(409).json({ error: "duplicate_record" });
      return;
    }
    next(error);
  });
  return router;
}
