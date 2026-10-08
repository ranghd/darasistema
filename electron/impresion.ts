import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
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

export interface EstadoImpresora {
  /** false si no se pudo consultar (por ejemplo, fuera de Windows). */
  verificado: boolean;
  existe: boolean;
  nombre: string;
  desconectada: boolean;
  /** Problema que reporta la impresora (sin papel, tapa abierta...), o null. */
  problema: string | null;
  trabajosPendientes: number;
}

export interface ResultadoImpresion {
  impresora: string;
  /** true: Windows termino de entregarle el trabajo a la impresora. */
  entregado: boolean;
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

// ---------- consultas a Windows (cola de impresion) ----------

// El nombre de la impresora va por variable de entorno, nunca dentro del script.
function powershell(script: string, env: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { env: { ...process.env, ...env }, windowsHide: true, timeout: 15000 },
      (err, stdout) => (err ? reject(err) : resolve(String(stdout).trim()))
    );
  });
}

// Codigos de Win32_Printer.DetectedErrorState que significan que no va a imprimir.
const PROBLEMAS: Record<number, string> = {
  4: "no tiene papel",
  7: "tiene la tapa abierta",
  8: "tiene el papel atascado",
  9: "esta fuera de linea",
  10: "necesita servicio tecnico",
};

// Se usa WMI (Win32_Printer / Win32_PrintJob) porque es mucho mas rapido que Get-Printer / Get-PrintJob.
const SCRIPT_ESTADO = `
$n = $env:DS_IMPRESORA
$p = Get-CimInstance Win32_Printer -Property Name,Default,WorkOffline,DetectedErrorState | Where-Object { if ($n) { $_.Name -eq $n } else { $_.Default } } | Select-Object -First 1
if (-not $p) { '{"existe":false}' } else {
  $t = @(Get-CimInstance Win32_PrintJob -Property Name | Where-Object { $_.Name -like ($p.Name + ',*') }).Count
  '{"existe":true,"nombre":' + (ConvertTo-Json ([string]$p.Name)) + ',"desconectada":' + ([string][bool]$p.WorkOffline).ToLower() + ',"error":' + [int]$p.DetectedErrorState + ',"trabajos":' + $t + '}'
}`;

export async function estadoImpresora(nombre: string): Promise<EstadoImpresora> {
  if (process.platform !== "win32") return { verificado: false, existe: true, nombre, desconectada: false, problema: null, trabajosPendientes: 0 };
  try {
    const r = JSON.parse(await powershell(SCRIPT_ESTADO, { DS_IMPRESORA: nombre }));
    if (!r.existe) return { verificado: true, existe: false, nombre, desconectada: true, problema: null, trabajosPendientes: 0 };
    return { verificado: true, existe: true, nombre: r.nombre, desconectada: r.desconectada, problema: PROBLEMAS[r.error] ?? null, trabajosPendientes: r.trabajos };
  } catch {
    return { verificado: false, existe: true, nombre, desconectada: false, problema: null, trabajosPendientes: 0 };
  }
}

// Estado del trabajo en la cola de Windows: "" si ya no esta (se entrego).
function estadoTrabajo(impresora: string, documento: string): Promise<string> {
  return powershell(
    `$j = Get-CimInstance Win32_PrintJob -Property Name,Document,JobStatus,Status | Where-Object { $_.Name -like ($env:DS_IMPRESORA + ',*') -and $_.Document -eq $env:DS_DOC } | Select-Object -First 1
     if ($j) { [string]$j.JobStatus + " " + [string]$j.Status + "|" } else { "" }`,
    { DS_IMPRESORA: impresora, DS_DOC: documento }
  );
}

function cancelarTrabajo(impresora: string, documento: string): Promise<string> {
  return powershell(
    `Get-PrintJob -PrinterName $env:DS_IMPRESORA -ErrorAction SilentlyContinue | Where-Object { $_.DocumentName -eq $env:DS_DOC } | Remove-PrintJob -ErrorAction SilentlyContinue`,
    { DS_IMPRESORA: impresora, DS_DOC: documento }
  ).catch(() => "");
}

function limpiarCola(impresora: string): Promise<string> {
  return powershell(`Get-PrintJob -PrinterName $env:DS_IMPRESORA -ErrorAction SilentlyContinue | Remove-PrintJob -ErrorAction SilentlyContinue`, {
    DS_IMPRESORA: impresora,
  });
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

function errorDeEstado(e: EstadoImpresora): string | null {
  if (!e.verificado) return null;
  if (!e.existe) return `La impresora "${e.nombre || "predeterminada"}" no esta instalada en esta computadora. Eligela en Configuracion → Impresora de facturas.`;
  if (e.desconectada) return `La impresora "${e.nombre}" esta desconectada: Windows no la detecta. Revisa que este encendida y que el cable USB este conectado.`;
  if (e.problema) return `La impresora "${e.nombre}" ${e.problema}.`;
  return null;
}

// ---------- impresion ----------

// Imprime un HTML en una ventana oculta, directo a la impresora (sin dialogo), con el
// tamano de papel del recibo. Revisa la impresora antes y sigue el trabajo en la cola
// de Windows despues, para no decir "impreso" si en realidad se quedo atascado.
async function imprimirTicket(html: string): Promise<ResultadoImpresion> {
  const cfg = leerConfigImpresion();

  const antes = await estadoImpresora(cfg.impresora);
  const problemaAntes = errorDeEstado(antes);
  if (problemaAntes) throw new Error(problemaAntes);
  const impresora = antes.nombre || cfg.impresora;

  const documento = `Darasistema recibo ${Date.now()}`;
  const anchoPx = Math.round((cfg.anchoMm / 25.4) * 96);
  const ventana = new BrowserWindow({ show: false, width: anchoPx, height: 600, webPreferences: { sandbox: true, contextIsolation: true } });
  try {
    await ventana.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    const altoPx = (await ventana.webContents.executeJavaScript(`document.title = ${JSON.stringify(documento)}; document.documentElement.scrollHeight`)) as number;
    const altoMicras = Math.max(Math.ceil((altoPx / 96) * 25.4 * 1000) + 8000, 60000);

    await new Promise<void>((resolve, reject) => {
      ventana.webContents.print(
        {
          silent: true,
          deviceName: impresora || undefined,
          printBackground: true,
          margins: { marginType: "none" },
          pageSize: { width: cfg.anchoMm * 1000, height: altoMicras },
        },
        (ok, motivo) => (ok ? resolve() : reject(new Error(`Windows no acepto el recibo (${motivo || "sin detalle"}).`)))
      );
    });
  } finally {
    if (!ventana.isDestroyed()) ventana.destroy();
  }

  if (!antes.verificado || process.platform !== "win32") return { impresora, entregado: false };

  // Seguir el trabajo hasta que salga de la cola (entregado) o se trabe.
  for (let i = 0; i < 20; i++) {
    await esperar(600);
    const estado = await estadoTrabajo(impresora, documento).catch(() => "");
    if (!estado) return { impresora, entregado: true };
    if (/error|offline|blocked|paper ?out|user ?intervention|paused|degraded/i.test(estado)) {
      await cancelarTrabajo(impresora, documento);
      const ahora = await estadoImpresora(impresora);
      throw new Error((errorDeEstado(ahora) ?? `La impresora "${impresora}" dio un error y no imprimio.`) + " Se cancelo el recibo para que no salga despues.");
    }
  }
  await cancelarTrabajo(impresora, documento);
  throw new Error(`La impresora "${impresora}" no recibio el recibo: se quedo esperando en la cola de Windows. Revisa que este encendida y conectada. Se cancelo para que no salga despues.`);
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
  ipcMain.handle("impresion:estado", async () => {
    const e = await estadoImpresora(leerConfigImpresion().impresora);
    return { ...e, mensaje: errorDeEstado(e) };
  });
  ipcMain.handle("impresion:limpiarCola", async () => {
    const e = await estadoImpresora(leerConfigImpresion().impresora);
    if (e.existe && e.nombre) await limpiarCola(e.nombre);
    return true;
  });
  ipcMain.handle("impresion:imprimirTicket", (_e, html: string) => imprimirTicket(html));
}
