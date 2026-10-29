import type { DB } from "./types";
import { asegurarCuenta, cuadrarInventarioContable, TIPOS_GASTO_INICIALES } from "./contabilidad";
import { proveedoresDesdeComprasAnteriores } from "./proveedores";
import { SCHEMA_SQL } from "./schema";
import { CODIGO_NCF_CORREGIDO, listaSql } from "../shared/ncf";

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

// Rehace una tabla con su definicion actual de schema.ts (en SQLite no se puede
// cambiar el CHECK de una tabla que ya existe). `columnas`: cada columna de la tabla
// nueva y la expresion que la llena desde la vieja. Los id se conservan.
function rehacerTabla(db: DB, tabla: string, columnas: Record<string, string>) {
  const inicio = SCHEMA_SQL.indexOf(`CREATE TABLE IF NOT EXISTS ${tabla} (`);
  const fin = inicio < 0 ? -1 : SCHEMA_SQL.indexOf("\n);", inicio);
  if (fin < 0) throw new Error(`La tabla ${tabla} no esta en el schema`);
  const ddl = SCHEMA_SQL.slice(inicio, fin + 3);
  const nueva = `${tabla}_nueva`;
  db.exec(ddl.replace(`IF NOT EXISTS ${tabla} (`, `${nueva} (`));
  db.exec(`INSERT INTO ${nueva} (${Object.keys(columnas).join(", ")}) SELECT ${Object.values(columnas).join(", ")} FROM ${tabla}`);
  db.exec(`DROP TABLE ${tabla}`);
  db.exec(`ALTER TABLE ${nueva} RENAME TO ${tabla}`);
}

// Los codigos B11 a B16 estaban corridos un lugar frente a la Norma General 06-2018
// de la DGII (el Registro Unico de Ingresos salia como B11, Gastos Menores como B12...
// y Pagos al Exterior como B16). Se pasan al codigo correcto las secuencias, los NCF
// ya emitidos en facturas y en Otros Comprobantes, y el texto de sus asientos. Se
// conserva el numero de cada NCF (solo cambian las 3 primeras letras), lo que falta
// de cada secuencia, los id y los montos. Los NCF de suplidores (compras y gastos)
// no se tocan: esos los puso el suplidor.
function corregirCodigosNcf(db: DB) {
  const viejos = listaSql(Object.keys(CODIGO_NCF_CORREGIDO));
  const casos = Object.entries(CODIGO_NCF_CORREGIDO)
    .map(([viejo, nuevo]) => `WHEN '${viejo}' THEN '${nuevo}'`)
    .join(" ");
  const codigo = (expr: string) => `CASE ${expr} ${casos} ELSE ${expr} END`;
  // Un NCF (o prefijo) que empieza con el codigo viejo de su tipo pasa a empezar con el nuevo.
  const ncf = (col: string, tipo: string) => `CASE WHEN substr(${col}, 1, 3) = ${tipo} THEN ${codigo(tipo)} || substr(${col}, 4) ELSE ${col} END`;

  // Antes de cambiar nada: que NCF cambian y por cual (para corregir el texto de los asientos).
  const filas = db
    .prepare(
      `SELECT ncf AS viejo, ${ncf("ncf", "substr(ncf, 1, 3)")} AS nuevo FROM facturas WHERE substr(ncf, 1, 3) IN (${viejos})
       UNION ALL
       SELECT tipo || ' ' || ncf, ${codigo("tipo")} || ' ' || ${ncf("ncf", "tipo")} FROM comprobantes_varios WHERE tipo IN (${viejos})
       UNION ALL
       SELECT ncf, ${ncf("ncf", "tipo")} FROM comprobantes_varios WHERE tipo IN (${viejos})`
    )
    .all() as { viejo: string; nuevo: string }[];
  const cambios = [...new Map(filas.filter((f) => f.viejo !== f.nuevo).map((f) => [f.viejo, f.nuevo])).entries()]
    // el texto mas largo primero: "B11 B1100000001" antes que "B1100000001"
    .sort((a, b) => b[0].length - a[0].length);

  rehacerTabla(db, "ncf_secuencias", {
    id: "id",
    tipo: codigo("tipo"),
    prefijo: ncf("prefijo", "tipo"),
    desde: "desde",
    hasta: "hasta",
    actual: "actual",
    vencimiento: "vencimiento",
    activo: "activo",
  });
  rehacerTabla(db, "comprobantes_varios", {
    id: "id",
    tipo: codigo("tipo"),
    ncf: ncf("ncf", "tipo"),
    fecha: "fecha",
    concepto: "concepto",
    contraparte: "contraparte",
    monto: "monto",
    itbis: "itbis",
    total: "total",
    cuenta_id: "cuenta_id",
    metodo: "metodo",
    asiento_id: "asiento_id",
    creado_en: "creado_en",
  });
  db.prepare(`UPDATE facturas SET ncf = ${ncf("ncf", "substr(ncf, 1, 3)")} WHERE substr(ncf, 1, 3) IN (${viejos})`).run();

  // En dos pasos (primero una marca, despues el NCF nuevo) para que un NCF ya
  // corregido no se vuelva a cambiar: el B13 nuevo de uno puede ser el B13 viejo de otro.
  const textos = [
    ["asientos", "concepto"],
    ["asiento_lineas", "descripcion"],
  ];
  const pasos: [string, string][] = [...cambios.map(([viejo], i): [string, string] => [viejo, `{{ncf:${i}}}`]), ...cambios.map(([, nuevo], i): [string, string] => [`{{ncf:${i}}}`, nuevo])];
  for (const [tabla, col] of textos) {
    const reemplazar = db.prepare(`UPDATE ${tabla} SET ${col} = REPLACE(${col}, @de, @a) WHERE instr(${col}, @de) > 0`);
    for (const [de, a] of pasos) reemplazar.run({ de, a });
  }
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
    ["codigos-ncf-norma-06-2018", () => corregirCodigosNcf(db)],
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
