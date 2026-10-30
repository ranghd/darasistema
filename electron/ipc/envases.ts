import { ipcMain } from "electron";
import type { DB } from "../db/types";
import { crearAsiento } from "../db/contabilidad";
import { validarSesionAbierta } from "./caja";
import type { BotellaFiadaInput, MovimientoBotellaFiada, SaldoBotellaFiada } from "../shared/types";

const CODIGO_CAJA = "1.1.01";
const CODIGO_DEPOSITOS_GARANTIA = "2.1.03";

function cuentaIdPorCodigo(db: DB, codigo: string): number {
  const row = db.prepare(`SELECT id FROM cuentas_contables WHERE codigo = ?`).get(codigo) as { id: number } | undefined;
  if (!row) throw new Error(`Cuenta contable ${codigo} no existe`);
  return row.id;
}

const pendientesDe = (db: DB, clienteId: number, productoId: number) =>
  (
    db
      .prepare(`SELECT COALESCE(SUM(CASE WHEN tipo = 'FIADO' THEN cantidad ELSE -cantidad END), 0) AS n FROM botellas_fiadas WHERE cliente_id = ? AND producto_id = ?`)
      .get(clienteId, productoId) as { n: number }
  ).n;

function validarBotella(db: DB, input: BotellaFiadaInput) {
  if (!db.prepare(`SELECT id FROM clientes WHERE id = ?`).get(input.cliente_id)) throw new Error("Elige el cliente");
  if (!db.prepare(`SELECT id FROM productos WHERE id = ?`).get(input.producto_id)) throw new Error("Elige la botella");
  const cantidad = Number(input.cantidad);
  if (!(cantidad > 0)) throw new Error("La cantidad debe ser mayor que cero");
  return cantidad;
}

function guardarBotella(db: DB, tipo: "FIADO" | "DEVOLUCION", input: BotellaFiadaInput, cantidad: number) {
  db.prepare(
    `INSERT INTO botellas_fiadas (cliente_id, producto_id, tipo, cantidad, fecha, nota, creado_por) VALUES (@cliente, @producto, @tipo, @cantidad, @fecha, @nota, @por)`
  ).run({
    cliente: input.cliente_id,
    producto: input.producto_id,
    tipo,
    cantidad,
    fecha: input.fecha || new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santo_Domingo" }).format(new Date()),
    nota: input.nota?.trim() || null,
    por: input.creado_por ?? null,
  });
}

export function registerEnvasesIpc(db: DB) {
  // ---------- Botellas fiadas ----------

  ipcMain.handle("fiados:saldos", (): SaldoBotellaFiada[] => {
    return db
      .prepare(
        `SELECT bf.cliente_id, c.nombre AS cliente_nombre, c.telefono AS cliente_telefono, bf.producto_id, p.nombre AS producto_nombre,
                SUM(CASE WHEN bf.tipo = 'FIADO' THEN bf.cantidad ELSE 0 END) AS fiadas,
                SUM(CASE WHEN bf.tipo = 'DEVOLUCION' THEN bf.cantidad ELSE 0 END) AS devueltas,
                SUM(CASE WHEN bf.tipo = 'FIADO' THEN bf.cantidad ELSE -bf.cantidad END) AS pendientes,
                MAX(bf.fecha) AS ultima_fecha
         FROM botellas_fiadas bf JOIN clientes c ON c.id = bf.cliente_id JOIN productos p ON p.id = bf.producto_id
         GROUP BY bf.cliente_id, bf.producto_id
         ORDER BY pendientes DESC, c.nombre`
      )
      .all() as SaldoBotellaFiada[];
  });

  ipcMain.handle("fiados:movimientos", (_e, clienteId?: number | null): MovimientoBotellaFiada[] => {
    const where = clienteId ? "WHERE bf.cliente_id = ?" : "";
    return db
      .prepare(
        `SELECT bf.*, c.nombre AS cliente_nombre, p.nombre AS producto_nombre
         FROM botellas_fiadas bf JOIN clientes c ON c.id = bf.cliente_id JOIN productos p ON p.id = bf.producto_id
         ${where} ORDER BY bf.fecha DESC, bf.id DESC LIMIT 500`
      )
      .all(...(clienteId ? [clienteId] : [])) as MovimientoBotellaFiada[];
  });

  ipcMain.handle("fiados:fiar", (_e, input: BotellaFiadaInput) => {
    const cantidad = validarBotella(db, input);
    guardarBotella(db, "FIADO", input, cantidad);
    return pendientesDe(db, input.cliente_id, input.producto_id);
  });

  ipcMain.handle("fiados:devolver", (_e, input: BotellaFiadaInput) => {
    const cantidad = validarBotella(db, input);
    const debe = pendientesDe(db, input.cliente_id, input.producto_id);
    if (cantidad > debe + 0.0001) throw new Error(debe > 0 ? `El cliente solo debe ${debe} de esa botella` : "El cliente no debe ninguna de esa botella");
    guardarBotella(db, "DEVOLUCION", input, cantidad);
    return pendientesDe(db, input.cliente_id, input.producto_id);
  });

  ipcMain.handle("envases:saldos", () => {
    return db
      .prepare(
        `SELECT ec.cliente_id, c.nombre as cliente_nombre, ec.producto_id, p.nombre as producto_nombre, ec.cantidad, ec.fianza_total
         FROM envases_cliente ec
         JOIN clientes c ON c.id = ec.cliente_id
         JOIN productos p ON p.id = ec.producto_id
         WHERE ec.cantidad != 0
         ORDER BY c.nombre, p.nombre`
      )
      .all();
  });

  ipcMain.handle("envases:movimientos", (_e, clienteId?: number) => {
    const where = clienteId ? "WHERE em.cliente_id = ?" : "";
    const params = clienteId ? [clienteId] : [];
    return db
      .prepare(
        `SELECT em.*, c.nombre as cliente_nombre, p.nombre as producto_nombre
         FROM envase_movimientos em
         JOIN clientes c ON c.id = em.cliente_id
         JOIN productos p ON p.id = em.producto_id
         ${where}
         ORDER BY em.fecha DESC, em.id DESC`
      )
      .all(...params);
  });

  ipcMain.handle(
    "envases:devolucion",
    (_e, input: { cliente_id: number; producto_id: number; cantidad: number; fecha: string; nota?: string; reembolsar: boolean; caja_sesion_id?: number | null }) => {
      const cajaSesionId = validarSesionAbierta(db, input.caja_sesion_id);
      const run = db.transaction(() => {
        const saldo = db
          .prepare(`SELECT * FROM envases_cliente WHERE cliente_id = ? AND producto_id = ?`)
          .get(input.cliente_id, input.producto_id) as { cantidad: number; fianza_total: number } | undefined;

        if (!saldo || saldo.cantidad < input.cantidad) {
          throw new Error("El cliente no tiene esa cantidad de envases pendientes");
        }

        const producto = db.prepare(`SELECT fianza_envase FROM productos WHERE id = ?`).get(input.producto_id) as {
          fianza_envase: number;
        };
        const montoFianza = producto.fianza_envase * input.cantidad;

        db.prepare(
          `UPDATE envases_cliente SET cantidad = cantidad - @cantidad, fianza_total = fianza_total - @monto WHERE cliente_id=@cliente_id AND producto_id=@producto_id`
        ).run({ cantidad: input.cantidad, monto: montoFianza, cliente_id: input.cliente_id, producto_id: input.producto_id });

        db.prepare(
          `INSERT INTO envase_movimientos (cliente_id, producto_id, tipo, cantidad, fecha, nota, caja_sesion_id, monto_reembolsado)
           VALUES (@cliente_id, @producto_id, 'DEVOLUCION', @cantidad, @fecha, @nota, @caja_sesion_id, @monto_reembolsado)`
        ).run({
          cliente_id: input.cliente_id,
          producto_id: input.producto_id,
          cantidad: input.cantidad,
          fecha: input.fecha,
          nota: input.nota ?? null,
          caja_sesion_id: cajaSesionId,
          monto_reembolsado: input.reembolsar ? montoFianza : 0,
        });

        if (input.reembolsar && montoFianza > 0) {
          crearAsiento(db, {
            fecha: input.fecha,
            concepto: `Reembolso de deposito por devolucion de envases`,
            origen: "AJUSTE",
            lineas: [
              { cuenta_id: cuentaIdPorCodigo(db, CODIGO_DEPOSITOS_GARANTIA), debito: montoFianza, credito: 0 },
              { cuenta_id: cuentaIdPorCodigo(db, CODIGO_CAJA), debito: 0, credito: montoFianza },
            ],
          });
        }
      });
      run();
      return true;
    }
  );
}
