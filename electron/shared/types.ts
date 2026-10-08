export type TipoCuenta = "ACTIVO" | "PASIVO" | "PATRIMONIO" | "INGRESOS" | "GASTOS" | "COSTOS";
export type Naturaleza = "DEUDORA" | "ACREEDORA";

export interface Cuenta {
  id: number;
  codigo: string;
  nombre: string;
  tipo: TipoCuenta;
  padre_id: number | null;
  naturaleza: Naturaleza;
  es_movimiento: number;
  activo: number;
}

export interface AsientoLineaInput {
  cuenta_id: number;
  debito: number;
  credito: number;
  descripcion?: string;
}

export interface Asiento {
  id: number;
  numero: number;
  fecha: string;
  concepto: string;
  origen: "MANUAL" | "FACTURA" | "COBRO" | "AJUSTE";
  referencia_id: number | null;
  creado_en: string;
}

export interface AsientoConLineas extends Asiento {
  lineas: (AsientoLineaInput & { id: number; cuenta_codigo: string; cuenta_nombre: string })[];
}

export interface Cliente {
  id: number;
  codigo: string;
  nombre: string;
  rnc_cedula: string | null;
  tipo: "FISICA" | "JURIDICA";
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  activo: number;
  creado_en: string;
}

export type CategoriaProducto = "GAS" | "OXIGENO" | "AGUA" | "OTRO";

export interface Producto {
  id: number;
  codigo: string;
  nombre: string;
  categoria: CategoriaProducto;
  unidad: string;
  precio_contenido: number;
  costo_contenido: number;
  maneja_envase: number;
  fianza_envase: number;
  itbis_rate: number;
  cuenta_ingreso_id: number | null;
  cuenta_costo_id: number | null;
  cuenta_inventario_id: number | null;
  existencia: number;
  activo: number;
}

export type TipoNcf = "B01" | "B02" | "B03" | "B04" | "B11" | "B12" | "B13" | "B14" | "B15" | "B16";

export interface NcfSecuencia {
  id: number;
  tipo: TipoNcf;
  prefijo: string;
  desde: number;
  hasta: number;
  actual: number;
  vencimiento: string | null;
  activo: number;
}

export type ModalidadLinea = "LLENO" | "INTERCAMBIO";

export interface FacturaLineaInput {
  producto_id: number;
  modalidad: ModalidadLinea;
  cantidad: number;
  precio_unitario: number;
  descuento: number;
}

export interface FacturaLinea extends FacturaLineaInput {
  id: number;
  itbis: number;
  subtotal: number;
  producto_nombre?: string;
}

export interface Factura {
  id: number;
  numero: number;
  ncf: string | null;
  cliente_id: number;
  fecha: string;
  condicion_pago: "CONTADO" | "CREDITO";
  metodo_pago: MetodoPago | null;
  subtotal: number;
  itbis: number;
  fianza_total: number;
  total: number;
  estado: "PENDIENTE" | "PAGADA" | "ANULADA";
  asiento_id: number | null;
  nota_credito_ncf: string | null;
  nota_debito_ncf: string | null;
  creado_por?: string | null;
  creado_en: string;
  cliente_nombre?: string;
  cobrado?: number;
}

export interface FacturaDetalle extends Factura {
  lineas: FacturaLinea[];
}

export type MetodoPago = "EFECTIVO" | "TRANSFERENCIA" | "TARJETA" | "CHEQUE";

export interface NuevaFacturaInput {
  cliente_id: number;
  fecha: string;
  condicion_pago: "CONTADO" | "CREDITO";
  metodo_pago?: MetodoPago;
  tipo_ncf: "B01" | "B02" | "B13" | "B14" | "B15";
  lineas: FacturaLineaInput[];
  /** Nombre del usuario que hizo la venta. */
  creado_por?: string;
}

export interface FiltrosHistorial {
  desde?: string;
  hasta?: string;
  /** Busca en NCF, numero, productos, notas y usuario. */
  busqueda?: string;
  producto_id?: number;
  /** EFECTIVO, TRANSFERENCIA... (ventas al contado) o CREDITO. */
  metodo?: string;
  estado?: "PENDIENTE" | "PAGADA" | "ANULADA";
  usuario?: string;
  /** Solo estas facturas (para ver/imprimir/exportar una seleccion). */
  ids?: number[];
  pagina?: number;
  porPagina?: number;
}

export interface FacturaHistorial extends FacturaDetalle {
  cobros: Cobro[];
}

export interface HistorialCliente {
  filas: FacturaHistorial[];
  total: number;
  sumaTotal: number;
  pagina: number;
  porPagina: number;
}

export interface ProductoComprado {
  producto_id: number;
  producto_nombre: string;
  cantidad: number;
  monto: number;
  veces: number;
  ultima_fecha: string;
}

export interface ResumenCliente {
  compras: number;
  anuladas: number;
  total_gastado: number;
  ticket_promedio: number;
  primera_compra: string | null;
  ultima_compra: string | null;
  saldo_pendiente: number;
  facturas_pendientes: number;
  productos: ProductoComprado[];
  usuarios: string[];
}

export interface Cobro {
  id: number;
  factura_id: number;
  fecha: string;
  monto: number;
  metodo: "EFECTIVO" | "TRANSFERENCIA" | "TARJETA" | "CHEQUE";
  asiento_id: number | null;
  nota: string | null;
}

export interface CompraLineaInput {
  producto_id: number;
  cantidad: number;
  costo_unitario: number;
  actualizarCosto?: boolean;
}

export interface CompraLinea extends CompraLineaInput {
  id: number;
  subtotal: number;
  producto_nombre?: string;
}

export interface NuevaCompraInput {
  fecha: string;
  /** Proveedor guardado. Si no viene, se busca o se crea por nombre. */
  proveedor_id?: number;
  proveedor?: string;
  condicion_pago: "CONTADO" | "CREDITO";
  lineas: CompraLineaInput[];
}

export interface Compra {
  id: number;
  numero: number;
  fecha: string;
  proveedor: string;
  proveedor_id?: number | null;
  condicion_pago: "CONTADO" | "CREDITO";
  total: number;
  estado: "PENDIENTE" | "PAGADA";
  asiento_id: number | null;
  creado_en: string;
  pagado?: number;
}

export interface CompraDetalle extends Compra {
  lineas: CompraLinea[];
}

export interface Proveedor {
  id: number;
  nombre: string;
  telefono: string | null;
  direccion: string | null;
  rnc: string | null;
  contacto: string | null;
  notas: string | null;
  activo: number;
  creado_en: string;
}

export interface ProveedorConResumen extends Proveedor {
  compras: number;
  total_comprado: number;
  ultima_compra: string | null;
  por_pagar: number;
  productos: number;
}

/** Datos de la relacion producto <-> proveedor, con lo calculado del historial de compras. */
export interface RelacionProductoProveedor {
  producto_id: number;
  producto_nombre: string;
  producto_codigo: string;
  costo_promedio: number;
  proveedor_id: number;
  proveedor_nombre: string;
  proveedor_activo: number;
  codigo_proveedor: string | null;
  precio_referencia: number | null;
  ultimo_precio: number | null;
  ultima_fecha: string | null;
  cantidad_total: number;
  veces: number;
  precio_min: number | null;
  precio_max: number | null;
}

export interface PrecioHistorico {
  compra_id: number;
  compra_numero: number;
  fecha: string;
  proveedor_id: number | null;
  proveedor_nombre: string;
  producto_id: number;
  producto_nombre: string;
  cantidad: number;
  costo_unitario: number;
  subtotal: number;
}

export interface PagoCompra {
  id: number;
  compra_id: number;
  fecha: string;
  monto: number;
  metodo: "EFECTIVO" | "TRANSFERENCIA" | "TARJETA" | "CHEQUE";
  asiento_id: number | null;
}

export type TipoComprobanteVarios = "B11" | "B12" | "B16";

export interface NuevoComprobanteVariosInput {
  tipo: TipoComprobanteVarios;
  fecha: string;
  concepto: string;
  contraparte?: string;
  monto: number;
  aplicaItbis: boolean;
  cuenta_id: number;
  metodo: "CAJA" | "BANCO";
}

export interface ComprobanteVarios {
  id: number;
  tipo: TipoComprobanteVarios;
  ncf: string;
  fecha: string;
  concepto: string;
  contraparte: string | null;
  monto: number;
  itbis: number;
  total: number;
  cuenta_id: number;
  cuenta_nombre?: string;
  metodo: "CAJA" | "BANCO";
  asiento_id: number | null;
  creado_en: string;
}

export interface EnvaseSaldo {
  cliente_id: number;
  producto_id: number;
  producto_nombre: string;
  cantidad: number;
  fianza_total: number;
}

export interface CompanyConfig {
  id: 1;
  nombre_empresa: string;
  rnc: string | null;
  direccion: string | null;
  telefono: string | null;
  itbis_rate: number;
}

export interface ApiError {
  message: string;
}

export type RolUsuario = "ADMIN" | "CAJERO";

export interface Usuario {
  id: number;
  usuario: string;
  nombre: string;
  rol: RolUsuario;
  activo: number;
}

export interface SesionUsuario {
  id: number;
  usuario: string;
  nombre: string;
  rol: RolUsuario;
}
