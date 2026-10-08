import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, mensajeDeError } from "../../lib/api";
import type { PrecioHistorico, Producto, Proveedor, RelacionProductoProveedor } from "../../lib/types";
import { formatDate, formatMoney } from "../../lib/format";
import { Badge, Button, EmptyRow, Input, Modal, Select, Table } from "../../components/ui";

const FORM_VACIO = { nombre: "", telefono: "", direccion: "", rnc: "", contacto: "", notas: "", activo: 1 };

// Crear o editar un proveedor. Se usa en la lista de proveedores y desde "Nueva Compra".
export function ProveedorFormModal({
  open,
  onClose,
  inicial,
  onGuardado,
}: {
  open: boolean;
  onClose: () => void;
  inicial?: Proveedor | null;
  onGuardado: (p: Proveedor) => void;
}) {
  const [form, setForm] = useState(FORM_VACIO);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError("");
    setForm(
      inicial
        ? {
            nombre: inicial.nombre,
            telefono: inicial.telefono ?? "",
            direccion: inicial.direccion ?? "",
            rnc: inicial.rnc ?? "",
            contacto: inicial.contacto ?? "",
            notas: inicial.notas ?? "",
            activo: inicial.activo,
          }
        : FORM_VACIO
    );
  }, [open, inicial]);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError("");
    try {
      const p = inicial ? await api.proveedores.actualizar(inicial.id, form) : await api.proveedores.crear(form);
      onGuardado(p);
      onClose();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar el proveedor"));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={inicial ? "Editar proveedor" : "Nuevo proveedor"}>
      <form onSubmit={guardar} className="space-y-3">
        <Input label="Nombre del vendedor o empresa" required autoFocus value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Telefono" value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} />
          <Input label="RNC (opcional)" value={form.rnc} onChange={(e) => setForm({ ...form, rnc: e.target.value })} />
        </div>
        <Input label="Persona de contacto (opcional)" value={form.contacto} onChange={(e) => setForm({ ...form, contacto: e.target.value })} />
        <Input label="Direccion (opcional)" value={form.direccion} onChange={(e) => setForm({ ...form, direccion: e.target.value })} />
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Notas</span>
          <textarea
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            rows={2}
            value={form.notas}
            onChange={(e) => setForm({ ...form, notas: e.target.value })}
            placeholder="Ej. entrega los martes, pedir con 2 dias"
          />
        </label>
        <Select label="Estado" value={form.activo} onChange={(e) => setForm({ ...form, activo: Number(e.target.value) })}>
          <option value={1}>Activo</option>
          <option value={0}>Inactivo (no aparece al registrar compras)</option>
        </Select>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={guardando}>
            {guardando ? "Guardando..." : "Guardar"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// Lineas de compra = historial de precios (nunca se sobrescribe).
// "4 unid. en 2 compras · RD$250 – RD$270"
export function resumenCompras(r: RelacionProductoProveedor): string {
  if (!r.veces) return "Sin compras todavia";
  const rango = r.precio_min !== null && r.precio_max !== null && r.precio_min !== r.precio_max ? ` · ${formatMoney(r.precio_min)} – ${formatMoney(r.precio_max)}` : "";
  return `${r.cantidad_total} unid. en ${r.veces} compra${r.veces === 1 ? "" : "s"}${rango}`;
}

export function TablaHistorialPrecios({ filas, mostrarProveedor = true, mostrarProducto = true }: { filas: PrecioHistorico[]; mostrarProveedor?: boolean; mostrarProducto?: boolean }) {
  const columnas = ["Fecha", "Compra", ...(mostrarProducto ? ["Producto"] : []), ...(mostrarProveedor ? ["Proveedor"] : []), "Cantidad", "Precio pagado", "Subtotal"];
  return (
    <Table columns={columnas}>
      {filas.length === 0 && <EmptyRow colSpan={columnas.length} label="Todavia no hay compras registradas" />}
      {filas.map((h, i) => {
        const anterior = filas.slice(i + 1).find((x) => x.producto_id === h.producto_id && x.proveedor_id === h.proveedor_id);
        const cambio = anterior ? h.costo_unitario - anterior.costo_unitario : 0;
        return (
          <tr key={`${h.compra_id}-${h.producto_id}-${i}`}>
            <td className="whitespace-nowrap px-4 py-2 text-slate-600">{formatDate(h.fecha)}</td>
            <td className="px-4 py-2 text-xs text-slate-500">#{h.compra_numero}</td>
            {mostrarProducto && <td className="px-4 py-2 font-medium text-slate-800">{h.producto_nombre}</td>}
            {mostrarProveedor && (
              <td className="px-4 py-2">
                {h.proveedor_id ? (
                  <Link to={`/proveedores/${h.proveedor_id}`} className="text-brand-700 hover:underline">
                    {h.proveedor_nombre}
                  </Link>
                ) : (
                  h.proveedor_nombre
                )}
              </td>
            )}
            <td className="px-4 py-2">{h.cantidad}</td>
            <td className="whitespace-nowrap px-4 py-2 font-medium">
              {formatMoney(h.costo_unitario)}
              {cambio !== 0 && (
                <span className={`ml-2 text-xs ${cambio > 0 ? "text-red-600" : "text-emerald-600"}`}>
                  {cambio > 0 ? "▲" : "▼"} {formatMoney(Math.abs(cambio))}
                </span>
              )}
            </td>
            <td className="px-4 py-2">{formatMoney(h.subtotal)}</td>
          </tr>
        );
      })}
    </Table>
  );
}

// Seccion "Proveedores" de un producto: quienes lo venden, ultimo precio y su historial.
export function ProveedoresDeProductoModal({ producto, onClose }: { producto: Producto | null; onClose: () => void }) {
  const [relaciones, setRelaciones] = useState<RelacionProductoProveedor[]>([]);
  const [historial, setHistorial] = useState<PrecioHistorico[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [verProveedor, setVerProveedor] = useState<number | "TODOS">("TODOS");
  const [asociar, setAsociar] = useState(false);
  const [formAsociar, setFormAsociar] = useState({ proveedor_id: 0, codigo_proveedor: "", precio_referencia: "" });
  const [nuevoProveedor, setNuevoProveedor] = useState(false);
  const [error, setError] = useState("");

  async function cargar(p: Producto) {
    const [r, h, provs] = await Promise.all([
      api.proveedores.deProducto(p.id),
      api.proveedores.historialPrecios({ producto_id: p.id }),
      api.proveedores.listar(),
    ]);
    setRelaciones(r);
    setHistorial(h);
    setProveedores(provs.filter((x) => x.activo));
  }

  useEffect(() => {
    if (!producto) return;
    setVerProveedor("TODOS");
    setAsociar(false);
    setError("");
    cargar(producto);
  }, [producto]);

  async function guardarAsociacion(e: React.FormEvent) {
    e.preventDefault();
    if (!producto || !formAsociar.proveedor_id) return;
    setError("");
    try {
      await api.proveedores.vincular({
        producto_id: producto.id,
        proveedor_id: formAsociar.proveedor_id,
        codigo_proveedor: formAsociar.codigo_proveedor,
        precio_referencia: formAsociar.precio_referencia === "" ? null : Number(formAsociar.precio_referencia),
      });
      setAsociar(false);
      await cargar(producto);
    } catch (err) {
      setError(mensajeDeError(err));
    }
  }

  function editarAsociacion(r: RelacionProductoProveedor) {
    setFormAsociar({ proveedor_id: r.proveedor_id, codigo_proveedor: r.codigo_proveedor ?? "", precio_referencia: r.precio_referencia === null ? "" : String(r.precio_referencia) });
    setAsociar(true);
  }

  async function quitar(r: RelacionProductoProveedor) {
    if (!producto) return;
    setError("");
    try {
      await api.proveedores.desvincular(producto.id, r.proveedor_id);
      await cargar(producto);
    } catch (err) {
      setError(mensajeDeError(err));
    }
  }

  const historialVisible = verProveedor === "TODOS" ? historial : historial.filter((h) => h.proveedor_id === verProveedor);
  const mejor = relaciones.filter((r) => r.ultimo_precio !== null && r.proveedor_activo).sort((a, b) => (a.ultimo_precio ?? 0) - (b.ultimo_precio ?? 0))[0];

  return (
    <Modal open={!!producto} onClose={onClose} title={producto ? `Proveedores · ${producto.nombre}` : ""} width="max-w-5xl">
      {producto && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600">
            <span>
              Costo promedio actual: <b className="text-slate-900">{formatMoney(producto.costo_contenido)}</b>
            </span>
            {mejor && (
              <span>
                Ultimo precio mas bajo: <b className="text-emerald-700">{formatMoney(mejor.ultimo_precio)}</b> con {mejor.proveedor_nombre}
              </span>
            )}
            <Button
              size="sm"
              variant="secondary"
              className="ml-auto"
              onClick={() => {
                setFormAsociar({ proveedor_id: proveedores[0]?.id ?? 0, codigo_proveedor: "", precio_referencia: "" });
                setAsociar(true);
              }}
            >
              + Asociar proveedor
            </Button>
          </div>

          {asociar && (
            <form onSubmit={guardarAsociacion} className="grid grid-cols-1 items-end gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-4">
              <div className="sm:col-span-2">
                <Select label="Proveedor" value={formAsociar.proveedor_id} onChange={(e) => setFormAsociar({ ...formAsociar, proveedor_id: Number(e.target.value) })}>
                  {proveedores.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                    </option>
                  ))}
                </Select>
                <button type="button" className="mt-1 text-xs text-brand-600 hover:underline" onClick={() => setNuevoProveedor(true)}>
                  + Crear proveedor nuevo
                </button>
              </div>
              <Input label="Codigo / SKU del proveedor" value={formAsociar.codigo_proveedor} onChange={(e) => setFormAsociar({ ...formAsociar, codigo_proveedor: e.target.value })} />
              <Input
                label="Precio cotizado (opcional)"
                type="number"
                step="0.01"
                value={formAsociar.precio_referencia}
                onChange={(e) => setFormAsociar({ ...formAsociar, precio_referencia: e.target.value })}
              />
              <div className="flex gap-2 sm:col-span-4">
                <Button type="submit" size="sm" disabled={!formAsociar.proveedor_id}>
                  Guardar
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setAsociar(false)}>
                  Cancelar
                </Button>
              </div>
            </form>
          )}
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}

          <Table columns={["Proveedor", "Codigo del proveedor", "Ultimo precio", "Ultima compra", "Compras", ""]}>
            {relaciones.length === 0 && <EmptyRow colSpan={6} label="Ningun proveedor asociado todavia. Se asocian solos al registrar una compra." />}
            {relaciones.map((r) => (
              <tr key={r.proveedor_id} className={verProveedor === r.proveedor_id ? "bg-brand-50/60" : "hover:bg-slate-50"}>
                <td className="whitespace-nowrap px-4 py-2">
                  <Link to={`/proveedores/${r.proveedor_id}`} className="font-medium text-brand-700 hover:underline">
                    {r.proveedor_nombre}
                  </Link>
                  {!r.proveedor_activo && (
                    <span className="ml-2">
                      <Badge tone="slate">Inactivo</Badge>
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 font-mono text-xs text-slate-500">{r.codigo_proveedor || "-"}</td>
                <td className="px-4 py-2 font-semibold">
                  {r.ultimo_precio !== null ? formatMoney(r.ultimo_precio) : r.precio_referencia !== null ? <span className="font-normal text-slate-500">{formatMoney(r.precio_referencia)} (cotizado)</span> : "-"}
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-slate-600">{r.ultima_fecha ? formatDate(r.ultima_fecha) : "-"}</td>
                <td className="px-4 py-2 text-xs text-slate-500">{resumenCompras(r)}</td>
                <td className="whitespace-nowrap px-4 py-2 text-right text-xs">
                  <button type="button" className="mr-3 font-medium text-brand-600 hover:underline" onClick={() => setVerProveedor(verProveedor === r.proveedor_id ? "TODOS" : r.proveedor_id)}>
                    {verProveedor === r.proveedor_id ? "Ver todos" : "Historial"}
                  </button>
                  <button type="button" className="mr-3 text-slate-500 hover:underline" onClick={() => editarAsociacion(r)}>
                    Editar
                  </button>
                  {!r.veces && (
                    <button type="button" className="text-red-500 hover:underline" onClick={() => quitar(r)}>
                      Quitar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </Table>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-700">
              Historial de precios {verProveedor === "TODOS" ? "(todos los proveedores)" : `con ${relaciones.find((r) => r.proveedor_id === verProveedor)?.proveedor_nombre ?? ""}`}
            </h3>
            <TablaHistorialPrecios filas={historialVisible} mostrarProducto={false} />
          </div>
        </div>
      )}
      <ProveedorFormModal
        open={nuevoProveedor}
        onClose={() => setNuevoProveedor(false)}
        onGuardado={(p) => {
          setProveedores((prev) => [...prev, p].sort((a, b) => a.nombre.localeCompare(b.nombre)));
          setFormAsociar((f) => ({ ...f, proveedor_id: p.id }));
        }}
      />
    </Modal>
  );
}
