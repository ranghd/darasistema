import { ipcMain } from "electron";
import type { DB } from "../db/types";
import { fechaHoyRD } from "../db/contabilidad";
import type { CxcCliente, ReporteVentas } from "../shared/types";

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
        `SELECT f.id, f.numero, f.ncf, f.fecha, f.cliente_id, c.nombre as cliente_nombre, f.total,
                COALESCE((SELECT SUM(monto) FROM cobros WHERE factura_id = f.id), 0) as cobrado,
                CAST(julianday(@hoy) - julianday(f.fecha) as INTEGER) as dias
         FROM facturas f JOIN clientes c ON c.id = f.cliente_id
         WHERE f.condicion_pago = 'CREDITO' AND f.estado = 'PENDIENTE'
         ORDER BY f.fecha`
      )
      .all({ hoy: fechaHoyRD() });
  });

  // Lo que debe cada cliente en total, repartido por antiguedad de sus facturas.
  ipcMain.handle("reportes:cxcPorCliente", (): CxcCliente[] => {
    return db
      .prepare(
        `SELECT cliente_id, cliente_nombre, telefono, COUNT(*) AS facturas,
                ROUND(SUM(saldo), 2) AS total_adeudado,
                ROUND(SUM(CASE WHEN dias <= 30 THEN saldo ELSE 0 END), 2) AS b0_30,
                ROUND(SUM(CASE WHEN dias BETWEEN 31 AND 60 THEN saldo ELSE 0 END), 2) AS b31_60,
                ROUND(SUM(CASE WHEN dias BETWEEN 61 AND 90 THEN saldo ELSE 0 END), 2) AS b61_90,
                ROUND(SUM(CASE WHEN dias > 90 THEN saldo ELSE 0 END), 2) AS b90,
                MAX(dias) AS dias_max, MAX(fecha) AS ultima_factura
         FROM (
           SELECT f.cliente_id, c.nombre AS cliente_nombre, c.telefono, f.fecha,
                  f.total - COALESCE((SELECT SUM(monto) FROM cobros WHERE factura_id = f.id), 0) AS saldo,
                  CAST(julianday(@hoy) - julianday(f.fecha) AS INTEGER) AS dias
           FROM facturas f JOIN clientes c ON c.id = f.cliente_id
           WHERE f.condicion_pago = 'CREDITO' AND f.estado = 'PENDIENTE'
         )
         WHERE saldo > 0.005
         GROUP BY cliente_id
         ORDER BY total_adeudado DESC`
      )
      .all({ hoy: fechaHoyRD() }) as CxcCliente[];
  });

  // Reporte de ventas de un periodo: resumen general, por producto, por vendedor, por cliente y por dia.
  ipcMain.handle("reportes:ventas", (_e, desde?: string, hasta?: string): ReporteVentas => {
    const hoy = fechaHoyRD();
    const d = desde || hoy.slice(0, 7) + "-01";
    const h = hasta || hoy;
    const p = { desde: d, hasta: h };
    const valida = `f.fecha BETWEEN @desde AND @hasta AND f.estado != 'ANULADA'`;
    const r2 = (n: number | null | undefined) => Math.round((n ?? 0) * 100) / 100;

    const tot = db
      .prepare(
        `SELECT COUNT(*) AS facturas, SUM(f.subtotal) AS subtotal, SUM(f.itbis) AS itbis, SUM(f.fianza_total) AS fianzas, SUM(f.total) AS total,
                SUM(CASE WHEN f.condicion_pago = 'CONTADO' THEN f.total ELSE 0 END) AS contado,
                SUM(CASE WHEN f.condicion_pago = 'CREDITO' THEN f.total ELSE 0 END) AS credito,
                SUM(CASE WHEN f.condicion_pago = 'CONTADO' AND COALESCE(f.metodo_pago, 'EFECTIVO') = 'EFECTIVO' THEN f.total ELSE 0 END) AS efectivo,
                SUM(CASE WHEN f.condicion_pago = 'CONTADO' AND f.metodo_pago = 'TARJETA' THEN f.total ELSE 0 END) AS tarjeta,
                SUM(CASE WHEN f.condicion_pago = 'CONTADO' AND f.metodo_pago = 'TRANSFERENCIA' THEN f.total ELSE 0 END) AS transferencia,
                SUM(CASE WHEN f.condicion_pago = 'CONTADO' AND f.metodo_pago = 'CHEQUE' THEN f.total ELSE 0 END) AS cheque,
                COUNT(DISTINCT f.cliente_id) AS clientes
         FROM facturas f WHERE ${valida}`
      )
      .get(p) as any;
    const extra = db
      .prepare(
        `SELECT SUM(fl.descuento) AS descuentos, SUM(fl.cantidad * p.costo_contenido) AS costo
         FROM factura_lineas fl JOIN facturas f ON f.id = fl.factura_id JOIN productos p ON p.id = fl.producto_id WHERE ${valida}`
      )
      .get(p) as any;
    const anuladas = db
      .prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS t FROM facturas WHERE fecha BETWEEN @desde AND @hasta AND estado = 'ANULADA'`)
      .get(p) as { n: number; t: number };

    const porProducto = (
      db
        .prepare(
          `SELECT p.id AS producto_id, p.codigo, p.nombre, p.categoria, SUM(fl.cantidad) AS cantidad, SUM(fl.subtotal) AS venta,
                  SUM(fl.itbis) AS itbis, SUM(fl.descuento) AS descuentos, SUM(fl.cantidad * p.costo_contenido) AS costo
           FROM factura_lineas fl JOIN facturas f ON f.id = fl.factura_id JOIN productos p ON p.id = fl.producto_id
           WHERE ${valida} GROUP BY p.id ORDER BY venta DESC`
        )
        .all(p) as any[]
    ).map((x) => ({ ...x, venta: r2(x.venta), itbis: r2(x.itbis), costo: r2(x.costo), ganancia: r2(x.venta - x.costo) }));

    const porVendedor = db
      .prepare(
        `SELECT COALESCE(NULLIF(TRIM(f.creado_por), ''), 'Sin vendedor') AS vendedor, COUNT(*) AS facturas,
                ROUND(SUM(f.subtotal), 2) AS subtotal, ROUND(SUM(f.total), 2) AS total,
                ROUND(SUM(f.total) / COUNT(*), 2) AS promedio
         FROM facturas f WHERE ${valida} GROUP BY vendedor ORDER BY total DESC`
      )
      .all(p);

    const porCliente = db
      .prepare(
        `SELECT c.id AS cliente_id, c.nombre, COUNT(*) AS facturas, ROUND(SUM(f.subtotal), 2) AS subtotal, ROUND(SUM(f.total), 2) AS total
         FROM facturas f JOIN clientes c ON c.id = f.cliente_id WHERE ${valida} GROUP BY c.id ORDER BY total DESC`
      )
      .all(p);

    const porDia = db
      .prepare(
        `SELECT f.fecha, COUNT(*) AS facturas, ROUND(SUM(f.subtotal), 2) AS subtotal, ROUND(SUM(f.itbis), 2) AS itbis, ROUND(SUM(f.total), 2) AS total
         FROM facturas f WHERE ${valida} GROUP BY f.fecha ORDER BY f.fecha`
      )
      .all(p);

    const subtotal = r2(tot.subtotal);
    const costo = r2(extra.costo);
    return {
      desde: d,
      hasta: h,
      resumen: {
        facturas: tot.facturas ?? 0,
        clientes: tot.clientes ?? 0,
        subtotal,
        descuentos: r2(extra.descuentos),
        itbis: r2(tot.itbis),
        fianzas: r2(tot.fianzas),
        total: r2(tot.total),
        contado: r2(tot.contado),
        credito: r2(tot.credito),
        efectivo: r2(tot.efectivo),
        tarjeta: r2(tot.tarjeta),
        transferencia: r2(tot.transferencia),
        cheque: r2(tot.cheque),
        promedio: tot.facturas ? r2(tot.total / tot.facturas) : 0,
        costo,
        ganancia: r2(subtotal - costo),
        anuladas: anuladas.n,
        total_anulado: r2(anuladas.t),
      },
      porProducto,
      porVendedor,
      porCliente,
      porDia,
    } as ReporteVentas;
  });

  ipcMain.handle("reportes:dashboard", () => {
    const hoy = fechaHoyRD();
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
