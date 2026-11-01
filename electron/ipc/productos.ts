import { ipcMain } from "electron";
import type { DB } from "../db/types";
import type { CategoriaPropia, Producto } from "../shared/types";
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

// Otros precios del producto: se guardan solo los que tienen nombre y precio.
function limpiarPrecios(valor: unknown): string | null {
  let lista: unknown = valor;
  if (typeof valor === "string") {
    try {
      lista = JSON.parse(valor);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(lista)) return null;
  const buenos = lista
    .map((x: any) => ({ nombre: String(x?.nombre ?? "").trim(), precio: Math.round(Number(x?.precio) * 10000) / 10000 }))
    .filter((x) => x.nombre && x.precio > 0);
  return buenos.length ? JSON.stringify(buenos) : null;
}

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

function nombreCategoria(nombre: string | null | undefined): string {
  const limpio = limpiarGrupo(nombre);
  if (!limpio) throw new Error("Escribe el nombre de la categoria");
  return limpio;
}

export function registerProductosIpc(db: DB) {
  // ---------- Categorias propias (el producto guarda el nombre en "grupo") ----------

  ipcMain.handle("categorias:listar", (): CategoriaPropia[] => {
    return db
      .prepare(
        `SELECT c.nombre, (SELECT COUNT(*) FROM productos p WHERE p.grupo = c.nombre COLLATE NOCASE AND p.activo = 1) AS productos
         FROM (SELECT nombre FROM categorias_producto UNION SELECT grupo FROM productos WHERE grupo IS NOT NULL AND grupo != '') c
         ORDER BY c.nombre COLLATE NOCASE`
      )
      .all() as CategoriaPropia[];
  });

  ipcMain.handle("categorias:crear", (_e, nombre: string) => {
    const limpio = nombreCategoria(nombre);
    if (db.prepare(`SELECT 1 FROM categorias_producto WHERE nombre = ? COLLATE NOCASE`).get(limpio)) throw new Error(`Ya existe la categoria ${limpio}`);
    db.prepare(`INSERT INTO categorias_producto (nombre) VALUES (?)`).run(limpio);
    return true;
  });

  // Cambiar el nombre tambien mueve sus productos; si el nombre nuevo ya existe, las dos se juntan.
  ipcMain.handle("categorias:renombrar", (_e, anterior: string, nuevo: string) => db.transaction(() => {
    const limpio = nombreCategoria(nuevo);
    db.prepare(`DELETE FROM categorias_producto WHERE nombre = ? COLLATE NOCASE`).run(anterior);
    if (!db.prepare(`SELECT 1 FROM categorias_producto WHERE nombre = ? COLLATE NOCASE`).get(limpio)) db.prepare(`INSERT INTO categorias_producto (nombre) VALUES (?)`).run(limpio);
    db.prepare(`UPDATE productos SET grupo = ? WHERE grupo = ? COLLATE NOCASE`).run(limpio, anterior);
    return true;
  })());

  // Borrar una categoria no borra sus productos: quedan sin categoria.
  ipcMain.handle("categorias:borrar", (_e, nombre: string) => db.transaction(() => {
    db.prepare(`DELETE FROM categorias_producto WHERE nombre = ? COLLATE NOCASE`).run(nombre);
    db.prepare(`UPDATE productos SET grupo = NULL WHERE grupo = ? COLLATE NOCASE`).run(nombre);
    return true;
  })());

  ipcMain.handle("productos:listar", () => {
    return db.prepare(`SELECT * FROM productos ORDER BY categoria, nombre`).all() as Producto[];
  });

  ipcMain.handle("productos:crear", (_e, data: Partial<Producto>) => db.transaction(() => {
    const codigo = codigoLibre(db, data.codigo) ?? siguienteCodigo(db, data.categoria ?? "OTRO");
    const info = db
      .prepare(
        `INSERT INTO productos (codigo, nombre, categoria, unidad, precio_contenido, costo_contenido, maneja_envase, fianza_envase, itbis_rate, cuenta_ingreso_id, cuenta_costo_id, cuenta_inventario_id, existencia, activo, grupo, codigo_barras, precios_extra)
         VALUES (@codigo, @nombre, @categoria, @unidad, @precio_contenido, @costo_contenido, @maneja_envase, @fianza_envase, @itbis_rate, @cuenta_ingreso_id, @cuenta_costo_id, @cuenta_inventario_id, @existencia, 1, @grupo, @codigo_barras, @precios_extra)`
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
        precios_extra: limpiarPrecios(data.precios_extra),
      });
    const creado = db.prepare(`SELECT * FROM productos WHERE id = ?`).get(info.lastInsertRowid) as Producto;
    registrarAjusteInventario(db, creado.cuenta_inventario_id, creado.existencia * creado.costo_contenido, `Existencia inicial: ${creado.nombre}`);
    return creado;
  })());

  // Borra el producto. Si ya se vendio, se compro o tiene envases o botellas fiadas, no se puede borrar
  // sin romper ese historial: se desactiva (deja de salir para vender). Si se borra, su existencia
  // sale tambien de la contabilidad del inventario.
  ipcMain.handle("productos:eliminar", (_e, id: number): { borrado: boolean } => db.transaction(() => {
    const producto = db.prepare(`SELECT * FROM productos WHERE id = ?`).get(id) as Producto | undefined;
    if (!producto) throw new Error("Producto no encontrado");
    const usado = ["factura_lineas", "compra_lineas", "envases_cliente", "envase_movimientos", "botellas_fiadas"].some((tabla) =>
      db.prepare(`SELECT 1 FROM ${tabla} WHERE producto_id = ? LIMIT 1`).get(id)
    );
    if (usado) {
      db.prepare(`UPDATE productos SET activo = 0 WHERE id = ?`).run(id);
      return { borrado: false };
    }
    registrarAjusteInventario(db, producto.cuenta_inventario_id, -producto.existencia * producto.costo_contenido, `Producto borrado: ${producto.nombre}`);
    db.prepare(`DELETE FROM producto_proveedor WHERE producto_id = ?`).run(id);
    db.prepare(`DELETE FROM productos WHERE id = ?`).run(id);
    return { borrado: true };
  })());

  ipcMain.handle("productos:actualizar", (_e, id: number, data: Partial<Producto>) => db.transaction(() => {
    const anterior = db.prepare(`SELECT * FROM productos WHERE id = ?`).get(id) as Producto | undefined;
    if (!anterior) throw new Error("Producto no encontrado");
    db.prepare(
      `UPDATE productos SET codigo=@codigo, codigo_barras=@codigo_barras, grupo=@grupo, nombre=@nombre, categoria=@categoria, unidad=@unidad, precio_contenido=@precio_contenido,
        costo_contenido=@costo_contenido, maneja_envase=@maneja_envase, fianza_envase=@fianza_envase, itbis_rate=@itbis_rate,
        cuenta_ingreso_id=@cuenta_ingreso_id, cuenta_costo_id=@cuenta_costo_id, cuenta_inventario_id=@cuenta_inventario_id,
        existencia=@existencia, activo=@activo,
        precios_extra = CASE WHEN @cambia_precios THEN @precios_extra ELSE precios_extra END WHERE id=@id`
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
      // las pantallas que no mandan los otros precios (las otras ediciones) no los borran
      cambia_precios: data.precios_extra !== undefined ? 1 : 0,
      precios_extra: limpiarPrecios(data.precios_extra),
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
