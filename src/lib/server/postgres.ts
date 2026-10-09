/**
 * Postgres storage: applications and rate-limit counters. Works with any
 * Postgres connection string (Neon via the Vercel Marketplace, Supabase,
 * local). Tables are created on first use; see db/schema.sql.
 *
 * Each application is one row: indexed columns for lookups plus the full
 * record as JSONB, so the record shape can evolve without migrations.
 */
import postgres from "postgres";
import type { Application } from "../permits/application.ts";
import type { ApplicationStore } from "./store.ts";

export const SCHEMA = `
create table if not exists applications (
  ref         text primary key,
  owner_id    text not null,
  status      text not null,
  created_at  timestamptz not null,
  updated_at  timestamptz not null,
  data        jsonb not null
);
create index if not exists applications_owner_idx on applications (owner_id, created_at desc);
create index if not exists applications_created_idx on applications (created_at desc);

create table if not exists rate_limits (
  key           text primary key,
  window_start  bigint not null,
  count         integer not null
);
`;

type Sql = ReturnType<typeof postgres>;

export class PostgresStore implements ApplicationStore {
  private ready: Promise<unknown> | null = null;

  readonly sql: Sql;

  constructor(sql: Sql) {
    this.sql = sql;
  }

  /** Creates the tables once per process. */
  init(): Promise<unknown> {
    return (this.ready ??= this.sql.unsafe(SCHEMA).catch((e) => {
      this.ready = null;
      throw e;
    }));
  }

  private async rows(q: Promise<{ data: Application }[]>) {
    return (await q).map((r) => r.data);
  }

  async listByOwner(ownerId: string) {
    await this.init();
    return this.rows(this.sql<{ data: Application }[]>`select data from applications where owner_id = ${ownerId} order by created_at desc`);
  }

  async listAll() {
    await this.init();
    return this.rows(this.sql<{ data: Application }[]>`select data from applications order by created_at desc limit 1000`);
  }

  async get(ref: string) {
    await this.init();
    const [row] = await this.sql<{ data: Application }[]>`select data from applications where ref = ${ref}`;
    return row?.data ?? null;
  }

  async put(a: Application) {
    await this.init();
    await this.sql`
      insert into applications (ref, owner_id, status, created_at, updated_at, data)
      values (${a.ref}, ${a.ownerId}, ${a.status}, ${new Date(a.createdAt)}, ${new Date(a.updatedAt)}, ${this.sql.json(a as never)})
      on conflict (ref) do update set
        owner_id = excluded.owner_id, status = excluded.status, updated_at = excluded.updated_at, data = excluded.data`;
  }

  async remove(ref: string) {
    await this.init();
    await this.sql`delete from applications where ref = ${ref}`;
  }

  /** Fixed-window counter, atomic across serverless instances. */
  async allow(key: string, max: number, windowMs: number, now = Date.now()): Promise<boolean> {
    await this.init();
    const start = Math.floor(now / windowMs) * windowMs;
    const [row] = await this.sql<{ count: number }[]>`
      insert into rate_limits (key, window_start, count) values (${key}, ${start}, 1)
      on conflict (key) do update set
        count = case when rate_limits.window_start = excluded.window_start then rate_limits.count + 1 else 1 end,
        window_start = excluded.window_start
      returning count`;
    if (Math.random() < 0.01) await this.sql`delete from rate_limits where window_start < ${now - 864e5}`;
    return row.count <= max;
  }
}

export function connect(url: string): Sql {
  // max 1: serverless functions each hold one connection. prepare false: works
  // through transaction poolers (Supabase, Neon pooled URLs).
  return postgres(url, { max: 1, prepare: false, idle_timeout: 20, connect_timeout: 10, onnotice: () => {} });
}
