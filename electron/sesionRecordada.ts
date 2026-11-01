import fs from "node:fs";
import path from "node:path";
import { app, safeStorage } from "electron";

// Caja de Gas Damian: la sesion se recuerda 30 dias para que el programa entre solo.
// Se guarda cifrada con la proteccion de Windows (safeStorage); si no se puede cifrar, no se recuerda.
export interface SesionRecordada {
  sesion: unknown;
  /** Token de la nube (dura lo mismo); en modo local no hay. */
  token?: string | null;
  /** Hasta cuando vale (milisegundos). */
  vence: number;
}

export const DIAS_RECORDADA = 30;

const archivo = () => path.join(app.getPath("userData"), "sesion-caja.dat");

export function guardarSesionRecordada(datos: SesionRecordada): void {
  if (!safeStorage.isEncryptionAvailable()) return;
  fs.writeFileSync(archivo(), safeStorage.encryptString(JSON.stringify(datos)));
}

export function leerSesionRecordada(): SesionRecordada | null {
  try {
    const datos = JSON.parse(safeStorage.decryptString(fs.readFileSync(archivo()))) as SesionRecordada;
    if (!datos.vence || datos.vence < Date.now()) {
      borrarSesionRecordada();
      return null;
    }
    return datos;
  } catch {
    return null;
  }
}

export function borrarSesionRecordada(): void {
  try {
    fs.rmSync(archivo(), { force: true });
  } catch {
    // no habia sesion guardada
  }
}

// Hasta cuando vale un token de la nube (lo dice el propio token).
export function venceToken(token: string): number {
  try {
    const payload = token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
    return Number(JSON.parse(Buffer.from(payload, "base64").toString("utf-8")).exp) || 0;
  } catch {
    return 0;
  }
}
