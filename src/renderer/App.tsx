import { useEffect, useState } from "react";
import { Navigate, useNavigate, useRoutes } from "react-router-dom";
import { api } from "./lib/api";
import { AuthProvider, useAuth } from "./lib/auth";
import { CajaProvider } from "./lib/caja";
import CierreCaja from "./pages/CierreCaja/CierreCaja";
import CierresCaja from "./pages/CierreCaja/CierresCaja";
import GastosCaja from "./pages/CierreCaja/GastosCaja";
import FiadosCaja from "./pages/Caja/FiadosCaja";
import { adminVentas, cajaConInventario, esColmado, esFritura, esVariantCaja, manejaEnvases, operaCaja, recuerdaSesion, soloVentas } from "./lib/variant";
import Layout from "./components/Layout";
import Login from "./pages/Login/Login";
import ConfigurarConexion from "./pages/Configuracion/ConfigurarConexion";
import Dashboard from "./pages/Dashboard/Dashboard";
import Caja from "./pages/Caja/Caja";
import ListaClientes from "./pages/Clientes/ListaClientes";
import DetalleCliente from "./pages/Clientes/DetalleCliente";
import BotellasFiadas from "./pages/Clientes/BotellasFiadas";
import ListaProductos from "./pages/Productos/ListaProductos";
import Categorias from "./pages/Productos/Categorias";
import ControlEnvases from "./pages/Productos/ControlEnvases";
import ListaFacturas from "./pages/Facturacion/ListaFacturas";
import NuevaFactura from "./pages/Facturacion/NuevaFactura";
import DetalleFactura from "./pages/Facturacion/DetalleFactura";
import NotasFactura from "./pages/Facturacion/NotasFactura";
import PreciosCambiados from "./pages/Reportes/PreciosCambiados";
import ReportePlatos from "./pages/Reportes/ReportePlatos";
import PlatosDia from "./pages/Caja/PlatosDia";
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
import PantallaCarga from "./components/PantallaCarga";
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

// Rutas adicionales solo para administradores (no cajeros, no la variante Caja).
const RUTAS_ADMIN_EXTRA = [
  { path: "/notas", element: <NotasFactura /> },
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
  const { usuario, revisando } = useAuth();
  const restringido = esVariantCaja || usuario?.rol === "CAJERO";

  // En Cajapunto1 el administrador entra a Configuracion solo para la conexion.
  const rutaConexionCaja = esVariantCaja && usuario?.rol === "ADMIN" ? RUTAS_ADMIN_EXTRA.filter((r) => r.path === "/configuracion") : [];

  const hijos = usuario
    ? [
        // Gas Damian Admin es Darasistema con los cilindros prestados. La caja de Gas Damian solo vende y presta cilindros
        // (la factura se sigue abriendo desde la venta para reimprimirla).
        ...(soloVentas && !adminVentas ? RUTAS_COMUNES.filter((r) => ["/caja", "/cierre-caja", "/facturas/:id", ...(cajaConInventario ? ["/productos"] : [])].includes(r.path)) : RUTAS_COMUNES),
        ...(soloVentas && manejaEnvases ? [{ path: "/botellas-fiadas", element: <BotellasFiadas /> }] : []),
        ...(soloVentas && !adminVentas ? [{ path: "/gastos-caja", element: <GastosCaja /> }, { path: "/fiados", element: <FiadosCaja /> }] : []),
        ...((adminVentas && !restringido) || cajaConInventario ? [{ path: "/categorias", element: <Categorias /> }] : []),
        ...(cajaConInventario ? RUTAS_ADMIN_EXTRA.filter((r) => ["/compras", "/proveedores", "/proveedores/:id"].includes(r.path)) : []),
        ...(esFritura ? [{ path: "/platos-dia", element: <PlatosDia /> }] : []),
        ...(esFritura && adminVentas && !restringido
          ? [
              { path: "/reportes/precios-cambiados", element: <PreciosCambiados /> },
              { path: "/reportes/platos-dia", element: <ReportePlatos /> },
            ]
          : []),
        ...(restringido ? rutaConexionCaja : RUTAS_ADMIN_EXTRA),
        { path: "*", element: <Navigate to={restringido || esColmado || (soloVentas && !adminVentas) ? "/caja" : "/"} replace /> },
      ]
    : [];

  const elemento = useRoutes([{ element: <Layout />, children: hijos }]);

  // En el colmado se entra directo al punto de venta.
  const navegar = useNavigate();
  useEffect(() => {
    if (usuario && (esColmado || (soloVentas && !adminVentas)) && (location.hash === "" || location.hash === "#/")) navegar("/caja", { replace: true });
  }, [usuario?.id]);

  if (!usuario) return revisando ? <PantallaCarga texto="Entrando..." /> : <Login modoNube={modoNube} />;
  return elemento;
}

// Caja de Gas Damian: al abrir, primero se revisa si hay una version nueva. Si la hay, se muestra
// "Actualizando..." hasta que se instala sola (el programa se reinicia); si no, entra.
type EstadoArranque = { estado: string; porcentaje?: number } | null;
const ACTUALIZANDO = ["disponible", "descargando", "descargado"];

function ArranqueCaja({ children }: { children: React.ReactNode }) {
  const [estado, setEstado] = useState<EstadoArranque>(null);
  const [listo, setListo] = useState(false);

  useEffect(() => {
    let ultimo: EstadoArranque = null;
    const revisar = (e: EstadoArranque) => {
      ultimo = e;
      setEstado(e);
      if (!e || !["buscando", ...ACTUALIZANDO].includes(e.estado)) setListo(true);
    };
    api.updater?.estadoActual?.().then(revisar).catch(() => setListo(true));
    const quitar = api.updater?.onEstado?.(revisar);
    // sin internet la revision puede tardar: a los 10 segundos se entra igual
    const espera = setTimeout(() => {
      if (!ultimo || ultimo.estado === "buscando") setListo(true);
    }, 10000);
    return () => {
      quitar?.();
      clearTimeout(espera);
    };
  }, []);

  if (listo) return <>{children}</>;
  if (estado && ACTUALIZANDO.includes(estado.estado))
    return (
      <PantallaCarga
        texto={estado.estado === "descargado" ? "Actualizacion lista. Abriendo la version nueva..." : "Actualizando a la version nueva. No lo cierre."}
        porcentaje={estado.estado === "descargando" ? estado.porcentaje ?? 0 : estado.estado === "descargado" ? 100 : undefined}
      />
    );
  return <PantallaCarga texto="Revisando actualizaciones..." />;
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

  const aplicacion = (
    <AuthProvider>
      <CajaProvider>
        <RutasProtegidas modoNube={redConfig.modo === "NUBE"} />
      </CajaProvider>
    </AuthProvider>
  );

  return (
    <>
      <UpdateBanner />
      {recuerdaSesion ? <ArranqueCaja>{aplicacion}</ArranqueCaja> : aplicacion}
    </>
  );
}
