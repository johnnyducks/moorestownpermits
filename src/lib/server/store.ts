/**
 * Where applications live. Routes and UI talk to the ApplicationStore
 * interface only.
 *
 * - Postgres when DATABASE_URL (or POSTGRES_URL) is set. Use this on Vercel.
 * - A JSON file for local development otherwise. It needs a writable disk and
 *   one server process, so it's refused on Vercel.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Application } from "../permits/application.ts";
import { connect, PostgresStore } from "./postgres.ts";

export interface ApplicationStore {
  listByOwner(ownerId: string): Promise<Application[]>;
  listAll(): Promise<Application[]>;
  get(ref: string): Promise<Application | null>;
  put(app: Application): Promise<void>;
  remove(ref: string): Promise<void>;
}

export class StoreError extends Error {}

export const databaseUrl = () => process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
export const onVercel = () => !!process.env.VERCEL;

export type StoreKind = "postgres" | "file" | "none";
export const storeKind = (): StoreKind => (databaseUrl() ? "postgres" : onVercel() ? "none" : "file");

export const dataDir = () => process.env.PERMITS_DATA_DIR || path.join(process.cwd(), ".data");

const newestFirst = (a: Application, b: Application) => b.createdAt - a.createdAt;

export class FileStore implements ApplicationStore {
  private cache: Map<string, Application> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  private file: string;

  constructor(file: string) {
    this.file = file;
  }

  private async load(): Promise<Map<string, Application>> {
    if (this.cache) return this.cache;
    try {
      const raw = JSON.parse(await fs.readFile(this.file, "utf8")) as { applications?: Application[] };
      this.cache = new Map((raw.applications ?? []).map((a) => [a.ref, a]));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      this.cache = new Map();
    }
    return this.cache;
  }

  /** Runs mutations one at a time and writes the file atomically. */
  private mutate(fn: (m: Map<string, Application>) => void): Promise<void> {
    const run = this.queue.then(async () => {
      const m = await this.load();
      fn(m);
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${randomBytes(4).toString("hex")}.tmp`;
      await fs.writeFile(tmp, JSON.stringify({ applications: [...m.values()] }, null, 1));
      await fs.rename(tmp, this.file);
    });
    this.queue = run.catch(() => {});
    return run;
  }

  async listByOwner(ownerId: string) {
    return [...(await this.load()).values()].filter((a) => a.ownerId === ownerId).sort(newestFirst);
  }
  async listAll() {
    return [...(await this.load()).values()].sort(newestFirst);
  }
  async get(ref: string) {
    return (await this.load()).get(ref) ?? null;
  }
  put(app: Application) {
    return this.mutate((m) => void m.set(app.ref, app));
  }
  remove(ref: string) {
    return this.mutate((m) => void m.delete(ref));
  }
}

// One store per server process, kept across dev hot reloads.
const g = globalThis as unknown as { __permitsStore?: ApplicationStore };

export function getStore(): ApplicationStore {
  if (g.__permitsStore) return g.__permitsStore;
  switch (storeKind()) {
    case "postgres":
      return (g.__permitsStore = new PostgresStore(connect(databaseUrl())));
    case "file":
      return (g.__permitsStore = new FileStore(path.join(dataDir(), "applications.json")));
    case "none":
      throw new StoreError("Storage isn't set up. Add a Postgres database to this Vercel project (DATABASE_URL).");
  }
}

/** The Postgres store, when that's what's in use (for shared rate limits). */
export function postgresStore(): PostgresStore | null {
  if (storeKind() !== "postgres") return null;
  const s = getStore();
  return s instanceof PostgresStore ? s : null;
}
