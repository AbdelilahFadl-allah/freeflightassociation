import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from "jose";
import { z } from "zod";
import type { Config } from "./config";
import type { Db } from "./db";

const claims = z.object({
  oid: z.string().uuid(),
  tid: z.string().uuid(),
  scp: z.string().min(1),
});

export type Identity = { objectId: string; role: "admin" | "special_admin" };
export type Authenticate = (authorization: string | undefined) => Promise<Identity | null>;

export function createAuthenticate(config: Config, db: Db, keyResolver?: JWTVerifyGetKey): Authenticate {
  const jwks = keyResolver ?? createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${config.ENTRA_TENANT_ID}/discovery/v2.0/keys`));
  const issuer = `https://login.microsoftonline.com/${config.ENTRA_TENANT_ID}/v2.0`;
  return async (authorization) => {
    if (!authorization?.startsWith("Bearer ")) return null;
    let payload;
    try {
      ({ payload } = await jwtVerify(authorization.slice(7), jwks, {
        issuer,
        audience: config.audiences,
        algorithms: ["RS256"],
        requiredClaims: ["exp", "iat", "tid", "oid", "scp"],
      }));
    } catch (error) {
      if (error instanceof errors.JWTClaimValidationFailed ||
          error instanceof errors.JWTExpired ||
          error instanceof errors.JWTInvalid ||
          error instanceof errors.JWSInvalid ||
          error instanceof errors.JWSSignatureVerificationFailed ||
          error instanceof errors.JWKSNoMatchingKey ||
          error instanceof errors.JOSENotSupported) return null;
      throw error;
    }
    const result = claims.safeParse(payload);
    if (!result.success || result.data.tid.toLowerCase() !== config.ENTRA_TENANT_ID.toLowerCase()) return null;
    if (!result.data.scp.split(" ").includes("access_as_user")) return null;
    // A valid Entra token alone is insufficient: local administrator access may have been revoked.
    const admin = await db.query<{ role: Identity["role"] }>(
      "SELECT role FROM administrators WHERE object_id = $1 AND active = true",
      [result.data.oid],
    );
    return admin.rows[0] ? { objectId: result.data.oid, role: admin.rows[0].role } : null;
  };
}
