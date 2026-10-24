import { useEffect, useState } from "react";
import { api, mensajeDeError } from "../lib/api";
import { formatMoney, todayIso } from "../lib/format";
import type { Banco } from "../lib/types";
import { Button, Input, Modal, Select } from "./ui";

export interface DocumentoPorPagar {
  origen: "COMPRA" | "GASTO";
  id: number;
  numero: number;
  suplidor: string;
  ncf: string | null;
  saldo: number;
}

// Paga (todo o una parte) una factura de suplidor: compra de mercancia o gasto.
export default function PagoSuplidorModal({ doc, onClose, onPagado }: { doc: DocumentoPorPagar | null; onClose: () => void; onPagado: () => void }) {
  const [monto, setMonto] = useState("");
  const [metodo, setMetodo] = useState("TRANSFERENCIA");
  const [bancos, setBancos] = useState<Banco[]>([]);
  const [bancoId, setBancoId] = useState<number | "">("");
  const [referencia, setReferencia] = useState("");
  const [fecha, setFecha] = useState(todayIso());
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!doc) return;
    setMonto(String(doc.saldo));
    setMetodo("TRANSFERENCIA");
    setReferencia("");
    setFecha(todayIso());
    setError("");
    api.bancos.listar().then((b) => {
      const activos = b.filter((x) => x.activo);
      setBancos(activos);
      setBancoId(activos[0]?.id ?? "");
    });
  }, [doc?.origen, doc?.id]);

  async function pagar(e: React.FormEvent) {
    e.preventDefault();
    if (!doc) return;
    setGuardando(true);
    setError("");
    try {
      const datos = {
        fecha,
        monto: Number(monto.replace(/,/g, "")),
        metodo: metodo as any,
        banco_id: metodo === "EFECTIVO" ? null : bancoId || null,
        referencia,
      };
      if (doc.origen === "GASTO") await api.gastos.pagar({ gasto_id: doc.id, ...datos });
      else await api.pagosCompra.crear({ compra_id: doc.id, ...datos });
      onPagado();
      onClose();
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal open={!!doc} onClose={onClose} title={`Pagar a ${doc?.suplidor ?? ""}`}>
      <form onSubmit={pagar} className="space-y-3">
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
          {doc?.origen === "COMPRA" ? `Compra #${doc?.numero}` : `Gasto #${doc?.numero}`}
          {doc?.ncf ? ` · NCF ${doc.ncf}` : ""} · Se debe <b>{formatMoney(doc?.saldo)}</b>
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Monto a pagar (RD$)" inputMode="decimal" autoFocus value={monto} onChange={(e) => setMonto(e.target.value)} />
          <Input label="Fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </div>
        <Select label="Forma de pago" value={metodo} onChange={(e) => setMetodo(e.target.value)}>
          <option value="TRANSFERENCIA">Transferencia</option>
          <option value="CHEQUE">Cheque</option>
          <option value="EFECTIVO">Efectivo</option>
          <option value="TARJETA">Tarjeta</option>
        </Select>
        {metodo !== "EFECTIVO" && (
          <div className="grid grid-cols-2 gap-3">
            <Select label="Sale del banco" value={bancoId} onChange={(e) => setBancoId(Number(e.target.value))}>
              {bancos.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.nombre}
                </option>
              ))}
            </Select>
            <Input label={metodo === "CHEQUE" ? "Numero de cheque" : "Referencia"} value={referencia} onChange={(e) => setReferencia(e.target.value)} />
          </div>
        )}
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={guardando}>
            {guardando ? "Guardando..." : "Registrar pago"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
