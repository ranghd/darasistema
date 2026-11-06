import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { descargarCsv } from "../../lib/exportar";
import { formatDate, formatMoney, todayIso } from "../../lib/format";
import type { CambioPlato, ReportePlato } from "../../lib/types";
import { Button, Card, EmptyRow, Input, PageHeader, StatCard, Table } from "../../components/ui";

// Dara Frituras: por dia y plato, porciones preparadas, vendidas y sobrantes, el dinero que dejo y quien cambio el menu.

const ACCIONES: Record<string, string> = {
  AGREGAR_PLATO_DIA: "Agrego",
  CAMBIAR_PLATO_DIA: "Cambio",
  QUITAR_PLATO_DIA: "Quito",
  COPIAR_MENU_DIA: "Copio el menu",
};

function detalleDe(c: CambioPlato): string {
  try {
    const d = JSON.parse(c.detalle ?? "{}");
    if (c.accion === "COPIAR_MENU_DIA") return `${d.platos} platos del ${formatDate(d.desde)}`;
    const porciones = d.porciones_antes !== null && d.porciones !== undefined ? `${d.porciones_antes} → ${d.porciones} porciones` : d.porciones !== undefined ? `${d.porciones} porciones` : "";
    return [d.plato, porciones, d.precio_final ? formatMoney(d.precio_final) : ""].filter(Boolean).join(" · ");
  } catch {
    return "";
  }
}

export default function ReportePlatos() {
  const [desde, setDesde] = useState(todayIso().slice(0, 7) + "-01");
  const [hasta, setHasta] = useState(todayIso());
  const [filas, setFilas] = useState<ReportePlato[]>([]);
  const [cambios, setCambios] = useState<CambioPlato[]>([]);

  useEffect(() => {
    api.platos.reporte(desde, hasta).then(setFilas);
    api.platos.cambios(desde, hasta).then(setCambios);
  }, [desde, hasta]);

  const suma = (campo: "porciones" | "vendidas" | "sobrantes" | "dinero") => filas.reduce((s, f) => s + f[campo], 0);

  function exportar() {
    descargarCsv(
      `platos-del-dia-${desde}-a-${hasta}.csv`,
      ["Fecha", "Plato", "Preparadas", "Vendidas", "Sobrantes", "Dinero"],
      filas.map((f) => [formatDate(f.fecha), f.nombre, f.porciones, f.vendidas, f.sobrantes, f.dinero.toFixed(2)])
    );
  }

  return (
    <div>
      <PageHeader
        title="Reporte de platos del dia"
        subtitle="Cuanto se preparo, cuanto se vendio, cuanto sobro y cuanto dinero dejo cada plato"
        actions={
          <Button variant="secondary" size="sm" onClick={exportar} disabled={!filas.length}>
            Excel
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-40">
          <Input label="Desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </div>
        <div className="w-40">
          <Input label="Hasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-4">
        <StatCard label="Porciones preparadas" value={String(suma("porciones"))} />
        <StatCard label="Vendidas" value={String(suma("vendidas"))} />
        <StatCard label="Sobraron" value={String(suma("sobrantes"))} tone="amber" />
        <StatCard label="Dinero" value={formatMoney(suma("dinero"))} tone="green" />
      </div>

      <Card className="p-0">
        <Table columns={["Fecha", "Plato", "Preparadas", "Vendidas", "Sobrantes", "Dinero"]}>
          {filas.length === 0 && <EmptyRow colSpan={6} label="No hay platos del dia en estas fechas" />}
          {filas.map((f) => (
            <tr key={`${f.fecha}-${f.producto_id}`}>
              <td className="px-4 py-2">{formatDate(f.fecha)}</td>
              <td className="px-4 py-2">{f.nombre}</td>
              <td className="px-4 py-2 text-right">{f.porciones}</td>
              <td className="px-4 py-2 text-right">{f.vendidas}</td>
              <td className={`px-4 py-2 text-right ${f.sobrantes > 0 ? "text-amber-700" : ""}`}>{f.sobrantes}</td>
              <td className="px-4 py-2 text-right font-medium">{formatMoney(f.dinero)}</td>
            </tr>
          ))}
        </Table>
      </Card>

      <h2 className="mb-2 mt-8 text-sm font-semibold text-slate-700">Quien cambio el menu</h2>
      <Card className="p-0">
        <Table columns={["Fecha y hora", "Usuario", "Que hizo", "Detalle"]}>
          {cambios.length === 0 && <EmptyRow colSpan={4} label="Sin cambios en estas fechas" />}
          {cambios.map((c) => (
            <tr key={c.id}>
              <td className="px-4 py-2 text-slate-500">
                {formatDate(c.fecha.slice(0, 10))} {c.fecha.slice(11, 16)}
              </td>
              <td className="px-4 py-2">{c.usuario_nombre}</td>
              <td className="px-4 py-2">{ACCIONES[c.accion] ?? c.accion}</td>
              <td className="px-4 py-2 text-slate-600">{detalleDe(c)}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
