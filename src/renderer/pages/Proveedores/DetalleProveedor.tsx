import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, mensajeDeError } from "../../lib/api";
import type { Compra, PrecioHistorico, Producto, Proveedor, RelacionProductoProveedor } from "../../lib/types";
import { formatDate, formatMoney } from "../../lib/format";
import { Badge, Button, Card, EmptyRow, Input, Modal, PageHeader, Select, Table } from "../../components/ui";
import { ProveedorFormModal, TablaHistorialPrecios, resumenCompras } from "./componentes";

type Pestana = "PRODUCTOS" | "COMPRAS";

export default function DetalleProveedor() {
  const { id } = useParams();
  const proveedorId = Number(id);
  const navigate = useNavigate();

  const [proveedor, setProveedor] = useState<Proveedor | null>(null);
  const [productos, setProductos] = useState<RelacionProductoProveedor[]>([]);
  const [historial, setHistorial] = useState<PrecioHistorico[]>([]);
  const [compras, setCompras] = useState<Compra[]>([]);
  const [catalogo, setCatalogo] = useState<Producto[]>([]);
  const [pestana, setPestana] = useState<Pestana>("PRODUCTOS");
  const [editar, setEditar] = useState(false);
  const [historialDe, setHistorialDe] = useState<RelacionProductoProveedor | null>(null);
  const [asociar, setAsociar] = useState(false);
  const [formAsociar, setFormAsociar] = useState({ producto_id: 0, codigo_proveedor: "", precio_referencia: "" });
  const [error, setError] = useState("");

  async function cargar() {
    const [p, prods, h, c, cat] = await Promise.all([
      api.proveedores.obtener(proveedorId),
      api.proveedores.productos(proveedorId),
      api.proveedores.historialPrecios({ proveedor_id: proveedorId }),
      api.compras.listar(proveedorId),
      api.productos.listar(),
    ]);
    setProveedor(p ?? null);
    setProductos(prods);
    setHistorial(h);
    setCompras(c);
    setCatalogo(cat.filter((x) => x.activo));
  }

  useEffect(() => {
    if (proveedorId) cargar();
  }, [proveedorId]);

  const lineasPorCompra = useMemo(() => {
    const m = new Map<number, PrecioHistorico[]>();
    for (const h of historial) m.set(h.compra_id, [...(m.get(h.compra_id) ?? []), h]);
    return m;
  }, [historial]);

  async function cambiarEstado() {
    if (!proveedor) return;
    setProveedor(await api.proveedores.actualizar(proveedor.id, { activo: proveedor.activo ? 0 : 1 }));
  }

  async function guardarAsociacion(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api.proveedores.vincular({
        producto_id: formAsociar.producto_id,
        proveedor_id: proveedorId,
        codigo_proveedor: formAsociar.codigo_proveedor,
        precio_referencia: formAsociar.precio_referencia === "" ? null : Number(formAsociar.precio_referencia),
      });
      setAsociar(false);
      await cargar();
    } catch (err) {
      setError(mensajeDeError(err));
    }
  }

  if (!proveedor) return <p className="text-sm text-slate-400">Cargando...</p>;

  const totalComprado = compras.reduce((s, c) => s + c.total, 0);
  const porPagar = compras.filter((c) => c.estado === "PENDIENTE").reduce((s, c) => s + c.total - (c.pagado ?? 0), 0);

  return (
    <div>
      <PageHeader
        title={proveedor.nombre}
        subtitle={[proveedor.rnc ? `RNC ${proveedor.rnc}` : null, proveedor.telefono, proveedor.contacto ? `Contacto: ${proveedor.contacto}` : null].filter(Boolean).join(" · ") || "Proveedor"}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setEditar(true)}>
              Editar
            </Button>
            <Button variant="secondary" onClick={cambiarEstado}>
              {proveedor.activo ? "Desactivar" : "Activar"}
            </Button>
            <Button variant="secondary" onClick={() => navigate("/proveedores")}>
              Volver
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs uppercase text-slate-400">Estado</p>
          <p className="mt-2">
            <Badge tone={proveedor.activo ? "green" : "slate"}>{proveedor.activo ? "Activo" : "Inactivo"}</Badge>
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase text-slate-400">Total comprado</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{formatMoney(totalComprado)}</p>
          <p className="text-xs text-slate-400">{compras.length} compra(s)</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase text-slate-400">Por pagar</p>
          <p className={`mt-1 text-xl font-semibold ${porPagar ? "text-amber-600" : "text-slate-900"}`}>{formatMoney(porPagar)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase text-slate-400">Ultima compra</p>
          <p className="mt-1 text-sm font-medium text-slate-800">{compras[0] ? formatDate(compras[0].fecha) : "-"}</p>
        </Card>
      </div>
      {(proveedor.direccion || proveedor.notas) && (
        <p className="mt-2 text-xs text-slate-500">
          {proveedor.direccion}
          {proveedor.direccion && proveedor.notas ? " · " : ""}
          {proveedor.notas && <span className="italic">{proveedor.notas}</span>}
        </p>
      )}

      <div className="mb-4 mt-6 flex gap-1 border-b border-slate-200">
        {(
          [
            ["PRODUCTOS", `Productos que le compro (${productos.length})`],
            ["COMPRAS", `Historial de compras (${compras.length})`],
          ] as [Pestana, string][]
        ).map(([valor, etiqueta]) => (
          <button
            key={valor}
            type="button"
            onClick={() => setPestana(valor)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm ${pestana === valor ? "border-brand-600 font-semibold text-brand-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}
          >
            {etiqueta}
          </button>
        ))}
      </div>

      {pestana === "PRODUCTOS" && (
        <div>
          <div className="mb-3 flex justify-end">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setFormAsociar({ producto_id: catalogo[0]?.id ?? 0, codigo_proveedor: "", precio_referencia: "" });
                setError("");
                setAsociar(true);
              }}
            >
              + Asociar producto
            </Button>
          </div>
          <Table columns={["Producto", "Codigo del proveedor", "Ultimo precio", "Ultima compra", "Compras", "Costo promedio", ""]}>
            {productos.length === 0 && <EmptyRow colSpan={7} label="Todavia no le has comprado productos a este proveedor" />}
            {productos.map((r) => (
              <tr key={r.producto_id} className="hover:bg-slate-50">
                <td className="px-4 py-2.5">
                  <p className="font-medium text-slate-800">{r.producto_nombre}</p>
                  <p className="font-mono text-[11px] text-slate-400">{r.producto_codigo}</p>
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{r.codigo_proveedor || "-"}</td>
                <td className="px-4 py-2.5 font-semibold">
                  {r.ultimo_precio !== null ? formatMoney(r.ultimo_precio) : r.precio_referencia !== null ? <span className="font-normal text-slate-500">{formatMoney(r.precio_referencia)} (cotizado)</span> : "-"}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{r.ultima_fecha ? formatDate(r.ultima_fecha) : "-"}</td>
                <td className="px-4 py-2.5 text-xs text-slate-500">{resumenCompras(r)}</td>
                <td className="px-4 py-2.5 text-xs text-slate-500">{formatMoney(r.costo_promedio)}</td>
                <td className="px-4 py-2.5 text-right">
                  <button type="button" className="whitespace-nowrap text-xs font-medium text-brand-600 hover:underline" onClick={() => setHistorialDe(r)}>
                    Historial de precios
                  </button>
                </td>
              </tr>
            ))}
          </Table>
        </div>
      )}

      {pestana === "COMPRAS" && (
        <Table columns={["Num.", "Fecha", "Productos", "Condicion", "Total", "Estado"]}>
          {compras.length === 0 && <EmptyRow colSpan={6} label="Sin compras registradas" />}
          {compras.map((c) => (
            <tr key={c.id} className="align-top hover:bg-slate-50">
              <td className="px-4 py-2.5 text-slate-500">#{c.numero}</td>
              <td className="whitespace-nowrap px-4 py-2.5">{formatDate(c.fecha)}</td>
              <td className="px-4 py-2.5 text-xs text-slate-600">
                {(lineasPorCompra.get(c.id) ?? []).map((l, i) => (
                  <p key={i}>
                    <span className="font-medium text-slate-800">{l.cantidad} ×</span> {l.producto_nombre} <span className="text-slate-400">@ {formatMoney(l.costo_unitario)}</span>
                  </p>
                ))}
              </td>
              <td className="px-4 py-2.5">{c.condicion_pago === "CONTADO" ? "Contado" : "Credito"}</td>
              <td className="px-4 py-2.5 font-medium">{formatMoney(c.total)}</td>
              <td className="px-4 py-2.5">
                <Badge tone={c.estado === "PAGADA" ? "green" : "amber"}>{c.estado}</Badge>
                {c.estado === "PENDIENTE" && <p className="mt-1 text-xs text-amber-600">Debe {formatMoney(c.total - (c.pagado ?? 0))}</p>}
              </td>
            </tr>
          ))}
        </Table>
      )}

      <Modal open={!!historialDe} onClose={() => setHistorialDe(null)} title={historialDe ? `${historialDe.producto_nombre} · ${proveedor.nombre}` : ""} width="max-w-3xl">
        {historialDe && <TablaHistorialPrecios filas={historial.filter((h) => h.producto_id === historialDe.producto_id)} mostrarProducto={false} mostrarProveedor={false} />}
      </Modal>

      <Modal open={asociar} onClose={() => setAsociar(false)} title={`Asociar producto a ${proveedor.nombre}`}>
        <form onSubmit={guardarAsociacion} className="space-y-3">
          <Select label="Producto" value={formAsociar.producto_id} onChange={(e) => setFormAsociar({ ...formAsociar, producto_id: Number(e.target.value) })}>
            {catalogo.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </Select>
          <Input label="Codigo / SKU que usa el proveedor (opcional)" value={formAsociar.codigo_proveedor} onChange={(e) => setFormAsociar({ ...formAsociar, codigo_proveedor: e.target.value })} />
          <Input label="Precio cotizado (opcional)" type="number" step="0.01" value={formAsociar.precio_referencia} onChange={(e) => setFormAsociar({ ...formAsociar, precio_referencia: e.target.value })} />
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setAsociar(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!formAsociar.producto_id}>
              Guardar
            </Button>
          </div>
        </form>
      </Modal>

      <ProveedorFormModal open={editar} onClose={() => setEditar(false)} inicial={proveedor} onGuardado={setProveedor} />
    </div>
  );
}
