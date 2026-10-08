import { ipcMain } from "electron";
import type { DB } from "../db/types";
import type { PrecioHistorico, Proveedor, ProveedorConResumen, RelacionProductoProveedor } from "../shared/types";

type DatosProveedor = Partial<Omit<Proveedor, "id" | "creado_en">>;

const vacioANull = (v: unknown) => {
  const t = typeof v === "string" ? v.trim() : v;
  return t === "" || t === undefined ? null : t;
};

// Relaciones producto <-> proveedor con sus numeros calculados del historial de compras.
const SQL_RELACIONES = `
  SELECT pp.producto_id, p.nombre AS producto_nombre, p.codigo AS producto_codigo, p.costo_contenido AS costo_promedio,
         pp.proveedor_id, pr.nombre AS proveedor_nombre, pr.activo AS proveedor_activo,
         pp.codigo_proveedor, pp.precio_referencia, pp.ultimo_precio, pp.ultima_fecha,
         COALESCE(h.cantidad_total, 0) AS cantidad_total, COALESCE(h.veces, 0) AS veces, h.precio_min, h.precio_max
  FROM producto_proveedor pp
  JOIN productos p ON p.id = pp.producto_id
  JOIN proveedores pr ON pr.id = pp.proveedor_id
  LEFT JOIN (
    SELECT c.proveedor_id, cl.producto_id, SUM(cl.cantidad) AS cantidad_total, COUNT(DISTINCT c.id) AS veces,
           MIN(cl.costo_unitario) AS precio_min, MAX(cl.costo_unitario) AS precio_max
    FROM compra_lineas cl JOIN compras c ON c.id = cl.compra_id
    WHERE c.proveedor_id IS NOT NULL
    GROUP BY c.proveedor_id, cl.producto_id
  ) h ON h.proveedor_id = pp.proveedor_id AND h.producto_id = pp.producto_id`;

export function registerProveedoresIpc(db: DB) {
  ipcMain.handle("proveedores:listar", (): ProveedorConResumen[] => {
    return db
      .prepare(
        `SELECT pr.*,
                COUNT(c.id) AS compras,
                COALESCE(SUM(c.total), 0) AS total_comprado,
                MAX(c.fecha) AS ultima_compra,
                COALESCE(SUM(CASE WHEN c.estado = 'PENDIENTE'
                  THEN c.total - COALESCE((SELECT SUM(monto) FROM pagos_compra WHERE compra_id = c.id), 0) ELSE 0 END), 0) AS por_pagar,
                (SELECT COUNT(*) FROM producto_proveedor pp WHERE pp.proveedor_id = pr.id) AS productos
         FROM proveedores pr
         LEFT JOIN compras c ON c.proveedor_id = pr.id
         GROUP BY pr.id
         ORDER BY pr.activo DESC, pr.nombre COLLATE NOCASE`
      )
      .all() as ProveedorConResumen[];
  });

  ipcMain.handle("proveedores:obtener", (_e, id: number) => {
    return db.prepare(`SELECT * FROM proveedores WHERE id = ?`).get(id) as Proveedor | undefined;
  });

  ipcMain.handle("proveedores:crear", (_e, data: DatosProveedor): Proveedor => {
    const nombre = String(data.nombre ?? "").trim().replace(/\s+/g, " ");
    if (!nombre) throw new Error("El nombre del proveedor es obligatorio");
    const repetido = db.prepare(`SELECT id FROM proveedores WHERE lower(trim(nombre)) = lower(?)`).get(nombre);
    if (repetido) throw new Error(`Ya existe un proveedor llamado "${nombre}"`);
    const info = db
      .prepare(
        `INSERT INTO proveedores (nombre, telefono, direccion, rnc, contacto, notas, activo)
         VALUES (@nombre, @telefono, @direccion, @rnc, @contacto, @notas, @activo)`
      )
      .run({
        nombre,
        telefono: vacioANull(data.telefono),
        direccion: vacioANull(data.direccion),
        rnc: vacioANull(data.rnc),
        contacto: vacioANull(data.contacto),
        notas: vacioANull(data.notas),
        activo: data.activo === 0 ? 0 : 1,
      });
    return db.prepare(`SELECT * FROM proveedores WHERE id = ?`).get(info.lastInsertRowid) as Proveedor;
  });

  ipcMain.handle("proveedores:actualizar", (_e, id: number, data: DatosProveedor): Proveedor => {
    const actual = db.prepare(`SELECT * FROM proveedores WHERE id = ?`).get(id) as Proveedor | undefined;
    if (!actual) throw new Error("Proveedor no encontrado");
    const nombre = String(data.nombre ?? actual.nombre).trim().replace(/\s+/g, " ");
    if (!nombre) throw new Error("El nombre del proveedor es obligatorio");
    const repetido = db.prepare(`SELECT id FROM proveedores WHERE lower(trim(nombre)) = lower(?) AND id != ?`).get(nombre, id);
    if (repetido) throw new Error(`Ya existe un proveedor llamado "${nombre}"`);
    db.prepare(
      `UPDATE proveedores SET nombre=@nombre, telefono=@telefono, direccion=@direccion, rnc=@rnc, contacto=@contacto, notas=@notas, activo=@activo
       WHERE id=@id`
    ).run({
      id,
      nombre,
      telefono: data.telefono !== undefined ? vacioANull(data.telefono) : actual.telefono,
      direccion: data.direccion !== undefined ? vacioANull(data.direccion) : actual.direccion,
      rnc: data.rnc !== undefined ? vacioANull(data.rnc) : actual.rnc,
      contacto: data.contacto !== undefined ? vacioANull(data.contacto) : actual.contacto,
      notas: data.notas !== undefined ? vacioANull(data.notas) : actual.notas,
      activo: data.activo === undefined ? actual.activo : data.activo ? 1 : 0,
    });
    return db.prepare(`SELECT * FROM proveedores WHERE id = ?`).get(id) as Proveedor;
  });

  // Todas las relaciones (para sugerir precios al registrar una compra).
  ipcMain.handle("proveedores:relaciones", (): RelacionProductoProveedor[] => {
    return db.prepare(`${SQL_RELACIONES} ORDER BY pp.ultima_fecha DESC`).all() as RelacionProductoProveedor[];
  });

  // Productos que se le compran a un proveedor.
  ipcMain.handle("proveedores:productos", (_e, proveedorId: number): RelacionProductoProveedor[] => {
    return db.prepare(`${SQL_RELACIONES} WHERE pp.proveedor_id = ? ORDER BY p.nombre COLLATE NOCASE`).all(proveedorId) as RelacionProductoProveedor[];
  });

  // Proveedores que venden un producto.
  ipcMain.handle("proveedores:deProducto", (_e, productoId: number): RelacionProductoProveedor[] => {
    return db
      .prepare(`${SQL_RELACIONES} WHERE pp.producto_id = ? ORDER BY pr.activo DESC, pp.ultima_fecha DESC`)
      .all(productoId) as RelacionProductoProveedor[];
  });

  // Historial de precios pagados (cada linea de cada compra). Nunca se sobrescribe.
  ipcMain.handle("proveedores:historialPrecios", (_e, filtro: { producto_id?: number; proveedor_id?: number }): PrecioHistorico[] => {
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (filtro?.producto_id) {
      where.push("cl.producto_id = @producto_id");
      params.producto_id = filtro.producto_id;
    }
    if (filtro?.proveedor_id) {
      where.push("c.proveedor_id = @proveedor_id");
      params.proveedor_id = filtro.proveedor_id;
    }
    return db
      .prepare(
        `SELECT c.id AS compra_id, c.numero AS compra_numero, c.fecha, c.proveedor_id, COALESCE(pr.nombre, c.proveedor) AS proveedor_nombre,
                cl.producto_id, p.nombre AS producto_nombre, cl.cantidad, cl.costo_unitario, cl.subtotal
         FROM compra_lineas cl
         JOIN compras c ON c.id = cl.compra_id
         JOIN productos p ON p.id = cl.producto_id
         LEFT JOIN proveedores pr ON pr.id = c.proveedor_id
         ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
         ORDER BY c.fecha DESC, c.numero DESC, cl.id`
      )
      .all(params) as PrecioHistorico[];
  });

  // Asociar un proveedor a un producto sin comprarle todavia (o editar su codigo / precio cotizado).
  ipcMain.handle(
    "proveedores:vincular",
    (_e, data: { producto_id: number; proveedor_id: number; codigo_proveedor?: string | null; precio_referencia?: number | null }) => {
      if (!db.prepare(`SELECT id FROM productos WHERE id = ?`).get(data.producto_id)) throw new Error("Producto no encontrado");
      if (!db.prepare(`SELECT id FROM proveedores WHERE id = ?`).get(data.proveedor_id)) throw new Error("Proveedor no encontrado");
      const precio = data.precio_referencia === undefined || data.precio_referencia === null || Number.isNaN(Number(data.precio_referencia)) ? null : Number(data.precio_referencia);
      db.prepare(
        `INSERT INTO producto_proveedor (producto_id, proveedor_id, codigo_proveedor, precio_referencia)
         VALUES (@producto_id, @proveedor_id, @codigo, @precio)
         ON CONFLICT(producto_id, proveedor_id) DO UPDATE SET codigo_proveedor = @codigo, precio_referencia = @precio`
      ).run({ producto_id: data.producto_id, proveedor_id: data.proveedor_id, codigo: vacioANull(data.codigo_proveedor), precio });
      return db.prepare(`${SQL_RELACIONES} WHERE pp.producto_id = ? AND pp.proveedor_id = ?`).get(data.producto_id, data.proveedor_id);
    }
  );

  // Quita la asociacion. Las compras hechas siguen en el historial.
  ipcMain.handle("proveedores:desvincular", (_e, productoId: number, proveedorId: number) => {
    const compras = db
      .prepare(`SELECT COUNT(*) AS n FROM compra_lineas cl JOIN compras c ON c.id = cl.compra_id WHERE cl.producto_id = ? AND c.proveedor_id = ?`)
      .get(productoId, proveedorId) as { n: number };
    if (compras.n > 0) throw new Error("Este proveedor ya tiene compras de este producto; se conserva para no perder su historial. Puedes desactivar el proveedor.");
    db.prepare(`DELETE FROM producto_proveedor WHERE producto_id = ? AND proveedor_id = ?`).run(productoId, proveedorId);
    return true;
  });
}
