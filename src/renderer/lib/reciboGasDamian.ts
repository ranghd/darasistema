// Recibo de Gas Damian para la impresora termica (80 / 58 mm), al estilo de una factura clasica:
// logo y datos del negocio arriba, cada producto con su ITBIS y los totales, sin recuadros.
// Todo en negro puro: en papel termico los grises salen borrosos.
import { api, mensajeDeError } from "./api";
import { html } from "./exportar";
import { formatMoney } from "./format";
import { NCF_LABELS } from "./ncf";
import { PIE_FACTURA, imprimirFacturaCarta, prestadosPendientes } from "./facturaCarta";
import { avisoDeResultado, type AvisoImpresion } from "./ticket";
import type { Cliente, Cobro, CompanyConfig, FacturaDetalle, SaldoBotellaFiada, TipoNcf } from "./types";
import logo from "../assets/gas-damian-ticket.png?inline";

const METODOS: Record<string, string> = { EFECTIVO: "Efectivo", TRANSFERENCIA: "Transferencia", TARJETA: "Tarjeta", CHEQUE: "Cheque" };

const dinero = (n: number) => formatMoney(n).replace("RD$", "");

/** Lo que entrego el cliente al pagar en efectivo (solo se sabe al cobrar en la caja). */
export interface PagoEfectivo {
  recibido: number;
  devuelta: number;
}

// "2026-11-02 21:47:10" -> "9:47 p. m."
function hora(creadoEn: string | undefined): string {
  const [h, m] = (creadoEn?.slice(11, 16) ?? "").split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return "";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "a. m." : "p. m."}`;
}

function envase(l: FacturaDetalle["lineas"][number]): string {
  if (!l.maneja_envase) return "";
  if (l.prestado) return "Cilindro PRESTADO: lo tiene que devolver";
  if (l.modalidad === "LLENO") return `Se lleva el cilindro${l.fianza_envase ? ` (fianza ${dinero(l.fianza_envase * l.cantidad)})` : ""}`;
  return "Cambio: entregó su cilindro vacío";
}

export function htmlReciboGasDamian(
  f: FacturaDetalle,
  empresa: CompanyConfig | null,
  cliente: Cliente | null,
  cobros: Cobro[],
  prestados: SaldoBotellaFiada[],
  anchoMm: number,
  pago?: PagoEfectivo | null
): string {
  const angosto = anchoMm <= 58;
  const tipo = (f.ncf?.slice(0, 3) ?? "") as TipoNcf;
  const titulo = NCF_LABELS[tipo]?.split(" - ")[1] ?? "Factura";
  const descuento = f.lineas.reduce((s, l) => s + (l.descuento ?? 0), 0);
  const cobrado = cobros.reduce((s, c) => s + c.monto, 0);

  const productos = f.lineas
    .map((l) => {
      const bruto = l.cantidad * l.precio_unitario - (l.descuento ?? 0);
      const nota = envase(l);
      return `<div class="b">${html((l.producto_nombre ?? "").toUpperCase())}</div>
        <div class="det"><span>${l.cantidad} X ${dinero(l.precio_unitario)}</span><span>${dinero(l.itbis ?? 0)}</span><span>${dinero(bruto + (l.itbis ?? 0))}</span></div>
        ${l.descuento ? `<div class="nota">Descuento -${dinero(l.descuento)}</div>` : ""}
        ${nota ? `<div class="nota">(${html(nota)})</div>` : ""}`;
    })
    .join("");

  const prestadosAhora = f.lineas.filter((l) => l.maneja_envase && l.prestado).reduce((s, l) => s + l.cantidad, 0);
  const debe = prestados.reduce((s, p) => s + p.pendientes, 0);
  const fecha = f.fecha.split("-").reverse().join("/");
  const fila = (etiqueta: string, valor: string, clase = "") => `<div class="tot ${clase}"><span>${etiqueta}</span><span>${valor}</span></div>`;

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { margin: 0; }
    html, body { margin: 0; background: #fff; }
    /* pegado a la izquierda y mas angosto que el papel: estas termicas no imprimen los ultimos mm del lado derecho */
    body { width: ${angosto ? 46 : 68}mm; margin: 0; padding: 1mm 0 6mm 1mm; font-family: Arial, sans-serif; font-size: ${angosto ? 10 : 12}px; color: #000; line-height: 1.25; }
    .c { text-align: center; } .b { font-weight: 700; }
    .logo { display: block; width: ${angosto ? 28 : 34}mm; margin: 0 auto 1mm; }
    .fila, .det, .tit { display: flex; justify-content: space-between; }
    .tit { font-weight: 700; border-bottom: 1px solid #000; margin-top: 3px; }
    .tit span:first-child, .det span:first-child { flex: 1; }
    .tit span:nth-child(2), .det span:nth-child(2) { width: 22%; text-align: right; }
    .tit span:nth-child(3), .det span:nth-child(3) { width: 26%; text-align: right; }
    .det { margin-bottom: 2px; }
    .nota { font-size: 0.9em; }
    .linea { border-top: 1px solid #000; margin: 2px 0 3px; }
    .tot { display: flex; justify-content: flex-end; }
    .tot span:first-child { text-align: right; }
    .tot span:last-child { width: 30%; text-align: right; }
    .neto { font-weight: 700; font-size: 1.2em; }
  </style></head><body>
    <img class="logo" src="${logo}" alt="">
    <div class="c b" style="font-size: 1.2em">${html((empresa?.nombre_empresa ?? "").toUpperCase())}</div>
    ${empresa?.direccion ? `<div class="c">${html(empresa.direccion)}</div>` : ""}
    <div class="c">${[empresa?.telefono ? `Tel. ${html(empresa.telefono)}` : "", empresa?.rnc ? `RNC ${html(empresa.rnc)}` : ""].filter(Boolean).join(" ")}</div>
    <div class="fila" style="margin-top: 4px"><span>Fecha: ${fecha}</span><span>Hr: ${hora(f.creado_en)}</span></div>
    <div>${html(titulo)}</div>
    <div>NCF: ${html(f.ncf ?? "-")}</div>
    <div>Factura ${f.condicion_pago === "CREDITO" ? "Crédito" : "Contado"}</div>
    <div>Cliente: ${html((f.cliente_nombre ?? "Consumidor Final").toUpperCase())}</div>
    <div class="fila"><span>RNC: ${html(cliente?.rnc_cedula ?? "")}</span><span>Fact.: ${f.numero}</span></div>
    ${f.creado_por ? `<div>Usuario: ${html(f.creado_por.toUpperCase())}</div>` : ""}
    <div class="tit"><span>Descripcion</span><span>Itbis</span><span>Valor</span></div>
    ${productos}
    <div class="linea"></div>
    ${fila("Monto Bruto:", dinero(f.subtotal + descuento + f.itbis))}
    ${fila("Descuento:", dinero(descuento))}
    ${fila("Subtotal:", dinero(f.subtotal))}
    ${fila("Itbis:", dinero(f.itbis))}
    ${f.fianza_total ? fila("Fianza cilindros:", dinero(f.fianza_total)) : ""}
    ${fila("Neto:", dinero(f.total), "neto")}
    ${
      f.condicion_pago === "CREDITO"
        ? `<div class="fila" style="margin-top: 3px"><span>Pagado: ${dinero(cobrado)}</span><span class="b">Pendiente: ${dinero(f.total - cobrado)}</span></div>`
        : pago && f.metodo_pago === "EFECTIVO"
          ? `<div class="fila" style="margin-top: 3px"><span>Efectivo: ${dinero(pago.recibido)}</span><span>Cambio: ${dinero(pago.devuelta)}</span></div>`
          : `<div style="margin-top: 3px">Pago: ${html(METODOS[f.metodo_pago ?? "EFECTIVO"] ?? "Efectivo")}</div>`
    }
    ${f.estado === "ANULADA" ? `<div class="c b" style="margin-top: 4px">*** FACTURA ANULADA ***</div>` : ""}
    ${debe ? `<div style="margin-top: 3px">Cilindros prestados por devolver: ${debe}</div>` : ""}
    ${prestadosAhora || f.condicion_pago === "CREDITO" ? `<div style="margin-top: 14px">Recibido por: ______________________</div>` : ""}
    <div class="c b" style="margin-top: 8px">!!GRACIAS POR PREFERIRNOS!!</div>
    <div class="c nota">${html(empresa?.pie_factura || PIE_FACTURA)}</div>
  </body></html>`;
}

// Imprime la factura de Gas Damian como la tenga configurada esta computadora:
// recibo en la termica, o la hoja carta con el dialogo de Windows.
export async function imprimirFacturaGasDamian(facturaId: number, pago?: PagoEfectivo | null): Promise<AvisoImpresion> {
  try {
    const cfg = await api.impresion.obtenerConfig();
    if (cfg.formato === "CARTA") return imprimirFacturaCarta(facturaId);
    const [f, empresa, cobros] = await Promise.all([
      api.facturas.obtener(facturaId) as Promise<FacturaDetalle>,
      api.config.obtener() as Promise<CompanyConfig>,
      api.cobros.listarPorFactura(facturaId) as Promise<Cobro[]>,
    ]);
    const cliente = ((await api.clientes.obtener(f.cliente_id)) as Cliente | undefined) ?? null;
    const prestados = await prestadosPendientes(cliente);
    return avisoDeResultado(await api.impresion.imprimirTicket(htmlReciboGasDamian(f, empresa, cliente, cobros, prestados, cfg.anchoMm, pago)));
  } catch (err) {
    return { ok: false, texto: `No se imprimio: ${mensajeDeError(err, "error desconocido")}` };
  }
}
