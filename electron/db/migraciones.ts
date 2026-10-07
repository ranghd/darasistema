import type { DB } from "./types";

// Agrega columnas nuevas a bases de datos que ya existian antes de una
// actualizacion. Como el schema usa CREATE TABLE IF NOT EXISTS, las columnas
// nuevas no se aplican automaticamente sobre tablas ya creadas.
export function migrar(db: DB) {
  const columnas = [
    `ALTER TABLE productos ADD COLUMN itbis_rate REAL NOT NULL DEFAULT 0.18`,
    `ALTER TABLE facturas ADD COLUMN metodo_pago TEXT`,
  ];
  for (const sql of columnas) {
    try {
      db.exec(sql);
    } catch {
      // la columna ya existe
    }
  }
}
