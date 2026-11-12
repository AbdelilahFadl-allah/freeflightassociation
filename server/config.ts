import "dotenv/config";
import { z } from "zod";

const projectUrl = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password &&
    url.pathname === "/" && !url.search && !url.hash;
}, "Supabase URL must be an HTTPS origin");

const configSchema = z.object({
  DATABASE_URL: z.string().url(),
  SUPABASE_URL: projectUrl,
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const config = configSchema.parse(env);
  return { ...config, issuer: `${new URL(config.SUPABASE_URL).origin}/auth/v1` };
}

export type Config = ReturnType<typeof loadConfig>;
