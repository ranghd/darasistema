import { useEffect, useMemo, useState } from "react";
import { api, mensajeDeError } from "../../lib/api";
import { sinAcentos } from "../Caja/buscar";
import { adminVentas } from "../../lib/variant";
import { useAuth } from "../../lib/auth";
import { formatDate, todayIso } from "../../lib/format";
import type { Cliente, MovimientoBotellaFiada, Producto, SaldoBotellaFiada } from "../../lib/types";
import { Badge, Button, Card, EmptyRow, Input, Modal, PageHeader, Select, Table } from "../../components/ui";

// Cilindros prestados: el negocio le presta el cilindro al cliente, que lo tiene que devolver (no es una deuda ni un credito).
// Aqui se anota lo que se presta y, cuando la trae, lo que devolvio. Por dentro se sigue llamando "fiados".

// Al prestar, el cliente se escribe por nombre: si no existe se registra solo (nombre y telefono) al guardar.
type Formulario = { tipo: "FIADO" | "DEVOLUCION"; cliente: number | ""; nombre: string; telefono: string; producto: number | ""; cantidad: string; fecha: string; nota: string };

const nuevo = (tipo: Formulario["tipo"], cliente: number | "" = "", producto: number | "" = "", cantidad = ""): Formulario => ({ tipo, cliente, nombre: "", telefono: "", producto, cantidad, fecha: todayIso(), nota: "" });

export default function BotellasFiadas() {
  const { usuario } = useAuth();
  const [saldos, setSaldos] = useState<SaldoBotellaFiada[]>([]);
  const [movimientos, setMovimientos] = useState<MovimientoBotellaFiada[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [buscar, setBuscar] = useState("");
  const [verTodos, setVerTodos] = useState(false);
  const [verHistorial, setVerHistorial] = useState(false);
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
    const consumidorFinal = clientes.find((c) => c.codigo === "CLI-0000");
    if (form.tipo === "FIADO" ? !form.nombre.trim() : !form.cliente) return setError(form.tipo === "FIADO" ? "Escribe el nombre del cliente" : "Elige el cliente");
    if (form.cliente && form.cliente === consumidorFinal?.id) return setError("A Consumidor Final no se le presta: escribe el nombre de la persona");
    if (!form.producto) return setError("Elige el cilindro");
    setGuardando(true);
    try {
      let clienteId = form.cliente;
      if (form.tipo === "FIADO" && !clienteId) {
        // persona nueva: se registra con su nombre (y telefono) para saber a quien reclamarle el cilindro
        const nuevoCliente = (await api.clientes.crear({ nombre: form.nombre.trim(), telefono: form.telefono.trim(), tipo: "FISICA" })) as Cliente;
        setClientes((cs) => [...cs, nuevoCliente]);
        clienteId = nuevoCliente.id;
      }
      const datos = { cliente_id: Number(clienteId), producto_id: Number(form.producto), cantidad: Number(form.cantidad), fecha: form.fecha, nota: form.nota, creado_por: usuario?.nombre };
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
    setForm({ ...f, nombre: clientes.find((c) => c.id === f.cliente)?.nombre ?? "" });
  };

  // el nombre escrito se busca entre los clientes (sin importar mayusculas ni acentos)
  const igual = (a: string, b: string) => sinAcentos(a.trim()) === sinAcentos(b.trim());
  const escribirNombre = (nombre: string) => form && setForm({ ...form, nombre, cliente: clientes.find((c) => igual(c.nombre, nombre))?.id ?? "" });

  return (
    <div>
      <PageHeader
        title="Cilindros prestados"
        subtitle="Quien tiene cilindros nuestros y los tiene que devolver"
        actions={
          <Button className="py-2.5 text-base" onClick={() => abrir(nuevo("FIADO"))}>
            + Prestar cilindros
          </Button>
        }
      />

      {/* el reporte (cuantos hay por devolver y el historial) solo en el Admin; la caja solo presta y recibe */}
      {adminVentas && (
      <Card className="mb-5 flex items-center gap-5 p-5">
        <span className="text-5xl font-bold text-amber-600">{totalPendientes}</span>
        <span>
          <span className="block text-lg font-semibold text-slate-800">{totalPendientes === 1 ? "cilindro por devolver" : "cilindros por devolver"}</span>
          <span className="block text-sm text-slate-500">
            {clientesQueDeben === 0 ? "Nadie debe cilindros" : clientesQueDeben === 1 ? "Lo tiene 1 cliente" : `Los tienen ${clientesQueDeben} clientes`}
          </span>
        </span>
      </Card>
      )}

      {saldos.some((x) => x.pendientes > 0) && (
        <input
          className="mb-3 w-full max-w-sm rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="Buscar por nombre o telefono..."
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
        />
      )}

      <div className="space-y-2">
        {visibles.length === 0 && (
          <Card className="p-8 text-center text-slate-400">{saldos.length ? "Todos devolvieron sus cilindros ✓" : "Todavia no se ha prestado ningun cilindro"}</Card>
        )}
        {visibles.map((s) => (
          <Card key={`${s.cliente_id}-${s.producto_id}`} className="flex flex-wrap items-center gap-4 p-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xl font-bold text-amber-700">{s.pendientes}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-base font-semibold text-slate-800">{s.cliente_nombre}</span>
              <span className="block text-sm text-slate-500">
                {s.pendientes === 1 ? "Tiene 1" : `Tiene ${s.pendientes}`} {s.producto_nombre} · desde el {formatDate(s.ultima_fecha)}
                {s.cliente_telefono ? ` · Tel. ${s.cliente_telefono}` : ""}
              </span>
            </span>
            {s.pendientes > 0 && (
              <Button className="!bg-emerald-600 py-2.5 text-base hover:!bg-emerald-700" onClick={() => abrir(nuevo("DEVOLUCION", s.cliente_id, s.producto_id, String(s.pendientes)))}>
                ✓ Ya lo devolvió
              </Button>
            )}
            <button className="text-sm font-medium text-brand-600 hover:underline" onClick={() => abrir(nuevo("FIADO", s.cliente_id, s.producto_id))}>
              Prestar más
            </button>
          </Card>
        ))}
      </div>

      {adminVentas && (
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <button className="text-sm font-medium text-slate-500 hover:text-slate-700" onClick={() => setVerHistorial(!verHistorial)}>
          {verHistorial ? "▲ Esconder historial" : "▼ Ver historial"}
        </button>
        {verHistorial && (
          <label className="flex items-center gap-2 text-sm text-slate-500">
            <input type="checkbox" checked={verTodos} onChange={(e) => setVerTodos(e.target.checked)} /> Ver tambien los que ya devolvieron todo
          </label>
        )}
      {verHistorial && (
        <div className="w-full basis-full">
          <Table columns={["Fecha", "Cliente", "Cilindro", "Movimiento", "Cantidad", "Nota", "Registrado por"]}>
            {movimientos.length === 0 && <EmptyRow colSpan={7} label="Sin movimientos" />}
            {movimientos
              .filter((m) => !q || `${m.cliente_nombre} ${m.producto_nombre}`.toLowerCase().includes(q))
              .map((m) => (
                <tr key={m.id}>
                  <td className="px-4 py-2 text-slate-500">{formatDate(m.fecha)}</td>
                  <td className="px-4 py-2">{m.cliente_nombre}</td>
                  <td className="px-4 py-2">{m.producto_nombre}</td>
                  <td className="px-4 py-2">{m.tipo === "FIADO" ? <Badge tone="amber">Prestado</Badge> : <Badge tone="green">Devuelto</Badge>}</td>
                  <td className="px-4 py-2 text-center">{m.cantidad}</td>
                  <td className="px-4 py-2 text-slate-500">{m.nota ?? ""}</td>
                  <td className="px-4 py-2 text-slate-500">{m.creado_por ?? ""}</td>
                </tr>
              ))}
          </Table>
        </div>
      )}
      </div>
      )}

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.tipo === "FIADO" ? "Prestar cilindros" : "Devolvio cilindros"}>
        {form && (
          <form onSubmit={guardar} className="space-y-3">
            {form.tipo === "FIADO" ? (
              <>
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-slate-700">Cliente</span>
                  <input
                    list="clientes-prestamo"
                    value={form.nombre}
                    onChange={(e) => escribirNombre(e.target.value)}
                    placeholder="Escribe el nombre (ej. Jose Ramirez) o eligelo de la lista"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    autoFocus
                  />
                  <datalist id="clientes-prestamo">
                    {clientes
                      .filter((c) => c.codigo !== "CLI-0000")
                      .map((c) => (
                        <option key={c.id} value={c.nombre}>
                          {c.telefono ?? ""}
                        </option>
                      ))}
                  </datalist>
                </label>
                {form.nombre.trim() && !form.cliente && (
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    <p className="mb-2 text-xs text-slate-500">Cliente nuevo: se registra con este nombre al guardar.</p>
                    <Input label="Telefono (opcional)" value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} placeholder="809-000-0000" />
                  </div>
                )}
              </>
            ) : (
              <Select label="Cliente" value={form.cliente} onChange={(e) => setForm({ ...form, cliente: e.target.value ? Number(e.target.value) : "" })} autoFocus>
                <option value="">Elegir cliente...</option>
                {clientes
                  .filter((c) => saldos.some((s) => s.cliente_id === c.id && s.pendientes > 0))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                      {c.telefono ? ` · ${c.telefono}` : ""}
                    </option>
                  ))}
              </Select>
            )}
            <Select label="Cilindro" value={form.producto} onChange={(e) => setForm({ ...form, producto: e.target.value ? Number(e.target.value) : "" })}>
              <option value="">Elegir cilindro...</option>
              {productos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </Select>
            {form.cliente && form.producto ? (
              <p className={`rounded-lg px-3 py-2 text-sm ${debe > 0 ? "bg-amber-50 text-amber-800" : "bg-slate-50 text-slate-600"}`}>
                {debe > 0 ? `Este cliente tiene ${debe} de este cilindro prestado${debe === 1 ? "" : "s"}.` : "Este cliente no tiene ninguno de este cilindro prestado."}
              </p>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <Input
                label={form.tipo === "FIADO" ? "Cantidad que se presta" : "Cantidad que devolvio"}
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
                {guardando ? "Guardando..." : form.tipo === "FIADO" ? "Prestar" : "Registrar devolucion"}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
