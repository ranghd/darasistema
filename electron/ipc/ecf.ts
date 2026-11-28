import { ipcMain } from "electron";
import type { DB } from "../db/types";
import { fechaHoyRD } from "../db/contabilidad";
import { auditar } from "./caja";
import { construirPayloadEcf, esElMismoEnviado, leerRespuestaEcf, MENSAJE_PROVEEDOR_ROTO, numeroEncf, respuestaDeAuditoria, ultimoNumeroUsado, type ClienteEcf, type ConfigEcf, type LineaEcf, type RespuestaEcf, type TipoEcf } from "../shared/ecf";
import type { EcfAjustes, EcfDocumento, EcfEstado, EcfPrueba, EcfRango, EcfSinEmitir } from "../shared/types";

// Lo que la nube le presta a estos handlers: la configuracion de la empresa y la llamada al proveedor.
// (La base no guarda el token ni se habla con ef2 desde las computadoras de caja: todo pasa por la nube.)
export interface ServicioEcf {
  config(): ConfigEcf;
  /** Cambia el modo (apagado / prueba / real). Falla con un mensaje claro si falta algo (token, etc.). */
  cambiarModo(modo: ConfigEcf["modo"]): ConfigEcf;
  /** Que esta listo y que falta para poder encender la factura electronica. */
  ajustes(): { tokenCargado: boolean; correo: string | null; razonSocial: string | null };
  llamar(metodo: "GET" | "POST", ruta: string, cuerpo?: unknown): Promise<{ http: number; cuerpo: any }>;
}

// Una peticion "ENVIANDO" de hace mas de esto ya no esta en curso (se corto): queda INCIERTA.
const ENVIANDO_MAX_MS = 3 * 60 * 1000;

const ESTADOS_LISTOS = ["ACEPTADO", "PROFORMA"];

// Los que quedaron anotados como ERROR cuando ef2 se rompio por dentro ("Fatal error"): tampoco se sabe si salieron.
const seRompioElProveedor = (d: { estado: string; mensaje?: string | null }) => d.estado === "ERROR" && /Fatal error/i.test(d.mensaje ?? "");

interface FilaFactura {
  id: number;
  numero: number;
  ncf: string | null;
  cliente_id: number;
  fecha: string;
  condicion_pago: "CONTADO" | "CREDITO";
  metodo_pago: string | null;
  total: number;
  fianza_total: number;
  nombre_cliente: string | null;
  estado: string;
}

function documento(db: DB, facturaId: number, clase: "FACTURA" | "NOTA_CREDITO"): EcfDocumento | undefined {
  const d = db.prepare(`SELECT * FROM ecf_documentos WHERE factura_id = ? AND clase = ?`).get(facturaId, clase) as EcfDocumento | undefined;
  return d && comoSeMuestra(d);
}

function comoSeMuestra<T extends { estado: string; mensaje?: string | null }>(d: T): T {
  return seRompioElProveedor(d) ? { ...d, estado: "INCIERTO", mensaje: MENSAJE_PROVEEDOR_ROTO } : d;
}

function guardarRespuesta(db: DB, id: number, r: RespuestaEcf, extra: { modo: string; clase: string; facturaId: number }) {
  db.prepare(
    `UPDATE ecf_documentos SET estado = @estado, ncf = COALESCE(@ncf, ncf), id_proveedor = COALESCE(@id_proveedor, id_proveedor), track_id = COALESCE(@track_id, track_id),
       qr_link = COALESCE(@qr_link, qr_link), pdf_url = COALESCE(@pdf_url, pdf_url), xml_path = COALESCE(@xml_path, xml_path),
       codigo_seguridad = COALESCE(@codigo_seguridad, codigo_seguridad), fecha_firma = COALESCE(@fecha_firma, fecha_firma),
       mensaje = @mensaje, actualizado_en = datetime('now','localtime') WHERE id = @id`
  ).run({ ...r, id });
  // En modo real el e-NCF pasa a ser el numero de la factura (asi salen bien los reportes y los recibos).
  // Una factura rechazada o con error no lo recibe: el numero no vale.
  if (extra.modo === "real" && extra.clase === "FACTURA" && r.ncf && (r.estado === "ACEPTADO" || r.estado === "EN_PROCESO")) {
    db.prepare(`UPDATE facturas SET ncf = ? WHERE id = ?`).run(r.ncf, extra.facturaId);
  }
}

function marcar(db: DB, id: number, estado: string, mensaje: string | null) {
  db.prepare(`UPDATE ecf_documentos SET estado = ?, mensaje = ?, actualizado_en = datetime('now','localtime') WHERE id = ?`).run(estado, mensaje, id);
}

function datosFactura(db: DB, facturaId: number) {
  const factura = db.prepare(`SELECT * FROM facturas WHERE id = ?`).get(facturaId) as FilaFactura | undefined;
  if (!factura) throw new Error("Factura no encontrada");
  const lineas = db
    .prepare(`SELECT fl.cantidad, fl.subtotal, fl.itbis, p.nombre FROM factura_lineas fl JOIN productos p ON p.id = fl.producto_id WHERE fl.factura_id = ? ORDER BY fl.id`)
    .all(facturaId) as LineaEcf[];
  const c = db.prepare(`SELECT codigo, nombre, rnc_cedula, email, direccion FROM clientes WHERE id = ?`).get(factura.cliente_id) as
    | { codigo: string; nombre: string; rnc_cedula: string | null; email: string | null; direccion: string | null }
    | undefined;
  const cliente: ClienteEcf = {
    // "Consumidor Final" con un nombre escrito en la caja: sale ese nombre
    nombre: c && c.codigo === "CLI-0000" && factura.nombre_cliente?.trim() ? factura.nombre_cliente.trim() : c?.nombre ?? "Consumidor Final",
    rnc_cedula: c?.rnc_cedula,
    email: c?.email,
    direccion: c?.direccion,
  };
  const emisor = db.prepare(`SELECT nombre_empresa, rnc, direccion, telefono FROM company_config WHERE id = 1`).get() as {
    nombre_empresa: string;
    rnc: string | null;
    direccion: string | null;
    telefono: string | null;
  };
  return { factura, lineas, cliente, emisor: { ...emisor, rnc: emisor.rnc ?? "" } };
}

function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(hasta.slice(0, 10) + "T12:00:00Z") - Date.parse(desde.slice(0, 10) + "T12:00:00Z")) / 86400000);
}

export function registerEcfIpc(db: DB, svc: ServicioEcf | null = null) {
  const exigirServicio = () => {
    if (!svc) throw new Error("La facturacion electronica solo funciona conectada a la nube");
    return svc;
  };

  // Manda una factura (o su nota de credito) al proveedor. Nunca manda dos veces lo mismo: si no se sabe si la primera
  // llego (INCIERTO), no se vuelve a mandar.
  async function enviar(facturaId: number, clase: "FACTURA" | "NOTA_CREDITO", opciones: { razon?: string } = {}): Promise<EcfDocumento> {
    const s = exigirServicio();
    const doc = documento(db, facturaId, clase);
    if (!doc) throw new Error(clase === "FACTURA" ? "Esta factura no es electronica" : "Esta factura no tiene comprobante electronico que anular");
    if (ESTADOS_LISTOS.includes(doc.estado) || doc.estado === "EN_PROCESO") return doc;
    if (doc.estado === "ENVIANDO") {
      if (Date.now() - Date.parse(doc.actualizado_en.replace(" ", "T")) < ENVIANDO_MAX_MS) return doc; // todavia en camino
      marcar(db, doc.id, "INCIERTO", "Se corto la conexion mientras se enviaba: revisa en el portal de ef2 si se emitio");
      return documento(db, facturaId, clase)!;
    }
    if ((doc.estado === "INCIERTO" || doc.estado === "RECHAZADO" || seRompioElProveedor(doc))) {
      throw new Error(
        doc.estado !== "RECHAZADO"
          ? "No se sabe si ef2 recibio este comprobante: no se manda otra vez. Busca su numero en el portal y registralo."
          : `La DGII rechazo este comprobante (${doc.mensaje ?? "sin detalle"}). Un administrador debe revisarlo.`
      );
    }

    const config = s.config();
    if (config.modo === "apagado") throw new Error("La facturacion electronica esta apagada");
    const { factura, lineas, cliente, emisor } = datosFactura(db, facturaId);
    const esNota = clase === "NOTA_CREDITO";
    const proforma = doc.modo === "prueba";
    const tipo = doc.tipo as TipoEcf;

    let payload;
    if (esNota) {
      const original = documento(db, facturaId, "FACTURA");
      if (!original?.ncf) throw new Error("La factura no tiene e-NCF: no hay nada que anular en la DGII");
      payload = construirPayloadEcf({
        tipo: "34",
        emisor,
        config,
        factura: { ...factura, fecha: fechaHoyRD() }, // la nota sale con la fecha de hoy; la de la original va en la referencia
        lineas,
        cliente,
        referencia: {
          ncf_modificado: original.ncf,
          fecha_ncf_modificado: factura.fecha,
          razon: opciones.razon || "Anulacion de factura",
          dias_desde_original: diasEntre(factura.fecha, fechaHoyRD()),
        },
      });
    } else {
      payload = construirPayloadEcf({ tipo, emisor, config, factura, lineas, cliente, proforma });
    }

    // Se anota que va en camino ANTES de salir: si se corta, queda INCIERTO y no se manda doble.
    db.prepare(`UPDATE ecf_documentos SET estado = 'ENVIANDO', intentos = intentos + 1, mensaje = NULL, actualizado_en = datetime('now','localtime') WHERE id = ?`).run(doc.id);
    db.persist();

    // Por cual numero va ef2 antes de mandar: si despues contesta mal, el nuestro es uno de los que se usaron desde aqui.
    const antes = proforma ? null : await ultimoNumero(tipo).catch(() => null);

    let respuesta: RespuestaEcf;
    try {
      const { http, cuerpo } = await s.llamar("POST", "/procesar_factura.php", payload);
      respuesta = leerRespuestaEcf(http, cuerpo, proforma && !esNota);
    } catch (err: any) {
      // Se corto la comunicacion: puede que ef2 si la haya recibido.
      respuesta = {
        estado: "INCIERTO",
        mensaje: `No se supo si ef2 recibio el comprobante (${err?.message ?? "sin conexion"}). Revisa en su portal antes de reenviar.`,
        ncf: null,
        id_proveedor: null,
        track_id: null,
        qr_link: null,
        pdf_url: null,
        xml_path: null,
        codigo_seguridad: null,
        fecha_firma: null,
      };
    }
    if (respuesta.estado === "INCIERTO" && antes !== null) {
      respuesta = (await recuperarEnvio(tipo, antes, payload).catch(() => null)) ?? respuesta;
    }
    guardarRespuesta(db, doc.id, respuesta, { modo: doc.modo, clase, facturaId });
    auditar(db, { id: null, nombre: "Sistema" }, `ECF_${esNota ? "NOTA_CREDITO" : "FACTURA"}_${respuesta.estado}`, "factura", facturaId, { prueba: proforma, ncf: respuesta.ncf, mensaje: respuesta.mensaje });
    return documento(db, facturaId, clase)!;
  }

  ipcMain.handle("ecf:estado", (): EcfEstado => ({ modo: svc?.config().modo ?? "apagado" }));

  ipcMain.handle("ecf:obtener", async (_e, facturaId: number) => {
    const doc = documento(db, facturaId, "FACTURA");
    // Un comprobante con numero pero sin QR (registrado a mano) se completa con lo que tiene ef2.
    if (svc && doc && doc.modo === "real" && doc.ncf && !doc.qr_link && (doc.estado === "ACEPTADO" || doc.estado === "EN_PROCESO")) {
      await consultarEnEf2(doc.id, facturaId, doc.ncf).catch(() => {});
      return documento(db, facturaId, "FACTURA") ?? null;
    }
    return doc ?? null;
  });

  ipcMain.handle("ecf:emitir", (_e, facturaId: number) => enviar(facturaId, "FACTURA"));

  // Ya no se reenvia a la fuerza (salian comprobantes repetidos). El canal queda para que las versiones anteriores lo digan claro.
  ipcMain.handle("ecf:reenviar", () => {
    throw new Error("Reenviar esta desactivado: lo que ya se mando a ef2 no se manda otra vez. Busca su numero en el portal y registralo.");
  });

  // Solo administrador: lo que ya se emitio en el portal de ef2 (por ejemplo tras un corte) se registra con su e-NCF, sin reenviar.
  ipcMain.handle("ecf:registrarManual", async (_e, datos: { factura_id: number; ncf: string; autor?: { nombre?: string } }) => {
    const doc = documento(db, datos.factura_id, "FACTURA");
    if (!doc) throw new Error("Esta factura no es electronica");
    if (ESTADOS_LISTOS.includes(doc.estado)) throw new Error("Esta factura ya tiene su comprobante");
    const ncf = String(datos.ncf ?? "").trim().toUpperCase();
    if (!/^E(31|32|45)\d{10}$/.test(ncf)) throw new Error("El e-NCF debe verse asi: E320000000123 (la letra E, el tipo y 10 numeros)");
    const repetido = db.prepare(`SELECT f.numero FROM ecf_documentos d JOIN facturas f ON f.id = d.factura_id WHERE d.ncf = ? AND d.factura_id != ?`).get(ncf, datos.factura_id) as { numero: number } | undefined;
    if (repetido) throw new Error(`Ese e-NCF ya esta puesto en la factura ${repetido.numero}`);
    let respuesta: RespuestaEcf = { estado: doc.modo === "real" ? "EN_PROCESO" : "PROFORMA", ncf, mensaje: "Registrado a mano desde el portal de ef2", id_proveedor: null, track_id: null, qr_link: null, pdf_url: null, xml_path: null, codigo_seguridad: null, fecha_firma: null };
    if (doc.modo === "real") {
      // Se comprueba en ef2 que ese numero exista y sea de esta venta. Sin conexion queda "en proceso" y se consulta despues.
      const enEf2 = await buscarEnEf2(ncf).catch(() => undefined);
      if (enEf2 === null) throw new Error("ef2 no tiene ese numero: revisa que lo hayas escrito bien");
      if (enEf2) {
        if (ncf.slice(1, 3) !== doc.tipo) throw new Error(`Esta factura necesita un numero E${doc.tipo}`);
        const total = (db.prepare(`SELECT total FROM facturas WHERE id = ?`).get(datos.factura_id) as { total: number }).total;
        const monto = Number(enEf2.montos?.por_etapa?.monto_guardado_ef2);
        if (Number.isFinite(monto) && Math.abs(monto - total) > 0.05) {
          throw new Error(`Ese numero es de un comprobante de RD$${monto.toFixed(2)} y esta factura es de RD$${total.toFixed(2)}`);
        }
        respuesta = { ...respuestaDeAuditoria(enEf2), ncf };
      }
    }
    guardarRespuesta(db, doc.id, respuesta, { modo: doc.modo, clase: "FACTURA", facturaId: datos.factura_id });
    auditar(db, { id: null, nombre: datos.autor?.nombre ?? "Administrador" }, "ECF_REGISTRO_MANUAL", "factura", datos.factura_id, { ncf });
    return documento(db, datos.factura_id, "FACTURA");
  });

  // Anulacion de una factura electronica: nota de credito (e-CF 34, anulacion total). Se pide desde la nube al anular.
  ipcMain.handle("ecf:anularFactura", async (_e, facturaId: number, razon?: string) => {
    const original = documento(db, facturaId, "FACTURA");
    if (!original || original.modo !== "real" || !original.ncf) return null; // nada que anular ante la DGII (prueba o nunca se emitio)
    if (!documento(db, facturaId, "NOTA_CREDITO")) {
      db.prepare(`INSERT INTO ecf_documentos (factura_id, clase, tipo, modo, estado) VALUES (?, 'NOTA_CREDITO', '34', 'real', 'PENDIENTE')`).run(facturaId);
    }
    return enviar(facturaId, "NOTA_CREDITO", { razon });
  });

  /** Lo que ef2 tiene guardado de un e-NCF; null si dice que no lo tiene. Lanza si no se pudo preguntar. */
  async function buscarEnEf2(ncf: string): Promise<any | null> {
    const { http, cuerpo } = await exigirServicio().llamar("GET", `/auditoria_factura.php?encf=${encodeURIComponent(ncf)}&incluir_payload=false&incluir_notas=false`);
    if (http === 200 && cuerpo?.facturas?.[0]) return cuerpo.facturas[0];
    if ((http === 200 || http === 404) && cuerpo?.resumen?.no_encontradas > 0) return null;
    throw new Error(`ef2 no contesto la consulta (${http})`);
  }

  async function ultimoNumero(tipo: string): Promise<number> {
    const { http, cuerpo } = await exigirServicio().llamar("GET", "/ecf_secuencia_api.php");
    if (http !== 200 || !Array.isArray(cuerpo?.data)) throw new Error(`No se pudieron leer los rangos de ef2 (${http})`);
    return ultimoNumeroUsado(cuerpo.data, tipo);
  }

  // ef2 contesto mal despues de mandar: se busca entre los numeros que gasto desde entonces el que sea igual a lo enviado.
  // Solo se toma si hay exactamente uno y no esta en otra factura; con dudas queda INCIERTO para revisarlo a mano.
  async function recuperarEnvio(tipo: string, antes: number, payload: { ECF: unknown }): Promise<RespuestaEcf | null> {
    const despues = await ultimoNumero(tipo);
    if (despues - antes > 10) return null;
    const iguales: any[] = [];
    for (let n = antes + 1; n <= despues; n++) {
      const ncf = numeroEncf(tipo, n);
      if (db.prepare(`SELECT 1 FROM ecf_documentos WHERE ncf = ?`).get(ncf)) continue;
      const guardado = await buscarEnEf2(ncf);
      if (guardado && esElMismoEnviado(guardado, payload)) iguales.push(guardado);
    }
    return iguales.length === 1 ? respuestaDeAuditoria(iguales[0]) : null;
  }

  async function consultarEnEf2(docId: number, facturaId: number, ncf: string, clase: "FACTURA" | "NOTA_CREDITO" = "FACTURA") {
    const guardado = await buscarEnEf2(ncf);
    if (guardado) guardarRespuesta(db, docId, { ...respuestaDeAuditoria(guardado), ncf }, { modo: "real", clase, facturaId });
  }

  // La nota de credito de una factura (si tiene), para verla en el detalle. Si estaba "en proceso" se pregunta en que quedo.
  ipcMain.handle("ecf:obtenerNota", async (_e, facturaId: number) => {
    const nota = documento(db, facturaId, "NOTA_CREDITO");
    if (svc && nota?.estado === "EN_PROCESO" && nota.ncf) {
      await consultarEnEf2(nota.id, facturaId, nota.ncf, "NOTA_CREDITO").catch(() => {});
    }
    return documento(db, facturaId, "NOTA_CREDITO") ?? null;
  });

  // Solo administrador: envia la nota de credito (anulacion total) de una factura ya anulada en el sistema que la DGII acepto
  // y que se quedo sin nota (por ejemplo, se anulo antes de tener su e-NCF). Nunca manda dos veces: lo dudoso no se repite.
  ipcMain.handle("ecf:enviarNota", async (_e, facturaId: number) => {
    const factura = db.prepare(`SELECT estado FROM facturas WHERE id = ?`).get(facturaId) as { estado: string } | undefined;
    if (!factura) throw new Error("Factura no encontrada");
    if (factura.estado !== "ANULADA") throw new Error("Primero anula la factura: la nota de credito es para facturas anuladas");
    let original = documento(db, facturaId, "FACTURA");
    if (!original || original.modo !== "real" || !original.ncf) throw new Error("Esta factura no tiene e-NCF: no hay nada que anular en la DGII");
    if (original.estado === "EN_PROCESO") {
      await consultarEnEf2(original.id, facturaId, original.ncf).catch(() => {});
      original = documento(db, facturaId, "FACTURA")!;
    }
    if (original.estado !== "ACEPTADO") throw new Error("La DGII todavia no ha aceptado esta factura: consulta su estado mas tarde");
    if (!documento(db, facturaId, "NOTA_CREDITO")) {
      db.prepare(`INSERT INTO ecf_documentos (factura_id, clase, tipo, modo, estado) VALUES (?, 'NOTA_CREDITO', '34', 'real', 'PENDIENTE')`).run(facturaId);
    }
    return enviar(facturaId, "NOTA_CREDITO", { razon: "Anulacion de factura" });
  });

  // Pregunta a ef2 en que quedo un comprobante que estaba "en proceso".
  ipcMain.handle("ecf:consultar", async (_e, facturaId: number) => {
    const s = exigirServicio();
    const doc = documento(db, facturaId, "FACTURA");
    if (!doc) throw new Error("Esta factura no es electronica");
    if (doc.estado !== "EN_PROCESO" || !doc.ncf) return doc;
    await consultarEnEf2(doc.id, facturaId, doc.ncf);
    return documento(db, facturaId, "FACTURA");
  });

  // ---------- Solo administrador: ver y cambiar el modo desde la pantalla ----------

  ipcMain.handle("ecf:ajustes", (): EcfAjustes => {
    const s = exigirServicio();
    const a = s.ajustes();
    const falta: string[] = [];
    if (!a.tokenCargado) falta.push("la clave de ef2 en el servidor");
    if (!a.correo) falta.push("el correo del negocio");
    if (!a.razonSocial) falta.push("el nombre del negocio ante la DGII");
    return { modo: s.config().modo, falta, listo: falta.length === 0 };
  });

  ipcMain.handle("ecf:cambiarModo", (_e, datos: { modo: string; autor?: { id?: number | null; nombre?: string } }): EcfAjustes => {
    const s = exigirServicio();
    if (datos?.modo !== "apagado" && datos?.modo !== "prueba" && datos?.modo !== "real") throw new Error("El modo debe ser apagado, prueba o real");
    const antes = s.config().modo;
    if (datos.modo !== "apagado") {
      const a = s.ajustes();
      if (!a.tokenCargado || !a.correo || !a.razonSocial) throw new Error("Todavia no se puede encender: falta configurar la factura electronica. Avisa a Darasistema.");
    }
    s.cambiarModo(datos.modo);
    auditar(db, { id: datos.autor?.id ?? null, nombre: datos.autor?.nombre ?? "Administrador" }, "ECF_CAMBIAR_MODO", "ecf", null, { de: antes, a: datos.modo });
    const a = s.ajustes();
    return { modo: datos.modo, falta: [], listo: a.tokenCargado };
  });

  // Los rangos de numeros E que tiene ef2 (lo que autorizo la DGII), para verlos en el sistema y avisar cuando quedan pocos.
  ipcMain.handle("ecf:rangos", async (): Promise<EcfRango[]> => {
    const s = exigirServicio();
    const { http, cuerpo } = await s.llamar("GET", "/ecf_secuencia_api.php");
    if (http !== 200 || !Array.isArray(cuerpo?.data)) throw new Error(`No se pudieron leer los rangos de ef2 (${cuerpo?.message ?? http})`);
    return (cuerpo.data as any[])
      .map((r) => ({
        prefijo: String(r.prefijo ?? ""),
        nombre: String(r.tipo_nombre ?? ""),
        desde: Number(r.desde) || 0,
        hasta: Number(r.hasta) || 0,
        usados: Number(r.secuencias_usadas) || 0,
        disponibles: Number(r.secuencias_disponibles) || 0,
        porcentajeUso: Number(r.porcentaje_uso) || 0,
        vence: typeof r.fecha_vencimiento === "string" && r.fecha_vencimiento ? r.fecha_vencimiento.slice(0, 10) : null,
        activo: r.estado === true || r.estado === 1 || r.estado === "1",
      }))
      .filter((r) => r.prefijo && r.prefijo !== "E00") // el E00 es solo para las proformas de prueba
      .sort((a, b) => a.prefijo.localeCompare(b.prefijo));
  });

  // ---------- Panel de factura electronica de la caja (pensado para quien no es de computadoras) ----------

  // Manda una proforma de prueba a ef2: no crea ninguna venta, no toca el inventario ni el efectivo y no va a la DGII.
  ipcMain.handle("ecf:probar", async (): Promise<EcfPrueba> => {
    const s = exigirServicio();
    const emisor = db.prepare(`SELECT nombre_empresa, rnc, direccion, telefono FROM company_config WHERE id = 1`).get() as { nombre_empresa: string; rnc: string | null; direccion: string | null; telefono: string | null };
    let payload;
    try {
      payload = construirPayloadEcf({
        tipo: "32",
        proforma: true,
        emisor: { ...emisor, rnc: emisor.rnc ?? "" },
        config: s.config(),
        factura: { fecha: fechaHoyRD(), condicion_pago: "CONTADO", metodo_pago: "EFECTIVO", total: 118, fianza_total: 0 },
        lineas: [{ nombre: "Prueba de conexion", cantidad: 1, subtotal: 100, itbis: 18 }],
        cliente: { nombre: "Consumidor Final" },
      });
    } catch (e: any) {
      return { ok: false, mensaje: `Falta configurar la factura electronica (${e?.message ?? "datos del negocio"}). Avisa al administrador.`, numero: null };
    }
    try {
      const { http, cuerpo } = await s.llamar("POST", "/procesar_factura.php", payload);
      const r = leerRespuestaEcf(http, cuerpo, true);
      if (r.estado === "PROFORMA") return { ok: true, mensaje: "Todo bien: ef2 recibio la prueba.", numero: r.ncf };
      if (http === 401 || http === 403) return { ok: false, mensaje: "ef2 no acepto la clave del sistema. Avisa al administrador.", numero: null };
      return { ok: false, mensaje: `ef2 no tomo la prueba${r.mensaje ? `: ${r.mensaje}` : ""}. Avisa al administrador.`, numero: null };
    } catch (e: any) {
      const m = String(e?.message ?? "");
      return {
        ok: false,
        mensaje: m.includes("token") ? "La factura electronica no esta configurada en el servidor. Avisa al administrador." : "No hay conexion con ef2. Revisa el internet y vuelve a probar.",
        numero: null,
      };
    }
  });

  // Facturas que no quedaron emitidas, listas para mostrar a la caja.
  const sinEmitir = (): EcfSinEmitir[] =>
    (
      db
        .prepare(
          `SELECT d.factura_id, d.clase, d.estado, d.mensaje, f.numero AS factura_numero, f.fecha AS factura_fecha, f.total AS factura_total
           FROM ecf_documentos d JOIN facturas f ON f.id = d.factura_id
           WHERE d.modo = 'real' AND d.estado NOT IN ('ACEPTADO','PROFORMA','EN_PROCESO')
             AND (d.clase = 'NOTA_CREDITO' OR f.estado != 'ANULADA')
           ORDER BY d.id DESC`
        )
        .all() as (Omit<EcfSinEmitir, "reintentable"> & { mensaje: string | null })[]
    ).map(({ mensaje, ...x }) => ({ ...x, reintentable: (x.estado === "PENDIENTE" || x.estado === "ERROR") && !seRompioElProveedor({ estado: x.estado, mensaje }) }));

  ipcMain.handle("ecf:sinEmitir", (): EcfSinEmitir[] => sinEmitir());

  // Reintenta todo lo que se puede reintentar sin riesgo (lo dudoso o rechazado lo ve el administrador).
  ipcMain.handle("ecf:reintentarTodas", async () => {
    const lista = sinEmitir().filter((x) => x.reintentable);
    let salieron = 0;
    for (const x of lista) {
      try {
        const d = await enviar(x.factura_id, x.clase);
        if (d.estado === "ACEPTADO" || d.estado === "EN_PROCESO") salieron++;
      } catch {
        /* se queda en la lista con su mensaje */
      }
    }
    return { intentadas: lista.length, salieron, siguenSinSalir: sinEmitir().length };
  });

  // Lo que no quedo emitido: para que el administrador lo vea y lo resuelva. "En proceso" ya tiene su numero (ef2 lo tomo y
  // falta que la DGII conteste), y una factura anulada no espera comprobante (salvo su nota de credito).
  ipcMain.handle("ecf:pendientes", () =>
    db
      .prepare(
        `SELECT d.*, f.numero AS factura_numero, f.fecha AS factura_fecha, f.total AS factura_total, f.estado AS factura_estado
         FROM ecf_documentos d JOIN facturas f ON f.id = d.factura_id
         WHERE d.estado NOT IN ('ACEPTADO','PROFORMA','EN_PROCESO') AND d.modo = 'real'
           AND (d.clase = 'NOTA_CREDITO' OR f.estado != 'ANULADA') ORDER BY d.id DESC`
      )
      .all()
      .map((d: any) => comoSeMuestra(d))
  );
}
