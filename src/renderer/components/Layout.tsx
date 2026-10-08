import React from "react";
import { NavLink, Outlet } from "react-router-dom";
import { isPreviewMode } from "../lib/api";
import { esVariantCaja } from "../lib/variant";
import { useAuth } from "../lib/auth";
import ConnectionBanner from "./ConnectionBanner";
import Logo from "./Logo";

const NAV_COMPLETO = [
  {
    section: "General",
    items: [{ to: "/", label: "Panel Principal", end: true }],
  },
  {
    section: "Facturacion",
    items: [
      { to: "/facturas/nueva", label: "Nueva Factura" },
      { to: "/facturas", label: "Facturas", end: true },
      { to: "/cuentas-por-cobrar", label: "Cuentas por Cobrar" },
    ],
  },
  {
    section: "Caja",
    items: [
      { to: "/cierre-caja", label: "Cierre de Caja" },
      { to: "/cierres-caja", label: "Cierres de Caja" },
    ],
  },
  {
    section: "Clientes",
    items: [{ to: "/clientes", label: "Clientes" }],
  },
  {
    section: "Inventario",
    items: [
      { to: "/productos", label: "Productos" },
      { to: "/compras", label: "Compras" },
      { to: "/proveedores", label: "Proveedores" },
      { to: "/envases", label: "Control de Envases" },
    ],
  },
  {
    section: "Contabilidad",
    items: [
      { to: "/contabilidad/cuentas", label: "Catalogo de Cuentas" },
      { to: "/contabilidad/asientos", label: "Asientos / Libro Diario" },
      { to: "/contabilidad/libro-mayor", label: "Libro Mayor" },
      { to: "/contabilidad/balance-comprobacion", label: "Balance de Comprobacion" },
      { to: "/comprobantes", label: "Otros Comprobantes" },
    ],
  },
  {
    section: "Reportes",
    items: [
      { to: "/reportes/resultados", label: "Estado de Resultados" },
      { to: "/reportes/balance-general", label: "Balance General" },
      { to: "/reportes/itbis", label: "Reporte de ITBIS" },
    ],
  },
  {
    section: "Sistema",
    items: [{ to: "/configuracion", label: "Configuracion" }],
  },
];

const NAV_CAJA = [
  { section: "General", items: [{ to: "/", label: "Panel Principal", end: true }] },
  {
    section: "Venta Rapida",
    items: [
      { to: "/caja", label: "Caja / POS" },
      { to: "/cierre-caja", label: "Cierre de Caja" },
    ],
  },
  {
    section: "Facturacion",
    items: [
      { to: "/facturas/nueva", label: "Nueva Factura" },
      { to: "/facturas", label: "Facturas", end: true },
      { to: "/cuentas-por-cobrar", label: "Cuentas por Cobrar" },
    ],
  },
  { section: "Clientes", items: [{ to: "/clientes", label: "Clientes" }] },
  {
    section: "Inventario",
    items: [
      { to: "/productos", label: "Productos" },
      { to: "/envases", label: "Control de Envases" },
    ],
  },
  { section: "Sistema", items: [{ to: "/configuracion", label: "Configuracion" }] },
];

export default function Layout() {
  const { usuario, logout } = useAuth();

  const mostrarCaja = esVariantCaja || usuario?.rol === "CAJERO";
  const nav = (mostrarCaja ? NAV_CAJA : NAV_COMPLETO).filter((g) => g.section !== "Sistema" || usuario?.rol === "ADMIN");

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-100">
      <aside className="flex w-64 shrink-0 flex-col border-r border-slate-200 bg-slate-950 text-slate-200 print:hidden">
        <div className="flex items-center gap-2 px-5 py-5">
          <Logo size={36} className="rounded-[8px] ring-1 ring-white/15" />
          <div>
            <p className="text-sm font-semibold text-white">{esVariantCaja ? "Cajapunto1" : "Darasistema"}</p>
            <p className="text-[11px] text-slate-400">Gas · Oxigeno · Agua</p>
          </div>
        </div>
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
          {nav.map((group) => (
            <div key={group.section}>
              <p className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{group.section}</p>
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={(item as any).end}
                    className={({ isActive }) =>
                      `block rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
                        isActive ? "bg-brand-600 text-white" : "text-slate-300 hover:bg-slate-800 hover:text-white"
                      }`
                    }
                  >
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
        {isPreviewMode && (
          <div className="mx-3 mb-3 rounded-lg bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-300">
            Vista previa web: datos de ejemplo, sin guardar.
          </div>
        )}
        {usuario && (
          <div className="border-t border-slate-800 px-3 py-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-white">{usuario.nombre}</p>
                <p className="text-[11px] text-slate-400">{usuario.rol === "ADMIN" ? "Administrador" : "Cajero"}</p>
              </div>
              <button
                onClick={logout}
                title="Cerrar sesion"
                className="rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                Salir
              </button>
            </div>
          </div>
        )}
      </aside>
      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <ConnectionBanner />
        <div className="mx-auto w-full max-w-6xl px-8 py-7">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
