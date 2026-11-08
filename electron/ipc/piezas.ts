import { ipcMain } from "electron";
import type { DB } from "../db/types";
import { ahoraRD } from "../db/contabilidad";
import { auditar, autorValido } from "./caja";
import type { Autor, CompraPiezasInput, Mercancia, MercanciaInput, MercanciaResumen, Pieza, ResultadoPieza } from "../shared/types";

// Control de piezas (Dara Frituras). La mercancia se compra entera (una pierna de salami) y se vende por
// porciones (lonjas). No se cuentan las lonjas: cada pieza guarda lo que costo y cuanto se le quiere ganar,
// y las ventas de sus productos se le suman a la pieza abierta. Cuando se termina, se compara lo vendido con
// lo esperado. Si queda por debajo de la ganancia minima sale la alerta: falto dinero o mercancia por vender.
//
// - La primera venta abre sola la pieza cerrada mas vieja. "Se termino" cierra la abierta y la proxima
//   venta abre la siguiente.
// - Lo vendido se cuenta de las facturas (sin las anuladas), asi que anular una venta se la resta a su pieza.
// - Si se vende sin ninguna pieza registrada, la venta queda anotada con su mercancia y se le suma a la
//   primera pieza que se compre.

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// Lo vendido de cada pieza sale de sus lineas de factura no anuladas.
const SQL_PIEZAS = `
  SELECT pz.*, m.nombre AS mercancia_nombre, m.pieza,
         COALESCE((SELECT SUM(l.subtotal + l.itbis) FROM factura_lineas l JOIN facturas f ON f.id = l.factura_id
                   WHERE l.pieza_id = pz.id AND f.estado != 'ANULADA'), 0) AS vendido,
         COALESCE((SELECT SUM(l.cantidad) FROM factura_lineas l JOIN facturas f ON f.id = l.factura_id
                   WHERE l.pieza_id = pz.id AND f.estado != 'ANULADA'), 0) AS unidades,
         (SELECT COUNT(*) FROM factura_lineas l JOIN facturas f ON f.id = l.factura_id
          WHERE l.pieza_id = pz.id AND f.estado != 'ANULADA' AND l.precio_lista IS NOT NULL AND ABS(l.precio_lista - l.precio_unitario) > 0.005) AS precios_cambiados
  FROM piezas pz JOIN mercancias m ON m.id = pz.mercancia_id`;

type FilaPieza = Omit<Pieza, "estado" | "esperado" | "minimo" | "diferencia" | "ganancia_real_pct" | "resultado">;

export function resultadoDe(vendido: number, esperado: number, minimo: number): ResultadoPieza {
  if (vendido >= esperado - 0.005) return "OK";
  if (vendido >= minimo - 0.005) return "BAJO";
  return "ALERTA";
}

function completar(f: FilaPieza): Pieza {
  const esperado = r2(f.costo * (1 + f.ganancia_pct / 100));
  const minimo = r2(f.costo * (1 + f.minima_pct / 100));
  const vendido = r2(f.vendido);
  return {
    ...f,
    vendido,
    unidades: r2(f.unidades),
    estado: f.terminada_en ? "TERMINADA" : f.abierta_en ? "ABIERTA" : "CERRADA",
    esperado,
    minimo,
    diferencia: r2(vendido - esperado),
    ganancia_real_pct: f.costo > 0 ? Math.round(((vendido - f.costo) / f.costo) * 1000) / 10 : 0,
    resultado: resultadoDe(vendido, esperado, minimo),
  };
}

function obtenerPieza(db: DB, id: number): Pieza | undefined {
  const f = db.prepare(`${SQL_PIEZAS} WHERE pz.id = ?`).get(id) as FilaPieza | undefined;
  return f && completar(f);
}

function idAbierta(db: DB, mercanciaId: number): number | null {
  const f = db.prepare(`SELECT id FROM piezas WHERE mercancia_id = ? AND abierta_en IS NOT NULL AND terminada_en IS NULL ORDER BY id LIMIT 1`).get(mercanciaId) as { id: number } | undefined;
  return f?.id ?? null;
}

// La usa la factura (dentro de su transaccion): la pieza abierta de esa mercancia, o abre la cerrada mas vieja.
// Sin ninguna pieza devuelve null y la venta queda esperando la proxima compra.
export function piezaParaVenta(db: DB, mercanciaId: number): number | null {
  const abierta = idAbierta(db, mercanciaId);
  if (abierta) return abierta;
  const cerrada = db.prepare(`SELECT id FROM piezas WHERE mercancia_id = ? AND abierta_en IS NULL ORDER BY id LIMIT 1`).get(mercanciaId) as { id: number } | undefined;
  if (!cerrada) return null;
  db.prepare(`UPDATE piezas SET abierta_en = ? WHERE id = ?`).run(ahoraRD(), cerrada.id);
  return cerrada.id;
}

const numeroValido = (n: unknown) => Number.isFinite(Number(n));

// Registra las piezas compradas (desde Control de piezas o desde una compra a un proveedor).
// El costo se reparte entre las piezas; la ultima se lleva los centavos que sobran.
export function comprarPiezas(db: DB, data: CompraPiezasInput, autor: Autor, compraId: number | null = null): number[] {
  const m = db.prepare(`SELECT * FROM mercancias WHERE id = ? AND activo = 1`).get(data.mercancia_id) as Mercancia | undefined;
  if (!m) throw new Error("Esa mercancia no existe");
  const cantidad = Number(data.cantidad);
  const total = r2(Number(data.costo_total));
  const ganancia = Number(data.ganancia_pct);
  if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 200) throw new Error(`Escribe cuantas piezas de ${m.nombre} compraste (numero entero)`);
  if (!(total > 0)) throw new Error(`Escribe cuanto pagaste por ${m.nombre}`);
  if (!numeroValido(ganancia) || ganancia < 0) throw new Error(`Escribe cuanto le quieres ganar a ${m.nombre} (%)`);
  // El aviso guarda la misma distancia con la ganancia que tenia la mercancia.
  const minima = Math.max(-100, Math.min(ganancia, r2(ganancia - (m.ganancia_pct - m.minima_pct))));
  const ahora = ahoraRD();

  return db.transaction(() => {
    const cada = Math.floor((total / cantidad) * 100) / 100;
    const insertar = db.prepare(`INSERT INTO piezas (mercancia_id, costo, ganancia_pct, minima_pct, comprada_en, creado_por, compra_id) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    const ids: number[] = [];
    for (let i = 0; i < cantidad; i++) {
      const costo = i === cantidad - 1 ? r2(total - cada * (cantidad - 1)) : cada;
      ids.push(Number(insertar.run(m.id, costo, ganancia, minima, ahora, autor.nombre, compraId).lastInsertRowid));
    }
    if (!idAbierta(db, m.id)) {
      const sinPieza = db.prepare(`SELECT COUNT(*) AS n FROM factura_lineas WHERE mercancia_id = ? AND pieza_id IS NULL`).get(m.id) as { n: number };
      if (sinPieza.n > 0) {
        db.prepare(`UPDATE piezas SET abierta_en = ? WHERE id = ?`).run(ahora, ids[0]);
        db.prepare(`UPDATE factura_lineas SET pieza_id = ? WHERE mercancia_id = ? AND pieza_id IS NULL`).run(ids[0], m.id);
      }
    }
    db.prepare(`UPDATE mercancias SET ganancia_pct = ?, minima_pct = ? WHERE id = ?`).run(ganancia, minima, m.id);
    auditar(db, autor, "COMPRAR_PIEZAS", "mercancia", m.id, { mercancia: m.nombre, cantidad, costo_total: total, ganancia_pct: ganancia, piezas: ids, compra_id: compraId });
    return ids;
  })();
}

export function registerPiezasIpc(db: DB) {
  // Cada mercancia con su pieza abierta, las que quedan sin abrir y lo vendido sin pieza.
  ipcMain.handle("piezas:resumen", (): MercanciaResumen[] => {
    const mercancias = db.prepare(`SELECT * FROM mercancias WHERE activo = 1 ORDER BY nombre`).all() as Mercancia[];
    return mercancias.map((m) => {
      const abiertaId = idAbierta(db, m.id);
      const cerradas = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(costo), 0) AS costo FROM piezas WHERE mercancia_id = ? AND abierta_en IS NULL`).get(m.id) as { n: number; costo: number };
      const sinPieza = db
        .prepare(
          `SELECT COALESCE(SUM(l.subtotal + l.itbis), 0) AS monto FROM factura_lineas l JOIN facturas f ON f.id = l.factura_id
           WHERE l.mercancia_id = ? AND l.pieza_id IS NULL AND f.estado != 'ANULADA'`
        )
        .get(m.id) as { monto: number };
      return {
        ...m,
        productos: db.prepare(`SELECT id, nombre FROM productos WHERE mercancia_id = ? AND activo = 1 ORDER BY nombre`).all(m.id) as { id: number; nombre: string }[],
        abierta: abiertaId ? obtenerPieza(db, abiertaId)! : null,
        cerradas: cerradas.n,
        costo_cerradas: r2(cerradas.costo),
        sin_pieza: r2(sinPieza.monto),
      };
    });
  });

  // Piezas terminadas entre dos fechas (por el dia en que se terminaron), la mas reciente primero.
  ipcMain.handle("piezas:historial", (_e, desde: string, hasta: string): Pieza[] => {
    return (
      db.prepare(`${SQL_PIEZAS} WHERE pz.terminada_en IS NOT NULL AND substr(pz.terminada_en, 1, 10) BETWEEN ? AND ? ORDER BY pz.terminada_en DESC, pz.id DESC`).all(desde, hasta) as FilaPieza[]
    ).map(completar);
  });

  // Crea o cambia una mercancia y cuales productos salen de ella (un producto sale de una sola).
  ipcMain.handle("mercancias:guardar", (_e, data: MercanciaInput): Mercancia => {
    const autor = autorValido(data.autor);
    const nombre = data.nombre?.trim();
    const pieza = data.pieza?.trim().toLowerCase() || "pieza";
    const ganancia = Number(data.ganancia_pct);
    const minima = Number(data.minima_pct);
    if (!nombre) throw new Error("Escribe el nombre de la mercancia");
    if (!numeroValido(ganancia) || ganancia < 0) throw new Error("Escribe cuanto le quieres ganar (%)");
    if (!numeroValido(minima) || minima < -100) throw new Error("Escribe desde que ganancia avisar (%)");
    if (minima > ganancia) throw new Error("El aviso tiene que ser igual o menor que la ganancia que esperas");
    const productoIds = Array.from(new Set((data.producto_ids ?? []).map(Number).filter((x) => x > 0)));
    if (productoIds.length === 0) throw new Error("Marca al menos un producto que salga de esta mercancia");
    const repetida = db.prepare(`SELECT id FROM mercancias WHERE activo = 1 AND lower(nombre) = lower(?) AND id != ?`).get(nombre, data.id ?? 0);
    if (repetida) throw new Error(`Ya existe la mercancia ${nombre}`);

    const id = db.transaction(() => {
      let mercanciaId = data.id ? Number(data.id) : 0;
      if (mercanciaId) {
        if (!db.prepare(`SELECT id FROM mercancias WHERE id = ? AND activo = 1`).get(mercanciaId)) throw new Error("Esa mercancia no existe");
        db.prepare(`UPDATE mercancias SET nombre = ?, pieza = ?, ganancia_pct = ?, minima_pct = ? WHERE id = ?`).run(nombre, pieza, ganancia, minima, mercanciaId);
        db.prepare(`UPDATE productos SET mercancia_id = NULL WHERE mercancia_id = ?`).run(mercanciaId);
      } else {
        mercanciaId = Number(
          db.prepare(`INSERT INTO mercancias (nombre, pieza, ganancia_pct, minima_pct, activo, creada_en) VALUES (?, ?, ?, ?, 1, ?)`).run(nombre, pieza, ganancia, minima, ahoraRD()).lastInsertRowid
        );
      }
      const ligar = db.prepare(`UPDATE productos SET mercancia_id = ? WHERE id = ?`);
      for (const pid of productoIds) ligar.run(mercanciaId, pid);
      auditar(db, autor, data.id ? "CAMBIAR_MERCANCIA" : "CREAR_MERCANCIA", "mercancia", mercanciaId, { nombre, pieza, ganancia_pct: ganancia, minima_pct: minima, productos: productoIds });
      return mercanciaId;
    })();
    return db.prepare(`SELECT * FROM mercancias WHERE id = ?`).get(id) as Mercancia;
  });

  // Deja de controlar una mercancia (sus productos se siguen vendiendo como antes). Solo sin piezas pendientes.
  ipcMain.handle("mercancias:quitar", (_e, data: { id: number; autor?: Autor }): boolean => {
    const autor = autorValido(data.autor);
    const m = db.prepare(`SELECT * FROM mercancias WHERE id = ? AND activo = 1`).get(data.id) as Mercancia | undefined;
    if (!m) return true;
    const pendientes = (db.prepare(`SELECT COUNT(*) AS n FROM piezas WHERE mercancia_id = ? AND terminada_en IS NULL`).get(m.id) as { n: number }).n;
    if (pendientes > 0) throw new Error(`${m.nombre} todavia tiene ${pendientes === 1 ? `1 ${m.pieza}` : `${pendientes} piezas`} sin terminar: terminalas o quitalas primero`);
    db.transaction(() => {
      db.prepare(`UPDATE mercancias SET activo = 0 WHERE id = ?`).run(m.id);
      db.prepare(`UPDATE productos SET mercancia_id = NULL WHERE mercancia_id = ?`).run(m.id);
      auditar(db, autor, "QUITAR_MERCANCIA", "mercancia", m.id, { nombre: m.nombre });
    })();
    return true;
  });

  // Compra de piezas: el costo total se reparte entre ellas. Si no habia pieza abierta, lo vendido sin pieza
  // se le suma a la primera, que queda abierta.
  ipcMain.handle("piezas:comprar", (_e, data: CompraPiezasInput): boolean => {
    comprarPiezas(db, data, autorValido(data.autor));
    return true;
  });

  // Se termino la pieza abierta: queda cerrada con lo vendido hasta ahora y dice si llego a lo esperado.
  ipcMain.handle("piezas:terminar", (_e, data: { pieza_id: number; autor?: Autor }): Pieza => {
    const autor = autorValido(data.autor);
    const p = obtenerPieza(db, data.pieza_id);
    if (!p) throw new Error("Esa pieza no existe");
    if (p.estado === "TERMINADA") return p;
    db.transaction(() => {
      db.prepare(`UPDATE piezas SET abierta_en = COALESCE(abierta_en, ?), terminada_en = ?, terminada_por = ? WHERE id = ?`).run(ahoraRD(), ahoraRD(), autor.nombre, p.id);
      auditar(db, autor, "TERMINAR_PIEZA", "pieza", p.id, {
        mercancia: p.mercancia_nombre,
        costo: p.costo,
        esperado: p.esperado,
        vendido: p.vendido,
        diferencia: p.diferencia,
        resultado: p.resultado,
      });
    })();
    return obtenerPieza(db, p.id)!;
  });

  // Quita la ultima pieza sin abrir de una mercancia (registrada por error).
  ipcMain.handle("piezas:quitar", (_e, data: { mercancia_id: number; autor?: Autor }): boolean => {
    const autor = autorValido(data.autor);
    const fila = db.prepare(`SELECT id FROM piezas WHERE mercancia_id = ? AND abierta_en IS NULL ORDER BY id DESC LIMIT 1`).get(data.mercancia_id) as { id: number } | undefined;
    const p = fila && obtenerPieza(db, fila.id);
    if (!p) throw new Error("No hay piezas sin abrir para quitar");
    db.transaction(() => {
      db.prepare(`DELETE FROM piezas WHERE id = ?`).run(p.id);
      auditar(db, autor, "QUITAR_PIEZA", "pieza", p.id, { mercancia: p.mercancia_nombre, costo: p.costo });
    })();
    return true;
  });
}
