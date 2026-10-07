import { ipcMain } from "electron";
import type { DB } from "../db/sqlite";
import { crearAsiento } from "../db/contabilidad";
import type { Compra, CompraDetalle, NuevaCompraInput, PagoCompra, Producto } from "../shared/types";

const CODIGO_CAJA = "1.1.01";
const CODIGO_BANCO = "1.1.02";
const CODIGO_CXP = "2.1.01";

function cuentaIdPorCodigo(db: DB, codigo: string): number {
  const row = db.prepare(`SELECT id FROM cuentas_contables WHERE codigo = ?`).get(codigo) as { id: number } | undefined;
  if (!row) throw new Error(`Cuenta contable ${codigo} no existe`);
  return row.id;
}

export function registerComprasIpc(db: DB) {
  ipcMain.handle("compras:listar", () => {
    return db
      .prepare(
        `SELECT c.*, COALESCE((SELECT SUM(monto) FROM pagos_compra WHERE compra_id = c.id), 0) as pagado
         FROM compras c ORDER BY c.numero DESC`
      )
      .all() as Compra[];
  });

  ipcMain.handle("compras:obtener", (_e, id: number) => {
    const compra = db
      .prepare(
        `SELECT c.*, COALESCE((SELECT SUM(monto) FROM pagos_compra WHERE compra_id = c.id), 0) as pagado
         FROM compras c WHERE c.id = ?`
      )
      .get(id) as Compra | undefined;
    if (!compra) return undefined;
    const lineas = db
      .prepare(
        `SELECT cl.*, p.nombre as producto_nombre FROM compra_lineas cl
         JOIN productos p ON p.id = cl.producto_id WHERE cl.compra_id = ?`
      )
      .all(id);
    return { ...compra, lineas } as CompraDetalle;
  });

  ipcMain.handle("compras:crear", (_e, input: NuevaCompraInput) => {
    if (!input.lineas || input.lineas.length === 0) throw new Error("La compra debe tener al menos una linea");
    if (!input.proveedor?.trim()) throw new Error("El proveedor es obligatorio");

    const productos = new Map<number, Producto>();
    for (const l of input.lineas) {
      if (l.cantidad <= 0) throw new Error("La cantidad debe ser mayor a cero");
      if (!productos.has(l.producto_id)) {
        const p = db.prepare(`SELECT * FROM productos WHERE id = ?`).get(l.producto_id) as Producto | undefined;
        if (!p) throw new Error(`Producto ${l.producto_id} no existe`);
        productos.set(l.producto_id, p);
      }
    }

    const lineasCalc = input.lineas.map((l) => ({ ...l, producto: productos.get(l.producto_id)!, subtotal: l.cantidad * l.costo_unitario }));
    const total = lineasCalc.reduce((s, l) => s + l.subtotal, 0);

    const run = db.transaction(() => {
      const maxNumero = (db.prepare(`SELECT COALESCE(MAX(numero), 0) as m FROM compras`).get() as { m: number }).m;
      const estado = input.condicion_pago === "CONTADO" ? "PAGADA" : "PENDIENTE";

      const infoCompra = db
        .prepare(
          `INSERT INTO compras (numero, fecha, proveedor, condicion_pago, total, estado)
           VALUES (@numero, @fecha, @proveedor, @condicion_pago, @total, @estado)`
        )
        .run({ numero: maxNumero + 1, fecha: input.fecha, proveedor: input.proveedor.trim(), condicion_pago: input.condicion_pago, total, estado });
      const compraId = Number(infoCompra.lastInsertRowid);

      const insertLinea = db.prepare(
        `INSERT INTO compra_lineas (compra_id, producto_id, cantidad, costo_unitario, subtotal) VALUES (@compra_id, @producto_id, @cantidad, @costo_unitario, @subtotal)`
      );
      const inventarioPorCuenta = new Map<number, number>();

      for (const l of lineasCalc) {
        insertLinea.run({ compra_id: compraId, producto_id: l.producto_id, cantidad: l.cantidad, costo_unitario: l.costo_unitario, subtotal: l.subtotal });

        db.prepare(`UPDATE productos SET existencia = existencia + ? WHERE id = ?`).run(l.cantidad, l.producto_id);
        if (l.actualizarCosto) {
          db.prepare(`UPDATE productos SET costo_contenido = ? WHERE id = ?`).run(l.costo_unitario, l.producto_id);
        }

        if (l.producto.cuenta_inventario_id) {
          inventarioPorCuenta.set(l.producto.cuenta_inventario_id, (inventarioPorCuenta.get(l.producto.cuenta_inventario_id) ?? 0) + l.subtotal);
        }
      }

      const cuentaContrapartida = input.condicion_pago === "CONTADO" ? CODIGO_CAJA : CODIGO_CXP;
      const lineasAsiento = [];
      for (const [cuentaId, monto] of inventarioPorCuenta) {
        lineasAsiento.push({ cuenta_id: cuentaId, debito: Math.round(monto * 100) / 100, credito: 0, descripcion: `Compra #${maxNumero + 1} - ${input.proveedor}` });
      }
      lineasAsiento.push({ cuenta_id: cuentaIdPorCodigo(db, cuentaContrapartida), debito: 0, credito: Math.round(total * 100) / 100, descripcion: `Compra #${maxNumero + 1} - ${input.proveedor}` });

      const asientoId = crearAsiento(db, {
        fecha: input.fecha,
        concepto: `Compra de mercancia #${maxNumero + 1} a ${input.proveedor}`,
        origen: "AJUSTE",
        referencia_id: compraId,
        lineas: lineasAsiento,
      });

      db.prepare(`UPDATE compras SET asiento_id = ? WHERE id = ?`).run(asientoId, compraId);
      return compraId;
    });

    const compraId = run();
    return db.prepare(`SELECT * FROM compras WHERE id = ?`).get(compraId) as Compra;
  });

  ipcMain.handle("pagosCompra:listarPorCompra", (_e, compraId: number) => {
    return db.prepare(`SELECT * FROM pagos_compra WHERE compra_id = ? ORDER BY fecha DESC`).all(compraId) as PagoCompra[];
  });

  ipcMain.handle(
    "pagosCompra:crear",
    (_e, input: { compra_id: number; fecha: string; monto: number; metodo: PagoCompra["metodo"] }) => {
      const compra = db.prepare(`SELECT * FROM compras WHERE id = ?`).get(input.compra_id) as Compra | undefined;
      if (!compra) throw new Error("Compra no encontrada");

      const pagadoPrevio = (
        db.prepare(`SELECT COALESCE(SUM(monto), 0) as s FROM pagos_compra WHERE compra_id = ?`).get(input.compra_id) as { s: number }
      ).s;
      const saldoPendiente = compra.total - pagadoPrevio;
      if (input.monto <= 0) throw new Error("El monto debe ser mayor a cero");
      if (input.monto > saldoPendiente + 0.005) throw new Error(`El monto excede el saldo pendiente (RD$ ${saldoPendiente.toFixed(2)})`);

      const cuentaOrigen = input.metodo === "TRANSFERENCIA" ? CODIGO_BANCO : CODIGO_CAJA;

      const run = db.transaction(() => {
        const asientoId = crearAsiento(db, {
          fecha: input.fecha,
          concepto: `Pago a proveedor - Compra #${compra.numero} (${compra.proveedor})`,
          origen: "AJUSTE",
          referencia_id: input.compra_id,
          lineas: [
            { cuenta_id: cuentaIdPorCodigo(db, CODIGO_CXP), debito: input.monto, credito: 0 },
            { cuenta_id: cuentaIdPorCodigo(db, cuentaOrigen), debito: 0, credito: input.monto },
          ],
        });

        const info = db
          .prepare(`INSERT INTO pagos_compra (compra_id, fecha, monto, metodo, asiento_id) VALUES (@compra_id, @fecha, @monto, @metodo, @asiento_id)`)
          .run({ compra_id: input.compra_id, fecha: input.fecha, monto: input.monto, metodo: input.metodo, asiento_id: asientoId });

        if (input.monto >= saldoPendiente - 0.005) {
          db.prepare(`UPDATE compras SET estado = 'PAGADA' WHERE id = ?`).run(input.compra_id);
        }

        return info.lastInsertRowid;
      });

      const id = run();
      return db.prepare(`SELECT * FROM pagos_compra WHERE id = ?`).get(id) as PagoCompra;
    }
  );
}
