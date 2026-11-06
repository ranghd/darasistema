import { ipcMain } from "electron";
import type { DB } from "../db/types";
import { auditar, autorValido } from "./caja";
import type { Autor, CambioPlato, PlatoDia, ReportePlato } from "../shared/types";

// Platos del dia (Dara Frituras): lo que se vende hoy, con su precio de hoy y las porciones preparadas.
// Se vende como cualquier producto (baja la existencia y registra su costo) y ademas no puede pasar de las porciones de hoy.
// Lo vendido se cuenta de las facturas, asi que anular una venta devuelve la porcion.

const r2 = (n: number) => Math.round(n * 100) / 100;

const SQL_PLATOS = `
  SELECT d.fecha, d.producto_id, d.precio, d.porciones, p.nombre, p.grupo, p.itbis_rate,
         COALESCE((SELECT SUM(l.cantidad) FROM factura_lineas l JOIN facturas f ON f.id = l.factura_id
                   WHERE l.producto_id = d.producto_id AND l.plato_dia = 1 AND f.fecha = d.fecha AND f.estado != 'ANULADA'), 0) AS vendidas
  FROM platos_dia d JOIN productos p ON p.id = d.producto_id`;

function conQuedan(fila: Omit<PlatoDia, "quedan">): PlatoDia {
  return { ...fila, quedan: r2(fila.porciones - fila.vendidas) };
}

// Lo usa la factura: el plato del dia de ese producto en esa fecha, si lo hay.
export function platoDelDia(db: DB, fecha: string, productoId: number): PlatoDia | undefined {
  const fila = db.prepare(`${SQL_PLATOS} WHERE d.fecha = ? AND d.producto_id = ?`).get(fecha, productoId) as Omit<PlatoDia, "quedan"> | undefined;
  return fila && conQuedan(fila);
}

export function registerPlatosIpc(db: DB) {
  ipcMain.handle("platos:listar", (_e, fecha: string): PlatoDia[] => {
    return (db.prepare(`${SQL_PLATOS} WHERE d.fecha = ? ORDER BY p.nombre`).all(fecha) as Omit<PlatoDia, "quedan">[]).map(conQuedan);
  });

  // Agrega el plato al menu del dia o le cambia el precio y las porciones.
  ipcMain.handle("platos:guardar", (_e, data: { fecha: string; producto_id: number; precio_final: number; porciones: number; autor?: Autor }): PlatoDia => {
    const autor = autorValido(data.autor);
    const producto = db.prepare(`SELECT nombre, itbis_rate FROM productos WHERE id = ?`).get(data.producto_id) as { nombre: string; itbis_rate: number } | undefined;
    if (!producto) throw new Error("Ese plato no existe");
    const final = Number(data.precio_final);
    const porciones = Number(data.porciones);
    if (!(final > 0)) throw new Error("Escribe el precio del plato");
    if (!(porciones >= 0)) throw new Error("Escribe cuantas porciones hay");
    const antes = platoDelDia(db, data.fecha, data.producto_id);
    if (antes && porciones < antes.vendidas) throw new Error(`Ya se vendieron ${antes.vendidas} porciones de ${producto.nombre}: no pueden ser menos`);
    const precio = Math.round((final / (1 + (producto.itbis_rate ?? 0.18))) * 10000) / 10000;
    db.transaction(() => {
      db.prepare(
        `INSERT INTO platos_dia (fecha, producto_id, precio, porciones) VALUES (@fecha, @producto_id, @precio, @porciones)
         ON CONFLICT(fecha, producto_id) DO UPDATE SET precio = @precio, porciones = @porciones`
      ).run({ fecha: data.fecha, producto_id: data.producto_id, precio, porciones });
      auditar(db, autor, antes ? "CAMBIAR_PLATO_DIA" : "AGREGAR_PLATO_DIA", "plato_dia", data.producto_id, {
        fecha: data.fecha,
        plato: producto.nombre,
        porciones,
        porciones_antes: antes?.porciones ?? null,
        precio_final: final,
      });
    })();
    return platoDelDia(db, data.fecha, data.producto_id)!;
  });

  ipcMain.handle("platos:quitar", (_e, data: { fecha: string; producto_id: number; autor?: Autor }): boolean => {
    const autor = autorValido(data.autor);
    const plato = platoDelDia(db, data.fecha, data.producto_id);
    if (!plato) return true;
    if (plato.vendidas > 0) throw new Error(`${plato.nombre} ya tiene ventas de hoy: no se puede quitar. Si se acabo, deja las porciones en ${plato.vendidas}.`);
    db.transaction(() => {
      db.prepare(`DELETE FROM platos_dia WHERE fecha = ? AND producto_id = ?`).run(data.fecha, data.producto_id);
      auditar(db, autor, "QUITAR_PLATO_DIA", "plato_dia", data.producto_id, { fecha: data.fecha, plato: plato.nombre, porciones_antes: plato.porciones });
    })();
    return true;
  });

  // Copia el ultimo menu que se hizo antes de esa fecha, con sus precios y porciones.
  ipcMain.handle("platos:copiar", (_e, data: { fecha: string; autor?: Autor }): number => {
    const autor = autorValido(data.autor);
    const anterior = (db.prepare(`SELECT MAX(fecha) AS f FROM platos_dia WHERE fecha < ?`).get(data.fecha) as { f: string | null }).f;
    if (!anterior) throw new Error("No hay un menu anterior para copiar");
    return db.transaction(() => {
      const info = db
        .prepare(
          `INSERT OR IGNORE INTO platos_dia (fecha, producto_id, precio, porciones)
           SELECT ?, d.producto_id, d.precio, d.porciones FROM platos_dia d JOIN productos p ON p.id = d.producto_id WHERE d.fecha = ? AND p.activo = 1`
        )
        .run(data.fecha, anterior);
      auditar(db, autor, "COPIAR_MENU_DIA", "plato_dia", null, { fecha: data.fecha, desde: anterior, platos: info.changes });
      return Number(info.changes);
    })();
  });

  // Por dia y plato: preparadas, vendidas, sobrantes y el dinero que dejo.
  ipcMain.handle("platos:reporte", (_e, desde: string, hasta: string): ReportePlato[] => {
    return db
      .prepare(
        `SELECT d.fecha, d.producto_id, p.nombre, d.porciones,
                COALESCE(SUM(CASE WHEN f.id IS NOT NULL THEN l.cantidad END), 0) AS vendidas,
                COALESCE(SUM(CASE WHEN f.id IS NOT NULL THEN l.subtotal + l.itbis END), 0) AS dinero
         FROM platos_dia d JOIN productos p ON p.id = d.producto_id
         LEFT JOIN factura_lineas l ON l.producto_id = d.producto_id AND l.plato_dia = 1
         LEFT JOIN facturas f ON f.id = l.factura_id AND f.fecha = d.fecha AND f.estado != 'ANULADA'
         WHERE d.fecha BETWEEN ? AND ?
         GROUP BY d.fecha, d.producto_id ORDER BY d.fecha DESC, p.nombre`
      )
      .all(desde, hasta)
      .map((fila: any) => ({ ...fila, sobrantes: r2(fila.porciones - fila.vendidas), dinero: r2(fila.dinero) })) as ReportePlato[];
  });

  // Quien armo o cambio el menu y a que hora.
  ipcMain.handle("platos:cambios", (_e, desde: string, hasta: string): CambioPlato[] => {
    return db
      .prepare(`SELECT id, fecha, usuario_nombre, accion, detalle FROM auditoria WHERE entidad = 'plato_dia' AND substr(fecha, 1, 10) BETWEEN ? AND ? ORDER BY id DESC`)
      .all(desde, hasta) as CambioPlato[];
  });
}
