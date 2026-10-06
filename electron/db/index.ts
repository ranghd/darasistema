import path from "node:path";
import { app } from "electron";
import { createDatabase, type DB } from "./sqlite";
import { SCHEMA_SQL } from "./schema";
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

// Agrega columnas nuevas a bases de datos que ya existian antes de una
// actualizacion. Como el schema usa CREATE TABLE IF NOT EXISTS, las columnas
// nuevas no se aplican automaticamente sobre tablas ya creadas.
function migrar(db: DB) {
  try {
    db.exec(`ALTER TABLE productos ADD COLUMN itbis_rate REAL NOT NULL DEFAULT 0.18`);
  } catch {
    // la columna ya existe
  }
}
