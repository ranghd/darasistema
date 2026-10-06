import { ipcMain } from "electron";
import type { DB } from "../db/sqlite";

function rangoClause(desde?: string, hasta?: string) {
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
  return { clause: where.length ? `AND ${where.join(" AND ")}` : "", params };
}

export function registerReportesIpc(db: DB) {
  ipcMain.handle("reportes:estadoResultados", (_e, desde?: string, hasta?: string) => {
    const { clause, params } = rangoClause(desde, hasta);
    const porTipo = db
      .prepare(
        `SELECT c.tipo,
                SUM(CASE WHEN c.naturaleza = 'ACREEDORA' THEN al.credito - al.debito ELSE al.debito - al.credito END) as monto
         FROM cuentas_contables c
         JOIN asiento_lineas al ON al.cuenta_id = c.id
         JOIN asientos a ON a.id = al.asiento_id
         WHERE c.tipo IN ('INGRESOS','COSTOS','GASTOS') ${clause}
         GROUP BY c.tipo`
      )
      .all(params) as { tipo: string; monto: number }[];

    const detalle = db
      .prepare(
        `SELECT c.codigo, c.nombre, c.tipo,
                SUM(CASE WHEN c.naturaleza = 'ACREEDORA' THEN al.credito - al.debito ELSE al.debito - al.credito END) as monto
         FROM cuentas_contables c
         JOIN asiento_lineas al ON al.cuenta_id = c.id
         JOIN asientos a ON a.id = al.asiento_id
         WHERE c.tipo IN ('INGRESOS','COSTOS','GASTOS') ${clause}
         GROUP BY c.id
         HAVING monto != 0
         ORDER BY c.codigo`
      )
      .all(params);

    const ingresos = porTipo.find((p) => p.tipo === "INGRESOS")?.monto ?? 0;
    const costos = porTipo.find((p) => p.tipo === "COSTOS")?.monto ?? 0;
    const gastos = porTipo.find((p) => p.tipo === "GASTOS")?.monto ?? 0;

    return {
      ingresos,
      costos,
      utilidadBruta: ingresos - costos,
      gastos,
      utilidadNeta: ingresos - costos - gastos,
      detalle,
    };
  });

  ipcMain.handle("reportes:balanceGeneral", (_e, hasta?: string) => {
    const { clause, params } = rangoClause(undefined, hasta);
    const rows = db
      .prepare(
        `SELECT c.codigo, c.nombre, c.tipo,
                SUM(CASE WHEN c.naturaleza = 'DEUDORA' THEN al.debito - al.credito ELSE al.credito - al.debito END) as saldo
         FROM cuentas_contables c
         JOIN asiento_lineas al ON al.cuenta_id = c.id
         JOIN asientos a ON a.id = al.asiento_id
         WHERE c.tipo IN ('ACTIVO','PASIVO','PATRIMONIO') ${clause}
         GROUP BY c.id
         HAVING saldo != 0
         ORDER BY c.codigo`
      )
      .all(params) as { codigo: string; nombre: string; tipo: string; saldo: number }[];

    const resultadoNeto = db
      .prepare(
        `SELECT SUM(CASE WHEN c.tipo = 'INGRESOS' THEN al.credito - al.debito
                         WHEN c.tipo IN ('COSTOS','GASTOS') THEN -(al.debito - al.credito)
                         ELSE 0 END) as monto
         FROM cuentas_contables c
         JOIN asiento_lineas al ON al.cuenta_id = c.id
         JOIN asientos a ON a.id = al.asiento_id
         WHERE c.tipo IN ('INGRESOS','COSTOS','GASTOS') ${clause}`
      )
      .get(params) as { monto: number | null };

    const activo = rows.filter((r) => r.tipo === "ACTIVO");
    const pasivo = rows.filter((r) => r.tipo === "PASIVO");
    const patrimonio = rows.filter((r) => r.tipo === "PATRIMONIO");

    return {
      activo,
      pasivo,
      patrimonio,
      utilidadDelPeriodo: resultadoNeto.monto ?? 0,
      totalActivo: activo.reduce((s, r) => s + r.saldo, 0),
      totalPasivo: pasivo.reduce((s, r) => s + r.saldo, 0),
      totalPatrimonio: patrimonio.reduce((s, r) => s + r.saldo, 0) + (resultadoNeto.monto ?? 0),
    };
  });

  ipcMain.handle("reportes:itbis", (_e, desde?: string, hasta?: string) => {
    const where: string[] = [];
    const params: Record<string, string> = {};
    if (desde) {
      where.push("f.fecha >= @desde");
      params.desde = desde;
    }
    if (hasta) {
      where.push("f.fecha <= @hasta");
      params.hasta = hasta;
    }
    where.push("f.estado != 'ANULADA'");
    const clause = `WHERE ${where.join(" AND ")}`;

    const resumen = db
      .prepare(
        `SELECT COUNT(*) as cantidad_facturas, COALESCE(SUM(f.subtotal),0) as subtotal, COALESCE(SUM(f.itbis),0) as itbis, COALESCE(SUM(f.total),0) as total
         FROM facturas f ${clause}`
      )
      .get(params);

    const facturas = db
      .prepare(
        `SELECT f.numero, f.ncf, f.fecha, c.nombre as cliente_nombre, f.subtotal, f.itbis, f.total
         FROM facturas f JOIN clientes c ON c.id = f.cliente_id ${clause} ORDER BY f.fecha`
      )
      .all(params);

    return { resumen, facturas };
  });

  ipcMain.handle("reportes:cuentasPorCobrar", () => {
    return db
      .prepare(
        `SELECT f.id, f.numero, f.ncf, f.fecha, c.nombre as cliente_nombre, f.total,
                COALESCE((SELECT SUM(monto) FROM cobros WHERE factura_id = f.id), 0) as cobrado,
                CAST(julianday('now') - julianday(f.fecha) as INTEGER) as dias
         FROM facturas f JOIN clientes c ON c.id = f.cliente_id
         WHERE f.condicion_pago = 'CREDITO' AND f.estado = 'PENDIENTE'
         ORDER BY f.fecha`
      )
      .all();
  });

  ipcMain.handle("reportes:dashboard", () => {
    const hoy = new Date().toISOString().slice(0, 10);
    const inicioMes = hoy.slice(0, 7) + "-01";

    const ventasMes = db
      .prepare(`SELECT COALESCE(SUM(total), 0) as t FROM facturas WHERE fecha >= ? AND estado != 'ANULADA'`)
      .get(inicioMes) as { t: number };

    const porCobrar = db
      .prepare(
        `SELECT COALESCE(SUM(total - cobrado), 0) as t FROM (
           SELECT f.total, COALESCE((SELECT SUM(monto) FROM cobros WHERE factura_id = f.id), 0) as cobrado
           FROM facturas f WHERE f.condicion_pago = 'CREDITO' AND f.estado = 'PENDIENTE'
         )`
      )
      .get() as { t: number };

    const facturasHoy = db.prepare(`SELECT COUNT(*) as c FROM facturas WHERE fecha = ?`).get(hoy) as { c: number };

    const envasesCirculando = db
      .prepare(`SELECT COALESCE(SUM(cantidad), 0) as c FROM envases_cliente`)
      .get() as { c: number };

    const productosBajoStock = db
      .prepare(`SELECT codigo, nombre, existencia FROM productos WHERE existencia <= 10 AND activo = 1 ORDER BY existencia`)
      .all();

    return {
      ventasMes: ventasMes.t,
      porCobrar: porCobrar.t,
      facturasHoy: facturasHoy.c,
      envasesCirculando: envasesCirculando.c,
      productosBajoStock,
    };
  });
}
