import http from "node:http";
import https from "node:https";

// fetch para el proceso principal. La version para Windows 7 usa Electron 22, que trae
// Node 16 sin fetch: alli se hace la peticion con node:http/https, con los mismos
// errores que fetch (AbortError al vencer el tiempo y err.cause con el codigo de red).
export interface RespuestaHttp {
  ok: boolean;
  status: number;
  json(): Promise<any>;
}

interface OpcionesHttp {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export function pedirHttp(url: string, opciones: OpcionesHttp = {}): Promise<RespuestaHttp> {
  if (typeof globalThis.fetch === "function") return globalThis.fetch(url, opciones);

  return new Promise((resolve, reject) => {
    const modulo = url.startsWith("https:") ? https : http;
    const req = modulo.request(url, { method: opciones.method ?? "GET", headers: opciones.headers }, (res) => {
      const partes: Buffer[] = [];
      res.on("data", (p: Buffer) => partes.push(p));
      res.on("end", () => {
        const texto = Buffer.concat(partes).toString("utf-8");
        const status = res.statusCode ?? 0;
        resolve({ ok: status >= 200 && status < 300, status, json: async () => JSON.parse(texto) });
      });
      res.on("error", reject);
    });
    const abortar = () => {
      const err = new Error("La peticion se cancelo");
      err.name = "AbortError";
      req.destroy(err);
      reject(err);
    };
    if (opciones.signal?.aborted) return abortar();
    opciones.signal?.addEventListener("abort", abortar, { once: true });
    req.on("error", (causa: NodeJS.ErrnoException) => {
      if (causa.name === "AbortError") return;
      reject(Object.assign(new TypeError("fetch failed"), { cause: causa }));
    });
    if (opciones.body) req.write(opciones.body);
    req.end();
  });
}
