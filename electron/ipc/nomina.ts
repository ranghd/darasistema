import { ipcMain } from "electron";
import type { DB } from "../db/types";
import { ahoraRD, asegurarCuenta, crearAsiento, cuentaDeBanco, fechaHoyRD } from "../db/contabilidad";
import type { Autor, Empleado, EmpleadoInput, FrecuenciaPago, Nomina, NominaDetalle, NominaLinea, NuevaNominaInput } from "../shared/types";
import { auditar, autorValido, calcularResumen, validarSesionAbierta } from "./caja";

const CODIGO_CAJA = "1.1.01";
const FRECUENCIAS: FrecuenciaPago[] = ["SEMANAL", "QUINCENAL", "MENSUAL"];
const METODOS = ["EFECTIVO", "TRANSFERENCIA", "CHEQUE"];

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

function cuentaIdPorCodigo(db: DB, codigo: string): number {
  const row = db.prepare(`SELECT id FROM cuentas_contables WHERE codigo = ?`).get(codigo) as { id: number } | undefined;
  if (!row) throw new Error(`Cuenta contable ${codigo} no existe`);
  return row.id;
}

// La cuenta donde se anotan los sueldos: la del tipo de gasto "Sueldos y salarios", o la cuenta 6.1.09.
function cuentaSueldos(db: DB): number {
  return asegurarCuenta(db, { codigo: "6.1.09", nombre: "Sueldos y Salarios", tipo: "GASTOS", naturaleza: "DEUDORA", padreCodigo: "6" });
}

const SELECT_NOMINA = `
  SELECT n.*, b.nombre AS banco_nombre, (SELECT COUNT(*) FROM nomina_lineas l WHERE l.nomina_id = n.id) AS empleados
  FROM nominas n LEFT JOIN bancos b ON b.id = n.banco_id`;

function obtenerNomina(db: DB, id: number): NominaDetalle | undefined {
  const n = db.prepare(`${SELECT_NOMINA} WHERE n.id = ?`).get(id) as Nomina | undefined;
  if (!n) return undefined;
  const lineas = db.prepare(`SELECT * FROM nomina_lineas WHERE nomina_id = ? ORDER BY empleado_nombre COLLATE NOCASE`).all(id) as NominaLinea[];
  return { ...n, lineas };
}

function limpiar(t: unknown): string | null {
  const v = String(t ?? "").trim().replace(/\s+/g, " ");
  return v || null;
}

export function registerNominaIpc(db: DB) {
  // ---------- Empleados ----------

  ipcMain.handle("empleados:listar", (): Empleado[] => {
    return db
      .prepare(
        `SELECT e.*, (SELECT COUNT(*) FROM nomina_lineas l JOIN nominas n ON n.id = l.nomina_id WHERE l.empleado_id = e.id AND n.estado = 'PAGADA') AS pagos
         FROM empleados e ORDER BY e.activo DESC, e.nombre COLLATE NOCASE`
      )
      .all() as Empleado[];
  });

  ipcMain.handle("empleados:guardar", (_e, data: EmpleadoInput): Empleado => {
    const nombre = limpiar(data.nombre);
    if (!nombre) throw new Error("Escribe el nombre del empleado");
    if (!FRECUENCIAS.includes(data.frecuencia)) throw new Error("Elige cada cuanto se le paga: por semana, quincena o mes");
    const sueldo = r2(Number(data.sueldo));
    if (!Number.isFinite(sueldo) || sueldo < 0) throw new Error("El sueldo no puede ser negativo");
    if (data.fecha_ingreso && !FECHA.test(data.fecha_ingreso)) throw new Error("La fecha de ingreso no es valida");
    const repetido = db.prepare(`SELECT id FROM empleados WHERE lower(nombre) = lower(?) AND id != ? AND activo = 1`).get(nombre, data.id ?? -1);
    if (repetido) throw new Error(`Ya hay un empleado activo llamado "${nombre}"`);
    const campos = {
      nombre,
      cedula: limpiar(data.cedula),
      cargo: limpiar(data.cargo),
      telefono: limpiar(data.telefono),
      frecuencia: data.frecuencia,
      sueldo,
      fecha_ingreso: data.fecha_ingreso || null,
      notas: limpiar(data.notas),
      activo: data.activo === 0 ? 0 : 1,
    };
    let id = data.id ?? 0;
    if (id) {
      if (!db.prepare(`SELECT id FROM empleados WHERE id = ?`).get(id)) throw new Error("Empleado no encontrado");
      db.prepare(
        `UPDATE empleados SET nombre=@nombre, cedula=@cedula, cargo=@cargo, telefono=@telefono, frecuencia=@frecuencia, sueldo=@sueldo, fecha_ingreso=@fecha_ingreso, notas=@notas, activo=@activo WHERE id=@id`
      ).run({ ...campos, id });
    } else {
      id = Number(
        db
          .prepare(
            `INSERT INTO empleados (nombre, cedula, cargo, telefono, frecuencia, sueldo, fecha_ingreso, notas, activo)
             VALUES (@nombre, @cedula, @cargo, @telefono, @frecuencia, @sueldo, @fecha_ingreso, @notas, @activo)`
          )
          .run(campos).lastInsertRowid
      );
    }
    return db.prepare(`SELECT * FROM empleados WHERE id = ?`).get(id) as Empleado;
  });

  // Si ya se le pago alguna vez no se borra (queda su historial): se desactiva.
  ipcMain.handle("empleados:eliminar", (_e, id: number): { borrado: boolean } => {
    if (!db.prepare(`SELECT id FROM empleados WHERE id = ?`).get(id)) throw new Error("Empleado no encontrado");
    if (db.prepare(`SELECT 1 FROM nomina_lineas WHERE empleado_id = ? LIMIT 1`).get(id)) {
      db.prepare(`UPDATE empleados SET activo = 0 WHERE id = ?`).run(id);
      return { borrado: false };
    }
    db.prepare(`DELETE FROM empleados WHERE id = ?`).run(id);
    return { borrado: true };
  });

  // ---------- Pagos de nomina ----------

  ipcMain.handle("nomina:listar", (_e, filtros: { desde?: string; hasta?: string; empleado_id?: number } | null = {}): Nomina[] => {
    const f = filtros ?? {};
    const where: string[] = [];
    const p: Record<string, unknown> = {};
    if (f.desde) (where.push("n.fecha >= @desde"), (p.desde = f.desde));
    if (f.hasta) (where.push("n.fecha <= @hasta"), (p.hasta = f.hasta));
    if (f.empleado_id) (where.push("EXISTS (SELECT 1 FROM nomina_lineas l WHERE l.nomina_id = n.id AND l.empleado_id = @emp)"), (p.emp = f.empleado_id));
    return db.prepare(`${SELECT_NOMINA} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY n.fecha DESC, n.numero DESC`).all(p) as Nomina[];
  });

  ipcMain.handle("nomina:obtener", (_e, id: number) => obtenerNomina(db, id));

  // Ultimo periodo pagado de cada empleado: la pantalla lo usa para sugerir el siguiente y avisar si ya se pago.
  ipcMain.handle("nomina:ultimosPagos", (): { empleado_id: number; hasta: string; fecha: string }[] => {
    return db
      .prepare(
        `SELECT l.empleado_id, MAX(n.hasta) AS hasta, MAX(n.fecha) AS fecha
         FROM nomina_lineas l JOIN nominas n ON n.id = l.nomina_id WHERE n.estado = 'PAGADA' GROUP BY l.empleado_id`
      )
      .all() as { empleado_id: number; hasta: string; fecha: string }[];
  });

  ipcMain.handle("nomina:pagar", (_e, input: NuevaNominaInput): NominaDetalle => {
    const autor = autorValido(input.autor);
    if (!FECHA.test(input.fecha ?? "") || !FECHA.test(input.desde ?? "") || !FECHA.test(input.hasta ?? "")) throw new Error("Indica la fecha de pago y el periodo que se paga");
    if (input.hasta < input.desde) throw new Error("El periodo termina antes de empezar");
    if (!FRECUENCIAS.includes(input.frecuencia)) throw new Error("Indica si el pago es por semana, quincena o mes");
    if (!METODOS.includes(input.metodo)) throw new Error("Elige como se paga: efectivo, transferencia o cheque");
    if (!input.lineas?.length) throw new Error("Elige al menos un empleado");

    const lineas = input.lineas.map((l) => {
      const e = db.prepare(`SELECT * FROM empleados WHERE id = ?`).get(l.empleado_id) as Empleado | undefined;
      if (!e) throw new Error("Un empleado de la lista ya no existe");
      const sueldo = r2(Number(l.sueldo));
      const extras = r2(Number(l.extras || 0));
      const descuentos = r2(Number(l.descuentos || 0));
      if (![sueldo, extras, descuentos].every((n) => Number.isFinite(n) && n >= 0)) throw new Error(`Revisa los montos de ${e.nombre}: no pueden ser negativos`);
      const neto = r2(sueldo + extras - descuentos);
      if (neto < 0) throw new Error(`Los descuentos de ${e.nombre} son mas que lo que gana`);
      // No se le paga dos veces el mismo periodo.
      const traslape = db
        .prepare(
          `SELECT n.numero, n.desde, n.hasta FROM nomina_lineas ln JOIN nominas n ON n.id = ln.nomina_id
           WHERE ln.empleado_id = ? AND n.estado = 'PAGADA' AND n.desde <= ? AND n.hasta >= ? LIMIT 1`
        )
        .get(e.id, input.hasta, input.desde) as { numero: number; desde: string; hasta: string } | undefined;
      if (traslape) throw new Error(`A ${e.nombre} ya se le pago ese periodo en la nomina #${traslape.numero} (del ${traslape.desde} al ${traslape.hasta})`);
      return { e, sueldo, extras, descuentos, neto, nota: limpiar(l.nota) };
    });
    const ids = lineas.map((l) => l.e.id);
    if (new Set(ids).size !== ids.length) throw new Error("Un empleado esta repetido en la lista");

    const total_sueldos = r2(lineas.reduce((s, l) => s + l.sueldo, 0));
    const total_extras = r2(lineas.reduce((s, l) => s + l.extras, 0));
    const total_descuentos = r2(lineas.reduce((s, l) => s + l.descuentos, 0));
    const total_neto = r2(lineas.reduce((s, l) => s + l.neto, 0));
    if (!(total_neto > 0)) throw new Error("No hay nada que pagar: el total es cero");

    const sesionCaja = input.metodo === "EFECTIVO" ? validarSesionAbierta(db, input.caja_sesion_id) : null;
    if (input.caja_sesion_id && input.metodo !== "EFECTIVO") throw new Error("Del dinero de la caja solo se paga en efectivo");
    if (sesionCaja) {
      const disponible = calcularResumen(db, sesionCaja).efectivo_esperado;
      if (total_neto > disponible + 0.005) throw new Error(`No hay suficiente efectivo en la caja para pagar la nomina: deberia haber ${disponible.toFixed(2)}`);
    }

    const id = db.transaction(() => {
      const numero = (db.prepare(`SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM nominas`).get() as { n: number }).n;
      const salida = input.metodo === "EFECTIVO" ? { cuenta_id: cuentaIdPorCodigo(db, CODIGO_CAJA), banco_id: null } : cuentaDeBanco(db, input.banco_id);
      const concepto = `Nomina #${numero} del ${input.desde} al ${input.hasta}`;
      const asientoId = crearAsiento(db, {
        fecha: input.fecha,
        concepto,
        origen: "AJUSTE",
        lineas: [
          { cuenta_id: cuentaSueldos(db), debito: total_neto, credito: 0, descripcion: `Sueldos de ${lineas.length} empleado(s)` },
          { cuenta_id: salida.cuenta_id, debito: 0, credito: total_neto, descripcion: input.referencia?.trim() ? `${concepto} ref. ${input.referencia.trim()}` : concepto },
        ],
      });
      const nominaId = Number(
        db
          .prepare(
            `INSERT INTO nominas (numero, fecha, desde, hasta, frecuencia, total_sueldos, total_extras, total_descuentos, total_neto, metodo, banco_id, referencia, caja_sesion_id, notas, asiento_id, creado_por)
             VALUES (@numero, @fecha, @desde, @hasta, @frecuencia, @total_sueldos, @total_extras, @total_descuentos, @total_neto, @metodo, @banco_id, @referencia, @caja_sesion_id, @notas, @asiento_id, @creado_por)`
          )
          .run({
            numero,
            fecha: input.fecha,
            desde: input.desde,
            hasta: input.hasta,
            frecuencia: input.frecuencia,
            total_sueldos,
            total_extras,
            total_descuentos,
            total_neto,
            metodo: input.metodo,
            banco_id: salida.banco_id,
            referencia: limpiar(input.referencia),
            caja_sesion_id: sesionCaja,
            notas: limpiar(input.notas),
            asiento_id: asientoId,
            creado_por: autor.nombre,
          }).lastInsertRowid
      );
      const insLinea = db.prepare(
        `INSERT INTO nomina_lineas (nomina_id, empleado_id, empleado_nombre, cargo, sueldo, extras, descuentos, neto, nota) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const l of lineas) insLinea.run(nominaId, l.e.id, l.e.nombre, l.e.cargo, l.sueldo, l.extras, l.descuentos, l.neto, l.nota);
      if (sesionCaja) {
        db.prepare(
          `INSERT INTO caja_movimientos (sesion_id, tipo, motivo, concepto, monto, usuario_id, usuario_nombre, asiento_id, creado_en) VALUES (?, 'SALIDA', 'NOMINA', ?, ?, ?, ?, ?, ?)`
        ).run(sesionCaja, `Nomina #${numero} (${lineas.length} empleado${lineas.length === 1 ? "" : "s"})`, total_neto, autor.id ?? null, autor.nombre, asientoId, ahoraRD());
      }
      auditar(db, autor, "PAGAR_NOMINA", "nomina", nominaId, { numero, desde: input.desde, hasta: input.hasta, empleados: lineas.length, total_neto, metodo: input.metodo, caja: !!sesionCaja });
      return nominaId;
    })();
    return obtenerNomina(db, id)!;
  });

  // Anular devuelve el dinero en la contabilidad (queda la huella, no se borra). Si salio de una caja que sigue
  // abierta, el efectivo vuelve a esa caja; si ya cerro, el dinero vuelve al dueno.
  ipcMain.handle("nomina:anular", (_e, data: { id: number; motivo: string; autor?: Autor }): NominaDetalle => {
    const autor = autorValido(data.autor);
    const n = obtenerNomina(db, data.id);
    if (!n) throw new Error("Nomina no encontrada");
    if (n.estado === "ANULADA") throw new Error("Esta nomina ya esta anulada");
    const motivo = data.motivo?.trim();
    if (!motivo) throw new Error("Escribe el motivo de la anulacion");
    db.transaction(() => {
      const lineas = db.prepare(`SELECT cuenta_id, debito, credito, descripcion FROM asiento_lineas WHERE asiento_id = ?`).all(n.asiento_id) as any[];
      const asientoId = crearAsiento(db, {
        fecha: fechaHoyRD(),
        concepto: `Anulacion nomina #${n.numero} - ${motivo}`,
        origen: "AJUSTE",
        lineas: lineas.map((l) => ({ cuenta_id: l.cuenta_id, debito: l.credito, credito: l.debito, descripcion: `Anula: ${l.descripcion ?? ""}`.trim() })),
      });
      db.prepare(`UPDATE nominas SET estado = 'ANULADA', notas = TRIM(COALESCE(notas, '') || ' [Anulada: ' || ? || ']') WHERE id = ?`).run(motivo, n.id);
      const sesion = n.caja_sesion_id ? (db.prepare(`SELECT estado FROM caja_sesiones WHERE id = ?`).get(n.caja_sesion_id) as { estado: string } | undefined) : undefined;
      if (sesion?.estado === "ABIERTA") {
        db.prepare(
          `INSERT INTO caja_movimientos (sesion_id, tipo, motivo, concepto, monto, usuario_id, usuario_nombre, asiento_id, creado_en) VALUES (?, 'ENTRADA', 'NOMINA', ?, ?, ?, ?, ?, ?)`
        ).run(n.caja_sesion_id, `Anulacion nomina #${n.numero}`, n.total_neto, autor.id ?? null, autor.nombre, asientoId, ahoraRD());
      }
      auditar(db, autor, "ANULAR_NOMINA", "nomina", n.id, { numero: n.numero, total_neto: n.total_neto, motivo });
    })();
    return obtenerNomina(db, n.id)!;
  });
}
