import path from "node:path";
import { app } from "electron";
import { createDatabase, type DB } from "./sqlite";
import { SCHEMA_SQL } from "./schema";
import { migrar } from "./migraciones";
import { seedIfEmpty, seedUsuarios } from "./seed";

let db: DB | null = null;

export async function getDb(): Promise<DB> {
  if (db) return db;

  const userDataDir = app.getPath("userData");
  const dbPath = path.join(userDataDir, "darasistema.db");

  db = await createDatabase(dbPath);
  db.exec(SCHEMA_SQL);
  migrar(db);
  seedIfEmpty(db);
  seedUsuarios(db);
  db.persist();

  return db;
}
