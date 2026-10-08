import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";

// Impresion de facturas en impresoras termicas de recibos (58/80 mm) o en hoja carta.
// La configuracion es de cada computadora (cada una tiene su impresora), por eso
// se guarda aqui y no en la base de datos de la empresa.

export interface ConfigImpresion {
  /** Nombre de la impresora en Windows. Vacio = la predeterminada. */
  impresora: string;
  /** Ancho del papel del recibo. */
  anchoMm: 58 | 80;
  /** TICKET = recibo para impresora termica; CARTA = hoja normal (abre el dialogo de Windows). */
  formato: "TICKET" | "CARTA";
  /** Imprimir el recibo solo al cobrar en Caja / POS. */
  imprimirAlCobrar: boolean;
}

const POR_DEFECTO: ConfigImpresion = { impresora: "", anchoMm: 80, formato: "TICKET", imprimirAlCobrar: false };

function ruta(): string {
  return path.join(app.getPath("userData"), "impresion-config.json");
}

export function leerConfigImpresion(): ConfigImpresion {
  try {
    return { ...POR_DEFECTO, ...JSON.parse(fs.readFileSync(ruta(), "utf-8")) };
  } catch {
    return { ...POR_DEFECTO };
  }
}

// Imprime un HTML en una ventana oculta, directo a la impresora (sin dialogo),
// con el tamano de papel del recibo: ancho fijo y alto segun el contenido.
async function imprimirTicket(html: string): Promise<true> {
  const cfg = leerConfigImpresion();
  const anchoPx = Math.round((cfg.anchoMm / 25.4) * 96);
  const ventana = new BrowserWindow({ show: false, width: anchoPx, height: 600, webPreferences: { sandbox: true, contextIsolation: true } });
  try {
    await ventana.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    const altoPx = (await ventana.webContents.executeJavaScript("document.documentElement.scrollHeight")) as number;
    const altoMicras = Math.max(Math.ceil((altoPx / 96) * 25.4 * 1000) + 8000, 60000);

    const impresoras = await ventana.webContents.getPrintersAsync();
    if (cfg.impresora && !impresoras.some((p) => p.name === cfg.impresora)) {
      throw new Error(`La impresora "${cfg.impresora}" no esta conectada o cambio de nombre. Revisala en Configuracion → Impresora.`);
    }
    if (!cfg.impresora && impresoras.length === 0) throw new Error("No hay ninguna impresora instalada en esta computadora.");

    await new Promise<void>((resolve, reject) => {
      ventana.webContents.print(
        {
          silent: true,
          deviceName: cfg.impresora || undefined,
          printBackground: true,
          margins: { marginType: "none" },
          pageSize: { width: cfg.anchoMm * 1000, height: altoMicras },
        },
        (ok, motivo) => (ok ? resolve() : reject(new Error(`La impresora no acepto el trabajo (${motivo || "sin detalle"}). Revisa que este encendida, con papel y conectada.`)))
      );
    });
    return true;
  } finally {
    if (!ventana.isDestroyed()) ventana.destroy();
  }
}

export function registrarImpresionIpc(): void {
  ipcMain.handle("impresion:obtenerConfig", () => leerConfigImpresion());
  ipcMain.handle("impresion:guardarConfig", (_e, cfg: Partial<ConfigImpresion>) => {
    const nueva = { ...leerConfigImpresion(), ...cfg };
    fs.writeFileSync(ruta(), JSON.stringify(nueva, null, 2), "utf-8");
    return nueva;
  });
  ipcMain.handle("impresion:listar", async (e) => {
    const impresoras = await e.sender.getPrintersAsync();
    return impresoras.map((p) => ({ nombre: p.name, descripcion: p.displayName || p.name, predeterminada: !!p.isDefault }));
  });
  ipcMain.handle("impresion:imprimirTicket", (_e, html: string) => imprimirTicket(html));
}
