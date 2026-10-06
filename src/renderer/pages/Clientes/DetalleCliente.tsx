import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../lib/api";
import type { Cliente, Factura } from "../../lib/types";
import { formatDate, formatMoney } from "../../lib/format";
import { Badge, Card, EmptyRow, PageHeader, Table } from "../../components/ui";

interface EnvaseSaldo {
  producto_id: number;
  producto_nombre: string;
  cantidad: number;
  fianza_total: number;
}

export default function DetalleCliente() {
  const { id } = useParams();
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [envases, setEnvases] = useState<EnvaseSaldo[]>([]);

  useEffect(() => {
    if (!id) return;
    const clienteId = Number(id);
    api.clientes.obtener(clienteId).then(setCliente as any);
    api.clientes.estadoCuenta(clienteId).then((r: any) => {
      setFacturas(r.facturas);
      setEnvases(r.envases);
    });
  }, [id]);

  if (!cliente) return <p className="text-sm text-slate-400">Cargando...</p>;

  const totalFacturado = facturas.reduce((s, f) => s + f.total, 0);
  const totalPendiente = facturas.filter((f) => f.estado === "PENDIENTE").reduce((s, f) => s + (f.total - (f.cobrado ?? 0)), 0);

  return (
    <div>
      <PageHeader title={cliente.nombre} subtitle={`Codigo ${cliente.codigo} · ${cliente.tipo === "JURIDICA" ? "Persona Juridica" : "Persona Fisica"} · ${cliente.rnc_cedula ?? "sin RNC/cedula"}`} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs uppercase text-slate-400">Total facturado historico</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{formatMoney(totalFacturado)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase text-slate-400">Saldo pendiente</p>
          <p className="mt-1 text-xl font-semibold text-amber-600">{formatMoney(totalPendiente)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase text-slate-400">Contacto</p>
          <p className="mt-1 text-sm text-slate-700">{cliente.telefono || "-"}</p>
          <p className="text-sm text-slate-500">{cliente.direccion || "-"}</p>
        </Card>
      </div>

      <h2 className="mb-2 mt-7 text-sm font-semibold text-slate-700">Envases en poder del cliente</h2>
      <Table columns={["Producto", "Cantidad", "Fianza retenida"]}>
        {envases.length === 0 && <EmptyRow colSpan={3} label="No tiene envases pendientes de devolver" />}
        {envases.map((e) => (
          <tr key={e.producto_id}>
            <td className="px-4 py-2.5">{e.producto_nombre}</td>
            <td className="px-4 py-2.5">{e.cantidad}</td>
            <td className="px-4 py-2.5">{formatMoney(e.fianza_total)}</td>
          </tr>
        ))}
      </Table>

      <h2 className="mb-2 mt-7 text-sm font-semibold text-slate-700">Historial de facturas</h2>
      <Table columns={["NCF", "Fecha", "Condicion", "Total", "Estado", ""]}>
        {facturas.length === 0 && <EmptyRow colSpan={6} />}
        {facturas.map((f) => (
          <tr key={f.id} className="hover:bg-slate-50">
            <td className="px-4 py-2.5 font-mono text-xs">{f.ncf}</td>
            <td className="px-4 py-2.5">{formatDate(f.fecha)}</td>
            <td className="px-4 py-2.5">{f.condicion_pago === "CONTADO" ? "Contado" : "Credito"}</td>
            <td className="px-4 py-2.5">{formatMoney(f.total)}</td>
            <td className="px-4 py-2.5">
              <Badge tone={f.estado === "PAGADA" ? "green" : f.estado === "ANULADA" ? "red" : "amber"}>{f.estado}</Badge>
            </td>
            <td className="px-4 py-2.5 text-right">
              <Link to={`/facturas/${f.id}`} className="text-xs font-medium text-brand-600 hover:underline">
                Ver
              </Link>
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
