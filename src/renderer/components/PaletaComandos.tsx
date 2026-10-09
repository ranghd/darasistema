import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import type { Cliente, Factura } from "../lib/types";
import { formatMoney } from "../lib/format";
import { Modal } from "./ui";

interface Opcion {
  grupo: string;
  titulo: string;
  detalle?: string;
  ir: string;
}

const sinAcentos = (t: string) =>
  t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

// Ctrl+K: escribir para ir a una pantalla, un cliente o una factura sin usar el mouse.
export default function PaletaComandos({ abierta, onCerrar, pantallas }: { abierta: boolean; onCerrar: () => void; pantallas: { to: string; label: string }[] }) {
  const navigate = useNavigate();
  const [texto, setTexto] = useState("");
  const [sel, setSel] = useState(0);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const lista = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierta) return;
    setTexto("");
    setSel(0);
    api.clientes.listar().then(setClientes).catch(() => {});
    api.facturas.listar().then((f) => setFacturas(f as Factura[])).catch(() => {});
  }, [abierta]);

  const opciones = useMemo((): Opcion[] => {
    const q = sinAcentos(texto.trim());
    const todas: Opcion[] = [
      ...pantallas.map((p) => ({ grupo: "Ir a", titulo: p.label, ir: p.to })),
      ...clientes.map((c) => ({ grupo: "Clientes", titulo: c.nombre, detalle: [c.codigo, c.rnc_cedula, c.telefono].filter(Boolean).join(" · "), ir: `/clientes/${c.id}` })),
      ...facturas.map((f) => ({
        grupo: "Facturas",
        titulo: `Factura #${f.numero} ${f.ncf ?? ""}`.trim(),
        detalle: `${f.cliente_nombre ?? ""} · ${formatMoney(f.total)} · ${f.estado}`,
        ir: `/facturas/${f.id}`,
      })),
    ];
    if (!q) return todas.filter((o) => o.grupo === "Ir a");
    const palabras = q.split(/\s+/);
    return todas
      .filter((o) => {
        const donde = sinAcentos(`${o.grupo} ${o.titulo} ${o.detalle ?? ""}`);
        return palabras.every((p) => donde.includes(p));
      })
      .slice(0, 40);
  }, [texto, pantallas, clientes, facturas]);

  useEffect(() => setSel(0), [texto]);
  useEffect(() => {
    lista.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  function elegir(o: Opcion | undefined) {
    if (!o) return;
    onCerrar();
    navigate(o.ir);
  }

  return (
    <Modal open={abierta} onClose={onCerrar} title="Buscar" width="max-w-2xl">
      <input
        autoFocus
        className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        placeholder="Pantalla, cliente o factura (ej. 'cierre', 'maria', 'B0200000025')"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setSel((s) => Math.min(s + 1, opciones.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setSel((s) => Math.max(s - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            elegir(opciones[sel]);
          }
        }}
      />
      <div ref={lista} className="mt-3 max-h-[50vh] overflow-y-auto">
        {opciones.length === 0 && <p className="py-6 text-center text-sm text-slate-400">Nada coincide con "{texto}"</p>}
        {opciones.map((o, i) => (
          <button
            key={`${o.grupo}-${o.ir}-${i}`}
            data-i={i}
            type="button"
            onMouseEnter={() => setSel(i)}
            onClick={() => elegir(o)}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${i === sel ? "bg-brand-50 text-brand-800" : "text-slate-700"}`}
          >
            <span className="w-16 shrink-0 text-[11px] uppercase text-slate-400">{o.grupo}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{o.titulo}</span>
              {o.detalle && <span className="block truncate text-xs text-slate-500">{o.detalle}</span>}
            </span>
            {i === sel && <span className="text-xs text-brand-600">Enter ↵</span>}
          </button>
        ))}
      </div>
      <p className="mt-3 text-xs text-slate-400">↑ ↓ para moverte · Enter para abrir · Esc para cerrar</p>
    </Modal>
  );
}
