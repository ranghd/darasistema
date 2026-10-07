import type { Rol } from "./permisos";

export interface PayloadToken {
  empresa: string;
  uid: number;
  usuario: string;
  rol: Rol;
  exp: number;
}

const DURACION_MS = 12 * 60 * 60 * 1000;
const encoder = new TextEncoder();

function aBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function deBase64Url(texto: string): Uint8Array {
  const b64 = texto.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((texto.length + 3) % 4);
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

function clave(secreto: string) {
  return crypto.subtle.importKey("raw", encoder.encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function firmarToken(datos: Omit<PayloadToken, "exp">, secreto: string): Promise<string> {
  const payload = aBase64Url(encoder.encode(JSON.stringify({ ...datos, exp: Date.now() + DURACION_MS })));
  const firma = new Uint8Array(await crypto.subtle.sign("HMAC", await clave(secreto), encoder.encode(payload)));
  return `${payload}.${aBase64Url(firma)}`;
}

export async function verificarToken(token: string, secreto: string): Promise<PayloadToken | null> {
  const [payload, firma] = token.split(".");
  if (!payload || !firma) return null;
  let firmaBytes: Uint8Array;
  try {
    firmaBytes = deBase64Url(firma);
  } catch {
    return null;
  }
  const valido = await crypto.subtle.verify("HMAC", await clave(secreto), firmaBytes, encoder.encode(payload));
  if (!valido) return null;
  const datos = JSON.parse(new TextDecoder().decode(deBase64Url(payload))) as PayloadToken;
  if (typeof datos.exp !== "number" || datos.exp < Date.now()) return null;
  return datos;
}
