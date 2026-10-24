import { ipcMain } from "electron";
import type { DB } from "../db/types";
import { crearAsiento, cuentaDeBanco, fechaHoyRD } from "../db/contabilidad";
import { validarSesionAbierta } from "./caja";
import type { Cobro, Factura, FacturaPendiente, NuevoReciboInput, ReciboCobro, ReciboDetalle } from "../shared/types";

const CODIGO_CAJA = "1.1.01";
const CODIGO_CXC = "1.1.03";

function cuentaIdPorCodigo(db: DB, codigo: string): number {
  const row = db.prepare(`SELECT id FROM cuentas_contables WHERE codigo = ?`).get(codigo) as { id: number } | undefined;
  if (!row) throw new Error(`Cuenta contable ${codigo} no existe`);
  return row.id;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

// Solo el efectivo entra a la gaveta; tarjeta, transferencia y cheque van al banco elegido.
function cuentaDelCobro(db: DB, metodo: Cobro["metodo"], bancoId?: number | null): { cuenta_id: number; banco_id: number | null } {
  if (metodo === "EFECTIVO") return { cuenta_id: cuentaIdPorCodigo(db, CODIGO_CAJA), banco_id: null };
  return cuentaDeBanco(db, bancoId);
}

// Facturas a credito de un cliente que todavia deben algo, de la mas vieja a la mas nueva.
export function facturasPendientes(db: DB, clienteId: number): FacturaPendiente[] {
  return db
    .prepare(
      `SELECT f.id, f.numero, f.ncf, f.fecha, f.total,
              COALESCE((SELECT SUM(monto) FROM cobros WHERE factura_id = f.id), 0) AS cobrado,
              CAST(julianday(@hoy) - julianday(f.fecha) AS INTEGER) AS dias
       FROM facturas f
       WHERE f.cliente_id = @cliente AND f.condicion_pago = 'CREDITO' AND f.estado = 'PENDIENTE'
       ORDER BY f.fecha, f.numero`
    )
    .all({ cliente: clienteId, hoy: fechaHoyRD() })
    .map((f: any) => ({ ...f, saldo: r2(f.total - f.cobrado) })) as FacturaPendiente[];
}

export function registerCobrosIpc(db: DB) {
  ipcMain.handle("cobros:listarPorFactura", (_e, facturaId: number) => {
    return db
      .prepare(
        `SELECT c.*, r.numero AS recibo_numero, b.nombre AS banco_nombre FROM cobros c
         LEFT JOIN recibos_cobro r ON r.id = c.recibo_id LEFT JOIN bancos b ON b.id = c.banco_id
         WHERE c.factura_id = ? ORDER BY c.fecha DESC, c.id DESC`
      )
      .all(facturaId) as Cobro[];
  });

  ipcMain.handle(
    "cobros:crear",
    (
      _e,
      input: { factura_id: number; fecha: string; monto: number; metodo: Cobro["metodo"]; nota?: string; caja_sesion_id?: number | null; banco_id?: number | null; referencia?: string }
    ) => {
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

      const origen = cuentaDelCobro(db, input.metodo, input.banco_id);

      const run = db.transaction(() => {
        const asientoId = crearAsiento(db, {
          fecha: input.fecha,
          concepto: `Cobro factura ${factura.ncf ?? factura.numero}`,
          origen: "COBRO",
          referencia_id: input.factura_id,
          lineas: [
            { cuenta_id: origen.cuenta_id, debito: input.monto, credito: 0, descripcion: input.referencia ? `Ref. ${input.referencia}` : undefined },
            { cuenta_id: cuentaIdPorCodigo(db, CODIGO_CXC), debito: 0, credito: input.monto },
          ],
        });

        const info = db
          .prepare(
            `INSERT INTO cobros (factura_id, fecha, monto, metodo, asiento_id, nota, caja_sesion_id, banco_id, referencia)
             VALUES (@factura_id, @fecha, @monto, @metodo, @asiento_id, @nota, @caja_sesion_id, @banco_id, @referencia)`
          )
          .run({
            factura_id: input.factura_id,
            fecha: input.fecha,
            monto: input.monto,
            metodo: input.metodo,
            asiento_id: asientoId,
            nota: input.nota ?? null,
            caja_sesion_id: cajaSesionId,
            banco_id: origen.banco_id,
            referencia: input.referencia?.trim() || null,
          });

        if (input.monto >= saldoPendiente - 0.005) {
          db.prepare(`UPDATE facturas SET estado = 'PAGADA' WHERE id = ?`).run(input.factura_id);
        }

        return info.lastInsertRowid;
      });

      const id = run();
      return db.prepare(`SELECT * FROM cobros WHERE id = ?`).get(id) as Cobro;
    }
  );

  // ---------- Recibos de cobro (un pago para varias facturas) ----------

  ipcMain.handle("recibos:pendientes", (_e, clienteId: number) => facturasPendientes(db, clienteId));

  ipcMain.handle("recibos:crear", (_e, input: NuevoReciboInput): ReciboDetalle => {
    const cajaSesionId = validarSesionAbierta(db, input.caja_sesion_id);
    const cliente = db.prepare(`SELECT id, nombre FROM clientes WHERE id = ?`).get(input.cliente_id) as { id: number; nombre: string } | undefined;
    if (!cliente) throw new Error("Cliente no encontrado");
    const monto = r2(Number(input.monto));
    if (!(monto > 0)) throw new Error("El monto recibido debe ser mayor a cero");

    const pendientes = facturasPendientes(db, cliente.id);
    const porId = new Map(pendientes.map((f) => [f.id, f]));
    const deuda = r2(pendientes.reduce((s, f) => s + f.saldo, 0));
    if (pendientes.length === 0) throw new Error("Este cliente no tiene facturas pendientes");

    // Si no se indica a que facturas va, se paga de la mas vieja a la mas nueva.
    let aplicaciones: { factura_id: number; monto: number }[];
    if (input.aplicaciones && input.aplicaciones.length > 0) {
      aplicaciones = input.aplicaciones.filter((a) => Number(a.monto) > 0).map((a) => ({ factura_id: a.factura_id, monto: r2(Number(a.monto)) }));
      for (const a of aplicaciones) {
        const f = porId.get(a.factura_id);
        if (!f) throw new Error("Una de las facturas elegidas no esta pendiente o no es de este cliente");
        if (a.monto > f.saldo + 0.005) throw new Error(`A la factura ${f.ncf ?? f.numero} se le aplica mas de lo que debe (RD$ ${f.saldo.toFixed(2)})`);
      }
      const suma = r2(aplicaciones.reduce((s, a) => s + a.monto, 0));
      if (Math.abs(suma - monto) > 0.005) throw new Error(`Lo repartido entre las facturas (RD$ ${suma.toFixed(2)}) no es igual al monto recibido`);
    } else {
      if (monto > deuda + 0.005) throw new Error(`El monto es mayor que lo que debe el cliente (RD$ ${deuda.toFixed(2)})`);
      aplicaciones = [];
      let resto = monto;
      for (const f of pendientes) {
        if (resto <= 0.005) break;
        const parte = r2(Math.min(resto, f.saldo));
        aplicaciones.push({ factura_id: f.id, monto: parte });
        resto = r2(resto - parte);
      }
    }
    if (aplicaciones.length === 0) throw new Error("No hay facturas a las que aplicar el pago");

    const origen = cuentaDelCobro(db, input.metodo, input.banco_id);
    const referencia = input.referencia?.trim() || null;

    const id = db.transaction(() => {
      const numero = (db.prepare(`SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM recibos_cobro`).get() as { n: number }).n;
      const asientoId = crearAsiento(db, {
        fecha: input.fecha,
        concepto: `Recibo de cobro #${numero} - ${cliente.nombre}`,
        origen: "COBRO",
        lineas: [
          { cuenta_id: origen.cuenta_id, debito: monto, credito: 0, descripcion: referencia ? `Recibo #${numero} ref. ${referencia}` : `Recibo #${numero}` },
          { cuenta_id: cuentaIdPorCodigo(db, CODIGO_CXC), debito: 0, credito: monto, descripcion: `Recibo #${numero}` },
        ],
      });
      const reciboId = Number(
        db
          .prepare(
            `INSERT INTO recibos_cobro (numero, cliente_id, fecha, monto, metodo, banco_id, referencia, nota, asiento_id, caja_sesion_id, creado_por)
             VALUES (@numero, @cliente_id, @fecha, @monto, @metodo, @banco_id, @referencia, @nota, @asiento_id, @caja_sesion_id, @creado_por)`
          )
          .run({
            numero,
            cliente_id: cliente.id,
            fecha: input.fecha,
            monto,
            metodo: input.metodo,
            banco_id: origen.banco_id,
            referencia,
            nota: input.nota?.trim() || null,
            asiento_id: asientoId,
            caja_sesion_id: cajaSesionId,
            creado_por: input.creado_por?.trim() || null,
          }).lastInsertRowid
      );
      const insertCobro = db.prepare(
        `INSERT INTO cobros (factura_id, fecha, monto, metodo, asiento_id, nota, caja_sesion_id, recibo_id, banco_id, referencia)
         VALUES (@factura_id, @fecha, @monto, @metodo, @asiento_id, @nota, @caja_sesion_id, @recibo_id, @banco_id, @referencia)`
      );
      for (const a of aplicaciones) {
        insertCobro.run({
          factura_id: a.factura_id,
          fecha: input.fecha,
          monto: a.monto,
          metodo: input.metodo,
          asiento_id: asientoId,
          nota: `Recibo #${numero}`,
          caja_sesion_id: cajaSesionId,
          recibo_id: reciboId,
          banco_id: origen.banco_id,
          referencia,
        });
        if (a.monto >= porId.get(a.factura_id)!.saldo - 0.005) db.prepare(`UPDATE facturas SET estado = 'PAGADA' WHERE id = ?`).run(a.factura_id);
      }
      return reciboId;
    })();
    return obtenerRecibo(db, id)!;
  });

  ipcMain.handle("recibos:listar", (_e, filtros: { cliente_id?: number; desde?: string; hasta?: string } = {}) => {
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (filtros.cliente_id) (where.push("r.cliente_id = @cliente"), (params.cliente = filtros.cliente_id));
    if (filtros.desde) (where.push("r.fecha >= @desde"), (params.desde = filtros.desde));
    if (filtros.hasta) (where.push("r.fecha <= @hasta"), (params.hasta = filtros.hasta));
    return db
      .prepare(
        `SELECT r.*, c.nombre AS cliente_nombre, b.nombre AS banco_nombre,
                (SELECT COUNT(*) FROM cobros WHERE recibo_id = r.id) AS facturas
         FROM recibos_cobro r JOIN clientes c ON c.id = r.cliente_id LEFT JOIN bancos b ON b.id = r.banco_id
         ${where.length ? "WHERE " + where.join(" AND ") : ""}
         ORDER BY r.fecha DESC, r.numero DESC`
      )
      .all(params) as ReciboCobro[];
  });

  ipcMain.handle("recibos:obtener", (_e, id: number) => obtenerRecibo(db, id));
}

function obtenerRecibo(db: DB, id: number): ReciboDetalle | undefined {
  const recibo = db
    .prepare(
      `SELECT r.*, c.nombre AS cliente_nombre, c.rnc_cedula AS cliente_rnc, b.nombre AS banco_nombre
       FROM recibos_cobro r JOIN clientes c ON c.id = r.cliente_id LEFT JOIN bancos b ON b.id = r.banco_id WHERE r.id = ?`
    )
    .get(id) as ReciboDetalle | undefined;
  if (!recibo) return undefined;
  const aplicaciones = db
    .prepare(
      `SELECT co.factura_id, co.monto, f.numero, f.ncf, f.fecha, f.total,
              f.total - COALESCE((SELECT SUM(monto) FROM cobros x WHERE x.factura_id = f.id AND x.id <= co.id), 0) AS saldo_despues
       FROM cobros co JOIN facturas f ON f.id = co.factura_id WHERE co.recibo_id = ? ORDER BY f.fecha, f.numero`
    )
    .all(id) as ReciboDetalle["aplicaciones"];
  return { ...recibo, aplicaciones };
}
