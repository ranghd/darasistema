import type { DB } from "./types";
import { cuadrarInventarioContable } from "./contabilidad";
import { proveedoresDesdeComprasAnteriores } from "./proveedores";

// Agrega una cuenta al catalogo si la empresa no la tiene (solo si existe su cuenta padre).
function crearCuentaSiFalta(db: DB, codigo: string, nombre: string, tipo: string, naturaleza: string, padreCodigo: string) {
  if (db.prepare(`SELECT id FROM cuentas_contables WHERE codigo = ?`).get(codigo)) return;
  const padre = db.prepare(`SELECT id FROM cuentas_contables WHERE codigo = ?`).get(padreCodigo) as { id: number } | undefined;
  if (!padre) return;
  db.prepare(
    `INSERT INTO cuentas_contables (codigo, nombre, tipo, padre_id, naturaleza, es_movimiento, activo) VALUES (?, ?, ?, ?, ?, 1, 1)`
  ).run(codigo, nombre, tipo, padre.id, naturaleza);
}

// Agrega columnas nuevas a bases de datos que ya existian antes de una
// actualizacion. Como el schema usa CREATE TABLE IF NOT EXISTS, las columnas
// nuevas no se aplican automaticamente sobre tablas ya creadas.
export function migrar(db: DB) {
  const columnas = [
    `ALTER TABLE productos ADD COLUMN itbis_rate REAL NOT NULL DEFAULT 0.18`,
    `ALTER TABLE facturas ADD COLUMN metodo_pago TEXT`,
    `ALTER TABLE facturas ADD COLUMN creado_por TEXT`,
    `ALTER TABLE compras ADD COLUMN proveedor_id INTEGER REFERENCES proveedores(id)`,
    // Cierre de caja: cada operacion queda ligada a la jornada de caja en que se hizo.
    `ALTER TABLE facturas ADD COLUMN caja_sesion_id INTEGER REFERENCES caja_sesiones(id)`,
    `ALTER TABLE facturas ADD COLUMN anulada_sesion_id INTEGER REFERENCES caja_sesiones(id)`,
    `ALTER TABLE cobros ADD COLUMN caja_sesion_id INTEGER REFERENCES caja_sesiones(id)`,
    `ALTER TABLE envase_movimientos ADD COLUMN caja_sesion_id INTEGER REFERENCES caja_sesiones(id)`,
    `ALTER TABLE envase_movimientos ADD COLUMN monto_reembolsado REAL NOT NULL DEFAULT 0`,
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
    ["caja-principal", () => {
      if (!db.prepare(`SELECT id FROM cajas LIMIT 1`).get()) db.prepare(`INSERT INTO cajas (nombre) VALUES ('Caja principal')`).run();
    }],
    ["cuenta-diferencias-caja", () => crearCuentaSiFalta(db, "6.1.04", "Diferencias de Caja (faltantes y sobrantes)", "GASTOS", "DEUDORA", "6")],
  ];
  for (const [nombre, aplicar] of datos) {
    if (yaAplicada.get(nombre)) continue;
    db.transaction(() => {
      aplicar();
      marcar.run(nombre);
    })();
  }
}
