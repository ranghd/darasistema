import { ipcMain } from "electron";
import type { DB } from "../db/types";
import type { Producto } from "../shared/types";
import { registrarAjusteInventario } from "../db/contabilidad";

// El codigo del producto no se puede repetir.
function codigoLibre(db: DB, codigo: string | undefined | null, id?: number): string | null {
  const limpio = String(codigo ?? "").trim();
  if (!limpio) return null;
  const otro = db.prepare(`SELECT id, nombre FROM productos WHERE lower(codigo) = lower(?) AND id != ?`).get(limpio, id ?? -1) as { id: number; nombre: string } | undefined;
  if (otro) throw new Error(`El codigo ${limpio} ya lo tiene "${otro.nombre}"`);
  return limpio;
}

// El codigo de barras es opcional, pero dos productos no pueden tener el mismo.
function barrasLibre(db: DB, barras: string | undefined | null, id?: number): string | null {
  const limpio = String(barras ?? "").trim();
  if (!limpio) return null;
  const otro = db.prepare(`SELECT nombre FROM productos WHERE codigo_barras = ? AND id != ?`).get(limpio, id ?? -1) as { nombre: string } | undefined;
  if (otro) throw new Error(`El codigo de barras ${limpio} ya lo tiene "${otro.nombre}"`);
  return limpio;
}

const limpiarGrupo = (g: string | null | undefined) => String(g ?? "").trim().replace(/\s+/g, " ") || null;

function siguienteCodigo(db: DB, categoria: string): string {
  // En el colmado los codigos son numeros cortos: 1, 2, 3...
  const rubro = (db.prepare(`SELECT rubro FROM company_config LIMIT 1`).get() as { rubro?: string } | undefined)?.rubro;
  if (rubro === "colmado") {
    const max = (db.prepare(`SELECT MAX(CAST(codigo AS INTEGER)) as m FROM productos WHERE codigo != '' AND codigo NOT GLOB '*[^0-9]*'`).get() as { m: number | null }).m ?? 0;
    let n = max + 1;
    while (db.prepare(`SELECT 1 FROM productos WHERE codigo = ?`).get(String(n))) n++;
    return String(n);
  }
  const count = (db.prepare(`SELECT COUNT(*) as c FROM productos`).get() as { c: number }).c;
  return `${categoria.slice(0, 3).toUpperCase()}-${String(count + 1).padStart(3, "0")}`;
}

export function registerProductosIpc(db: DB) {
  ipcMain.handle("productos:listar", () => {
    return db.prepare(`SELECT * FROM productos ORDER BY categoria, nombre`).all() as Producto[];
  });

  ipcMain.handle("productos:crear", (_e, data: Partial<Producto>) => db.transaction(() => {
    const codigo = codigoLibre(db, data.codigo) ?? siguienteCodigo(db, data.categoria ?? "OTRO");
    const info = db
      .prepare(
        `INSERT INTO productos (codigo, nombre, categoria, unidad, precio_contenido, costo_contenido, maneja_envase, fianza_envase, itbis_rate, cuenta_ingreso_id, cuenta_costo_id, cuenta_inventario_id, existencia, activo, grupo, codigo_barras)
         VALUES (@codigo, @nombre, @categoria, @unidad, @precio_contenido, @costo_contenido, @maneja_envase, @fianza_envase, @itbis_rate, @cuenta_ingreso_id, @cuenta_costo_id, @cuenta_inventario_id, @existencia, 1, @grupo, @codigo_barras)`
      )
      .run({
        codigo,
        codigo_barras: barrasLibre(db, data.codigo_barras),
        grupo: limpiarGrupo(data.grupo),
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
      `UPDATE productos SET codigo=@codigo, codigo_barras=@codigo_barras, grupo=@grupo, nombre=@nombre, categoria=@categoria, unidad=@unidad, precio_contenido=@precio_contenido,
        costo_contenido=@costo_contenido, maneja_envase=@maneja_envase, fianza_envase=@fianza_envase, itbis_rate=@itbis_rate,
        cuenta_ingreso_id=@cuenta_ingreso_id, cuenta_costo_id=@cuenta_costo_id, cuenta_inventario_id=@cuenta_inventario_id,
        existencia=@existencia, activo=@activo WHERE id=@id`
    ).run({
      id,
      codigo: codigoLibre(db, data.codigo, id) ?? anterior.codigo,
      codigo_barras: data.codigo_barras !== undefined ? barrasLibre(db, data.codigo_barras, id) : anterior.codigo_barras ?? null,
      grupo: limpiarGrupo(data.grupo !== undefined ? data.grupo : anterior.grupo),
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
