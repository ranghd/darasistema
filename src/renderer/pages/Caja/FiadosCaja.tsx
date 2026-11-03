import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, mensajeDeError } from "../../lib/api";
import { useCaja } from "../../lib/caja";
import { formatDate, formatMoney, todayIso } from "../../lib/format";
import type { Cliente } from "../../lib/types";
import { Button, Card, Modal, PageHeader } from "../../components/ui";
import { sinAcentos } from "./buscar";

// Fiados (Gas Damian): quien se llevo a credito desde la caja y cuanto debe. Cuando la persona paga,
// se cobra aqui: el dinero entra a la jornada abierta (la caja cuadra) y se aplica a sus facturas
// de la mas vieja a la mas nueva.

interface FacturaPendiente {
  id: number;
  numero: number;
  ncf: string | null;
  fecha: string;
  cliente_id: number;
  cliente_nombre: string;
  total: number;
  cobrado: number;
}

type Metodo = "EFECTIVO" | "TARJETA" | "TRANSFERENCIA";
const METODOS: { valor: Metodo; nombre: string }[] = [
  { valor: "EFECTIVO", nombre: "Efectivo" },
  { valor: "TARJETA", nombre: "Tarjeta" },
  { valor: "TRANSFERENCIA", nombre: "Transferencia" },
];

const r2 = (n: number) => Math.round(n * 100) / 100;

export default function FiadosCaja() {
  const { sesion, recargar } = useCaja();
  const navegar = useNavigate();
  const [facturas, setFacturas] = useState<FacturaPendiente[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [buscar, setBuscar] = useState("");
  const [cobro, setCobro] = useState<{ cliente_id: number; nombre: string; debe: number; monto: string; metodo: Metodo } | null>(null);
  const [error, setError] = useState("");
  const [listo, setListo] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function cargar() {
    const [f, c] = await Promise.all([api.reportes.cuentasPorCobrar() as Promise<FacturaPendiente[]>, api.clientes.listar() as Promise<Cliente[]>]);
    setFacturas(f.filter((x) => x.total - x.cobrado > 0.005));
    setClientes(c);
  }

  useEffect(() => {
    cargar();
    recargar();
  }, []);

  // lo que debe cada persona, con sus facturas de la mas vieja a la mas nueva
  const deudores = useMemo(() => {
    const porCliente = new Map<number, { cliente_id: number; nombre: string; telefono: string; debe: number; facturas: FacturaPendiente[] }>();
    for (const f of facturas) {
      const d = porCliente.get(f.cliente_id) ?? {
        cliente_id: f.cliente_id,
        nombre: f.cliente_nombre,
        telefono: clientes.find((c) => c.id === f.cliente_id)?.telefono ?? "",
        debe: 0,
        facturas: [],
      };
      d.debe = r2(d.debe + f.total - f.cobrado);
      d.facturas.push(f);
      porCliente.set(f.cliente_id, d);
    }
    const q = sinAcentos(buscar.trim());
    return [...porCliente.values()].filter((d) => !q || sinAcentos(`${d.nombre} ${d.telefono}`).includes(q)).sort((a, b) => b.debe - a.debe);
  }, [facturas, clientes, buscar]);

  const valor = Number((cobro?.monto ?? "").replace(",", ".")) || 0;

  async function cobrar(e: React.FormEvent) {
    e.preventDefault();
    if (!cobro || !sesion) return;
    setError("");
    if (!(valor > 0)) return setError("Escribe cuánto está pagando");
    if (valor > cobro.debe + 0.005) return setError(`Debe ${formatMoney(cobro.debe)}: no puede pagar más que eso`);
    setGuardando(true);
    try {
      // se aplica a las facturas de la mas vieja a la mas nueva
      let resta = r2(valor);
      for (const f of facturas.filter((x) => x.cliente_id === cobro.cliente_id).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id - b.id)) {
        if (resta <= 0.005) break;
        const monto = r2(Math.min(resta, f.total - f.cobrado));
        if (monto <= 0) continue;
        await api.cobros.crear({ factura_id: f.id, fecha: todayIso(), monto, metodo: cobro.metodo, caja_sesion_id: sesion.id, nota: "Pago de fiado en la caja" });
        resta = r2(resta - monto);
      }
      setListo(`Listo: ${cobro.nombre} pagó ${formatMoney(valor)}.${valor < cobro.debe ? ` Todavía debe ${formatMoney(cobro.debe - valor)}.` : " Ya no debe nada."}`);
      setCobro(null);
      await cargar();
      await recargar();
    } catch (err) {
      setError(mensajeDeError(err));
      await cargar();
    } finally {
      setGuardando(false);
    }
  }

  const totalFiado = deudores.reduce((s, d) => s + d.debe, 0);

  return (
    <div className="max-w-3xl">
      <PageHeader title="Fiados" subtitle="Quién se llevó fiado y cuánto debe. Cuando pague, cóbrale aquí y el dinero entra a la caja." />

      {listo && <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{listo}</p>}

      {facturas.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <input
            className="w-full max-w-sm rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Buscar por nombre o teléfono..."
            value={buscar}
            onChange={(e) => setBuscar(e.target.value)}
          />
          <span className="ml-auto text-sm text-slate-500">
            Total fiado: <b className="text-amber-700">{formatMoney(totalFiado)}</b>
          </span>
        </div>
      )}

      <div className="space-y-2">
        {deudores.length === 0 && <Card className="p-8 text-center text-slate-400">{facturas.length ? "Nadie coincide con la búsqueda" : "Nadie debe nada ✓"}</Card>}
        {deudores.map((d) => (
          <Card key={d.cliente_id} className="flex flex-wrap items-center gap-4 border-l-4 border-l-amber-500 p-4">
            <span className="min-w-0 flex-1">
              <span className="block text-base font-semibold text-slate-800">{d.nombre}</span>
              <span className="block text-sm text-slate-500">
                {d.facturas.length === 1 ? "1 factura" : `${d.facturas.length} facturas`} · desde el {formatDate(d.facturas[0].fecha)}
                {d.telefono ? ` · Tel. ${d.telefono}` : ""}
              </span>
            </span>
            <span className="text-right">
              <span className="block text-xs text-slate-400">Debe</span>
              <span className="block text-2xl font-bold text-amber-700">{formatMoney(d.debe)}</span>
            </span>
            <Button
              className="!bg-emerald-600 py-2.5 text-base hover:!bg-emerald-700"
              onClick={() => {
                setError("");
                setListo("");
                setCobro({ cliente_id: d.cliente_id, nombre: d.nombre, debe: d.debe, monto: d.debe.toFixed(2), metodo: "EFECTIVO" });
              }}
            >
              Cobrar
            </Button>
          </Card>
        ))}
      </div>

      <Modal open={!!cobro} onClose={() => setCobro(null)} title={cobro ? `Cobrar a ${cobro.nombre}` : ""}>
        {cobro &&
          (!sesion ? (
            <div className="space-y-3 text-center">
              <p className="text-sm text-slate-600">La caja está cerrada. Para cobrar, primero ábrela.</p>
              <Button onClick={() => navegar("/cierre-caja")}>Ir a Cierre de Caja</Button>
            </div>
          ) : (
            <form onSubmit={cobrar} className="space-y-4">
              <div className="flex items-end justify-between">
                <span className="text-sm text-slate-500">Debe</span>
                <span className="text-3xl font-bold text-amber-700">{formatMoney(cobro.debe)}</span>
              </div>
              <div className="flex gap-1">
                {METODOS.map((m) => (
                  <button
                    key={m.valor}
                    type="button"
                    onClick={() => setCobro({ ...cobro, metodo: m.valor })}
                    className={`flex-1 rounded-lg border px-2 py-2 text-sm font-medium ${cobro.metodo === m.valor ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-500"}`}
                  >
                    {m.nombre}
                  </button>
                ))}
              </div>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-700">¿Cuánto está pagando?</span>
                <input
                  autoFocus
                  onFocus={(e) => e.target.select()}
                  inputMode="decimal"
                  className="w-full rounded-lg border-2 border-brand-300 px-3 py-2 text-2xl font-semibold outline-none focus:border-brand-500"
                  value={cobro.monto}
                  onChange={(e) => setCobro({ ...cobro, monto: e.target.value.replace(/[^0-9.,]/g, "") })}
                />
              </label>
              {valor > 0 && valor < cobro.debe && <p className="text-sm text-slate-500">Paga una parte: queda debiendo {formatMoney(cobro.debe - valor)}.</p>}
              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setCobro(null)}>
                  Volver
                </Button>
                <Button type="submit" disabled={guardando}>
                  {guardando ? "Cobrando..." : `Cobrar ${formatMoney(valor)}`}
                </Button>
              </div>
            </form>
          ))}
      </Modal>
    </div>
  );
}
