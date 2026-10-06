import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { Cuenta, TipoCuenta } from "../../lib/types";
import { Badge, Button, Input, Modal, PageHeader, Select, Table } from "../../components/ui";

const TIPOS: { value: TipoCuenta; label: string; tone: "blue" | "red" | "green" | "amber" | "slate" }[] = [
  { value: "ACTIVO", label: "Activo", tone: "blue" },
  { value: "PASIVO", label: "Pasivo", tone: "red" },
  { value: "PATRIMONIO", label: "Patrimonio", tone: "green" },
  { value: "INGRESOS", label: "Ingresos", tone: "green" },
  { value: "COSTOS", label: "Costos", tone: "amber" },
  { value: "GASTOS", label: "Gastos", tone: "amber" },
];

export default function CatalogoCuentas() {
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ codigo: "", nombre: "", tipo: "ACTIVO" as TipoCuenta, padre_id: "", naturaleza: "DEUDORA" as "DEUDORA" | "ACREEDORA" });
  const [guardando, setGuardando] = useState(false);

  async function cargar() {
    setCuentas(await api.cuentas.listar());
  }

  useEffect(() => {
    cargar();
  }, []);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      await api.cuentas.crear({ ...form, padre_id: form.padre_id ? Number(form.padre_id) : null, es_movimiento: 1 });
      setOpen(false);
      setForm({ codigo: "", nombre: "", tipo: "ACTIVO", padre_id: "", naturaleza: "DEUDORA" });
      await cargar();
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Catalogo de Cuentas"
        subtitle="Las 6 categorias contables: Activo, Pasivo, Patrimonio, Ingresos, Gastos y Costos"
        actions={<Button onClick={() => setOpen(true)}>+ Nueva Subcuenta</Button>}
      />

      {TIPOS.map((t) => {
        const grupo = cuentas.filter((c) => c.tipo === t.value);
        if (grupo.length === 0) return null;
        return (
          <div key={t.value} className="mb-6">
            <div className="mb-2 flex items-center gap-2">
              <Badge tone={t.tone}>{t.label}</Badge>
              <span className="text-xs text-slate-400">{grupo.length} cuentas</span>
            </div>
            <Table columns={["Codigo", "Nombre", "Naturaleza", "Tipo"]}>
              {grupo.map((c) => (
                <tr key={c.id} className={c.es_movimiento ? "" : "bg-slate-50 font-semibold"}>
                  <td className="px-4 py-2 font-mono text-xs text-slate-500">{c.codigo}</td>
                  <td className="px-4 py-2 text-slate-800">{c.nombre}</td>
                  <td className="px-4 py-2 text-xs text-slate-500">{c.naturaleza === "DEUDORA" ? "Deudora" : "Acreedora"}</td>
                  <td className="px-4 py-2 text-xs text-slate-400">{c.es_movimiento ? "De movimiento" : "Grupo"}</td>
                </tr>
              ))}
            </Table>
          </div>
        );
      })}

      <Modal open={open} onClose={() => setOpen(false)} title="Nueva Subcuenta">
        <form onSubmit={guardar} className="space-y-3">
          <Input label="Codigo (ej. 1.1.08)" required value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} />
          <Input label="Nombre" required value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
          <Select label="Categoria" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value as TipoCuenta })}>
            {TIPOS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
          <Select label="Cuenta padre (opcional)" value={form.padre_id} onChange={(e) => setForm({ ...form, padre_id: e.target.value })}>
            <option value="">Ninguna (cuenta de primer nivel)</option>
            {cuentas
              .filter((c) => c.tipo === form.tipo)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.codigo} - {c.nombre}
                </option>
              ))}
          </Select>
          <Select label="Naturaleza" value={form.naturaleza} onChange={(e) => setForm({ ...form, naturaleza: e.target.value as any })}>
            <option value="DEUDORA">Deudora</option>
            <option value="ACREEDORA">Acreedora</option>
          </Select>
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
