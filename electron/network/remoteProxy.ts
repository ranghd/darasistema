import { borrarSesionRecordada } from "../sesionRecordada";
import { pedirHttp, type RespuestaHttp } from "./http";
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
import { registerProveedoresIpc } from "../ipc/proveedores";
import { registerCajaIpc } from "../ipc/caja";
import { registerGastosIpc } from "../ipc/gastos";
import { registerBancosIpc } from "../ipc/bancos";
import { registerPlatosIpc } from "../ipc/platos";
import { registerPiezasIpc } from "../ipc/piezas";

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
  const registros = [
    registerCuentasIpc,
    registerAsientosIpc,
    registerClientesIpc,
    registerProductosIpc,
    registerFacturasIpc,
    registerCobrosIpc,
    registerEnvasesIpc,
    registerReportesIpc,
    registerConfigIpc,
    registerComprobantesIpc,
    registerAuthIpc,
    registerComprasIpc,
    registerProveedoresIpc,
    registerCajaIpc,
    registerGastosIpc,
    registerBancosIpc,
    registerPlatosIpc,
    registerPiezasIpc,
  ];
  try {
    for (const registrar of registros) {
      try {
        registrar(dbFalsa);
      } catch (err) {
        // un registro que use la base al registrarse no debe tumbar el arranque (sus canales anteriores ya se anotaron)
        console.error("No se pudieron listar todos los canales:", err);
      }
    }
  } finally {
    ipcMain.handle = handleOriginal;
  }
  return canales;
}

// Sesion con el servidor en la nube. Vive solo en el proceso principal (nunca
// se expone a la pantalla) y se pierde al cerrar la app.
let tokenNube: string | null = null;

export function cerrarSesionNube(): void {
  tokenNube = null;
}

// Para recordar la sesion de la caja (electron/sesionRecordada.ts).
export const tokenNubeActual = () => tokenNube;
export function usarTokenNube(token: string): void {
  tokenNube = token;
}

function describirFalloDeRed(err: any, servidorUrl: string, nube: boolean): Error {
  if (err.name === "AbortError") {
    return new Error(
      nube
        ? "El servidor en la nube tardo demasiado en responder. Revisa tu conexion a internet e intenta de nuevo."
        : `No se pudo conectar al servidor (${servidorUrl}): tardo demasiado en responder. Verifica que esa computadora este encendida y en la misma red.`
    );
  }

  const codigo: string | undefined = err?.cause?.code;
  if (nube) {
    if (codigo === "ENOTFOUND" || codigo === "EAI_AGAIN") return new Error("Sin internet: no se pudo llegar al servidor en la nube. Revisa la conexion de esta computadora.");
    return new Error(`No se pudo conectar al servidor en la nube: ${err?.cause?.message ?? err?.message ?? "error de red"}. Revisa tu conexion a internet.`);
  }

  let motivo = "no se pudo establecer la conexion";
  if (codigo === "ECONNREFUSED") motivo = "la computadora respondio pero rechazo la conexion (revisa que el puerto sea el correcto y que ahi este corriendo Darasistema en modo Servidor)";
  else if (codigo === "ENOTFOUND" || codigo === "EAI_AGAIN") motivo = "no se encontro esa direccion (revisa que la IP este bien escrita)";
  else if (codigo === "ETIMEDOUT" || codigo === "ECONNRESET") motivo = "no respondio a tiempo (revisa que ambas computadoras esten en la misma red y que el Firewall de Windows no este bloqueando la app)";
  else if (err?.cause?.message) motivo = err.cause.message;
  return new Error(`No se pudo conectar al servidor (${servidorUrl}): ${motivo}.`);
}

async function postJson(servidorUrlCruda: string, ruta: string, cuerpo: unknown, opciones: { token?: string | null; nube: boolean }) {
  const servidorUrl = normalizarServidorUrl(servidorUrlCruda);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opciones.nube ? 20000 : 8000);
  let res: RespuestaHttp;
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (opciones.token) headers.Authorization = `Bearer ${opciones.token}`;
    res = await pedirHttp(`${servidorUrl}${ruta}`, { method: "POST", headers, body: JSON.stringify(cuerpo), signal: controller.signal });
  } catch (err: any) {
    throw describirFalloDeRed(err, servidorUrl, opciones.nube);
  } finally {
    clearTimeout(timeout);
  }

  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (opciones.nube && res.status === 401 && ruta === "/api/invoke") {
      tokenNube = null;
      borrarSesionRecordada();
      throw new Error("Sesion expirada. Vuelve a iniciar sesion.");
    }
    throw new Error(json.error ?? `Error del servidor (${res.status})`);
  }
  return json.resultado;
}

export function registrarProxiesRemotos(servidorUrl: string): void {
  const canales = listarCanalesDeNegocio();
  for (const canal of canales) {
    ipcMain.handle(canal, (_e, ...args) => postJson(servidorUrl, "/api/invoke", { canal, args }, { nube: false }));
  }
}

export function registrarProxiesNube(nubeUrl: string): void {
  const canales = listarCanalesDeNegocio().filter((c) => c !== "auth:login");
  for (const canal of canales) {
    ipcMain.handle(canal, (_e, ...args) => {
      if (!tokenNube) throw new Error("Sesion expirada. Vuelve a iniciar sesion.");
      return postJson(nubeUrl, "/api/invoke", { canal, args }, { token: tokenNube, nube: true });
    });
  }

  ipcMain.handle("auth:login", async (_e, usuario: string, password: string, empresa?: string, recordar?: boolean) => {
    if (!empresa?.trim()) throw new Error("Escribe el codigo de empresa");
    const r = await postJson(nubeUrl, "/api/login", { empresa: empresa.trim().toLowerCase(), usuario, password, recordar: recordar === true }, { nube: true });
    tokenNube = r.token;
    return r.sesion;
  });
}
