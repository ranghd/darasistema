import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import type { Cliente } from "../../lib/types";
import { Badge, Button, EmptyRow, Input, Modal, PageHeader, Select, Table } from "../../components/ui";

const emptyForm = { nombre: "", rnc_cedula: "", tipo: "FISICA" as "FISICA" | "JURIDICA", telefono: "", email: "", direccion: "" };

export default function ListaClientes() {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
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
    setForm({ nombre: c.nombre, rnc_cedula: c.rnc_cedula ?? "", tipo: c.tipo, telefono: c.telefono ?? "", email: c.email ?? "", direccion: c.direccion ?? "" });
    setOpen(true);
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      if (editId) await api.clientes.actualizar(editId, form);
      else await api.clientes.crear(form);
      setOpen(false);
      await cargar();
    } finally {
      setGuardando(false);
    }
  }

  const filtrados = clientes.filter((c) => c.nombre.toLowerCase().includes(filtro.toLowerCase()) || (c.rnc_cedula ?? "").includes(filtro));

  return (
    <div>
      <PageHeader
        title="Clientes"
        subtitle="Directorio de clientes, historial de compras y estado de cuenta"
        actions={<Button onClick={abrirNuevo}>+ Nuevo Cliente</Button>}
      />

      <div className="mb-4 max-w-xs">
        <Input placeholder="Buscar por nombre o RNC/cedula..." value={filtro} onChange={(e) => setFiltro(e.target.value)} />
      </div>

      <Table columns={["Codigo", "Nombre", "RNC / Cedula", "Tipo", "Telefono", ""]}>
        {filtrados.length === 0 && <EmptyRow colSpan={6} />}
        {filtrados.map((c) => (
          <tr key={c.id} className="hover:bg-slate-50">
            <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{c.codigo}</td>
            <td className="px-4 py-2.5 font-medium text-slate-800">
              <Link to={`/clientes/${c.id}`} className="hover:text-brand-600 hover:underline">
                {c.nombre}
              </Link>
            </td>
            <td className="px-4 py-2.5 text-slate-600">{c.rnc_cedula || "-"}</td>
            <td className="px-4 py-2.5">
              <Badge tone={c.tipo === "JURIDICA" ? "blue" : "slate"}>{c.tipo === "JURIDICA" ? "Juridica" : "Fisica"}</Badge>
            </td>
            <td className="px-4 py-2.5 text-slate-600">{c.telefono || "-"}</td>
            <td className="px-4 py-2.5 text-right">
              <Button size="sm" variant="secondary" onClick={() => abrirEditar(c)}>
                Editar
              </Button>
            </td>
          </tr>
        ))}
      </Table>

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
