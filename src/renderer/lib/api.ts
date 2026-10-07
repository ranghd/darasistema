import { mockApi } from "./mockApi";
import { limpiarErrorConexion, reportarErrorConexion } from "./connectionStatus";

declare global {
  interface Window {
    api?: typeof mockApi;
  }
}

export const EVENTO_SESION_EXPIRADA = "darasistema:sesion-expirada";

// Electron antepone "Error invoking remote method 'canal': Error: " a los
// errores que vienen del proceso principal; para el usuario solo importa el final.
export function mensajeDeError(err: any, porDefecto = "No se pudo completar la operacion"): string {
  const crudo: string = err?.message ?? porDefecto;
  return crudo.replace(/^Error invoking remote method '[^']*':\s*/, "").replace(/^Error:\s*/, "");
}

export const isPreviewMode = typeof window !== "undefined" && !window.api;

const apiBase: typeof mockApi = typeof window !== "undefined" && window.api ? (window.api as typeof mockApi) : mockApi;

// Envuelve cada metodo de la API para que, si falla (ej. la Caja Remota no
// pudo conectarse al Servidor por la red), el error se muestre visiblemente
// en toda la app en vez de quedar como una lista vacia sin explicacion.
function envolverConEstadoDeConexion<T extends object>(obj: T): T {
  const resultado: any = {};
  for (const key of Object.keys(obj)) {
    const value = (obj as any)[key];
    if (key === "auth" || key === "updater") {
      // auth: un fallo de login se muestra en la pantalla de Login, no como
      // error de red. updater: onEstado es sincronico y devuelve una funcion
      // de limpieza (no una promesa) -- envolverla la rompe.
      resultado[key] = value;
      continue;
    }
    if (typeof value === "function") {
      resultado[key] = (...args: any[]) => {
        return Promise.resolve(value(...args)).then(
          (r) => {
            limpiarErrorConexion();
            return r;
          },
          (err) => {
            const mensaje = mensajeDeError(err);
            if (mensaje.startsWith("Sesion expirada")) {
              window.dispatchEvent(new Event(EVENTO_SESION_EXPIRADA));
            } else {
              reportarErrorConexion(mensaje);
            }
            throw new Error(mensaje);
          }
        );
      };
    } else if (value && typeof value === "object") {
      resultado[key] = envolverConEstadoDeConexion(value);
    } else {
      resultado[key] = value;
    }
  }
  return resultado;
}

export const api: typeof mockApi = envolverConEstadoDeConexion(apiBase);
