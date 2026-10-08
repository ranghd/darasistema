import type { DB } from "./types";
import { cuadrarInventarioContable } from "./contabilidad";
import { proveedoresDesdeComprasAnteriores } from "./proveedores";

// Agrega columnas nuevas a bases de datos que ya existian antes de una
// actualizacion. Como el schema usa CREATE TABLE IF NOT EXISTS, las columnas
// nuevas no se aplican automaticamente sobre tablas ya creadas.
export function migrar(db: DB) {
  const columnas = [
    `ALTER TABLE productos ADD COLUMN itbis_rate REAL NOT NULL DEFAULT 0.18`,
    `ALTER TABLE facturas ADD COLUMN metodo_pago TEXT`,
    `ALTER TABLE facturas ADD COLUMN creado_por TEXT`,
    `ALTER TABLE compras ADD COLUMN proveedor_id INTEGER REFERENCES proveedores(id)`,
  ];
  for (const sql of columnas) {
    try {
      db.exec(sql);
    } catch {
      // la columna ya existe
    }
  }

  // Migraciones de datos: corren una sola vez por base (quedan anotadas).
  db.exec(`CREATE TABLE IF NOT EXISTS migraciones_aplicadas (nombre TEXT PRIMARY KEY, aplicada_en TEXT NOT NULL DEFAULT (datetime('now','localtime')))`);
  const yaAplicada = db.prepare(`SELECT 1 AS si FROM migraciones_aplicadas WHERE nombre = ?`);
  const marcar = db.prepare(`INSERT INTO migraciones_aplicadas (nombre) VALUES (?)`);

  const datos: [string, () => void][] = [
    // Antes la existencia inicial de los productos nunca se registraba en la
    // contabilidad, asi que las cuentas de inventario quedaban en negativo al vender.
    ["inventario-inicial-contable", () => cuadrarInventarioContable(db, "Saldo inicial de inventario (existencia registrada antes de la contabilidad)")],
    // Las compras viejas tenian el proveedor como texto libre: se crean los proveedores y sus relaciones.
    ["proveedores-desde-compras", () => proveedoresDesdeComprasAnteriores(db)],
  ];
  for (const [nombre, aplicar] of datos) {
    if (yaAplicada.get(nombre)) continue;
    db.transaction(() => {
      aplicar();
      marcar.run(nombre);
    })();
  }
}
