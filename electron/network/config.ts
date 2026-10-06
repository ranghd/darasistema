import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { APP_VARIANT } from "../variant.generated";

export type ModoRed = "SERVIDOR" | "CAJA_REMOTA";

export interface ConfigRed {
  modo: ModoRed;
  puerto: number;
  servidorUrl?: string;
}

function configPorDefecto(): ConfigRed {
  if (APP_VARIANT === "caja") {
    return { modo: "CAJA_REMOTA", puerto: 4500 };
  }
  return { modo: "SERVIDOR", puerto: 4500 };
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
    return config;
  } catch {
    return configPorDefecto();
  }
}

export function guardarConfigRed(config: ConfigRed): void {
  const limpio = { ...config, servidorUrl: config.servidorUrl ? normalizarServidorUrl(config.servidorUrl) : config.servidorUrl };
  fs.writeFileSync(rutaConfig(), JSON.stringify(limpio, null, 2), "utf-8");
}
