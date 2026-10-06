import { createHash, randomBytes } from "node:crypto";

export function hashPassword(password: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${password}`).digest("hex");
}

export function nuevoPasswordHash(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}$${hashPassword(password, salt)}`;
}

export function verificarPassword(password: string, almacenado: string): boolean {
  const [salt] = almacenado.split("$");
  if (!salt) return false;
  return hashPassword(password, salt) === almacenado;
}
