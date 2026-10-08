import { ipcMain } from "electron";
import type { DB } from "../db/types";
import { ahoraRD, crearAsiento } from "../db/contabilidad";
import type {
  Autor,
  Caja,
  CorreccionCierre,
  DetalleCierre,
  FiltrosCierres,
  ListaCierres,
  MetodoCaja,
  MotivoMovimientoCaja,
  MovimientoCaja,
  RegistroAuditoria,
  ResultadoCierre,
  ResumenCaja,
  SesionCaja,
} from "../shared/types";

const CODIGO_CAJA = "1.1.01";
const CODIGO_BANCO = "1.1.02";
const CODIGO_CAPITAL = "3.1.01";
const CODIGO_GASTOS_ADMIN = "6.1.01";
const CODIGO_DIFERENCIAS = "6.1.04";

const METODOS: MetodoCaja[] = ["EFECTIVO", "TARJETA", "TRANSFERENCIA", "CHEQUE"];

// Movimientos de efectivo permitidos y su asiento: [cuenta debito, cuenta credito].
export const MOTIVOS_MOVIMIENTO: Record<MotivoMovimientoCaja, { tipo: "ENTRADA" | "SALIDA"; nombre: string; debito: string; credito: string; soloAdmin: boolean }> = {
  FONDO_BANCO: { tipo: "ENTRADA", nombre: "Fondo / cambio traido del banco", debito: CODIGO_CAJA, credito: CODIGO_BANCO, soloAdmin: false },
  APORTE: { tipo: "ENTRADA", nombre: "Aporte de efectivo del dueno", debito: CODIGO_CAJA, credito: CODIGO_CAPITAL, soloAdmin: true },
  DEPOSITO_BANCO: { tipo: "SALIDA", nombre: "Deposito al banco", debito: CODIGO_BANCO, credito: CODIGO_CAJA, soloAdmin: false },
  GASTO: { tipo: "SALIDA", nombre: "Gasto menor pagado en efectivo", debito: CODIGO_GASTOS_ADMIN, credito: CODIGO_CAJA, soloAdmin: false },
  RETIRO_DUENO: { tipo: "SALIDA", nombre: "Retiro de efectivo del dueno", debito: CODIGO_CAPITAL, credito: CODIGO_CAJA, soloAdmin: true },
};

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function cuentaId(db: DB, codigo: string): number {
  const row = db.prepare(`SELECT id FROM cuentas_contables WHERE codigo = ?`).get(codigo) as { id: number } | undefined;
  if (!row) throw new Error(`Cuenta contable ${codigo} no existe`);
  return row.id;
}

function autorValido(autor: Autor | undefined): Autor {
  const nombre = autor?.nombre?.trim();
  if (!nombre) throw new Error("No se sabe que usuario hace la operacion. Vuelve a iniciar sesion.");
  return { id: autor?.id ?? null, nombre, rol: autor?.rol };
}

export function auditar(db: DB, autor: Autor, accion: string, entidad: string, entidadId: number | null, detalle?: unknown) {
  db.prepare(
    `INSERT INTO auditoria (fecha, usuario_id, usuario_nombre, accion, entidad, entidad_id, detalle) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(ahoraRD(), autor.id ?? null, autor.nombre, accion, entidad, entidadId, detalle === undefined ? null : JSON.stringify(detalle));
}

// Lo usan facturas, cobros y envases: una operacion solo se puede ligar a una jornada abierta.
export function validarSesionAbierta(db: DB, sesionId: number | null | undefined): number | null {
  if (!sesionId) return null;
  const s = db.prepare(`SELECT estado FROM caja_sesiones WHERE id = ?`).get(sesionId) as { estado: string } | undefined;
  if (!s) throw new Error("La jornada de caja no existe. Abre la caja de nuevo.");
  if (s.estado !== "ABIERTA") throw new Error("La caja ya fue cerrada: para seguir vendiendo hay que abrir una nueva jornada en Cierre de Caja.");
  return sesionId;
}

// ---------- calculo del resumen de una jornada ----------

export function calcularResumen(db: DB, sesionId: number): ResumenCaja {
  const sesion = db.prepare(`SELECT monto_inicial FROM caja_sesiones WHERE id = ?`).get(sesionId) as { monto_inicial: number } | undefined;
  if (!sesion) throw new Error("Jornada de caja no encontrada");

  const facturas = db
    .prepare(`SELECT id, condicion_pago, metodo_pago, subtotal, itbis, fianza_total, total, estado FROM facturas WHERE caja_sesion_id = ?`)
    .all(sesionId) as { id: number; condicion_pago: string; metodo_pago: string | null; subtotal: number; itbis: number; fianza_total: number; total: number; estado: string }[];
  const activas = facturas.filter((f) => f.estado !== "ANULADA");

  const porMetodo: ResumenCaja["ventas"]["por_metodo"] = { EFECTIVO: 0, TARJETA: 0, TRANSFERENCIA: 0, CHEQUE: 0, CREDITO: 0 };
  for (const f of activas) {
    const clave = f.condicion_pago === "CREDITO" ? "CREDITO" : ((f.metodo_pago ?? "EFECTIVO") as MetodoCaja);
    porMetodo[clave] = r2((porMetodo[clave] ?? 0) + f.total);
  }
  const descuentos = activas.length
    ? (db
        .prepare(`SELECT COALESCE(SUM(descuento), 0) AS d FROM factura_lineas WHERE factura_id IN (${activas.map(() => "?").join(",")})`)
        .get(...activas.map((f) => f.id)) as { d: number }).d
    : 0;

  // Anuladas en esta jornada (de esta o de otra) + las de esta jornada anuladas sin jornada.
  const anuladas = db
    .prepare(
      `SELECT id, total, condicion_pago, metodo_pago, caja_sesion_id FROM facturas
       WHERE estado = 'ANULADA' AND (anulada_sesion_id = ? OR (caja_sesion_id = ? AND anulada_sesion_id IS NULL))`
    )
    .all(sesionId, sesionId) as { id: number; total: number; condicion_pago: string; metodo_pago: string | null; caja_sesion_id: number | null }[];
  const devolucionesEfectivo = anuladas
    .filter((f) => f.caja_sesion_id !== sesionId && f.condicion_pago === "CONTADO" && (f.metodo_pago ?? "EFECTIVO") === "EFECTIVO")
    .reduce((s, f) => s + f.total, 0);

  const cobros: ResumenCaja["cobros"] = { EFECTIVO: 0, TARJETA: 0, TRANSFERENCIA: 0, CHEQUE: 0, total: 0 };
  for (const c of db.prepare(`SELECT metodo, SUM(monto) AS m FROM cobros WHERE caja_sesion_id = ? GROUP BY metodo`).all(sesionId) as { metodo: MetodoCaja; m: number }[]) {
    cobros[c.metodo] = r2(c.m);
    cobros.total = r2(cobros.total + c.m);
  }

  const mov = db
    .prepare(`SELECT COALESCE(SUM(CASE WHEN tipo='ENTRADA' THEN monto END), 0) AS e, COALESCE(SUM(CASE WHEN tipo='SALIDA' THEN monto END), 0) AS s FROM caja_movimientos WHERE sesion_id = ?`)
    .get(sesionId) as { e: number; s: number };
  const reembolsos = (db.prepare(`SELECT COALESCE(SUM(monto_reembolsado), 0) AS r FROM envase_movimientos WHERE caja_sesion_id = ?`).get(sesionId) as { r: number }).r;

  const efectivoEsperado = sesion.monto_inicial + porMetodo.EFECTIVO + cobros.EFECTIVO + mov.e - mov.s - reembolsos - devolucionesEfectivo;

  return {
    monto_inicial: r2(sesion.monto_inicial),
    ventas: {
      cantidad: facturas.length,
      total_general: r2(activas.reduce((s, f) => s + f.total, 0)),
      subtotal: r2(activas.reduce((s, f) => s + f.subtotal, 0)),
      descuentos: r2(descuentos),
      itbis: r2(activas.reduce((s, f) => s + f.itbis, 0)),
      fianzas: r2(activas.reduce((s, f) => s + f.fianza_total, 0)),
      por_metodo: porMetodo,
    },
    anuladas: { cantidad: anuladas.length, total: r2(anuladas.reduce((s, f) => s + f.total, 0)) },
    devoluciones_efectivo: r2(devolucionesEfectivo),
    cobros,
    entradas: r2(mov.e),
    salidas: r2(mov.s),
    reembolsos_envases: r2(reembolsos),
    efectivo_esperado: r2(efectivoEsperado),
  };
}

function resultadoDe(diferencia: number | null): ResultadoCierre | null {
  if (diferencia === null) return null;
  if (Math.abs(diferencia) < 0.005) return "CUADRE";
  return diferencia > 0 ? "SOBRANTE" : "FALTANTE";
}

const SQL_SESION = `
  SELECT s.*, c.nombre AS caja_nombre,
         (SELECT COUNT(*) FROM caja_correcciones cc WHERE cc.sesion_id = s.id) AS correcciones,
         (SELECT cc.efectivo_contado_nuevo FROM caja_correcciones cc WHERE cc.sesion_id = s.id ORDER BY cc.id DESC LIMIT 1) AS contado_corregido,
         (SELECT cc.diferencia_nueva FROM caja_correcciones cc WHERE cc.sesion_id = s.id ORDER BY cc.id DESC LIMIT 1) AS diferencia_corregida
  FROM caja_sesiones s JOIN cajas c ON c.id = s.caja_id`;

function armarSesion(db: DB, fila: any): SesionCaja {
  const resumen: ResumenCaja = fila.estado === "CERRADA" && fila.resumen ? JSON.parse(fila.resumen) : calcularResumen(db, fila.id);
  const diferenciaFinal = fila.estado === "CERRADA" ? (fila.diferencia_corregida ?? fila.diferencia) : null;
  const { contado_corregido, diferencia_corregida, ...resto } = fila;
  return {
    ...resto,
    resumen,
    efectivo_esperado: fila.estado === "CERRADA" ? fila.efectivo_esperado : resumen.efectivo_esperado,
    diferencia_final: diferenciaFinal,
    efectivo_contado_final: fila.estado === "CERRADA" ? (contado_corregido ?? fila.efectivo_contado) : null,
    resultado: resultadoDe(diferenciaFinal),
  } as SesionCaja;
}

function obtenerSesion(db: DB, id: number): SesionCaja {
  const fila = db.prepare(`${SQL_SESION} WHERE s.id = ?`).get(id);
  if (!fila) throw new Error("Jornada de caja no encontrada");
  return armarSesion(db, fila);
}

// Asiento que deja la cuenta Caja igual al efectivo contado: faltante = gasto, sobrante = lo contrario.
function asientoDiferencia(db: DB, diferencia: number, concepto: string): number | null {
  const monto = r2(Math.abs(diferencia));
  if (monto < 0.01) return null;
  const caja = cuentaId(db, CODIGO_CAJA);
  const dif = cuentaId(db, CODIGO_DIFERENCIAS);
  return crearAsiento(db, {
    fecha: ahoraRD().slice(0, 10),
    concepto,
    origen: "AJUSTE",
    lineas:
      diferencia > 0
        ? [
            { cuenta_id: caja, debito: monto, credito: 0, descripcion: concepto },
            { cuenta_id: dif, debito: 0, credito: monto, descripcion: concepto },
          ]
        : [
            { cuenta_id: dif, debito: monto, credito: 0, descripcion: concepto },
            { cuenta_id: caja, debito: 0, credito: monto, descripcion: concepto },
          ],
  });
}

export function registerCajaIpc(db: DB) {
  registerCierresAdminIpc(db);
  ipcMain.handle("caja:motivos", () =>
    Object.entries(MOTIVOS_MOVIMIENTO).map(([codigo, m]) => ({ codigo, tipo: m.tipo, nombre: m.nombre, soloAdmin: m.soloAdmin }))
  );
  // ---------- cajas ----------
  ipcMain.handle("cajas:listar", (): Caja[] => {
    return db
      .prepare(
        `SELECT c.*, s.id AS sesion_abierta_id, s.abierta_por_nombre, s.abierta_en
         FROM cajas c LEFT JOIN caja_sesiones s ON s.caja_id = c.id AND s.estado = 'ABIERTA'
         ORDER BY c.activa DESC, c.id`
      )
      .all() as Caja[];
  });

  ipcMain.handle("cajas:crear", (_e, data: { nombre: string; autor?: Autor }) => {
    const autor = autorValido(data.autor);
    const nombre = String(data.nombre ?? "").trim();
    if (!nombre) throw new Error("Escribe el nombre de la caja");
    if (db.prepare(`SELECT id FROM cajas WHERE lower(nombre) = lower(?)`).get(nombre)) throw new Error("Ya existe una caja con ese nombre");
    const id = Number(db.prepare(`INSERT INTO cajas (nombre) VALUES (?)`).run(nombre).lastInsertRowid);
    auditar(db, autor, "CREAR_CAJA", "caja", id, { nombre });
    return db.prepare(`SELECT * FROM cajas WHERE id = ?`).get(id);
  });

  ipcMain.handle("cajas:actualizar", (_e, id: number, data: { nombre?: string; activa?: number; autor?: Autor }) => {
    const autor = autorValido(data.autor);
    const actual = db.prepare(`SELECT * FROM cajas WHERE id = ?`).get(id) as Caja | undefined;
    if (!actual) throw new Error("Caja no encontrada");
    const nombre = data.nombre?.trim() || actual.nombre;
    const activa = data.activa === undefined ? actual.activa : data.activa ? 1 : 0;
    if (!activa && db.prepare(`SELECT id FROM caja_sesiones WHERE caja_id = ? AND estado = 'ABIERTA'`).get(id)) {
      throw new Error("No se puede desactivar una caja con la jornada abierta. Cierrala primero.");
    }
    db.prepare(`UPDATE cajas SET nombre = ?, activa = ? WHERE id = ?`).run(nombre, activa, id);
    auditar(db, autor, "EDITAR_CAJA", "caja", id, { antes: { nombre: actual.nombre, activa: actual.activa }, despues: { nombre, activa } });
    return db.prepare(`SELECT * FROM cajas WHERE id = ?`).get(id);
  });

  // ---------- jornada (cajero) ----------
  ipcMain.handle("caja:sesionActual", (_e, cajaId: number): SesionCaja | null => {
    const fila = db.prepare(`${SQL_SESION} WHERE s.caja_id = ? AND s.estado = 'ABIERTA'`).get(cajaId);
    return fila ? armarSesion(db, fila) : null;
  });

  ipcMain.handle("caja:abrir", (_e, data: { caja_id: number; monto_inicial: number; autor?: Autor }): SesionCaja => {
    const autor = autorValido(data.autor);
    const caja = db.prepare(`SELECT * FROM cajas WHERE id = ?`).get(data.caja_id) as Caja | undefined;
    if (!caja) throw new Error("Caja no encontrada");
    if (!caja.activa) throw new Error("Esta caja esta desactivada");
    const monto = Number(data.monto_inicial);
    if (!Number.isFinite(monto) || monto < 0) throw new Error("El monto inicial no puede ser negativo");
    const abierta = db.prepare(`SELECT abierta_por_nombre, abierta_en FROM caja_sesiones WHERE caja_id = ? AND estado = 'ABIERTA'`).get(data.caja_id) as
      | { abierta_por_nombre: string; abierta_en: string }
      | undefined;
    if (abierta) throw new Error(`${caja.nombre} ya tiene una jornada abierta por ${abierta.abierta_por_nombre} desde ${abierta.abierta_en}.`);

    const id = db.transaction(() => {
      const nuevo = Number(
        db
          .prepare(`INSERT INTO caja_sesiones (caja_id, estado, abierta_en, abierta_por_id, abierta_por_nombre, monto_inicial) VALUES (?, 'ABIERTA', ?, ?, ?, ?)`)
          .run(data.caja_id, ahoraRD(), autor.id ?? null, autor.nombre, r2(monto)).lastInsertRowid
      );
      auditar(db, autor, "ABRIR_CAJA", "caja_sesion", nuevo, { caja: caja.nombre, monto_inicial: r2(monto) });
      return nuevo;
    })();
    return obtenerSesion(db, id);
  });

  ipcMain.handle("caja:resumen", (_e, sesionId: number): SesionCaja => obtenerSesion(db, sesionId));

  ipcMain.handle(
    "caja:movimiento",
    (_e, data: { sesion_id: number; motivo: MotivoMovimientoCaja; monto: number; concepto?: string; autor?: Autor }): MovimientoCaja => {
      const autor = autorValido(data.autor);
      validarSesionAbierta(db, data.sesion_id);
      const motivo = MOTIVOS_MOVIMIENTO[data.motivo];
      if (!motivo) throw new Error("Tipo de movimiento invalido");
      if (motivo.soloAdmin && autor.rol !== "ADMIN") throw new Error("Solo un administrador puede registrar este movimiento");
      const monto = r2(Number(data.monto));
      if (!(monto > 0)) throw new Error("El monto debe ser mayor a cero");
      if (motivo.tipo === "SALIDA") {
        const disponible = calcularResumen(db, data.sesion_id).efectivo_esperado;
        if (monto > disponible + 0.005) throw new Error(`No hay suficiente efectivo en la caja: deberia haber ${disponible.toFixed(2)}`);
      }
      const concepto = data.concepto?.trim() || motivo.nombre;
      const id = db.transaction(() => {
        const asientoId = crearAsiento(db, {
          fecha: ahoraRD().slice(0, 10),
          concepto: `Caja: ${motivo.nombre}${data.concepto?.trim() ? ` - ${data.concepto.trim()}` : ""}`,
          origen: "AJUSTE",
          lineas: [
            { cuenta_id: cuentaId(db, motivo.debito), debito: monto, credito: 0, descripcion: concepto },
            { cuenta_id: cuentaId(db, motivo.credito), debito: 0, credito: monto, descripcion: concepto },
          ],
        });
        const nuevo = Number(
          db
            .prepare(
              `INSERT INTO caja_movimientos (sesion_id, tipo, motivo, concepto, monto, usuario_id, usuario_nombre, asiento_id, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(data.sesion_id, motivo.tipo, data.motivo, concepto, monto, autor.id ?? null, autor.nombre, asientoId, ahoraRD()).lastInsertRowid
        );
        auditar(db, autor, motivo.tipo === "ENTRADA" ? "ENTRADA_EFECTIVO" : "SALIDA_EFECTIVO", "caja_sesion", data.sesion_id, { motivo: data.motivo, monto, concepto });
        return nuevo;
      })();
      return db.prepare(`SELECT * FROM caja_movimientos WHERE id = ?`).get(id) as MovimientoCaja;
    }
  );

  ipcMain.handle("caja:movimientos", (_e, sesionId: number): MovimientoCaja[] => {
    return db.prepare(`SELECT * FROM caja_movimientos WHERE sesion_id = ? ORDER BY id`).all(sesionId) as MovimientoCaja[];
  });

  ipcMain.handle(
    "caja:cerrar",
    (_e, data: { sesion_id: number; efectivo_contado: number; observaciones?: string; autor?: Autor }): SesionCaja => {
      const autor = autorValido(data.autor);
      const contado = r2(Number(data.efectivo_contado));
      if (!Number.isFinite(contado) || contado < 0) throw new Error("Escribe el efectivo contado (puede ser 0)");

      db.transaction(() => {
        const sesion = db.prepare(`SELECT s.*, c.nombre AS caja_nombre FROM caja_sesiones s JOIN cajas c ON c.id = s.caja_id WHERE s.id = ?`).get(data.sesion_id) as any;
        if (!sesion) throw new Error("Jornada de caja no encontrada");
        if (sesion.estado !== "ABIERTA") throw new Error(`Esta jornada ya fue cerrada por ${sesion.cerrada_por_nombre} el ${sesion.cerrada_en}.`);

        const resumen = calcularResumen(db, data.sesion_id);
        const diferencia = r2(contado - resumen.efectivo_esperado);
        const asientoId = asientoDiferencia(
          db,
          diferencia,
          `Cierre de ${sesion.caja_nombre} #${sesion.id}: ${diferencia > 0 ? "sobrante" : "faltante"} de efectivo`
        );
        // WHERE estado = 'ABIERTA': si dos computadoras cierran a la vez, solo una lo logra.
        const info = db
          .prepare(
            `UPDATE caja_sesiones SET estado = 'CERRADA', cerrada_en = ?, cerrada_por_id = ?, cerrada_por_nombre = ?, efectivo_esperado = ?,
               efectivo_contado = ?, diferencia = ?, observaciones = ?, resumen = ?, asiento_diferencia_id = ?
             WHERE id = ? AND estado = 'ABIERTA'`
          )
          .run(ahoraRD(), autor.id ?? null, autor.nombre, resumen.efectivo_esperado, contado, diferencia, data.observaciones?.trim() || null, JSON.stringify(resumen), asientoId, data.sesion_id);
        if (info.changes !== 1) throw new Error("Esta jornada ya fue cerrada desde otra computadora.");
        auditar(db, autor, "CERRAR_CAJA", "caja_sesion", data.sesion_id, {
          efectivo_esperado: resumen.efectivo_esperado,
          efectivo_contado: contado,
          diferencia,
          resultado: resultadoDe(diferencia),
        });
      })();
      return obtenerSesion(db, data.sesion_id);
    }
  );

  // Cierres propios del cajero (abiertos o cerrados por el).
  ipcMain.handle("caja:misCierres", (_e, data: { autor?: Autor; limite?: number }): SesionCaja[] => {
    const autor = autorValido(data?.autor);
    const filas = autor.id
      ? db.prepare(`${SQL_SESION} WHERE s.abierta_por_id = ? OR s.cerrada_por_id = ? ORDER BY s.id DESC LIMIT ?`).all(autor.id, autor.id, data?.limite ?? 60)
      : db.prepare(`${SQL_SESION} WHERE s.abierta_por_nombre = ? OR s.cerrada_por_nombre = ? ORDER BY s.id DESC LIMIT ?`).all(autor.nombre, autor.nombre, data?.limite ?? 60);
    return filas.map((f) => armarSesion(db, f));
  });

  // ---------- administracion: consultar y auditar cierres ----------
  ipcMain.handle("cierres:listar", (_e, filtros: FiltrosCierres = {}): ListaCierres => {
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (filtros.desde) {
      where.push("substr(s.abierta_en, 1, 10) >= @desde");
      params.desde = filtros.desde;
    }
    if (filtros.hasta) {
      where.push("substr(s.abierta_en, 1, 10) <= @hasta");
      params.hasta = filtros.hasta;
    }
    if (filtros.caja_id) {
      where.push("s.caja_id = @caja_id");
      params.caja_id = filtros.caja_id;
    }
    if (filtros.cajero) {
      where.push("(s.abierta_por_nombre = @cajero OR s.cerrada_por_nombre = @cajero)");
      params.cajero = filtros.cajero;
    }
    if (filtros.estado === "ABIERTA") where.push("s.estado = 'ABIERTA'");
    else if (filtros.estado) where.push("s.estado = 'CERRADA'");

    let cierres = (db.prepare(`${SQL_SESION} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY s.abierta_en DESC, s.id DESC LIMIT 1000`).all(params) as any[]).map((f) =>
      armarSesion(db, f)
    );
    if (filtros.estado && filtros.estado !== "ABIERTA") cierres = cierres.filter((c) => c.resultado === filtros.estado);
    if (filtros.metodo) {
      const m = filtros.metodo;
      cierres = cierres.filter((c) => (c.resumen.ventas.por_metodo[m] ?? 0) > 0 || (m !== "CREDITO" && (c.resumen.cobros[m] ?? 0) > 0));
    }

    const totales: ListaCierres["totales"] = { jornadas: cierres.length, ventas: 0, efectivo: 0, tarjeta: 0, transferencia: 0, cheque: 0, credito: 0, devoluciones: 0, entradas: 0, salidas: 0, sobrantes: 0, faltantes: 0 };
    for (const c of cierres) {
      const v = c.resumen.ventas.por_metodo;
      totales.ventas += c.resumen.ventas.total_general;
      totales.efectivo += v.EFECTIVO + c.resumen.cobros.EFECTIVO;
      totales.tarjeta += v.TARJETA + c.resumen.cobros.TARJETA;
      totales.transferencia += v.TRANSFERENCIA + c.resumen.cobros.TRANSFERENCIA;
      totales.cheque += v.CHEQUE + c.resumen.cobros.CHEQUE;
      totales.credito += v.CREDITO;
      totales.devoluciones += c.resumen.anuladas.total + c.resumen.reembolsos_envases;
      totales.entradas += c.resumen.entradas;
      totales.salidas += c.resumen.salidas;
      if (c.diferencia_final && c.diferencia_final > 0) totales.sobrantes += c.diferencia_final;
      if (c.diferencia_final && c.diferencia_final < 0) totales.faltantes += -c.diferencia_final;
    }
    for (const k of Object.keys(totales) as (keyof typeof totales)[]) if (k !== "jornadas") totales[k] = r2(totales[k]);

    const cajeros = (db.prepare(`SELECT DISTINCT abierta_por_nombre AS n FROM caja_sesiones UNION SELECT DISTINCT cerrada_por_nombre FROM caja_sesiones WHERE cerrada_por_nombre IS NOT NULL ORDER BY 1`).all() as { n: string }[])
      .map((r) => r.n)
      .filter(Boolean);
    return { cierres, totales, cajeros };
  });

  ipcMain.handle("cierres:obtener", (_e, sesionId: number): DetalleCierre => detalleCierre(db, sesionId));

  // El cajero solo puede ver el detalle de las jornadas que abrio o cerro el.
  ipcMain.handle("caja:detalle", (_e, sesionId: number, data?: { autor?: Autor }): DetalleCierre => {
    const autor = autorValido(data?.autor);
    const d = detalleCierre(db, sesionId);
    const esSuya = autor.id ? d.abierta_por_id === autor.id || d.cerrada_por_id === autor.id : d.abierta_por_nombre === autor.nombre || d.cerrada_por_nombre === autor.nombre;
    if (autor.rol === "CAJERO" && !esSuya) throw new Error("Solo puedes ver tus propios cierres");
    return d;
  });
}

function detalleCierre(db: DB, sesionId: number): DetalleCierre {
    const sesion = obtenerSesion(db, sesionId);
    return {
      ...sesion,
      facturas: db
        .prepare(
          `SELECT f.id, f.numero, f.ncf, c.nombre AS cliente_nombre, f.condicion_pago, f.metodo_pago, f.total, f.estado, f.creado_en, f.creado_por
           FROM facturas f JOIN clientes c ON c.id = f.cliente_id WHERE f.caja_sesion_id = ? ORDER BY f.numero`
        )
        .all(sesionId) as DetalleCierre["facturas"],
      anuladas_detalle: db
        .prepare(
          `SELECT id, numero, ncf, total, metodo_pago, condicion_pago, CASE WHEN caja_sesion_id IS NOT ? THEN 1 ELSE 0 END AS de_otra_jornada
           FROM facturas WHERE estado = 'ANULADA' AND (anulada_sesion_id = ? OR (caja_sesion_id = ? AND anulada_sesion_id IS NULL)) ORDER BY numero`
        )
        .all(sesionId, sesionId, sesionId) as DetalleCierre["anuladas_detalle"],
      cobros_detalle: db
        .prepare(`SELECT co.id, co.factura_id, f.ncf, co.monto, co.metodo, co.fecha FROM cobros co JOIN facturas f ON f.id = co.factura_id WHERE co.caja_sesion_id = ? ORDER BY co.id`)
        .all(sesionId) as DetalleCierre["cobros_detalle"],
      movimientos: db.prepare(`SELECT * FROM caja_movimientos WHERE sesion_id = ? ORDER BY id`).all(sesionId) as MovimientoCaja[],
      reembolsos: db
        .prepare(
          `SELECT em.id, c.nombre AS cliente_nombre, p.nombre AS producto_nombre, em.cantidad, em.monto_reembolsado, em.fecha
           FROM envase_movimientos em JOIN clientes c ON c.id = em.cliente_id JOIN productos p ON p.id = em.producto_id
           WHERE em.caja_sesion_id = ? AND em.monto_reembolsado > 0 ORDER BY em.id`
        )
        .all(sesionId) as DetalleCierre["reembolsos"],
      historial_correcciones: db.prepare(`SELECT * FROM caja_correcciones WHERE sesion_id = ? ORDER BY id`).all(sesionId) as CorreccionCierre[],
      auditoria: db
        .prepare(`SELECT * FROM auditoria WHERE entidad = 'caja_sesion' AND entidad_id = ? ORDER BY id`)
        .all(sesionId) as RegistroAuditoria[],
    };
}

function registerCierresAdminIpc(db: DB) {

  // Correccion administrativa: no cambia el cierre original, agrega un registro auditable.
  ipcMain.handle("cierres:corregir", (_e, data: { sesion_id: number; efectivo_contado: number; motivo: string; autor?: Autor }) => {
    const autor = autorValido(data.autor);
    if (autor.rol && autor.rol !== "ADMIN") throw new Error("Solo un administrador puede corregir un cierre");
    const motivo = data.motivo?.trim();
    if (!motivo || motivo.length < 5) throw new Error("Explica el motivo de la correccion (minimo 5 letras)");
    const nuevo = r2(Number(data.efectivo_contado));
    if (!Number.isFinite(nuevo) || nuevo < 0) throw new Error("El efectivo contado no puede ser negativo");

    db.transaction(() => {
      const s = obtenerSesion(db, data.sesion_id);
      if (s.estado !== "CERRADA") throw new Error("Solo se corrigen jornadas ya cerradas");
      const anteriorContado = s.efectivo_contado_final ?? 0;
      const anteriorDiferencia = s.diferencia_final ?? 0;
      const diferenciaNueva = r2(nuevo - (s.efectivo_esperado ?? 0));
      const ajuste = r2(diferenciaNueva - anteriorDiferencia);
      const asientoId = asientoDiferencia(db, ajuste, `Correccion del cierre de ${s.caja_nombre} #${s.id}: ${motivo}`);
      db.prepare(
        `INSERT INTO caja_correcciones (sesion_id, usuario_id, usuario_nombre, motivo, efectivo_contado_anterior, efectivo_contado_nuevo, diferencia_nueva, asiento_id, creado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(data.sesion_id, autor.id ?? null, autor.nombre, motivo, anteriorContado, nuevo, diferenciaNueva, asientoId, ahoraRD());
      auditar(db, autor, "CORREGIR_CIERRE", "caja_sesion", data.sesion_id, {
        motivo,
        efectivo_contado_anterior: anteriorContado,
        efectivo_contado_nuevo: nuevo,
        diferencia_anterior: anteriorDiferencia,
        diferencia_nueva: diferenciaNueva,
      });
    })();
    return obtenerSesion(db, data.sesion_id);
  });

}
