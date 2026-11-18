import { adminVentas, sinImpuestos, soloVentas } from "../../lib/variant";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import type { Factura, NotaFactura } from "../../lib/types";
import { formatDate, formatMoney } from "../../lib/format";
import { Badge, Button, EmptyRow, PageHeader, Table } from "../../components/ui";

type Mostrar = "TODAS" | "PAGADA" | "PENDIENTE" | "ANULADA" | "CON_CREDITO" | "CON_DEBITO";

const OPCIONES: { valor: Mostrar; texto: string }[] = [
  { valor: "TODAS", texto: "Todas" },
  { valor: "PAGADA", texto: "Pagadas" },
  { valor: "PENDIENTE", texto: "Pendientes" },
  { valor: "ANULADA", texto: "Anuladas" },
  { valor: "CON_CREDITO", texto: "Con nota de crédito" },
  { valor: "CON_DEBITO", texto: "Con nota de débito" },
];

const CAMPO = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

// sin tildes y en minusculas, para que "credito" encuentre "Crédito"
const limpiar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export default function ListaFacturas() {
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [notas, setNotas] = useState<NotaFactura[]>([]);
  const { usuario } = useAuth();

  // Buscador
  const [texto, setTexto] = useState("");
  const [mostrar, setMostrar] = useState<Mostrar>("TODAS");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");

  // Facturas electronicas que no quedaron emitidas (solo lo ve el administrador; en otras empresas viene vacio).
  const [sinEmitir, setSinEmitir] = useState<{ factura_id: number; factura_numero: number; estado: string }[]>([]);

  useEffect(() => {
    api.facturas.listar().then(setFacturas as any);
    // las notas de credito y debito de cada factura (para poder buscarlas y filtrarlas)
    if (!sinImpuestos) api.notas.listar().then((n) => setNotas(n as NotaFactura[])).catch(() => {});
    // solo el administrador puede pedirlo (a la caja la nube le diria que no y saldria como error de conexion)
    if (usuario?.rol === "ADMIN") api.ecf.pendientes().then((p) => setSinEmitir(p as any)).catch(() => {});
  }, [usuario?.rol]);

  // por factura: que notas tiene
  const notasDe = useMemo(() => {
    const m = new Map<number, NotaFactura[]>();
    for (const n of notas) m.set(n.factura_id, [...(m.get(n.factura_id) ?? []), n]);
    return m;
  }, [notas]);

  const visibles = useMemo(() => {
    const q = limpiar(texto.trim());
    return facturas.filter((f) => {
      const ns = notasDe.get(f.id) ?? [];
      const conCredito = ns.some((n) => n.tipo === "CREDITO") || !!f.nota_credito_ncf;
      const conDebito = ns.some((n) => n.tipo === "DEBITO") || !!f.nota_debito_ncf;
      if (mostrar === "PAGADA" || mostrar === "PENDIENTE" || mostrar === "ANULADA") {
        if (f.estado !== mostrar) return false;
      }
      if (mostrar === "CON_CREDITO" && !conCredito) return false;
      if (mostrar === "CON_DEBITO" && !conDebito) return false;
      if (desde && f.fecha < desde) return false;
      if (hasta && f.fecha > hasta) return false;
      if (q) {
        const pajar = limpiar(
          [f.numero, f.ncf, f.cliente_nombre, f.estado, f.nota_credito_ncf, f.nota_debito_ncf, ...ns.flatMap((n) => [n.ncf, n.motivo, n.tipo === "CREDITO" ? "nota de credito" : "nota de debito"])]
            .filter(Boolean)
            .join(" ")
        );
        // cada palabra escrita debe aparecer en algun lado de la factura
        if (!q.split(/\s+/).every((p) => pajar.includes(p))) return false;
      }
      return true;
    });
  }, [facturas, notasDe, texto, mostrar, desde, hasta]);

  const hayFiltro = texto !== "" || mostrar !== "TODAS" || desde !== "" || hasta !== "";
  const limpiarFiltros = () => {
    setTexto("");
    setMostrar("TODAS");
    setDesde("");
    setHasta("");
  };

  return (
    <div>
      <PageHeader
        title="Facturas"
        subtitle={sinImpuestos ? "Ventas hechas en la caja" : "Facturacion de ventas con NCF e ITBIS"}
        actions={
          // en la caja de Gas Damian no se hacen facturas a mano: se venden desde el punto de venta
          !sinImpuestos && !(soloVentas && !adminVentas) && (
            <Link to="/facturas/nueva">
              <Button>+ Nueva Factura</Button>
            </Link>
          )
        }
      />

      {sinEmitir.length > 0 && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          <b>
            {sinEmitir.length} factura{sinEmitir.length === 1 ? "" : "s"} sin comprobante electrónico.
          </b>{" "}
          Entra a cada una para resolverla:{" "}
          {sinEmitir.slice(0, 8).map((x, i) => (
            <span key={x.factura_id}>
              {i > 0 && ", "}
              <Link className="underline" to={`/facturas/${x.factura_id}`}>
                #{x.factura_numero}
              </Link>
            </span>
          ))}
          {sinEmitir.length > 8 && "…"}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="min-w-[220px] flex-1">
          <span className="mb-1 block text-xs font-medium text-slate-600">Buscar</span>
          <input
            type="search"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Número, NCF, cliente, nota, motivo…"
            className={`${CAMPO} w-full`}
            data-nav-ignorar
          />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-slate-600">Mostrar</span>
          <select value={mostrar} onChange={(e) => setMostrar(e.target.value as Mostrar)} className={CAMPO} data-nav-ignorar>
            {OPCIONES.filter((o) => !sinImpuestos || !o.valor.startsWith("CON_")).map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.texto}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-slate-600">Desde</span>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={CAMPO} data-nav-ignorar />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-slate-600">Hasta</span>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className={CAMPO} data-nav-ignorar />
        </label>
        {hayFiltro && (
          <Button variant="secondary" onClick={limpiarFiltros}>
            Limpiar
          </Button>
        )}
      </div>
      {hayFiltro && (
        <p className="mb-2 text-sm text-slate-500">
          {visibles.length} de {facturas.length} facturas
        </p>
      )}

      <Table columns={["Num.", "NCF", "Fecha", "Cliente", "Condicion", "Total", "Estado", ""]}>
        {visibles.length === 0 && <EmptyRow colSpan={8} />}
        {visibles.map((f) => {
          const ns = notasDe.get(f.id) ?? [];
          return (
            <tr key={f.id} className="hover:bg-slate-50">
              <td className="px-4 py-2.5 text-slate-500">{f.numero}</td>
              <td className="px-4 py-2.5 font-mono text-xs">{f.ncf}</td>
              <td className="px-4 py-2.5">{formatDate(f.fecha)}</td>
              <td className="px-4 py-2.5 font-medium text-slate-800">{f.cliente_nombre}</td>
              <td className="px-4 py-2.5">{f.condicion_pago === "CONTADO" ? "Contado" : "Credito"}</td>
              <td className="px-4 py-2.5">{formatMoney(f.total)}</td>
              <td className="px-4 py-2.5">
                <div className="flex flex-wrap items-center gap-1">
                  <Badge tone={f.estado === "PAGADA" ? "green" : f.estado === "ANULADA" ? "red" : "amber"}>{f.estado}</Badge>
                  {ns.some((n) => n.tipo === "CREDITO" && !n.anulacion) && <Badge tone="blue">Nota crédito</Badge>}
                  {ns.some((n) => n.tipo === "DEBITO") && <Badge tone="blue">Nota débito</Badge>}
                </div>
              </td>
              <td className="px-4 py-2.5 text-right">
                <Link to={`/facturas/${f.id}`} className="text-xs font-medium text-brand-600 hover:underline">
                  Ver detalle
                </Link>
              </td>
            </tr>
          );
        })}
      </Table>
    </div>
  );
}
