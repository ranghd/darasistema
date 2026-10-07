import { ipcMain } from "electron";
import type { DB } from "../db/types";
import { crearAsiento, type NuevoAsientoInput } from "../db/contabilidad";
import type { AsientoConLineas } from "../shared/types";

export function registerAsientosIpc(db: DB) {
  ipcMain.handle("asientos:listar", (_e, desde?: string, hasta?: string) => {
    const where: string[] = [];
    const params: Record<string, string> = {};
    if (desde) {
      where.push("a.fecha >= @desde");
      params.desde = desde;
    }
    if (hasta) {
      where.push("a.fecha <= @hasta");
      params.hasta = hasta;
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const asientos = db
      .prepare(`SELECT a.* FROM asientos a ${clause} ORDER BY a.numero DESC`)
      .all(params) as any[];

    const lineaStmt = db.prepare(
      `SELECT al.id, al.cuenta_id, al.debito, al.credito, al.descripcion, c.codigo as cuenta_codigo, c.nombre as cuenta_nombre
       FROM asiento_lineas al JOIN cuentas_contables c ON c.id = al.cuenta_id
       WHERE al.asiento_id = ? ORDER BY al.id`
    );

    return asientos.map((a) => ({ ...a, lineas: lineaStmt.all(a.id) })) as AsientoConLineas[];
  });

  ipcMain.handle("asientos:crear", (_e, input: Omit<NuevoAsientoInput, "origen">) => {
    const id = crearAsiento(db, { ...input, origen: "MANUAL" });
    return id;
  });

  ipcMain.handle("asientos:libroMayor", (_e, cuentaId: number, desde?: string, hasta?: string) => {
    const where: string[] = ["al.cuenta_id = @cuentaId"];
    const params: Record<string, any> = { cuentaId };
    if (desde) {
      where.push("a.fecha >= @desde");
      params.desde = desde;
    }
    if (hasta) {
      where.push("a.fecha <= @hasta");
      params.hasta = hasta;
    }
    const rows = db
      .prepare(
        `SELECT a.fecha, a.numero, a.concepto, al.debito, al.credito, al.descripcion
         FROM asiento_lineas al JOIN asientos a ON a.id = al.asiento_id
         WHERE ${where.join(" AND ")}
         ORDER BY a.fecha, a.numero`
      )
      .all(params) as { fecha: string; numero: number; concepto: string; debito: number; credito: number; descripcion: string | null }[];

    let saldo = 0;
    return rows.map((r) => {
      saldo += r.debito - r.credito;
      return { ...r, saldo };
    });
  });

  ipcMain.handle("asientos:balanceComprobacion", (_e, desde?: string, hasta?: string) => {
    const where: string[] = [];
    const params: Record<string, any> = {};
    if (desde) {
      where.push("a.fecha >= @desde");
      params.desde = desde;
    }
    if (hasta) {
      where.push("a.fecha <= @hasta");
      params.hasta = hasta;
    }
    const clause = where.length ? `AND ${where.join(" AND ")}` : "";
    return db
      .prepare(
        `SELECT c.id, c.codigo, c.nombre, c.tipo, c.naturaleza,
                COALESCE(SUM(al.debito), 0) as total_debito,
                COALESCE(SUM(al.credito), 0) as total_credito
         FROM cuentas_contables c
         LEFT JOIN (
           SELECT al.cuenta_id, al.debito, al.credito
           FROM asiento_lineas al JOIN asientos a ON a.id = al.asiento_id
           WHERE 1 = 1 ${clause}
         ) al ON al.cuenta_id = c.id
         WHERE c.es_movimiento = 1
         GROUP BY c.id
         HAVING total_debito != 0 OR total_credito != 0
         ORDER BY c.codigo`
      )
      .all(params);
  });

  // Totales por cuenta de movimiento, para mostrar el saldo en el Catalogo de Cuentas.
  ipcMain.handle("cuentas:saldos", (_e, desde?: string, hasta?: string) => {
    const where: string[] = [];
    const params: Record<string, string> = {};
    if (desde) {
      where.push("a.fecha >= @desde");
      params.desde = desde;
    }
    if (hasta) {
      where.push("a.fecha <= @hasta");
      params.hasta = hasta;
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return db
      .prepare(
        `SELECT al.cuenta_id, SUM(al.debito) AS debito, SUM(al.credito) AS credito,
                COUNT(*) AS movimientos, MAX(a.fecha) AS ultima_fecha
         FROM asiento_lineas al JOIN asientos a ON a.id = al.asiento_id
         ${clause}
         GROUP BY al.cuenta_id`
      )
      .all(params);
  });

  // Todos los asientos que genero una factura: la venta, sus cobros, notas y anulacion.
  ipcMain.handle("asientos:deFactura", (_e, facturaId: number) => {
    const factura = db.prepare(`SELECT ncf FROM facturas WHERE id = ?`).get(facturaId) as { ncf: string | null } | undefined;
    if (!factura) return [];
    const asientos = db
      .prepare(
        `SELECT * FROM asientos
         WHERE referencia_id = @id
           AND (origen IN ('FACTURA', 'COBRO') OR (origen = 'AJUSTE' AND concepto LIKE @patron))
         ORDER BY numero`
      )
      .all({ id: facturaId, patron: factura.ncf ? `%factura ${factura.ncf}%` : "%factura%" }) as any[];
    const lineaStmt = db.prepare(
      `SELECT al.id, al.cuenta_id, al.debito, al.credito, al.descripcion, c.codigo as cuenta_codigo, c.nombre as cuenta_nombre
       FROM asiento_lineas al JOIN cuentas_contables c ON c.id = al.cuenta_id
       WHERE al.asiento_id = ? ORDER BY al.id`
    );
    return asientos.map((a) => ({ ...a, lineas: lineaStmt.all(a.id) })) as AsientoConLineas[];
  });
}
