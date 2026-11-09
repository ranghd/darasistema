import { ipcMain } from "electron";
import type { DB } from "../db/types";
import type { Autor, CategoriaPropia, Producto } from "../shared/types";
import { auditar } from "./caja";
import { asegurarCuenta, crearAsiento, fechaHoyRD, registrarAjusteInventario } from "../db/contabilidad";

// El codigo del producto no se puede repetir.
function codigoLibre(db: DB, codigo: string | undefined | null, id?: number): string | null {
  const limpio = String(codigo ?? "").trim();
  if (!limpio) return null;
  const otro = db.prepare(`SELECT id, nombre, borrado FROM productos WHERE lower(codigo) = lower(?) AND id != ?`).get(limpio, id ?? -1) as { id: number; nombre: string; borrado: number } | undefined;
  // Un producto borrado definitivamente le cede su codigo al nuevo (el viejo queda con una marca, solo para el historial).
  if (otro?.borrado) {
    db.prepare(`UPDATE productos SET codigo = codigo || '-B' || id WHERE id = ?`).run(otro.id);
    return limpio;
  }
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
  // Se busca el primero libre: al borrar productos el conteo baja y el siguiente numero puede estar ocupado.
  let n = (db.prepare(`SELECT COUNT(*) as c FROM productos`).get() as { c: number }).c + 1;
  const codigoDe = (i: number) => `${categoria.slice(0, 3).toUpperCase()}-${String(i).padStart(3, "0")}`;
  while (db.prepare(`SELECT 1 FROM productos WHERE codigo = ?`).get(codigoDe(n))) n++;
  return codigoDe(n);
}

// Cada categoria (Gas Damian) es tambien su tipo contable: tiene sus cuentas de ventas, costo e inventario.
// "Gas propano" y "Oxigeno" usan las cuentas de siempre (Gas y Oxigeno); las demas se crean con su nombre.
function nombreContable(categoria: string): string {
  const n = categoria.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (n === "gas" || n === "gas propano") return "Gas";
  if (n === "oxigeno") return "Oxigeno";
  return categoria.trim();
}

export function cuentasDeCategoria(db: DB, categoria: string) {
  const n = nombreContable(categoria);
  return {
    ingreso: asegurarCuenta(db, { codigo: "4.1.04", nombre: `Ingresos por Venta de ${n}`, tipo: "INGRESOS", naturaleza: "ACREEDORA", padreCodigo: "4" }),
    costo: asegurarCuenta(db, { codigo: "5.1.04", nombre: `Costo de Venta de ${n}`, tipo: "COSTOS", naturaleza: "DEUDORA", padreCodigo: "5" }),
    inventario: asegurarCuenta(db, { codigo: "1.1.08", nombre: `Inventario de ${n}`, tipo: "ACTIVO", naturaleza: "DEUDORA", padreCodigo: "1.1" }),
    // el campo categoria de la tabla solo admite estos cuatro valores
    tipo: (n === "Gas" ? "GAS" : n === "Oxigeno" ? "OXIGENO" : "OTRO") as Producto["categoria"],
  };
}

// Si un producto con existencia cambia de cuenta de inventario, su valor se pasa de una cuenta a la otra.
function moverInventario(db: DB, nombre: string, desde: number | null | undefined, hacia: number | null | undefined, valor: number) {
  const monto = Math.round(valor * 100) / 100;
  if (!desde || !hacia || desde === hacia || monto < 0.01) return;
  crearAsiento(db, {
    fecha: fechaHoyRD(),
    concepto: `${nombre}: cambio de categoria (inventario a su cuenta nueva)`,
    origen: "AJUSTE",
    lineas: [
      { cuenta_id: hacia, debito: monto, credito: 0, descripcion: nombre },
      { cuenta_id: desde, debito: 0, credito: monto, descripcion: nombre },
    ],
  });
}

// Pone cada producto en las cuentas de su categoria (los que ya tenian categoria antes de este cambio).
function alinearProductos(db: DB) {
  const productos = db.prepare(`SELECT * FROM productos WHERE grupo IS NOT NULL AND grupo != '' AND borrado = 0`).all() as Producto[];
  for (const p of productos) {
    const c = cuentasDeCategoria(db, p.grupo!);
    if (p.cuenta_ingreso_id === c.ingreso && p.cuenta_costo_id === c.costo && p.cuenta_inventario_id === c.inventario) continue;
    moverInventario(db, p.nombre, p.cuenta_inventario_id, c.inventario, p.existencia * p.costo_contenido);
    db.prepare(`UPDATE productos SET cuenta_ingreso_id = ?, cuenta_costo_id = ?, cuenta_inventario_id = ?, categoria = ? WHERE id = ?`).run(c.ingreso, c.costo, c.inventario, c.tipo, p.id);
  }
}

const nombreCuenta = (db: DB, id: number) => (db.prepare(`SELECT nombre FROM cuentas_contables WHERE id = ?`).get(id) as { nombre: string } | undefined)?.nombre ?? null;

function nombreCategoria(nombre: string | null | undefined): string {
  const limpio = limpiarGrupo(nombre);
  if (!limpio) throw new Error("Escribe el nombre de la categoria");
  return limpio;
}

function conCuentasDeCategoria<T extends Partial<Producto>>(db: DB, data: T): T {
  const grupo = limpiarGrupo(data.grupo);
  if (!grupo) throw new Error("Elige la categoria del producto");
  const c = cuentasDeCategoria(db, grupo);
  if (!db.prepare(`SELECT 1 FROM categorias_producto WHERE nombre = ? COLLATE NOCASE`).get(grupo)) db.prepare(`INSERT INTO categorias_producto (nombre) VALUES (?)`).run(grupo);
  return { ...data, grupo, categoria: c.tipo, cuenta_ingreso_id: c.ingreso, cuenta_costo_id: c.costo, cuenta_inventario_id: c.inventario };
}

export function registerProductosIpc(db: DB) {
  // ---------- Categorias propias (el producto guarda el nombre en "grupo") ----------

  ipcMain.handle("categorias:listar", (): CategoriaPropia[] => db.transaction(() => {
    // cada categoria tiene sus cuentas, y sus productos van a ellas
    alinearProductos(db);
    const lista = db
      .prepare(
        `SELECT c.nombre, (SELECT COUNT(*) FROM productos p WHERE p.grupo = c.nombre COLLATE NOCASE AND p.activo = 1) AS productos
         FROM (SELECT nombre FROM categorias_producto UNION SELECT grupo FROM productos WHERE grupo IS NOT NULL AND grupo != '' AND borrado = 0) c
         ORDER BY c.nombre COLLATE NOCASE`
      )
      .all() as CategoriaPropia[];
    return lista.map((c) => {
      const cuentas = cuentasDeCategoria(db, c.nombre);
      return { ...c, cuenta_ingreso: nombreCuenta(db, cuentas.ingreso), cuenta_costo: nombreCuenta(db, cuentas.costo), cuenta_inventario: nombreCuenta(db, cuentas.inventario) };
    });
  })());

  ipcMain.handle("categorias:crear", (_e, nombre: string) => {
    const limpio = nombreCategoria(nombre);
    if (db.prepare(`SELECT 1 FROM categorias_producto WHERE nombre = ? COLLATE NOCASE`).get(limpio)) throw new Error(`Ya existe la categoria ${limpio}`);
    db.transaction(() => {
      db.prepare(`INSERT INTO categorias_producto (nombre) VALUES (?)`).run(limpio);
      cuentasDeCategoria(db, limpio);
    })();
    return true;
  });

  // Cambiar el nombre tambien mueve sus productos; si el nombre nuevo ya existe, las dos se juntan.
  ipcMain.handle("categorias:renombrar", (_e, anterior: string, nuevo: string) => db.transaction(() => {
    const limpio = nombreCategoria(nuevo);
    db.prepare(`DELETE FROM categorias_producto WHERE nombre = ? COLLATE NOCASE`).run(anterior);
    if (!db.prepare(`SELECT 1 FROM categorias_producto WHERE nombre = ? COLLATE NOCASE`).get(limpio)) db.prepare(`INSERT INTO categorias_producto (nombre) VALUES (?)`).run(limpio);
    // las cuentas de la categoria tambien cambian de nombre (si la nueva no existia ya)
    const viejo = nombreContable(anterior);
    const nuevoContable = nombreContable(limpio);
    if (viejo !== "Gas" && viejo !== "Oxigeno" && nuevoContable !== viejo) {
      for (const prefijo of ["Ingresos por Venta de ", "Costo de Venta de ", "Inventario de "]) {
        const libre = !db.prepare(`SELECT 1 FROM cuentas_contables WHERE lower(nombre) = lower(?)`).get(prefijo + nuevoContable);
        if (libre) db.prepare(`UPDATE cuentas_contables SET nombre = ? WHERE lower(nombre) = lower(?)`).run(prefijo + nuevoContable, prefijo + viejo);
      }
    }
    db.prepare(`UPDATE productos SET grupo = ? WHERE grupo = ? COLLATE NOCASE`).run(limpio, anterior);
    alinearProductos(db);
    return true;
  })());

  // Borrar una categoria no borra sus productos: quedan sin categoria.
  ipcMain.handle("categorias:borrar", (_e, nombre: string) => db.transaction(() => {
    db.prepare(`DELETE FROM categorias_producto WHERE nombre = ? COLLATE NOCASE`).run(nombre);
    db.prepare(`UPDATE productos SET grupo = NULL WHERE grupo = ? COLLATE NOCASE`).run(nombre);
    return true;
  })());

  ipcMain.handle("productos:listar", () => {
    return db.prepare(`SELECT * FROM productos WHERE borrado = 0 ORDER BY categoria, nombre`).all() as Producto[];
  });

  ipcMain.handle("productos:crear", (_e, data: Partial<Producto> & { cuentas_por_categoria?: boolean }) => db.transaction(() => {
    if (data.cuentas_por_categoria) data = conCuentasDeCategoria(db, data);
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

  // Borra el producto. Si ya se vendio, se compro o tiene envases o botellas fiadas, se desactiva (deja de
  // salir para vender). Un producto inactivo se puede borrar definitivamente (definitivo: true): deja de salir
  // en todas partes, y si tiene historial la fila se queda solo para que las facturas viejas conserven su
  // nombre. Al borrarlo, su existencia sale tambien de la contabilidad del inventario.
  ipcMain.handle("productos:eliminar", (_e, id: number, data?: { definitivo?: boolean; autor?: Autor }): { borrado: boolean } => db.transaction(() => {
    const producto = db.prepare(`SELECT * FROM productos WHERE id = ?`).get(id) as Producto | undefined;
    if (!producto || producto.borrado) throw new Error("Producto no encontrado");
    const usado = ["factura_lineas", "compra_lineas", "envases_cliente", "envase_movimientos", "botellas_fiadas", "platos_dia"].some((tabla) =>
      db.prepare(`SELECT 1 FROM ${tabla} WHERE producto_id = ? LIMIT 1`).get(id)
    );
    const definitivo = !!data?.definitivo;
    if (definitivo) {
      if (producto.activo) throw new Error("Primero hay que desactivar el producto");
      const envases = (db.prepare(`SELECT COALESCE(SUM(cantidad), 0) AS n FROM envases_cliente WHERE producto_id = ?`).get(id) as { n: number }).n;
      const prestados = (db.prepare(`SELECT COALESCE(SUM(CASE WHEN tipo = 'FIADO' THEN cantidad ELSE -cantidad END), 0) AS n FROM botellas_fiadas WHERE producto_id = ?`).get(id) as { n: number }).n;
      if (envases !== 0 || prestados > 0) throw new Error(`No se puede borrar ${producto.nombre}: hay clientes que todavia tienen envases o cilindros de este producto`);
    }
    if (usado && !definitivo) {
      db.prepare(`UPDATE productos SET activo = 0 WHERE id = ?`).run(id);
      return { borrado: false };
    }
    registrarAjusteInventario(db, producto.cuenta_inventario_id, -producto.existencia * producto.costo_contenido, `Producto borrado: ${producto.nombre}`);
    db.prepare(`DELETE FROM producto_proveedor WHERE producto_id = ?`).run(id);
    if (usado) db.prepare(`UPDATE productos SET borrado = 1, activo = 0, existencia = 0, mercancia_id = NULL, codigo_barras = NULL WHERE id = ?`).run(id);
    else db.prepare(`DELETE FROM productos WHERE id = ?`).run(id);
    if (definitivo && data?.autor?.nombre) auditar(db, data.autor, "BORRAR_PRODUCTO", "producto", id, { nombre: producto.nombre, codigo: producto.codigo, existencia: producto.existencia, con_historial: usado });
    return { borrado: true };
  })());

  ipcMain.handle("productos:actualizar", (_e, id: number, data: Partial<Producto> & { cuentas_por_categoria?: boolean }) => db.transaction(() => {
    const anterior = db.prepare(`SELECT * FROM productos WHERE id = ?`).get(id) as Producto | undefined;
    if (!anterior) throw new Error("Producto no encontrado");
    if (data.cuentas_por_categoria) {
      data = conCuentasDeCategoria(db, data);
      moverInventario(db, anterior.nombre, anterior.cuenta_inventario_id, data.cuenta_inventario_id, anterior.existencia * anterior.costo_contenido);
    }
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
