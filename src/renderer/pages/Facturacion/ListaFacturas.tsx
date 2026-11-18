import { sinImpuestos } from "../../lib/variant";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import type { Factura } from "../../lib/types";
import { formatDate, formatMoney } from "../../lib/format";
import { Badge, Button, EmptyRow, PageHeader, Table } from "../../components/ui";

export default function ListaFacturas() {
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const { usuario } = useAuth();

  // Facturas electronicas que no quedaron emitidas (solo lo ve el administrador; en otras empresas viene vacio).
  const [sinEmitir, setSinEmitir] = useState<{ factura_id: number; factura_numero: number; estado: string }[]>([]);

  useEffect(() => {
    api.facturas.listar().then(setFacturas as any);
    // solo el administrador puede pedirlo (a la caja la nube le diria que no y saldria como error de conexion)
    if (usuario?.rol === "ADMIN") api.ecf.pendientes().then((p) => setSinEmitir(p as any)).catch(() => {});
  }, [usuario?.rol]);

  return (
    <div>
      <PageHeader
        title="Facturas"
        subtitle={sinImpuestos ? "Ventas hechas en la caja" : "Facturacion de ventas con NCF e ITBIS"}
        actions={
          !sinImpuestos && (
            <Link to="/facturas/nueva">
              <Button>+ Nueva Factura</Button>
            </Link>
          )
        }
      />

      {sinEmitir.length > 0 && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          <b>
            {sinEmitir.length} factura{sinEmitir.length === 1 ? "" : "s"} sin comprobante electrónico.
          </b>{" "}
          Entra a cada una para resolverla:{" "}
          {sinEmitir.slice(0, 8).map((x, i) => (
            <span key={x.factura_id}>
              {i > 0 && ", "}
              <Link className="underline" to={`/facturas/${x.factura_id}`}>
                #{x.factura_numero}
              </Link>
            </span>
          ))}
          {sinEmitir.length > 8 && "…"}
        </div>
      )}

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
