import { ipcMain } from "electron";
import type { DB } from "../db/types";
import { crearAsiento } from "../db/contabilidad";
import { validarSesionAbierta } from "./caja";
import type { Cobro, Factura } from "../shared/types";

const CODIGO_CAJA = "1.1.01";
const CODIGO_BANCO = "1.1.02";
const CODIGO_CXC = "1.1.03";

function cuentaIdPorCodigo(db: DB, codigo: string): number {
  const row = db.prepare(`SELECT id FROM cuentas_contables WHERE codigo = ?`).get(codigo) as { id: number } | undefined;
  if (!row) throw new Error(`Cuenta contable ${codigo} no existe`);
  return row.id;
}

export function registerCobrosIpc(db: DB) {
  ipcMain.handle("cobros:listarPorFactura", (_e, facturaId: number) => {
    return db.prepare(`SELECT * FROM cobros WHERE factura_id = ? ORDER BY fecha DESC`).all(facturaId) as Cobro[];
  });

  ipcMain.handle(
    "cobros:crear",
    (_e, input: { factura_id: number; fecha: string; monto: number; metodo: Cobro["metodo"]; nota?: string; caja_sesion_id?: number | null }) => {
      const cajaSesionId = validarSesionAbierta(db, input.caja_sesion_id);
      const factura = db.prepare(`SELECT * FROM facturas WHERE id = ?`).get(input.factura_id) as Factura | undefined;
      if (!factura) throw new Error("Factura no encontrada");
      if (factura.estado === "ANULADA") throw new Error("No se puede cobrar una factura anulada");

      const cobradoPrevio = (
        db.prepare(`SELECT COALESCE(SUM(monto), 0) as s FROM cobros WHERE factura_id = ?`).get(input.factura_id) as { s: number }
      ).s;
      const saldoPendiente = factura.total - cobradoPrevio;
      if (input.monto <= 0) throw new Error("El monto del cobro debe ser mayor a cero");
      if (input.monto > saldoPendiente + 0.005) throw new Error(`El monto excede el saldo pendiente (RD$ ${saldoPendiente.toFixed(2)})`);

      // Solo el efectivo entra a la gaveta; tarjeta, transferencia y cheque van al banco.
      const cuentaOrigen = input.metodo === "EFECTIVO" ? CODIGO_CAJA : CODIGO_BANCO;

      const run = db.transaction(() => {
        const asientoId = crearAsiento(db, {
          fecha: input.fecha,
          concepto: `Cobro factura ${factura.ncf ?? factura.numero}`,
          origen: "COBRO",
          referencia_id: input.factura_id,
          lineas: [
            { cuenta_id: cuentaIdPorCodigo(db, cuentaOrigen), debito: input.monto, credito: 0 },
            { cuenta_id: cuentaIdPorCodigo(db, CODIGO_CXC), debito: 0, credito: input.monto },
          ],
        });

        const info = db
          .prepare(
            `INSERT INTO cobros (factura_id, fecha, monto, metodo, asiento_id, nota, caja_sesion_id) VALUES (@factura_id, @fecha, @monto, @metodo, @asiento_id, @nota, @caja_sesion_id)`
          )
          .run({ factura_id: input.factura_id, fecha: input.fecha, monto: input.monto, metodo: input.metodo, asiento_id: asientoId, nota: input.nota ?? null, caja_sesion_id: cajaSesionId });

        if (input.monto >= saldoPendiente - 0.005) {
          db.prepare(`UPDATE facturas SET estado = 'PAGADA' WHERE id = ?`).run(input.factura_id);
        }

        return info.lastInsertRowid;
      });

      const id = run();
      return db.prepare(`SELECT * FROM cobros WHERE id = ?`).get(id) as Cobro;
    }
  );
}
