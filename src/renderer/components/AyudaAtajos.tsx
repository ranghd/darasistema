import { useLocation } from "react-router-dom";
import { ATAJOS_CAJA, ATAJOS_GENERALES, type Atajo } from "../lib/atajos";
import { Modal } from "./ui";

function Lista({ titulo, atajos }: { titulo: string; atajos: Atajo[] }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase text-slate-400">{titulo}</p>
      <div className="space-y-1.5">
        {atajos.map((a) => (
          <div key={a.teclas} className="flex items-start gap-3 text-sm">
            <kbd className="w-40 shrink-0 rounded-md border border-slate-300 bg-slate-50 px-2 py-0.5 text-center font-mono text-xs text-slate-700">{a.teclas}</kbd>
            <span className="text-slate-700">{a.accion}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// F1 o "?": muestra los atajos de teclado (los generales y los de la pantalla actual).
export default function AyudaAtajos({ abierta, onCerrar }: { abierta: boolean; onCerrar: () => void }) {
  const { pathname } = useLocation();
  return (
    <Modal open={abierta} onClose={onCerrar} title="Atajos de teclado" width="max-w-2xl">
      <div className="space-y-5">
        {pathname === "/caja" && <Lista titulo="Punto de venta" atajos={ATAJOS_CAJA} />}
        <Lista titulo="En todo el sistema" atajos={ATAJOS_GENERALES} />
        {pathname !== "/caja" && (
          <p className="text-xs text-slate-500">En el Punto de venta hay mas atajos: entra ahi y presiona F1.</p>
        )}
      </div>
    </Modal>
  );
}
