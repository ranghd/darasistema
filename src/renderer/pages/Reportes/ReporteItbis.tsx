import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { formatDate, formatMoney } from "../../lib/format";
import { Card, EmptyRow, PageHeader, StatCard, Table } from "../../components/ui";

interface Resumen {
  cantidad_facturas: number;
  subtotal: number;
  itbis: number;
  total: number;
}

interface FacturaItbis {
  numero: number;
  ncf: string;
  fecha: string;
  cliente_nombre: string;
  subtotal: number;
  itbis: number;
  total: number;
}

export default function ReporteItbis() {
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [facturas, setFacturas] = useState<FacturaItbis[]>([]);

  useEffect(() => {
    api.reportes.itbis().then((r: any) => {
      setResumen(r.resumen);
      setFacturas(r.facturas);
    });
  }, []);

  return (
    <div>
      <PageHeader title="Reporte de ITBIS" subtitle="ITBIS facturado (18%) sobre ventas, util para la declaracion mensual" />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Facturas emitidas" value={String(resumen?.cantidad_facturas ?? 0)} />
        <StatCard label="Subtotal gravado" value={formatMoney(resumen?.subtotal)} />
        <StatCard label="ITBIS a pagar" value={formatMoney(resumen?.itbis)} tone="amber" />
      </div>

      <Card className="p-0">
        <Table columns={["NCF", "Fecha", "Cliente", "Subtotal", "ITBIS", "Total"]}>
          {facturas.length === 0 && <EmptyRow colSpan={6} />}
          {facturas.map((f) => (
            <tr key={f.ncf}>
              <td className="px-4 py-2 font-mono text-xs">{f.ncf}</td>
              <td className="px-4 py-2">{formatDate(f.fecha)}</td>
              <td className="px-4 py-2">{f.cliente_nombre}</td>
              <td className="px-4 py-2 text-right">{formatMoney(f.subtotal)}</td>
              <td className="px-4 py-2 text-right">{formatMoney(f.itbis)}</td>
              <td className="px-4 py-2 text-right">{formatMoney(f.total)}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
