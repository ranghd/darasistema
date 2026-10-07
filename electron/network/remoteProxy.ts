import { ipcMain } from "electron";
import { normalizarServidorUrl } from "./config";
import { registerCuentasIpc } from "../ipc/cuentas";
import { registerAsientosIpc } from "../ipc/asientos";
import { registerClientesIpc } from "../ipc/clientes";
import { registerProductosIpc } from "../ipc/productos";
import { registerFacturasIpc } from "../ipc/facturas";
import { registerCobrosIpc } from "../ipc/cobros";
import { registerEnvasesIpc } from "../ipc/envases";
import { registerReportesIpc } from "../ipc/reportes";
import { registerConfigIpc } from "../ipc/config";
import { registerComprobantesIpc } from "../ipc/comprobantes";
import { registerAuthIpc } from "../ipc/auth";
import { registerComprasIpc } from "../ipc/compras";

// Cosecha los nombres de canal IPC que expone el negocio (facturas, clientes, etc.)
// sin necesidad de abrir una base de datos real: se usa un objeto "falso" porque
// registrar un handler (ipcMain.handle) nunca ejecuta su cuerpo, solo lo guarda.
function listarCanalesDeNegocio(): string[] {
  const canales: string[] = [];
  const handleOriginal = ipcMain.handle.bind(ipcMain);
  (ipcMain as any).handle = (canal: string) => {
    canales.push(canal);
  };

  const dbFalsa = {} as any;
  registerCuentasIpc(dbFalsa);
  registerAsientosIpc(dbFalsa);
  registerClientesIpc(dbFalsa);
  registerProductosIpc(dbFalsa);
  registerFacturasIpc(dbFalsa);
  registerCobrosIpc(dbFalsa);
  registerEnvasesIpc(dbFalsa);
  registerReportesIpc(dbFalsa);
  registerConfigIpc(dbFalsa);
  registerComprobantesIpc(dbFalsa);
  registerAuthIpc(dbFalsa);
  registerComprasIpc(dbFalsa);

  ipcMain.handle = handleOriginal;
  return canales;
}

async function invocarRemoto(servidorUrlCruda: string, canal: string, args: unknown[]) {
  const servidorUrl = normalizarServidorUrl(servidorUrlCruda);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${servidorUrl}/api/invoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ canal, args }),
      signal: controller.signal,
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Error al conectar con el servidor");
    return json.resultado;
  } catch (err: any) {
    if (err.name === "AbortError") {
      throw new Error(`No se pudo conectar al servidor (${servidorUrl}): tardo demasiado en responder. Verifica que esa computadora este encendida y en la misma red.`);
    }

    const codigo: string | undefined = err?.cause?.code;
    let motivo = "no se pudo establecer la conexion";
    if (codigo === "ECONNREFUSED") motivo = "la computadora respondio pero rechazo la conexion (revisa que el puerto sea el correcto y que ahi este corriendo Darasistema en modo Servidor)";
    else if (codigo === "ENOTFOUND" || codigo === "EAI_AGAIN") motivo = "no se encontro esa direccion (revisa que la IP este bien escrita)";
    else if (codigo === "ETIMEDOUT" || codigo === "ECONNRESET") motivo = "no respondio a tiempo (revisa que ambas computadoras esten en la misma red y que el Firewall de Windows no este bloqueando la app)";
    else if (err?.cause?.message) motivo = err.cause.message;

    throw new Error(`No se pudo conectar al servidor (${servidorUrl}): ${motivo}.`);
  } finally {
    clearTimeout(timeout);
  }
}

export function registrarProxiesRemotos(servidorUrl: string): void {
  const canales = listarCanalesDeNegocio();
  for (const canal of canales) {
    ipcMain.handle(canal, (_e, ...args) => invocarRemoto(servidorUrl, canal, args));
  }
}
