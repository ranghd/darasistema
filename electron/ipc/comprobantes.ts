import { ipcMain } from "electron";
import type { DB } from "../db/sqlite";
import { crearAsiento } from "../db/contabilidad";
import type { ComprobanteVarios, NuevoComprobanteVariosInput } from "../shared/types";

const CODIGO_CAJA = "1.1.01";
const CODIGO_BANCO = "1.1.02";
const CODIGO_ITBIS_PAGAR = "2.1.02";

function cuentaIdPorCodigo(db: DB, codigo: string): number {
  const row = db.prepare(`SELECT id FROM cuentas_contables WHERE codigo = ?`).get(codigo) as { id: number } | undefined;
  if (!row) throw new Error(`Cuenta contable ${codigo} no existe`);
  return row.id;
}

function tomarSiguienteNcf(db: DB, tipo: string): string {
  const sec = db
    .prepare(`SELECT * FROM ncf_secuencias WHERE tipo = ? AND activo = 1 ORDER BY id DESC LIMIT 1`)
    .get(tipo) as { id: number; prefijo: string; actual: number; hasta: number; vencimiento: string | null } | undefined;
  if (!sec) throw new Error(`No hay una secuencia NCF activa para el tipo ${tipo}. Configure una en Configuracion.`);
  if (sec.actual > sec.hasta) throw new Error(`La secuencia NCF ${tipo} esta agotada. Configure una nueva en Configuracion.`);
  if (sec.vencimiento && new Date(sec.vencimiento) < new Date()) {
    throw new Error(`La secuencia NCF ${tipo} esta vencida. Configure una nueva en Configuracion.`);
  }
  db.prepare(`UPDATE ncf_secuencias SET actual = actual + 1 WHERE id = ?`).run(sec.id);
  return `${sec.prefijo}${String(sec.actual).padStart(8, "0")}`;
}

export function registerComprobantesIpc(db: DB) {
  ipcMain.handle("comprobantes:listar", () => {
    return db
      .prepare(
        `SELECT cv.*, c.nombre as cuenta_nombre FROM comprobantes_varios cv
         JOIN cuentas_contables c ON c.id = cv.cuenta_id
         ORDER BY cv.fecha DESC, cv.id DESC`
      )
      .all() as ComprobanteVarios[];
  });

  ipcMain.handle("comprobantes:registrar", (_e, input: NuevoComprobanteVariosInput) => {
    if (input.monto <= 0) throw new Error("El monto debe ser mayor a cero");

    const config = db.prepare(`SELECT * FROM company_config WHERE id = 1`).get() as { itbis_rate: number };
    const itbis = input.aplicaItbis ? Math.round(input.monto * config.itbis_rate * 100) / 100 : 0;
    const total = input.monto + itbis;
    const cuentaCajaBanco = input.metodo === "BANCO" ? CODIGO_BANCO : CODIGO_CAJA;

    const run = db.transaction(() => {
      const ncf = tomarSiguienteNcf(db, input.tipo);
      const concepto = `${input.tipo} ${ncf} - ${input.concepto}${input.contraparte ? ` (${input.contraparte})` : ""}`;

      // B11: entra dinero (ingreso). B12 / B16: sale dinero (gasto / pago).
      const esIngreso = input.tipo === "B11";
      const lineas = esIngreso
        ? [
            { cuenta_id: cuentaIdPorCodigo(db, cuentaCajaBanco), debito: total, credito: 0, descripcion: concepto },
            { cuenta_id: input.cuenta_id, debito: 0, credito: input.monto, descripcion: concepto },
            ...(itbis > 0 ? [{ cuenta_id: cuentaIdPorCodigo(db, CODIGO_ITBIS_PAGAR), debito: 0, credito: itbis, descripcion: concepto }] : []),
          ]
        : [
            { cuenta_id: input.cuenta_id, debito: total, credito: 0, descripcion: concepto },
            { cuenta_id: cuentaIdPorCodigo(db, cuentaCajaBanco), debito: 0, credito: total, descripcion: concepto },
          ];

      const asientoId = crearAsiento(db, {
        fecha: input.fecha,
        concepto,
        origen: "AJUSTE",
        lineas,
      });

      const info = db
        .prepare(
          `INSERT INTO comprobantes_varios (tipo, ncf, fecha, concepto, contraparte, monto, itbis, total, cuenta_id, metodo, asiento_id)
           VALUES (@tipo, @ncf, @fecha, @concepto, @contraparte, @monto, @itbis, @total, @cuenta_id, @metodo, @asiento_id)`
        )
        .run({
          tipo: input.tipo,
          ncf,
          fecha: input.fecha,
          concepto: input.concepto,
          contraparte: input.contraparte ?? null,
          monto: input.monto,
          itbis,
          total,
          cuenta_id: input.cuenta_id,
          metodo: input.metodo,
          asiento_id: asientoId,
        });

      return info.lastInsertRowid;
    });

    const id = run();
    return db.prepare(`SELECT * FROM comprobantes_varios WHERE id = ?`).get(id) as ComprobanteVarios;
  });
}
