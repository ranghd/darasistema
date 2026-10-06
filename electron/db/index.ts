import path from "node:path";
import { app } from "electron";
import { createDatabase, type DB } from "./sqlite";
import { SCHEMA_SQL } from "./schema";
import { seedIfEmpty, seedUsuarioAdmin } from "./seed";

let db: DB | null = null;

export async function getDb(): Promise<DB> {
  if (db) return db;

  const userDataDir = app.getPath("userData");
  const dbPath = path.join(userDataDir, "darasistema.db");

  db = await createDatabase(dbPath);
  db.exec(SCHEMA_SQL);
  seedIfEmpty(db);
  seedUsuarioAdmin(db);
  db.persist();

  return db;
}
