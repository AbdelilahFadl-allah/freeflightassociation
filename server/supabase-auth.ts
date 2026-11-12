import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from "jose";
import { z } from "zod";
import type { Authenticate, Identity } from "./auth";
import type { Db } from "./db";

const userClaims = z.object({
  sub: z.string().uuid(),
  role: z.literal("authenticated"),
  aal: z.literal("aal2"),
  amr: z.array(z.object({ method: z.string() })).refine((entries) => entries.some((entry) => entry.method === "totp")),
});

export function createSupabaseAuthenticate(
  issuer: string,
  db: Db,
  keyResolver?: JWTVerifyGetKey,
): Authenticate {
  const jwks = keyResolver ?? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  return async (authorization) => {
    if (!authorization?.startsWith("Bearer ")) return null;
    let payload;
    try {
      ({ payload } = await jwtVerify(authorization.slice(7), jwks, {
        issuer,
        audience: "authenticated",
        typ: "JWT",
        algorithms: ["ES256", "RS256"],
        requiredClaims: ["exp", "iat", "sub", "role", "aal", "amr"],
      }));
    } catch (error) {
      if (error instanceof errors.JWTClaimValidationFailed ||
          error instanceof errors.JWTExpired ||
          error instanceof errors.JWTInvalid ||
          error instanceof errors.JWSInvalid ||
          error instanceof errors.JWSSignatureVerificationFailed ||
          error instanceof errors.JWKSNoMatchingKey ||
          error instanceof errors.JOSEAlgNotAllowed ||
          error instanceof errors.JOSENotSupported) return null;
      throw error;
    }
    const parsed = userClaims.safeParse(payload);
    if (!parsed.success) return null;
    // Supabase claims establish identity and MFA, not the application's authorization.
    const admin = await db.query<{ role: Identity["role"] }>(
      "SELECT role FROM administrators WHERE object_id = $1 AND active = true",
      [parsed.data.sub],
    );
    return admin.rows[0] ? { objectId: parsed.data.sub, role: admin.rows[0].role } : null;
  };
}
