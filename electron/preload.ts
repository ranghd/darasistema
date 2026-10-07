import { contextBridge, ipcRenderer } from "electron";

const invoke = (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args);

const api = {
  cuentas: {
    listar: () => invoke("cuentas:listar"),
    crear: (data: any) => invoke("cuentas:crear", data),
    actualizar: (id: number, data: any) => invoke("cuentas:actualizar", id, data),
  },
  asientos: {
    listar: (desde?: string, hasta?: string) => invoke("asientos:listar", desde, hasta),
    crear: (data: any) => invoke("asientos:crear", data),
    libroMayor: (cuentaId: number, desde?: string, hasta?: string) => invoke("asientos:libroMayor", cuentaId, desde, hasta),
    balanceComprobacion: (desde?: string, hasta?: string) => invoke("asientos:balanceComprobacion", desde, hasta),
  },
  clientes: {
    listar: () => invoke("clientes:listar"),
    obtener: (id: number) => invoke("clientes:obtener", id),
    estadoCuenta: (id: number) => invoke("clientes:estadoCuenta", id),
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
    anular: (id: number, motivo: string) => invoke("facturas:anular", id, motivo),
    agregarNotaDebito: (data: any) => invoke("facturas:agregarNotaDebito", data),
    agregarNotaCredito: (data: any) => invoke("facturas:agregarNotaCredito", data),
  },
  cobros: {
    listarPorFactura: (facturaId: number) => invoke("cobros:listarPorFactura", facturaId),
    crear: (data: any) => invoke("cobros:crear", data),
  },
  compras: {
    listar: () => invoke("compras:listar"),
    obtener: (id: number) => invoke("compras:obtener", id),
    crear: (data: any) => invoke("compras:crear", data),
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
    login: (usuario: string, password: string) => invoke("auth:login", usuario, password),
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
