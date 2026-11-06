import { useEffect, useMemo, useState } from "react";
import { api, mensajeDeError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { formatMoney, todayIso } from "../../lib/format";
import type { PlatoDia, Producto } from "../../lib/types";
import { Button, Card, Input, Modal, PageHeader } from "../../components/ui";
import { sinAcentos } from "./buscar";
import { sinImpuestos } from "../../lib/variant";

// Platos del dia (Dara Frituras): el menu de hoy, en la caja y en el Admin. Cada cambio queda anotado con quien lo hizo.
// El plato se escribe por su nombre: si no existe se crea aqui mismo, y las porciones preparadas entran al inventario.

type Formulario = { producto_id: number | ""; nombre: string; precio: string; porciones: string; costo: string; editando: boolean };

const numero = (texto: string) => Number(texto.replace(",", "."));
const soloNumeros = (texto: string) => texto.replace(/[^0-9.,]/g, "");

export default function PlatosDia() {
  const { usuario } = useAuth();
  const hoy = todayIso();
  const [platos, setPlatos] = useState<PlatoDia[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [form, setForm] = useState<Formulario | null>(null);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  const autor = { id: usuario?.id ?? null, nombre: usuario?.nombre ?? "", rol: usuario?.rol };

  async function cargar() {
    setPlatos(await api.platos.listar(hoy));
  }

  useEffect(() => {
    cargar();
    api.productos.listar().then((p) => setProductos((p as Producto[]).filter((x) => x.activo)));
  }, []);

  const disponibles = useMemo(() => productos.filter((p) => !platos.some((x) => x.producto_id === p.id)), [productos, platos]);
  const finalDe = (p: Producto) => Math.round(p.precio_contenido * (1 + (p.itbis_rate ?? 0.18)) * 100) / 100;
  const existenciaDe = (id: number) => productos.find((x) => x.id === id)?.existencia ?? 0;
  const finalPlato = (p: PlatoDia) => Math.round(p.precio * (1 + (p.itbis_rate ?? 0.18)) * 100) / 100;

  function nuevo() {
    setError("");
    setForm({ producto_id: "", nombre: "", precio: "", porciones: "", costo: "", editando: false });
  }

  function editar(p: PlatoDia) {
    setError("");
    setForm({ producto_id: p.producto_id, nombre: p.nombre, precio: String(finalPlato(p)), porciones: String(p.porciones), costo: "", editando: true });
  }

  // Al escribir el nombre: si ya existe ese plato se usa, con su precio.
  function escribirNombre(nombre: string) {
    if (!form) return;
    const p = disponibles.find((x) => sinAcentos(x.nombre.trim()) === sinAcentos(nombre.trim()));
    setForm({ ...form, nombre, producto_id: p?.id ?? "", precio: p ? String(finalDe(p)) : form.producto_id ? "" : form.precio });
  }

  // Devuelve el plato listo para vender: lo crea si es nuevo y, si el inventario no alcanza, le sube lo preparado.
  async function platoListo(f: Formulario): Promise<number> {
    const porciones = numero(f.porciones);
    if (!f.producto_id) {
      const creado = (await api.productos.crear({
        nombre: f.nombre.trim(),
        grupo: "Platos",
        unidad: "UNIDAD",
        categoria: "OTRO",
        precio_contenido: sinImpuestos ? numero(f.precio) : Math.round((numero(f.precio) / 1.18) * 10000) / 10000,
        costo_contenido: numero(f.costo) || 0,
        existencia: porciones,
        maneja_envase: 0,
        itbis_rate: sinImpuestos ? 0 : 0.18,
        cuentas_por_categoria: true,
      })) as Producto;
      return creado.id;
    }
    const producto = productos.find((x) => x.id === f.producto_id);
    const vendidas = platos.find((x) => x.producto_id === f.producto_id)?.vendidas ?? 0;
    const hacenFalta = porciones - vendidas;
    if (producto && hacenFalta > producto.existencia) await api.productos.actualizar(producto.id, { ...producto, existencia: hacenFalta, cuentas_por_categoria: true });
    return f.producto_id;
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    if (!form.nombre.trim()) return setError("Escribe el nombre del plato");
    if (!(numero(form.precio) > 0)) return setError("Escribe el precio del plato");
    if (!(numero(form.porciones) > 0)) return setError("Escribe cuantas porciones hiciste");
    setGuardando(true);
    setError("");
    try {
      const productoId = await platoListo(form);
      await api.platos.guardar({ fecha: hoy, producto_id: productoId, precio_final: numero(form.precio), porciones: numero(form.porciones), autor });
      setForm(null);
      await cargar();
      api.productos.listar().then((p) => setProductos((p as Producto[]).filter((x) => x.activo)));
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setGuardando(false);
    }
  }

  async function ejecutar(accion: () => Promise<unknown>) {
    setError("");
    try {
      await accion();
      await cargar();
    } catch (err) {
      setError(mensajeDeError(err));
    }
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Platos del dia"
        subtitle="Lo que se vende hoy, a que precio y cuantas porciones hay. Sale primero en la caja."
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => ejecutar(() => api.platos.copiar({ fecha: hoy, autor }))}>
              Copiar menu anterior
            </Button>
            <Button className="py-2.5 text-base" onClick={nuevo}>
              + Agregar plato
            </Button>
          </div>
        }
      />

      {error && !form && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="space-y-2">
        {platos.length === 0 && <Card className="p-8 text-center text-slate-400">Todavia no hay platos de hoy. Toca "Agregar plato" o "Copiar menu anterior".</Card>}
        {platos.map((p) => (
          <Card key={p.producto_id} className={`flex flex-wrap items-center gap-4 border-l-4 p-4 ${p.quedan <= 0 ? "border-l-red-500" : "border-l-emerald-500"}`}>
            <span className="min-w-0 flex-1">
              <span className="block text-base font-semibold text-slate-800">{p.nombre}</span>
              <span className="block text-sm text-slate-500">
                {formatMoney(finalPlato(p))} · {p.porciones} preparadas · {p.vendidas} vendidas · {existenciaDe(p.producto_id)} en inventario
              </span>
              {p.quedan > existenciaDe(p.producto_id) && <span className="block text-xs font-medium text-amber-700">El inventario no alcanza para las porciones que quedan</span>}
            </span>
            <span className="text-right">
              <span className="block text-xs text-slate-400">{p.quedan <= 0 ? "Agotado" : "Quedan"}</span>
              <span className={`block text-2xl font-bold ${p.quedan <= 0 ? "text-red-600" : "text-emerald-700"}`}>{p.quedan}</span>
            </span>
            <Button variant="secondary" onClick={() => editar(p)}>
              Cambiar
            </Button>
            <button type="button" className="text-xs font-medium text-red-600 hover:underline" onClick={() => ejecutar(() => api.platos.quitar({ fecha: hoy, producto_id: p.producto_id, autor }))}>
              Quitar
            </button>
          </Card>
        ))}
      </div>

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.editando ? "Cambiar plato de hoy" : "Agregar plato de hoy"}>
        {form && (
          <form onSubmit={guardar} className="space-y-3">
            {form.editando ? (
              <p className="text-base font-semibold text-slate-800">{form.nombre}</p>
            ) : (
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-700">Nombre del plato</span>
                <input
                  list="platos-guardados"
                  autoFocus
                  value={form.nombre}
                  onChange={(e) => escribirNombre(e.target.value)}
                  placeholder="Ej. Salami con platano frito"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
                <datalist id="platos-guardados">
                  {disponibles.map((p) => (
                    <option key={p.id} value={p.nombre} />
                  ))}
                </datalist>
              </label>
            )}
            <Input label="Precio (RD$)" inputMode="decimal" value={form.precio} onChange={(e) => setForm({ ...form, precio: soloNumeros(e.target.value) })} placeholder="Ej. 150" />
            <Input label="Cuantas porciones hiciste" inputMode="decimal" value={form.porciones} onChange={(e) => setForm({ ...form, porciones: soloNumeros(e.target.value) })} placeholder="Ej. 10" />
            {!form.editando && !form.producto_id && form.nombre.trim() && (
              <>
                <Input label="Cuanto te cuesta cada porcion (RD$)" inputMode="decimal" value={form.costo} onChange={(e) => setForm({ ...form, costo: soloNumeros(e.target.value) })} placeholder="Ej. 60" />
                <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Plato nuevo: se guarda solo y la proxima vez ya sale en la lista.</p>
              </>
            )}
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setForm(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={guardando}>
                {guardando ? "Guardando..." : "Guardar"}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
