import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import type { Factura } from "../../lib/types";
import { formatDate, formatMoney } from "../../lib/format";
import { Badge, Button, EmptyRow, PageHeader, Table } from "../../components/ui";

export default function ListaFacturas() {
  const [facturas, setFacturas] = useState<Factura[]>([]);

  useEffect(() => {
    api.facturas.listar().then(setFacturas as any);
  }, []);

  return (
    <div>
      <PageHeader
        title="Facturas"
        subtitle="Facturacion de ventas con NCF e ITBIS"
        actions={
          <Link to="/facturas/nueva">
            <Button>+ Nueva Factura</Button>
          </Link>
        }
      />

      <Table columns={["Num.", "NCF", "Fecha", "Cliente", "Condicion", "Total", "Estado", ""]}>
        {facturas.length === 0 && <EmptyRow colSpan={8} />}
        {facturas.map((f) => (
          <tr key={f.id} className="hover:bg-slate-50">
            <td className="px-4 py-2.5 text-slate-500">{f.numero}</td>
            <td className="px-4 py-2.5 font-mono text-xs">{f.ncf}</td>
            <td className="px-4 py-2.5">{formatDate(f.fecha)}</td>
            <td className="px-4 py-2.5 font-medium text-slate-800">{f.cliente_nombre}</td>
            <td className="px-4 py-2.5">{f.condicion_pago === "CONTADO" ? "Contado" : "Credito"}</td>
            <td className="px-4 py-2.5">{formatMoney(f.total)}</td>
            <td className="px-4 py-2.5">
              <Badge tone={f.estado === "PAGADA" ? "green" : f.estado === "ANULADA" ? "red" : "amber"}>{f.estado}</Badge>
            </td>
            <td className="px-4 py-2.5 text-right">
              <Link to={`/facturas/${f.id}`} className="text-xs font-medium text-brand-600 hover:underline">
                Ver detalle
              </Link>
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
