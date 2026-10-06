import { ipcMain } from "electron";
import type { DB } from "../db/sqlite";
import type { Cuenta } from "../shared/types";

export function registerCuentasIpc(db: DB) {
  ipcMain.handle("cuentas:listar", () => {
    return db.prepare(`SELECT * FROM cuentas_contables ORDER BY codigo`).all() as Cuenta[];
  });

  ipcMain.handle("cuentas:crear", (_e, data: Partial<Cuenta>) => {
    const info = db
      .prepare(
        `INSERT INTO cuentas_contables (codigo, nombre, tipo, padre_id, naturaleza, es_movimiento, activo)
         VALUES (@codigo, @nombre, @tipo, @padre_id, @naturaleza, @es_movimiento, 1)`
      )
      .run({
        codigo: data.codigo,
        nombre: data.nombre,
        tipo: data.tipo,
        padre_id: data.padre_id ?? null,
        naturaleza: data.naturaleza,
        es_movimiento: data.es_movimiento ?? 1,
      });
    return db.prepare(`SELECT * FROM cuentas_contables WHERE id = ?`).get(info.lastInsertRowid) as Cuenta;
  });

  ipcMain.handle("cuentas:actualizar", (_e, id: number, data: Partial<Cuenta>) => {
    db.prepare(
      `UPDATE cuentas_contables SET nombre=@nombre, activo=@activo WHERE id=@id`
    ).run({ id, nombre: data.nombre, activo: data.activo ?? 1 });
    return db.prepare(`SELECT * FROM cuentas_contables WHERE id = ?`).get(id) as Cuenta;
  });
}
