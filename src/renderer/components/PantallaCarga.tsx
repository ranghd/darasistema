import Logo from "./Logo";
import { EDICION } from "../lib/variant";

// Pantalla de espera de la caja de Gas Damian (al abrir: revisa actualizaciones y entra sola).
export default function PantallaCarga({ texto, porcentaje }: { texto: string; porcentaje?: number }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-100">
      <div className="flex w-full max-w-sm flex-col items-center rounded-2xl border border-slate-200 bg-white px-8 py-10 text-center shadow-sm">
        <Logo size={96} className="shadow-sm ring-1 ring-slate-200" />
        <p className="mt-4 text-xl font-semibold text-slate-900">{EDICION.nombre}</p>
        <p className="mt-1 text-sm text-slate-500">{texto}</p>
        <div className="relative mt-6 h-2 w-56 overflow-hidden rounded-full bg-slate-200">
          {porcentaje === undefined ? (
            <span className="absolute inset-y-0 w-2/5 animate-[cargar_1.2s_ease-in-out_infinite] rounded-full bg-brand-600" />
          ) : (
            <span className="absolute inset-y-0 left-0 rounded-full bg-brand-600 transition-all" style={{ width: `${Math.max(4, porcentaje)}%` }} />
          )}
        </div>
        {porcentaje !== undefined && <p className="mt-2 text-sm font-medium text-slate-600">{porcentaje}%</p>}
      </div>
    </div>
  );
}
