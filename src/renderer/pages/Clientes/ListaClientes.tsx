import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, mensajeDeError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import type { Cliente } from "../../lib/types";
import { Badge, Button, EmptyRow, Input, Modal, PageHeader, Select, Table } from "../../components/ui";

const emptyForm = { nombre: "", rnc_cedula: "", tipo: "FISICA" as "FISICA" | "JURIDICA", telefono: "", email: "", direccion: "" };

export default function ListaClientes() {
  const { usuario } = useAuth();
  const esAdmin = usuario?.rol === "ADMIN";
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [verInactivos, setVerInactivos] = useState(false);
  const [aBorrar, setABorrar] = useState<Cliente | null>(null);
  const [borrando, setBorrando] = useState(false);
  const [aviso, setAviso] = useState("");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editActivo, setEditActivo] = useState(1);
  const [form, setForm] = useState(emptyForm);
  const [filtro, setFiltro] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function cargar() {
    setClientes(await api.clientes.listar());
  }

  useEffect(() => {
    cargar();
  }, []);

  function abrirNuevo() {
    setEditId(null);
    setForm(emptyForm);
    setOpen(true);
  }

  function abrirEditar(c: Cliente) {
    setEditId(c.id);
    setEditActivo(c.activo ?? 1);
    setForm({ nombre: c.nombre, rnc_cedula: c.rnc_cedula ?? "", tipo: c.tipo, telefono: c.telefono ?? "", email: c.email ?? "", direccion: c.direccion ?? "" });
    setOpen(true);
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      if (editId) await api.clientes.actualizar(editId, { ...form, activo: editActivo });
      else await api.clientes.crear(form);
      setOpen(false);
      await cargar();
    } finally {
      setGuardando(false);
    }
  }

  async function borrar() {
    if (!aBorrar) return;
    setBorrando(true);
    try {
      const r = await api.clientes.eliminar(aBorrar.id);
      setAviso(
        r.borrado
          ? `Se borro ${aBorrar.nombre}.`
          : `${aBorrar.nombre} tiene facturas o movimientos, asi que se desactivo para no perder su historial: ya no sale para vender. Puedes verlo con "Ver inactivos".`
      );
      setABorrar(null);
      await cargar();
    } catch (err) {
      setAviso(mensajeDeError(err));
      setABorrar(null);
    } finally {
      setBorrando(false);
    }
  }

  async function reactivar(c: Cliente) {
    await api.clientes.actualizar(c.id, { ...c, activo: 1 });
    setAviso(`${c.nombre} esta activo otra vez.`);
    await cargar();
  }

  const inactivos = clientes.filter((c) => c.activo === 0).length;
  const filtrados = clientes.filter(
    (c) => (verInactivos || c.activo !== 0) && (c.nombre.toLowerCase().includes(filtro.toLowerCase()) || (c.rnc_cedula ?? "").includes(filtro))
  );

  return (
    <div>
      <PageHeader
        title="Clientes"
        subtitle="Directorio de clientes, historial de compras y estado de cuenta"
        actions={<Button onClick={abrirNuevo}>+ Nuevo Cliente</Button>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-4">
        <div className="w-full max-w-xs">
          <Input placeholder="Buscar por nombre o RNC/cedula..." value={filtro} onChange={(e) => setFiltro(e.target.value)} />
        </div>
        {inactivos > 0 && (
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={verInactivos} onChange={(e) => setVerInactivos(e.target.checked)} /> Ver inactivos ({inactivos})
          </label>
        )}
      </div>

      {aviso && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
          <span>{aviso}</span>
          <button className="text-slate-400 hover:text-slate-600" onClick={() => setAviso("")} aria-label="Cerrar">
            ✕
          </button>
        </div>
      )}

      <Table columns={["Codigo", "Nombre", "RNC / Cedula", "Tipo", "Telefono", ""]}>
        {filtrados.length === 0 && <EmptyRow colSpan={6} />}
        {filtrados.map((c) => (
          <tr key={c.id} className="hover:bg-slate-50">
            <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{c.codigo}</td>
            <td className="px-4 py-2.5 font-medium text-slate-800">
              <Link to={`/clientes/${c.id}`} className="hover:text-brand-600 hover:underline">
                {c.nombre}
              </Link>
              {c.activo === 0 && (
                <span className="ml-2">
                  <Badge tone="slate">Inactivo</Badge>
                </span>
              )}
            </td>
            <td className="px-4 py-2.5 text-slate-600">{c.rnc_cedula || "-"}</td>
            <td className="px-4 py-2.5">
              <Badge tone={c.tipo === "JURIDICA" ? "blue" : "slate"}>{c.tipo === "JURIDICA" ? "Juridica" : "Fisica"}</Badge>
            </td>
            <td className="px-4 py-2.5 text-slate-600">{c.telefono || "-"}</td>
            <td className="whitespace-nowrap px-4 py-2.5 text-right">
              <Button size="sm" variant="secondary" onClick={() => abrirEditar(c)}>
                Editar
              </Button>
              {esAdmin && c.codigo !== "CLI-0000" && c.activo !== 0 && (
                <button className="ml-3 text-xs font-medium text-red-600 hover:underline" onClick={() => setABorrar(c)}>
                  Borrar
                </button>
              )}
              {c.activo === 0 && (
                <button className="ml-3 text-xs font-medium text-brand-600 hover:underline" onClick={() => reactivar(c)}>
                  Reactivar
                </button>
              )}
            </td>
          </tr>
        ))}
      </Table>

      <Modal open={!!aBorrar} onClose={() => setABorrar(null)} title="Borrar cliente">
        <p className="text-sm text-slate-600">
          Vas a borrar a <b className="text-slate-900">{aBorrar?.nombre}</b>. Si ya tiene facturas, cobros o envases, no se borra: se desactiva para
          conservar su historial y deja de salir para vender.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setABorrar(null)}>
            Cancelar
          </Button>
          <Button type="button" variant="danger" onClick={borrar} disabled={borrando}>
            {borrando ? "Borrando..." : "Borrar"}
          </Button>
        </div>
      </Modal>

      <Modal open={open} onClose={() => setOpen(false)} title={editId ? "Editar Cliente" : "Nuevo Cliente"}>
        <form onSubmit={guardar} className="space-y-3">
          <Input label="Nombre completo / Razon social" required value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Select label="Tipo" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value as any })}>
              <option value="FISICA">Persona Fisica</option>
              <option value="JURIDICA">Persona Juridica</option>
            </Select>
            <Input label="RNC / Cedula" value={form.rnc_cedula} onChange={(e) => setForm({ ...form, rnc_cedula: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Telefono" value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} />
            <Input label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <Input label="Direccion" value={form.direccion} onChange={(e) => setForm({ ...form, direccion: e.target.value })} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={guardando}>
              {guardando ? "Guardando..." : "Guardar"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
