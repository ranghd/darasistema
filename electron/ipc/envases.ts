import { ipcMain } from "electron";
import type { DB } from "../db/types";
import { crearAsiento } from "../db/contabilidad";

const CODIGO_CAJA = "1.1.01";
const CODIGO_DEPOSITOS_GARANTIA = "2.1.03";

function cuentaIdPorCodigo(db: DB, codigo: string): number {
  const row = db.prepare(`SELECT id FROM cuentas_contables WHERE codigo = ?`).get(codigo) as { id: number } | undefined;
  if (!row) throw new Error(`Cuenta contable ${codigo} no existe`);
  return row.id;
}

export function registerEnvasesIpc(db: DB) {
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
    (_e, input: { cliente_id: number; producto_id: number; cantidad: number; fecha: string; nota?: string; reembolsar: boolean }) => {
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
          `INSERT INTO envase_movimientos (cliente_id, producto_id, tipo, cantidad, fecha, nota) VALUES (@cliente_id, @producto_id, 'DEVOLUCION', @cantidad, @fecha, @nota)`
        ).run({ cliente_id: input.cliente_id, producto_id: input.producto_id, cantidad: input.cantidad, fecha: input.fecha, nota: input.nota ?? null });

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
