import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const rawDatabaseUrl = process.env.DATABASE_URL;

if (!rawDatabaseUrl) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Supabase's direct PostgreSQL endpoint presents a certificate chain that is
// not included in Render's Node trust store. Keep TLS encryption enabled while
// avoiding pg's sslmode=require upgrade to certificate verification that cannot
// succeed in that runtime. Production should replace this with the Supabase CA
// certificate when the hosting environment provides it.
const databaseUrl = new URL(rawDatabaseUrl);
databaseUrl.searchParams.delete("sslmode");

export const pool = new Pool({
  connectionString: databaseUrl.toString(),
  // Render Free currently has no IPv6 egress, while Supabase's direct host
  // can resolve to AAAA first. Prefer IPv4 so health checks and queries reach
  // the provisioned database from the hosting runtime.
  family: 4,
  ssl: { rejectUnauthorized: false },
});
export const db = drizzle(pool, { schema });

export * from "./schema";
export * from "./rank";
