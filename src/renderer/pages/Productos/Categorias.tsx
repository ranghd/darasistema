import { useEffect, useState } from "react";
import { api, mensajeDeError } from "../../lib/api";
import { CATEGORIAS_SUGERIDAS, soloVentas } from "../../lib/variant";
import type { CategoriaPropia } from "../../lib/types";
import { Button, EmptyRow, Input, Modal, PageHeader, Table } from "../../components/ui";

// Categorias propias de los productos: son las pestanas de la caja (Oxigeno, Acetileno, Manometros...).
// Cada producto se pone en una categoria desde Productos.

type Accion = { tipo: "nueva" } | { tipo: "renombrar"; nombre: string } | { tipo: "borrar"; nombre: string; productos: number };

export default function Categorias() {
  const [categorias, setCategorias] = useState<CategoriaPropia[]>([]);
  const [accion, setAccion] = useState<Accion | null>(null);
  const [nombre, setNombre] = useState("");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function cargar() {
    let lista = await api.categorias.listar();
    // Gas Damian empieza con sus categorias de siempre
    if (soloVentas && lista.length === 0) {
      for (const c of CATEGORIAS_SUGERIDAS) await api.categorias.crear(c);
      lista = await api.categorias.listar();
    }
    setCategorias(lista);
  }

  useEffect(() => {
    cargar();
  }, []);

  const abrir = (a: Accion) => {
    setError("");
    setNombre(a.tipo === "renombrar" ? a.nombre : "");
    setAccion(a);
  };

  async function guardar(e?: React.FormEvent) {
    e?.preventDefault();
    if (!accion) return;
    setGuardando(true);
    setError("");
    try {
      if (accion.tipo === "nueva") await api.categorias.crear(nombre);
      else if (accion.tipo === "renombrar") await api.categorias.renombrar(accion.nombre, nombre);
      else await api.categorias.borrar(accion.nombre);
      setAccion(null);
      await cargar();
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Categorias"
        subtitle="Las pestanas de la caja y, a la vez, el tipo contable: cada categoria tiene sus cuentas de ventas, costo e inventario."
        actions={<Button onClick={() => abrir({ tipo: "nueva" })}>+ Nueva categoria</Button>}
      />

      <Table columns={["Categoria", "Productos", "Cuentas contables", ""]}>
        {categorias.length === 0 && <EmptyRow colSpan={4} label="Todavia no hay categorias" />}
        {categorias.map((c) => (
          <tr key={c.nombre} className="hover:bg-slate-50">
            <td className="px-4 py-2.5 font-medium text-slate-800">{c.nombre}</td>
            <td className="px-4 py-2.5 text-slate-600">{c.productos === 1 ? "1 producto" : `${c.productos} productos`}</td>
            <td className="px-4 py-2.5 text-xs text-slate-500">
              {[c.cuenta_ingreso, c.cuenta_costo, c.cuenta_inventario].filter(Boolean).map((n) => (
                <span key={n} className="block">
                  {n}
                </span>
              ))}
            </td>
            <td className="whitespace-nowrap px-4 py-2.5 text-right">
              <Button size="sm" variant="secondary" onClick={() => abrir({ tipo: "renombrar", nombre: c.nombre })}>
                Cambiar nombre
              </Button>
              <button className="ml-3 text-xs font-medium text-red-600 hover:underline" onClick={() => abrir({ tipo: "borrar", nombre: c.nombre, productos: c.productos })}>
                Borrar
              </button>
            </td>
          </tr>
        ))}
      </Table>

      <Modal
        open={!!accion}
        onClose={() => setAccion(null)}
        title={accion?.tipo === "nueva" ? "Nueva categoria" : accion?.tipo === "renombrar" ? "Cambiar nombre" : "Borrar categoria"}
      >
        {accion?.tipo === "borrar" ? (
          <div>
            <p className="text-sm text-slate-600">
              Vas a borrar la categoria <b className="text-slate-900">{accion.nombre}</b>.
              {accion.productos > 0 && ` Sus ${accion.productos === 1 ? "producto queda" : `${accion.productos} productos quedan`} sin categoria (no se borran).`}
            </p>
            {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setAccion(null)}>
                Cancelar
              </Button>
              <Button type="button" variant="danger" onClick={() => guardar()} disabled={guardando}>
                {guardando ? "Borrando..." : "Borrar"}
              </Button>
            </div>
          </div>
        ) : (
          accion && (
            <form onSubmit={guardar} className="space-y-3">
              <Input label="Nombre de la categoria" required autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Manometros" />
              {accion.tipo === "renombrar" && <p className="text-xs text-slate-500">Los productos y las cuentas de esta categoria se pasan solos al nombre nuevo.</p>}
              {accion.tipo === "nueva" && <p className="text-xs text-slate-500">Se crean solas sus cuentas: Ingresos por Venta, Costo de Venta e Inventario de esta categoria.</p>}
              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setAccion(null)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={guardando}>
                  {guardando ? "Guardando..." : "Guardar"}
                </Button>
              </div>
            </form>
          )
        )}
      </Modal>
    </div>
  );
}
