import { mockApi } from "./mockApi";
import { limpiarErrorConexion, reportarErrorConexion } from "./connectionStatus";

declare global {
  interface Window {
    api?: typeof mockApi;
  }
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
    if (key === "auth") {
      // El login no debe disparar el banner de "error de conexion": un fallo
      // de credenciales se muestra en la pantalla de Login, no como error de red.
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
            reportarErrorConexion(err?.message ?? "No se pudo completar la operacion");
            throw err;
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
