import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { descargarCsv, imprimirTabla } from "../../lib/exportar";
import { formatDate, formatMoney, todayIso } from "../../lib/format";
import type { NotaFactura } from "../../lib/types";
import { Badge, Button, Card, EmptyRow, Input, PageHeader, Select, StatCard, Table } from "../../components/ui";

// Historial de notas de credito (B04) y de debito (B03): las que se agregan a una factura
// y las que salen al anularla, con su factura, su cliente y sus montos.

const r2 = (n: number) => Math.round(n * 100) / 100;

export default function NotasFactura() {
  const navegar = useNavigate();
  const [desde, setDesde] = useState(todayIso().slice(0, 7) + "-01");
  const [hasta, setHasta] = useState(todayIso());
  const [tipo, setTipo] = useState<"" | "CREDITO" | "DEBITO">("");
  const [buscar, setBuscar] = useState("");
  const [notas, setNotas] = useState<NotaFactura[]>([]);
  const [empresa, setEmpresa] = useState<string | null>(null);

  useEffect(() => {
    api.notas.listar(desde, hasta).then(setNotas);
  }, [desde, hasta]);

  useEffect(() => {
    api.config.obtener().then((c: any) => setEmpresa(c?.nombre_empresa ?? null));
  }, []);

  const visibles = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return notas.filter(
      (n) => (!tipo || n.tipo === tipo) && (!q || `${n.ncf ?? ""} ${n.factura_ncf ?? ""} ${n.cliente_nombre} ${n.rnc_cedula ?? ""} ${n.motivo ?? ""}`.toLowerCase().includes(q))
    );
  }, [notas, tipo, buscar]);

  const sumar = (t: NotaFactura["tipo"], campo: "total" | "itbis") => r2(visibles.filter((n) => n.tipo === t).reduce((s, n) => s + n[campo], 0));
  const credito = sumar("CREDITO", "total");
  const debito = sumar("DEBITO", "total");
  const itbisNeto = r2(sumar("DEBITO", "itbis") - sumar("CREDITO", "itbis"));

  const encabezados = ["Fecha", "Tipo", "NCF nota", "Factura", "Cliente", "RNC / Cedula", "Motivo", "Monto", "ITBIS", "Total"];
  const filas = () =>
    visibles.map((n) => [
      formatDate(n.fecha),
      n.tipo === "CREDITO" ? (n.anulacion ? "Credito (anulacion)" : "Credito") : "Debito",
      n.ncf ?? "",
      n.factura_ncf ?? String(n.factura_numero),
      n.cliente_nombre,
      n.rnc_cedula ?? "",
      n.motivo ?? "",
      n.monto.toFixed(2),
      n.itbis.toFixed(2),
      n.total.toFixed(2),
    ]);
  const periodo = `Del ${formatDate(desde)} al ${formatDate(hasta)}`;

  return (
    <div>
      <PageHeader
        title="Notas de credito y debito"
        subtitle="Todas las notas (B04 y B03) de las facturas: las que se agregan y las que salen al anular una factura"
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => descargarCsv(`notas-${desde}-a-${hasta}.csv`, encabezados, filas())} disabled={!visibles.length}>
              Excel
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={!visibles.length}
              onClick={() =>
                imprimirTabla({
                  titulo: "Notas de credito y debito",
                  subtitulo: periodo,
                  empresa,
                  encabezados,
                  filas: filas(),
                  derecha: [7, 8, 9],
                  resumen: [
                    ["Notas de credito", formatMoney(credito)],
                    ["Notas de debito", formatMoney(debito)],
                    ["ITBIS neto", formatMoney(itbisNeto)],
                  ],
                })
              }
            >
              Imprimir
            </Button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-40">
          <Input label="Desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </div>
        <div className="w-40">
          <Input label="Hasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </div>
        <div className="w-44">
          <Select label="Tipo" value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)}>
            <option value="">Todas</option>
            <option value="CREDITO">Notas de credito (B04)</option>
            <option value="DEBITO">Notas de debito (B03)</option>
          </Select>
        </div>
        <div className="min-w-[14rem] flex-1">
          <Input label="Buscar" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="NCF, factura, cliente, RNC o motivo" />
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label={`Notas de credito (${visibles.filter((n) => n.tipo === "CREDITO").length})`} value={formatMoney(credito)} tone="amber" />
        <StatCard label={`Notas de debito (${visibles.filter((n) => n.tipo === "DEBITO").length})`} value={formatMoney(debito)} />
        <StatCard label="ITBIS neto de las notas" value={formatMoney(itbisNeto)} />
      </div>

      <Card className="p-0">
        <Table columns={["Fecha", "Tipo", "NCF nota", "Factura", "Cliente", "Motivo", "Monto", "ITBIS", "Total"]}>
          {visibles.length === 0 && <EmptyRow colSpan={9} label="No hay notas en estas fechas" />}
          {visibles.map((n) => (
            <tr key={n.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navegar(`/facturas/${n.factura_id}`)}>
              <td className="px-4 py-2">{formatDate(n.fecha)}</td>
              <td className="px-4 py-2">
                {n.tipo === "CREDITO" ? <Badge tone="amber">{n.anulacion ? "Credito · anulacion" : "Credito"}</Badge> : <Badge tone="blue">Debito</Badge>}
              </td>
              <td className="px-4 py-2 font-mono text-xs">{n.ncf}</td>
              <td className="px-4 py-2 font-mono text-xs text-brand-600">{n.factura_ncf ?? n.factura_numero}</td>
              <td className="px-4 py-2">
                {n.cliente_nombre}
                {n.rnc_cedula && <span className="block text-xs text-slate-400">{n.rnc_cedula}</span>}
              </td>
              <td className="px-4 py-2 text-slate-600">{n.motivo}</td>
              <td className="px-4 py-2 text-right">{formatMoney(n.monto)}</td>
              <td className="px-4 py-2 text-right">{formatMoney(n.itbis)}</td>
              <td className="px-4 py-2 text-right font-medium">
                {n.tipo === "CREDITO" ? "-" : "+"}
                {formatMoney(n.total)}
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
