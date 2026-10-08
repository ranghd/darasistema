import type { DB } from "./types";
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

// Fecha de hoy en Republica Dominicana (UTC-4), sin importar la zona horaria del
// equipo o del servidor en la nube (que corre en UTC).
export function fechaHoyRD(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santo_Domingo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

const CODIGO_CAPITAL = "3.1.01";
const CODIGO_GASTOS_ADMIN = "6.1.01";

function idPorCodigo(db: DB, codigo: string): number | null {
  const row = db.prepare(`SELECT id FROM cuentas_contables WHERE codigo = ?`).get(codigo) as { id: number } | undefined;
  return row?.id ?? null;
}

const redondear = (n: number) => Math.round(n * 100) / 100;

// Registra en la contabilidad un cambio en el valor del inventario que no vino de
// una compra ni de una venta (existencia inicial o ajuste manual por conteo).
// Si sube: Inventario (debito) contra Capital Social, como un aporte en mercancia.
// Si baja: Gastos de Administracion (merma o faltante) contra Inventario.
export function registrarAjusteInventario(
  db: DB,
  cuentaInventarioId: number | null | undefined,
  monto: number,
  concepto: string,
  fecha: string = fechaHoyRD()
): void {
  const valor = redondear(monto);
  if (!cuentaInventarioId || Math.abs(valor) < 0.01) return;
  const contrapartida = idPorCodigo(db, valor > 0 ? CODIGO_CAPITAL : CODIGO_GASTOS_ADMIN);
  if (!contrapartida) return;
  const lineas =
    valor > 0
      ? [
          { cuenta_id: cuentaInventarioId, debito: valor, credito: 0, descripcion: concepto },
          { cuenta_id: contrapartida, debito: 0, credito: valor, descripcion: concepto },
        ]
      : [
          { cuenta_id: contrapartida, debito: -valor, credito: 0, descripcion: concepto },
          { cuenta_id: cuentaInventarioId, debito: 0, credito: -valor, descripcion: concepto },
        ];
  crearAsiento(db, { fecha, concepto, origen: "AJUSTE", lineas });
}

// Deja cada cuenta de inventario con el valor real de la mercancia en existencia
// (existencia x costo de cada producto). Se usa al cargar datos de ejemplo y una
// sola vez en bases que ya tenian productos antes de que esto existiera.
export function cuadrarInventarioContable(db: DB, concepto: string): void {
  const filas = db
    .prepare(
      `SELECT p.cuenta_inventario_id AS cuenta_id,
              SUM(p.existencia * p.costo_contenido) AS valor_real,
              COALESCE((SELECT SUM(al.debito - al.credito) FROM asiento_lineas al WHERE al.cuenta_id = p.cuenta_inventario_id), 0) AS valor_libros
       FROM productos p
       WHERE p.cuenta_inventario_id IS NOT NULL
       GROUP BY p.cuenta_inventario_id`
    )
    .all() as { cuenta_id: number; valor_real: number; valor_libros: number }[];
  // Fecha del primer movimiento, para que quede como saldo de apertura del historial.
  const primera = (db.prepare(`SELECT MIN(fecha) AS f FROM asientos`).get() as { f: string | null } | undefined)?.f;
  for (const f of filas) {
    registrarAjusteInventario(db, f.cuenta_id, f.valor_real - f.valor_libros, concepto, primera ?? fechaHoyRD());
  }
}

// Fecha y hora de Republica Dominicana, "AAAA-MM-DD HH:MM:SS" (tambien en la nube, que corre en UTC).
export function ahoraRD(): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Santo_Domingo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(new Date())
    .replace("T", " ");
}
