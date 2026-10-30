import { listaSql, TIPOS_COMPROBANTE_VARIOS, TODOS_LOS_TIPOS_NCF } from "../shared/ncf";

// Si cambian los tipos de NCF permitidos, las bases que ya existen necesitan una
// migracion que rehaga la tabla (ver corregirCodigosNcf en migraciones.ts).
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS cuentas_contables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('ACTIVO','PASIVO','PATRIMONIO','INGRESOS','GASTOS','COSTOS')),
  padre_id INTEGER REFERENCES cuentas_contables(id),
  naturaleza TEXT NOT NULL CHECK (naturaleza IN ('DEUDORA','ACREEDORA')),
  es_movimiento INTEGER NOT NULL DEFAULT 1,
  activo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS asientos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  numero INTEGER NOT NULL UNIQUE,
  fecha TEXT NOT NULL,
  concepto TEXT NOT NULL,
  origen TEXT NOT NULL CHECK (origen IN ('MANUAL','FACTURA','COBRO','AJUSTE')),
  referencia_id INTEGER,
  creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS asiento_lineas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asiento_id INTEGER NOT NULL REFERENCES asientos(id) ON DELETE CASCADE,
  cuenta_id INTEGER NOT NULL REFERENCES cuentas_contables(id),
  debito REAL NOT NULL DEFAULT 0,
  credito REAL NOT NULL DEFAULT 0,
  descripcion TEXT
);

CREATE TABLE IF NOT EXISTS clientes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  rnc_cedula TEXT,
  tipo TEXT NOT NULL CHECK (tipo IN ('FISICA','JURIDICA')) DEFAULT 'FISICA',
  telefono TEXT,
  email TEXT,
  direccion TEXT,
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS productos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  categoria TEXT NOT NULL CHECK (categoria IN ('GAS','OXIGENO','AGUA','OTRO')),
  unidad TEXT NOT NULL DEFAULT 'UNIDAD',
  precio_contenido REAL NOT NULL DEFAULT 0,
  costo_contenido REAL NOT NULL DEFAULT 0,
  maneja_envase INTEGER NOT NULL DEFAULT 0,
  fianza_envase REAL NOT NULL DEFAULT 0,
  itbis_rate REAL NOT NULL DEFAULT 0.18,
  cuenta_ingreso_id INTEGER REFERENCES cuentas_contables(id),
  cuenta_costo_id INTEGER REFERENCES cuentas_contables(id),
  cuenta_inventario_id INTEGER REFERENCES cuentas_contables(id),
  existencia REAL NOT NULL DEFAULT 0,
  activo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ncf_secuencias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL CHECK (tipo IN (${listaSql(TODOS_LOS_TIPOS_NCF)})),
  prefijo TEXT NOT NULL,
  desde INTEGER NOT NULL,
  hasta INTEGER NOT NULL,
  actual INTEGER NOT NULL,
  vencimiento TEXT,
  activo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS facturas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  numero INTEGER NOT NULL UNIQUE,
  ncf TEXT,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  fecha TEXT NOT NULL,
  condicion_pago TEXT NOT NULL CHECK (condicion_pago IN ('CONTADO','CREDITO')),
  metodo_pago TEXT,
  subtotal REAL NOT NULL DEFAULT 0,
  itbis REAL NOT NULL DEFAULT 0,
  fianza_total REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  estado TEXT NOT NULL CHECK (estado IN ('PENDIENTE','PAGADA','ANULADA')) DEFAULT 'PENDIENTE',
  asiento_id INTEGER REFERENCES asientos(id),
  nota_credito_ncf TEXT,
  nota_debito_ncf TEXT,
  creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS comprobantes_varios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL CHECK (tipo IN (${listaSql(TIPOS_COMPROBANTE_VARIOS)})),
  ncf TEXT NOT NULL,
  fecha TEXT NOT NULL,
  concepto TEXT NOT NULL,
  contraparte TEXT,
  monto REAL NOT NULL,
  itbis REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  cuenta_id INTEGER NOT NULL REFERENCES cuentas_contables(id),
  metodo TEXT NOT NULL CHECK (metodo IN ('CAJA','BANCO')),
  asiento_id INTEGER REFERENCES asientos(id),
  creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS proveedores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  telefono TEXT,
  direccion TEXT,
  rnc TEXT,
  contacto TEXT,
  notas TEXT,
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Relacion muchos a muchos producto <-> proveedor. El historial de precios sale
-- de compra_lineas; aqui se guarda lo propio de la relacion (codigo del proveedor,
-- precio cotizado) y el ultimo precio pagado para sugerirlo rapido.
CREATE TABLE IF NOT EXISTS producto_proveedor (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  producto_id INTEGER NOT NULL REFERENCES productos(id),
  proveedor_id INTEGER NOT NULL REFERENCES proveedores(id),
  codigo_proveedor TEXT,
  precio_referencia REAL,
  ultimo_precio REAL,
  ultima_fecha TEXT,
  creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(producto_id, proveedor_id)
);

CREATE TABLE IF NOT EXISTS compras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  numero INTEGER NOT NULL UNIQUE,
  fecha TEXT NOT NULL,
  proveedor TEXT NOT NULL,
  condicion_pago TEXT NOT NULL CHECK (condicion_pago IN ('CONTADO','CREDITO')),
  total REAL NOT NULL DEFAULT 0,
  estado TEXT NOT NULL CHECK (estado IN ('PENDIENTE','PAGADA')) DEFAULT 'PENDIENTE',
  asiento_id INTEGER REFERENCES asientos(id),
  creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS compra_lineas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  compra_id INTEGER NOT NULL REFERENCES compras(id) ON DELETE CASCADE,
  producto_id INTEGER NOT NULL REFERENCES productos(id),
  cantidad REAL NOT NULL,
  costo_unitario REAL NOT NULL,
  subtotal REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS pagos_compra (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  compra_id INTEGER NOT NULL REFERENCES compras(id),
  fecha TEXT NOT NULL,
  monto REAL NOT NULL,
  metodo TEXT NOT NULL CHECK (metodo IN ('EFECTIVO','TRANSFERENCIA','TARJETA','CHEQUE')),
  asiento_id INTEGER REFERENCES asientos(id)
);

CREATE TABLE IF NOT EXISTS factura_lineas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  factura_id INTEGER NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
  producto_id INTEGER NOT NULL REFERENCES productos(id),
  modalidad TEXT NOT NULL CHECK (modalidad IN ('LLENO','INTERCAMBIO')) DEFAULT 'INTERCAMBIO',
  cantidad REAL NOT NULL,
  precio_unitario REAL NOT NULL,
  descuento REAL NOT NULL DEFAULT 0,
  itbis REAL NOT NULL DEFAULT 0,
  subtotal REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS envases_cliente (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  producto_id INTEGER NOT NULL REFERENCES productos(id),
  cantidad REAL NOT NULL DEFAULT 0,
  fianza_total REAL NOT NULL DEFAULT 0,
  UNIQUE(cliente_id, producto_id)
);

CREATE TABLE IF NOT EXISTS envase_movimientos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  producto_id INTEGER NOT NULL REFERENCES productos(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('ENTREGA','DEVOLUCION')),
  cantidad REAL NOT NULL,
  factura_id INTEGER REFERENCES facturas(id),
  fecha TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  nota TEXT
);

-- Botellas fiadas: el cliente se lleva la botella sin dejar la suya ni pagar deposito, y la debe.
-- Solo es un control (no mueve la contabilidad): FIADO suma lo que debe, DEVOLUCION lo resta.
CREATE TABLE IF NOT EXISTS botellas_fiadas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  producto_id INTEGER NOT NULL REFERENCES productos(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('FIADO','DEVOLUCION')),
  cantidad REAL NOT NULL CHECK (cantidad > 0),
  fecha TEXT NOT NULL,
  nota TEXT,
  creado_por TEXT,
  creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_botellas_fiadas_cliente ON botellas_fiadas(cliente_id, producto_id);

CREATE TABLE IF NOT EXISTS cobros (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  factura_id INTEGER NOT NULL REFERENCES facturas(id),
  fecha TEXT NOT NULL,
  monto REAL NOT NULL,
  metodo TEXT NOT NULL CHECK (metodo IN ('EFECTIVO','TRANSFERENCIA','TARJETA','CHEQUE')),
  asiento_id INTEGER REFERENCES asientos(id),
  nota TEXT
);

CREATE TABLE IF NOT EXISTS company_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  nombre_empresa TEXT NOT NULL DEFAULT 'Darasistema',
  rnc TEXT,
  direccion TEXT,
  telefono TEXT,
  itbis_rate REAL NOT NULL DEFAULT 0.18
);

-- Cajas fisicas (gavetas de dinero). Una caja puede tener una sola jornada abierta a la vez.
CREATE TABLE IF NOT EXISTS cajas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  activa INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Jornada de caja: desde la apertura hasta el cierre. Al cerrar se guarda una
-- foto del resumen (resumen, en JSON) que ya no cambia: es el comprobante del cierre.
CREATE TABLE IF NOT EXISTS caja_sesiones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  caja_id INTEGER NOT NULL REFERENCES cajas(id),
  estado TEXT NOT NULL CHECK (estado IN ('ABIERTA','CERRADA')) DEFAULT 'ABIERTA',
  abierta_en TEXT NOT NULL,
  abierta_por_id INTEGER,
  abierta_por_nombre TEXT NOT NULL,
  monto_inicial REAL NOT NULL DEFAULT 0,
  cerrada_en TEXT,
  cerrada_por_id INTEGER,
  cerrada_por_nombre TEXT,
  efectivo_esperado REAL,
  efectivo_contado REAL,
  diferencia REAL,
  observaciones TEXT,
  resumen TEXT,
  asiento_diferencia_id INTEGER REFERENCES asientos(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_caja_una_jornada_abierta ON caja_sesiones(caja_id) WHERE estado = 'ABIERTA';

-- Entradas y salidas de efectivo que no son ventas (fondo, depositos, gastos menores...).
CREATE TABLE IF NOT EXISTS caja_movimientos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sesion_id INTEGER NOT NULL REFERENCES caja_sesiones(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('ENTRADA','SALIDA')),
  motivo TEXT NOT NULL,
  concepto TEXT,
  monto REAL NOT NULL,
  usuario_id INTEGER,
  usuario_nombre TEXT NOT NULL,
  asiento_id INTEGER REFERENCES asientos(id),
  creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Correcciones administrativas de un cierre: el cierre original nunca se edita.
CREATE TABLE IF NOT EXISTS caja_correcciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sesion_id INTEGER NOT NULL REFERENCES caja_sesiones(id),
  usuario_id INTEGER,
  usuario_nombre TEXT NOT NULL,
  motivo TEXT NOT NULL,
  efectivo_contado_anterior REAL NOT NULL,
  efectivo_contado_nuevo REAL NOT NULL,
  diferencia_nueva REAL NOT NULL,
  asiento_id INTEGER REFERENCES asientos(id),
  creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Registro de auditoria: quien hizo que y cuando (solo se agregan filas).
CREATE TABLE IF NOT EXISTS auditoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  usuario_id INTEGER,
  usuario_nombre TEXT NOT NULL,
  accion TEXT NOT NULL,
  entidad TEXT NOT NULL,
  entidad_id INTEGER,
  detalle TEXT
);

CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  rol TEXT NOT NULL CHECK (rol IN ('ADMIN','CAJERO')),
  activo INTEGER NOT NULL DEFAULT 1
);

-- Cuentas de banco de la empresa (cada una con su cuenta contable).
CREATE TABLE IF NOT EXISTS bancos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  numero_cuenta TEXT,
  cuenta_id INTEGER NOT NULL UNIQUE REFERENCES cuentas_contables(id),
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Recibo de cobro: un pago del cliente que se reparte entre una o varias facturas.
-- Cada factura pagada queda como un cobro normal ligado al recibo (cobros.recibo_id).
CREATE TABLE IF NOT EXISTS recibos_cobro (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  numero INTEGER NOT NULL UNIQUE,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  fecha TEXT NOT NULL,
  monto REAL NOT NULL,
  metodo TEXT NOT NULL CHECK (metodo IN ('EFECTIVO','TRANSFERENCIA','TARJETA','CHEQUE')),
  banco_id INTEGER REFERENCES bancos(id),
  referencia TEXT,
  nota TEXT,
  asiento_id INTEGER REFERENCES asientos(id),
  caja_sesion_id INTEGER REFERENCES caja_sesiones(id),
  creado_por TEXT,
  creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Tipos de gasto (combustible, reparacion de vehiculos, luz...), cada uno con su cuenta de gasto.
CREATE TABLE IF NOT EXISTS tipos_gasto (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE,
  cuenta_id INTEGER NOT NULL REFERENCES cuentas_contables(id),
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Facturas de suplidores que no son mercancia (servicios, combustible, reparaciones...).
-- A credito quedan en Cuentas por Pagar hasta que se pagan.
CREATE TABLE IF NOT EXISTS gastos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  numero INTEGER NOT NULL UNIQUE,
  fecha TEXT NOT NULL,
  vence TEXT,
  proveedor_id INTEGER REFERENCES proveedores(id),
  suplidor TEXT NOT NULL,
  rnc TEXT,
  ncf TEXT,
  tipo_gasto_id INTEGER NOT NULL REFERENCES tipos_gasto(id),
  concepto TEXT,
  subtotal REAL NOT NULL,
  itbis REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL,
  condicion_pago TEXT NOT NULL CHECK (condicion_pago IN ('CONTADO','CREDITO')),
  estado TEXT NOT NULL CHECK (estado IN ('PENDIENTE','PAGADA','ANULADA')) DEFAULT 'PENDIENTE',
  asiento_id INTEGER REFERENCES asientos(id),
  creado_por TEXT,
  creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS pagos_gasto (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gasto_id INTEGER NOT NULL REFERENCES gastos(id),
  fecha TEXT NOT NULL,
  monto REAL NOT NULL,
  metodo TEXT NOT NULL CHECK (metodo IN ('EFECTIVO','TRANSFERENCIA','TARJETA','CHEQUE')),
  banco_id INTEGER REFERENCES bancos(id),
  referencia TEXT,
  asiento_id INTEGER REFERENCES asientos(id),
  creado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Lineas del estado de cuenta que se baja del banco, para conciliarlas con la contabilidad.
-- monto > 0 entro dinero al banco; monto < 0 salio. Al conciliar se liga a la linea
-- del asiento que la explica (asiento_linea_id).
CREATE TABLE IF NOT EXISTS banco_movimientos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  banco_id INTEGER NOT NULL REFERENCES bancos(id),
  fecha TEXT NOT NULL,
  descripcion TEXT,
  referencia TEXT,
  monto REAL NOT NULL,
  huella TEXT NOT NULL,
  asiento_linea_id INTEGER UNIQUE REFERENCES asiento_lineas(id),
  importado_en TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (banco_id, huella)
);
`;
