import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { APP_VARIANT } from "../variant.generated";

export type ModoRed = "SERVIDOR" | "CAJA_REMOTA" | "NUBE";

export interface ConfigRed {
  modo: ModoRed;
  puerto: number;
  servidorUrl?: string;
  nubeUrl?: string;
}

// Servidor en la nube (Cloudflare) donde vive la base de datos de cada empresa.
export const NUBE_URL_POR_DEFECTO = "https://darasistema.ranghd732.workers.dev";

// Instalaciones nuevas usan la nube. Si esta computadora ya tiene una base de
// datos local (version anterior a la nube), sigue en modo Servidor: asi una
// actualizacion automatica nunca "pierde" de vista los datos de quien ya la usa.
function configPorDefecto(): ConfigRed {
  const base = { puerto: 4500, nubeUrl: NUBE_URL_POR_DEFECTO };
  if (APP_VARIANT !== "caja" && fs.existsSync(path.join(app.getPath("userData"), "darasistema.db"))) {
    return { ...base, modo: "SERVIDOR" };
  }
  return { ...base, modo: "NUBE" };
}

function rutaConfig(): string {
  return path.join(app.getPath("userData"), "network-config.json");
}

// Limpia errores comunes al escribir la direccion del servidor, como pegar
// "http://" duplicado (ej. "http://http://192.168.1.45:4500") o dejar una
// barra al final. Nunca falla: si no hay protocolo, asume http://.
export function normalizarServidorUrl(url: string): string {
  let limpio = url.trim();
  let protocolo = "http://";
  const match = limpio.match(/^(https?:\/\/)+/i);
  if (match) {
    protocolo = /^https/i.test(match[0]) ? "https://" : "http://";
    limpio = limpio.slice(match[0].length);
  }
  limpio = limpio.replace(/\/+$/, "");
  return protocolo + limpio;
}

export function leerConfigRed(): ConfigRed {
  try {
    const raw = fs.readFileSync(rutaConfig(), "utf-8");
    const config = { ...configPorDefecto(), ...JSON.parse(raw) };
    if (config.servidorUrl) config.servidorUrl = normalizarServidorUrl(config.servidorUrl);
    config.nubeUrl = normalizarServidorUrl(config.nubeUrl || NUBE_URL_POR_DEFECTO);
    return config;
  } catch {
    return configPorDefecto();
  }
}

export function guardarConfigRed(config: ConfigRed): void {
  const limpio = {
    ...config,
    servidorUrl: config.servidorUrl ? normalizarServidorUrl(config.servidorUrl) : config.servidorUrl,
    nubeUrl: config.nubeUrl ? normalizarServidorUrl(config.nubeUrl) : undefined,
  };
  fs.writeFileSync(rutaConfig(), JSON.stringify(limpio, null, 2), "utf-8");
}
