// Factura electronica (e-CF): arma el JSON que pide el proveedor (ef2) a partir de una factura del sistema.
// Funciones puras, sin base de datos ni red: se prueban solas y las usa la nube.
//
// El proveedor firma el XML, lo envia a la DGII y guarda todo. Aqui solo se traduce:
//   factura B01 -> e-CF 31 (credito fiscal)   factura B02 -> e-CF 32 (consumo)
//   anulacion   -> e-CF 34 (nota de credito, codigo 1 = anulacion total)
// Con el modo "prueba" se manda como proforma (tipo 00): ef2 la guarda pero NO la manda a la DGII.

export type ModoEcf = "apagado" | "prueba" | "real";
// 31 credito fiscal (B01), 32 consumo (B02), 45 gubernamental (B15), 34 nota de credito.
export type TipoEcf = "31" | "32" | "34" | "45";

export interface ConfigEcf {
  modo: ModoEcf;
  // Datos del emisor tal como estan en la DGII (la razon social de ese RNC).
  razon_social?: string;
  nombre_comercial?: string;
  direccion?: string;
  correo?: string;
  telefono?: string;
  municipio?: string;
  provincia?: string;
  // dd-mm-aaaa: hasta cuando vale el rango autorizado de cada tipo (el e-CF 31 lo exige).
  vencimiento_31?: string;
  // idem para el gubernamental (e-CF 45)
  vencimiento_45?: string;
  // Una venta de consumo por este monto o mas exige identificar al comprador (norma de la DGII).
  tope_consumo_sin_comprador?: number;
}

export const TOPE_CONSUMO_SIN_COMPRADOR = 250000;

export interface EmisorEcf {
  rnc: string;
  nombre_empresa: string;
  direccion?: string | null;
  telefono?: string | null;
}

export interface ClienteEcf {
  nombre: string;
  rnc_cedula?: string | null;
  email?: string | null;
  direccion?: string | null;
}

export interface LineaEcf {
  nombre: string;
  cantidad: number;
  subtotal: number; // sin ITBIS, ya con el descuento
  itbis: number;
}

export interface FacturaEcf {
  fecha: string; // YYYY-MM-DD
  condicion_pago: "CONTADO" | "CREDITO";
  metodo_pago?: string | null;
  total: number;
  fianza_total: number;
}

export interface ReferenciaEcf {
  ncf_modificado: string;
  fecha_ncf_modificado: string; // YYYY-MM-DD
  razon: string;
  dias_desde_original: number;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const m2 = (n: number) => r2(n).toFixed(2);

/** "2026-11-17" -> "17-11-2026" */
export function fechaEcf(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}-${m}-${a}`;
}

function sumarDias(iso: string, dias: number): string {
  const d = new Date(iso.slice(0, 10) + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export function soloDigitos(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}

const FORMA_PAGO: Record<string, string> = { EFECTIVO: "1", TRANSFERENCIA: "2", CHEQUE: "2", TARJETA: "3" };

// Texto sin saltos ni espacios de mas, con el largo que acepta el proveedor.
function limpio(s: string | null | undefined, max: number): string {
  return (s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

export interface EntradaPayload {
  tipo: TipoEcf;
  emisor: EmisorEcf;
  config: ConfigEcf;
  factura: FacturaEcf;
  lineas: LineaEcf[];
  cliente: ClienteEcf;
  /** Solo para el tipo 34. */
  referencia?: ReferenciaEcf;
  /** Se manda como proforma (tipo 00, no va a la DGII) pero con las mismas reglas del tipo real: sirve para probar. */
  proforma?: boolean;
}

/** Arma el cuerpo de POST /procesar_factura.php. Lanza un Error con un mensaje claro si falta algo. */
export function construirPayloadEcf(e: EntradaPayload): { ECF: unknown } {
  const { tipo, emisor, config, factura, lineas, cliente } = e;
  if (!lineas.length) throw new Error("La factura no tiene productos");
  const rncEmisor = soloDigitos(emisor.rnc);
  if (rncEmisor.length !== 9 && rncEmisor.length !== 11) throw new Error("El RNC de la empresa no esta bien escrito en la configuracion (9 u 11 numeros)");
  const correo = config.correo?.trim();
  if (!correo) throw new Error("Falta el correo del emisor en la configuracion de facturacion electronica");

  const items = lineas.map((l, i) => {
    const gravado = l.itbis > 0;
    const precio = l.cantidad ? l.subtotal / l.cantidad : l.subtotal;
    return {
      NumeroLinea: String(i + 1),
      IndicadorFacturacion: gravado ? "1" : "4",
      NombreItem: limpio(l.nombre, 80) || "Producto",
      IndicadorBienoServicio: "1",
      CantidadItem: String(l.cantidad),
      UnidadMedida: "43",
      // hasta 4 decimales: asi cantidad x precio cuadra con el monto del renglon
      PrecioUnitarioItem: Math.abs(precio - r2(precio)) < 0.00005 ? m2(precio) : precio.toFixed(4),
      MontoItem: m2(l.subtotal),
    };
  });
  // El deposito por el cilindro que se lleva el cliente va como un renglon exento aparte.
  if (factura.fianza_total > 0) {
    items.push({
      NumeroLinea: String(items.length + 1),
      IndicadorFacturacion: "4",
      NombreItem: "Deposito en garantia de envase",
      IndicadorBienoServicio: "2",
      CantidadItem: "1",
      UnidadMedida: "43",
      PrecioUnitarioItem: m2(factura.fianza_total),
      MontoItem: m2(factura.fianza_total),
    });
  }

  const gravadoTotal = r2(lineas.filter((l) => l.itbis > 0).reduce((s, l) => s + l.subtotal, 0));
  const exentoTotal = r2(lineas.filter((l) => l.itbis <= 0).reduce((s, l) => s + l.subtotal, 0) + (factura.fianza_total > 0 ? factura.fianza_total : 0));
  const itbisTotal = r2(lineas.reduce((s, l) => s + l.itbis, 0));
  const montoTotal = r2(gravadoTotal + exentoTotal + itbisTotal);
  if (Math.abs(montoTotal - r2(factura.total)) > 0.05) {
    throw new Error(`Los renglones suman ${m2(montoTotal)} y la factura dice ${m2(factura.total)}: no se puede enviar asi`);
  }

  const totales: Record<string, string> = {};
  if (gravadoTotal > 0) {
    totales.MontoGravadoTotal = m2(gravadoTotal);
    totales.MontoGravadoI1 = m2(gravadoTotal);
  }
  if (exentoTotal > 0) totales.MontoExento = m2(exentoTotal);
  if (gravadoTotal > 0) {
    totales.ITBIS1 = "18";
    totales.TotalITBIS = m2(itbisTotal);
    totales.TotalITBIS1 = m2(itbisTotal);
  }
  totales.MontoTotal = m2(montoTotal);

  const credito = factura.condicion_pago === "CREDITO";
  const idDoc: Record<string, string | unknown> = {
    TipoeCF: e.proforma ? "00" : tipo,
    IndicadorMontoGravado: "0",
    TipoIngresos: "01",
    TipoPago: credito ? "2" : "1",
  };
  if (tipo === "34" && e.referencia) idDoc.IndicadorNotaCredito = e.referencia.dias_desde_original > 30 ? "1" : "0";
  if (tipo === "31" && !e.proforma) idDoc.FechaVencimientoSecuencia = config.vencimiento_31 ?? "31-12-2027";
  if (tipo === "45" && !e.proforma) idDoc.FechaVencimientoSecuencia = config.vencimiento_45 ?? "31-12-2027";
  if (credito) {
    idDoc.FechaLimitePago = fechaEcf(sumarDias(factura.fecha, 30));
    idDoc.TerminoPago = "30 dias";
  } else if (tipo === "32" || e.proforma) {
    idDoc.FechaLimitePago = fechaEcf(factura.fecha);
  }
  idDoc.TablaFormasPago = { FormaDePago: [{ FormaPago: credito ? "4" : FORMA_PAGO[factura.metodo_pago ?? "EFECTIVO"] ?? "1", MontoPago: m2(montoTotal) }] };

  const emisorEcf: Record<string, string> = {
    RNCEmisor: rncEmisor,
    RazonSocialEmisor: limpio(config.razon_social || emisor.nombre_empresa, 200),
    NombreComercial: limpio(config.nombre_comercial || emisor.nombre_empresa, 80),
    DireccionEmisor: limpio(config.direccion || emisor.direccion || "-", 100),
    CorreoEmisor: correo,
    FechaEmision: fechaEcf(factura.fecha),
  };
  if (config.municipio) emisorEcf.Municipio = config.municipio;
  if (config.provincia) emisorEcf.Provincia = config.provincia;

  const encabezado: Record<string, unknown> = { Version: "1.0", IdDoc: idDoc, Emisor: emisorEcf };

  // Comprador: el credito fiscal lo exige; en consumo solo si dio su RNC (o si la venta es grande).
  const rncComprador = soloDigitos(cliente.rnc_cedula);
  const rncValido = rncComprador.length === 9 || rncComprador.length === 11;
  const tope = config.tope_consumo_sin_comprador ?? TOPE_CONSUMO_SIN_COMPRADOR;
  const originalConRnc = tipo === "34" && (e.referencia?.ncf_modificado.startsWith("E31") || e.referencia?.ncf_modificado.startsWith("E45"));
  if (tipo === "31" || tipo === "45" || originalConRnc) {
    if (!rncValido) throw new Error(`${tipo === "45" ? "El comprobante gubernamental" : "El credito fiscal"} necesita el RNC del cliente (9 numeros de empresa u 11 de cedula)`);
  } else if (tipo === "32" && !rncValido && montoTotal >= tope) {
    throw new Error(`Una venta de ${m2(montoTotal)} o mas necesita el RNC o cedula del cliente`);
  }
  if (rncValido) {
    const nombre = limpio(cliente.nombre, 150);
    if (!nombre) throw new Error("Falta el nombre del cliente");
    const comprador: Record<string, string> = { RNCComprador: rncComprador, RazonSocialComprador: nombre };
    if (cliente.email?.trim()) comprador.CorreoComprador = cliente.email.trim();
    if (cliente.direccion?.trim()) comprador.DireccionComprador = limpio(cliente.direccion, 100);
    encabezado.Comprador = comprador;
  }

  if (tipo === "34") {
    if (!e.referencia) throw new Error("La nota de credito necesita el comprobante que modifica");
    encabezado.InformacionReferencia = {
      NCFModificado: e.referencia.ncf_modificado,
      FechaNCFModificado: fechaEcf(e.referencia.fecha_ncf_modificado),
      CodigoModificacion: "1",
      RazonModificacion: limpio(e.referencia.razon, 90) || "Anulacion de factura",
    };
  }
  encabezado.Totales = totales;

  return { ECF: { Encabezado: encabezado, DetallesItems: { Item: items } } };
}

// ---------- respuesta del proveedor ----------

// INCIERTO: la peticion salio y no se sabe si el proveedor la tomo (no se reenvia sola: seria un comprobante doble).
export type EstadoEcf = "ACEPTADO" | "EN_PROCESO" | "RECHAZADO" | "PROFORMA" | "ERROR" | "INCIERTO";

export interface RespuestaEcf {
  estado: EstadoEcf;
  ncf: string | null;
  mensaje: string | null;
  id_proveedor: number | null;
  track_id: string | null;
  qr_link: string | null;
  pdf_url: string | null;
  xml_path: string | null;
  codigo_seguridad: string | null;
  fecha_firma: string | null;
}

const texto = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export const MENSAJE_PROVEEDOR_ROTO = "ef2 fallo al responder y no se sabe si el comprobante salio. Revisa en su portal antes de reenviarlo.";

/** Lee lo que devuelve /procesar_factura.php (el estado se compara por prefijo: la DGII puede agregar mensajes). */
export function leerRespuestaEcf(http: number, cuerpo: any, esProforma: boolean): RespuestaEcf {
  const dgii = cuerpo?.dgii_info ?? {};
  const base = {
    ncf: texto(cuerpo?.ncf) ?? texto(cuerpo?.encf) ?? (esProforma ? texto(cuerpo?.numero_proforma) : null),
    id_proveedor: Number.isFinite(Number(cuerpo?.id_factura)) && cuerpo?.id_factura != null ? Number(cuerpo.id_factura) : null,
    track_id: texto(dgii.track_id) ?? texto(cuerpo?.track_id),
    qr_link: texto(cuerpo?.qr_link),
    pdf_url: texto(cuerpo?.pdf_cloud_url),
    xml_path: texto(cuerpo?.xml_path),
    codigo_seguridad: texto(dgii.codigo_seguridad),
    fecha_firma: texto(dgii.fecha_firma) ?? texto(cuerpo?.fecha_firma),
  };
  const rechazo = texto(dgii.mensaje_rechazo) ?? texto(cuerpo?.message);
  if (http >= 200 && http < 300 && cuerpo?.success !== false) {
    if (esProforma) return { ...base, estado: "PROFORMA", mensaje: null };
    const est = (texto(cuerpo?.estado) ?? "").toLowerCase();
    if (est.startsWith("acept")) return { ...base, estado: "ACEPTADO", mensaje: null };
    if (est.startsWith("rechaz")) return { ...base, estado: "RECHAZADO", mensaje: rechazo ?? "La DGII rechazo el comprobante" };
    // "En Proceso", "Procesado", "Condicional"...: todavia no es final
    return { ...base, estado: "EN_PROCESO", mensaje: texto(cuerpo?.estado) };
  }
  if (cuerpo?.code === "DGII_REJECTED") return { ...base, estado: "RECHAZADO", mensaje: rechazo ?? "La DGII rechazo el comprobante" };
  // El proveedor se rompio y contesto algo que no es una respuesta (una pagina de error): pudo fallar DESPUES de emitir.
  if (cuerpo?.respuesta_ilegible && !(http >= 400 && http < 500)) {
    return { ...base, estado: "INCIERTO", mensaje: MENSAJE_PROVEEDOR_ROTO };
  }
  // Fallos donde el comprobante pudo haberse emitido igual: no se reenvia sin revisar en el portal.
  const pudoEmitirse =
    (http >= 500 && cuerpo?.code !== "NCF_ERROR" && cuerpo?.code !== "JSON_ERROR") ||
    cuerpo?.dgii_processed === true ||
    (cuerpo?.code === "DGII_ERROR" && cuerpo?.ncf_revertido !== true);
  if (pudoEmitirse) return { ...base, estado: "INCIERTO", mensaje: rechazo ?? `El proveedor respondio ${http}: revisa en su portal si se emitio` };
  return { ...base, estado: "ERROR", mensaje: rechazo ?? `Error ${http} del proveedor` };
}
