import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import type { Cuenta, MovimientoMayor, SaldoCuenta, TipoCuenta } from "../../lib/types";
import { firstDayOfMonthIso, formatDate, formatMoney, todayIso } from "../../lib/format";
import { Badge, Button, Input, Modal, PageHeader, Select, Table } from "../../components/ui";

const TIPOS: { value: TipoCuenta; label: string; tone: "blue" | "red" | "green" | "amber" | "slate"; ayuda: string }[] = [
  { value: "ACTIVO", label: "Activo", tone: "blue", ayuda: "Lo que la empresa tiene" },
  { value: "PASIVO", label: "Pasivo", tone: "red", ayuda: "Lo que la empresa debe" },
  { value: "PATRIMONIO", label: "Patrimonio", tone: "green", ayuda: "Lo que es del dueno" },
  { value: "INGRESOS", label: "Ingresos", tone: "green", ayuda: "Lo que se ha vendido" },
  { value: "COSTOS", label: "Costos", tone: "amber", ayuda: "Lo que costo lo vendido" },
  { value: "GASTOS", label: "Gastos", tone: "amber", ayuda: "Lo que se paga para operar" },
];

type Periodo = "TODO" | "HOY" | "MES" | "RANGO";

interface Totales {
  debito: number;
  credito: number;
  movimientos: number;
  ultima_fecha: string | null;
}

const VACIO: Totales = { debito: 0, credito: 0, movimientos: 0, ultima_fecha: null };

// Saldo segun la naturaleza: las deudoras crecen con el debito, las acreedoras con el credito.
function saldoDe(cuenta: Pick<Cuenta, "naturaleza">, t: Pick<Totales, "debito" | "credito">): number {
  return cuenta.naturaleza === "DEUDORA" ? t.debito - t.credito : t.credito - t.debito;
}

function nivel(codigo: string): number {
  return codigo.split(".").length - 1;
}

export default function CatalogoCuentas() {
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [saldos, setSaldos] = useState<SaldoCuenta[]>([]);
  const [periodo, setPeriodo] = useState<Periodo>("TODO");
  const [desde, setDesde] = useState(firstDayOfMonthIso());
  const [hasta, setHasta] = useState(todayIso());
  const [soloConMovimiento, setSoloConMovimiento] = useState(false);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ codigo: "", nombre: "", tipo: "ACTIVO" as TipoCuenta, padre_id: "", naturaleza: "DEUDORA" as "DEUDORA" | "ACREEDORA" });
  const [guardando, setGuardando] = useState(false);

  const [cuentaDetalle, setCuentaDetalle] = useState<Cuenta | null>(null);
  const [movimientos, setMovimientos] = useState<MovimientoMayor[] | null>(null);

  const rango = useMemo((): [string | undefined, string | undefined] => {
    if (periodo === "HOY") return [todayIso(), todayIso()];
    if (periodo === "MES") return [firstDayOfMonthIso(), todayIso()];
    if (periodo === "RANGO") return [desde || undefined, hasta || undefined];
    return [undefined, undefined];
  }, [periodo, desde, hasta]);

  async function cargar() {
    const [c, s] = await Promise.all([api.cuentas.listar(), api.cuentas.saldos(rango[0], rango[1])]);
    setCuentas(c);
    setSaldos(s);
  }

  useEffect(() => {
    cargar();
  }, [rango]);

  // Totales de cada cuenta; las cuentas de grupo suman todo lo que tienen debajo.
  const totales = useMemo(() => {
    const porId = new Map<number, Totales>();
    for (const s of saldos) porId.set(s.cuenta_id, { debito: s.debito, credito: s.credito, movimientos: s.movimientos, ultima_fecha: s.ultima_fecha });
    const hijos = new Map<number, Cuenta[]>();
    for (const c of cuentas) {
      if (c.padre_id) hijos.set(c.padre_id, [...(hijos.get(c.padre_id) ?? []), c]);
    }
    const memo = new Map<number, Totales>();
    const calcular = (c: Cuenta): Totales => {
      const hit = memo.get(c.id);
      if (hit) return hit;
      const propio = porId.get(c.id) ?? VACIO;
      const t = (hijos.get(c.id) ?? []).map(calcular).reduce(
        (acc, h) => ({
          debito: acc.debito + h.debito,
          credito: acc.credito + h.credito,
          movimientos: acc.movimientos + h.movimientos,
          ultima_fecha: !acc.ultima_fecha || (h.ultima_fecha && h.ultima_fecha > acc.ultima_fecha) ? h.ultima_fecha ?? acc.ultima_fecha : acc.ultima_fecha,
        }),
        propio
      );
      memo.set(c.id, t);
      return t;
    };
    cuentas.forEach(calcular);
    return memo;
  }, [cuentas, saldos]);

  async function verMovimientos(c: Cuenta) {
    setCuentaDetalle(c);
    setMovimientos(null);
    const m = await api.asientos.libroMayor(c.id, rango[0], rango[1]);
    setMovimientos(m);
  }

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

  const hoy = todayIso();
  const textoPeriodo =
    periodo === "TODO" ? "desde el inicio" : periodo === "HOY" ? "de hoy" : periodo === "MES" ? "de este mes" : `del ${formatDate(rango[0])} al ${formatDate(rango[1])}`;

  // Movimientos del detalle: el mas reciente primero y con el saldo segun la naturaleza de la cuenta.
  const movimientosOrdenados = useMemo(() => {
    if (!movimientos || !cuentaDetalle) return [];
    const signo = cuentaDetalle.naturaleza === "DEUDORA" ? 1 : -1;
    return [...movimientos].reverse().map((m) => ({ ...m, saldo: m.saldo * signo }));
  }, [movimientos, cuentaDetalle]);

  return (
    <div>
      <PageHeader
        title="Catalogo de Cuentas"
        subtitle="Cuanto hay en cada cuenta. Se actualiza solo con cada factura, cobro, compra y devolucion de envase."
        actions={<Button onClick={() => setOpen(true)}>+ Nueva Subcuenta</Button>}
      />

      <div className="mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex gap-1">
          {(
            [
              ["TODO", "Todo"],
              ["HOY", "Hoy"],
              ["MES", "Este mes"],
              ["RANGO", "Entre fechas"],
            ] as [Periodo, string][]
          ).map(([valor, etiqueta]) => (
            <button
              key={valor}
              type="button"
              onClick={() => setPeriodo(valor)}
              className={`rounded-lg px-3 py-1.5 text-sm ${periodo === valor ? "bg-brand-600 font-medium text-white" : "text-slate-600 hover:bg-slate-100"}`}
            >
              {etiqueta}
            </button>
          ))}
        </div>
        {periodo === "RANGO" && (
          <>
            <div className="w-40">
              <Input label="Desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
            </div>
            <div className="w-40">
              <Input label="Hasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
            </div>
          </>
        )}
        <label className="ml-auto flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={soloConMovimiento} onChange={(e) => setSoloConMovimiento(e.target.checked)} />
          Solo cuentas con movimientos
        </label>
      </div>

      {TIPOS.map((t) => {
        const grupo = cuentas.filter((c) => c.tipo === t.value && (!soloConMovimiento || (totales.get(c.id)?.movimientos ?? 0) > 0));
        if (grupo.length === 0) return null;
        const raices = cuentas.filter((c) => c.tipo === t.value && !c.padre_id);
        const totalCategoria = raices.reduce((s, c) => s + saldoDe(c, totales.get(c.id) ?? VACIO), 0);
        return (
          <div key={t.value} className="mb-6">
            <div className="mb-2 flex items-center gap-2">
              <Badge tone={t.tone}>{t.label}</Badge>
              <span className="text-xs text-slate-400">{t.ayuda}</span>
              <span className="ml-auto text-sm text-slate-500">
                Saldo {textoPeriodo}: <span className="font-semibold text-slate-900">{formatMoney(totalCategoria)}</span>
              </span>
            </div>
            <Table columns={["Codigo", "Nombre", "Debitos", "Creditos", "Saldo", "Ultimo movimiento", ""]}>
              {grupo.map((c) => {
                const tot = totales.get(c.id) ?? VACIO;
                const saldo = saldoDe(c, tot);
                const esHoy = tot.ultima_fecha === hoy;
                return (
                  <tr
                    key={c.id}
                    onClick={c.es_movimiento ? () => verMovimientos(c) : undefined}
                    className={c.es_movimiento ? "cursor-pointer hover:bg-brand-50/50" : "bg-slate-50 font-semibold"}
                  >
                    <td className="px-4 py-2 font-mono text-xs text-slate-500">{c.codigo}</td>
                    <td className="px-4 py-2 text-slate-800" style={{ paddingLeft: `${1 + nivel(c.codigo) * 1.1}rem` }}>
                      {c.nombre}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-500">{tot.debito ? formatMoney(tot.debito) : "-"}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-500">{tot.credito ? formatMoney(tot.credito) : "-"}</td>
                    <td className={`px-4 py-2 text-right tabular-nums ${saldo < 0 ? "text-red-600" : "text-slate-900"} ${c.es_movimiento ? "font-medium" : ""}`}>
                      {tot.movimientos ? formatMoney(saldo) : "-"}
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-500">
                      {esHoy ? <Badge tone="green">Hoy</Badge> : tot.ultima_fecha ? formatDate(tot.ultima_fecha) : ""}
                    </td>
                    <td className="px-4 py-2 text-right text-xs text-brand-600">{c.es_movimiento && tot.movimientos ? `Ver ${tot.movimientos} mov.` : ""}</td>
                  </tr>
                );
              })}
            </Table>
          </div>
        );
      })}

      <Modal
        open={!!cuentaDetalle}
        onClose={() => setCuentaDetalle(null)}
        title={cuentaDetalle ? `${cuentaDetalle.codigo} - ${cuentaDetalle.nombre}` : ""}
        width="max-w-4xl"
      >
        {cuentaDetalle && (
          <div>
            <div className="mb-3 flex flex-wrap gap-4 text-sm text-slate-600">
              <span>Movimientos {textoPeriodo}</span>
              <span>
                Saldo: <b className="text-slate-900">{formatMoney(saldoDe(cuentaDetalle, totales.get(cuentaDetalle.id) ?? VACIO))}</b>
              </span>
              <span className="text-xs text-slate-400">
                Cuenta {cuentaDetalle.naturaleza === "DEUDORA" ? "deudora: sube con el debito" : "acreedora: sube con el credito"}
              </span>
            </div>
            {movimientos === null ? (
              <p className="text-sm text-slate-400">Cargando...</p>
            ) : movimientosOrdenados.length === 0 ? (
              <p className="text-sm text-slate-400">Esta cuenta no tiene movimientos {textoPeriodo}.</p>
            ) : (
              <Table columns={["Fecha", "Asiento", "Concepto", "Debito", "Credito", "Saldo"]}>
                {movimientosOrdenados.map((m, i) => (
                  <tr key={`${m.numero}-${i}`}>
                    <td className="whitespace-nowrap px-4 py-2 text-xs text-slate-500">{formatDate(m.fecha)}</td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-500">#{m.numero}</td>
                    <td className="px-4 py-2 text-slate-700">{m.descripcion || m.concepto}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{m.debito ? formatMoney(m.debito) : ""}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{m.credito ? formatMoney(m.credito) : ""}</td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums">{formatMoney(m.saldo)}</td>
                  </tr>
                ))}
              </Table>
            )}
          </div>
        )}
      </Modal>

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
