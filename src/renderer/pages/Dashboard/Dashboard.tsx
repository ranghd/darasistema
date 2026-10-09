import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { formatMoney } from "../../lib/format";
import { Card, PageHeader, StatCard } from "../../components/ui";
import { esVariantCaja } from "../../lib/variant";
import { useAuth } from "../../lib/auth";

interface DashboardData {
  ventasMes: number;
  porCobrar: number;
  facturasHoy: number;
  envasesCirculando: number;
  productosBajoStock: { codigo: string; nombre: string; existencia: number }[];
}

export default function Dashboard() {
  const { usuario } = useAuth();
  const esCajero = usuario?.rol === "CAJERO";
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    api.reportes.dashboard().then(setData as any);
  }, []);

  return (
    <div>
      <PageHeader
        title="Panel Principal"
        subtitle="Resumen del negocio: venta de gas, oxigeno y agua purificada"
        actions={
          <Link to="/facturas/nueva" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
            + Nueva Factura
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Ventas del mes" value={formatMoney(data?.ventasMes)} tone="blue" />
        <StatCard label="Cuentas por cobrar" value={formatMoney(data?.porCobrar)} tone="amber" />
        <StatCard label="Facturas de hoy" value={String(data?.facturasHoy ?? 0)} />
        <StatCard label="Envases en la calle" value={String(data?.envasesCirculando ?? 0)} hint="Cilindros y botellones en poder de clientes" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Accesos rapidos</h2>
          <div className="grid grid-cols-2 gap-2.5">
            {(esVariantCaja || esCajero) && <QuickLink to="/caja" label="Punto de venta" />}
            <QuickLink to="/facturas/nueva" label="Factura detallada" />
            <QuickLink to="/clientes" label="Clientes" />
            <QuickLink to="/productos" label="Inventario" />
            {!esVariantCaja && !esCajero && <QuickLink to="/contabilidad/asientos" label="Libro Diario" />}
            {!esVariantCaja && !esCajero && <QuickLink to="/reportes/resultados" label="Estado de Resultados" />}
            {!esCajero && <QuickLink to="/configuracion" label="Configuracion" />}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Productos con existencia baja</h2>
          {data?.productosBajoStock && data.productosBajoStock.length > 0 ? (
            <ul className="divide-y divide-slate-100">
              {data.productosBajoStock.map((p) => (
                <li key={p.codigo} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-slate-700">{p.nombre}</span>
                  <span className="font-semibold text-amber-600">{p.existencia} und.</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-400">Todos los productos tienen existencia saludable.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

function QuickLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="rounded-lg border border-slate-200 px-3 py-2.5 text-center text-sm font-medium text-slate-600 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700">
      {label}
    </Link>
  );
}
