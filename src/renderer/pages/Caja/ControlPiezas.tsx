import { useEffect, useMemo, useState } from "react";
import { api, mensajeDeError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useCaja } from "../../lib/caja";
import { formatDate, formatMoney, todayIso } from "../../lib/format";
import type { MercanciaResumen, Pieza, Producto } from "../../lib/types";
import { Button, Card, Input, Modal, PageHeader } from "../../components/ui";
import { sinAcentos } from "./buscar";

// Control de piezas (Dara Frituras, en la caja y en el Admin). Lo que se compra entero (una pierna de salami)
// y se vende por porciones. No se cuentan lonjas: cada pieza lleva lo que costo y cuanto se le quiere ganar,
// las ventas se le suman solas y al terminarse dice si llego a lo esperado o si falta dinero o mercancia.

const numero = (texto: string) => Number(texto.replace(",", "."));
const soloNumeros = (texto: string) => texto.replace(/[^0-9.,]/g, "");
const r2 = (n: number) => Math.round(n * 100) / 100;
const plural = (palabra: string, n: number) => (n === 1 ? palabra : /[aeiou]$/i.test(palabra) ? `${palabra}s` : `${palabra}es`);
const fechaHora = (valor: string | null) => {
  if (!valor) return "";
  const d = new Date(valor.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return valor;
  return `${formatDate(valor.slice(0, 10))} ${d.toLocaleTimeString("es-DO", { hour: "numeric", minute: "2-digit" })}`;
};
const haceDias = (dias: number) => {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

type FormMercancia = { id: number | null; nombre: string; pieza: string; ganancia: string; minima: string; productos: number[]; buscar: string };
type FormCompra = { mercancia: MercanciaResumen; cantidad: string; total: string; ganancia: string; deCaja: boolean };

// Texto del resultado de una pieza, el mismo en la alerta, el historial y al terminarla
// (al terminarla el faltante ya sale grande arriba, asi que no se repite).
export function textoResultado(p: Pieza, conFaltante = true): string {
  if (p.resultado === "OK") return `Bien: se vendió ${formatMoney(p.vendido)} y se esperaba ${formatMoney(p.esperado)}. Ganancia ${p.ganancia_real_pct}%.`;
  const falta = formatMoney(-p.diferencia);
  if (p.resultado === "BAJO") return `Un poco por debajo: faltan ${falta} para lo esperado (${formatMoney(p.esperado)}). Ganancia ${p.ganancia_real_pct}%.`;
  return `${conFaltante ? `Faltan ${falta}: se` : "Se"} esperaba ${formatMoney(p.esperado)} y se vendió ${formatMoney(p.vendido)}. Faltó dinero o mercancía por vender.`;
}

const aOtroPrecio = (n: number) => (n === 1 ? "1 venta a otro precio" : `${n} ventas a otro precio`);

const colorResultado = { OK: "border-l-emerald-500", BAJO: "border-l-amber-500", ALERTA: "border-l-red-500" } as const;
const etiquetaResultado = { OK: "Bien", BAJO: "Un poco bajo", ALERTA: "Falta" } as const;
const tonoResultado = { OK: "bg-emerald-50 text-emerald-700", BAJO: "bg-amber-50 text-amber-700", ALERTA: "bg-red-50 text-red-700" } as const;

export default function ControlPiezas() {
  const { usuario } = useAuth();
  const { sesion, recargar } = useCaja();
  const [mercancias, setMercancias] = useState<MercanciaResumen[]>([]);
  const [historial, setHistorial] = useState<Pieza[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [cargado, setCargado] = useState(false);
  const [formM, setFormM] = useState<FormMercancia | null>(null);
  const [compra, setCompra] = useState<FormCompra | null>(null);
  const [terminar, setTerminar] = useState<MercanciaResumen | null>(null);
  const [terminada, setTerminada] = useState<Pieza | null>(null);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [guardando, setGuardando] = useState(false);

  const autor = { id: usuario?.id ?? null, nombre: usuario?.nombre ?? "", rol: usuario?.rol };

  async function cargar() {
    const [m, h] = await Promise.all([api.piezas.resumen(), api.piezas.historial(haceDias(30), todayIso())]);
    setMercancias(m);
    setHistorial(h);
    setCargado(true);
  }

  useEffect(() => {
    cargar().catch((err) => setError(mensajeDeError(err)));
    api.productos.listar().then((p) => setProductos((p as Producto[]).filter((x) => x.activo)));
  }, []);

  const alertas = useMemo(() => historial.filter((p) => p.resultado === "ALERTA" && p.terminada_en && p.terminada_en.slice(0, 10) >= haceDias(7)), [historial]);

  function abrirMercancia(m?: MercanciaResumen) {
    setError("");
    setFormM(
      m
        ? { id: m.id, nombre: m.nombre, pieza: m.pieza, ganancia: String(m.ganancia_pct), minima: String(m.minima_pct), productos: m.productos.map((p) => p.id), buscar: "" }
        : { id: null, nombre: "", pieza: "", ganancia: "", minima: "", productos: [], buscar: "" }
    );
  }

  async function guardarMercancia(e: React.FormEvent) {
    e.preventDefault();
    if (!formM) return;
    if (!formM.nombre.trim()) return setError("Escribe el nombre, por ejemplo Salami");
    if (!formM.pieza.trim()) return setError("Escribe cómo se le dice a cada pieza, por ejemplo pierna");
    if (formM.ganancia.trim() === "" || !(numero(formM.ganancia) >= 0)) return setError("Escribe cuánto le quieres ganar (%)");
    const minima = formM.minima.trim() === "" ? Math.max(0, numero(formM.ganancia) - 5) : numero(formM.minima);
    if (!Number.isFinite(minima)) return setError("Escribe desde qué ganancia quieres el aviso (%)");
    if (formM.productos.length === 0) return setError("Marca los productos que salen de esta mercancía");
    setGuardando(true);
    setError("");
    try {
      await api.mercancias.guardar({ id: formM.id, nombre: formM.nombre, pieza: formM.pieza, ganancia_pct: numero(formM.ganancia), minima_pct: minima, producto_ids: formM.productos, autor });
      setFormM(null);
      await cargar();
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setGuardando(false);
    }
  }

  async function quitarMercancia(m: MercanciaResumen) {
    setError("");
    try {
      await api.mercancias.quitar({ id: m.id, autor });
      setFormM(null);
      await cargar();
    } catch (err) {
      setError(mensajeDeError(err));
    }
  }

  function abrirCompra(m: MercanciaResumen) {
    setError("");
    setAviso("");
    setCompra({ mercancia: m, cantidad: "1", total: "", ganancia: String(m.ganancia_pct), deCaja: false });
  }

  async function guardarCompra(e: React.FormEvent) {
    e.preventDefault();
    if (!compra) return;
    const cantidad = numero(compra.cantidad);
    const total = r2(numero(compra.total));
    const m = compra.mercancia;
    if (!Number.isInteger(cantidad) || cantidad < 1) return setError(`Escribe cuántas ${plural(m.pieza, 2)} compraste`);
    if (!(total > 0)) return setError("Escribe cuánto pagaste en total");
    if (compra.ganancia.trim() === "" || !(numero(compra.ganancia) >= 0)) return setError("Escribe cuánto le quieres ganar (%)");
    if (compra.deCaja && sesion && total > sesion.resumen.efectivo_esperado + 0.005)
      return setError(`En la caja debería haber ${formatMoney(sesion.resumen.efectivo_esperado)}: no alcanza para sacar ${formatMoney(total)}`);
    setGuardando(true);
    setError("");
    try {
      await api.piezas.comprar({ mercancia_id: m.id, cantidad, costo_total: total, ganancia_pct: numero(compra.ganancia), autor });
      if (compra.deCaja && sesion) {
        try {
          await api.caja.movimiento({ sesion_id: sesion.id, motivo: "GASTO", monto: total, concepto: `Compra: ${cantidad} ${plural(m.pieza, cantidad)} de ${m.nombre}`, autor });
          recargar();
        } catch (err) {
          setAviso(`La compra quedó guardada, pero no se pudo sacar el dinero de la caja: ${mensajeDeError(err)}. Anótalo en Gastos de caja.`);
        }
      }
      setCompra(null);
      await cargar();
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setGuardando(false);
    }
  }

  async function confirmarTerminar() {
    if (!terminar?.abierta) return;
    setGuardando(true);
    setError("");
    try {
      const p = await api.piezas.terminar({ pieza_id: terminar.abierta.id, autor });
      setTerminar(null);
      setTerminada(p);
      await cargar();
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setGuardando(false);
    }
  }

  // Quita la ultima pieza sin abrir (registrada por error).
  async function quitarSinAbrir(m: MercanciaResumen) {
    setError("");
    try {
      await api.piezas.quitar({ mercancia_id: m.id, autor });
      await cargar();
    } catch (err) {
      setError(mensajeDeError(err));
    }
  }

  const productosFiltrados = useMemo(() => {
    if (!formM) return [];
    const q = sinAcentos(formM.buscar.trim());
    return productos.filter((p) => !q || sinAcentos(p.nombre).includes(q)).sort((a, b) => Number(formM.productos.includes(b.id)) - Number(formM.productos.includes(a.id)) || a.nombre.localeCompare(b.nombre));
  }, [productos, formM]);
  const nombreMercancia = (id: number | null | undefined) => mercancias.find((m) => m.id === id)?.nombre;

  const cadaPieza = compra && numero(compra.cantidad) >= 1 && numero(compra.total) > 0 ? r2(numero(compra.total) / Math.floor(numero(compra.cantidad))) : 0;

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Control de piezas"
        subtitle="Lo que compras entero y vendes por porciones. Al terminarse cada pieza se compara lo vendido con lo que esperabas ganar."
        actions={
          <Button className="py-2.5 text-base" onClick={() => abrirMercancia()}>
            + Nueva mercancía
          </Button>
        }
      />

      {error && !formM && !compra && !terminar && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {aviso && <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{aviso}</p>}

      {alertas.length > 0 && (
        <div className="mb-5 space-y-2">
          {alertas.map((p) => (
            <div key={p.id} className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-800">
              <span className="block font-semibold">
                Alerta: {p.mercancia_nombre} ({p.pieza} terminada el {fechaHora(p.terminada_en)})
              </span>
              <span className="block text-sm">{textoResultado(p)}</span>
              {p.precios_cambiados > 0 && <span className="block text-xs">En esta {p.pieza} se {p.precios_cambiados === 1 ? "cobró 1 venta" : `cobraron ${p.precios_cambiados} ventas`} a otro precio.</span>}
            </div>
          ))}
        </div>
      )}

      <div className="space-y-3">
        {cargado && mercancias.length === 0 && (
          <Card className="p-8 text-center text-slate-500">
            <p className="text-base font-medium text-slate-700">Todavía no hay mercancías.</p>
            <p className="mt-1 text-sm">Ejemplo: Salami, cada pieza es una pierna, le quieres ganar 50%, y de ahí sale el salami frito.</p>
            <Button className="mt-4" onClick={() => abrirMercancia()}>
              + Nueva mercancía
            </Button>
          </Card>
        )}
        {mercancias.map((m) => {
          const a = m.abierta;
          const avance = a && a.esperado > 0 ? Math.min(100, (a.vendido / a.esperado) * 100) : 0;
          return (
            <Card key={m.id} className="p-4">
              <div className="flex flex-wrap items-start gap-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-lg font-semibold text-slate-800">{m.nombre}</span>
                  <span className="block text-sm text-slate-500">
                    Le ganas {m.ganancia_pct}% · aviso si baja de {m.minima_pct}% · {m.productos.map((p) => p.nombre).join(", ") || "sin productos"}
                  </span>
                </span>
                <Button variant="secondary" onClick={() => abrirMercancia(m)}>
                  Cambiar
                </Button>
                <Button onClick={() => abrirCompra(m)}>Registrar compra</Button>
              </div>

              {a ? (
                <div className="mt-3 rounded-lg bg-slate-50 p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-medium text-slate-700">
                      {m.pieza[0].toUpperCase() + m.pieza.slice(1)} abierta desde {fechaHora(a.abierta_en)}
                    </span>
                    <span className="text-sm text-slate-500">
                      Costó {formatMoney(a.costo)} · {a.unidades} vendidas
                    </span>
                  </div>
                  <div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-200">
                    <div className={`h-full rounded-full ${a.vendido >= a.esperado ? "bg-emerald-500" : "bg-brand-500"}`} style={{ width: `${avance}%` }} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-base">
                      Llevas <b>{formatMoney(a.vendido)}</b> de <b>{formatMoney(a.esperado)}</b>
                    </span>
                    <Button variant="danger" className="py-2.5 text-base" onClick={() => (setError(""), setTerminar(m))}>
                      Se terminó la {m.pieza}
                    </Button>
                  </div>
                  {a.vendido > a.esperado * 1.5 && (
                    <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      Ya se vendió mucho más de lo esperado. ¿Ya se terminó esta {m.pieza}? Si abriste otra, toca "Se terminó la {m.pieza}" para que la cuenta siga bien.
                    </p>
                  )}
                </div>
              ) : (
                <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  {m.cerradas > 0 ? `No hay ${m.pieza} abierta: la próxima venta abre la siguiente.` : `No hay ${plural(m.pieza, 2)}. Registra la compra para llevar la cuenta.`}
                </p>
              )}

              <div className="mt-2 flex flex-wrap gap-x-4 text-sm text-slate-500">
                <span>
                  {m.cerradas} {plural(m.pieza, m.cerradas)} sin abrir{m.cerradas > 0 ? ` (${formatMoney(m.costo_cerradas)})` : ""}
                </span>
                {m.cerradas > 0 && (
                  <button type="button" className="text-xs font-medium text-red-600 hover:underline" onClick={() => quitarSinAbrir(m)}>
                    Quitar una (registrada por error)
                  </button>
                )}
                {m.sin_pieza > 0 && (
                  <span className="font-medium text-amber-700">
                    Se vendió {formatMoney(m.sin_pieza)} sin {m.pieza} registrada: se le suma a la próxima que compres.
                  </span>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {historial.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-2 text-base font-semibold text-slate-800">Piezas terminadas (últimos 30 días)</h2>
          <div className="space-y-2">
            {historial.map((p) => (
              <Card key={p.id} className={`flex flex-wrap items-center gap-3 border-l-4 px-4 py-3 ${colorResultado[p.resultado]}`}>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-slate-800">
                    {p.mercancia_nombre} · {p.pieza} de {formatMoney(p.costo)}
                  </span>
                  <span className="block text-xs text-slate-500">
                    Abierta {fechaHora(p.abierta_en)} · terminada {fechaHora(p.terminada_en)}
                    {p.terminada_por ? ` por ${p.terminada_por}` : ""} · {p.unidades} vendidas
                    {p.precios_cambiados > 0 ? ` · ${p.precios_cambiados} a otro precio` : ""}
                  </span>
                  <span className="block text-sm text-slate-600">{textoResultado(p)}</span>
                </span>
                <span className={`rounded-full px-3 py-1 text-sm font-semibold ${tonoResultado[p.resultado]}`}>
                  {etiquetaResultado[p.resultado]}
                  {p.resultado !== "OK" ? ` ${formatMoney(-p.diferencia)}` : ""}
                </span>
              </Card>
            ))}
          </div>
        </div>
      )}

      <Modal open={!!formM} onClose={() => setFormM(null)} title={formM?.id ? "Cambiar mercancía" : "Nueva mercancía"} width="max-w-2xl">
        {formM && (
          <form onSubmit={guardarMercancia} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Nombre" autoFocus value={formM.nombre} onChange={(e) => setFormM({ ...formM, nombre: e.target.value })} placeholder="Ej. Salami" />
              <Input label="Cómo se le dice a cada pieza" value={formM.pieza} onChange={(e) => setFormM({ ...formM, pieza: e.target.value })} placeholder="Ej. pierna, libra, paquete" />
              <Input label="Cuánto le quieres ganar (%)" inputMode="decimal" value={formM.ganancia} onChange={(e) => setFormM({ ...formM, ganancia: soloNumeros(e.target.value) })} placeholder="Ej. 50" />
              <Input
                label="Avisar si la ganancia baja de (%)"
                inputMode="decimal"
                value={formM.minima}
                onChange={(e) => setFormM({ ...formM, minima: soloNumeros(e.target.value) })}
                placeholder={formM.ganancia ? `Ej. ${Math.max(0, numero(formM.ganancia) - 5)}` : "Ej. 45"}
              />
            </div>
            <p className="text-xs text-slate-500">El aviso deja un margen para que una porción de más o de menos no dé alerta cada día. Si lo dejas vacío se usa 5 puntos menos.</p>
            <div>
              <span className="mb-1 block text-sm font-medium text-slate-700">Productos que salen de esta mercancía</span>
              <input
                value={formM.buscar}
                onChange={(e) => setFormM({ ...formM, buscar: e.target.value })}
                placeholder="Buscar producto"
                className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200">
                {productosFiltrados.map((p) => {
                  const marcado = formM.productos.includes(p.id);
                  const deOtra = p.mercancia_id && p.mercancia_id !== formM.id ? nombreMercancia(p.mercancia_id) : undefined;
                  return (
                    <label key={p.id} className="flex cursor-pointer items-center gap-3 border-b border-slate-100 px-3 py-2 text-sm last:border-0 hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={marcado}
                        onChange={() => setFormM({ ...formM, productos: marcado ? formM.productos.filter((x) => x !== p.id) : [...formM.productos, p.id] })}
                      />
                      <span className="flex-1">{p.nombre}</span>
                      {deOtra && <span className="text-xs text-amber-700">ahora sale de {deOtra}</span>}
                    </label>
                  );
                })}
                {productosFiltrados.length === 0 && <p className="px-3 py-4 text-center text-sm text-slate-400">No hay productos con ese nombre. Créalo primero en Productos.</p>}
              </div>
              <p className="mt-1 text-xs text-slate-500">Cada venta de estos productos se le suma a la {formM.pieza.trim() || "pieza"} abierta, y ya no se bloquea por existencia.</p>
            </div>
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
            <div className="flex flex-wrap justify-between gap-2 pt-2">
              {formM.id ? (
                <button type="button" className="text-sm font-medium text-red-600 hover:underline" onClick={() => quitarMercancia(mercancias.find((m) => m.id === formM.id)!)}>
                  Dejar de controlar esta mercancía
                </button>
              ) : (
                <span />
              )}
              <span className="flex gap-2">
                <Button type="button" variant="secondary" onClick={() => setFormM(null)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={guardando}>
                  {guardando ? "Guardando..." : "Guardar"}
                </Button>
              </span>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!compra} onClose={() => setCompra(null)} title={compra ? `Compra de ${compra.mercancia.nombre}` : ""}>
        {compra && (
          <form onSubmit={guardarCompra} className="space-y-3">
            <Input
              label={`Cuántas ${plural(compra.mercancia.pieza, 2)} compraste`}
              inputMode="numeric"
              autoFocus
              value={compra.cantidad}
              onChange={(e) => setCompra({ ...compra, cantidad: e.target.value.replace(/[^0-9]/g, "") })}
            />
            <Input label="Cuánto pagaste en total (RD$)" inputMode="decimal" value={compra.total} onChange={(e) => setCompra({ ...compra, total: soloNumeros(e.target.value) })} placeholder="Ej. 500" />
            <Input label="Cuánto le quieres ganar (%)" inputMode="decimal" value={compra.ganancia} onChange={(e) => setCompra({ ...compra, ganancia: soloNumeros(e.target.value) })} />
            {cadaPieza > 0 && (
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                Cada {compra.mercancia.pieza} cuesta {formatMoney(cadaPieza)} y debe dejar {formatMoney(r2(cadaPieza * (1 + numero(compra.ganancia || "0") / 100)))} en ventas.
              </p>
            )}
            {sesion ? (
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={compra.deCaja} onChange={(e) => setCompra({ ...compra, deCaja: e.target.checked })} />
                La pagué con dinero de la caja (se anota como gasto de caja)
              </label>
            ) : null}
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setCompra(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={guardando}>
                {guardando ? "Guardando..." : "Guardar compra"}
              </Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!terminar} onClose={() => setTerminar(null)} title={terminar ? `¿Se terminó la ${terminar.pieza} de ${terminar.nombre}?` : ""}>
        {terminar?.abierta && (
          <div className="space-y-3">
            <p className="text-base text-slate-700">
              Se cierra con lo vendido hasta ahora: <b>{formatMoney(terminar.abierta.vendido)}</b> de <b>{formatMoney(terminar.abierta.esperado)}</b> esperados.
            </p>
            <p className="text-sm text-slate-500">La próxima venta de {terminar.nombre} abre la siguiente {terminar.pieza}.</p>
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setTerminar(null)}>
                Todavía no
              </Button>
              <Button variant="danger" disabled={guardando} onClick={confirmarTerminar}>
                {guardando ? "Guardando..." : "Sí, se terminó"}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!terminada} onClose={() => setTerminada(null)} title={terminada ? `${terminada.mercancia_nombre}: ${terminada.pieza} terminada` : ""}>
        {terminada && (
          <div className="space-y-3">
            <div className={`rounded-xl px-4 py-4 ${tonoResultado[terminada.resultado]}`}>
              <span className="block text-2xl font-bold">
                {terminada.resultado === "OK" ? "Todo bien" : terminada.resultado === "BAJO" ? "Un poco por debajo" : `Faltan ${formatMoney(-terminada.diferencia)}`}
              </span>
              <span className="mt-1 block text-base">{textoResultado(terminada, false)}</span>
            </div>
            <p className="text-sm text-slate-600">
              Costó {formatMoney(terminada.costo)} · se vendieron {terminada.unidades} · ganancia esperada {terminada.ganancia_pct}%
              {terminada.precios_cambiados > 0 ? ` · ${aOtroPrecio(terminada.precios_cambiados)}` : ""}
            </p>
            <div className="flex justify-end">
              <Button onClick={() => setTerminada(null)}>Entendido</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
