import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { loadConfig } from "./config";
import { createPool } from "./db";
import { bootstrapAdmin } from "./bootstrap-admin";

const config = loadConfig();
const id = z.string().uuid().parse(process.env.BOOTSTRAP_ADMIN_USER_ID);
const secret = z.string().min(1).parse(process.env.SUPABASE_SERVICE_ROLE_KEY);
const supabase = createClient(config.SUPABASE_URL, secret, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const { data, error } = await supabase.auth.admin.getUserById(id);
if (error || !data.user || data.user.id !== id || !data.user.email_confirmed_at) {
  throw new Error("Bootstrap user could not be verified as an email-confirmed Supabase account.");
}
const pool = createPool(config.DATABASE_URL);
try {
  await bootstrapAdmin(pool, id);
  console.log("Initial special administrator registered.");
} finally {
  await pool.end();
}
