import { useEffect, useMemo, useState } from "react";
import { api, mensajeDeError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { formatDate, todayIso } from "../../lib/format";
import type { Cliente, MovimientoBotellaFiada, Producto, SaldoBotellaFiada } from "../../lib/types";
import { Badge, Button, Card, EmptyRow, Input, Modal, PageHeader, Select, Table } from "../../components/ui";

// Botellas fiadas: el cliente se lleva la botella sin dejar la suya ni pagar deposito, y queda debiendola.
// Aqui se anota lo que se fia y, cuando la trae, lo que devolvio.

type Formulario = { tipo: "FIADO" | "DEVOLUCION"; cliente: number | ""; producto: number | ""; cantidad: string; fecha: string; nota: string };

const nuevo = (tipo: Formulario["tipo"], cliente: number | "" = "", producto: number | "" = "", cantidad = ""): Formulario => ({ tipo, cliente, producto, cantidad, fecha: todayIso(), nota: "" });

export default function BotellasFiadas() {
  const { usuario } = useAuth();
  const [saldos, setSaldos] = useState<SaldoBotellaFiada[]>([]);
  const [movimientos, setMovimientos] = useState<MovimientoBotellaFiada[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [buscar, setBuscar] = useState("");
  const [verTodos, setVerTodos] = useState(false);
  const [form, setForm] = useState<Formulario | null>(null);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function cargar() {
    const [s, m] = await Promise.all([api.fiados.saldos(), api.fiados.movimientos(null)]);
    setSaldos(s);
    setMovimientos(m);
  }

  useEffect(() => {
    cargar();
    api.clientes.listar().then((c) => setClientes((c as Cliente[]).filter((x) => x.activo !== 0)));
    // las botellas son los productos que manejan envase (cilindros, botellones)
    api.productos.listar().then((p) => setProductos((p as Producto[]).filter((x) => x.activo && x.maneja_envase)));
  }, []);

  const q = buscar.trim().toLowerCase();
  const visibles = useMemo(
    () => saldos.filter((s) => (verTodos || s.pendientes > 0) && (!q || `${s.cliente_nombre} ${s.producto_nombre} ${s.cliente_telefono ?? ""}`.toLowerCase().includes(q))),
    [saldos, verTodos, q]
  );
  const totalPendientes = saldos.reduce((s, x) => s + Math.max(0, x.pendientes), 0);
  const clientesQueDeben = new Set(saldos.filter((x) => x.pendientes > 0).map((x) => x.cliente_id)).size;
  const debe = form && form.cliente && form.producto ? saldos.find((s) => s.cliente_id === form.cliente && s.producto_id === form.producto)?.pendientes ?? 0 : 0;

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setError("");
    if (!form.cliente) return setError("Elige el cliente");
    if (!form.producto) return setError("Elige la botella");
    setGuardando(true);
    try {
      const datos = { cliente_id: Number(form.cliente), producto_id: Number(form.producto), cantidad: Number(form.cantidad), fecha: form.fecha, nota: form.nota, creado_por: usuario?.nombre };
      if (form.tipo === "FIADO") await api.fiados.fiar(datos);
      else await api.fiados.devolver(datos);
      setForm(null);
      await cargar();
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setGuardando(false);
    }
  }

  const abrir = (f: Formulario) => {
    setError("");
    setForm(f);
  };

  return (
    <div>
      <PageHeader
        title="Botellas fiadas"
        subtitle="Las botellas que los clientes se llevaron sin dejar la suya y deben devolver"
        actions={
          <>
            <Button variant="secondary" onClick={() => abrir(nuevo("DEVOLUCION"))}>
              Registrar devolucion
            </Button>
            <Button onClick={() => abrir(nuevo("FIADO"))}>+ Fiar botellas</Button>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Botellas por devolver</p>
          <p className="mt-1 text-2xl font-semibold text-amber-600">{totalPendientes}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Clientes que deben botellas</p>
          <p className="mt-1 text-2xl font-semibold">{clientesQueDeben}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Devueltas en total</p>
          <p className="mt-1 text-2xl font-semibold text-emerald-600">{saldos.reduce((s, x) => s + x.devueltas, 0)}</p>
        </Card>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          className="w-72 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="Buscar cliente, telefono o botella..."
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={verTodos} onChange={(e) => setVerTodos(e.target.checked)} /> Ver tambien los que ya devolvieron todo
        </label>
      </div>

      <Table columns={["Cliente", "Botella", "Fiadas", "Devueltas", "Debe", "Ultimo movimiento", ""]}>
        {visibles.length === 0 && <EmptyRow colSpan={7} label={saldos.length ? "Nadie debe botellas" : "Todavia no se ha fiado ninguna botella"} />}
        {visibles.map((s) => (
          <tr key={`${s.cliente_id}-${s.producto_id}`}>
            <td className="px-4 py-2">
              <span className="font-medium text-slate-800">{s.cliente_nombre}</span>
              {s.cliente_telefono && <span className="block text-xs text-slate-400">{s.cliente_telefono}</span>}
            </td>
            <td className="px-4 py-2">{s.producto_nombre}</td>
            <td className="px-4 py-2 text-center">{s.fiadas}</td>
            <td className="px-4 py-2 text-center">{s.devueltas}</td>
            <td className="px-4 py-2 text-center">{s.pendientes > 0 ? <Badge tone="amber">{s.pendientes}</Badge> : <Badge tone="green">Al dia</Badge>}</td>
            <td className="px-4 py-2 text-slate-500">{formatDate(s.ultima_fecha)}</td>
            <td className="whitespace-nowrap px-4 py-2 text-right">
              {s.pendientes > 0 && (
                <Button size="sm" onClick={() => abrir(nuevo("DEVOLUCION", s.cliente_id, s.producto_id, String(s.pendientes)))}>
                  Devolvio
                </Button>
              )}
              <button className="ml-2 text-xs font-medium text-brand-600 hover:underline" onClick={() => abrir(nuevo("FIADO", s.cliente_id, s.producto_id))}>
                Fiar mas
              </button>
            </td>
          </tr>
        ))}
      </Table>

      <h2 className="mb-2 mt-6 text-sm font-semibold text-slate-700">Historial</h2>
      <Table columns={["Fecha", "Cliente", "Botella", "Movimiento", "Cantidad", "Nota", "Registrado por"]}>
        {movimientos.length === 0 && <EmptyRow colSpan={7} label="Sin movimientos" />}
        {movimientos
          .filter((m) => !q || `${m.cliente_nombre} ${m.producto_nombre}`.toLowerCase().includes(q))
          .map((m) => (
            <tr key={m.id}>
              <td className="px-4 py-2 text-slate-500">{formatDate(m.fecha)}</td>
              <td className="px-4 py-2">{m.cliente_nombre}</td>
              <td className="px-4 py-2">{m.producto_nombre}</td>
              <td className="px-4 py-2">{m.tipo === "FIADO" ? <Badge tone="amber">Fiada</Badge> : <Badge tone="green">Devuelta</Badge>}</td>
              <td className="px-4 py-2 text-center">{m.cantidad}</td>
              <td className="px-4 py-2 text-slate-500">{m.nota ?? ""}</td>
              <td className="px-4 py-2 text-slate-500">{m.creado_por ?? ""}</td>
            </tr>
          ))}
      </Table>

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.tipo === "FIADO" ? "Fiar botellas" : "Devolucion de botellas fiadas"}>
        {form && (
          <form onSubmit={guardar} className="space-y-3">
            <Select label="Cliente" value={form.cliente} onChange={(e) => setForm({ ...form, cliente: e.target.value ? Number(e.target.value) : "" })} autoFocus>
              <option value="">Elegir cliente...</option>
              {(form.tipo === "DEVOLUCION" ? clientes.filter((c) => saldos.some((s) => s.cliente_id === c.id && s.pendientes > 0)) : clientes).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                  {c.telefono ? ` · ${c.telefono}` : ""}
                </option>
              ))}
            </Select>
            <Select label="Botella" value={form.producto} onChange={(e) => setForm({ ...form, producto: e.target.value ? Number(e.target.value) : "" })}>
              <option value="">Elegir botella...</option>
              {productos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </Select>
            {form.cliente && form.producto ? (
              <p className={`rounded-lg px-3 py-2 text-sm ${debe > 0 ? "bg-amber-50 text-amber-800" : "bg-slate-50 text-slate-600"}`}>
                {debe > 0 ? `Este cliente debe ${debe} de esta botella.` : "Este cliente no debe ninguna de esta botella."}
              </p>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <Input
                label={form.tipo === "FIADO" ? "Cantidad que se fia" : "Cantidad que devolvio"}
                type="number"
                min={1}
                step="1"
                required
                value={form.cantidad}
                onChange={(e) => setForm({ ...form, cantidad: e.target.value })}
              />
              <Input label="Fecha" type="date" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} />
            </div>
            <Input label="Nota (opcional)" value={form.nota} onChange={(e) => setForm({ ...form, nota: e.target.value })} placeholder={form.tipo === "FIADO" ? "Ej. la devuelve el viernes" : "Ej. trajo 2, falta 1"} />
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setForm(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={guardando}>
                {guardando ? "Guardando..." : form.tipo === "FIADO" ? "Fiar" : "Registrar devolucion"}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
