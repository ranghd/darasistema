import { ipcMain } from "electron";
import type { DB } from "../db/types";
import { crearAsiento, fechaHoyRD } from "../db/contabilidad";
import { validarSesionAbierta } from "./caja";
import { platoDelDia } from "./platos";
import type { Factura, FacturaDetalle, NotaFactura, NuevaFacturaInput, Producto, TipoNcf } from "../shared/types";
import { NCF_LABELS, TIPOS_NCF_VENTA, tipoNcfRecibido, type TipoNcfVenta } from "../shared/ncf";

const CODIGO_CAJA = "1.1.01";
const CODIGO_BANCO = "1.1.02";
const CODIGO_CXC = "1.1.03";

// Solo el efectivo entra a la gaveta (Caja General); tarjeta, transferencia y cheque llegan al banco.
function codigoCobroContado(metodoPago?: string | null): string {
  return !metodoPago || metodoPago === "EFECTIVO" ? CODIGO_CAJA : CODIGO_BANCO;
}

function cuentaCobroContado(db: DB, metodoPago?: string): number {
  return cuentaIdPorCodigo(db, codigoCobroContado(metodoPago));
}
const CODIGO_ITBIS_PAGAR = "2.1.02";
const CODIGO_DEPOSITOS_GARANTIA = "2.1.03";

function cuentaIdPorCodigo(db: DB, codigo: string): number {
  const row = db.prepare(`SELECT id FROM cuentas_contables WHERE codigo = ?`).get(codigo) as { id: number } | undefined;
  if (!row) throw new Error(`Cuenta contable ${codigo} no existe. Revise el catalogo de cuentas.`);
  return row.id;
}

function tomarSiguienteNcf(db: DB, tipo: TipoNcf): string {
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

// Para documentos que no deben bloquear el flujo si no hay secuencia configurada
// (ej. Nota de Credito al anular, que es deseable pero no obligatoria en el demo).
function intentarTomarSiguienteNcf(db: DB, tipo: TipoNcf): string | null {
  try {
    return tomarSiguienteNcf(db, tipo);
  } catch {
    return null;
  }
}

export function registerFacturasIpc(db: DB) {
  // Se prepara al usarla, no aqui: en modo nube estas funciones se registran con una base vacia
  // solo para saber los nombres de los canales.
  const guardarNota = {
    run: (datos: Record<string, unknown>) =>
      db
        .prepare(
          `INSERT INTO notas_factura (tipo, ncf, factura_id, fecha, motivo, monto, itbis, total, anulacion, asiento_id) VALUES (@tipo, @ncf, @factura_id, @fecha, @motivo, @monto, @itbis, @total, @anulacion, @asiento_id)`
        )
        .run(datos),
  };

  // Historial de notas de credito y debito de un periodo, con su factura y su cliente.
  ipcMain.handle("notas:listar", (_e, desde?: string, hasta?: string): NotaFactura[] => {
    const hoy = fechaHoyRD();
    return db
      .prepare(
        `SELECT n.*, f.ncf AS factura_ncf, f.numero AS factura_numero, c.rnc_cedula,
                CASE WHEN c.codigo = 'CLI-0000' AND COALESCE(f.nombre_cliente, '') != '' THEN f.nombre_cliente ELSE c.nombre END AS cliente_nombre
         FROM notas_factura n JOIN facturas f ON f.id = n.factura_id JOIN clientes c ON c.id = f.cliente_id
         WHERE n.fecha BETWEEN @desde AND @hasta ORDER BY n.fecha DESC, n.id DESC`
      )
      .all({ desde: desde || hoy.slice(0, 7) + "-01", hasta: hasta || hoy }) as NotaFactura[];
  });

  ipcMain.handle("facturas:listar", () => {
    return db
      .prepare(
        `SELECT f.*, COALESCE(NULLIF(f.nombre_cliente, ''), c.nombre) as cliente_nombre,
                COALESCE((SELECT SUM(monto) FROM cobros WHERE factura_id = f.id), 0) as cobrado
         FROM facturas f JOIN clientes c ON c.id = f.cliente_id
         ORDER BY f.numero DESC`
      )
      .all() as Factura[];
  });

  ipcMain.handle("facturas:obtener", (_e, id: number) => {
    const factura = db
      .prepare(
        `SELECT f.*, COALESCE(NULLIF(f.nombre_cliente, ''), c.nombre) as cliente_nombre,
                COALESCE((SELECT SUM(monto) FROM cobros WHERE factura_id = f.id), 0) as cobrado
         FROM facturas f JOIN clientes c ON c.id = f.cliente_id WHERE f.id = ?`
      )
      .get(id) as Factura | undefined;
    if (!factura) return undefined;
    const lineas = db
      .prepare(
        `SELECT fl.*, p.nombre as producto_nombre, p.maneja_envase, p.fianza_envase FROM factura_lineas fl
         JOIN productos p ON p.id = fl.producto_id WHERE fl.factura_id = ?`
      )
      .all(id);
    return { ...factura, lineas } as FacturaDetalle;
  });

  ipcMain.handle("facturas:crear", (_e, input: NuevaFacturaInput) => {
    if (!input.lineas || input.lineas.length === 0) throw new Error("La factura debe tener al menos una linea");
    const tipoNcf = tipoNcfRecibido(input.tipo_ncf, input.codigos_ncf) as TipoNcfVenta;
    if (!TIPOS_NCF_VENTA.includes(tipoNcf)) throw new Error(`Tipo de comprobante no valido para una factura: ${input.tipo_ncf}. Use ${TIPOS_NCF_VENTA.map((t) => NCF_LABELS[t]).join(", ")}.`);
    const cajaSesionId = validarSesionAbierta(db, input.caja_sesion_id);
    if (input.lineas.some((l) => l.prestado)) {
      const cli = db.prepare(`SELECT codigo FROM clientes WHERE id = ?`).get(input.cliente_id) as { codigo: string } | undefined;
      if (!cli || cli.codigo === "CLI-0000") throw new Error("Para prestar un cilindro escribe el nombre de quien se lo lleva");
    }

    const productos = new Map<number, Producto>();
    const platos = new Map<number, ReturnType<typeof platoDelDia>>();
    for (const l of input.lineas) {
      if (!productos.has(l.producto_id)) {
        const p = db.prepare(`SELECT * FROM productos WHERE id = ?`).get(l.producto_id) as Producto | undefined;
        if (!p) throw new Error(`Producto ${l.producto_id} no existe`);
        // Un plato del dia ademas no puede pasar de las porciones de hoy.
        const plato = platoDelDia(db, input.fecha, l.producto_id);
        if (plato) {
          const pedidas = input.lineas.filter((x) => x.producto_id === l.producto_id).reduce((s, x) => s + x.cantidad, 0);
          if (pedidas > plato.quedan) throw new Error(plato.quedan > 0 ? `Solo quedan ${plato.quedan} porciones de ${p.nombre}` : `Se acabo ${p.nombre}`);
        }
        if (p.existencia < l.cantidad) throw new Error(`Existencia insuficiente de ${p.nombre} (disponible: ${p.existencia})`);
        productos.set(l.producto_id, p);
        platos.set(l.producto_id, plato);
      }
    }

    let subtotal = 0;
    let itbisTotal = 0;
    let fianzaTotal = 0;
    const lineasCalc = input.lineas.map((l) => {
      const producto = productos.get(l.producto_id)!;
      const exacto = l.cantidad * l.precio_unitario - l.descuento;
      const bruto = Math.round(exacto * 100) / 100;
      // El ITBIS sale de redondear el precio final: asi un precio final redondo (ej. RD$1,300) da justo ese total
      // aunque el precio sin ITBIS tenga mas de dos decimales. Con precios de dos decimales da lo mismo que antes.
      const itbisLinea = Math.round((Math.round(exacto * (1 + (producto.itbis_rate ?? 0.18)) * 100) / 100 - bruto) * 100) / 100;
      const fianzaLinea = l.modalidad === "LLENO" && producto.maneja_envase ? producto.fianza_envase * l.cantidad : 0;
      subtotal += bruto;
      itbisTotal += itbisLinea;
      fianzaTotal += fianzaLinea;
      return { ...l, subtotal: bruto, itbis: itbisLinea, fianzaLinea, producto };
    });
    const total = subtotal + itbisTotal + fianzaTotal;

    const run = db.transaction(() => {
      const ncf = tomarSiguienteNcf(db, tipoNcf);
      const maxNumero = (db.prepare(`SELECT COALESCE(MAX(numero), 0) as m FROM facturas`).get() as { m: number }).m;

      const estadoInicial = input.condicion_pago === "CONTADO" ? "PAGADA" : "PENDIENTE";

      const infoFactura = db
        .prepare(
          `INSERT INTO facturas (numero, ncf, cliente_id, fecha, condicion_pago, metodo_pago, subtotal, itbis, fianza_total, total, estado, creado_por, caja_sesion_id, nombre_cliente)
           VALUES (@numero, @ncf, @cliente_id, @fecha, @condicion_pago, @metodo_pago, @subtotal, @itbis, @fianza_total, @total, @estado, @creado_por, @caja_sesion_id, @nombre_cliente)`
        )
        .run({
          numero: maxNumero + 1,
          ncf,
          cliente_id: input.cliente_id,
          fecha: input.fecha,
          condicion_pago: input.condicion_pago,
          metodo_pago: input.condicion_pago === "CONTADO" ? input.metodo_pago ?? "EFECTIVO" : null,
          estado: estadoInicial,
          subtotal,
          itbis: itbisTotal,
          fianza_total: fianzaTotal,
          total,
          creado_por: input.creado_por?.trim() || null,
          caja_sesion_id: cajaSesionId,
          nombre_cliente: input.nombre_cliente?.trim() || null,
        });
      const facturaId = Number(infoFactura.lastInsertRowid);

      const insertLinea = db.prepare(
        `INSERT INTO factura_lineas (factura_id, producto_id, modalidad, cantidad, precio_unitario, descuento, itbis, subtotal, prestado, precio_lista, plato_dia)
         VALUES (@factura_id, @producto_id, @modalidad, @cantidad, @precio_unitario, @descuento, @itbis, @subtotal, @prestado, @precio_lista, @plato_dia)`
      );
      const updateExistencia = db.prepare(`UPDATE productos SET existencia = existencia - ? WHERE id = ?`);
      const upsertEnvase = db.prepare(
        `INSERT INTO envases_cliente (cliente_id, producto_id, cantidad, fianza_total) VALUES (@cliente_id, @producto_id, @cantidad, @fianza)
         ON CONFLICT(cliente_id, producto_id) DO UPDATE SET cantidad = cantidad + @cantidad, fianza_total = fianza_total + @fianza`
      );
      const insertMovimiento = db.prepare(
        `INSERT INTO envase_movimientos (cliente_id, producto_id, tipo, cantidad, factura_id, fecha, nota)
         VALUES (@cliente_id, @producto_id, 'ENTREGA', @cantidad, @factura_id, @fecha, 'Venta en modalidad LLENO')`
      );

      const ingresoPorCuenta = new Map<number, number>();
      const costoPorCuenta = new Map<number, { costo: number; inventarioId: number }>();

      for (const l of lineasCalc) {
        insertLinea.run({
          factura_id: facturaId,
          producto_id: l.producto_id,
          modalidad: l.modalidad,
          cantidad: l.cantidad,
          precio_unitario: l.precio_unitario,
          descuento: l.descuento,
          itbis: l.itbis,
          subtotal: l.subtotal,
          prestado: l.prestado && l.producto.maneja_envase ? 1 : 0,
          precio_lista: platos.get(l.producto_id)?.precio ?? l.producto.precio_contenido,
          plato_dia: platos.get(l.producto_id) ? 1 : 0,
        });
        updateExistencia.run(l.cantidad, l.producto_id);

        // Cilindro prestado desde la venta: queda anotado en Cilindros prestados, ligado a esta factura.
        if (l.prestado && l.producto.maneja_envase) {
          db.prepare(
            `INSERT INTO botellas_fiadas (cliente_id, producto_id, tipo, cantidad, fecha, nota, creado_por, factura_id) VALUES (?, ?, 'FIADO', ?, ?, ?, ?, ?)`
          ).run(input.cliente_id, l.producto_id, l.cantidad, input.fecha, `Venta ${ncf ?? `#${maxNumero + 1}`}`, input.creado_por?.trim() || null, facturaId);
        }

        if (l.modalidad === "LLENO" && l.producto.maneja_envase) {
          upsertEnvase.run({ cliente_id: input.cliente_id, producto_id: l.producto_id, cantidad: l.cantidad, fianza: l.fianzaLinea });
          insertMovimiento.run({ cliente_id: input.cliente_id, producto_id: l.producto_id, cantidad: l.cantidad, factura_id: facturaId, fecha: input.fecha });
        }

        if (l.producto.cuenta_ingreso_id) {
          ingresoPorCuenta.set(l.producto.cuenta_ingreso_id, (ingresoPorCuenta.get(l.producto.cuenta_ingreso_id) ?? 0) + l.subtotal);
        }
        if (l.producto.cuenta_costo_id && l.producto.cuenta_inventario_id) {
          const costoLinea = l.producto.costo_contenido * l.cantidad;
          const prev = costoPorCuenta.get(l.producto.cuenta_costo_id) ?? { costo: 0, inventarioId: l.producto.cuenta_inventario_id };
          prev.costo += costoLinea;
          costoPorCuenta.set(l.producto.cuenta_costo_id, prev);
        }
      }

      const lineasAsiento = [];
      const cuentaCobroId = input.condicion_pago === "CONTADO" ? cuentaCobroContado(db, input.metodo_pago) : cuentaIdPorCodigo(db, CODIGO_CXC);
      lineasAsiento.push({ cuenta_id: cuentaCobroId, debito: total, credito: 0, descripcion: `Factura ${ncf}` });
      for (const [cuentaId, monto] of ingresoPorCuenta) {
        lineasAsiento.push({ cuenta_id: cuentaId, debito: 0, credito: Math.round(monto * 100) / 100, descripcion: `Factura ${ncf}` });
      }
      if (itbisTotal > 0) {
        lineasAsiento.push({ cuenta_id: cuentaIdPorCodigo(db, CODIGO_ITBIS_PAGAR), debito: 0, credito: Math.round(itbisTotal * 100) / 100, descripcion: `ITBIS factura ${ncf}` });
      }
      if (fianzaTotal > 0) {
        lineasAsiento.push({ cuenta_id: cuentaIdPorCodigo(db, CODIGO_DEPOSITOS_GARANTIA), debito: 0, credito: fianzaTotal, descripcion: `Deposito en garantia envases ${ncf}` });
      }
      for (const [cuentaCostoId, { costo, inventarioId }] of costoPorCuenta) {
        if (costo <= 0) continue;
        const montoRedondeado = Math.round(costo * 100) / 100;
        lineasAsiento.push({ cuenta_id: cuentaCostoId, debito: montoRedondeado, credito: 0, descripcion: `Costo de venta factura ${ncf}` });
        lineasAsiento.push({ cuenta_id: inventarioId, debito: 0, credito: montoRedondeado, descripcion: `Salida de inventario factura ${ncf}` });
      }

      const asientoId = crearAsiento(db, {
        fecha: input.fecha,
        concepto: `Venta segun factura ${ncf}`,
        origen: "FACTURA",
        referencia_id: facturaId,
        lineas: lineasAsiento,
      });

      db.prepare(`UPDATE facturas SET asiento_id = ? WHERE id = ?`).run(asientoId, facturaId);

      return facturaId;
    });

    const facturaId = run();
    return db.prepare(`SELECT * FROM facturas WHERE id = ?`).get(facturaId) as Factura;
  });

  ipcMain.handle("facturas:anular", (_e, id: number, motivo: string, cajaSesionId?: number | null) => {
    const factura = db.prepare(`SELECT * FROM facturas WHERE id = ?`).get(id) as Factura | undefined;
    if (!factura) throw new Error("Factura no encontrada");
    if (factura.estado === "ANULADA") return factura;
    // Si se anula con la caja abierta, la devolucion sale de esa jornada.
    const sesionAnulacion = validarSesionAbierta(db, cajaSesionId);

    const run = db.transaction(() => {
      // los cilindros que se prestaron con esta venta dejan de contarse como prestados
      db.prepare(`DELETE FROM botellas_fiadas WHERE factura_id = ?`).run(id);
      const lineas = db.prepare(`SELECT * FROM factura_lineas WHERE factura_id = ?`).all(id) as any[];
      for (const l of lineas) {
        db.prepare(`UPDATE productos SET existencia = existencia + ? WHERE id = ?`).run(l.cantidad, l.producto_id);
        if (l.modalidad === "LLENO") {
          db.prepare(
            `UPDATE envases_cliente SET cantidad = cantidad - ? WHERE cliente_id = ? AND producto_id = ?`
          ).run(l.cantidad, factura.cliente_id, l.producto_id);
        }
      }

      const notaCreditoNcf = intentarTomarSiguienteNcf(db, "B04");
      let asientoAnulacion: number | null = null;

      if (factura.asiento_id) {
        const original = db.prepare(`SELECT * FROM asiento_lineas WHERE asiento_id = ?`).all(factura.asiento_id) as any[];
        const concepto = notaCreditoNcf
          ? `Nota de Credito ${notaCreditoNcf} - Anulacion de factura ${factura.ncf}: ${motivo}`
          : `Anulacion de factura ${factura.ncf}: ${motivo}`;
        const reversa = original.map((l) => ({ cuenta_id: l.cuenta_id, debito: l.credito, credito: l.debito, descripcion: concepto }));
        asientoAnulacion = crearAsiento(db, {
          fecha: fechaHoyRD(),
          concepto,
          origen: "AJUSTE",
          referencia_id: id,
          lineas: reversa,
        });
      }

      db.prepare(`UPDATE facturas SET estado = 'ANULADA', nota_credito_ncf = ?, anulada_sesion_id = ? WHERE id = ?`).run(notaCreditoNcf, sesionAnulacion, id);
      if (notaCreditoNcf) {
        guardarNota.run({
          tipo: "CREDITO",
          ncf: notaCreditoNcf,
          factura_id: id,
          fecha: fechaHoyRD(),
          motivo,
          monto: Math.round((factura.total - factura.itbis) * 100) / 100,
          itbis: factura.itbis,
          total: factura.total,
          anulacion: 1,
          asiento_id: asientoAnulacion,
        });
      }
    });
    run();
    return db.prepare(`SELECT * FROM facturas WHERE id = ?`).get(id) as Factura;
  });

  ipcMain.handle(
    "facturas:agregarNotaDebito",
    (_e, input: { factura_id: number; concepto: string; monto: number; cuenta_ingreso_id: number }) => {
      const factura = db.prepare(`SELECT * FROM facturas WHERE id = ?`).get(input.factura_id) as Factura | undefined;
      if (!factura) throw new Error("Factura no encontrada");
      if (factura.estado === "ANULADA") throw new Error("No se puede agregar una Nota de Debito a una factura anulada");
      if (input.monto <= 0) throw new Error("El monto debe ser mayor a cero");

      const config = db.prepare(`SELECT * FROM company_config WHERE id = 1`).get() as { itbis_rate: number };
      const itbisIncremento = Math.round(input.monto * config.itbis_rate * 100) / 100;
      const totalIncremento = input.monto + itbisIncremento;

      const run = db.transaction(() => {
        const ncf = tomarSiguienteNcf(db, "B03");
        const concepto = `Nota de Debito ${ncf} - Factura ${factura.ncf}: ${input.concepto}`;
        const cuentaCobro = factura.condicion_pago === "CONTADO" ? codigoCobroContado(factura.metodo_pago) : CODIGO_CXC;

        const asientoId = crearAsiento(db, {
          fecha: fechaHoyRD(),
          concepto,
          origen: "AJUSTE",
          referencia_id: input.factura_id,
          lineas: [
            { cuenta_id: cuentaIdPorCodigo(db, cuentaCobro), debito: totalIncremento, credito: 0, descripcion: concepto },
            { cuenta_id: input.cuenta_ingreso_id, debito: 0, credito: input.monto, descripcion: concepto },
            { cuenta_id: cuentaIdPorCodigo(db, CODIGO_ITBIS_PAGAR), debito: 0, credito: itbisIncremento, descripcion: concepto },
          ],
        });

        db.prepare(
          `UPDATE facturas SET subtotal = subtotal + @monto, itbis = itbis + @itbis, total = total + @total, nota_debito_ncf = @ncf WHERE id = @id`
        ).run({ monto: input.monto, itbis: itbisIncremento, total: totalIncremento, ncf, id: input.factura_id });
        guardarNota.run({ tipo: "DEBITO", ncf, factura_id: input.factura_id, fecha: fechaHoyRD(), motivo: input.concepto, monto: input.monto, itbis: itbisIncremento, total: totalIncremento, anulacion: 0, asiento_id: asientoId });

        return ncf;
      });

      run();
      return db.prepare(`SELECT * FROM facturas WHERE id = ?`).get(input.factura_id) as Factura;
    }
  );

  ipcMain.handle(
    "facturas:agregarNotaCredito",
    (_e, input: { factura_id: number; concepto: string; monto: number; cuenta_ingreso_id: number }) => {
      const factura = db.prepare(`SELECT * FROM facturas WHERE id = ?`).get(input.factura_id) as Factura | undefined;
      if (!factura) throw new Error("Factura no encontrada");
      if (factura.estado === "ANULADA") throw new Error("No se puede agregar una Nota de Credito a una factura anulada");
      if (input.monto <= 0) throw new Error("El monto debe ser mayor a cero");
      if (input.monto > factura.subtotal) throw new Error(`El monto no puede ser mayor al subtotal de la factura (${factura.subtotal.toFixed(2)})`);

      const config = db.prepare(`SELECT * FROM company_config WHERE id = 1`).get() as { itbis_rate: number };
      const itbisReduccion = Math.round(input.monto * config.itbis_rate * 100) / 100;
      const totalReduccion = input.monto + itbisReduccion;

      const run = db.transaction(() => {
        const ncf = tomarSiguienteNcf(db, "B04");
        const concepto = `Nota de Credito ${ncf} - Factura ${factura.ncf}: ${input.concepto}`;
        const cuentaCobro = factura.condicion_pago === "CONTADO" ? codigoCobroContado(factura.metodo_pago) : CODIGO_CXC;

        const asientoId = crearAsiento(db, {
          fecha: fechaHoyRD(),
          concepto,
          origen: "AJUSTE",
          referencia_id: input.factura_id,
          lineas: [
            { cuenta_id: input.cuenta_ingreso_id, debito: input.monto, credito: 0, descripcion: concepto },
            { cuenta_id: cuentaIdPorCodigo(db, CODIGO_ITBIS_PAGAR), debito: itbisReduccion, credito: 0, descripcion: concepto },
            { cuenta_id: cuentaIdPorCodigo(db, cuentaCobro), debito: 0, credito: totalReduccion, descripcion: concepto },
          ],
        });

        db.prepare(
          `UPDATE facturas SET subtotal = subtotal - @monto, itbis = itbis - @itbis, total = total - @total, nota_credito_ncf = @ncf WHERE id = @id`
        ).run({ monto: input.monto, itbis: itbisReduccion, total: totalReduccion, ncf, id: input.factura_id });
        guardarNota.run({ tipo: "CREDITO", ncf, factura_id: input.factura_id, fecha: fechaHoyRD(), motivo: input.concepto, monto: input.monto, itbis: itbisReduccion, total: totalReduccion, anulacion: 0, asiento_id: asientoId });

        return ncf;
      });

      run();
      return db.prepare(`SELECT * FROM facturas WHERE id = ?`).get(input.factura_id) as Factura;
    }
  );
}
