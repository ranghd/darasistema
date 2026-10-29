import type { DB } from "./types";
import { asegurarCuenta, cuadrarInventarioContable, TIPOS_GASTO_INICIALES } from "./contabilidad";
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

// Banco principal, cuenta del ITBIS pagado en compras y tipos de gasto de inicio.
// No hace nada si ya existen; tambien se llama al crear una empresa nueva.
export function prepararBancosYGastos(db: DB) {
  if (!db.prepare(`SELECT id FROM bancos LIMIT 1`).get()) {
    const banco = db.prepare(`SELECT id FROM cuentas_contables WHERE codigo = '1.1.02'`).get() as { id: number } | undefined;
    if (banco) db.prepare(`INSERT INTO bancos (nombre, cuenta_id) VALUES ('Banco principal', ?)`).run(banco.id);
  }
  if (db.prepare(`SELECT id FROM cuentas_contables WHERE codigo = '1.1'`).get()) {
    asegurarCuenta(db, { codigo: "1.1.08", nombre: "ITBIS Pagado en Compras (por compensar)", tipo: "ACTIVO", naturaleza: "DEUDORA", padreCodigo: "1.1" });
  }
  if (!db.prepare(`SELECT id FROM cuentas_contables WHERE codigo = '6'`).get()) return;
  for (const t of TIPOS_GASTO_INICIALES) {
    if (db.prepare(`SELECT id FROM tipos_gasto WHERE nombre = ?`).get(t.nombre)) continue;
    const cuentaId = asegurarCuenta(db, { codigo: t.codigo, nombre: t.cuenta, tipo: "GASTOS", naturaleza: "DEUDORA", padreCodigo: "6" });
    db.prepare(`INSERT INTO tipos_gasto (nombre, cuenta_id, tipo_dgii) VALUES (?, ?, ?)`).run(t.nombre, cuentaId, t.dgii);
  }
}

// Tipo de gasto de la DGII (606) para los tipos de gasto y los gastos que ya existian.
function ponerTiposDgii(db: DB) {
  for (const t of TIPOS_GASTO_INICIALES) db.prepare(`UPDATE tipos_gasto SET tipo_dgii = ? WHERE nombre = ? AND tipo_dgii IS NULL`).run(t.dgii, t.nombre);
  db.prepare(`UPDATE tipos_gasto SET tipo_dgii = '02' WHERE tipo_dgii IS NULL`).run();
  db.prepare(`UPDATE gastos SET tipo_dgii = (SELECT tipo_dgii FROM tipos_gasto WHERE id = gastos.tipo_gasto_id) WHERE tipo_dgii IS NULL`).run();
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
    // Recibos de varias facturas y conciliacion bancaria.
    `ALTER TABLE cobros ADD COLUMN recibo_id INTEGER REFERENCES recibos_cobro(id)`,
    `ALTER TABLE cobros ADD COLUMN banco_id INTEGER REFERENCES bancos(id)`,
    `ALTER TABLE cobros ADD COLUMN referencia TEXT`,
    `ALTER TABLE pagos_compra ADD COLUMN banco_id INTEGER REFERENCES bancos(id)`,
    `ALTER TABLE pagos_compra ADD COLUMN referencia TEXT`,
    `ALTER TABLE compras ADD COLUMN ncf TEXT`,
    // Edicion colmado: grupo libre del producto (Viveres, Bebidas...) y tipo de negocio de la empresa.
    `ALTER TABLE productos ADD COLUMN grupo TEXT`,
    `ALTER TABLE company_config ADD COLUMN rubro TEXT NOT NULL DEFAULT 'gas'`,
    // Colmado: el codigo es corto (1, 2, 3...) y el de barras va aparte, para la pistola.
    `ALTER TABLE productos ADD COLUMN codigo_barras TEXT`,
    // Tipo de bienes y servicios del 606 de la DGII.
    `ALTER TABLE tipos_gasto ADD COLUMN tipo_dgii TEXT`,
    `ALTER TABLE gastos ADD COLUMN tipo_dgii TEXT`,
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
    // Banco principal (la cuenta 1.1.02 que ya usaba el sistema) y tipos de gasto de inicio.
    ["bancos-y-tipos-de-gasto", () => prepararBancosYGastos(db)],
    ["tipos-de-gasto-dgii-606", () => ponerTiposDgii(db)],
  ];
  db.exec(`CREATE INDEX IF NOT EXISTS ix_cobros_recibo ON cobros(recibo_id)`);
  for (const [nombre, aplicar] of datos) {
    if (yaAplicada.get(nombre)) continue;
    db.transaction(() => {
      aplicar();
      marcar.run(nombre);
    })();
  }
}
