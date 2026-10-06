import type { DB } from "./sqlite";
import type { AsientoLineaInput } from "../shared/types";

export interface NuevoAsientoInput {
  fecha: string;
  concepto: string;
  origen: "MANUAL" | "FACTURA" | "COBRO" | "AJUSTE";
  referencia_id?: number | null;
  lineas: AsientoLineaInput[];
}

const EPSILON = 0.005;

export function crearAsiento(db: DB, input: NuevoAsientoInput): number {
  const totalDebito = input.lineas.reduce((s, l) => s + l.debito, 0);
  const totalCredito = input.lineas.reduce((s, l) => s + l.credito, 0);
  if (Math.abs(totalDebito - totalCredito) > EPSILON) {
    throw new Error(
      `El asiento no cuadra: debitos ${totalDebito.toFixed(2)} vs creditos ${totalCredito.toFixed(2)}`
    );
  }
  if (input.lineas.length < 2) {
    throw new Error("Un asiento debe tener al menos dos lineas");
  }

  const maxNumero = (db.prepare(`SELECT COALESCE(MAX(numero), 0) as m FROM asientos`).get() as { m: number }).m;

  const insertAsiento = db.prepare(
    `INSERT INTO asientos (numero, fecha, concepto, origen, referencia_id) VALUES (@numero, @fecha, @concepto, @origen, @referencia_id)`
  );
  const insertLinea = db.prepare(
    `INSERT INTO asiento_lineas (asiento_id, cuenta_id, debito, credito, descripcion) VALUES (@asiento_id, @cuenta_id, @debito, @credito, @descripcion)`
  );

  const run = db.transaction(() => {
    const info = insertAsiento.run({
      numero: maxNumero + 1,
      fecha: input.fecha,
      concepto: input.concepto,
      origen: input.origen,
      referencia_id: input.referencia_id ?? null,
    });
    const asientoId = Number(info.lastInsertRowid);
    for (const l of input.lineas) {
      insertLinea.run({
        asiento_id: asientoId,
        cuenta_id: l.cuenta_id,
        debito: l.debito,
        credito: l.credito,
        descripcion: l.descripcion ?? null,
      });
    }
    return asientoId;
  });

  return run();
}
