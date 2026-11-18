import { ipcMain } from "electron";
import type { DB } from "../db/types";
import { fechaHoyRD } from "../db/contabilidad";
import { auditar } from "./caja";
import { construirPayloadEcf, leerRespuestaEcf, type ClienteEcf, type ConfigEcf, type LineaEcf, type RespuestaEcf, type TipoEcf } from "../shared/ecf";
import type { EcfDocumento, EcfEstado } from "../shared/types";

// Lo que la nube le presta a estos handlers: la configuracion de la empresa y la llamada al proveedor.
// (La base no guarda el token ni se habla con ef2 desde las computadoras de caja: todo pasa por la nube.)
export interface ServicioEcf {
  config(): ConfigEcf;
  llamar(metodo: "GET" | "POST", ruta: string, cuerpo?: unknown): Promise<{ http: number; cuerpo: any }>;
}

// Una peticion "ENVIANDO" de hace mas de esto ya no esta en curso (se corto): queda INCIERTA.
const ENVIANDO_MAX_MS = 3 * 60 * 1000;

const ESTADOS_LISTOS = ["ACEPTADO", "PROFORMA"];

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
  return db.prepare(`SELECT * FROM ecf_documentos WHERE factura_id = ? AND clase = ?`).get(facturaId, clase) as EcfDocumento | undefined;
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
  // llego (INCIERTO), no se reenvia sola; con forzar (solo el administrador, despues de revisar el portal) si.
  async function enviar(facturaId: number, clase: "FACTURA" | "NOTA_CREDITO", opciones: { forzar?: boolean; razon?: string } = {}): Promise<EcfDocumento> {
    const s = exigirServicio();
    const doc = documento(db, facturaId, clase);
    if (!doc) throw new Error(clase === "FACTURA" ? "Esta factura no es electronica" : "Esta factura no tiene comprobante electronico que anular");
    if (ESTADOS_LISTOS.includes(doc.estado) || doc.estado === "EN_PROCESO") return doc;
    if (doc.estado === "ENVIANDO") {
      if (Date.now() - Date.parse(doc.actualizado_en.replace(" ", "T")) < ENVIANDO_MAX_MS) return doc; // todavia en camino
      marcar(db, doc.id, "INCIERTO", "Se corto la conexion mientras se enviaba: revisa en el portal de ef2 si se emitio");
      return documento(db, facturaId, clase)!;
    }
    if ((doc.estado === "INCIERTO" || doc.estado === "RECHAZADO") && !opciones.forzar) {
      throw new Error(
        doc.estado === "INCIERTO"
          ? "No se sabe si ef2 recibio este comprobante. Revisa en su portal si ya salio antes de reenviarlo."
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
        factura,
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
    guardarRespuesta(db, doc.id, respuesta, { modo: doc.modo, clase, facturaId });
    auditar(db, { id: null, nombre: "Sistema" }, `ECF_${esNota ? "NOTA_CREDITO" : "FACTURA"}_${respuesta.estado}`, "factura", facturaId, { prueba: proforma, ncf: respuesta.ncf, mensaje: respuesta.mensaje });
    return documento(db, facturaId, clase)!;
  }

  ipcMain.handle("ecf:estado", (): EcfEstado => ({ modo: svc?.config().modo ?? "apagado" }));

  ipcMain.handle("ecf:obtener", (_e, facturaId: number) => documento(db, facturaId, "FACTURA") ?? null);

  ipcMain.handle("ecf:emitir", (_e, facturaId: number) => enviar(facturaId, "FACTURA"));

  // Solo administrador: reenviar lo que quedo incierto o rechazado, despues de revisar en el portal de ef2 que no se emitio.
  ipcMain.handle("ecf:reenviar", (_e, facturaId: number, clase?: "FACTURA" | "NOTA_CREDITO") => enviar(facturaId, clase ?? "FACTURA", { forzar: true }));

  // Solo administrador: lo que ya se emitio en el portal de ef2 (por ejemplo tras un corte) se registra con su e-NCF, sin reenviar.
  ipcMain.handle("ecf:registrarManual", (_e, datos: { factura_id: number; ncf: string; autor?: { nombre?: string } }) => {
    const doc = documento(db, datos.factura_id, "FACTURA");
    if (!doc) throw new Error("Esta factura no es electronica");
    if (ESTADOS_LISTOS.includes(doc.estado)) throw new Error("Esta factura ya tiene su comprobante");
    const ncf = String(datos.ncf ?? "").trim().toUpperCase();
    if (!/^E(31|32)\d{10}$/.test(ncf)) throw new Error("El e-NCF debe verse asi: E320000000123 (la letra E, el tipo y 10 numeros)");
    guardarRespuesta(
      db,
      doc.id,
      { estado: doc.modo === "real" ? "ACEPTADO" : "PROFORMA", ncf, mensaje: "Registrado a mano desde el portal de ef2", id_proveedor: null, track_id: null, qr_link: null, pdf_url: null, xml_path: null, codigo_seguridad: null, fecha_firma: null },
      { modo: doc.modo, clase: "FACTURA", facturaId: datos.factura_id }
    );
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

  // Pregunta a ef2 en que quedo un comprobante que estaba "en proceso".
  ipcMain.handle("ecf:consultar", async (_e, facturaId: number) => {
    const s = exigirServicio();
    const doc = documento(db, facturaId, "FACTURA");
    if (!doc) throw new Error("Esta factura no es electronica");
    if (doc.estado !== "EN_PROCESO" || !doc.ncf) return doc;
    const { http, cuerpo } = await s.llamar("GET", `/auditoria_factura.php?encf=${encodeURIComponent(doc.ncf)}&incluir_payload=false&incluir_notas=false`);
    const estado = String(cuerpo?.facturas?.[0]?.estado_factura ?? "").toLowerCase();
    if (http === 200 && estado.startsWith("acept")) marcar(db, doc.id, "ACEPTADO", null);
    else if (http === 200 && estado.startsWith("rechaz")) marcar(db, doc.id, "RECHAZADO", "La DGII rechazo el comprobante");
    return documento(db, facturaId, "FACTURA");
  });

  // Lo que no quedo emitido: para que el administrador lo vea y lo resuelva.
  ipcMain.handle("ecf:pendientes", () =>
    db
      .prepare(
        `SELECT d.*, f.numero AS factura_numero, f.fecha AS factura_fecha, f.total AS factura_total, f.estado AS factura_estado
         FROM ecf_documentos d JOIN facturas f ON f.id = d.factura_id
         WHERE d.estado NOT IN ('ACEPTADO','PROFORMA') AND d.modo = 'real' ORDER BY d.id DESC`
      )
      .all()
  );
}
