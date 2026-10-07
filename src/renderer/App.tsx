import { useEffect, useState } from "react";
import { Navigate, useRoutes } from "react-router-dom";
import { api } from "./lib/api";
import { AuthProvider, useAuth } from "./lib/auth";
import { esVariantCaja } from "./lib/variant";
import Layout from "./components/Layout";
import Login from "./pages/Login/Login";
import ConfigurarConexion from "./pages/Configuracion/ConfigurarConexion";
import Dashboard from "./pages/Dashboard/Dashboard";
import Caja from "./pages/Caja/Caja";
import ListaClientes from "./pages/Clientes/ListaClientes";
import DetalleCliente from "./pages/Clientes/DetalleCliente";
import ListaProductos from "./pages/Productos/ListaProductos";
import ControlEnvases from "./pages/Productos/ControlEnvases";
import ListaFacturas from "./pages/Facturacion/ListaFacturas";
import NuevaFactura from "./pages/Facturacion/NuevaFactura";
import DetalleFactura from "./pages/Facturacion/DetalleFactura";
import CuentasPorCobrar from "./pages/Reportes/CuentasPorCobrar";
import CatalogoCuentas from "./pages/Contabilidad/CatalogoCuentas";
import Asientos from "./pages/Contabilidad/Asientos";
import LibroMayor from "./pages/Contabilidad/LibroMayor";
import BalanceComprobacion from "./pages/Contabilidad/BalanceComprobacion";
import EstadoResultados from "./pages/Reportes/EstadoResultados";
import BalanceGeneral from "./pages/Reportes/BalanceGeneral";
import ReporteItbis from "./pages/Reportes/ReporteItbis";
import Configuracion from "./pages/Configuracion/Configuracion";
import Comprobantes from "./pages/Comprobantes/Comprobantes";
import UpdateBanner from "./components/UpdateBanner";

// Rutas que ve cualquier usuario que inicio sesion (admin o cajero).
const RUTAS_COMUNES = [
  { path: "/", element: <Dashboard /> },
  { path: "/caja", element: <Caja /> },
  { path: "/facturas", element: <ListaFacturas /> },
  { path: "/facturas/nueva", element: <NuevaFactura /> },
  { path: "/facturas/:id", element: <DetalleFactura /> },
  { path: "/cuentas-por-cobrar", element: <CuentasPorCobrar /> },
  { path: "/clientes", element: <ListaClientes /> },
  { path: "/clientes/:id", element: <DetalleCliente /> },
  { path: "/productos", element: <ListaProductos /> },
  { path: "/envases", element: <ControlEnvases /> },
];

// Rutas adicionales solo para administradores (no cajeros, no la variante Caja).
const RUTAS_ADMIN_EXTRA = [
  { path: "/contabilidad/cuentas", element: <CatalogoCuentas /> },
  { path: "/contabilidad/asientos", element: <Asientos /> },
  { path: "/contabilidad/libro-mayor", element: <LibroMayor /> },
  { path: "/contabilidad/balance-comprobacion", element: <BalanceComprobacion /> },
  { path: "/reportes/resultados", element: <EstadoResultados /> },
  { path: "/reportes/balance-general", element: <BalanceGeneral /> },
  { path: "/reportes/itbis", element: <ReporteItbis /> },
  { path: "/comprobantes", element: <Comprobantes /> },
  { path: "/configuracion", element: <Configuracion /> },
];

function RutasProtegidas() {
  const { usuario } = useAuth();
  const restringido = esVariantCaja || usuario?.rol === "CAJERO";

  const hijos = usuario
    ? [
        ...RUTAS_COMUNES,
        ...(restringido ? [] : RUTAS_ADMIN_EXTRA),
        { path: "*", element: <Navigate to={restringido ? "/caja" : "/"} replace /> },
      ]
    : [];

  const elemento = useRoutes([{ element: <Layout />, children: hijos }]);

  if (!usuario) return <Login />;
  return elemento;
}

export default function App() {
  const [redConfig, setRedConfig] = useState<{ modo: "SERVIDOR" | "CAJA_REMOTA"; servidorUrl?: string } | null>(null);

  useEffect(() => {
    api.red.obtenerConfig().then(setRedConfig as any);
  }, []);

  if (!redConfig) return null;

  if (redConfig.modo === "CAJA_REMOTA" && !redConfig.servidorUrl) {
    return (
      <>
        <UpdateBanner />
        <ConfigurarConexion />
      </>
    );
  }

  return (
    <>
      <UpdateBanner />
      <AuthProvider>
        <RutasProtegidas />
      </AuthProvider>
    </>
  );
}
