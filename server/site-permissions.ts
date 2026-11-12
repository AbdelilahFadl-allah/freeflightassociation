import type { Db } from "./db";
import type { Identity } from "./auth";

export async function sitePermissions(db: Db, identity: Identity) {
  // Site capabilities are independent of the administrator's access to other modules.
  if (identity.role === "special_admin") return { siteTeam: true, securityManager: true };
  const result = await db.query<{ siteTeam: boolean; securityManager: boolean }>(
    'SELECT site_team AS "siteTeam",security_manager AS "securityManager" FROM administrator_site_permissions WHERE administrator_id=$1',
    [identity.objectId],
  );
  return result.rows[0] ?? { siteTeam: false, securityManager: false };
}
