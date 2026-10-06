import { app, BrowserWindow, ipcMain } from "electron";
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
import { leerConfigRed, guardarConfigRed, normalizarServidorUrl, type ConfigRed } from "./network/config";
import { listarIpsLocales } from "./network/localIp";
import { iniciarServidorHttp, type HandlerRegistry } from "./network/server";
import { registrarProxiesRemotos } from "./network/remoteProxy";
import { APP_VARIANT } from "./variant.generated";

const isDev = process.env.NODE_ENV === "development";

app.setName(APP_VARIANT === "caja" ? "Cajapunto1" : "Darasistema");

async function registerAllIpc() {
  const configRed = leerConfigRed();

  if (configRed.modo === "CAJA_REMOTA") {
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

    ipcMain.handle = handleOriginal;
    iniciarServidorHttp(handlerRegistry, configRed.puerto);
  }

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
      const res = await fetch(`${servidorUrl}/health`, { signal: controller.signal });
      clearTimeout(timeout);
      return { ok: res.ok };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? "No se pudo conectar" };
    }
  });
}

function createWindow() {
  const win = new BrowserWindow({
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
}

app.whenReady().then(async () => {
  await registerAllIpc();
  createWindow();

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
