// Lo que lleva el recibo o la factura impresa cuando es un comprobante electronico (e-CF):
// el e-NCF, el QR para validarlo en la DGII y el codigo de seguridad. Todo en negro puro (papel termico).
import qrcode from "qrcode-generator";
import { html } from "./exportar";
import type { EcfDocumento } from "./types";

const TITULOS: Record<string, string> = {
  E31: "Factura de Crédito Fiscal Electrónica",
  E32: "Factura de Consumo Electrónica",
  E34: "Nota de Crédito Electrónica",
  E45: "Comprobante Gubernamental Electrónico",
};

/** "E320000000001" -> "Factura de Consumo Electrónica" (null si no es un e-NCF). */
export function tituloEcf(ncf: string | null | undefined): string | null {
  return ncf ? TITULOS[ncf.slice(0, 3)] ?? null : null;
}

// Nombre del comprobante en la lista de la venta: en modo prueba y real la lista muestra el nombre E (B02 -> E32, B01 -> E31, B15 -> E45).
const E_DE_B: Record<string, string> = { B02: "E32 - Factura de Consumo Electrónica", B01: "E31 - Factura de Crédito Fiscal Electrónica", B15: "E45 - Comprobante Gubernamental Electrónico" };
export function etiquetaTipoVenta(tipo: string, nombreB: string, conE: boolean): string {
  return conE && E_DE_B[tipo] ? E_DE_B[tipo] : nombreB;
}

function qrSvg(texto: string): string {
  const qr = qrcode(0, "M");
  qr.addData(texto);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
}

// "2026-11-17T14:03:11" o "17-11-2026 14:03:11" -> tal cual, sin la T
const fechaFirma = (f: string) => f.replace("T", " ").replace(/\.\d+Z?$/, "");

/** Bloque para el pie del recibo. Vacio si la factura no es electronica. */
export function bloqueEcf(ecf: EcfDocumento | null | undefined, ladoMm: number): string {
  if (!ecf) return "";
  if (ecf.estado === "PROFORMA") {
    // QR de muestra para ver como queda la factura electronica. Si ef2 devolvio un enlace se usa ese; si no, un texto que dice que es de prueba.
    // En ningun caso valida nada en la DGII.
    const contenidoQr = ecf.qr_link || `PRUEBA DE FACTURA ELECTRONICA - SIN VALOR FISCAL${ecf.ncf ? ` - ${ecf.ncf}` : ""}`;
    return `<div style="margin-top: 8px; text-align: center">
      <div style="width: ${ladoMm}mm; margin: 0 auto 2px">${qrSvg(contenidoQr)}</div>
      <div style="font-weight: 700; border: 1px solid #000; padding: 3px">PRUEBA DE FACTURA ELECTRÓNICA<br>SIN VALOR FISCAL${ecf.ncf ? `<br>${html(ecf.ncf)}` : ""}</div>
      <div style="font-size: 0.85em">QR de muestra: no valida en la DGII</div>
    </div>`;
  }
  if ((ecf.estado === "ACEPTADO" || ecf.estado === "EN_PROCESO") && ecf.ncf) {
    return `<div style="margin-top: 8px; text-align: center">
      ${ecf.qr_link ? `<div style="width: ${ladoMm}mm; margin: 0 auto 2px">${qrSvg(ecf.qr_link)}</div>` : ""}
      <div style="font-weight: 700">e-NCF: ${html(ecf.ncf)}</div>
      ${ecf.codigo_seguridad ? `<div>Código de seguridad: ${html(ecf.codigo_seguridad)}</div>` : ""}
      ${ecf.fecha_firma ? `<div>Fecha de firma: ${html(fechaFirma(ecf.fecha_firma))}</div>` : ""}
      ${ecf.qr_link ? `<div style="font-size: 0.85em">Escanea el QR para validar este comprobante en la DGII</div>` : ""}
    </div>`;
  }
  return `<div style="margin-top: 8px; text-align: center; font-weight: 700; border: 1px solid #000; padding: 3px">COMPROBANTE ELECTRÓNICO PENDIENTE<br>Este recibo no es la factura fiscal</div>`;
}
