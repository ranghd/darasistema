// Canales que puede usar un CAJERO: exactamente los que usan las pantallas de
// cajero (Panel, Caja, Facturas, Cuentas por Cobrar, Clientes, Productos,
// Envases). Todo lo demas (contabilidad, reportes, compras, comprobantes,
// configuracion, usuarios, NCF) queda solo para ADMIN, tambien en el servidor.
export const CANALES_CAJERO = new Set([
  "reportes:dashboard",
  "reportes:cuentasPorCobrar",
  "config:obtener",
  "cuentas:listar",
  "productos:listar",
  "productos:crear",
  "productos:actualizar",
  "clientes:listar",
  "clientes:obtener",
  "clientes:estadoCuenta",
  "cajas:listar",
  "caja:sesionActual",
  "caja:abrir",
  "caja:resumen",
  "caja:movimiento",
  "caja:movimientos",
  "caja:motivos",
  "caja:cerrar",
  "caja:misCierres",
  "caja:detalle",
  "clientes:historial",
  "clientes:resumen",
  "clientes:crear",
  "clientes:actualizar",
  "facturas:listar",
  "facturas:obtener",
  "facturas:crear",
  "facturas:anular",
  "facturas:agregarNotaDebito",
  "facturas:agregarNotaCredito",
  "cobros:listarPorFactura",
  "cobros:crear",
  "reportes:cxcPorCliente",
  "recibos:pendientes",
  "recibos:crear",
  "recibos:listar",
  "recibos:obtener",
  "bancos:listar",
  "envases:saldos",
  "envases:movimientos",
  "envases:devolucion",
  "platos:listar",
  "platos:guardar",
  "platos:quitar",
  "platos:copiar",
  "fiados:saldos",
  "fiados:movimientos",
  "fiados:fiar",
  "fiados:devolver",
  "categorias:listar",
]);

// La caja de Gas Damian tambien lleva el inventario. Solo esa empresa: en las demas sigue siendo de ADMIN.
const EMPRESAS_CAJA_CON_INVENTARIO = new Set(["gasdamian"]);
const CANALES_INVENTARIO_CAJA = new Set([
  "categorias:crear",
  "categorias:renombrar",
  "categorias:borrar",
  "compras:listar",
  "compras:obtener",
  "compras:crear",
  "pagosCompra:listarPorCompra",
  "pagosCompra:crear",
  "proveedores:listar",
  "proveedores:obtener",
  "proveedores:crear",
  "proveedores:actualizar",
  "proveedores:relaciones",
  "proveedores:productos",
  "proveedores:deProducto",
  "proveedores:historialPrecios",
  "proveedores:vincular",
  "proveedores:desvincular",
]);

export type Rol = "ADMIN" | "CAJERO";

export function puedeInvocar(rol: Rol, canal: string, empresa?: string): boolean {
  if (canal.startsWith("auth:")) return false;
  if (rol === "ADMIN") return true;
  if (empresa && EMPRESAS_CAJA_CON_INVENTARIO.has(empresa) && CANALES_INVENTARIO_CAJA.has(canal)) return true;
  return CANALES_CAJERO.has(canal);
}
