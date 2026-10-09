import { useEffect, useState } from "react";
import { api, mensajeDeError } from "../lib/api";
import { useCaja } from "../lib/caja";
import { hayModalAbierto } from "../lib/atajos";
import { Button, Modal } from "./ui";

// Aviso cuando la caja de esta computadora esta cerrada (no se puede cobrar).
// F9 o Ctrl+O abre la caja ahi mismo, sin ir a otra pantalla.
export default function CajaCerradaAviso({ mensaje }: { mensaje?: string }) {
  const { sesion, caja, cajaId, cargando, usaCaja, recargar, autor } = useCaja();
  const [abriendo, setAbriendo] = useState(false);
  const [monto, setMonto] = useState("");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const visible = usaCaja && !cargando && !sesion;

  useEffect(() => {
    if (!visible) return;
    const alPresionar = (e: KeyboardEvent) => {
      if (hayModalAbierto()) return;
      if (e.key === "F9" || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o")) {
        e.preventDefault();
        abrirVentana();
      }
    };
    window.addEventListener("keydown", alPresionar);
    return () => window.removeEventListener("keydown", alPresionar);
  }, [visible]);

  function abrirVentana() {
    setMonto("");
    setError("");
    setAbriendo(true);
  }

  async function abrirCaja(e: React.FormEvent) {
    e.preventDefault();
    if (!cajaId) return setError("No hay ninguna caja activa. Un administrador debe crear una.");
    setGuardando(true);
    setError("");
    try {
      await api.caja.abrir({ caja_id: cajaId, monto_inicial: Number(monto.replace(",", ".") || 0), autor: autor() });
      setAbriendo(false);
      await recargar();
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setGuardando(false);
    }
  }

  if (!visible) return null;
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
        <span>{mensaje ?? `${caja?.nombre ?? "La caja"} esta cerrada. Para cobrar hay que abrir la caja del dia.`}</span>
        <button type="button" onClick={abrirVentana} className="ml-auto rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700">
          Abrir caja <kbd className="ml-1 rounded border border-white/40 px-1 font-mono text-[10px]">F9 · CtrlO</kbd>
        </button>
      </div>
      <Modal open={abriendo} onClose={() => setAbriendo(false)} title={`Abrir ${caja?.nombre ?? "caja"}`}>
        <form onSubmit={abrirCaja} className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Monto inicial en la gaveta (RD$)</span>
            <input
              autoFocus
              inputMode="decimal"
              className="w-full rounded-lg border-2 border-brand-300 px-3 py-2 text-2xl font-semibold outline-none focus:border-brand-500"
              placeholder="0.00"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
            />
          </label>
          <p className="text-xs text-slate-500">Cuenta el dinero con que empiezas (el fondo o cambio). Si no hay, deja 0.</p>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setAbriendo(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={guardando}>
              {guardando ? "Abriendo..." : "Abrir caja"} <kbd className="ml-1 rounded border border-white/40 px-1 font-mono text-[10px]">Enter</kbd>
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
