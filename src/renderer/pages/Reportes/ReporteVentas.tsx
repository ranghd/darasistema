import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { formatDate, formatMoney } from "../../lib/format";
import { descargarCsv, imprimirTabla } from "../../lib/exportar";
import type { ReporteVentas as Datos } from "../../lib/types";
import { Card, EmptyRow, PageHeader, StatCard, Table } from "../../components/ui";
import { BotonesExportar, Pestanas, RangoFechas, rangoDe } from "../../components/reportes";

type Vista = "RESUMEN" | "PRODUCTO" | "VENDEDOR" | "CLIENTE" | "DIA";
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "-");

export default function ReporteVentas() {
  const [rango, setRango] = useState(rangoDe("MES"));
  const [vista, setVista] = useState<Vista>("RESUMEN");
  const [datos, setDatos] = useState<Datos | null>(null);
  const [empresa, setEmpresa] = useState<string>("");

  useEffect(() => {
    api.config.obtener().then((c: any) => setEmpresa(c?.nombre_empresa ?? ""));
  }, []);
  useEffect(() => {
    api.reportes.ventas(rango.desde, rango.hasta).then(setDatos);
  }, [rango.desde, rango.hasta]);

  const r = datos?.resumen;
  const periodo = `Del ${formatDate(rango.desde)} al ${formatDate(rango.hasta)}`;

  // Cada pestana se exporta tal como se ve.
  function tabla(): { titulo: string; enc: string[]; filas: (string | number)[][]; impresas: (string | number)[][]; der: number[]; pie?: (string | number)[] } | null {
    if (!datos || !r) return null;
    if (vista === "PRODUCTO")
      return {
        titulo: "Ventas por producto",
        enc: ["Codigo", "Producto", "Cantidad", "Venta (sin ITBIS)", "ITBIS", "Costo estimado", "Ganancia", "% de la venta"],
        der: [2, 3, 4, 5, 6, 7],
        filas: datos.porProducto.map((p) => [p.codigo, p.nombre, p.cantidad, p.venta, p.itbis, p.costo, p.ganancia, pct(p.venta, r.subtotal)]),
        impresas: datos.porProducto.map((p) => [p.codigo, p.nombre, p.cantidad, formatMoney(p.venta), formatMoney(p.itbis), formatMoney(p.costo), formatMoney(p.ganancia), pct(p.venta, r.subtotal)]),
        pie: ["", "TOTAL", datos.porProducto.reduce((s, p) => s + p.cantidad, 0), formatMoney(r.subtotal), formatMoney(r.itbis), formatMoney(r.costo), formatMoney(r.ganancia), "100%"],
      };
    if (vista === "VENDEDOR")
      return {
        titulo: "Ventas por vendedor",
        enc: ["Vendedor", "Facturas", "Venta (sin ITBIS)", "Total facturado", "Promedio por factura", "% del total"],
        der: [1, 2, 3, 4, 5],
        filas: datos.porVendedor.map((v) => [v.vendedor, v.facturas, v.subtotal, v.total, v.promedio, pct(v.total, r.total)]),
        impresas: datos.porVendedor.map((v) => [v.vendedor, v.facturas, formatMoney(v.subtotal), formatMoney(v.total), formatMoney(v.promedio), pct(v.total, r.total)]),
        pie: ["TOTAL", r.facturas, formatMoney(r.subtotal), formatMoney(r.total), formatMoney(r.promedio), "100%"],
      };
    if (vista === "CLIENTE")
      return {
        titulo: "Ventas por cliente",
        enc: ["Cliente", "Facturas", "Venta (sin ITBIS)", "Total facturado", "% del total"],
        der: [1, 2, 3, 4],
        filas: datos.porCliente.map((c) => [c.nombre, c.facturas, c.subtotal, c.total, pct(c.total, r.total)]),
        impresas: datos.porCliente.map((c) => [c.nombre, c.facturas, formatMoney(c.subtotal), formatMoney(c.total), pct(c.total, r.total)]),
        pie: ["TOTAL", r.facturas, formatMoney(r.subtotal), formatMoney(r.total), "100%"],
      };
    if (vista === "DIA")
      return {
        titulo: "Ventas por dia",
        enc: ["Fecha", "Facturas", "Venta (sin ITBIS)", "ITBIS", "Total"],
        der: [1, 2, 3, 4],
        filas: datos.porDia.map((d) => [d.fecha, d.facturas, d.subtotal, d.itbis, d.total]),
        impresas: datos.porDia.map((d) => [formatDate(d.fecha), d.facturas, formatMoney(d.subtotal), formatMoney(d.itbis), formatMoney(d.total)]),
        pie: ["TOTAL", r.facturas, formatMoney(r.subtotal), formatMoney(r.itbis), formatMoney(r.total)],
      };
    const filasResumen: [string, number | string][] = [
      ["Facturas emitidas", r.facturas],
      ["Clientes atendidos", r.clientes],
      ["Venta sin ITBIS", r.subtotal],
      ["Descuentos dados", r.descuentos],
      ["ITBIS cobrado", r.itbis],
      ["Fianzas de envases", r.fianzas],
      ["Total facturado", r.total],
      ["Al contado", r.contado],
      ["A credito", r.credito],
      ["Efectivo", r.efectivo],
      ["Tarjeta", r.tarjeta],
      ["Transferencia", r.transferencia],
      ["Cheque", r.cheque],
      ["Promedio por factura", r.promedio],
      ["Costo estimado de lo vendido", r.costo],
      ["Ganancia estimada", r.ganancia],
      ["Facturas anuladas", `${r.anuladas} (${formatMoney(r.total_anulado)})`],
    ];
    return {
      titulo: "Resumen de ventas",
      enc: ["Concepto", "Valor"],
      der: [1],
      filas: filasResumen,
      impresas: filasResumen.map(([k, v]) => [k, typeof v === "number" && !["Facturas emitidas", "Clientes atendidos"].includes(k) ? formatMoney(v) : v]),
    };
  }

  function excel() {
    const t = tabla();
    if (t) descargarCsv(`${t.titulo.toLowerCase().replace(/\s+/g, "-")}-${rango.desde}-a-${rango.hasta}.csv`, t.enc, t.filas);
  }
  function imprimir() {
    const t = tabla();
    if (t) imprimirTabla({ titulo: t.titulo, subtitulo: periodo, empresa, encabezados: t.enc, filas: t.impresas, derecha: t.der, pie: t.pie });
  }

  return (
    <div>
      <PageHeader title="Reporte de Ventas" subtitle="Resumen general, por producto, por vendedor, por cliente y por dia" actions={<BotonesExportar onExcel={excel} onImprimir={imprimir} deshabilitado={!datos} />} />
      <div className="mb-5">
        <RangoFechas desde={rango.desde} hasta={rango.hasta} onChange={setRango} />
      </div>

      {r && (
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Total facturado" value={formatMoney(r.total)} tone="blue" hint={`${r.facturas} facturas · ${r.clientes} clientes`} />
          <StatCard label="Venta sin ITBIS" value={formatMoney(r.subtotal)} hint={`ITBIS: ${formatMoney(r.itbis)}`} />
          <StatCard label="Ganancia estimada" value={formatMoney(r.ganancia)} tone="green" hint={`Margen ${pct(r.ganancia, r.subtotal)}`} />
          <StatCard label="A credito" value={formatMoney(r.credito)} tone="amber" hint={`Al contado: ${formatMoney(r.contado)}`} />
        </div>
      )}

      <Pestanas<Vista>
        opciones={[
          ["RESUMEN", "Resumen general"],
          ["PRODUCTO", "Por producto"],
          ["VENDEDOR", "Por vendedor"],
          ["CLIENTE", "Por cliente"],
          ["DIA", "Por dia"],
        ]}
        valor={vista}
        onChange={setVista}
      />

      {!datos && <p className="text-sm text-slate-400">Cargando...</p>}

      {datos && r && vista === "RESUMEN" && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <Card className="space-y-2 p-5 text-sm">
            <h3 className="mb-1 font-semibold text-slate-700">Ventas</h3>
            <Fila k="Venta sin ITBIS" v={r.subtotal} />
            <Fila k="Descuentos dados" v={-r.descuentos} />
            <Fila k="ITBIS cobrado" v={r.itbis} />
            <Fila k="Fianzas de envases" v={r.fianzas} />
            <Fila k="Total facturado" v={r.total} fuerte />
            <Fila k="Promedio por factura" v={r.promedio} />
            <p className="pt-1 text-xs text-slate-400">
              Anuladas en el periodo: {r.anuladas} ({formatMoney(r.total_anulado)}), no se cuentan.
            </p>
          </Card>
          <Card className="space-y-2 p-5 text-sm">
            <h3 className="mb-1 font-semibold text-slate-700">Como se cobro</h3>
            <Fila k="Efectivo" v={r.efectivo} />
            <Fila k="Tarjeta" v={r.tarjeta} />
            <Fila k="Transferencia" v={r.transferencia} />
            <Fila k="Cheque" v={r.cheque} />
            <Fila k="Al contado" v={r.contado} fuerte />
            <Fila k="A credito (por cobrar)" v={r.credito} />
          </Card>
          <Card className="space-y-2 p-5 text-sm">
            <h3 className="mb-1 font-semibold text-slate-700">Ganancia</h3>
            <Fila k="Venta sin ITBIS" v={r.subtotal} />
            <Fila k="Costo de lo vendido" v={-r.costo} />
            <Fila k="Ganancia estimada" v={r.ganancia} fuerte />
            <p className="pt-1 text-xs text-slate-400">El costo se calcula con el costo promedio actual de cada producto.</p>
          </Card>
        </div>
      )}

      {datos && vista === "PRODUCTO" && (
        <Table columns={["Producto", "Cantidad", "Venta (sin ITBIS)", "ITBIS", "Costo", "Ganancia", "% de la venta"]}>
          {datos.porProducto.length === 0 && <EmptyRow colSpan={7} label="No hubo ventas en este periodo" />}
          {datos.porProducto.map((p) => (
            <tr key={p.producto_id}>
              <td className="px-4 py-2">
                <span className="font-medium text-slate-800">{p.nombre}</span> <span className="font-mono text-xs text-slate-400">{p.codigo}</span>
              </td>
              <td className="px-4 py-2 text-right">{p.cantidad}</td>
              <td className="px-4 py-2 text-right font-medium">{formatMoney(p.venta)}</td>
              <td className="px-4 py-2 text-right text-slate-500">{formatMoney(p.itbis)}</td>
              <td className="px-4 py-2 text-right text-slate-500">{formatMoney(p.costo)}</td>
              <td className="px-4 py-2 text-right font-semibold text-emerald-600">{formatMoney(p.ganancia)}</td>
              <td className="px-4 py-2">
                <Barra valor={p.venta} total={datos.resumen.subtotal} />
              </td>
            </tr>
          ))}
        </Table>
      )}

      {datos && vista === "VENDEDOR" && (
        <Table columns={["Vendedor", "Facturas", "Venta (sin ITBIS)", "Total facturado", "Promedio", "% del total"]}>
          {datos.porVendedor.length === 0 && <EmptyRow colSpan={6} label="No hubo ventas en este periodo" />}
          {datos.porVendedor.map((v) => (
            <tr key={v.vendedor}>
              <td className="px-4 py-2 font-medium text-slate-800">{v.vendedor}</td>
              <td className="px-4 py-2 text-right">{v.facturas}</td>
              <td className="px-4 py-2 text-right">{formatMoney(v.subtotal)}</td>
              <td className="px-4 py-2 text-right font-semibold">{formatMoney(v.total)}</td>
              <td className="px-4 py-2 text-right text-slate-500">{formatMoney(v.promedio)}</td>
              <td className="px-4 py-2">
                <Barra valor={v.total} total={datos.resumen.total} />
              </td>
            </tr>
          ))}
        </Table>
      )}

      {datos && vista === "CLIENTE" && (
        <Table columns={["Cliente", "Facturas", "Venta (sin ITBIS)", "Total facturado", "% del total"]}>
          {datos.porCliente.length === 0 && <EmptyRow colSpan={5} label="No hubo ventas en este periodo" />}
          {datos.porCliente.map((c) => (
            <tr key={c.cliente_id}>
              <td className="px-4 py-2 font-medium text-slate-800">{c.nombre}</td>
              <td className="px-4 py-2 text-right">{c.facturas}</td>
              <td className="px-4 py-2 text-right">{formatMoney(c.subtotal)}</td>
              <td className="px-4 py-2 text-right font-semibold">{formatMoney(c.total)}</td>
              <td className="px-4 py-2">
                <Barra valor={c.total} total={datos.resumen.total} />
              </td>
            </tr>
          ))}
        </Table>
      )}

      {datos && vista === "DIA" && (
        <Table columns={["Fecha", "Facturas", "Venta (sin ITBIS)", "ITBIS", "Total"]}>
          {datos.porDia.length === 0 && <EmptyRow colSpan={5} label="No hubo ventas en este periodo" />}
          {datos.porDia.map((d) => (
            <tr key={d.fecha}>
              <td className="px-4 py-2">{formatDate(d.fecha)}</td>
              <td className="px-4 py-2 text-right">{d.facturas}</td>
              <td className="px-4 py-2 text-right">{formatMoney(d.subtotal)}</td>
              <td className="px-4 py-2 text-right text-slate-500">{formatMoney(d.itbis)}</td>
              <td className="px-4 py-2 text-right font-semibold">{formatMoney(d.total)}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

function Fila({ k, v, fuerte = false }: { k: string; v: number; fuerte?: boolean }) {
  return (
    <div className={`flex justify-between ${fuerte ? "border-t border-slate-200 pt-2 font-semibold text-slate-900" : "text-slate-600"}`}>
      <span>{k}</span>
      <span>{formatMoney(v)}</span>
    </div>
  );
}

function Barra({ valor, total }: { valor: number; total: number }) {
  const p = total ? Math.max(0, Math.min(100, (valor / total) * 100)) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-28 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-brand-500" style={{ width: `${p}%` }} />
      </div>
      <span className="w-12 text-right text-xs text-slate-500">{p.toFixed(1)}%</span>
    </div>
  );
}
