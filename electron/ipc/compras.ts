import { ipcMain } from "electron";
import type { DB } from "../db/types";
import { crearAsiento, cuentaDeBanco } from "../db/contabilidad";
import { buscarOCrearProveedor, registrarPrecioProveedor } from "../db/proveedores";
import type { Compra, CompraDetalle, NuevaCompraInput, PagoCompra, Producto } from "../shared/types";
import { autorValido, calcularResumen, validarSesionAbierta } from "./caja";
import { ahoraRD } from "../db/contabilidad";
import { comprarPiezas } from "./piezas";

const CODIGO_CAJA = "1.1.01";
const CODIGO_CXP = "2.1.01";

function cuentaIdPorCodigo(db: DB, codigo: string): number {
  const row = db.prepare(`SELECT id FROM cuentas_contables WHERE codigo = ?`).get(codigo) as { id: number } | undefined;
  if (!row) throw new Error(`Cuenta contable ${codigo} no existe`);
  return row.id;
}

// Cuenta a la que va el costo de las piezas: se venden por porciones y no llevan existencia, asi que
// van directo al costo de venta de sus productos (o a la primera cuenta de costo si no tienen).
function cuentaCostoPiezas(db: DB, mercanciaId: number): number {
  const p = db
    .prepare(`SELECT cuenta_costo_id FROM productos WHERE mercancia_id = ? AND cuenta_costo_id IS NOT NULL ORDER BY activo DESC, id LIMIT 1`)
    .get(mercanciaId) as { cuenta_costo_id: number } | undefined;
  if (p) return p.cuenta_costo_id;
  const c = db.prepare(`SELECT id FROM cuentas_contables WHERE codigo LIKE '5.%' AND codigo LIKE '%.%.%' ORDER BY codigo LIMIT 1`).get() as { id: number } | undefined;
  if (!c) throw new Error("No hay cuenta de costo de venta para las piezas");
  return c.id;
}

export function registerComprasIpc(db: DB) {
  ipcMain.handle("compras:listar", (_e, proveedorId?: number) => {
    return db
      .prepare(
        `SELECT c.id, c.numero, c.fecha, COALESCE(pr.nombre, c.proveedor) AS proveedor, c.proveedor_id, c.ncf, c.condicion_pago,
                c.total, c.estado, c.asiento_id, c.creado_en,
                COALESCE((SELECT SUM(monto) FROM pagos_compra WHERE compra_id = c.id), 0) as pagado
         FROM compras c LEFT JOIN proveedores pr ON pr.id = c.proveedor_id
         ${proveedorId ? "WHERE c.proveedor_id = @proveedor_id" : ""}
         ORDER BY c.numero DESC`
      )
      .all(proveedorId ? { proveedor_id: proveedorId } : {}) as Compra[];
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
    const piezas = db
      .prepare(
        `SELECT m.nombre AS mercancia_nombre, m.pieza, COUNT(*) AS cantidad, SUM(pz.costo) AS subtotal
         FROM piezas pz JOIN mercancias m ON m.id = pz.mercancia_id WHERE pz.compra_id = ? GROUP BY pz.mercancia_id`
      )
      .all(id);
    return { ...compra, lineas, piezas } as CompraDetalle;
  });

  ipcMain.handle("compras:crear", (_e, input: NuevaCompraInput) => {
    const piezas = input.piezas ?? [];
    if ((!input.lineas || input.lineas.length === 0) && piezas.length === 0) throw new Error("La compra debe tener al menos una linea");
    input.lineas = input.lineas ?? [];
    // Pagada con el efectivo de la caja abierta: sale del cuadre de esa jornada.
    const sesionCaja = input.caja_sesion_id && input.condicion_pago === "CONTADO" ? validarSesionAbierta(db, input.caja_sesion_id) : null;
    const autor = piezas.length > 0 || sesionCaja ? autorValido(input.autor) : null;
    for (const pz of piezas) {
      if (!Number.isInteger(Number(pz.cantidad)) || pz.cantidad < 1) throw new Error("La cantidad de piezas debe ser un numero entero mayor a cero");
      if (!(pz.costo_unitario > 0)) throw new Error("Escribe lo que costo cada pieza");
    }
    let nombreProveedor = "";
    if (input.proveedor_id) {
      const p = db.prepare(`SELECT nombre FROM proveedores WHERE id = ?`).get(input.proveedor_id) as { nombre: string } | undefined;
      if (!p) throw new Error("El proveedor seleccionado no existe");
      nombreProveedor = p.nombre;
    } else {
      nombreProveedor = input.proveedor?.trim() ?? "";
      if (!nombreProveedor) throw new Error("El proveedor es obligatorio");
    }

    const productos = new Map<number, Producto>();
    for (const l of input.lineas) {
      if (l.cantidad <= 0) throw new Error("La cantidad debe ser mayor a cero");
      if (!productos.has(l.producto_id)) {
        const p = db.prepare(`SELECT * FROM productos WHERE id = ?`).get(l.producto_id) as Producto | undefined;
        if (!p || p.borrado) throw new Error(`Producto ${l.producto_id} no existe`);
        productos.set(l.producto_id, p);
      }
    }

    const lineasCalc = input.lineas.map((l) => ({ ...l, producto: productos.get(l.producto_id)!, subtotal: l.cantidad * l.costo_unitario }));
    const piezasCalc = piezas.map((pz) => ({ ...pz, subtotal: Math.round(pz.cantidad * pz.costo_unitario * 100) / 100 }));
    const total = lineasCalc.reduce((s, l) => s + l.subtotal, 0) + piezasCalc.reduce((s, pz) => s + pz.subtotal, 0);
    if (sesionCaja) {
      const disponible = calcularResumen(db, sesionCaja).efectivo_esperado;
      if (total > disponible + 0.005) throw new Error(`No hay suficiente efectivo en la caja para pagar la compra: deberia haber ${disponible.toFixed(2)}`);
    }

    const run = db.transaction(() => {
      const proveedorId = input.proveedor_id ?? buscarOCrearProveedor(db, nombreProveedor);
      // Usar el nombre tal como esta guardado (aunque lo hayan escrito con otro formato).
      nombreProveedor = (db.prepare(`SELECT nombre FROM proveedores WHERE id = ?`).get(proveedorId) as { nombre: string }).nombre;
      const maxNumero = (db.prepare(`SELECT COALESCE(MAX(numero), 0) as m FROM compras`).get() as { m: number }).m;
      const estado = input.condicion_pago === "CONTADO" ? "PAGADA" : "PENDIENTE";

      const infoCompra = db
        .prepare(
          `INSERT INTO compras (numero, fecha, proveedor, proveedor_id, condicion_pago, total, estado, ncf)
           VALUES (@numero, @fecha, @proveedor, @proveedor_id, @condicion_pago, @total, @estado, @ncf)`
        )
        .run({ numero: maxNumero + 1, fecha: input.fecha, proveedor: nombreProveedor, proveedor_id: proveedorId, condicion_pago: input.condicion_pago, total, estado, ncf: input.ncf?.trim().toUpperCase() || null });
      const compraId = Number(infoCompra.lastInsertRowid);

      const insertLinea = db.prepare(
        `INSERT INTO compra_lineas (compra_id, producto_id, cantidad, costo_unitario, subtotal) VALUES (@compra_id, @producto_id, @cantidad, @costo_unitario, @subtotal)`
      );
      const inventarioPorCuenta = new Map<number, number>();

      for (const l of lineasCalc) {
        insertLinea.run({ compra_id: compraId, producto_id: l.producto_id, cantidad: l.cantidad, costo_unitario: l.costo_unitario, subtotal: l.subtotal });
        registrarPrecioProveedor(db, proveedorId, l.producto_id, l.costo_unitario, input.fecha);

        // Costo promedio ponderado: mezcla lo que habia con lo que entra, asi el
        // inventario en la contabilidad siempre es existencia x costo.
        const actual = db.prepare(`SELECT existencia, costo_contenido FROM productos WHERE id = ?`).get(l.producto_id) as { existencia: number; costo_contenido: number };
        const nuevaExistencia = actual.existencia + l.cantidad;
        const costoPromedio =
          actual.existencia > 0 && nuevaExistencia > 0
            ? (actual.existencia * actual.costo_contenido + l.subtotal) / nuevaExistencia
            : l.costo_unitario;
        db.prepare(`UPDATE productos SET existencia = ?, costo_contenido = ? WHERE id = ?`).run(
          nuevaExistencia,
          Math.round(costoPromedio * 10000) / 10000,
          l.producto_id
        );

        if (l.producto.cuenta_inventario_id) {
          inventarioPorCuenta.set(l.producto.cuenta_inventario_id, (inventarioPorCuenta.get(l.producto.cuenta_inventario_id) ?? 0) + l.subtotal);
        }
      }

      for (const pz of piezasCalc) {
        comprarPiezas(db, { mercancia_id: pz.mercancia_id, cantidad: pz.cantidad, costo_total: pz.subtotal, ganancia_pct: pz.ganancia_pct }, autor!, compraId);
        const cuenta = cuentaCostoPiezas(db, pz.mercancia_id);
        inventarioPorCuenta.set(cuenta, (inventarioPorCuenta.get(cuenta) ?? 0) + pz.subtotal);
      }

      const cuentaContrapartida = input.condicion_pago === "CONTADO" ? CODIGO_CAJA : CODIGO_CXP;
      const lineasAsiento = [];
      for (const [cuentaId, monto] of inventarioPorCuenta) {
        lineasAsiento.push({ cuenta_id: cuentaId, debito: Math.round(monto * 100) / 100, credito: 0, descripcion: `Compra #${maxNumero + 1} - ${nombreProveedor}` });
      }
      lineasAsiento.push({ cuenta_id: cuentaIdPorCodigo(db, cuentaContrapartida), debito: 0, credito: Math.round(total * 100) / 100, descripcion: `Compra #${maxNumero + 1} - ${nombreProveedor}` });

      const asientoId = crearAsiento(db, {
        fecha: input.fecha,
        concepto: `Compra de mercancia #${maxNumero + 1} a ${nombreProveedor}`,
        origen: "AJUSTE",
        referencia_id: compraId,
        lineas: lineasAsiento,
      });

      db.prepare(`UPDATE compras SET asiento_id = ? WHERE id = ?`).run(asientoId, compraId);
      if (sesionCaja) {
        db.prepare(
          `INSERT INTO caja_movimientos (sesion_id, tipo, motivo, concepto, monto, usuario_id, usuario_nombre, asiento_id, creado_en) VALUES (?, 'SALIDA', 'COMPRA', ?, ?, ?, ?, ?, ?)`
        ).run(sesionCaja, `Compra #${maxNumero + 1} a ${nombreProveedor}`, Math.round(total * 100) / 100, autor!.id ?? null, autor!.nombre, asientoId, ahoraRD());
      }
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
    (_e, input: { compra_id: number; fecha: string; monto: number; metodo: PagoCompra["metodo"]; banco_id?: number | null; referencia?: string }) => {
      const compra = db.prepare(`SELECT * FROM compras WHERE id = ?`).get(input.compra_id) as Compra | undefined;
      if (!compra) throw new Error("Compra no encontrada");

      const pagadoPrevio = (
        db.prepare(`SELECT COALESCE(SUM(monto), 0) as s FROM pagos_compra WHERE compra_id = ?`).get(input.compra_id) as { s: number }
      ).s;
      const saldoPendiente = compra.total - pagadoPrevio;
      if (input.monto <= 0) throw new Error("El monto debe ser mayor a cero");
      if (input.monto > saldoPendiente + 0.005) throw new Error(`El monto excede el saldo pendiente (RD$ ${saldoPendiente.toFixed(2)})`);

      // El efectivo sale de la caja; transferencia, cheque y tarjeta salen del banco elegido.
      const origen = input.metodo === "EFECTIVO" ? { cuenta_id: cuentaIdPorCodigo(db, CODIGO_CAJA), banco_id: null } : cuentaDeBanco(db, input.banco_id);

      const run = db.transaction(() => {
        const asientoId = crearAsiento(db, {
          fecha: input.fecha,
          concepto: `Pago a proveedor - Compra #${compra.numero} (${compra.proveedor})`,
          origen: "AJUSTE",
          referencia_id: input.compra_id,
          lineas: [
            { cuenta_id: cuentaIdPorCodigo(db, CODIGO_CXP), debito: input.monto, credito: 0 },
            { cuenta_id: origen.cuenta_id, debito: 0, credito: input.monto, descripcion: input.referencia ? `Ref. ${input.referencia}` : undefined },
          ],
        });

        const info = db
          .prepare(
            `INSERT INTO pagos_compra (compra_id, fecha, monto, metodo, asiento_id, banco_id, referencia) VALUES (@compra_id, @fecha, @monto, @metodo, @asiento_id, @banco_id, @referencia)`
          )
          .run({ compra_id: input.compra_id, fecha: input.fecha, monto: input.monto, metodo: input.metodo, asiento_id: asientoId, banco_id: origen.banco_id, referencia: input.referencia?.trim() || null });

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
