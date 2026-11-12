import pg from "pg";

export function createPool(connectionString: string) {
  // PostgreSQL DATE represents a calendar day, not a local-time JavaScript instant.
  pg.types.setTypeParser(1082, (value) => value);
  return new pg.Pool({ connectionString });
}

export type Db = Pick<pg.Pool, "query" | "connect">;
