import { ipcMain } from "electron";
import type { DB } from "../db/types";
import { asegurarCuenta, crearAsiento, cuentaDeBanco, fechaHoyRD } from "../db/contabilidad";
import { buscarOCrearProveedor } from "../db/proveedores";
import type { CxpDocumento, CxpSuplidor, Gasto, GastoDetalle, NuevoGastoInput, PagoGasto, ResumenGastoTipo, TipoGasto } from "../shared/types";

const CODIGO_CAJA = "1.1.01";
const CODIGO_CXP = "2.1.01";
const NOMBRE_ITBIS_COMPRAS = "ITBIS Pagado en Compras (por compensar)";
const METODOS = ["EFECTIVO", "TRANSFERENCIA", "TARJETA", "CHEQUE"];

const r2 = (n: number) => Math.round(n * 100) / 100;

function cuentaIdPorCodigo(db: DB, codigo: string): number {
  const row = db.prepare(`SELECT id FROM cuentas_contables WHERE codigo = ?`).get(codigo) as { id: number } | undefined;
  if (!row) throw new Error(`Cuenta contable ${codigo} no existe`);
  return row.id;
}

function cuentaItbisCompras(db: DB): number {
  return asegurarCuenta(db, { codigo: "1.1.08", nombre: NOMBRE_ITBIS_COMPRAS, tipo: "ACTIVO", naturaleza: "DEUDORA", padreCodigo: "1.1" });
}

// De donde sale el dinero de un pago: la gaveta (efectivo) o el banco elegido.
function cuentaDelPago(db: DB, metodo: string, bancoId?: number | null): { cuenta_id: number; banco_id: number | null } {
  if (!METODOS.includes(metodo)) throw new Error("Metodo de pago no valido");
  if (metodo === "EFECTIVO") return { cuenta_id: cuentaIdPorCodigo(db, CODIGO_CAJA), banco_id: null };
  return cuentaDeBanco(db, bancoId);
}

const SELECT_GASTO = `
  SELECT g.*, t.nombre AS tipo_nombre, cc.codigo AS cuenta_codigo, cc.nombre AS cuenta_nombre,
         COALESCE((SELECT SUM(monto) FROM pagos_gasto WHERE gasto_id = g.id), 0) AS pagado
  FROM gastos g JOIN tipos_gasto t ON t.id = g.tipo_gasto_id JOIN cuentas_contables cc ON cc.id = t.cuenta_id`;

function obtenerGasto(db: DB, id: number): GastoDetalle | undefined {
  const g = db.prepare(`${SELECT_GASTO} WHERE g.id = ?`).get(id) as Gasto | undefined;
  if (!g) return undefined;
  const pagos = db
    .prepare(`SELECT pg.*, b.nombre AS banco_nombre FROM pagos_gasto pg LEFT JOIN bancos b ON b.id = pg.banco_id WHERE pg.gasto_id = ? ORDER BY pg.fecha, pg.id`)
    .all(id) as PagoGasto[];
  return { ...g, saldo: r2(g.total - (g.pagado ?? 0)), pagos };
}

export function registerGastosIpc(db: DB) {
  // ---------- Tipos de gasto ----------

  ipcMain.handle("tiposGasto:listar", (): TipoGasto[] => {
    return db
      .prepare(
        `SELECT t.*, c.codigo AS cuenta_codigo, c.nombre AS cuenta_nombre,
                (SELECT COUNT(*) FROM gastos g WHERE g.tipo_gasto_id = t.id AND g.estado != 'ANULADA') AS usos
         FROM tipos_gasto t JOIN cuentas_contables c ON c.id = t.cuenta_id
         ORDER BY t.activo DESC, t.nombre COLLATE NOCASE`
      )
      .all() as TipoGasto[];
  });

  // Sin cuenta elegida se crea una cuenta de gasto nueva con el mismo nombre.
  ipcMain.handle("tiposGasto:crear", (_e, data: { nombre: string; cuenta_id?: number | null }): TipoGasto => {
    const nombre = String(data.nombre ?? "").trim().replace(/\s+/g, " ");
    if (!nombre) throw new Error("Escribe el nombre del tipo de gasto");
    if (db.prepare(`SELECT id FROM tipos_gasto WHERE lower(nombre) = lower(?)`).get(nombre)) throw new Error(`Ya existe el tipo de gasto "${nombre}"`);
    const id = db.transaction(() => {
      let cuentaId = data.cuenta_id ?? null;
      if (cuentaId) {
        const c = db.prepare(`SELECT tipo, es_movimiento FROM cuentas_contables WHERE id = ?`).get(cuentaId) as { tipo: string; es_movimiento: number } | undefined;
        if (!c || !["GASTOS", "COSTOS"].includes(c.tipo) || !c.es_movimiento) throw new Error("Elige una cuenta de gastos que reciba movimientos");
      } else {
        const titulo = nombre.charAt(0).toUpperCase() + nombre.slice(1);
        cuentaId = asegurarCuenta(db, { codigo: "6.1.13", nombre: titulo, tipo: "GASTOS", naturaleza: "DEUDORA", padreCodigo: "6" });
      }
      return Number(db.prepare(`INSERT INTO tipos_gasto (nombre, cuenta_id) VALUES (?, ?)`).run(nombre, cuentaId).lastInsertRowid);
    })();
    return db.prepare(`SELECT t.*, c.codigo AS cuenta_codigo, c.nombre AS cuenta_nombre FROM tipos_gasto t JOIN cuentas_contables c ON c.id = t.cuenta_id WHERE t.id = ?`).get(id) as TipoGasto;
  });

  ipcMain.handle("tiposGasto:actualizar", (_e, id: number, data: { nombre?: string; activo?: number }): TipoGasto => {
    const actual = db.prepare(`SELECT * FROM tipos_gasto WHERE id = ?`).get(id) as TipoGasto | undefined;
    if (!actual) throw new Error("Tipo de gasto no encontrado");
    const nombre = data.nombre !== undefined ? String(data.nombre).trim().replace(/\s+/g, " ") : actual.nombre;
    if (!nombre) throw new Error("Escribe el nombre del tipo de gasto");
    if (db.prepare(`SELECT id FROM tipos_gasto WHERE lower(nombre) = lower(?) AND id != ?`).get(nombre, id)) throw new Error(`Ya existe el tipo de gasto "${nombre}"`);
    db.prepare(`UPDATE tipos_gasto SET nombre = ?, activo = ? WHERE id = ?`).run(nombre, data.activo ?? actual.activo, id);
    return db.prepare(`SELECT t.*, c.codigo AS cuenta_codigo, c.nombre AS cuenta_nombre FROM tipos_gasto t JOIN cuentas_contables c ON c.id = t.cuenta_id WHERE t.id = ?`).get(id) as TipoGasto;
  });

  // ---------- Facturas de suplidores (gastos) ----------

  ipcMain.handle(
    "gastos:listar",
    (_e, f: { desde?: string; hasta?: string; tipo_gasto_id?: number; proveedor_id?: number; estado?: string } = {}): Gasto[] => {
      const where: string[] = [];
      const p: Record<string, unknown> = {};
      if (f.desde) (where.push("g.fecha >= @desde"), (p.desde = f.desde));
      if (f.hasta) (where.push("g.fecha <= @hasta"), (p.hasta = f.hasta));
      if (f.tipo_gasto_id) (where.push("g.tipo_gasto_id = @tipo"), (p.tipo = f.tipo_gasto_id));
      if (f.proveedor_id) (where.push("g.proveedor_id = @prov"), (p.prov = f.proveedor_id));
      if (f.estado) (where.push("g.estado = @estado"), (p.estado = f.estado));
      return (db.prepare(`${SELECT_GASTO} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY g.fecha DESC, g.numero DESC`).all(p) as Gasto[]).map((g) => ({
        ...g,
        saldo: g.estado === "ANULADA" ? 0 : r2(g.total - (g.pagado ?? 0)),
      }));
    }
  );

  ipcMain.handle("gastos:obtener", (_e, id: number) => obtenerGasto(db, id));

  ipcMain.handle("gastos:crear", (_e, input: NuevoGastoInput): GastoDetalle => {
    const tipo = db
      .prepare(`SELECT t.id, t.nombre, t.cuenta_id FROM tipos_gasto t WHERE t.id = ?`)
      .get(input.tipo_gasto_id) as { id: number; nombre: string; cuenta_id: number } | undefined;
    if (!tipo) throw new Error("Elige el tipo de gasto");
    const subtotal = r2(Number(input.subtotal));
    const itbis = r2(Number(input.itbis || 0));
    if (!(subtotal > 0)) throw new Error("El monto del gasto debe ser mayor a cero");
    if (itbis < 0) throw new Error("El ITBIS no puede ser negativo");
    const total = r2(subtotal + itbis);
    if (!["CONTADO", "CREDITO"].includes(input.condicion_pago)) throw new Error("Indica si se pago al contado o a credito");
    if (!input.fecha) throw new Error("Indica la fecha de la factura");
    const ncf = input.ncf?.trim().toUpperCase() || null;
    if (ncf && !/^[BE]\d{10,12}$/.test(ncf)) throw new Error("El NCF debe ser como B0100000123 o E310000000123");

    const id = db.transaction(() => {
      let proveedorId = input.proveedor_id ?? null;
      let suplidor = "";
      if (proveedorId) {
        const p = db.prepare(`SELECT nombre FROM proveedores WHERE id = ?`).get(proveedorId) as { nombre: string } | undefined;
        if (!p) throw new Error("El suplidor seleccionado no existe");
        suplidor = p.nombre;
      } else {
        suplidor = String(input.suplidor ?? "").trim();
        if (!suplidor) throw new Error("Escribe el nombre del suplidor");
        proveedorId = buscarOCrearProveedor(db, suplidor);
        suplidor = (db.prepare(`SELECT nombre FROM proveedores WHERE id = ?`).get(proveedorId) as { nombre: string }).nombre;
      }
      const rnc = input.rnc?.trim() || (db.prepare(`SELECT rnc FROM proveedores WHERE id = ?`).get(proveedorId) as { rnc: string | null }).rnc || null;
      if (input.rnc?.trim()) db.prepare(`UPDATE proveedores SET rnc = COALESCE(NULLIF(rnc, ''), ?) WHERE id = ?`).run(input.rnc.trim(), proveedorId);
      if (ncf && db.prepare(`SELECT id FROM gastos WHERE proveedor_id = ? AND ncf = ? AND estado != 'ANULADA'`).get(proveedorId, ncf)) {
        throw new Error(`Ya registraste la factura ${ncf} de ${suplidor}`);
      }

      const numero = (db.prepare(`SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM gastos`).get() as { n: number }).n;
      const contado = input.condicion_pago === "CONTADO";
      const pago = contado ? cuentaDelPago(db, input.metodo ?? "EFECTIVO", input.banco_id) : null;
      const concepto = `Gasto #${numero} - ${tipo.nombre} - ${suplidor}${ncf ? ` (NCF ${ncf})` : ""}`;
      const lineas = [{ cuenta_id: tipo.cuenta_id, debito: subtotal, credito: 0, descripcion: input.concepto?.trim() || tipo.nombre }];
      if (itbis > 0) lineas.push({ cuenta_id: cuentaItbisCompras(db), debito: itbis, credito: 0, descripcion: `ITBIS ${ncf ?? `gasto #${numero}`}` });
      lineas.push({
        cuenta_id: pago ? pago.cuenta_id : cuentaIdPorCodigo(db, CODIGO_CXP),
        debito: 0,
        credito: total,
        descripcion: pago ? (input.referencia ? `Pago gasto #${numero} ref. ${input.referencia}` : `Pago gasto #${numero}`) : `Por pagar a ${suplidor}`,
      });
      const asientoId = crearAsiento(db, { fecha: input.fecha, concepto, origen: "AJUSTE", lineas });

      const gastoId = Number(
        db
          .prepare(
            `INSERT INTO gastos (numero, fecha, vence, proveedor_id, suplidor, rnc, ncf, tipo_gasto_id, concepto, subtotal, itbis, total, condicion_pago, estado, asiento_id, creado_por)
             VALUES (@numero, @fecha, @vence, @proveedor_id, @suplidor, @rnc, @ncf, @tipo, @concepto, @subtotal, @itbis, @total, @condicion, @estado, @asiento_id, @creado_por)`
          )
          .run({
            numero,
            fecha: input.fecha,
            vence: contado ? null : input.vence || null,
            proveedor_id: proveedorId,
            suplidor,
            rnc,
            ncf,
            tipo: tipo.id,
            concepto: input.concepto?.trim() || null,
            subtotal,
            itbis,
            total,
            condicion: input.condicion_pago,
            estado: contado ? "PAGADA" : "PENDIENTE",
            asiento_id: asientoId,
            creado_por: input.creado_por?.trim() || null,
          }).lastInsertRowid
      );
      if (pago) {
        db.prepare(
          `INSERT INTO pagos_gasto (gasto_id, fecha, monto, metodo, banco_id, referencia, asiento_id) VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(gastoId, input.fecha, total, input.metodo ?? "EFECTIVO", pago.banco_id, input.referencia?.trim() || null, asientoId);
      }
      return gastoId;
    })();
    return obtenerGasto(db, id)!;
  });

  ipcMain.handle(
    "pagosGasto:crear",
    (_e, input: { gasto_id: number; fecha: string; monto: number; metodo: string; banco_id?: number | null; referencia?: string }): GastoDetalle => {
      const g = obtenerGasto(db, input.gasto_id);
      if (!g) throw new Error("Gasto no encontrado");
      if (g.estado === "ANULADA") throw new Error("Este gasto esta anulado");
      if (g.estado === "PAGADA") throw new Error("Este gasto ya esta pagado");
      const monto = r2(Number(input.monto));
      if (!(monto > 0)) throw new Error("El monto debe ser mayor a cero");
      if (monto > g.saldo + 0.005) throw new Error(`El monto excede lo que se debe (RD$ ${g.saldo.toFixed(2)})`);
      const pago = cuentaDelPago(db, input.metodo, input.banco_id);
      db.transaction(() => {
        const asientoId = crearAsiento(db, {
          fecha: input.fecha,
          concepto: `Pago gasto #${g.numero} - ${g.suplidor}${g.ncf ? ` (NCF ${g.ncf})` : ""}`,
          origen: "AJUSTE",
          lineas: [
            { cuenta_id: cuentaIdPorCodigo(db, CODIGO_CXP), debito: monto, credito: 0 },
            { cuenta_id: pago.cuenta_id, debito: 0, credito: monto, descripcion: input.referencia ? `Pago gasto #${g.numero} ref. ${input.referencia}` : `Pago gasto #${g.numero}` },
          ],
        });
        db.prepare(`INSERT INTO pagos_gasto (gasto_id, fecha, monto, metodo, banco_id, referencia, asiento_id) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
          g.id,
          input.fecha,
          monto,
          input.metodo,
          pago.banco_id,
          input.referencia?.trim() || null,
          asientoId
        );
        if (monto >= g.saldo - 0.005) db.prepare(`UPDATE gastos SET estado = 'PAGADA' WHERE id = ?`).run(g.id);
      })();
      return obtenerGasto(db, g.id)!;
    }
  );

  // Anular revierte en la contabilidad el gasto y sus pagos (queda la huella, no se borra).
  ipcMain.handle("gastos:anular", (_e, id: number, motivo: string): GastoDetalle => {
    const g = obtenerGasto(db, id);
    if (!g) throw new Error("Gasto no encontrado");
    if (g.estado === "ANULADA") throw new Error("Este gasto ya esta anulado");
    if (!motivo?.trim()) throw new Error("Escribe el motivo de la anulacion");
    const asientos = [g.asiento_id, ...g.pagos.map((p) => p.asiento_id)].filter((a, i, arr): a is number => !!a && arr.indexOf(a) === i);
    db.transaction(() => {
      for (const asientoId of asientos) {
        const lineas = db.prepare(`SELECT cuenta_id, debito, credito, descripcion FROM asiento_lineas WHERE asiento_id = ?`).all(asientoId) as any[];
        crearAsiento(db, {
          fecha: fechaHoyRD(),
          concepto: `Anulacion gasto #${g.numero} - ${motivo.trim()}`,
          origen: "AJUSTE",
          lineas: lineas.map((l) => ({ cuenta_id: l.cuenta_id, debito: l.credito, credito: l.debito, descripcion: `Anula: ${l.descripcion ?? ""}`.trim() })),
        });
      }
      db.prepare(`UPDATE gastos SET estado = 'ANULADA', concepto = TRIM(COALESCE(concepto, '') || ' [Anulado: ' || ? || ']') WHERE id = ?`).run(motivo.trim(), id);
    })();
    return obtenerGasto(db, id)!;
  });

  // Cuanto se gasto en cada tipo de gasto en un periodo.
  ipcMain.handle("gastos:resumenPorTipo", (_e, desde?: string, hasta?: string): ResumenGastoTipo[] => {
    const hoy = fechaHoyRD();
    return db
      .prepare(
        `SELECT t.id AS tipo_gasto_id, t.nombre, c.codigo AS cuenta_codigo, COUNT(g.id) AS cantidad,
                ROUND(COALESCE(SUM(g.subtotal), 0), 2) AS subtotal, ROUND(COALESCE(SUM(g.itbis), 0), 2) AS itbis, ROUND(COALESCE(SUM(g.total), 0), 2) AS total,
                ROUND(COALESCE(SUM(CASE WHEN g.estado = 'PENDIENTE' THEN g.total - COALESCE((SELECT SUM(monto) FROM pagos_gasto WHERE gasto_id = g.id), 0) ELSE 0 END), 0), 2) AS pendiente
         FROM tipos_gasto t JOIN cuentas_contables c ON c.id = t.cuenta_id
         JOIN gastos g ON g.tipo_gasto_id = t.id AND g.estado != 'ANULADA' AND g.fecha BETWEEN @desde AND @hasta
         GROUP BY t.id ORDER BY total DESC`
      )
      .all({ desde: desde || hoy.slice(0, 7) + "-01", hasta: hasta || hoy }) as ResumenGastoTipo[];
  });

  // ---------- Cuentas por pagar (mercancia + gastos a credito) ----------

  ipcMain.handle("cxp:documentos", (): CxpDocumento[] => cxpDocumentos(db));

  ipcMain.handle("cxp:porSuplidor", (): CxpSuplidor[] => {
    const grupos = new Map<string, CxpSuplidor>();
    for (const d of cxpDocumentos(db)) {
      const clave = d.proveedor_id ? `p${d.proveedor_id}` : `n${d.suplidor.toLowerCase()}`;
      const g =
        grupos.get(clave) ??
        ({ proveedor_id: d.proveedor_id, suplidor: d.suplidor, documentos: 0, total_adeudado: 0, b0_30: 0, b31_60: 0, b61_90: 0, b90: 0, dias_max: 0 } as CxpSuplidor);
      g.documentos++;
      g.total_adeudado = r2(g.total_adeudado + d.saldo);
      const tramo = d.dias <= 30 ? "b0_30" : d.dias <= 60 ? "b31_60" : d.dias <= 90 ? "b61_90" : "b90";
      g[tramo] = r2(g[tramo] + d.saldo);
      g.dias_max = Math.max(g.dias_max, d.dias);
      grupos.set(clave, g);
    }
    return [...grupos.values()].sort((a, b) => b.total_adeudado - a.total_adeudado);
  });
}

function cxpDocumentos(db: DB): CxpDocumento[] {
  const hoy = fechaHoyRD();
  return (
    db
      .prepare(
        `SELECT 'COMPRA' AS origen, c.id, c.numero, c.fecha, NULL AS vence, c.proveedor_id, COALESCE(pr.nombre, c.proveedor) AS suplidor,
                c.ncf, 'Mercancia' AS detalle, c.total,
                COALESCE((SELECT SUM(monto) FROM pagos_compra WHERE compra_id = c.id), 0) AS pagado,
                CAST(julianday(@hoy) - julianday(c.fecha) AS INTEGER) AS dias
         FROM compras c LEFT JOIN proveedores pr ON pr.id = c.proveedor_id
         WHERE c.condicion_pago = 'CREDITO' AND c.estado = 'PENDIENTE'
         UNION ALL
         SELECT 'GASTO' AS origen, g.id, g.numero, g.fecha, g.vence, g.proveedor_id, COALESCE(pr.nombre, g.suplidor) AS suplidor,
                g.ncf, t.nombre AS detalle, g.total,
                COALESCE((SELECT SUM(monto) FROM pagos_gasto WHERE gasto_id = g.id), 0) AS pagado,
                CAST(julianday(@hoy) - julianday(g.fecha) AS INTEGER) AS dias
         FROM gastos g JOIN tipos_gasto t ON t.id = g.tipo_gasto_id LEFT JOIN proveedores pr ON pr.id = g.proveedor_id
         WHERE g.condicion_pago = 'CREDITO' AND g.estado = 'PENDIENTE'
         ORDER BY fecha`
      )
      .all({ hoy }) as any[]
  )
    .map((d) => ({ ...d, saldo: r2(d.total - d.pagado) }))
    .filter((d) => d.saldo > 0.005) as CxpDocumento[];
}
