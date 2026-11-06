import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";
import { getDb } from "./db";
import { registerCuentasIpc } from "./ipc/cuentas";
import { registerAsientosIpc } from "./ipc/asientos";
import { registerClientesIpc } from "./ipc/clientes";
import { registerProductosIpc } from "./ipc/productos";
import { registerFacturasIpc } from "./ipc/facturas";
import { registerCobrosIpc } from "./ipc/cobros";
import { registerEnvasesIpc } from "./ipc/envases";
import { registerReportesIpc } from "./ipc/reportes";
import { registerConfigIpc } from "./ipc/config";
import { registerComprobantesIpc } from "./ipc/comprobantes";
import { registerAuthIpc } from "./ipc/auth";
import { registerComprasIpc } from "./ipc/compras";
import { registerProveedoresIpc } from "./ipc/proveedores";
import { registerCajaIpc } from "./ipc/caja";
import { registerGastosIpc } from "./ipc/gastos";
import { registerBancosIpc } from "./ipc/bancos";
import { registerPlatosIpc } from "./ipc/platos";
import { leerConfigRed, guardarConfigRed, normalizarServidorUrl, type ConfigRed } from "./network/config";
import { listarIpsLocales } from "./network/localIp";
import { iniciarServidorHttp, type HandlerRegistry } from "./network/server";
import { cerrarSesionNube, tokenNubeActual, usarTokenNube, registrarProxiesNube, registrarProxiesRemotos } from "./network/remoteProxy";
import { configurarAutoUpdate, registrarEstadoUpdater } from "./updater";
import { registrarImpresionIpc } from "./impresion";
import { APP_VARIANT } from "./variant.generated";
import { pedirHttp } from "./network/http";
import { borrarSesionRecordada, DIAS_RECORDADA, guardarSesionRecordada, leerSesionRecordada, venceToken } from "./sesionRecordada";

const isDev = process.env.NODE_ENV === "development";

const NOMBRES = { full: "Darasistema", caja: "Cajapunto1", colmado: "Darasistema Colmado", cajacolmado: "Cajapunto1 Colmado", puntoventa: "Gas Damian", puntoventaadmin: "Gas Damian Admin", fritura: "Dara Frituras", frituraadmin: "Dara Frituras Admin" } as const;
app.setName(NOMBRES[APP_VARIANT]);

async function registerAllIpc() {
  const configRed = leerConfigRed();

  if (configRed.modo === "NUBE") {
    // Los datos viven en la nube (una base privada por empresa): esta
    // computadora no abre ninguna base local ni levanta el servidor de red.
    registrarProxiesNube(configRed.nubeUrl!);
  } else if (configRed.modo === "CAJA_REMOTA") {
    // Si todavia no hay direccion de servidor configurada (primer arranque del
    // instalador "Caja"), no se registra ningun canal de negocio: el renderer
    // debe mostrar la pantalla de configuracion de conexion antes que nada.
    if (configRed.servidorUrl) {
      registrarProxiesRemotos(configRed.servidorUrl);
    }
  } else {
    const handlerRegistry: HandlerRegistry = {};
    const handleOriginal = ipcMain.handle.bind(ipcMain);
    (ipcMain as any).handle = (canal: string, listener: any) => {
      handlerRegistry[canal] = listener;
      return handleOriginal(canal, listener);
    };

    const db = await getDb();
    registerCuentasIpc(db);
    registerAsientosIpc(db);
    registerClientesIpc(db);
    registerProductosIpc(db);
    registerFacturasIpc(db);
    registerCobrosIpc(db);
    registerEnvasesIpc(db);
    registerReportesIpc(db);
    registerConfigIpc(db);
    registerComprobantesIpc(db);
    registerAuthIpc(db);
    registerComprasIpc(db);
    registerProveedoresIpc(db);
    registerCajaIpc(db);
    registerGastosIpc(db);
    registerBancosIpc(db);
    registerPlatosIpc(db);

    ipcMain.handle = handleOriginal;
    iniciarServidorHttp(handlerRegistry, configRed.puerto);
  }

  ipcMain.handle("auth:logout", () => {
    cerrarSesionNube();
    borrarSesionRecordada();
  });
  // Caja de Gas Damian: recordar la sesion 30 dias para que el programa entre solo.
  ipcMain.handle("auth:recordar", (_e, sesion: unknown) => {
    if (configRed.modo === "NUBE") {
      const token = tokenNubeActual();
      if (token) guardarSesionRecordada({ sesion, token, vence: venceToken(token) });
    } else {
      guardarSesionRecordada({ sesion, vence: Date.now() + DIAS_RECORDADA * 24 * 60 * 60 * 1000 });
    }
  });
  ipcMain.handle("auth:sesionRecordada", () => {
    const datos = leerSesionRecordada();
    if (!datos) return null;
    if (configRed.modo === "NUBE") {
      if (!datos.token) return null;
      usarTokenNube(datos.token);
    }
    return datos.sesion;
  });
  registrarImpresionIpc();
  ipcMain.handle("red:obtenerConfig", () => ({ ...leerConfigRed(), ips: listarIpsLocales() }));
  ipcMain.handle("red:guardarConfig", (_e, nuevaConfig: ConfigRed) => {
    guardarConfigRed(nuevaConfig);
    return true;
  });
  ipcMain.handle("red:probarConexion", async (_e, servidorUrlCruda: string) => {
    const servidorUrl = normalizarServidorUrl(servidorUrlCruda);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await pedirHttp(`${servidorUrl}/health`, { signal: controller.signal });
      clearTimeout(timeout);
      return { ok: res.ok };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? "No se pudo conectar" };
    }
  });
}

// Pantalla de carga con el logo (Gas Damian y Dara Frituras) mientras arranca el programa.
const ES_FRITURA = APP_VARIANT === "fritura" || APP_VARIANT === "frituraadmin";
const CON_PANTALLA_DE_CARGA = APP_VARIANT === "puntoventa" || APP_VARIANT === "puntoventaadmin" || ES_FRITURA;

function mostrarPantallaDeCarga(): BrowserWindow {
  const splash = new BrowserWindow({
    width: 460,
    height: 370,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    center: true,
    webPreferences: { sandbox: true },
  });
  const query: Record<string, string> = { nombre: NOMBRES[APP_VARIANT], version: app.getVersion() };
  if (ES_FRITURA) Object.assign(query, { lema: "Frituras · Platos · Bebidas", logo: "dara-frituras.png" });
  if (isDev) splash.loadURL(`http://localhost:5173/splash.html?${new URLSearchParams(query)}`);
  else splash.loadFile(path.join(__dirname, "../dist/splash.html"), { query });
  return splash;
}

function createWindow(splash?: BrowserWindow | null) {
  const desde = Date.now();
  const win = new BrowserWindow({
    show: !splash,
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: "#f4f6fb",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDev) {
    win.loadURL("http://localhost:5173");
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  if (splash) {
    let listo = false;
    const cambiar = () => {
      if (listo) return;
      listo = true;
      win.show();
      if (!splash.isDestroyed()) splash.destroy();
    };
    // el logo se ve al menos 2 segundos; si algo tarda demasiado, se abre igual
    win.once("ready-to-show", () => setTimeout(cambiar, Math.max(0, 2000 - (Date.now() - desde))));
    setTimeout(cambiar, 15000);
  }
}

app.whenReady().then(async () => {
  const splash = CON_PANTALLA_DE_CARGA ? mostrarPantallaDeCarga() : null;
  try {
    await registerAllIpc();
  } catch (err: any) {
    console.error("Error al arrancar:", err);
    dialog.showErrorBox("El programa no arranco bien", `Cierralo y vuelve a abrirlo. Si sigue pasando, avisa a soporte.\n\nDetalle: ${err?.message ?? err}`);
  }
  registrarEstadoUpdater();
  createWindow(splash);
  configurarAutoUpdate();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("app:version", () => app.getVersion());
ipcMain.handle("app:reiniciar", () => {
  app.relaunch();
  app.exit();
});
