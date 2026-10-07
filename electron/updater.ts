import { app, BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";
import { APP_VARIANT } from "./variant.generated";

export type EstadoUpdater =
  | { estado: "buscando" }
  | { estado: "disponible"; version: string }
  | { estado: "no-disponible" }
  | { estado: "descargando"; porcentaje: number }
  | { estado: "descargado"; version: string }
  | { estado: "error"; mensaje: string };

function enviarATodasLasVentanas(payload: EstadoUpdater) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("updater:estado", payload);
  }
}

export function configurarAutoUpdate() {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  // Cada variante publica en un canal distinto dentro del mismo repositorio
  // para que el update de Darasistema y el de Cajapunto1 no se mezclen.
  if (APP_VARIANT === "caja") autoUpdater.channel = "caja";

  autoUpdater.on("checking-for-update", () => enviarATodasLasVentanas({ estado: "buscando" }));
  autoUpdater.on("update-available", (info) => enviarATodasLasVentanas({ estado: "disponible", version: info.version }));
  autoUpdater.on("update-not-available", () => enviarATodasLasVentanas({ estado: "no-disponible" }));
  autoUpdater.on("download-progress", (progreso) => enviarATodasLasVentanas({ estado: "descargando", porcentaje: Math.round(progreso.percent) }));

  autoUpdater.on("update-downloaded", (info) => {
    enviarATodasLasVentanas({ estado: "descargado", version: info.version });
    // Se le da un momento al usuario para ver el aviso antes de cerrar la app.
    setTimeout(() => autoUpdater.quitAndInstall(), 3000);
  });

  autoUpdater.on("error", (err) => {
    enviarATodasLasVentanas({ estado: "error", mensaje: err?.message ?? "Error desconocido al actualizar" });
  });

  autoUpdater.checkForUpdates().catch((err) => {
    enviarATodasLasVentanas({ estado: "error", mensaje: err?.message ?? "No se pudo buscar actualizaciones" });
  });
}
