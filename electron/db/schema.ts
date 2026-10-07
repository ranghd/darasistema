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
  tipo TEXT NOT NULL CHECK (tipo IN ('B01','B02','B03','B04','B11','B12','B13','B14','B15','B16')),
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
  tipo TEXT NOT NULL CHECK (tipo IN ('B11','B12','B16')),
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

CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  rol TEXT NOT NULL CHECK (rol IN ('ADMIN','CAJERO')),
  activo INTEGER NOT NULL DEFAULT 1
);
`;
