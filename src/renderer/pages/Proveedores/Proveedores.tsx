import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import type { ProveedorConResumen } from "../../lib/types";
import { formatDate, formatMoney } from "../../lib/format";
import { Badge, Button, Card, EmptyRow, Input, PageHeader, Table } from "../../components/ui";
import { ProveedorFormModal } from "./componentes";

export default function Proveedores() {
  const navigate = useNavigate();
  const [proveedores, setProveedores] = useState<ProveedorConResumen[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [verInactivos, setVerInactivos] = useState(false);
  const [nuevo, setNuevo] = useState(false);

  async function cargar() {
    setProveedores(await api.proveedores.listar());
  }

  useEffect(() => {
    cargar();
  }, []);

  const texto = busqueda.trim().toLowerCase();
  const visibles = proveedores.filter(
    (p) =>
      (verInactivos || p.activo) &&
      (!texto || [p.nombre, p.telefono, p.rnc, p.contacto].some((v) => v?.toLowerCase().includes(texto)))
  );
  const totalComprado = proveedores.reduce((s, p) => s + p.total_comprado, 0);
  const porPagar = proveedores.reduce((s, p) => s + p.por_pagar, 0);

  return (
    <div>
      <PageHeader
        title="Proveedores"
        subtitle="Vendedores a los que les compras mercancia. Se seleccionan al registrar una compra."
        actions={<Button onClick={() => setNuevo(true)}>+ Nuevo proveedor</Button>}
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs uppercase text-slate-400">Proveedores activos</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{proveedores.filter((p) => p.activo).length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase text-slate-400">Total comprado</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{formatMoney(totalComprado)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase text-slate-400">Por pagar a proveedores</p>
          <p className={`mt-1 text-xl font-semibold ${porPagar ? "text-amber-600" : "text-slate-900"}`}>{formatMoney(porPagar)}</p>
        </Card>
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="w-80">
          <Input label="Buscar" placeholder="Nombre, telefono, RNC o contacto" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm text-slate-600">
          <input type="checkbox" checked={verInactivos} onChange={(e) => setVerInactivos(e.target.checked)} />
          Mostrar inactivos
        </label>
      </div>

      <Table columns={["Proveedor", "Telefono", "Contacto", "Productos", "Compras", "Total comprado", "Por pagar", "Ultima compra", "Estado"]}>
        {visibles.length === 0 && <EmptyRow colSpan={9} label={proveedores.length ? "Ningun proveedor coincide" : "Todavia no hay proveedores. Crea uno o registralo al hacer una compra."} />}
        {visibles.map((p) => (
          <tr key={p.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/proveedores/${p.id}`)}>
            <td className="px-4 py-2.5">
              <p className="font-medium text-slate-800">{p.nombre}</p>
              {p.rnc && <p className="text-xs text-slate-400">RNC {p.rnc}</p>}
            </td>
            <td className="px-4 py-2.5 text-slate-600">{p.telefono || "-"}</td>
            <td className="px-4 py-2.5 text-slate-600">{p.contacto || "-"}</td>
            <td className="px-4 py-2.5">{p.productos}</td>
            <td className="px-4 py-2.5">{p.compras}</td>
            <td className="px-4 py-2.5 font-medium">{formatMoney(p.total_comprado)}</td>
            <td className={`px-4 py-2.5 ${p.por_pagar ? "font-medium text-amber-600" : "text-slate-400"}`}>{formatMoney(p.por_pagar)}</td>
            <td className="px-4 py-2.5 text-slate-600">{p.ultima_compra ? formatDate(p.ultima_compra) : "-"}</td>
            <td className="px-4 py-2.5">
              <Badge tone={p.activo ? "green" : "slate"}>{p.activo ? "Activo" : "Inactivo"}</Badge>
            </td>
          </tr>
        ))}
      </Table>

      <ProveedorFormModal open={nuevo} onClose={() => setNuevo(false)} onGuardado={(p) => navigate(`/proveedores/${p.id}`)} />
    </div>
  );
}
