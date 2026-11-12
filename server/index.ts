import { loadConfig } from "./config";
import { createPool } from "./db";
import { createAuthenticate } from "./auth";
import { createApp } from "./app";
import { createTwilioProvider } from "./whatsapp";
import express from "express";
import { resolve } from "node:path";

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const app = createApp(pool, createAuthenticate(config, pool), createTwilioProvider(process.env));
if (process.env.NODE_ENV === "production") {
  // Register the SPA fallback after API routes so API errors never become HTML responses.
  const dist = resolve("dist");
  app.use(express.static(dist, { index: false, fallthrough: true }));
  app.get("/{*path}", (_req, res) => res.sendFile(resolve(dist, "index.html")));
}
app.listen(config.PORT, () => {
  console.log(`API listening on port ${config.PORT}`);
});
