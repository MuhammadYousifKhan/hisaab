// Database connection. With DATABASE_URL set (Supabase, Neon or any Postgres) the app uses it;
// otherwise it runs an embedded Postgres (PGlite) so the app works with no account or setup.
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { hashSecret } from '@/lib/auth/password';
import { ACCTS } from '@/lib/engine';
import { DDL, accounts, schema, staff } from './schema';

/** The first staff account, created on first start. Set OPS_USERNAME / OPS_PASSWORD / OPS_NAME to choose it. */
export const DEFAULT_OPS = { username: 'sana', password: 'hisaab-ops', name: 'Sana (finance)' };
export const opsFromEnv = () => ({
  username: (process.env.OPS_USERNAME || DEFAULT_OPS.username).trim().toLowerCase(),
  password: process.env.OPS_PASSWORD || DEFAULT_OPS.password,
  name: process.env.OPS_NAME || (process.env.OPS_USERNAME ? process.env.OPS_USERNAME : DEFAULT_OPS.name),
  isDefault: !process.env.OPS_PASSWORD,
});

export type DB = PgliteDatabase<typeof schema>;
interface Conn { db: DB; exec: (sql: string) => Promise<void>; kind: 'pglite' | 'postgres'; where: string }

const g = globalThis as unknown as { __hisaabConn?: Promise<Conn> };

function pgliteDir(): string {
  if (process.env.PGLITE_DIR) return process.env.PGLITE_DIR;
  if (process.env.VERCEL) return '/tmp/hisaab-pglite';
  return path.join(process.cwd(), '.data', 'pglite');
}

async function connect(dataDir?: string): Promise<Conn> {
  let conn: Conn;
  if (process.env.DATABASE_URL && !dataDir) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
    conn = {
      db: drizzlePg({ client: pool, schema }) as unknown as DB,
      exec: async sql => { await pool.query(sql); },
      kind: 'postgres', where: 'DATABASE_URL',
    };
  } else {
    const dir = dataDir || pgliteDir();
    if (dir !== 'memory://') mkdirSync(dir, { recursive: true });
    const client = new PGlite(dir === 'memory://' ? undefined : dir);
    await client.waitReady;
    conn = { db: drizzlePglite({ client, schema }), exec: async sql => { await client.exec(sql); }, kind: 'pglite', where: dir };
  }
  await conn.exec(DDL);
  await conn.db.insert(accounts).values(Object.entries(ACCTS).map(([code, a]) => ({ code, name: a.name, type: a.type }))).onConflictDoNothing();
  const [{ n }] = await conn.db.select({ n: sql<number>`count(*)::int` }).from(staff);
  if (!Number(n)) {
    const o = opsFromEnv();
    await conn.db.insert(staff).values({ username: o.username, name: o.name, passHash: await hashSecret(o.password) }).onConflictDoNothing();
  }
  return conn;
}

/** One shared connection per server process (survives dev hot reloads). */
export function getConn(): Promise<Conn> {
  if (!g.__hisaabConn) g.__hisaabConn = connect().catch(err => { g.__hisaabConn = undefined; throw err; });
  return g.__hisaabConn;
}

/** A private in-memory database, for tests. */
export function memoryConn(): Promise<Conn> { return connect('memory://'); }
export type { Conn };
