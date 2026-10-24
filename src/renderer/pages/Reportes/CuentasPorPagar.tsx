import { Fragment, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { formatDate, formatMoney, todayIso } from "../../lib/format";
import { descargarCsv, imprimirTabla } from "../../lib/exportar";
import type { CxpDocumento, CxpSuplidor } from "../../lib/types";
import { Badge, Button, EmptyRow, PageHeader, StatCard, Table } from "../../components/ui";
import { BotonesExportar, Pestanas, tonoDias } from "../../components/reportes";
import PagoSuplidorModal, { type DocumentoPorPagar } from "../../components/PagoSuplidor";

type Vista = "SUPLIDORES" | "DOCUMENTOS";
const clave = (x: { proveedor_id: number | null; suplidor: string }) => (x.proveedor_id ? `p${x.proveedor_id}` : `n${x.suplidor.toLowerCase()}`);
const r2 = (n: number) => Math.round(n * 100) / 100;

export default function CuentasPorPagar() {
  const [vista, setVista] = useState<Vista>("SUPLIDORES");
  const [suplidores, setSuplidores] = useState<CxpSuplidor[]>([]);
  const [docs, setDocs] = useState<CxpDocumento[]>([]);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [pagar, setPagar] = useState<DocumentoPorPagar | null>(null);
  const [empresa, setEmpresa] = useState("");

  async function cargar() {
    const [s, d] = await Promise.all([api.cxp.porSuplidor(), api.cxp.documentos()]);
    setSuplidores(s);
    setDocs(d);
  }
  useEffect(() => {
    cargar();
    api.config.obtener().then((c: any) => setEmpresa(c?.nombre_empresa ?? ""));
  }, []);

  const total = r2(suplidores.reduce((s, x) => s + x.total_adeudado, 0));
  const vencido = r2(suplidores.reduce((s, x) => s + x.b31_60 + x.b61_90 + x.b90, 0));
  const mercancia = r2(docs.filter((d) => d.origen === "COMPRA").reduce((s, d) => s + d.saldo, 0));
  const sum = (k: keyof CxpSuplidor) => r2(suplidores.reduce((s, x) => s + Number(x[k]), 0));

  function exportar(imprimir: boolean) {
    const sub = `Al ${formatDate(todayIso())}`;
    if (vista === "SUPLIDORES") {
      const enc = ["Suplidor", "Documentos", "0-30 dias", "31-60 dias", "61-90 dias", "Mas de 90", "Total adeudado"];
      if (!imprimir) return descargarCsv("cxp-por-suplidor.csv", enc, suplidores.map((x) => [x.suplidor, x.documentos, x.b0_30, x.b31_60, x.b61_90, x.b90, x.total_adeudado]));
      return imprimirTabla({
        titulo: "Cuentas por Pagar por suplidor",
        subtitulo: sub,
        empresa,
        encabezados: enc,
        derecha: [1, 2, 3, 4, 5, 6],
        filas: suplidores.map((x) => [x.suplidor, x.documentos, formatMoney(x.b0_30), formatMoney(x.b31_60), formatMoney(x.b61_90), formatMoney(x.b90), formatMoney(x.total_adeudado)]),
        pie: ["TOTAL", sum("documentos"), formatMoney(sum("b0_30")), formatMoney(sum("b31_60")), formatMoney(sum("b61_90")), formatMoney(sum("b90")), formatMoney(total)],
      });
    }
    const enc = ["Tipo", "No.", "Fecha", "Suplidor", "NCF", "Detalle", "Total", "Pagado", "Saldo", "Dias"];
    if (!imprimir) return descargarCsv("cxp-documentos.csv", enc, docs.map((d) => [d.origen === "COMPRA" ? "Compra" : "Gasto", d.numero, d.fecha, d.suplidor, d.ncf ?? "", d.detalle, d.total, d.pagado, d.saldo, d.dias]));
    return imprimirTabla({
      titulo: "Cuentas por Pagar - documentos",
      subtitulo: sub,
      empresa,
      encabezados: enc,
      derecha: [6, 7, 8, 9],
      filas: docs.map((d) => [d.origen === "COMPRA" ? "Compra" : "Gasto", d.numero, formatDate(d.fecha), d.suplidor, d.ncf ?? "", d.detalle, formatMoney(d.total), formatMoney(d.pagado), formatMoney(d.saldo), d.dias]),
      pie: ["TOTAL", "", "", "", "", "", "", "", formatMoney(total), ""],
    });
  }

  const filaDoc = (d: CxpDocumento, compacta = false) => (
    <tr key={`${d.origen}${d.id}`} className={compacta ? "border-t border-slate-200" : ""}>
      <td className={compacta ? "py-1" : "px-4 py-2"}>
        <Badge tone={d.origen === "COMPRA" ? "blue" : "slate"}>{d.origen === "COMPRA" ? "Mercancia" : d.detalle}</Badge>
      </td>
      <td className={`${compacta ? "py-1" : "px-4 py-2"} font-mono text-xs`}>{d.ncf ?? `#${d.numero}`}</td>
      <td className={compacta ? "py-1" : "px-4 py-2"}>{formatDate(d.fecha)}</td>
      {!compacta && <td className="px-4 py-2 font-medium text-slate-800">{d.suplidor}</td>}
      <td className={`${compacta ? "py-1" : "px-4 py-2"} text-right`}>{formatMoney(d.total)}</td>
      <td className={`${compacta ? "py-1" : "px-4 py-2"} text-right text-emerald-600`}>{formatMoney(d.pagado)}</td>
      <td className={`${compacta ? "py-1" : "px-4 py-2"} text-right font-semibold text-amber-600`}>{formatMoney(d.saldo)}</td>
      <td className={compacta ? "py-1 text-right" : "px-4 py-2"}>
        <Badge tone={tonoDias(d.dias)}>{d.dias}d</Badge>
      </td>
      <td className={`${compacta ? "py-1" : "px-4 py-2"} text-right`}>
        <Button size="sm" onClick={() => setPagar({ origen: d.origen, id: d.id, numero: d.numero, suplidor: d.suplidor, ncf: d.ncf, saldo: d.saldo })}>
          Pagar
        </Button>
      </td>
    </tr>
  );

  return (
    <div>
      <PageHeader
        title="Cuentas por Pagar"
        subtitle="Lo que le debes a cada suplidor: compras de mercancia y gastos a credito"
        actions={<BotonesExportar onExcel={() => exportar(false)} onImprimir={() => exportar(true)} />}
      />
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-4">
        <StatCard label="Total por pagar" value={formatMoney(total)} tone="amber" hint={`${docs.length} documentos`} />
        <StatCard label="Suplidores" value={String(suplidores.length)} />
        <StatCard label="Con mas de 30 dias" value={formatMoney(vencido)} tone={vencido > 0 ? "red" : "slate"} />
        <StatCard label="De mercancia" value={formatMoney(mercancia)} hint={`Gastos: ${formatMoney(total - mercancia)}`} />
      </div>
      <Pestanas<Vista>
        opciones={[
          ["SUPLIDORES", "Por suplidor (total acumulado)"],
          ["DOCUMENTOS", "Todas las facturas pendientes"],
        ]}
        valor={vista}
        onChange={setVista}
      />

      {vista === "SUPLIDORES" ? (
        <Table columns={["Suplidor", "Documentos", "0-30 dias", "31-60 dias", "61-90 dias", "Mas de 90", "Total adeudado"]}>
          {suplidores.length === 0 && <EmptyRow colSpan={7} label="No le debes nada a ningun suplidor" />}
          {suplidores.map((x) => (
            <Fragment key={clave(x)}>
              <tr className="cursor-pointer hover:bg-slate-50" onClick={() => setAbierto(abierto === clave(x) ? null : clave(x))}>
                <td className="px-4 py-2">
                  <span className="mr-1 text-slate-400">{abierto === clave(x) ? "▾" : "▸"}</span>
                  <span className="font-medium text-slate-800">{x.suplidor}</span>
                </td>
                <td className="px-4 py-2 text-center">{x.documentos}</td>
                <td className="px-4 py-2 text-right">{x.b0_30 ? formatMoney(x.b0_30) : "-"}</td>
                <td className="px-4 py-2 text-right text-amber-600">{x.b31_60 ? formatMoney(x.b31_60) : "-"}</td>
                <td className="px-4 py-2 text-right text-red-500">{x.b61_90 ? formatMoney(x.b61_90) : "-"}</td>
                <td className="px-4 py-2 text-right font-medium text-red-600">{x.b90 ? formatMoney(x.b90) : "-"}</td>
                <td className="px-4 py-2 text-right text-base font-semibold">{formatMoney(x.total_adeudado)}</td>
              </tr>
              {abierto === clave(x) && (
                <tr className="bg-slate-50/70">
                  <td colSpan={7} className="px-10 py-3">
                    <table className="w-full text-xs">
                      <tbody>{docs.filter((d) => clave(d) === clave(x)).map((d) => filaDoc(d, true))}</tbody>
                    </table>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
          {suplidores.length > 0 && (
            <tr className="bg-slate-50 font-semibold">
              <td className="px-4 py-2">TOTAL</td>
              <td className="px-4 py-2 text-center">{sum("documentos")}</td>
              <td className="px-4 py-2 text-right">{formatMoney(sum("b0_30"))}</td>
              <td className="px-4 py-2 text-right">{formatMoney(sum("b31_60"))}</td>
              <td className="px-4 py-2 text-right">{formatMoney(sum("b61_90"))}</td>
              <td className="px-4 py-2 text-right">{formatMoney(sum("b90"))}</td>
              <td className="px-4 py-2 text-right text-base">{formatMoney(total)}</td>
            </tr>
          )}
        </Table>
      ) : (
        <Table columns={["Tipo", "NCF / No.", "Fecha", "Suplidor", "Total", "Pagado", "Saldo", "Dias", ""]}>
          {docs.length === 0 && <EmptyRow colSpan={9} label="No hay facturas por pagar" />}
          {docs.map((d) => filaDoc(d))}
        </Table>
      )}

      <PagoSuplidorModal doc={pagar} onClose={() => setPagar(null)} onPagado={cargar} />
    </div>
  );
}
