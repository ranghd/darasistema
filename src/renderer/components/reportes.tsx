import { todayIso } from "../lib/format";
import { Button } from "./ui";

// Piezas que comparten los reportes: rango de fechas, pestanas y botones de Excel / imprimir.

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function rangoDe(preset: string): { desde: string; hasta: string } {
  const hoy = new Date(`${todayIso()}T12:00:00`);
  const y = hoy.getFullYear();
  const m = hoy.getMonth();
  switch (preset) {
    case "HOY":
      return { desde: iso(hoy), hasta: iso(hoy) };
    case "SEMANA": {
      const lunes = new Date(hoy);
      lunes.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7));
      return { desde: iso(lunes), hasta: iso(hoy) };
    }
    case "MES_PASADO":
      return { desde: iso(new Date(y, m - 1, 1)), hasta: iso(new Date(y, m, 0)) };
    case "ANO":
      return { desde: `${y}-01-01`, hasta: iso(hoy) };
    default:
      return { desde: iso(new Date(y, m, 1)), hasta: iso(hoy) };
  }
}

const PRESETS: [string, string][] = [
  ["HOY", "Hoy"],
  ["SEMANA", "Esta semana"],
  ["MES", "Este mes"],
  ["MES_PASADO", "Mes pasado"],
  ["ANO", "Este año"],
];

export function RangoFechas({ desde, hasta, onChange }: { desde: string; hasta: string; onChange: (r: { desde: string; hasta: string }) => void }) {
  const activo = PRESETS.find(([k]) => {
    const r = rangoDe(k);
    return r.desde === desde && r.hasta === hasta;
  })?.[0];
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex flex-wrap gap-1">
        {PRESETS.map(([k, t]) => (
          <button
            key={k}
            type="button"
            onClick={() => onChange(rangoDe(k))}
            className={`rounded-lg px-3 py-2 text-xs font-medium ${activo === k ? "bg-brand-600 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"}`}
          >
            {t}
          </button>
        ))}
      </div>
      <label className="text-xs text-slate-500">
        Desde
        <input type="date" value={desde} max={hasta} onChange={(e) => onChange({ desde: e.target.value, hasta })} className="ml-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
      </label>
      <label className="text-xs text-slate-500">
        Hasta
        <input type="date" value={hasta} min={desde} onChange={(e) => onChange({ desde, hasta: e.target.value })} className="ml-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
      </label>
    </div>
  );
}

export function Pestanas<T extends string>({ opciones, valor, onChange }: { opciones: [T, string][]; valor: T; onChange: (v: T) => void }) {
  return (
    <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
      {opciones.map(([k, t]) => (
        <button
          key={k}
          type="button"
          onClick={() => onChange(k)}
          className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${valor === k ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

export function BotonesExportar({ onExcel, onImprimir, deshabilitado }: { onExcel: () => void; onImprimir: () => void; deshabilitado?: boolean }) {
  return (
    <>
      <Button type="button" variant="secondary" className="bg-white ring-1 ring-slate-200" onClick={onExcel} disabled={deshabilitado} title="Descarga un archivo que se abre en Excel">
        Descargar Excel
      </Button>
      <Button type="button" variant="secondary" className="bg-white ring-1 ring-slate-200" onClick={onImprimir} disabled={deshabilitado}>
        Imprimir
      </Button>
    </>
  );
}

export function tonoDias(dias: number): "red" | "amber" | "slate" {
  return dias > 60 ? "red" : dias > 30 ? "amber" : "slate";
}
