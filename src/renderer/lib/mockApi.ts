// Adaptador de SOLO LECTURA (con escritura simulada en memoria) usado unicamente
// cuando la app corre como pagina web normal (sin Electron), para poder revisar
// visualmente las pantallas en el navegador integrado durante el desarrollo.
// La app real siempre usa window.api expuesto por electron/preload.ts.
import type {
  Cliente,
  Cuenta,
  Factura,
  FacturaDetalle,
  NcfSecuencia,
  Producto,
  Usuario,
} from "./types";

const cuentas: Cuenta[] = [
  { id: 1, codigo: "1", nombre: "ACTIVO", tipo: "ACTIVO", padre_id: null, naturaleza: "DEUDORA", es_movimiento: 0, activo: 1 },
  { id: 3, codigo: "1.1.01", nombre: "Caja General", tipo: "ACTIVO", padre_id: 1, naturaleza: "DEUDORA", es_movimiento: 1, activo: 1 },
  { id: 4, codigo: "1.1.02", nombre: "Banco", tipo: "ACTIVO", padre_id: 1, naturaleza: "DEUDORA", es_movimiento: 1, activo: 1 },
  { id: 5, codigo: "1.1.03", nombre: "Cuentas por Cobrar Clientes", tipo: "ACTIVO", padre_id: 1, naturaleza: "DEUDORA", es_movimiento: 1, activo: 1 },
  { id: 9, codigo: "2", nombre: "PASIVO", tipo: "PASIVO", padre_id: null, naturaleza: "ACREEDORA", es_movimiento: 0, activo: 1 },
  { id: 12, codigo: "2.1.02", nombre: "ITBIS por Pagar", tipo: "PASIVO", padre_id: 9, naturaleza: "ACREEDORA", es_movimiento: 1, activo: 1 },
  { id: 14, codigo: "3", nombre: "PATRIMONIO", tipo: "PATRIMONIO", padre_id: null, naturaleza: "ACREEDORA", es_movimiento: 0, activo: 1 },
  { id: 17, codigo: "4", nombre: "INGRESOS", tipo: "INGRESOS", padre_id: null, naturaleza: "ACREEDORA", es_movimiento: 0, activo: 1 },
  { id: 18, codigo: "4.1.01", nombre: "Ingresos por Venta de Gas", tipo: "INGRESOS", padre_id: 17, naturaleza: "ACREEDORA", es_movimiento: 1, activo: 1 },
  { id: 21, codigo: "5", nombre: "COSTOS", tipo: "COSTOS", padre_id: null, naturaleza: "DEUDORA", es_movimiento: 0, activo: 1 },
  { id: 25, codigo: "6", nombre: "GASTOS", tipo: "GASTOS", padre_id: null, naturaleza: "DEUDORA", es_movimiento: 0, activo: 1 },
];

const clientes: Cliente[] = [
  { id: 1, codigo: "CLI-0001", nombre: "Colmado Dona Maria (vista previa)", rnc_cedula: "001-1234567-8", tipo: "FISICA", telefono: "809-555-1201", email: null, direccion: "Villa Mella", activo: 1, creado_en: new Date().toISOString() },
  { id: 2, codigo: "CLI-0002", nombre: "Clinica San Rafael SRL", rnc_cedula: "1-01-98765-2", tipo: "JURIDICA", telefono: "809-555-1340", email: "compras@sanrafael.do", direccion: "Santo Domingo", activo: 1, creado_en: new Date().toISOString() },
];

const productos: Producto[] = [
  { id: 1, codigo: "GAS-25", nombre: "Cilindro de Gas Propano 25 lb", categoria: "GAS", unidad: "CILINDRO", precio_contenido: 650, costo_contenido: 420, maneja_envase: 1, fianza_envase: 1500, cuenta_ingreso_id: 18, cuenta_costo_id: 21, cuenta_inventario_id: 3, existencia: 40, activo: 1 },
  { id: 5, codigo: "AGUA-5G", nombre: "Botellon de Agua Purificada 5 Gal", categoria: "AGUA", unidad: "BOTELLON", precio_contenido: 90, costo_contenido: 35, maneja_envase: 1, fianza_envase: 350, cuenta_ingreso_id: 18, cuenta_costo_id: 21, cuenta_inventario_id: 3, existencia: 120, activo: 1 },
];

const facturas: Factura[] = [
  { id: 1, numero: 1, ncf: "B0100000001", cliente_id: 1, fecha: new Date().toISOString().slice(0, 10), condicion_pago: "CONTADO", subtotal: 650, itbis: 117, fianza_total: 1500, total: 2267, estado: "PAGADA", asiento_id: 1, nota_credito_ncf: null, nota_debito_ncf: null, creado_en: new Date().toISOString(), cliente_nombre: clientes[0].nombre, cobrado: 0 },
];

const ncfSecuencias: NcfSecuencia[] = [
  { id: 1, tipo: "B01", prefijo: "B01", desde: 1, hasta: 500, actual: 2, vencimiento: "2026-12-31", activo: 1 },
  { id: 2, tipo: "B02", prefijo: "B02", desde: 1, hasta: 2000, actual: 1, vencimiento: "2026-12-31", activo: 1 },
];

function warn() {
  // eslint-disable-next-line no-console
  console.warn("[mockApi] Vista previa en navegador: los datos son de ejemplo y no se guardan.");
}

export const mockApi = {
  cuentas: {
    listar: async () => cuentas,
    crear: async (data: any) => { warn(); return { id: Date.now(), ...data }; },
    actualizar: async (_id: number, data: any) => { warn(); return data; },
  },
  asientos: {
    listar: async (..._args: any[]) => [],
    crear: async (..._args: any[]) => { warn(); return 1; },
    libroMayor: async (..._args: any[]) => [],
    balanceComprobacion: async (..._args: any[]) =>
      cuentas
        .filter((c) => c.es_movimiento)
        .map((c) => ({ id: c.id, codigo: c.codigo, nombre: c.nombre, tipo: c.tipo, naturaleza: c.naturaleza, total_debito: 1000, total_credito: 1000 })),
  },
  clientes: {
    listar: async (..._args: any[]) => clientes,
    obtener: async (id: number, ..._rest: any[]) => clientes.find((c) => c.id === id),
    estadoCuenta: async (..._args: any[]) => ({ facturas, envases: [] }),
    crear: async (data: any, ..._rest: any[]) => { warn(); return { id: Date.now(), ...data }; },
    actualizar: async (_id: number, data: any, ..._rest: any[]) => { warn(); return data; },
  },
  productos: {
    listar: async (..._args: any[]) => productos,
    crear: async (data: any, ..._rest: any[]) => { warn(); return { id: Date.now(), ...data }; },
    actualizar: async (_id: number, data: any, ..._rest: any[]) => { warn(); return data; },
  },
  facturas: {
    listar: async (..._args: any[]) => facturas,
    obtener: async (id: number, ..._rest: any[]) => ({ ...facturas.find((f) => f.id === id)!, lineas: [] } as FacturaDetalle),
    crear: async (data: any, ..._rest: any[]) => { warn(); return { id: Date.now(), numero: 99, ncf: "B0100000099", ...data }; },
    anular: async (id: number, ..._rest: any[]) => facturas.find((f) => f.id === id),
    agregarNotaDebito: async (data: any, ..._rest: any[]) => { warn(); return { ...facturas.find((f) => f.id === data.factura_id), nota_debito_ncf: "B0300000001" }; },
    agregarNotaCredito: async (data: any, ..._rest: any[]) => { warn(); return { ...facturas.find((f) => f.id === data.factura_id), nota_credito_ncf: "B0400000001" }; },
  },
  comprobantes: {
    listar: async (..._args: any[]) => [],
    registrar: async (data: any, ..._rest: any[]) => { warn(); return { id: Date.now(), ncf: `${data.tipo}00000001`, ...data }; },
  },
  cobros: {
    listarPorFactura: async (..._args: any[]) => [],
    crear: async (data: any, ..._rest: any[]) => { warn(); return { id: Date.now(), ...data }; },
  },
  envases: {
    saldos: async (..._args: any[]) => [
      { cliente_id: 1, cliente_nombre: clientes[0].nombre, producto_id: 1, producto_nombre: productos[0].nombre, cantidad: 3, fianza_total: 4500 },
    ],
    movimientos: async (..._args: any[]) => [],
    devolucion: async (..._args: any[]) => { warn(); return true; },
  },
  reportes: {
    estadoResultados: async (..._args: any[]) => ({ ingresos: 185000, costos: 98000, utilidadBruta: 87000, gastos: 32000, utilidadNeta: 55000, detalle: [] }),
    balanceGeneral: async (..._args: any[]) => ({ activo: [], pasivo: [], patrimonio: [], utilidadDelPeriodo: 55000, totalActivo: 420000, totalPasivo: 95000, totalPatrimonio: 325000 }),
    itbis: async (..._args: any[]) => ({ resumen: { cantidad_facturas: 12, subtotal: 185000, itbis: 33300, total: 218300 }, facturas: [] }),
    cuentasPorCobrar: async (..._args: any[]) => [],
    dashboard: async (..._args: any[]) => ({ ventasMes: 218300, porCobrar: 45000, facturasHoy: 3, envasesCirculando: 18, productosBajoStock: [] }),
  },
  config: {
    obtener: async (..._args: any[]) => ({ id: 1 as const, nombre_empresa: "Darasistema SRL (vista previa)", rnc: "1-30-12345-6", direccion: "Santo Domingo", telefono: "809-555-0100", itbis_rate: 0.18 }),
    actualizar: async (data: any, ..._rest: any[]) => { warn(); return data; },
  },
  auth: {
    login: async (usuario: string, password: string) => {
      if (usuario === "admin" && password === "admin") return { id: 1, usuario: "admin", nombre: "Administrador", rol: "ADMIN" as const };
      if (usuario === "cajero" && password === "cajero") return { id: 2, usuario: "cajero", nombre: "Cajero", rol: "CAJERO" as const };
      throw new Error("Usuario o contrasena incorrectos");
    },
  },
  usuarios: {
    listar: async (): Promise<Usuario[]> => [
      { id: 1, usuario: "admin", nombre: "Administrador", rol: "ADMIN", activo: 1 },
      { id: 2, usuario: "cajero", nombre: "Cajero", rol: "CAJERO", activo: 1 },
    ],
    crear: async (data: any): Promise<Usuario> => { warn(); return { id: Date.now(), usuario: data.usuario, nombre: data.nombre, rol: data.rol, activo: 1 }; },
    actualizar: async (id: number, data: any): Promise<Usuario> => { warn(); return { id, usuario: "x", nombre: data.nombre, rol: data.rol, activo: data.activo ?? 1 }; },
  },
  ncf: {
    listar: async (..._args: any[]) => ncfSecuencias,
    crear: async (data: any, ..._rest: any[]) => { warn(); return { id: Date.now(), ...data }; },
    actualizar: async (_id: number, data: any, ..._rest: any[]) => { warn(); return data; },
  },
  app: {
    version: async (..._args: any[]) => "0.0.0-preview",
    reiniciar: async (..._args: any[]) => { warn(); },
  },
  red: {
    obtenerConfig: async (..._args: any[]) => ({ modo: "SERVIDOR" as const, puerto: 4500, servidorUrl: undefined, ips: ["192.168.1.50"] }),
    guardarConfig: async (data: any, ..._rest: any[]) => { warn(); return data; },
    probarConexion: async (..._args: any[]) => { warn(); return { ok: true }; },
  },
};
