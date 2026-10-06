import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { Cuenta, Producto } from "../../lib/types";
import { formatMoney } from "../../lib/format";
import { Badge, Button, EmptyRow, Input, Modal, PageHeader, Select, Table } from "../../components/ui";

const emptyForm = {
  nombre: "",
  categoria: "GAS" as Producto["categoria"],
  unidad: "CILINDRO",
  precio_contenido: 0,
  costo_contenido: 0,
  maneja_envase: true,
  fianza_envase: 0,
  itbis_rate: 0.18,
  cuenta_ingreso_id: undefined as number | undefined,
  cuenta_costo_id: undefined as number | undefined,
  cuenta_inventario_id: undefined as number | undefined,
  existencia: 0,
};

const CUENTAS_INGRESO: Record<string, string> = { GAS: "4.1.01", OXIGENO: "4.1.02", AGUA: "4.1.03", OTRO: "4.1.03" };
const CUENTAS_COSTO: Record<string, string> = { GAS: "5.1.01", OXIGENO: "5.1.02", AGUA: "5.1.03", OTRO: "5.1.03" };
const CUENTAS_INVENTARIO: Record<string, string> = { GAS: "1.1.04", OXIGENO: "1.1.05", AGUA: "1.1.06", OTRO: "1.1.06" };

function calcularMargen(costo: number, precio: number): number {
  if (costo <= 0) return 0;
  return Math.round(((precio - costo) / costo) * 100 * 100) / 100;
}

function calcularPrecio(costo: number, margenPct: number): number {
  return Math.round(costo * (1 + margenPct / 100) * 100) / 100;
}

export default function ListaProductos() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [margenPct, setMargenPct] = useState(0);
  const [guardando, setGuardando] = useState(false);

  async function cargar() {
    const [p, c] = await Promise.all([api.productos.listar(), api.cuentas.listar()]);
    setProductos(p);
    setCuentas(c);
  }

  useEffect(() => {
    cargar();
  }, []);

  function cuentaIdPorCodigo(codigo: string) {
    return cuentas.find((c) => c.codigo === codigo)?.id;
  }

  function abrirNuevo() {
    setEditId(null);
    setForm({
      ...emptyForm,
      cuenta_ingreso_id: cuentaIdPorCodigo(CUENTAS_INGRESO.GAS),
      cuenta_costo_id: cuentaIdPorCodigo(CUENTAS_COSTO.GAS),
      cuenta_inventario_id: cuentaIdPorCodigo(CUENTAS_INVENTARIO.GAS),
    });
    setMargenPct(0);
    setOpen(true);
  }

  function abrirEditar(p: Producto) {
    setEditId(p.id);
    setForm({
      nombre: p.nombre,
      categoria: p.categoria,
      unidad: p.unidad,
      precio_contenido: p.precio_contenido,
      costo_contenido: p.costo_contenido,
      maneja_envase: !!p.maneja_envase,
      fianza_envase: p.fianza_envase,
      itbis_rate: p.itbis_rate ?? 0.18,
      cuenta_ingreso_id: p.cuenta_ingreso_id ?? undefined,
      cuenta_costo_id: p.cuenta_costo_id ?? undefined,
      cuenta_inventario_id: p.cuenta_inventario_id ?? undefined,
      existencia: p.existencia,
    });
    setMargenPct(calcularMargen(p.costo_contenido, p.precio_contenido));
    setOpen(true);
  }

  function cambiarCosto(costo: number) {
    setForm({ ...form, costo_contenido: costo, precio_contenido: calcularPrecio(costo, margenPct) });
  }

  function cambiarMargen(pct: number) {
    setMargenPct(pct);
    setForm({ ...form, precio_contenido: calcularPrecio(form.costo_contenido, pct) });
  }

  function cambiarPrecio(precio: number) {
    setForm({ ...form, precio_contenido: precio });
    setMargenPct(calcularMargen(form.costo_contenido, precio));
  }

  function cambiarCategoria(categoria: Producto["categoria"]) {
    setForm({
      ...form,
      categoria,
      cuenta_ingreso_id: cuentaIdPorCodigo(CUENTAS_INGRESO[categoria]),
      cuenta_costo_id: cuentaIdPorCodigo(CUENTAS_COSTO[categoria]),
      cuenta_inventario_id: cuentaIdPorCodigo(CUENTAS_INVENTARIO[categoria]),
    });
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      if (editId) await api.productos.actualizar(editId, form);
      else await api.productos.crear(form);
      setOpen(false);
      await cargar();
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <PageHeader title="Productos" subtitle="Gas, oxigeno y agua purificada: precios, costo y manejo de envases" actions={<Button onClick={abrirNuevo}>+ Nuevo Producto</Button>} />

      <Table columns={["Codigo", "Producto", "Categoria", "Precio", "Costo", "Envase", "Existencia", ""]}>
        {productos.length === 0 && <EmptyRow colSpan={8} />}
        {productos.map((p) => (
          <tr key={p.id} className="hover:bg-slate-50">
            <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{p.codigo}</td>
            <td className="px-4 py-2.5 font-medium text-slate-800">{p.nombre}</td>
            <td className="px-4 py-2.5">
              <Badge tone="blue">{p.categoria}</Badge>
            </td>
            <td className="px-4 py-2.5">{formatMoney(p.precio_contenido)}</td>
            <td className="px-4 py-2.5 text-slate-500">{formatMoney(p.costo_contenido)}</td>
            <td className="px-4 py-2.5">{p.maneja_envase ? <Badge tone="amber">Fianza {formatMoney(p.fianza_envase)}</Badge> : <span className="text-slate-400">No aplica</span>}</td>
            <td className="px-4 py-2.5">
              <span className={p.existencia <= 10 ? "font-semibold text-red-600" : "text-slate-700"}>{p.existencia}</span>
            </td>
            <td className="px-4 py-2.5 text-right">
              <Button size="sm" variant="secondary" onClick={() => abrirEditar(p)}>
                Editar
              </Button>
            </td>
          </tr>
        ))}
      </Table>

      <Modal open={open} onClose={() => setOpen(false)} title={editId ? "Editar Producto" : "Nuevo Producto"}>
        <form onSubmit={guardar} className="space-y-3">
          <Input label="Nombre del producto" required value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Select label="Categoria" value={form.categoria} onChange={(e) => cambiarCategoria(e.target.value as any)}>
              <option value="GAS">Gas</option>
              <option value="OXIGENO">Oxigeno</option>
              <option value="AGUA">Agua Purificada</option>
              <option value="OTRO">Otro</option>
            </Select>
            <Input label="Unidad" value={form.unidad} onChange={(e) => setForm({ ...form, unidad: e.target.value })} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Input label="Costo (compra)" type="number" step="0.01" value={form.costo_contenido} onChange={(e) => cambiarCosto(Number(e.target.value))} />
            <Input label="% de ganancia" type="number" step="0.01" value={margenPct} onChange={(e) => cambiarMargen(Number(e.target.value))} />
            <Input
              label="ITBIS (%)"
              type="number"
              step="0.01"
              value={Math.round(form.itbis_rate * 10000) / 100}
              onChange={(e) => setForm({ ...form, itbis_rate: Number(e.target.value) / 100 })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Existencia" type="number" value={form.existencia} onChange={(e) => setForm({ ...form, existencia: Number(e.target.value) })} />
            <Input
              label="Precio de venta (sin ITBIS, ajustable)"
              type="number"
              step="0.01"
              value={form.precio_contenido}
              onChange={(e) => cambiarPrecio(Number(e.target.value))}
            />
          </div>
          <div className="rounded-lg bg-brand-50 px-3 py-2 text-sm">
            <span className="text-slate-600">Precio final con ITBIS: </span>
            <span className="font-semibold text-brand-700">{formatMoney(form.precio_contenido * (1 + form.itbis_rate))}</span>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={form.maneja_envase} onChange={(e) => setForm({ ...form, maneja_envase: e.target.checked })} />
            Maneja envase retornable (cilindro / botellon)
          </label>
          {form.maneja_envase && (
            <Input label="Fianza del envase" type="number" step="0.01" value={form.fianza_envase} onChange={(e) => setForm({ ...form, fianza_envase: Number(e.target.value) })} />
          )}
          <p className="text-xs text-slate-400">
            Cuentas contables asignadas automaticamente segun la categoria (ingreso, costo e inventario). Se pueden ajustar desde el Catalogo de Cuentas.
          </p>
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
