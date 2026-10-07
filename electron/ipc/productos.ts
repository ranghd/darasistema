import { ipcMain } from "electron";
import type { DB } from "../db/types";
import type { Producto } from "../shared/types";
import { registrarAjusteInventario } from "../db/contabilidad";

function siguienteCodigo(db: DB, categoria: string): string {
  const count = (db.prepare(`SELECT COUNT(*) as c FROM productos`).get() as { c: number }).c;
  return `${categoria.slice(0, 3).toUpperCase()}-${String(count + 1).padStart(3, "0")}`;
}

export function registerProductosIpc(db: DB) {
  ipcMain.handle("productos:listar", () => {
    return db.prepare(`SELECT * FROM productos ORDER BY categoria, nombre`).all() as Producto[];
  });

  ipcMain.handle("productos:crear", (_e, data: Partial<Producto>) => db.transaction(() => {
    const codigo = data.codigo && data.codigo.length > 0 ? data.codigo : siguienteCodigo(db, data.categoria ?? "OTRO");
    const info = db
      .prepare(
        `INSERT INTO productos (codigo, nombre, categoria, unidad, precio_contenido, costo_contenido, maneja_envase, fianza_envase, itbis_rate, cuenta_ingreso_id, cuenta_costo_id, cuenta_inventario_id, existencia, activo)
         VALUES (@codigo, @nombre, @categoria, @unidad, @precio_contenido, @costo_contenido, @maneja_envase, @fianza_envase, @itbis_rate, @cuenta_ingreso_id, @cuenta_costo_id, @cuenta_inventario_id, @existencia, 1)`
      )
      .run({
        codigo,
        nombre: data.nombre,
        categoria: data.categoria ?? "OTRO",
        unidad: data.unidad ?? "UNIDAD",
        precio_contenido: data.precio_contenido ?? 0,
        costo_contenido: data.costo_contenido ?? 0,
        maneja_envase: data.maneja_envase ? 1 : 0,
        fianza_envase: data.fianza_envase ?? 0,
        itbis_rate: data.itbis_rate ?? 0.18,
        cuenta_ingreso_id: data.cuenta_ingreso_id ?? null,
        cuenta_costo_id: data.cuenta_costo_id ?? null,
        cuenta_inventario_id: data.cuenta_inventario_id ?? null,
        existencia: data.existencia ?? 0,
      });
    const creado = db.prepare(`SELECT * FROM productos WHERE id = ?`).get(info.lastInsertRowid) as Producto;
    registrarAjusteInventario(db, creado.cuenta_inventario_id, creado.existencia * creado.costo_contenido, `Existencia inicial: ${creado.nombre}`);
    return creado;
  })());

  ipcMain.handle("productos:actualizar", (_e, id: number, data: Partial<Producto>) => db.transaction(() => {
    const anterior = db.prepare(`SELECT * FROM productos WHERE id = ?`).get(id) as Producto | undefined;
    if (!anterior) throw new Error("Producto no encontrado");
    db.prepare(
      `UPDATE productos SET nombre=@nombre, categoria=@categoria, unidad=@unidad, precio_contenido=@precio_contenido,
        costo_contenido=@costo_contenido, maneja_envase=@maneja_envase, fianza_envase=@fianza_envase, itbis_rate=@itbis_rate,
        cuenta_ingreso_id=@cuenta_ingreso_id, cuenta_costo_id=@cuenta_costo_id, cuenta_inventario_id=@cuenta_inventario_id,
        existencia=@existencia, activo=@activo WHERE id=@id`
    ).run({
      id,
      nombre: data.nombre,
      categoria: data.categoria ?? "OTRO",
      unidad: data.unidad ?? "UNIDAD",
      precio_contenido: data.precio_contenido ?? 0,
      costo_contenido: data.costo_contenido ?? 0,
      maneja_envase: data.maneja_envase ? 1 : 0,
      fianza_envase: data.fianza_envase ?? 0,
      itbis_rate: data.itbis_rate ?? 0.18,
      cuenta_ingreso_id: data.cuenta_ingreso_id ?? null,
      cuenta_costo_id: data.cuenta_costo_id ?? null,
      cuenta_inventario_id: data.cuenta_inventario_id ?? null,
      existencia: data.existencia ?? 0,
      activo: data.activo ?? 1,
    });
    const actualizado = db.prepare(`SELECT * FROM productos WHERE id = ?`).get(id) as Producto;
    // Cambiar la existencia a mano (conteo fisico) tambien mueve la contabilidad.
    const diferencia = actualizado.existencia - anterior.existencia;
    if (diferencia !== 0) {
      registrarAjusteInventario(
        db,
        actualizado.cuenta_inventario_id,
        diferencia * actualizado.costo_contenido,
        `Ajuste de existencia ${actualizado.nombre}: ${anterior.existencia} -> ${actualizado.existencia}`
      );
    }
    return actualizado;
  })());
}
