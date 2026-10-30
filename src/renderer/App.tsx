import { useEffect, useState } from "react";
import { Navigate, useNavigate, useRoutes } from "react-router-dom";
import { api } from "./lib/api";
import { AuthProvider, useAuth } from "./lib/auth";
import { CajaProvider } from "./lib/caja";
import CierreCaja from "./pages/CierreCaja/CierreCaja";
import CierresCaja from "./pages/CierreCaja/CierresCaja";
import { esColmado, esVariantCaja, manejaEnvases, operaCaja, soloVentas } from "./lib/variant";
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
import ReporteVentas from "./pages/Reportes/ReporteVentas";
import CuentasPorPagar from "./pages/Reportes/CuentasPorPagar";
import Gastos from "./pages/Gastos/Gastos";
import Conciliacion from "./pages/Bancos/Conciliacion";
import Configuracion from "./pages/Configuracion/Configuracion";
import Comprobantes from "./pages/Comprobantes/Comprobantes";
import Compras from "./pages/Compras/Compras";
import Proveedores from "./pages/Proveedores/Proveedores";
import DetalleProveedor from "./pages/Proveedores/DetalleProveedor";
import UpdateBanner from "./components/UpdateBanner";
import { activarNavegacionConFlechas } from "./lib/navegacionFlechas";

// Rutas que ve cualquier usuario que inicio sesion (admin o cajero).
const RUTAS_COMUNES = [
  { path: "/", element: <Dashboard /> },
  { path: "/caja", element: <Caja /> },
  // Abrir y cerrar caja solo en Cajapunto1; Darasistema solo consulta los cierres.
  ...(operaCaja ? [{ path: "/cierre-caja", element: <CierreCaja /> }] : []),
  { path: "/facturas", element: <ListaFacturas /> },
  { path: "/facturas/nueva", element: <NuevaFactura /> },
  { path: "/facturas/:id", element: <DetalleFactura /> },
  { path: "/cuentas-por-cobrar", element: <CuentasPorCobrar /> },
  { path: "/clientes", element: <ListaClientes /> },
  { path: "/clientes/:id", element: <DetalleCliente /> },
  { path: "/productos", element: <ListaProductos /> },
  ...(manejaEnvases ? [{ path: "/envases", element: <ControlEnvases /> }] : []),
];

// Punto de Venta Dara: vender, su caja y clientes (la factura se abre desde el cliente para reimprimir).
const RUTAS_PUNTO_VENTA = [
  { path: "/caja", element: <Caja /> },
  { path: "/cierre-caja", element: <CierreCaja /> },
  { path: "/clientes", element: <ListaClientes /> },
  { path: "/clientes/:id", element: <DetalleCliente /> },
  { path: "/facturas/:id", element: <DetalleFactura /> },
];

// Rutas adicionales solo para administradores (no cajeros, no la variante Caja).
const RUTAS_ADMIN_EXTRA = [
  { path: "/compras", element: <Compras /> },
  { path: "/cierres-caja", element: <CierresCaja /> },
  { path: "/proveedores", element: <Proveedores /> },
  { path: "/proveedores/:id", element: <DetalleProveedor /> },
  { path: "/contabilidad/cuentas", element: <CatalogoCuentas /> },
  { path: "/contabilidad/asientos", element: <Asientos /> },
  { path: "/contabilidad/libro-mayor", element: <LibroMayor /> },
  { path: "/contabilidad/balance-comprobacion", element: <BalanceComprobacion /> },
  { path: "/reportes/resultados", element: <EstadoResultados /> },
  { path: "/reportes/balance-general", element: <BalanceGeneral /> },
  { path: "/reportes/itbis", element: <ReporteItbis /> },
  { path: "/reportes/ventas", element: <ReporteVentas /> },
  { path: "/gastos", element: <Gastos /> },
  { path: "/cuentas-por-pagar", element: <CuentasPorPagar /> },
  { path: "/bancos", element: <Conciliacion /> },
  { path: "/comprobantes", element: <Comprobantes /> },
  { path: "/configuracion", element: <Configuracion /> },
];

function RutasProtegidas({ modoNube }: { modoNube: boolean }) {
  const { usuario } = useAuth();
  const restringido = esVariantCaja || usuario?.rol === "CAJERO";

  // En Cajapunto1 el administrador entra a Configuracion solo para la conexion.
  const rutaConexionCaja = esVariantCaja && usuario?.rol === "ADMIN" ? RUTAS_ADMIN_EXTRA.filter((r) => r.path === "/configuracion") : [];

  const hijos = usuario
    ? [
        ...(soloVentas ? RUTAS_PUNTO_VENTA : RUTAS_COMUNES),
        ...(restringido ? rutaConexionCaja : RUTAS_ADMIN_EXTRA),
        { path: "*", element: <Navigate to={restringido || esColmado ? "/caja" : "/"} replace /> },
      ]
    : [];

  const elemento = useRoutes([{ element: <Layout />, children: hijos }]);

  // En el colmado se entra directo al punto de venta.
  const navegar = useNavigate();
  useEffect(() => {
    if (usuario && (esColmado || soloVentas) && (location.hash === "" || location.hash === "#/")) navegar("/caja", { replace: true });
  }, [usuario?.id]);

  if (!usuario) return <Login modoNube={modoNube} />;
  return elemento;
}

export default function App() {
  const [redConfig, setRedConfig] = useState<{ modo: "SERVIDOR" | "CAJA_REMOTA" | "NUBE"; servidorUrl?: string } | null>(null);

  useEffect(() => {
    api.red.obtenerConfig().then(setRedConfig);
    // Flechas en toda la app, tambien en el inicio de sesion.
    return activarNavegacionConFlechas();
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
        <CajaProvider>
          <RutasProtegidas modoNube={redConfig.modo === "NUBE"} />
        </CajaProvider>
      </AuthProvider>
    </>
  );
}
