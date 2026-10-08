import { contextBridge, ipcRenderer } from "electron";

const invoke = (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args);

const api = {
  cuentas: {
    listar: () => invoke("cuentas:listar"),
    crear: (data: any) => invoke("cuentas:crear", data),
    actualizar: (id: number, data: any) => invoke("cuentas:actualizar", id, data),
    saldos: (desde?: string, hasta?: string) => invoke("cuentas:saldos", desde, hasta),
  },
  asientos: {
    listar: (desde?: string, hasta?: string) => invoke("asientos:listar", desde, hasta),
    crear: (data: any) => invoke("asientos:crear", data),
    libroMayor: (cuentaId: number, desde?: string, hasta?: string) => invoke("asientos:libroMayor", cuentaId, desde, hasta),
    balanceComprobacion: (desde?: string, hasta?: string) => invoke("asientos:balanceComprobacion", desde, hasta),
    deFactura: (facturaId: number) => invoke("asientos:deFactura", facturaId),
  },
  clientes: {
    listar: () => invoke("clientes:listar"),
    obtener: (id: number) => invoke("clientes:obtener", id),
    estadoCuenta: (id: number) => invoke("clientes:estadoCuenta", id),
    historial: (id: number, filtros?: any) => invoke("clientes:historial", id, filtros),
    resumen: (id: number) => invoke("clientes:resumen", id),
    crear: (data: any) => invoke("clientes:crear", data),
    actualizar: (id: number, data: any) => invoke("clientes:actualizar", id, data),
  },
  productos: {
    listar: () => invoke("productos:listar"),
    crear: (data: any) => invoke("productos:crear", data),
    actualizar: (id: number, data: any) => invoke("productos:actualizar", id, data),
  },
  facturas: {
    listar: () => invoke("facturas:listar"),
    obtener: (id: number) => invoke("facturas:obtener", id),
    crear: (data: any) => invoke("facturas:crear", data),
    anular: (id: number, motivo: string, cajaSesionId?: number | null) => invoke("facturas:anular", id, motivo, cajaSesionId),
    agregarNotaDebito: (data: any) => invoke("facturas:agregarNotaDebito", data),
    agregarNotaCredito: (data: any) => invoke("facturas:agregarNotaCredito", data),
  },
  cobros: {
    listarPorFactura: (facturaId: number) => invoke("cobros:listarPorFactura", facturaId),
    crear: (data: any) => invoke("cobros:crear", data),
  },
  compras: {
    listar: (proveedorId?: number) => invoke("compras:listar", proveedorId),
    obtener: (id: number) => invoke("compras:obtener", id),
    crear: (data: any) => invoke("compras:crear", data),
  },
  proveedores: {
    listar: () => invoke("proveedores:listar"),
    obtener: (id: number) => invoke("proveedores:obtener", id),
    crear: (data: any) => invoke("proveedores:crear", data),
    actualizar: (id: number, data: any) => invoke("proveedores:actualizar", id, data),
    relaciones: () => invoke("proveedores:relaciones"),
    productos: (proveedorId: number) => invoke("proveedores:productos", proveedorId),
    deProducto: (productoId: number) => invoke("proveedores:deProducto", productoId),
    historialPrecios: (filtro: any) => invoke("proveedores:historialPrecios", filtro),
    vincular: (data: any) => invoke("proveedores:vincular", data),
    desvincular: (productoId: number, proveedorId: number) => invoke("proveedores:desvincular", productoId, proveedorId),
  },
  pagosCompra: {
    listarPorCompra: (compraId: number) => invoke("pagosCompra:listarPorCompra", compraId),
    crear: (data: any) => invoke("pagosCompra:crear", data),
  },
  envases: {
    saldos: () => invoke("envases:saldos"),
    movimientos: (clienteId?: number) => invoke("envases:movimientos", clienteId),
    devolucion: (data: any) => invoke("envases:devolucion", data),
  },
  reportes: {
    estadoResultados: (desde?: string, hasta?: string) => invoke("reportes:estadoResultados", desde, hasta),
    balanceGeneral: (hasta?: string) => invoke("reportes:balanceGeneral", hasta),
    itbis: (desde?: string, hasta?: string) => invoke("reportes:itbis", desde, hasta),
    cuentasPorCobrar: () => invoke("reportes:cuentasPorCobrar"),
    dashboard: () => invoke("reportes:dashboard"),
  },
  config: {
    obtener: () => invoke("config:obtener"),
    actualizar: (data: any) => invoke("config:actualizar", data),
  },
  auth: {
    login: (usuario: string, password: string, empresa?: string) => invoke("auth:login", usuario, password, empresa),
    logout: () => invoke("auth:logout"),
  },
  usuarios: {
    listar: () => invoke("usuarios:listar"),
    crear: (data: any) => invoke("usuarios:crear", data),
    actualizar: (id: number, data: any) => invoke("usuarios:actualizar", id, data),
  },
  comprobantes: {
    listar: () => invoke("comprobantes:listar"),
    registrar: (data: any) => invoke("comprobantes:registrar", data),
  },
  ncf: {
    listar: () => invoke("ncf:listar"),
    crear: (data: any) => invoke("ncf:crear", data),
    actualizar: (id: number, data: any) => invoke("ncf:actualizar", id, data),
  },
  app: {
    version: () => invoke("app:version"),
    reiniciar: () => invoke("app:reiniciar"),
  },
  red: {
    obtenerConfig: () => invoke("red:obtenerConfig"),
    guardarConfig: (data: any) => invoke("red:guardarConfig", data),
    probarConexion: (url: string) => invoke("red:probarConexion", url),
  },
  cajas: {
    listar: () => invoke("cajas:listar"),
    crear: (data: any) => invoke("cajas:crear", data),
    actualizar: (id: number, data: any) => invoke("cajas:actualizar", id, data),
  },
  caja: {
    motivos: () => invoke("caja:motivos"),
    sesionActual: (cajaId: number) => invoke("caja:sesionActual", cajaId),
    abrir: (data: any) => invoke("caja:abrir", data),
    resumen: (sesionId: number) => invoke("caja:resumen", sesionId),
    movimiento: (data: any) => invoke("caja:movimiento", data),
    movimientos: (sesionId: number) => invoke("caja:movimientos", sesionId),
    cerrar: (data: any) => invoke("caja:cerrar", data),
    misCierres: (data: any) => invoke("caja:misCierres", data),
    detalle: (sesionId: number, data: any) => invoke("caja:detalle", sesionId, data),
  },
  cierres: {
    listar: (filtros?: any) => invoke("cierres:listar", filtros),
    obtener: (sesionId: number) => invoke("cierres:obtener", sesionId),
    corregir: (data: any) => invoke("cierres:corregir", data),
  },
  impresion: {
    obtenerConfig: () => invoke("impresion:obtenerConfig"),
    guardarConfig: (data: any) => invoke("impresion:guardarConfig", data),
    listar: () => invoke("impresion:listar"),
    imprimirTicket: (html: string) => invoke("impresion:imprimirTicket", html),
    estado: () => invoke("impresion:estado"),
    limpiarCola: () => invoke("impresion:limpiarCola"),
  },
  updater: {
    onEstado: (cb: (estado: any) => void) => {
      const listener = (_e: unknown, data: any) => cb(data);
      ipcRenderer.on("updater:estado", listener);
      return () => ipcRenderer.removeListener("updater:estado", listener);
    },
  },
};

contextBridge.exposeInMainWorld("api", api);

export type DarasistemaApi = typeof api;
