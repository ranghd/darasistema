import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, mensajeDeError } from "../../lib/api";
import { useCaja } from "../../lib/caja";
import { formatMoney } from "../../lib/format";
import type { MovimientoCaja } from "../../lib/types";
import { Button, Card, PageHeader } from "../../components/ui";

// Gastos de caja (Gas Damian): cuando se saca dinero de la gaveta para algo del negocio
// (una goma pinchada, combustible, comida...), se anota aqui para que la caja cuadre al cerrar.
// Es una salida de efectivo "Gasto menor" de la jornada abierta: baja lo que deberia haber en la gaveta
// y queda en la contabilidad como gasto.

const RAZONES = ["Goma / gomero", "Combustible", "Comida", "Transporte", "Reparación", "Limpieza", "Otro"];

export default function GastosCaja() {
  const { caja, sesion, cargando, recargar, autor } = useCaja();
  const navegar = useNavigate();
  const [movimientos, setMovimientos] = useState<MovimientoCaja[]>([]);
  const [razon, setRazon] = useState("");
  const [monto, setMonto] = useState("");
  const [detalle, setDetalle] = useState("");
  const [error, setError] = useState("");
  const [listo, setListo] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function cargar() {
    const s = await recargar();
    setMovimientos(s ? await api.caja.movimientos(s.id) : []);
  }

  useEffect(() => {
    cargar();
  }, []);

  const gastos = movimientos.filter((m) => m.motivo === "GASTO");
  const totalGastos = gastos.reduce((s, m) => s + m.monto, 0);
  const valor = Number(monto.replace(",", ".")) || 0;

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!sesion) return;
    setError("");
    setListo("");
    if (!razon) return setError("Toca para qué fue el dinero");
    if (!(valor > 0)) return setError("Escribe cuánto dinero sacaste");
    setGuardando(true);
    try {
      const concepto = detalle.trim() ? `${razon}: ${detalle.trim()}` : razon;
      await api.caja.movimiento({
        sesion_id: sesion.id,
        motivo: "GASTO",
        monto: valor,
        concepto,
        autor: autor(),
      });
      setListo(`Listo: se anotó ${formatMoney(valor)} de ${razon.toLowerCase()}.`);
      setRazon("");
      setMonto("");
      setDetalle("");
      await cargar();
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <PageHeader title="Gastos de caja" subtitle="Si sacas dinero de la caja para algo del negocio, anótalo aquí para que la caja cuadre." />

      {cargando && !sesion && <p className="text-sm text-slate-400">Cargando...</p>}

      {!cargando && !sesion && (
        <Card className="p-6 text-center">
          <p className="text-lg font-semibold text-slate-800">{caja ? `${caja.nombre} está cerrada` : "No hay caja abierta"}</p>
          <p className="mt-1 text-sm text-slate-500">Para anotar un gasto, primero abre la caja.</p>
          <Button className="mt-4 py-2.5 text-base" onClick={() => navegar("/cierre-caja")}>
            Ir a Cierre de Caja
          </Button>
        </Card>
      )}

      {sesion && (
        <div className="space-y-5">
          <Card className="flex items-center justify-between gap-4 p-5">
            <span>
              <span className="block text-sm text-slate-500">Debería haber en la gaveta</span>
              <span className="block text-3xl font-bold text-slate-900">{formatMoney(sesion.resumen.efectivo_esperado)}</span>
            </span>
            {gastos.length > 0 && (
              <span className="text-right">
                <span className="block text-sm text-slate-500">Gastos de hoy</span>
                <span className="block text-2xl font-bold text-red-600">-{formatMoney(totalGastos)}</span>
              </span>
            )}
          </Card>

          <Card className="p-5">
            <form onSubmit={guardar} className="space-y-4">
              <div>
                <p className="mb-2 text-base font-semibold text-slate-800">1. ¿Para qué fue el dinero?</p>
                <div className="flex flex-wrap gap-2">
                  {RAZONES.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRazon(r)}
                      className={`rounded-full border-2 px-5 py-2.5 text-base font-semibold transition ${
                        razon === r ? "border-brand-600 bg-brand-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-400"
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              <label className="block">
                <span className="mb-2 block text-base font-semibold text-slate-800">2. ¿Cuánto sacaste?</span>
                <span className="flex items-center rounded-xl border-2 border-slate-300 px-4 focus-within:border-brand-500">
                  <span className="text-2xl font-semibold text-slate-400">RD$</span>
                  <input
                    className="w-full bg-transparent px-3 py-3 text-3xl font-bold text-slate-900 outline-none"
                    inputMode="decimal"
                    placeholder="0"
                    value={monto}
                    onChange={(e) => setMonto(e.target.value.replace(/[^0-9.,]/g, ""))}
                  />
                </span>
              </label>

              <label className="block">
                <span className="mb-2 block text-base font-semibold text-slate-800">
                  3. Detalle <span className="font-normal text-slate-400">(si quiere)</span>
                </span>
                <input
                  className="w-full rounded-xl border-2 border-slate-300 px-4 py-3 text-base outline-none focus:border-brand-500"
                  placeholder="Ej. goma pinchada del camión"
                  value={detalle}
                  onChange={(e) => setDetalle(e.target.value)}
                />
              </label>

              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
              {listo && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{listo}</p>}

              <button
                type="submit"
                disabled={guardando}
                className="w-full rounded-xl bg-red-600 py-4 text-xl font-bold text-white shadow-sm transition hover:bg-red-700 disabled:opacity-60"
              >
                {guardando ? "Guardando..." : valor > 0 ? `Anotar gasto de ${formatMoney(valor)}` : "Anotar gasto"}
              </button>
            </form>
          </Card>

          <div>
            <h2 className="mb-2 text-base font-semibold text-slate-800">Gastos de esta caja</h2>
            {gastos.length === 0 ? (
              <Card className="p-6 text-center text-slate-400">Todavía no se ha sacado dinero para gastos hoy</Card>
            ) : (
              <div className="space-y-2">
                {gastos.map((m) => (
                  <Card key={m.id} className="flex items-center gap-4 border-l-4 border-l-red-500 p-4">
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-slate-800">{m.concepto || "Gasto"}</span>
                      <span className="block text-sm text-slate-500">
                        {m.creado_en.slice(11, 16)} · {m.usuario_nombre}
                      </span>
                    </span>
                    <span className="text-xl font-bold text-red-600">-{formatMoney(m.monto)}</span>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
