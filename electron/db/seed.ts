import type { DB } from "./types";
import { nuevoPasswordHash } from "./password";

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
];

export interface DatosEmpresa {
  nombre_empresa: string;
  rnc?: string | null;
  direccion?: string | null;
  telefono?: string | null;
}

const EMPRESA_DEMO: DatosEmpresa = {
  nombre_empresa: "Darasistema SRL",
  rnc: "1-30-12345-6",
  direccion: "Av. Principal, Santo Domingo",
  telefono: "809-555-0100",
};

export function seedIfEmpty(db: DB) {
  const count = (db.prepare("SELECT COUNT(*) as c FROM cuentas_contables").get() as { c: number }).c;
  if (count > 0) return;
  seedCatalogo(db, EMPRESA_DEMO);
  seedDemo(db);
}

// Lo minimo que toda empresa necesita para operar: catalogo de cuentas, datos
// de la empresa y el cliente "Consumidor Final" que usa la Caja.
export function seedCatalogo(db: DB, empresa: DatosEmpresa) {
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
  insertCuentas(CUENTAS);

  db.prepare(
    `INSERT INTO company_config (id, nombre_empresa, rnc, direccion, telefono, itbis_rate)
     VALUES (1, @nombre_empresa, @rnc, @direccion, @telefono, 0.18)`
  ).run({
    nombre_empresa: empresa.nombre_empresa,
    rnc: empresa.rnc ?? null,
    direccion: empresa.direccion ?? null,
    telefono: empresa.telefono ?? null,
  });

  db.prepare(
    `INSERT INTO clientes (codigo, nombre, rnc_cedula, tipo, telefono, email, direccion, activo)
     VALUES ('CLI-0000', 'Consumidor Final', '', 'FISICA', '', '', '', 1)`
  ).run();
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
