import { prepararBancosYGastos } from "./migraciones";
import type { DB } from "./types";
import type { Rubro } from "../shared/types";
import { nuevoPasswordHash } from "./password";
import { cuadrarInventarioContable } from "./contabilidad";

interface CuentaSeed {
  codigo: string;
  nombre: string;
  tipo: "ACTIVO" | "PASIVO" | "PATRIMONIO" | "INGRESOS" | "GASTOS" | "COSTOS";
  naturaleza: "DEUDORA" | "ACREEDORA";
  padreCodigo?: string;
  esMovimiento: boolean;
}

const CUENTAS: CuentaSeed[] = [
  { codigo: "1", nombre: "ACTIVO", tipo: "ACTIVO", naturaleza: "DEUDORA", esMovimiento: false },
  { codigo: "1.1", nombre: "Activo Corriente", tipo: "ACTIVO", naturaleza: "DEUDORA", padreCodigo: "1", esMovimiento: false },
  { codigo: "1.1.01", nombre: "Caja General", tipo: "ACTIVO", naturaleza: "DEUDORA", padreCodigo: "1.1", esMovimiento: true },
  { codigo: "1.1.02", nombre: "Banco", tipo: "ACTIVO", naturaleza: "DEUDORA", padreCodigo: "1.1", esMovimiento: true },
  { codigo: "1.1.03", nombre: "Cuentas por Cobrar Clientes", tipo: "ACTIVO", naturaleza: "DEUDORA", padreCodigo: "1.1", esMovimiento: true },
  { codigo: "1.1.04", nombre: "Inventario de Gas", tipo: "ACTIVO", naturaleza: "DEUDORA", padreCodigo: "1.1", esMovimiento: true },
  { codigo: "1.1.05", nombre: "Inventario de Oxigeno", tipo: "ACTIVO", naturaleza: "DEUDORA", padreCodigo: "1.1", esMovimiento: true },
  { codigo: "1.1.06", nombre: "Inventario de Agua Purificada", tipo: "ACTIVO", naturaleza: "DEUDORA", padreCodigo: "1.1", esMovimiento: true },
  { codigo: "1.1.07", nombre: "Envases en Poder de Clientes", tipo: "ACTIVO", naturaleza: "DEUDORA", padreCodigo: "1.1", esMovimiento: true },

  { codigo: "2", nombre: "PASIVO", tipo: "PASIVO", naturaleza: "ACREEDORA", esMovimiento: false },
  { codigo: "2.1", nombre: "Pasivo Corriente", tipo: "PASIVO", naturaleza: "ACREEDORA", padreCodigo: "2", esMovimiento: false },
  { codigo: "2.1.01", nombre: "Cuentas por Pagar Proveedores", tipo: "PASIVO", naturaleza: "ACREEDORA", padreCodigo: "2.1", esMovimiento: true },
  { codigo: "2.1.02", nombre: "ITBIS por Pagar", tipo: "PASIVO", naturaleza: "ACREEDORA", padreCodigo: "2.1", esMovimiento: true },
  { codigo: "2.1.03", nombre: "Depositos en Garantia por Envases", tipo: "PASIVO", naturaleza: "ACREEDORA", padreCodigo: "2.1", esMovimiento: true },

  { codigo: "3", nombre: "PATRIMONIO", tipo: "PATRIMONIO", naturaleza: "ACREEDORA", esMovimiento: false },
  { codigo: "3.1.01", nombre: "Capital Social", tipo: "PATRIMONIO", naturaleza: "ACREEDORA", padreCodigo: "3", esMovimiento: true },
  { codigo: "3.1.02", nombre: "Utilidades Retenidas", tipo: "PATRIMONIO", naturaleza: "ACREEDORA", padreCodigo: "3", esMovimiento: true },

  { codigo: "4", nombre: "INGRESOS", tipo: "INGRESOS", naturaleza: "ACREEDORA", esMovimiento: false },
  { codigo: "4.1.01", nombre: "Ingresos por Venta de Gas", tipo: "INGRESOS", naturaleza: "ACREEDORA", padreCodigo: "4", esMovimiento: true },
  { codigo: "4.1.02", nombre: "Ingresos por Venta de Oxigeno", tipo: "INGRESOS", naturaleza: "ACREEDORA", padreCodigo: "4", esMovimiento: true },
  { codigo: "4.1.03", nombre: "Ingresos por Venta de Agua Purificada", tipo: "INGRESOS", naturaleza: "ACREEDORA", padreCodigo: "4", esMovimiento: true },

  { codigo: "5", nombre: "COSTOS", tipo: "COSTOS", naturaleza: "DEUDORA", esMovimiento: false },
  { codigo: "5.1.01", nombre: "Costo de Venta de Gas", tipo: "COSTOS", naturaleza: "DEUDORA", padreCodigo: "5", esMovimiento: true },
  { codigo: "5.1.02", nombre: "Costo de Venta de Oxigeno", tipo: "COSTOS", naturaleza: "DEUDORA", padreCodigo: "5", esMovimiento: true },
  { codigo: "5.1.03", nombre: "Costo de Venta de Agua Purificada", tipo: "COSTOS", naturaleza: "DEUDORA", padreCodigo: "5", esMovimiento: true },

  { codigo: "6", nombre: "GASTOS", tipo: "GASTOS", naturaleza: "DEUDORA", esMovimiento: false },
  { codigo: "6.1.01", nombre: "Gastos de Administracion", tipo: "GASTOS", naturaleza: "DEUDORA", padreCodigo: "6", esMovimiento: true },
  { codigo: "6.1.02", nombre: "Gastos de Venta", tipo: "GASTOS", naturaleza: "DEUDORA", padreCodigo: "6", esMovimiento: true },
  { codigo: "6.1.03", nombre: "Gastos de Combustible y Transporte", tipo: "GASTOS", naturaleza: "DEUDORA", padreCodigo: "6", esMovimiento: true },
  { codigo: "6.1.04", nombre: "Diferencias de Caja (faltantes y sobrantes)", tipo: "GASTOS", naturaleza: "DEUDORA", padreCodigo: "6", esMovimiento: true },
];

export interface DatosEmpresa {
  nombre_empresa: string;
  rnc?: string | null;
  direccion?: string | null;
  telefono?: string | null;
}

const EMPRESA_DEMO_COLMADO: DatosEmpresa = {
  nombre_empresa: "Colmado Ejemplo",
  rnc: "001-0000000-1",
  direccion: "Calle Principal #1, Santo Domingo",
  telefono: "809-555-0100",
};

const EMPRESA_DEMO: DatosEmpresa = {
  nombre_empresa: "Darasistema SRL",
  rnc: "1-30-12345-6",
  direccion: "Av. Principal, Santo Domingo",
  telefono: "809-555-0100",
};

// Un colmado no maneja gas, oxigeno ni agua por separado, ni envases con fianza:
// tiene una sola cuenta de ventas, de costo y de inventario de mercancia.
const QUITAR_EN_COLMADO = new Set(["1.1.05", "1.1.06", "1.1.07", "2.1.03", "4.1.02", "4.1.03", "5.1.02", "5.1.03"]);
const NOMBRES_COLMADO: Record<string, string> = {
  "1.1.04": "Inventario de Mercancia",
  "4.1.01": "Ingresos por Ventas",
  "5.1.01": "Costo de Ventas",
};

export function cuentasDe(rubro: Rubro): CuentaSeed[] {
  if (rubro !== "colmado") return CUENTAS;
  return CUENTAS.filter((c) => !QUITAR_EN_COLMADO.has(c.codigo)).map((c) => ({ ...c, nombre: NOMBRES_COLMADO[c.codigo] ?? c.nombre }));
}

export function seedIfEmpty(db: DB, rubro: Rubro = "gas") {
  const count = (db.prepare("SELECT COUNT(*) as c FROM cuentas_contables").get() as { c: number }).c;
  if (count > 0) return;
  seedCatalogo(db, rubro === "colmado" ? EMPRESA_DEMO_COLMADO : EMPRESA_DEMO, rubro);
  if (rubro === "colmado") seedDemoColmado(db);
  else seedDemo(db);
}

// Lo minimo que toda empresa necesita para operar: catalogo de cuentas, datos
// de la empresa y el cliente "Consumidor Final" que usa la Caja.
export function seedCatalogo(db: DB, empresa: DatosEmpresa, rubro: Rubro = "gas") {
  const insertCuenta = db.prepare(
    `INSERT INTO cuentas_contables (codigo, nombre, tipo, padre_id, naturaleza, es_movimiento, activo)
     VALUES (@codigo, @nombre, @tipo, @padre_id, @naturaleza, @es_movimiento, 1)`
  );
  const codigoToId = new Map<string, number>();

  const insertCuentas = db.transaction((cuentas: CuentaSeed[]) => {
    for (const c of cuentas) {
      const padre_id = c.padreCodigo ? codigoToId.get(c.padreCodigo) ?? null : null;
      const info = insertCuenta.run({
        codigo: c.codigo,
        nombre: c.nombre,
        tipo: c.tipo,
        padre_id,
        naturaleza: c.naturaleza,
        es_movimiento: c.esMovimiento ? 1 : 0,
      });
      codigoToId.set(c.codigo, Number(info.lastInsertRowid));
    }
  });
  insertCuentas(cuentasDe(rubro));

  db.prepare(
    `INSERT INTO company_config (id, nombre_empresa, rnc, direccion, telefono, itbis_rate, rubro)
     VALUES (1, @nombre_empresa, @rnc, @direccion, @telefono, 0.18, @rubro)`
  ).run({
    rubro,
    nombre_empresa: empresa.nombre_empresa,
    rnc: empresa.rnc ?? null,
    direccion: empresa.direccion ?? null,
    telefono: empresa.telefono ?? null,
  });

  db.prepare(
    `INSERT INTO clientes (codigo, nombre, rnc_cedula, tipo, telefono, email, direccion, activo)
     VALUES ('CLI-0000', 'Consumidor Final', '', 'FISICA', '', '', '', 1)`
  ).run();
  prepararBancosYGastos(db);
}

// Datos de ejemplo para demos y pruebas: secuencias NCF ficticias, clientes y
// productos. No usar para clientes reales (sus NCF los asigna la DGII).
export function seedDemo(db: DB) {
  const filas = db.prepare(`SELECT id, codigo FROM cuentas_contables`).all() as { id: number; codigo: string }[];
  const codigoToId = new Map(filas.map((f) => [f.codigo, f.id]));

  const insertNcf = db.prepare(
    `INSERT INTO ncf_secuencias (tipo, prefijo, desde, hasta, actual, vencimiento, activo)
     VALUES (@tipo, @prefijo, @desde, @hasta, @actual, @vencimiento, 1)`
  );
  const secuenciasNcf = [
    { tipo: "B01", prefijo: "B01", desde: 1, hasta: 500, actual: 1, vencimiento: "2026-12-31" },
    { tipo: "B02", prefijo: "B02", desde: 1, hasta: 2000, actual: 1, vencimiento: "2026-12-31" },
    { tipo: "B03", prefijo: "B03", desde: 1, hasta: 100, actual: 1, vencimiento: "2026-12-31" },
    { tipo: "B04", prefijo: "B04", desde: 1, hasta: 200, actual: 1, vencimiento: "2026-12-31" },
    { tipo: "B11", prefijo: "B11", desde: 1, hasta: 1000, actual: 1, vencimiento: "2026-12-31" },
    { tipo: "B12", prefijo: "B12", desde: 1, hasta: 500, actual: 1, vencimiento: "2026-12-31" },
    { tipo: "B16", prefijo: "B16", desde: 1, hasta: 100, actual: 1, vencimiento: "2026-12-31" },
  ];
  for (const s of secuenciasNcf) insertNcf.run(s);

  const insertCliente = db.prepare(
    `INSERT INTO clientes (codigo, nombre, rnc_cedula, tipo, telefono, email, direccion, activo)
     VALUES (@codigo, @nombre, @rnc_cedula, @tipo, @telefono, @email, @direccion, 1)`
  );
  const clientes = [
    { codigo: "CLI-0001", nombre: "Colmado Dona Maria", rnc_cedula: "001-1234567-8", tipo: "FISICA", telefono: "809-555-1201", email: "", direccion: "Calle Duarte #45, Villa Mella" },
    { codigo: "CLI-0002", nombre: "Clinica San Rafael SRL", rnc_cedula: "1-01-98765-2", tipo: "JURIDICA", telefono: "809-555-1340", email: "compras@sanrafael.do", direccion: "Av. Independencia #120, Santo Domingo" },
    { codigo: "CLI-0003", nombre: "Restaurante El Fogon", rnc_cedula: "1-30-55667-9", tipo: "JURIDICA", telefono: "809-555-1560", email: "", direccion: "Av. 27 de Febrero #880" },
    { codigo: "CLI-0004", nombre: "Juan Perez Martinez", rnc_cedula: "001-9988776-5", tipo: "FISICA", telefono: "829-555-7788", email: "juanperez@gmail.com", direccion: "Calle Mella #12, Los Alcarrizos" },
  ];
  for (const c of clientes) insertCliente.run(c);

  const insertProducto = db.prepare(
    `INSERT INTO productos (codigo, nombre, categoria, unidad, precio_contenido, costo_contenido, maneja_envase, fianza_envase, itbis_rate, cuenta_ingreso_id, cuenta_costo_id, cuenta_inventario_id, existencia, activo)
     VALUES (@codigo, @nombre, @categoria, @unidad, @precio_contenido, @costo_contenido, @maneja_envase, @fianza_envase, 0.18, @cuenta_ingreso_id, @cuenta_costo_id, @cuenta_inventario_id, @existencia, 1)`
  );
  const productos = [
    { codigo: "GAS-25", nombre: "Cilindro de Gas Propano 25 lb", categoria: "GAS", unidad: "CILINDRO", precio_contenido: 650, costo_contenido: 420, maneja_envase: 1, fianza_envase: 1500, cuenta_ingreso_id: codigoToId.get("4.1.01"), cuenta_costo_id: codigoToId.get("5.1.01"), cuenta_inventario_id: codigoToId.get("1.1.04"), existencia: 40 },
    { codigo: "GAS-50", nombre: "Cilindro de Gas Propano 50 lb", categoria: "GAS", unidad: "CILINDRO", precio_contenido: 1250, costo_contenido: 820, maneja_envase: 1, fianza_envase: 2500, cuenta_ingreso_id: codigoToId.get("4.1.01"), cuenta_costo_id: codigoToId.get("5.1.01"), cuenta_inventario_id: codigoToId.get("1.1.04"), existencia: 25 },
    { codigo: "OXI-IND", nombre: "Cilindro de Oxigeno Industrial", categoria: "OXIGENO", unidad: "CILINDRO", precio_contenido: 900, costo_contenido: 550, maneja_envase: 1, fianza_envase: 3000, cuenta_ingreso_id: codigoToId.get("4.1.02"), cuenta_costo_id: codigoToId.get("5.1.02"), cuenta_inventario_id: codigoToId.get("1.1.05"), existencia: 15 },
    { codigo: "OXI-MED", nombre: "Cilindro de Oxigeno Medicinal", categoria: "OXIGENO", unidad: "CILINDRO", precio_contenido: 1100, costo_contenido: 700, maneja_envase: 1, fianza_envase: 3500, cuenta_ingreso_id: codigoToId.get("4.1.02"), cuenta_costo_id: codigoToId.get("5.1.02"), cuenta_inventario_id: codigoToId.get("1.1.05"), existencia: 10 },
    { codigo: "AGUA-5G", nombre: "Botellon de Agua Purificada 5 Gal", categoria: "AGUA", unidad: "BOTELLON", precio_contenido: 90, costo_contenido: 35, maneja_envase: 1, fianza_envase: 350, cuenta_ingreso_id: codigoToId.get("4.1.03"), cuenta_costo_id: codigoToId.get("5.1.03"), cuenta_inventario_id: codigoToId.get("1.1.06"), existencia: 120 },
    { codigo: "AGUA-5G-CAJA", nombre: "Agua Purificada en Fundas (caja x20)", categoria: "AGUA", unidad: "CAJA", precio_contenido: 150, costo_contenido: 70, maneja_envase: 0, fianza_envase: 0, cuenta_ingreso_id: codigoToId.get("4.1.03"), cuenta_costo_id: codigoToId.get("5.1.03"), cuenta_inventario_id: codigoToId.get("1.1.06"), existencia: 80 },
  ];
  for (const p of productos) insertProducto.run(p);
  cuadrarInventarioContable(db, "Inventario inicial (datos de ejemplo)");
}

// Datos de ejemplo para la edicion colmado: productos de un colmado tipico (con
// codigo de barras), algunos exentos de ITBIS, y clientes de fiao.
export function seedDemoColmado(db: DB) {
  const filas = db.prepare(`SELECT id, codigo FROM cuentas_contables`).all() as { id: number; codigo: string }[];
  const id = (c: string) => filas.find((f) => f.codigo === c)?.id ?? null;
  const insertNcf = db.prepare(
    `INSERT INTO ncf_secuencias (tipo, prefijo, desde, hasta, actual, vencimiento, activo) VALUES (@tipo, @tipo, 1, @hasta, 1, '2026-12-31', 1)`
  );
  for (const [tipo, hasta] of [["B01", 500], ["B02", 5000], ["B03", 100], ["B04", 200], ["B11", 500], ["B12", 500], ["B14", 100], ["B15", 100]] as const) {
    insertNcf.run({ tipo, hasta });
  }

  const insertCliente = db.prepare(
    `INSERT INTO clientes (codigo, nombre, rnc_cedula, tipo, telefono, email, direccion, activo) VALUES (@codigo, @nombre, '', 'FISICA', @telefono, '', @direccion, 1)`
  );
  [
    ["CLI-0001", "Doña Carmen (fiao)", "809-555-1101", "Calle 3 #12"],
    ["CLI-0002", "Pedro el mecanico", "829-555-1102", "Esquina del taller"],
    ["CLI-0003", "Familia Rosario", "849-555-1103", "Calle 5 #40"],
  ].forEach(([codigo, nombre, telefono, direccion]) => insertCliente.run({ codigo, nombre, telefono, direccion }));

  const insertProducto = db.prepare(
    `INSERT INTO productos (codigo, nombre, categoria, unidad, precio_contenido, costo_contenido, maneja_envase, fianza_envase, itbis_rate, cuenta_ingreso_id, cuenta_costo_id, cuenta_inventario_id, existencia, activo, grupo)
     VALUES (@codigo, @nombre, 'OTRO', @unidad, @precio, @costo, 0, 0, @itbis, @ing, @cos, @inv, @existencia, 1, @grupo)`
  );
  const cuentas = { ing: id("4.1.01"), cos: id("5.1.01"), inv: id("1.1.04") };
  // precio sin ITBIS; los basicos (arroz, habichuelas, huevos, pan, leche) van exentos
  const productos: [string, string, string, string, number, number, number, number][] = [
    ["7460001000017", "Arroz Selecto 1 lb", "Viveres", "LIBRA", 38, 30, 0, 200],
    ["7460001000024", "Habichuelas rojas 1 lb", "Viveres", "LIBRA", 75, 58, 0, 120],
    ["7460001000031", "Azucar crema 1 lb", "Viveres", "LIBRA", 40, 31, 0, 150],
    ["7460001000048", "Aceite Crisol 16 oz", "Viveres", "UNIDAD", 127.12, 98, 0.18, 48],
    ["7460001000055", "Salami Induveca 1 lb", "Embutidos", "LIBRA", 165.25, 128, 0.18, 30],
    ["7460001000062", "Huevos (unidad)", "Viveres", "UNIDAD", 9, 7, 0, 360],
    ["7460001000079", "Pan sobao", "Panaderia", "UNIDAD", 10, 7, 0, 120],
    ["7460001000086", "Leche Rica 1 L", "Lacteos", "UNIDAD", 85, 68, 0, 60],
    ["7460001000093", "Refresco Coca-Cola 20 oz", "Bebidas", "UNIDAD", 50.85, 38, 0.18, 96],
    ["7460001000109", "Cerveza Presidente pequeña", "Bebidas", "UNIDAD", 101.69, 82, 0.18, 120],
    ["7460001000116", "Agua Planeta Azul 20 oz", "Bebidas", "UNIDAD", 21.19, 15, 0.18, 96],
    ["7460001000123", "Detergente Ace 500 g", "Limpieza", "UNIDAD", 84.75, 66, 0.18, 36],
    ["7460001000130", "Jabon Lavaplatos Axion", "Limpieza", "UNIDAD", 63.56, 49, 0.18, 30],
    ["7460001000147", "Papel de baño (rollo)", "Limpieza", "UNIDAD", 29.66, 22, 0.18, 80],
    ["7460001000154", "Galletas Club Social", "Picaderas", "UNIDAD", 12.71, 9, 0.18, 100],
    ["7460001000161", "Platano verde", "Viveres", "UNIDAD", 25, 18, 0, 90],
  ];
  for (const [codigo, nombre, grupo, unidad, precio, costo, itbis, existencia] of productos) {
    insertProducto.run({ codigo, nombre, grupo, unidad, precio, costo, itbis, existencia, ...cuentas });
  }
  cuadrarInventarioContable(db, "Inventario inicial (datos de ejemplo)");
}

// Crea los usuarios por defecto si aun no existen. Se ejecuta en cada arranque
// (no solo cuando la base esta vacia) para que cualquier instalacion o
// actualizacion tenga siempre estas cuentas disponibles.
export function seedUsuarios(db: DB) {
  const usuariosPorDefecto = [
    { usuario: "admin", nombre: "Administrador", password: "admin", rol: "ADMIN" },
    { usuario: "dara", nombre: "Darasistema", password: "123", rol: "ADMIN" },
    { usuario: "venta", nombre: "Caja / Venta", password: "123", rol: "CAJERO" },
  ] as const;

  const existe = db.prepare(`SELECT id FROM usuarios WHERE usuario = ?`);
  const insert = db.prepare(
    `INSERT INTO usuarios (usuario, nombre, password_hash, rol, activo)
     VALUES (@usuario, @nombre, @password_hash, @rol, 1)`
  );

  for (const u of usuariosPorDefecto) {
    if (!existe.get(u.usuario)) {
      insert.run({ usuario: u.usuario, nombre: u.nombre, password_hash: nuevoPasswordHash(u.password), rol: u.rol });
    }
  }
}
