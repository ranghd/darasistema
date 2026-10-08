import type { DB } from "./types";

// Busca un proveedor por nombre (sin importar mayusculas ni espacios); si no existe lo crea.
export function buscarOCrearProveedor(db: DB, nombre: string): number {
  const limpio = nombre.trim().replace(/\s+/g, " ");
  if (!limpio) throw new Error("El proveedor es obligatorio");
  const existente = db.prepare(`SELECT id FROM proveedores WHERE lower(trim(nombre)) = lower(?)`).get(limpio) as { id: number } | undefined;
  if (existente) return existente.id;
  return Number(db.prepare(`INSERT INTO proveedores (nombre) VALUES (?)`).run(limpio).lastInsertRowid);
}

// Anota en la relacion producto <-> proveedor el precio pagado en una compra.
// Si es la primera vez que ese proveedor vende ese producto, crea la relacion.
// El historial completo queda en compra_lineas; esto solo guarda el ultimo.
export function registrarPrecioProveedor(db: DB, proveedorId: number, productoId: number, precio: number, fecha: string): void {
  db.prepare(
    `INSERT INTO producto_proveedor (producto_id, proveedor_id, ultimo_precio, ultima_fecha)
     VALUES (@producto_id, @proveedor_id, @precio, @fecha)
     ON CONFLICT(producto_id, proveedor_id) DO UPDATE SET
       ultimo_precio = CASE WHEN ultima_fecha IS NULL OR @fecha >= ultima_fecha THEN @precio ELSE ultimo_precio END,
       ultima_fecha = CASE WHEN ultima_fecha IS NULL OR @fecha >= ultima_fecha THEN @fecha ELSE ultima_fecha END`
  ).run({ producto_id: productoId, proveedor_id: proveedorId, precio, fecha });
}

export function proveedoresDesdeComprasAnteriores(db: DB): void {
  const compras = db.prepare(`SELECT id, proveedor FROM compras WHERE proveedor_id IS NULL ORDER BY fecha, id`).all() as { id: number; proveedor: string }[];
  const lineas = db.prepare(
    `SELECT cl.producto_id, cl.costo_unitario, c.fecha FROM compra_lineas cl JOIN compras c ON c.id = cl.compra_id WHERE cl.compra_id = ? ORDER BY cl.id`
  );
  for (const c of compras) {
    if (!c.proveedor?.trim()) continue;
    const proveedorId = buscarOCrearProveedor(db, c.proveedor);
    db.prepare(`UPDATE compras SET proveedor_id = ? WHERE id = ?`).run(proveedorId, c.id);
    for (const l of lineas.all(c.id) as { producto_id: number; costo_unitario: number; fecha: string }[]) {
      registrarPrecioProveedor(db, proveedorId, l.producto_id, l.costo_unitario, l.fecha);
    }
  }
}
