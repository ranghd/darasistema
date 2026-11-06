import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { descargarCsv } from "../../lib/exportar";
import { formatDate, formatMoney, todayIso } from "../../lib/format";
import type { PrecioCambiado } from "../../lib/types";
import { Button, Card, EmptyRow, Input, PageHeader, StatCard, Table } from "../../components/ui";

// Dara Frituras: lo que la caja vendio a un precio distinto al normal, cuanto se dejo de cobrar y quien lo vendio.

const r2 = (n: number) => Math.round(n * 100) / 100;

export default function PreciosCambiados() {
  const navegar = useNavigate();
  const [desde, setDesde] = useState(todayIso().slice(0, 7) + "-01");
  const [hasta, setHasta] = useState(todayIso());
  const [buscar, setBuscar] = useState("");
  const [filas, setFilas] = useState<PrecioCambiado[]>([]);

  useEffect(() => {
    api.reportes.preciosCambiados(desde, hasta).then(setFilas);
  }, [desde, hasta]);

  const visibles = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return filas.filter((f) => !q || `${f.producto_nombre} ${f.creado_por ?? ""} ${f.ncf ?? ""}`.toLowerCase().includes(q));
  }, [filas, buscar]);

  const rebaja = r2(visibles.reduce((s, f) => s + Math.max(0, f.diferencia), 0));
  const encima = r2(visibles.reduce((s, f) => s + Math.max(0, -f.diferencia), 0));

  function exportar() {
    descargarCsv(
      `precios-cambiados-${desde}-a-${hasta}.csv`,
      ["Fecha", "Factura", "Producto", "Cantidad", "Precio normal", "Vendido a", "Diferencia", "Vendido por"],
      visibles.map((f) => [formatDate(f.fecha), f.ncf ?? String(f.numero), f.producto_nombre, f.cantidad, f.precio_normal.toFixed(2), f.precio_vendido.toFixed(2), f.diferencia.toFixed(2), f.creado_por ?? ""])
    );
  }

  return (
    <div>
      <PageHeader
        title="Precios cambiados"
        subtitle="Lo que la caja vendio a un precio distinto al normal y quien lo vendio"
        actions={
          <Button variant="secondary" size="sm" onClick={exportar} disabled={!visibles.length}>
            Excel
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-40">
          <Input label="Desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </div>
        <div className="w-40">
          <Input label="Hasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </div>
        <div className="min-w-[14rem] flex-1">
          <Input label="Buscar" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Producto, usuario o factura" />
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Veces que se cambio el precio" value={String(visibles.length)} />
        <StatCard label="Se dejo de cobrar" value={formatMoney(rebaja)} tone="amber" />
        <StatCard label="Se cobro de mas" value={formatMoney(encima)} />
      </div>

      <Card className="p-0">
        <Table columns={["Fecha", "Factura", "Producto", "Cant.", "Precio normal", "Vendido a", "Diferencia", "Vendido por"]}>
          {visibles.length === 0 && <EmptyRow colSpan={8} label="No se cambio ningun precio en estas fechas" />}
          {visibles.map((f) => (
            <tr key={f.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navegar(`/facturas/${f.factura_id}`)}>
              <td className="px-4 py-2">{formatDate(f.fecha)}</td>
              <td className="px-4 py-2 font-mono text-xs text-brand-600">{f.ncf ?? f.numero}</td>
              <td className="px-4 py-2">{f.producto_nombre}</td>
              <td className="px-4 py-2 text-right">{f.cantidad}</td>
              <td className="px-4 py-2 text-right">{formatMoney(f.precio_normal)}</td>
              <td className="px-4 py-2 text-right font-medium">{formatMoney(f.precio_vendido)}</td>
              <td className={`px-4 py-2 text-right font-medium ${f.diferencia > 0 ? "text-amber-700" : "text-emerald-700"}`}>
                {f.diferencia > 0 ? "-" : "+"}
                {formatMoney(Math.abs(f.diferencia))}
              </td>
              <td className="px-4 py-2 text-slate-600">{f.creado_por}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
