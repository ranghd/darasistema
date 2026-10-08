import { Link } from "react-router-dom";
import { useCaja } from "../lib/caja";

// Aviso cuando la caja de esta computadora esta cerrada (no se puede cobrar).
export default function CajaCerradaAviso({ mensaje }: { mensaje?: string }) {
  const { sesion, caja, cargando, usaCaja } = useCaja();
  if (!usaCaja || cargando || sesion) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
      <span>{mensaje ?? `${caja?.nombre ?? "La caja"} esta cerrada. Para cobrar hay que abrir la caja del dia.`}</span>
      <Link to="/cierre-caja" className="ml-auto rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700">
        Abrir caja
      </Link>
    </div>
  );
}
