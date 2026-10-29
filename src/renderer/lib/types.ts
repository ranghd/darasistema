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

export interface SaldoCuenta {
  cuenta_id: number;
  debito: number;
  credito: number;
  movimientos: number;
  ultima_fecha: string | null;
}

export interface MovimientoMayor {
  fecha: string;
  numero: number;
  concepto: string;
  debito: number;
  credito: number;
  descripcion: string | null;
  saldo: number;
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
  /** Grupo libre del producto (edicion colmado): Viveres, Bebidas, Lacteos... */
  grupo?: string | null;
  /** Codigo de barras (lo lee la pistola); el codigo del producto es el corto. */
  codigo_barras?: string | null;
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
  /** Jornada de caja abierta en la que se cobra la venta. */
  caja_sesion_id?: number | null;
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
  recibo_id?: number | null;
  recibo_numero?: number | null;
  banco_id?: number | null;
  banco_nombre?: string | null;
  referencia?: string | null;
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
  /** NCF de la factura del proveedor (para el 606). */
  ncf?: string;
  condicion_pago: "CONTADO" | "CREDITO";
  lineas: CompraLineaInput[];
}

export interface Compra {
  id: number;
  numero: number;
  fecha: string;
  proveedor: string;
  proveedor_id?: number | null;
  ncf?: string | null;
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
  /** Tipo de negocio: "gas" (gas, oxigeno y agua) o "colmado". */
  rubro?: Rubro;
}

export type Rubro = "gas" | "colmado";

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

export interface ConfigImpresion {
  impresora: string;
  anchoMm: 58 | 80;
  formato: "TICKET" | "CARTA";
  imprimirAlCobrar: boolean;
}

export interface ResultadoImpresion {
  impresora: string;
  /** true: Windows confirmo que entrego el trabajo a la impresora. */
  entregado: boolean;
}

export interface EstadoImpresora {
  verificado: boolean;
  existe: boolean;
  nombre: string;
  desconectada: boolean;
  problema: string | null;
  trabajosPendientes: number;
  /** Explicacion para el usuario si no va a poder imprimir, o null. */
  mensaje: string | null;
}

export interface ImpresoraInfo {
  nombre: string;
  descripcion: string;
  predeterminada: boolean;
}

// ---------- Caja: aperturas, cierres y movimientos ----------

export type MetodoCaja = "EFECTIVO" | "TARJETA" | "TRANSFERENCIA" | "CHEQUE";

/** Quien hace la operacion. En la nube lo pone el servidor desde la sesion. */
export interface Autor {
  id?: number | null;
  nombre: string;
  rol?: "ADMIN" | "CAJERO";
}

export interface Caja {
  id: number;
  nombre: string;
  activa: number;
  creado_en: string;
  /** Jornada abierta ahora mismo, si hay. */
  sesion_abierta_id?: number | null;
  abierta_por_nombre?: string | null;
  abierta_en?: string | null;
}

export type MotivoMovimientoCaja = "FONDO_BANCO" | "APORTE" | "DEPOSITO_BANCO" | "GASTO" | "RETIRO_DUENO";

export interface MovimientoCaja {
  id: number;
  sesion_id: number;
  tipo: "ENTRADA" | "SALIDA";
  motivo: MotivoMovimientoCaja;
  concepto: string | null;
  monto: number;
  usuario_nombre: string;
  creado_en: string;
}

/** Totales de una jornada. Al cerrar se guarda tal cual y ya no cambia. */
export interface ResumenCaja {
  monto_inicial: number;
  ventas: {
    cantidad: number;
    total_general: number;
    subtotal: number;
    descuentos: number;
    itbis: number;
    fianzas: number;
    por_metodo: Record<MetodoCaja | "CREDITO", number>;
  };
  anuladas: { cantidad: number; total: number };
  /** Facturas de jornadas anteriores anuladas en esta, pagadas en efectivo: salio dinero de esta caja. */
  devoluciones_efectivo: number;
  cobros: Record<MetodoCaja, number> & { total: number };
  entradas: number;
  salidas: number;
  reembolsos_envases: number;
  efectivo_esperado: number;
}

export type ResultadoCierre = "CUADRE" | "SOBRANTE" | "FALTANTE";

export interface SesionCaja {
  id: number;
  caja_id: number;
  caja_nombre?: string;
  estado: "ABIERTA" | "CERRADA";
  abierta_en: string;
  abierta_por_id: number | null;
  abierta_por_nombre: string;
  monto_inicial: number;
  cerrada_en: string | null;
  cerrada_por_id: number | null;
  cerrada_por_nombre: string | null;
  efectivo_esperado: number | null;
  efectivo_contado: number | null;
  diferencia: number | null;
  observaciones: string | null;
  /** Resumen congelado al cerrar (o calculado en vivo si esta abierta). */
  resumen: ResumenCaja;
  /** Resultado considerando la ultima correccion administrativa, si la hubo. */
  resultado: ResultadoCierre | null;
  diferencia_final: number | null;
  efectivo_contado_final: number | null;
  correcciones: number;
}

export interface CorreccionCierre {
  id: number;
  sesion_id: number;
  usuario_nombre: string;
  motivo: string;
  efectivo_contado_anterior: number;
  efectivo_contado_nuevo: number;
  diferencia_nueva: number;
  creado_en: string;
}

export interface RegistroAuditoria {
  id: number;
  fecha: string;
  usuario_nombre: string;
  accion: string;
  entidad: string;
  entidad_id: number | null;
  detalle: string | null;
}

export interface DetalleCierre extends SesionCaja {
  facturas: { id: number; numero: number; ncf: string | null; cliente_nombre: string; condicion_pago: string; metodo_pago: string | null; total: number; estado: string; creado_en: string; creado_por: string | null }[];
  anuladas_detalle: { id: number; numero: number; ncf: string | null; total: number; metodo_pago: string | null; condicion_pago: string; de_otra_jornada: number }[];
  cobros_detalle: { id: number; factura_id: number; ncf: string | null; monto: number; metodo: string; fecha: string }[];
  movimientos: MovimientoCaja[];
  reembolsos: { id: number; cliente_nombre: string; producto_nombre: string; cantidad: number; monto_reembolsado: number; fecha: string }[];
  historial_correcciones: CorreccionCierre[];
  auditoria: RegistroAuditoria[];
}

export interface FiltrosCierres {
  desde?: string;
  hasta?: string;
  cajero?: string;
  caja_id?: number;
  estado?: "ABIERTA" | ResultadoCierre;
  metodo?: MetodoCaja | "CREDITO";
}

export interface ListaCierres {
  cierres: SesionCaja[];
  totales: {
    jornadas: number;
    ventas: number;
    efectivo: number;
    tarjeta: number;
    transferencia: number;
    cheque: number;
    credito: number;
    devoluciones: number;
    entradas: number;
    salidas: number;
    sobrantes: number;
    faltantes: number;
  };
  cajeros: string[];
}

// ---------- Recibos de cobro (varias facturas) ----------

export interface FacturaPendiente {
  id: number;
  numero: number;
  ncf: string | null;
  fecha: string;
  total: number;
  cobrado: number;
  saldo: number;
  dias: number;
}

export interface NuevoReciboInput {
  cliente_id: number;
  fecha: string;
  monto: number;
  metodo: "EFECTIVO" | "TRANSFERENCIA" | "TARJETA" | "CHEQUE";
  banco_id?: number | null;
  referencia?: string;
  nota?: string;
  /** A que facturas va el pago. Si no se indica, se paga de la mas vieja a la mas nueva. */
  aplicaciones?: { factura_id: number; monto: number }[];
  caja_sesion_id?: number | null;
  creado_por?: string;
}

export interface ReciboCobro {
  id: number;
  numero: number;
  cliente_id: number;
  cliente_nombre?: string;
  fecha: string;
  monto: number;
  metodo: "EFECTIVO" | "TRANSFERENCIA" | "TARJETA" | "CHEQUE";
  banco_id: number | null;
  banco_nombre?: string | null;
  referencia: string | null;
  nota: string | null;
  asiento_id: number | null;
  caja_sesion_id: number | null;
  creado_por: string | null;
  creado_en: string;
  facturas?: number;
}

export interface ReciboDetalle extends ReciboCobro {
  cliente_rnc?: string | null;
  aplicaciones: { factura_id: number; monto: number; numero: number; ncf: string | null; fecha: string; total: number; saldo_despues: number }[];
}

// ---------- Reportes ----------

export interface CxcCliente {
  cliente_id: number;
  cliente_nombre: string;
  telefono: string | null;
  facturas: number;
  total_adeudado: number;
  b0_30: number;
  b31_60: number;
  b61_90: number;
  b90: number;
  dias_max: number;
  ultima_factura: string;
}

export interface ReporteVentas {
  desde: string;
  hasta: string;
  resumen: {
    facturas: number;
    clientes: number;
    subtotal: number;
    descuentos: number;
    itbis: number;
    fianzas: number;
    total: number;
    contado: number;
    credito: number;
    efectivo: number;
    tarjeta: number;
    transferencia: number;
    cheque: number;
    promedio: number;
    costo: number;
    ganancia: number;
    anuladas: number;
    total_anulado: number;
  };
  porProducto: { producto_id: number; codigo: string; nombre: string; categoria: string; cantidad: number; venta: number; itbis: number; descuentos: number; costo: number; ganancia: number }[];
  porVendedor: { vendedor: string; facturas: number; subtotal: number; total: number; promedio: number }[];
  porCliente: { cliente_id: number; nombre: string; facturas: number; subtotal: number; total: number }[];
  porDia: { fecha: string; facturas: number; subtotal: number; itbis: number; total: number }[];
}

// ---------- Gastos y cuentas por pagar ----------

export interface TipoGasto {
  id: number;
  nombre: string;
  cuenta_id: number;
  cuenta_codigo?: string;
  cuenta_nombre?: string;
  activo: number;
  usos?: number;
}

export interface NuevoGastoInput {
  fecha: string;
  vence?: string | null;
  proveedor_id?: number | null;
  /** Nombre del suplidor si no esta guardado (se crea solo). */
  suplidor?: string;
  rnc?: string;
  ncf?: string;
  tipo_gasto_id: number;
  concepto?: string;
  subtotal: number;
  itbis?: number;
  condicion_pago: "CONTADO" | "CREDITO";
  metodo?: "EFECTIVO" | "TRANSFERENCIA" | "TARJETA" | "CHEQUE";
  banco_id?: number | null;
  referencia?: string;
  creado_por?: string;
}

export interface Gasto {
  id: number;
  numero: number;
  fecha: string;
  vence: string | null;
  proveedor_id: number | null;
  suplidor: string;
  rnc: string | null;
  ncf: string | null;
  tipo_gasto_id: number;
  tipo_nombre?: string;
  cuenta_codigo?: string;
  cuenta_nombre?: string;
  concepto: string | null;
  subtotal: number;
  itbis: number;
  total: number;
  condicion_pago: "CONTADO" | "CREDITO";
  estado: "PENDIENTE" | "PAGADA" | "ANULADA";
  asiento_id: number | null;
  creado_por: string | null;
  creado_en: string;
  pagado?: number;
  saldo?: number;
}

export interface PagoGasto {
  id: number;
  gasto_id: number;
  fecha: string;
  monto: number;
  metodo: "EFECTIVO" | "TRANSFERENCIA" | "TARJETA" | "CHEQUE";
  banco_id: number | null;
  banco_nombre?: string | null;
  referencia: string | null;
  asiento_id: number | null;
}

export interface GastoDetalle extends Gasto {
  saldo: number;
  pagos: PagoGasto[];
}

export interface ResumenGastoTipo {
  tipo_gasto_id: number;
  nombre: string;
  cuenta_codigo: string;
  cantidad: number;
  subtotal: number;
  itbis: number;
  total: number;
  pendiente: number;
}

export interface CxpDocumento {
  origen: "COMPRA" | "GASTO";
  id: number;
  numero: number;
  fecha: string;
  vence: string | null;
  proveedor_id: number | null;
  suplidor: string;
  ncf: string | null;
  detalle: string;
  total: number;
  pagado: number;
  saldo: number;
  dias: number;
}

export interface CxpSuplidor {
  proveedor_id: number | null;
  suplidor: string;
  documentos: number;
  total_adeudado: number;
  b0_30: number;
  b31_60: number;
  b61_90: number;
  b90: number;
  dias_max: number;
}

// ---------- Bancos y conciliacion ----------

export interface Banco {
  id: number;
  nombre: string;
  numero_cuenta: string | null;
  cuenta_id: number;
  cuenta_codigo?: string;
  cuenta_nombre?: string;
  activo: number;
  saldo_libros?: number;
  sin_conciliar?: number;
  ultimo_estado?: string | null;
}

export interface LineaLibroBanco {
  id: number;
  asiento_id: number;
  asiento_numero: number;
  fecha: string;
  concepto: string;
  descripcion: string | null;
  monto: number;
  referencia: string | null;
  movimiento_id: number | null;
}

export interface MovimientoBancoInput {
  fecha: string;
  descripcion?: string;
  referencia?: string;
  monto: number;
}

export interface MovimientoBanco {
  id: number;
  banco_id: number;
  fecha: string;
  descripcion: string | null;
  referencia: string | null;
  monto: number;
  asiento_linea_id: number | null;
  asiento_numero?: number | null;
  asiento_concepto?: string | null;
  importado_en: string;
}

export interface DatosConciliacion {
  banco: Banco;
  desde: string;
  hasta: string;
  libros: LineaLibroBanco[];
  movimientos: MovimientoBanco[];
  resumen: { saldo_libros: number; conciliados: number; solo_banco: number; solo_banco_monto: number; solo_libros: number; solo_libros_monto: number };
}

export interface ResultadoImportacion {
  nuevos: number;
  repetidos: number;
  conciliados: number;
}
