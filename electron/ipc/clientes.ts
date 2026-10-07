import { ipcMain } from "electron";
import type { DB } from "../db/types";
import type { Cliente } from "../shared/types";

function siguienteCodigo(db: DB): string {
  const last = db
    .prepare(`SELECT codigo FROM clientes ORDER BY id DESC LIMIT 1`)
    .get() as { codigo: string } | undefined;
  const n = last ? parseInt(last.codigo.split("-")[1] ?? "0", 10) + 1 : 1;
  return `CLI-${String(n).padStart(4, "0")}`;
}

export function registerClientesIpc(db: DB) {
  ipcMain.handle("clientes:listar", () => {
    return db.prepare(`SELECT * FROM clientes ORDER BY nombre`).all() as Cliente[];
  });

  ipcMain.handle("clientes:obtener", (_e, id: number) => {
    return db.prepare(`SELECT * FROM clientes WHERE id = ?`).get(id) as Cliente | undefined;
  });

  ipcMain.handle("clientes:estadoCuenta", (_e, id: number) => {
    const facturas = db
      .prepare(
        `SELECT f.*, COALESCE((SELECT SUM(monto) FROM cobros WHERE factura_id = f.id), 0) as cobrado
         FROM facturas f WHERE f.cliente_id = ? ORDER BY f.fecha DESC`
      )
      .all(id);
    const envases = db
      .prepare(
        `SELECT ec.*, p.nombre as producto_nombre FROM envases_cliente ec
         JOIN productos p ON p.id = ec.producto_id WHERE ec.cliente_id = ? AND ec.cantidad != 0`
      )
      .all(id);
    return { facturas, envases };
  });

  ipcMain.handle("clientes:crear", (_e, data: Partial<Cliente>) => {
    const codigo = data.codigo && data.codigo.length > 0 ? data.codigo : siguienteCodigo(db);
    const info = db
      .prepare(
        `INSERT INTO clientes (codigo, nombre, rnc_cedula, tipo, telefono, email, direccion, activo)
         VALUES (@codigo, @nombre, @rnc_cedula, @tipo, @telefono, @email, @direccion, 1)`
      )
      .run({
        codigo,
        nombre: data.nombre,
        rnc_cedula: data.rnc_cedula ?? null,
        tipo: data.tipo ?? "FISICA",
        telefono: data.telefono ?? null,
        email: data.email ?? null,
        direccion: data.direccion ?? null,
      });
    return db.prepare(`SELECT * FROM clientes WHERE id = ?`).get(info.lastInsertRowid) as Cliente;
  });

  ipcMain.handle("clientes:actualizar", (_e, id: number, data: Partial<Cliente>) => {
    db.prepare(
      `UPDATE clientes SET nombre=@nombre, rnc_cedula=@rnc_cedula, tipo=@tipo, telefono=@telefono, email=@email, direccion=@direccion, activo=@activo WHERE id=@id`
    ).run({
      id,
      nombre: data.nombre,
      rnc_cedula: data.rnc_cedula ?? null,
      tipo: data.tipo ?? "FISICA",
      telefono: data.telefono ?? null,
      email: data.email ?? null,
      direccion: data.direccion ?? null,
      activo: data.activo ?? 1,
    });
    return db.prepare(`SELECT * FROM clientes WHERE id = ?`).get(id) as Cliente;
  });
}
