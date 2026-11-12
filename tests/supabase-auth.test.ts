import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { newDb } from "pg-mem";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSupabaseAuthenticate } from "../server/supabase-auth";

const issuer = "https://example.supabase.co/auth/v1";
const subject = "00000000-0000-4000-8000-000000000001";

describe("Supabase authentication boundary", () => {
  let keys: Awaited<ReturnType<typeof generateKeyPair>>;
  let authenticate: ReturnType<typeof createSupabaseAuthenticate>;
  let pool: InstanceType<ReturnType<ReturnType<typeof newDb>["adapters"]["createPg"]>["Pool"]>;
  let resolver: ReturnType<typeof createLocalJWKSet>;

  beforeAll(async () => {
    keys = await generateKeyPair("ES256");
    resolver = createLocalJWKSet({ keys: [{ ...await exportJWK(keys.publicKey), kid: "test" }] });
  });

  beforeEach(async () => {
    const pg = newDb().adapters.createPg();
    pool = new pg.Pool();
    await pool.query("CREATE TABLE administrators (object_id uuid PRIMARY KEY, role text NOT NULL, active boolean NOT NULL)");
    await pool.query("INSERT INTO administrators VALUES ($1, 'special_admin', true)", [subject]);
    authenticate = createSupabaseAuthenticate(issuer, pool, resolver);
  });

  async function token(overrides: Record<string, unknown> = {}) {
    return new SignJWT({ role: "authenticated", aal: "aal2", ...overrides })
      .setProtectedHeader({ alg: "ES256", typ: "JWT", kid: "test" })
      .setIssuer(issuer)
      .setAudience("authenticated")
      .setSubject(subject)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(keys.privateKey);
  }

  it("accepts only locally authorized MFA users", async () => {
    const bearer = `Bearer ${await token()}`;
    expect(await authenticate(bearer)).toEqual({ objectId: subject, role: "special_admin" });
    await pool.query("UPDATE administrators SET active = false");
    expect(await authenticate(bearer)).toBeNull();
    await pool.query("DELETE FROM administrators");
    expect(await authenticate(bearer)).toBeNull();
  });

  it("rejects incomplete MFA and non-user tokens", async () => {
    expect(await authenticate(`Bearer ${await token({ aal: "aal1" })}`)).toBeNull();
    expect(await authenticate(`Bearer ${await token({ role: "service_role" })}`)).toBeNull();
    expect(await authenticate(undefined)).toBeNull();
    expect(await authenticate("Bearer invalid")).toBeNull();
    const symmetric = await new SignJWT({ role: "authenticated", aal: "aal2" })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer(issuer).setAudience("authenticated").setSubject(subject)
      .setIssuedAt().setExpirationTime("5m").sign(new Uint8Array(32));
    expect(await authenticate(`Bearer ${symmetric}`)).toBeNull();
  });

  it("rejects wrong issuer, audience, expiration, type and signature", async () => {
    const make = async (claim: { iss?: string; aud?: string; exp?: number }, typ = "JWT", otherKey = keys.privateKey) =>
      new SignJWT({ role: "authenticated", aal: "aal2", sub: subject, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60, iss: issuer, aud: "authenticated", ...claim })
        .setProtectedHeader({ alg: "ES256", typ, kid: "test" }).sign(otherKey);
    const other = await generateKeyPair("ES256");
    for (const invalid of [
      await make({ iss: "https://other.supabase.co/auth/v1" }),
      await make({ aud: "other" }),
      await make({ exp: Math.floor(Date.now() / 1000) - 1 }),
      await make({}, "other"),
      await make({}, "JWT", other.privateKey),
    ]) expect(await authenticate(`Bearer ${invalid}`)).toBeNull();
  });
});
