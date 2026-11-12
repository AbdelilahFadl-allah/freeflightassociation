import "dotenv/config";
import { z } from "zod";

const configSchema = z.object({
  DATABASE_URL: z.string().url(),
  ENTRA_TENANT_ID: z.string().uuid(),
  ENTRA_API_CLIENT_ID: z.string().uuid(),
  ENTRA_API_AUDIENCES: z.string().min(1),
  BOOTSTRAP_ADMIN_OBJECT_ID: z.string().uuid(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = configSchema.parse(env);
  // Support both configured API audience forms without accepting an empty audience list.
  const audiences = parsed.ENTRA_API_AUDIENCES.split(",").map((x) => x.trim()).filter(Boolean);
  if (!audiences.length) throw new Error("ENTRA_API_AUDIENCES must contain at least one audience");
  return { ...parsed, audiences };
}

export type Config = ReturnType<typeof loadConfig>;
