import { useEffect, useMemo, useRef, useState } from "react";
import { hayModalAbierto } from "../../lib/atajos";
import type { Producto } from "../../lib/types";
import { formatMoney } from "../../lib/format";
import { Modal } from "../../components/ui";
import { leerBusqueda, sinAcentos } from "./buscar";

// Factura rapida del colmado: una tabla (# Codigo Descripcion Cant. Precio Total) donde se escribe
// o se escanea el codigo en la ultima fila. F3 o Ctrl+F abre el buscador de productos.

export interface LineaTabla {
  producto: Producto;
  cantidad: number;
  bruto: number;
  itbisLinea: number;
}

interface Props {
  productos: Producto[];
  lineas: LineaTabla[];
  // La celda de codigo de la fila nueva (es el "buscador" de la caja: ahi vuelve el foco).
  entrada: React.RefObject<HTMLInputElement>;
  texto: string;
  setTexto: (t: string) => void;
  // Devuelve la fila donde quedo el producto, o -1 si no se pudo (sin existencia).
  agregar: (p: Producto, cantidad: number) => number;
  fijarCantidad: (i: number, cantidad: number) => boolean;
  quitar: (i: number) => void;
  setError: (m: string) => void;
  lineaSel: number;
  setLineaSel: (i: number) => void;
}

// Precio que paga el cliente (con ITBIS).
const precioFinal = (p: Producto) => p.precio_contenido * (1 + (p.itbis_rate ?? 0));

// La pistola de codigos de barras escribe muy rapido (unos pocos ms por tecla) y termina con Enter.
const MS_POR_TECLA_LECTOR = 35;

// F3 o Ctrl+F (en laptops las F suelen necesitar la tecla Fn).
const esTeclaBuscar = (e: KeyboardEvent | React.KeyboardEvent) => e.key === "F3" || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f");

const leerCantidad = (t: string) => Number(t.trim().replace(",", "."));

export default function TablaFactura({ productos, lineas, entrada, texto, setTexto, agregar, fijarCantidad, quitar, setError, lineaSel, setLineaSel }: Props) {
  const celdasCantidad = useRef<(HTMLInputElement | null)[]>([]);
  const tiempos = useRef<number[]>([]);
  const [filaPorEnfocar, setFilaPorEnfocar] = useState<number | null>(null);
  const [f3, setF3] = useState<{ texto: string; cantidad: number } | null>(null);

  const activos = useMemo(() => productos.filter((p) => p.activo), [productos]);

  // Despues de agregar a mano, el foco salta a la cantidad de esa fila.
  useEffect(() => {
    if (filaPorEnfocar === null) return;
    const celda = celdasCantidad.current[filaPorEnfocar];
    if (celda) {
      celda.focus();
      celda.select();
    }
    setFilaPorEnfocar(null);
  }, [filaPorEnfocar, lineas.length]);

  const irAEntrada = () => setTimeout(() => entrada.current?.focus(), 0);
  const irACantidad = (i: number) => {
    const celda = celdasCantidad.current[i];
    if (!celda) return irAEntrada();
    celda.focus();
    celda.select();
  };

  // F3 o Ctrl+F: buscador de productos (con lo que haya escrito en la celda).
  const abrirF3 = useRef(() => {});
  abrirF3.current = () => {
    const { cantidad, q } = leerBusqueda(texto);
    setF3({ texto: q, cantidad });
  };
  useEffect(() => {
    const alPresionar = (e: KeyboardEvent) => {
      if (!esTeclaBuscar(e) || hayModalAbierto() || e.defaultPrevented) return;
      e.preventDefault();
      abrirF3.current();
    };
    window.addEventListener("keydown", alPresionar);
    return () => window.removeEventListener("keydown", alPresionar);
  }, []);

  function poner(p: Producto, cantidad: number, quedarseEnCodigo: boolean) {
    if (p.existencia <= 0) return setError(`${p.nombre} no tiene existencia`);
    const i = agregar(p, cantidad);
    if (i < 0) return;
    setTexto("");
    tiempos.current = [];
    if (quedarseEnCodigo) irAEntrada();
    else setFilaPorEnfocar(i);
  }

  function teclaEntrada(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.ctrlKey || e.metaKey || e.altKey) return; // Ctrl+Enter, Ctrl+1... los maneja la caja
    if (e.key.length === 1) {
      if (texto === "") tiempos.current = [];
      tiempos.current.push(performance.now());
      return;
    }
    if (e.key === "ArrowUp" && lineas.length) {
      e.preventDefault();
      irACantidad(lineas.length - 1);
    } else if (e.key === "Delete" && texto === "" && lineas.length) {
      e.preventDefault();
      quitar(lineaSel >= 0 ? lineaSel : lineas.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const { cantidad, q } = leerBusqueda(texto);
      const t = sinAcentos(q.trim());
      if (!t) return;
      const ts = tiempos.current;
      const conLector = ts.length >= 4 && (ts[ts.length - 1] - ts[0]) / (ts.length - 1) < MS_POR_TECLA_LECTOR;
      // 1) codigo exacto (lo normal con la pistola)  2) un solo producto con ese nombre  3) el buscador F3
      const porCodigo = activos.find((p) => sinAcentos(p.codigo.trim()) === t);
      const porNombre = porCodigo ? [] : activos.filter((p) => sinAcentos(p.nombre).includes(t) || sinAcentos(p.codigo).includes(t));
      const p = porCodigo ?? (porNombre.length === 1 ? porNombre[0] : undefined);
      if (p) return poner(p, cantidad, conLector || cantidad !== 1);
      if (conLector) {
        setTexto("");
        tiempos.current = [];
        return setError(`El codigo ${q.trim()} no esta registrado. Agregalo en Productos.`);
      }
      if (porNombre.length === 0) return setError(`No hay ningun producto que coincida con "${q.trim()}". Presiona F3 o Ctrl+F para buscar.`);
      setF3({ texto: q.trim(), cantidad });
    }
  }

  function teclaCantidad(e: React.KeyboardEvent<HTMLInputElement>, i: number) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const confirmar = () => {
      const n = leerCantidad(e.currentTarget.value);
      if (!Number.isFinite(n) || n < 0) {
        setError("Escribe una cantidad valida");
        e.currentTarget.value = String(lineas[i].cantidad);
        return false;
      }
      if (n === lineas[i].cantidad) return true;
      if (!fijarCantidad(i, n)) {
        e.currentTarget.value = String(lineas[i].cantidad);
        return false;
      }
      return true;
    };
    if (e.key === "Enter") {
      e.preventDefault();
      if (confirmar()) irAEntrada();
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      confirmar();
      const j = i + (e.key === "ArrowDown" ? 1 : -1);
      if (j >= lineas.length) irAEntrada();
      else irACantidad(Math.max(0, j));
    } else if (e.key === "Delete") {
      e.preventDefault();
      quitar(i);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.currentTarget.value = String(lineas[i].cantidad);
      irAEntrada();
    }
  }

  const cantidadEscrita = leerBusqueda(texto).cantidad;

  return (
    <>
      <div className="flex-1 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="w-12 px-3 py-2 text-center">#</th>
              <th className="w-44 px-3 py-2">Codigo</th>
              <th className="px-3 py-2">Descripcion</th>
              <th className="w-28 px-3 py-2 text-right">Cant.</th>
              <th className="w-32 px-3 py-2 text-right">Precio</th>
              <th className="w-36 px-3 py-2 text-right">Total</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {lineas.map((l, i) => (
              <tr key={l.producto.id} onClick={() => setLineaSel(i)} className={`border-t border-slate-100 ${i === lineaSel ? "bg-brand-50/70" : ""}`}>
                <td className="px-3 py-1.5 text-center text-slate-400">{i + 1}</td>
                <td className="px-3 py-1.5 font-mono text-xs text-slate-500">{l.producto.codigo}</td>
                <td className="px-3 py-1.5 font-medium text-slate-800">{l.producto.nombre}</td>
                <td className="px-2 py-1">
                  <input
                    ref={(el) => (celdasCantidad.current[i] = el)}
                    key={`${l.producto.id}-${l.cantidad}`}
                    defaultValue={l.cantidad}
                    inputMode="decimal"
                    onFocus={(e) => (setLineaSel(i), e.target.select())}
                    onKeyDown={(e) => teclaCantidad(e, i)}
                    onBlur={(e) => {
                      const n = leerCantidad(e.target.value);
                      if (Number.isFinite(n) && n >= 0 && n !== l.cantidad) {
                        if (!fijarCantidad(i, n)) e.target.value = String(l.cantidad);
                      } else e.target.value = String(l.cantidad);
                    }}
                    className="w-full rounded border border-transparent bg-transparent px-2 py-1 text-right font-semibold outline-none hover:border-slate-200 focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-100"
                  />
                </td>
                <td className="px-3 py-1.5 text-right text-slate-600">{formatMoney(precioFinal(l.producto))}</td>
                <td className="px-3 py-1.5 text-right font-semibold text-slate-900">{formatMoney(l.bruto + l.itbisLinea)}</td>
                <td className="pr-2 text-center">
                  <button tabIndex={-1} title="Quitar (Supr)" onClick={() => quitar(i)} className="rounded px-1.5 text-slate-300 hover:bg-red-50 hover:text-red-500">
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            {/* Fila nueva: aqui se escribe o se escanea el codigo */}
            <tr className="border-t border-slate-200 bg-amber-50/40">
              <td className="px-3 py-2 text-center text-slate-400">{lineas.length + 1}</td>
              <td className="px-2 py-1.5" colSpan={2}>
                <div className="relative">
                  <input
                    ref={entrada}
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                    onKeyDown={teclaEntrada}
                    placeholder="Escanea o escribe el codigo y Enter · F3 o Ctrl+F buscar producto"
                    className="w-full rounded-lg border-2 border-brand-300 bg-white px-3 py-1.5 font-mono text-base outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                  />
                  {cantidadEscrita !== 1 && <span className="absolute right-2 top-2 rounded bg-brand-600 px-1.5 text-xs font-bold text-white">×{cantidadEscrita}</span>}
                </div>
              </td>
              <td colSpan={4} className="px-3 text-xs text-slate-400">
                {lineas.length === 0 ? "3*codigo para varias unidades" : ""}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {f3 && (
        <BuscadorProductos
          productos={activos}
          inicial={f3.texto}
          onElegir={(p) => {
            const cantidad = f3.cantidad;
            setF3(null);
            poner(p, cantidad, cantidad !== 1);
          }}
          onCerrar={() => (setF3(null), irAEntrada())}
        />
      )}
    </>
  );
}

// ---------- F3: buscador de productos ----------
function BuscadorProductos({ productos, inicial, onElegir, onCerrar }: { productos: Producto[]; inicial: string; onElegir: (p: Producto) => void; onCerrar: () => void }) {
  const [texto, setTexto] = useState(inicial);
  const [sel, setSel] = useState(0);
  const [aviso, setAviso] = useState("");
  const lista = useRef<HTMLDivElement>(null);

  const encontrados = useMemo(() => {
    const t = sinAcentos(texto.trim());
    // Primero el codigo exacto, luego los que empiezan con lo escrito ("plat" -> Platano antes que Lavaplatos).
    const orden = (p: Producto) => {
      const nombre = sinAcentos(p.nombre);
      return sinAcentos(p.codigo) === t ? 0 : nombre.startsWith(t) ? 1 : nombre.split(/\s+/).some((w) => w.startsWith(t)) ? 2 : 3;
    };
    return productos
      .filter((p) => !t || sinAcentos(`${p.nombre} ${p.codigo} ${p.grupo ?? ""}`).includes(t))
      .sort((a, b) => orden(a) - orden(b) || a.nombre.localeCompare(b.nombre))
      .slice(0, 100);
  }, [productos, texto]);

  useEffect(() => setSel(0), [texto]);
  useEffect(() => {
    lista.current?.querySelector(`[data-fila="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  function elegir(p: Producto | undefined) {
    if (!p) return;
    if (p.existencia <= 0) return setAviso(`${p.nombre} no tiene existencia`);
    onElegir(p);
  }

  return (
    <Modal open onClose={onCerrar} title="Buscar producto (F3 · Ctrl+F)" width="max-w-3xl">
      <input
        autoFocus
        className="w-full rounded-lg border-2 border-brand-300 px-3 py-2 text-base outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        placeholder="Nombre, codigo o grupo. Ej.: platano"
        value={texto}
        onChange={(e) => (setTexto(e.target.value), setAviso(""))}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") (e.preventDefault(), setSel((s) => Math.min(s + 1, encontrados.length - 1)));
          else if (e.key === "ArrowUp") (e.preventDefault(), setSel((s) => Math.max(s - 1, 0)));
          else if (e.key === "PageDown") (e.preventDefault(), setSel((s) => Math.min(s + 10, encontrados.length - 1)));
          else if (e.key === "PageUp") (e.preventDefault(), setSel((s) => Math.max(s - 10, 0)));
          else if (e.key === "Enter") (e.preventDefault(), elegir(encontrados[sel]));
          else if (esTeclaBuscar(e)) e.preventDefault();
        }}
      />
      <div ref={lista} className="mt-3 max-h-[55vh] overflow-y-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Descripcion</th>
              <th className="px-3 py-2">Codigo</th>
              <th className="px-3 py-2 text-right">Precio</th>
              <th className="px-3 py-2 text-right">Existencia</th>
            </tr>
          </thead>
          <tbody>
            {encontrados.map((p, i) => (
              <tr
                key={p.id}
                data-fila={i}
                onMouseEnter={() => setSel(i)}
                onClick={() => elegir(p)}
                className={`cursor-pointer border-t border-slate-100 ${i === sel ? "bg-brand-600 text-white" : p.existencia <= 0 ? "text-slate-400" : "text-slate-700"}`}
              >
                <td className="px-3 py-1.5 font-medium">{p.nombre}</td>
                <td className={`px-3 py-1.5 font-mono text-xs ${i === sel ? "text-brand-100" : "text-slate-400"}`}>{p.codigo}</td>
                <td className="px-3 py-1.5 text-right font-semibold">{formatMoney(precioFinal(p))}</td>
                <td className="px-3 py-1.5 text-right">{p.existencia}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {encontrados.length === 0 && <p className="py-6 text-center text-sm text-slate-400">Ningun producto coincide</p>}
      </div>
      {aviso && <p className="mt-2 rounded-lg bg-red-50 px-3 py-1.5 text-sm text-red-600">{aviso}</p>}
      <p className="mt-2 text-xs text-slate-400">↑ ↓ elegir · Enter poner en la factura · Esc volver</p>
    </Modal>
  );
}
