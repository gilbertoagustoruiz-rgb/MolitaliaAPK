import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const hasDiscreteConnection = Boolean(
  process.env.PGHOST &&
    process.env.PGPORT &&
    process.env.PGUSER &&
    process.env.PGPASSWORD &&
    process.env.PGDATABASE,
);

if (!process.env.DATABASE_URL && !hasDiscreteConnection) {
  throw new Error(
    "Set DATABASE_URL or PGHOST, PGPORT, PGUSER, PGPASSWORD and PGDATABASE.",
  );
}

// Conexiones simultáneas a PostgreSQL (por defecto 10, igual que antes).
// Ajustable con PG_POOL_MAX según el plan de la base en DigitalOcean.
const poolMax = Math.max(1, Math.floor(Number(process.env.PG_POOL_MAX) || 10));

export const pool = hasDiscreteConnection
  ? new Pool({
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT),
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
      ssl: { rejectUnauthorized: false },
      max: poolMax,
    })
  : new Pool({ connectionString: process.env.DATABASE_URL, max: poolMax });
export const db = drizzle(pool, { schema });

export * from "./schema";
