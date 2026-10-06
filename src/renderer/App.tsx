import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
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

function RutasCaja() {
  return (
    <>
      <Route path="/" element={<Dashboard />} />
      <Route path="/caja" element={<Caja />} />
      <Route path="/facturas" element={<ListaFacturas />} />
      <Route path="/facturas/nueva" element={<NuevaFactura />} />
      <Route path="/facturas/:id" element={<DetalleFactura />} />
      <Route path="/cuentas-por-cobrar" element={<CuentasPorCobrar />} />
      <Route path="/clientes" element={<ListaClientes />} />
      <Route path="/clientes/:id" element={<DetalleCliente />} />
      <Route path="/productos" element={<ListaProductos />} />
      <Route path="/envases" element={<ControlEnvases />} />
      <Route path="*" element={<Navigate to="/caja" replace />} />
    </>
  );
}

function RutasAdmin() {
  return (
    <>
      <Route path="/" element={<Dashboard />} />
      <Route path="/caja" element={<Caja />} />
      <Route path="/facturas" element={<ListaFacturas />} />
      <Route path="/facturas/nueva" element={<NuevaFactura />} />
      <Route path="/facturas/:id" element={<DetalleFactura />} />
      <Route path="/cuentas-por-cobrar" element={<CuentasPorCobrar />} />
      <Route path="/clientes" element={<ListaClientes />} />
      <Route path="/clientes/:id" element={<DetalleCliente />} />
      <Route path="/productos" element={<ListaProductos />} />
      <Route path="/envases" element={<ControlEnvases />} />
      <Route path="/contabilidad/cuentas" element={<CatalogoCuentas />} />
      <Route path="/contabilidad/asientos" element={<Asientos />} />
      <Route path="/contabilidad/libro-mayor" element={<LibroMayor />} />
      <Route path="/contabilidad/balance-comprobacion" element={<BalanceComprobacion />} />
      <Route path="/reportes/resultados" element={<EstadoResultados />} />
      <Route path="/reportes/balance-general" element={<BalanceGeneral />} />
      <Route path="/reportes/itbis" element={<ReporteItbis />} />
      <Route path="/comprobantes" element={<Comprobantes />} />
      <Route path="/configuracion" element={<Configuracion />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </>
  );
}

function RutasProtegidas() {
  const { usuario } = useAuth();

  if (!usuario) return <Login />;

  const restringido = esVariantCaja || usuario.rol === "CAJERO";

  return (
    <Routes>
      <Route element={<Layout />}>{restringido ? <RutasCaja /> : <RutasAdmin />}</Route>
    </Routes>
  );
}

export default function App() {
  const [redConfig, setRedConfig] = useState<{ modo: "SERVIDOR" | "CAJA_REMOTA"; servidorUrl?: string } | null>(null);

  useEffect(() => {
    api.red.obtenerConfig().then(setRedConfig as any);
  }, []);

  if (!redConfig) return null;

  if (redConfig.modo === "CAJA_REMOTA" && !redConfig.servidorUrl) {
    return <ConfigurarConexion />;
  }

  return (
    <AuthProvider>
      <RutasProtegidas />
    </AuthProvider>
  );
}
