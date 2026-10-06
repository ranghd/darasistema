import { app, BrowserWindow, dialog } from "electron";
import { autoUpdater } from "electron-updater";
import { APP_VARIANT } from "./variant.generated";

export function configurarAutoUpdate() {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  // Cada variante publica en un canal distinto dentro del mismo repositorio
  // para que el update de Darasistema y el de Cajapunto1 no se mezclen.
  if (APP_VARIANT === "caja") autoUpdater.channel = "caja";

  autoUpdater.on("update-downloaded", (info) => {
    const ventana = BrowserWindow.getAllWindows()[0];
    const respuesta = dialog.showMessageBoxSync(ventana, {
      type: "info",
      title: "Actualizacion lista",
      message: `Se descargo la version ${info.version}. ¿Quieres instalar ahora?`,
      detail: "La aplicacion se cerrara y reabrira con la nueva version.",
      buttons: ["Reiniciar e instalar", "Mas tarde"],
      defaultId: 0,
      cancelId: 1,
    });
    if (respuesta === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  autoUpdater.on("error", (err) => {
    // Un fallo de actualizacion no debe impedir usar la app normalmente.
    // eslint-disable-next-line no-console
    console.error("[auto-update]", err?.message);
  });

  autoUpdater.checkForUpdates().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[auto-update] checkForUpdates", err?.message);
  });
}
