import { ipcMain } from "electron";
import type { DB } from "../db/types";
import { asegurarCuenta, crearAsiento, fechaHoyRD } from "../db/contabilidad";
import type { Banco, DatosConciliacion, LineaLibroBanco, MovimientoBanco, MovimientoBancoInput, ResultadoImportacion } from "../shared/types";

const r2 = (n: number) => Math.round(n * 100) / 100;
const DIAS_TOLERANCIA = 5;

function banco(db: DB, id: number): Banco {
  const b = db.prepare(`SELECT * FROM bancos WHERE id = ?`).get(id) as Banco | undefined;
  if (!b) throw new Error("Banco no encontrado");
  return b;
}

// Movimientos que la contabilidad tiene en la cuenta del banco. La referencia sale
// del cobro, recibo o pago que genero el asiento (si se anoto).
function lineasLibro(db: DB, cuentaId: number, desde?: string, hasta?: string): LineaLibroBanco[] {
  const where = ["al.cuenta_id = @cuenta"];
  const p: Record<string, unknown> = { cuenta: cuentaId };
  if (desde) (where.push("a.fecha >= @desde"), (p.desde = desde));
  if (hasta) (where.push("a.fecha <= @hasta"), (p.hasta = hasta));
  return (
    db
      .prepare(
        `SELECT al.id, a.id AS asiento_id, a.numero AS asiento_numero, a.fecha, a.concepto, al.descripcion,
                ROUND(al.debito - al.credito, 2) AS monto, bm.id AS movimiento_id,
                COALESCE((SELECT referencia FROM recibos_cobro WHERE asiento_id = a.id),
                         (SELECT referencia FROM cobros WHERE asiento_id = a.id AND referencia IS NOT NULL LIMIT 1),
                         (SELECT referencia FROM pagos_gasto WHERE asiento_id = a.id AND referencia IS NOT NULL LIMIT 1),
                         (SELECT referencia FROM pagos_compra WHERE asiento_id = a.id AND referencia IS NOT NULL LIMIT 1)) AS referencia
         FROM asiento_lineas al JOIN asientos a ON a.id = al.asiento_id
         LEFT JOIN banco_movimientos bm ON bm.asiento_linea_id = al.id
         WHERE ${where.join(" AND ")}
         ORDER BY a.fecha, a.numero, al.id`
      )
      .all(p) as LineaLibroBanco[]
  ).filter((l) => Math.abs(l.monto) >= 0.005);
}

const diasEntre = (a: string, b: string) => Math.abs((Date.parse(a) - Date.parse(b)) / 86400000);
const normalizar = (t: string | null | undefined) => (t ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Empareja cada linea del banco con un movimiento del sistema del mismo monto y fecha cercana.
// Si el banco menciona la referencia que se anoto al cobrar, esa gana.
function autoConciliar(db: DB, bancoId: number): number {
  const b = banco(db, bancoId);
  const movs = db.prepare(`SELECT * FROM banco_movimientos WHERE banco_id = ? AND asiento_linea_id IS NULL ORDER BY fecha, id`).all(bancoId) as MovimientoBanco[];
  if (movs.length === 0) return 0;
  const libres = lineasLibro(db, b.cuenta_id).filter((l) => !l.movimiento_id);
  const enlazar = db.prepare(`UPDATE banco_movimientos SET asiento_linea_id = ? WHERE id = ?`);
  let n = 0;
  for (const m of movs) {
    const textoBanco = normalizar(`${m.descripcion} ${m.referencia}`);
    let mejor: { l: LineaLibroBanco; puntos: number } | null = null;
    for (const l of libres) {
      if (Math.abs(l.monto - m.monto) > 0.009) continue;
      const dias = diasEntre(l.fecha, m.fecha);
      if (dias > DIAS_TOLERANCIA) continue;
      const ref = normalizar(l.referencia);
      const puntos = (ref.length >= 4 && textoBanco.includes(ref) ? 100 : 0) - dias;
      if (!mejor || puntos > mejor.puntos) mejor = { l, puntos };
    }
    if (mejor) {
      enlazar.run(mejor.l.id, m.id);
      libres.splice(libres.indexOf(mejor.l), 1);
      n++;
    }
  }
  return n;
}

export function registerBancosIpc(db: DB) {
  ipcMain.handle("bancos:listar", (): Banco[] => {
    return db
      .prepare(
        `SELECT b.*, c.codigo AS cuenta_codigo, c.nombre AS cuenta_nombre,
                ROUND(COALESCE((SELECT SUM(debito - credito) FROM asiento_lineas WHERE cuenta_id = b.cuenta_id), 0), 2) AS saldo_libros,
                (SELECT COUNT(*) FROM banco_movimientos m WHERE m.banco_id = b.id AND m.asiento_linea_id IS NULL) AS sin_conciliar,
                (SELECT MAX(fecha) FROM banco_movimientos m WHERE m.banco_id = b.id) AS ultimo_estado
         FROM bancos b JOIN cuentas_contables c ON c.id = b.cuenta_id
         ORDER BY b.activo DESC, b.id`
      )
      .all() as Banco[];
  });

  ipcMain.handle("bancos:crear", (_e, data: { nombre: string; numero_cuenta?: string }): Banco => {
    const nombre = String(data.nombre ?? "").trim().replace(/\s+/g, " ");
    if (!nombre) throw new Error("Escribe el nombre del banco");
    if (db.prepare(`SELECT id FROM bancos WHERE lower(nombre) = lower(?)`).get(nombre)) throw new Error(`Ya existe el banco "${nombre}"`);
    const id = db.transaction(() => {
      const nombreCuenta = /^banco\b/i.test(nombre) ? nombre : `Banco ${nombre}`;
      const cuentaId = asegurarCuenta(db, { codigo: "1.1.20", nombre: nombreCuenta, tipo: "ACTIVO", naturaleza: "DEUDORA", padreCodigo: "1.1" });
      if (db.prepare(`SELECT id FROM bancos WHERE cuenta_id = ?`).get(cuentaId)) throw new Error(`La cuenta "${nombreCuenta}" ya es de otro banco`);
      return Number(db.prepare(`INSERT INTO bancos (nombre, numero_cuenta, cuenta_id) VALUES (?, ?, ?)`).run(nombre, data.numero_cuenta?.trim() || null, cuentaId).lastInsertRowid);
    })();
    return banco(db, id);
  });

  ipcMain.handle("bancos:actualizar", (_e, id: number, data: { nombre?: string; numero_cuenta?: string; activo?: number }): Banco => {
    const b = banco(db, id);
    const nombre = data.nombre !== undefined ? String(data.nombre).trim() : b.nombre;
    if (!nombre) throw new Error("Escribe el nombre del banco");
    db.prepare(`UPDATE bancos SET nombre = ?, numero_cuenta = ?, activo = ? WHERE id = ?`).run(
      nombre,
      data.numero_cuenta !== undefined ? data.numero_cuenta.trim() || null : b.numero_cuenta,
      data.activo ?? b.activo,
      id
    );
    return banco(db, id);
  });

  ipcMain.handle("conciliacion:datos", (_e, bancoId: number, desde?: string, hasta?: string): DatosConciliacion => {
    const b = banco(db, bancoId);
    const hoy = fechaHoyRD();
    const d = desde || hoy.slice(0, 7) + "-01";
    const h = hasta || hoy;
    const libros = lineasLibro(db, b.cuenta_id, d, h);
    const movimientos = db
      .prepare(
        `SELECT m.*, a.numero AS asiento_numero, a.concepto AS asiento_concepto
         FROM banco_movimientos m LEFT JOIN asiento_lineas al ON al.id = m.asiento_linea_id LEFT JOIN asientos a ON a.id = al.asiento_id
         WHERE m.banco_id = @banco AND m.fecha BETWEEN @desde AND @hasta ORDER BY m.fecha, m.id`
      )
      .all({ banco: bancoId, desde: d, hasta: h }) as MovimientoBanco[];
    const saldoLibros = (db
      .prepare(`SELECT COALESCE(SUM(al.debito - al.credito), 0) AS s FROM asiento_lineas al JOIN asientos a ON a.id = al.asiento_id WHERE al.cuenta_id = ? AND a.fecha <= ?`)
      .get(b.cuenta_id, h) as { s: number }).s;
    const soloBanco = movimientos.filter((m) => !m.asiento_linea_id);
    const soloLibros = libros.filter((l) => !l.movimiento_id);
    return {
      banco: b,
      desde: d,
      hasta: h,
      libros,
      movimientos,
      resumen: {
        saldo_libros: r2(saldoLibros),
        conciliados: movimientos.length - soloBanco.length,
        solo_banco: soloBanco.length,
        solo_banco_monto: r2(soloBanco.reduce((s, m) => s + m.monto, 0)),
        solo_libros: soloLibros.length,
        solo_libros_monto: r2(soloLibros.reduce((s, l) => s + l.monto, 0)),
      },
    };
  });

  ipcMain.handle("conciliacion:importar", (_e, bancoId: number, filas: MovimientoBancoInput[]): ResultadoImportacion => {
    banco(db, bancoId);
    if (!Array.isArray(filas) || filas.length === 0) throw new Error("El estado de cuenta no tiene movimientos");
    const insertar = db.prepare(
      `INSERT OR IGNORE INTO banco_movimientos (banco_id, fecha, descripcion, referencia, monto, huella) VALUES (@banco, @fecha, @descripcion, @referencia, @monto, @huella)`
    );
    let nuevos = 0;
    const vistas = new Map<string, number>();
    db.transaction(() => {
      for (const f of filas) {
        const monto = r2(Number(f.monto));
        if (!/^\d{4}-\d{2}-\d{2}$/.test(f.fecha ?? "") || !Number.isFinite(monto) || monto === 0) continue;
        const descripcion = String(f.descripcion ?? "").trim();
        const referencia = String(f.referencia ?? "").trim();
        // La misma linea repetida en el mismo dia (dos depositos iguales) se cuenta aparte.
        const base = `${f.fecha}|${monto.toFixed(2)}|${descripcion.toLowerCase()}|${referencia.toLowerCase()}`;
        const vez = (vistas.get(base) ?? 0) + 1;
        vistas.set(base, vez);
        const r = insertar.run({ banco: bancoId, fecha: f.fecha, descripcion: descripcion || null, referencia: referencia || null, monto, huella: `${base}|${vez}` });
        if (r.changes) nuevos++;
      }
    })();
    const conciliados = db.transaction(() => autoConciliar(db, bancoId))();
    return { nuevos, repetidos: filas.length - nuevos, conciliados };
  });

  ipcMain.handle("conciliacion:auto", (_e, bancoId: number) => db.transaction(() => autoConciliar(db, bancoId))());

  ipcMain.handle("conciliacion:enlazar", (_e, movimientoId: number, lineaId: number) => {
    const m = db.prepare(`SELECT * FROM banco_movimientos WHERE id = ?`).get(movimientoId) as MovimientoBanco | undefined;
    if (!m) throw new Error("Movimiento del banco no encontrado");
    if (m.asiento_linea_id) throw new Error("Ese movimiento ya esta conciliado");
    const b = banco(db, m.banco_id);
    const l = db.prepare(`SELECT id, cuenta_id, ROUND(debito - credito, 2) AS monto FROM asiento_lineas WHERE id = ?`).get(lineaId) as
      | { id: number; cuenta_id: number; monto: number }
      | undefined;
    if (!l || l.cuenta_id !== b.cuenta_id) throw new Error("Ese movimiento no es de la cuenta de este banco");
    if (Math.abs(l.monto - m.monto) > 0.009) throw new Error("Los montos no son iguales");
    if (db.prepare(`SELECT id FROM banco_movimientos WHERE asiento_linea_id = ?`).get(lineaId)) throw new Error("Ese movimiento del sistema ya esta conciliado con otro");
    db.prepare(`UPDATE banco_movimientos SET asiento_linea_id = ? WHERE id = ?`).run(lineaId, movimientoId);
    return true;
  });

  ipcMain.handle("conciliacion:desenlazar", (_e, movimientoId: number) => {
    db.prepare(`UPDATE banco_movimientos SET asiento_linea_id = NULL WHERE id = ?`).run(movimientoId);
    return true;
  });

  ipcMain.handle("conciliacion:eliminar", (_e, movimientoId: number) => {
    const m = db.prepare(`SELECT asiento_linea_id FROM banco_movimientos WHERE id = ?`).get(movimientoId) as { asiento_linea_id: number | null } | undefined;
    if (!m) return true;
    if (m.asiento_linea_id) throw new Error("Primero quita la conciliacion de ese movimiento");
    db.prepare(`DELETE FROM banco_movimientos WHERE id = ?`).run(movimientoId);
    return true;
  });

  // Algo que aparece en el banco y no en el sistema (comision, cargo, interes): se registra y queda conciliado.
  ipcMain.handle("conciliacion:registrar", (_e, data: { movimiento_id: number; cuenta_id: number; concepto?: string }) => {
    const m = db.prepare(`SELECT * FROM banco_movimientos WHERE id = ?`).get(data.movimiento_id) as MovimientoBanco | undefined;
    if (!m) throw new Error("Movimiento del banco no encontrado");
    if (m.asiento_linea_id) throw new Error("Ese movimiento ya esta conciliado");
    const b = banco(db, m.banco_id);
    const cuenta = db.prepare(`SELECT id, es_movimiento FROM cuentas_contables WHERE id = ?`).get(data.cuenta_id) as { id: number; es_movimiento: number } | undefined;
    if (!cuenta || !cuenta.es_movimiento) throw new Error("Elige una cuenta que reciba movimientos");
    if (cuenta.id === b.cuenta_id) throw new Error("Elige otra cuenta distinta a la del banco");
    const monto = Math.abs(m.monto);
    const concepto = data.concepto?.trim() || m.descripcion || "Movimiento del estado de cuenta";
    db.transaction(() => {
      const lineas =
        m.monto < 0
          ? [
              { cuenta_id: cuenta.id, debito: monto, credito: 0, descripcion: concepto },
              { cuenta_id: b.cuenta_id, debito: 0, credito: monto, descripcion: concepto },
            ]
          : [
              { cuenta_id: b.cuenta_id, debito: monto, credito: 0, descripcion: concepto },
              { cuenta_id: cuenta.id, debito: 0, credito: monto, descripcion: concepto },
            ];
      const asientoId = crearAsiento(db, { fecha: m.fecha, concepto: `${/^banco\b/i.test(b.nombre) ? b.nombre : `Banco ${b.nombre}`}: ${concepto}`, origen: "AJUSTE", lineas });
      const linea = db.prepare(`SELECT id FROM asiento_lineas WHERE asiento_id = ? AND cuenta_id = ?`).get(asientoId, b.cuenta_id) as { id: number };
      db.prepare(`UPDATE banco_movimientos SET asiento_linea_id = ? WHERE id = ?`).run(linea.id, m.id);
    })();
    return true;
  });
}
