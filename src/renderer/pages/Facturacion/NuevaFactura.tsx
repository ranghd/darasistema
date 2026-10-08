import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useCaja } from "../../lib/caja";
import CajaCerradaAviso from "../../components/CajaCerradaAviso";
import type { Cliente, FacturaLineaInput, Producto } from "../../lib/types";
import { formatMoney, todayIso } from "../../lib/format";
import { NCF_LABELS, TIPOS_NCF_VENTA } from "../../lib/ncf";
import { Button, Card, Input, PageHeader, Select } from "../../components/ui";

interface LineaForm extends FacturaLineaInput {
  key: number;
}

let keySeq = 1;

export default function NuevaFactura() {
  const { usuario } = useAuth();
  const { sesion } = useCaja();
  const navigate = useNavigate();
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [clienteId, setClienteId] = useState<number | "">("");
  const [fecha, setFecha] = useState(todayIso());
  const [condicionPago, setCondicionPago] = useState<"CONTADO" | "CREDITO">("CONTADO");
  const [metodoPago, setMetodoPago] = useState<"EFECTIVO" | "TRANSFERENCIA" | "TARJETA" | "CHEQUE">("EFECTIVO");
  const [tipoNcf, setTipoNcf] = useState<"B01" | "B02" | "B13" | "B14" | "B15">("B02");
  const [lineas, setLineas] = useState<LineaForm[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.clientes.listar().then(setClientes as any);
    api.productos.listar().then(setProductos as any);
  }, []);

  function agregarLinea() {
    if (productos.length === 0) return;
    const p = productos[0];
    setLineas([
      ...lineas,
      { key: keySeq++, producto_id: p.id, modalidad: p.maneja_envase ? "INTERCAMBIO" : "LLENO", cantidad: 1, precio_unitario: p.precio_contenido, descuento: 0 },
    ]);
  }

  function actualizarLinea(key: number, cambios: Partial<LineaForm>) {
    setLineas(lineas.map((l) => (l.key === key ? { ...l, ...cambios } : l)));
  }

  function cambiarProducto(key: number, productoId: number) {
    const p = productos.find((x) => x.id === productoId);
    if (!p) return;
    actualizarLinea(key, { producto_id: p.id, precio_unitario: p.precio_contenido, modalidad: p.maneja_envase ? "INTERCAMBIO" : "LLENO" });
  }

  function quitarLinea(key: number) {
    setLineas(lineas.filter((l) => l.key !== key));
  }

  const calculo = useMemo(() => {
    let subtotal = 0;
    let itbis = 0;
    let fianza = 0;
    const detalle = lineas.map((l) => {
      const producto = productos.find((p) => p.id === l.producto_id);
      const bruto = l.cantidad * l.precio_unitario - l.descuento;
      const itbisLinea = bruto * (producto?.itbis_rate ?? 0.18);
      const fianzaLinea = l.modalidad === "LLENO" && producto?.maneja_envase ? producto.fianza_envase * l.cantidad : 0;
      subtotal += bruto;
      itbis += itbisLinea;
      fianza += fianzaLinea;
      return { ...l, producto, bruto, itbisLinea, fianzaLinea };
    });
    return { detalle, subtotal, itbis, fianza, total: subtotal + itbis + fianza };
  }, [lineas, productos]);

  async function guardar() {
    setError("");
    if (!clienteId) return setError("Seleccione un cliente");
    if (lineas.length === 0) return setError("Agregue al menos un producto");
    // Al contado entra dinero: tiene que quedar en la jornada de una caja abierta.
    if (condicionPago === "CONTADO" && !sesion) return setError("La caja esta cerrada. Abre la caja en Cierre de Caja para cobrar al contado (a credito si se puede facturar).");

    setEnviando(true);
    try {
      const factura = await api.facturas.crear({
        cliente_id: clienteId,
        fecha,
        condicion_pago: condicionPago,
        metodo_pago: condicionPago === "CONTADO" ? metodoPago : undefined,
        tipo_ncf: tipoNcf,
        creado_por: usuario?.nombre,
        caja_sesion_id: sesion?.id ?? null,
        lineas: lineas.map(({ key, ...rest }) => rest),
      });
      navigate(`/facturas/${(factura as any).id}`);
    } catch (e: any) {
      setError(e?.message ?? "No se pudo crear la factura");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div>
      <PageHeader title="Nueva Factura" subtitle="Venta de gas, oxigeno o agua purificada con ITBIS y NCF" />
      {condicionPago === "CONTADO" && <CajaCerradaAviso mensaje="La caja esta cerrada: para facturar al contado hay que abrirla. A credito si se puede facturar." />}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="space-y-3 p-5 lg:col-span-1">
          <Select label="Cliente" value={clienteId} onChange={(e) => setClienteId(Number(e.target.value))}>
            <option value="">Seleccione...</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </Select>
          <Input label="Fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          <Select label="Condicion de pago" value={condicionPago} onChange={(e) => setCondicionPago(e.target.value as any)}>
            <option value="CONTADO">Contado</option>
            <option value="CREDITO">Credito</option>
          </Select>
          {condicionPago === "CONTADO" && (
            <Select label="Metodo de pago" value={metodoPago} onChange={(e) => setMetodoPago(e.target.value as any)}>
              <option value="EFECTIVO">Efectivo</option>
              <option value="TRANSFERENCIA">Transferencia (Banco)</option>
              <option value="TARJETA">Tarjeta</option>
              <option value="CHEQUE">Cheque</option>
            </Select>
          )}
          <Select label="Tipo de comprobante (NCF)" value={tipoNcf} onChange={(e) => setTipoNcf(e.target.value as any)}>
            {TIPOS_NCF_VENTA.map((t) => (
              <option key={t} value={t}>
                {NCF_LABELS[t]}
              </option>
            ))}
          </Select>
        </Card>

        <Card className="p-5 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">Lineas de la factura</h2>
            <Button size="sm" variant="secondary" onClick={agregarLinea} type="button">
              + Agregar producto
            </Button>
          </div>

          {calculo.detalle.length === 0 && <p className="py-6 text-center text-sm text-slate-400">Agregue productos a la factura</p>}

          <div className="space-y-3">
            {calculo.detalle.map((l) => (
              <div key={l.key} className="rounded-lg border border-slate-200 p-3">
                <div className="grid grid-cols-12 gap-2">
                  <div className="col-span-4">
                    <Select value={l.producto_id} onChange={(e) => cambiarProducto(l.key, Number(e.target.value))}>
                      {productos.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nombre}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="col-span-2">
                    <Input type="number" min={0.01} step="0.01" value={l.cantidad} onChange={(e) => actualizarLinea(l.key, { cantidad: Number(e.target.value) })} />
                  </div>
                  <div className="col-span-2">
                    <Input type="number" step="0.01" value={l.precio_unitario} onChange={(e) => actualizarLinea(l.key, { precio_unitario: Number(e.target.value) })} />
                  </div>
                  <div className="col-span-2">
                    <Input type="number" step="0.01" value={l.descuento} onChange={(e) => actualizarLinea(l.key, { descuento: Number(e.target.value) })} placeholder="Desc." />
                  </div>
                  <div className="col-span-2 flex items-center justify-end">
                    <button type="button" onClick={() => quitarLinea(l.key)} className="text-xs text-red-500 hover:underline">
                      Quitar
                    </button>
                  </div>
                </div>
                {l.producto?.maneja_envase && (
                  <div className="mt-2 flex items-center gap-4 text-xs">
                    <label className="flex items-center gap-1.5">
                      <input
                        type="radio"
                        checked={l.modalidad === "INTERCAMBIO"}
                        onChange={() => actualizarLinea(l.key, { modalidad: "INTERCAMBIO" })}
                      />
                      Intercambio (entrega envase vacio)
                    </label>
                    <label className="flex items-center gap-1.5">
                      <input type="radio" checked={l.modalidad === "LLENO"} onChange={() => actualizarLinea(l.key, { modalidad: "LLENO" })} />
                      Lleno (se lleva el envase, fianza {formatMoney(l.producto.fianza_envase)})
                    </label>
                  </div>
                )}
                <div className="mt-1.5 text-right text-xs text-slate-500">
                  Subtotal {formatMoney(l.bruto)} + ITBIS {formatMoney(l.itbisLinea)}
                  {l.fianzaLinea > 0 && <> + Fianza {formatMoney(l.fianzaLinea)}</>}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 space-y-1 border-t border-slate-200 pt-4 text-sm">
            <div className="flex justify-between text-slate-600">
              <span>Subtotal</span>
              <span>{formatMoney(calculo.subtotal)}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>ITBIS</span>
              <span>{formatMoney(calculo.itbis)}</span>
            </div>
            {calculo.fianza > 0 && (
              <div className="flex justify-between text-slate-600">
                <span>Fianza por envases</span>
                <span>{formatMoney(calculo.fianza)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold text-slate-900">
              <span>Total</span>
              <span>{formatMoney(calculo.total)}</span>
            </div>
          </div>

          {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

          <div className="mt-5 flex justify-end">
            <Button onClick={guardar} disabled={enviando}>
              {enviando ? "Guardando..." : "Generar Factura"}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
