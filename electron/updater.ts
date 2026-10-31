import { app, BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";
import { APP_VARIANT, PARA_WIN7 } from "./variant.generated";

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
  // Cada edicion se actualiza por su propio canal (caja.yml, colmado.yml; Darasistema usa latest.yml).
  // La version para Windows 7 tiene su canal aparte, para no recibir nunca una que alli no abre.
  const canal = PARA_WIN7 ? `${APP_VARIANT}-win7` : APP_VARIANT;
  if (canal !== "full") autoUpdater.channel = canal;

  autoUpdater.on("checking-for-update", () => enviarATodasLasVentanas({ estado: "buscando" }));
  autoUpdater.on("update-available", (info) => enviarATodasLasVentanas({ estado: "disponible", version: info.version }));
  autoUpdater.on("update-not-available", () => enviarATodasLasVentanas({ estado: "no-disponible" }));
  autoUpdater.on("download-progress", (progreso) => enviarATodasLasVentanas({ estado: "descargando", porcentaje: Math.round(progreso.percent) }));

  autoUpdater.on("update-downloaded", (info) => {
    enviarATodasLasVentanas({ estado: "descargado", version: info.version });
    // Se le da un momento al usuario para ver el aviso antes de cerrar la app.
    // isSilent=true, isForceRunAfter=true: sin esto, el instalador de NSIS abre
    // su propia ventana pidiendo "Siguiente"/"Instalar" y se queda esperando a
    // que alguien le haga clic -- la actualizacion nunca termina sola.
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 3000);
  });

  autoUpdater.on("error", (err) => {
    enviarATodasLasVentanas({ estado: "error", mensaje: err?.message ?? "Error desconocido al actualizar" });
  });

  autoUpdater.checkForUpdates().catch((err) => {
    enviarATodasLasVentanas({ estado: "error", mensaje: err?.message ?? "No se pudo buscar actualizaciones" });
  });
}
