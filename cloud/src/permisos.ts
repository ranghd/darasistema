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
  "envases:saldos",
  "envases:movimientos",
  "envases:devolucion",
]);

export type Rol = "ADMIN" | "CAJERO";

export function puedeInvocar(rol: Rol, canal: string): boolean {
  if (canal.startsWith("auth:")) return false;
  if (rol === "ADMIN") return true;
  return CANALES_CAJERO.has(canal);
}
