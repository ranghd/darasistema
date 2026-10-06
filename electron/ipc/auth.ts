import { ipcMain } from "electron";
import type { DB } from "../db/sqlite";
import { nuevoPasswordHash, verificarPassword } from "../db/password";

export type RolUsuario = "ADMIN" | "CAJERO";

export interface Usuario {
  id: number;
  usuario: string;
  nombre: string;
  rol: RolUsuario;
  activo: number;
}

export interface SesionUsuario {
  id: number;
  usuario: string;
  nombre: string;
  rol: RolUsuario;
}

export function registerAuthIpc(db: DB) {
  ipcMain.handle("auth:login", (_e, usuario: string, password: string): SesionUsuario => {
    const row = db.prepare(`SELECT * FROM usuarios WHERE usuario = ?`).get(usuario) as
      | (Usuario & { password_hash: string })
      | undefined;

    if (!row || !row.activo) throw new Error("Usuario o contrasena incorrectos");
    if (!verificarPassword(password ?? "", row.password_hash)) {
      throw new Error("Usuario o contrasena incorrectos");
    }

    return { id: row.id, usuario: row.usuario, nombre: row.nombre, rol: row.rol };
  });

  ipcMain.handle("usuarios:listar", (): Usuario[] => {
    return db.prepare(`SELECT id, usuario, nombre, rol, activo FROM usuarios ORDER BY usuario`).all() as Usuario[];
  });

  ipcMain.handle("usuarios:crear", (_e, data: { usuario: string; nombre: string; password: string; rol: RolUsuario }): Usuario => {
    const usuario = (data.usuario ?? "").trim().toLowerCase();
    if (!usuario) throw new Error("El nombre de usuario es obligatorio");
    if (!data.password) throw new Error("La contrasena es obligatoria");

    const existente = db.prepare(`SELECT id FROM usuarios WHERE usuario = ?`).get(usuario);
    if (existente) throw new Error("Ya existe un usuario con ese nombre");

    const info = db
      .prepare(`INSERT INTO usuarios (usuario, nombre, password_hash, rol, activo) VALUES (@usuario, @nombre, @password_hash, @rol, 1)`)
      .run({
        usuario,
        nombre: data.nombre ?? usuario,
        password_hash: nuevoPasswordHash(data.password),
        rol: data.rol ?? "CAJERO",
      });

    return db.prepare(`SELECT id, usuario, nombre, rol, activo FROM usuarios WHERE id = ?`).get(info.lastInsertRowid) as Usuario;
  });

  ipcMain.handle("usuarios:actualizar", (_e, id: number, data: { nombre?: string; password?: string; rol?: RolUsuario; activo?: number }): Usuario => {
    const actual = db.prepare(`SELECT * FROM usuarios WHERE id = ?`).get(id) as (Usuario & { password_hash: string }) | undefined;
    if (!actual) throw new Error("Usuario no encontrado");

    if (data.password) {
      db.prepare(`UPDATE usuarios SET password_hash = @password_hash WHERE id = @id`).run({
        id,
        password_hash: nuevoPasswordHash(data.password),
      });
    }

    db.prepare(`UPDATE usuarios SET nombre = @nombre, rol = @rol, activo = @activo WHERE id = @id`).run({
      id,
      nombre: data.nombre ?? actual.nombre,
      rol: data.rol ?? actual.rol,
      activo: data.activo ?? actual.activo,
    });

    return db.prepare(`SELECT id, usuario, nombre, rol, activo FROM usuarios WHERE id = ?`).get(id) as Usuario;
  });
}
