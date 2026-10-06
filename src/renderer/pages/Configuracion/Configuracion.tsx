import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { CompanyConfig, NcfSecuencia, RolUsuario, TipoNcf, Usuario } from "../../lib/types";
import { formatDate } from "../../lib/format";
import { NCF_LABELS, TODOS_LOS_TIPOS_NCF } from "../../lib/ncf";
import { esVariantCaja } from "../../lib/variant";
import { useAuth } from "../../lib/auth";
import { Badge, Button, Card, EmptyRow, Input, Modal, PageHeader, Select, Table } from "../../components/ui";

interface ConfigRedUI {
  modo: "SERVIDOR" | "CAJA_REMOTA";
  puerto: number;
  servidorUrl?: string;
  ips: string[];
}

export default function Configuracion() {
  const { usuario } = useAuth();
  const esAdmin = usuario?.rol === "ADMIN";
  const [config, setConfig] = useState<CompanyConfig | null>(null);
  const [secuencias, setSecuencias] = useState<NcfSecuencia[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ tipo: "B02" as TipoNcf, prefijo: "B02", desde: 1, hasta: 500, vencimiento: "" });

  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [usuarioModal, setUsuarioModal] = useState(false);
  const [usuarioForm, setUsuarioForm] = useState({ usuario: "", nombre: "", password: "", rol: "CAJERO" as RolUsuario });
  const [usuarioError, setUsuarioError] = useState("");
  const [passwordModal, setPasswordModal] = useState<Usuario | null>(null);
  const [nuevaPassword, setNuevaPassword] = useState("");

  const [configRed, setConfigRed] = useState<ConfigRedUI | null>(null);
  const [modoRedForm, setModoRedForm] = useState<"SERVIDOR" | "CAJA_REMOTA">("SERVIDOR");
  const [servidorUrlForm, setServidorUrlForm] = useState("");
  const [puertoForm, setPuertoForm] = useState(4500);
  const [probando, setProbando] = useState(false);
  const [resultadoPrueba, setResultadoPrueba] = useState<{ ok: boolean; error?: string } | null>(null);
  const [guardandoRed, setGuardandoRed] = useState(false);

  async function cargar() {
    const [c, s, r] = await Promise.all([api.config.obtener(), api.ncf.listar(), api.red.obtenerConfig()]);
    setConfig(c);
    setSecuencias(s);
    setConfigRed(r as ConfigRedUI);
    setModoRedForm((r as ConfigRedUI).modo);
    setServidorUrlForm((r as ConfigRedUI).servidorUrl ?? "");
    setPuertoForm((r as ConfigRedUI).puerto);
    if (esAdmin) {
      api.usuarios.listar().then(setUsuarios);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  async function guardarConfig(e: React.FormEvent) {
    e.preventDefault();
    if (!config) return;
    setGuardando(true);
    try {
      await api.config.actualizar(config);
      setGuardado(true);
      setTimeout(() => setGuardado(false), 2000);
    } finally {
      setGuardando(false);
    }
  }

  async function probarConexion() {
    setProbando(true);
    setResultadoPrueba(null);
    try {
      const r = await api.red.probarConexion(servidorUrlForm);
      setResultadoPrueba(r as any);
    } finally {
      setProbando(false);
    }
  }

  async function guardarConfigRed() {
    setGuardandoRed(true);
    try {
      await api.red.guardarConfig({
        modo: modoRedForm,
        puerto: puertoForm,
        servidorUrl: modoRedForm === "CAJA_REMOTA" ? servidorUrlForm : undefined,
      });
      await api.app.reiniciar();
    } finally {
      setGuardandoRed(false);
    }
  }

  async function crearSecuencia(e: React.FormEvent) {
    e.preventDefault();
    await api.ncf.crear({ ...form, actual: form.desde, prefijo: form.tipo });
    setOpen(false);
    await cargar();
  }

  async function crearUsuario(e: React.FormEvent) {
    e.preventDefault();
    setUsuarioError("");
    try {
      await api.usuarios.crear(usuarioForm);
      setUsuarioModal(false);
      setUsuarioForm({ usuario: "", nombre: "", password: "", rol: "CAJERO" });
      await cargar();
    } catch (err: any) {
      setUsuarioError(err?.message ?? "No se pudo crear el usuario");
    }
  }

  async function toggleActivo(u: Usuario) {
    await api.usuarios.actualizar(u.id, { activo: u.activo ? 0 : 1 });
    await cargar();
  }

  async function cambiarPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!passwordModal || !nuevaPassword) return;
    await api.usuarios.actualizar(passwordModal.id, { password: nuevaPassword });
    setPasswordModal(null);
    setNuevaPassword("");
  }

  if (!config) return <p className="text-sm text-slate-400">Cargando...</p>;

  return (
    <div>
      <PageHeader
        title="Configuracion"
        subtitle={esVariantCaja ? "Conexion de esta caja con el servidor" : "Datos de la empresa, tasa de ITBIS y secuencias de NCF"}
      />

      {!esVariantCaja && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Datos de la empresa</h2>
            <form onSubmit={guardarConfig} className="space-y-3">
              <Input label="Nombre de la empresa" value={config.nombre_empresa} onChange={(e) => setConfig({ ...config, nombre_empresa: e.target.value })} />
              <Input label="RNC" value={config.rnc ?? ""} onChange={(e) => setConfig({ ...config, rnc: e.target.value })} />
              <Input label="Direccion" value={config.direccion ?? ""} onChange={(e) => setConfig({ ...config, direccion: e.target.value })} />
              <Input label="Telefono" value={config.telefono ?? ""} onChange={(e) => setConfig({ ...config, telefono: e.target.value })} />
              <Input
                label="Tasa de ITBIS (%)"
                type="number"
                step="0.01"
                value={config.itbis_rate * 100}
                onChange={(e) => setConfig({ ...config, itbis_rate: Number(e.target.value) / 100 })}
              />
              <div className="flex items-center gap-2 pt-1">
                <Button type="submit" disabled={guardando}>
                  {guardando ? "Guardando..." : "Guardar cambios"}
                </Button>
                {guardado && <span className="text-sm text-emerald-600">Guardado</span>}
              </div>
            </form>
          </Card>

          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700">Secuencias de NCF</h2>
              <Button size="sm" onClick={() => setOpen(true)}>
                + Nueva secuencia
              </Button>
            </div>
            <Table columns={["Tipo", "Rango", "Actual", "Vence", "Estado"]}>
              {secuencias.length === 0 && <EmptyRow colSpan={5} />}
              {secuencias.map((s) => {
                const agotada = s.actual > s.hasta;
                return (
                  <tr key={s.id}>
                    <td className="px-4 py-2 text-xs">{NCF_LABELS[s.tipo]}</td>
                    <td className="px-4 py-2 text-xs text-slate-500">
                      {s.desde} - {s.hasta}
                    </td>
                    <td className="px-4 py-2">{s.actual}</td>
                    <td className="px-4 py-2 text-xs text-slate-500">{formatDate(s.vencimiento)}</td>
                    <td className="px-4 py-2">
                      <Badge tone={agotada ? "red" : "green"}>{agotada ? "Agotada" : "Activa"}</Badge>
                    </td>
                  </tr>
                );
              })}
            </Table>
          </div>
        </div>
      )}

      {esAdmin && !esVariantCaja && (
        <Card className="mt-5 p-5">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-700">Usuarios y permisos</h2>
              <p className="text-xs text-slate-400">Administradores ven todo el sistema; cajeros solo la caja y facturacion.</p>
            </div>
            <Button size="sm" onClick={() => setUsuarioModal(true)}>
              + Nuevo usuario
            </Button>
          </div>
          <Table columns={["Usuario", "Nombre", "Rol", "Estado", "Acciones"]}>
            {usuarios.length === 0 && <EmptyRow colSpan={5} />}
            {usuarios.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-2 text-sm font-medium text-slate-800">{u.usuario}</td>
                <td className="px-4 py-2 text-sm text-slate-600">{u.nombre}</td>
                <td className="px-4 py-2">
                  <Badge tone={u.rol === "ADMIN" ? "blue" : "slate"}>{u.rol === "ADMIN" ? "Administrador" : "Cajero"}</Badge>
                </td>
                <td className="px-4 py-2">
                  <Badge tone={u.activo ? "green" : "red"}>{u.activo ? "Activo" : "Inactivo"}</Badge>
                </td>
                <td className="px-4 py-2">
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => toggleActivo(u)}>
                      {u.activo ? "Desactivar" : "Activar"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setPasswordModal(u)}>
                      Cambiar clave
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <Card className="mt-5 p-5">
        <h2 className="mb-1 text-sm font-semibold text-slate-700">Red / Conexion en Caja</h2>
        <p className="mb-3 text-sm text-slate-500">
          Decide si esta computadora guarda los datos (Servidor) o si se conecta a otra computadora de la red para facturar (Caja Remota).
          Util solo si vas a usar mas de una computadora al mismo tiempo (una en la oficina, otra en el mostrador).
        </p>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div className="space-y-3">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setModoRedForm("SERVIDOR")}
                className={`flex-1 rounded-lg border px-3 py-2.5 text-left text-sm ${modoRedForm === "SERVIDOR" ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600"}`}
              >
                <span className="block font-medium">Servidor</span>
                <span className="block text-xs text-slate-400">Esta computadora tiene los datos</span>
              </button>
              <button
                type="button"
                onClick={() => setModoRedForm("CAJA_REMOTA")}
                className={`flex-1 rounded-lg border px-3 py-2.5 text-left text-sm ${modoRedForm === "CAJA_REMOTA" ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600"}`}
              >
                <span className="block font-medium">Caja Remota</span>
                <span className="block text-xs text-slate-400">Se conecta a otra computadora</span>
              </button>
            </div>

            {modoRedForm === "SERVIDOR" && (
              <Input label="Puerto" type="number" value={puertoForm} onChange={(e) => setPuertoForm(Number(e.target.value))} />
            )}

            {modoRedForm === "CAJA_REMOTA" && (
              <>
                <Input
                  label="Direccion del servidor"
                  placeholder="http://192.168.1.45:4500"
                  value={servidorUrlForm}
                  onChange={(e) => setServidorUrlForm(e.target.value)}
                />
                <div className="flex items-center gap-2">
                  <Button type="button" variant="secondary" size="sm" onClick={probarConexion} disabled={probando || !servidorUrlForm}>
                    {probando ? "Probando..." : "Probar conexion"}
                  </Button>
                  {resultadoPrueba && (
                    <span className={`text-sm ${resultadoPrueba.ok ? "text-emerald-600" : "text-red-600"}`}>
                      {resultadoPrueba.ok ? "Conexion exitosa" : resultadoPrueba.error ?? "No se pudo conectar"}
                    </span>
                  )}
                </div>
              </>
            )}

            <Button onClick={guardarConfigRed} disabled={guardandoRed || (modoRedForm === "CAJA_REMOTA" && !servidorUrlForm)}>
              {guardandoRed ? "Guardando..." : "Guardar y reiniciar"}
            </Button>
          </div>

          <div className="rounded-lg bg-slate-50 p-4 text-sm">
            <p className="font-medium text-slate-700">Estado actual</p>
            <p className="mt-1 text-slate-500">
              Modo: <span className="font-semibold text-slate-700">{configRed?.modo === "CAJA_REMOTA" ? "Caja Remota" : "Servidor"}</span>
            </p>
            {configRed?.modo === "SERVIDOR" && (
              <>
                <p className="mt-2 text-slate-500">Otras cajas se pueden conectar a:</p>
                {configRed.ips.length === 0 && <p className="text-xs text-amber-600">No se detecto una red local activa.</p>}
                <ul className="mt-1 space-y-0.5">
                  {configRed?.ips.map((ip) => (
                    <li key={ip} className="font-mono text-xs text-brand-700">
                      http://{ip}:{configRed.puerto}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {configRed?.modo === "CAJA_REMOTA" && <p className="mt-2 font-mono text-xs text-slate-600">{configRed.servidorUrl}</p>}
          </div>
        </div>
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="Nueva secuencia NCF">
        <form onSubmit={crearSecuencia} className="space-y-3">
          <Select label="Tipo de comprobante" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value as TipoNcf })}>
            {TODOS_LOS_TIPOS_NCF.map((t) => (
              <option key={t} value={t}>
                {NCF_LABELS[t]}
              </option>
            ))}
          </Select>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Desde" type="number" value={form.desde} onChange={(e) => setForm({ ...form, desde: Number(e.target.value) })} />
            <Input label="Hasta" type="number" value={form.hasta} onChange={(e) => setForm({ ...form, hasta: Number(e.target.value) })} />
          </div>
          <Input label="Fecha de vencimiento" type="date" value={form.vencimiento} onChange={(e) => setForm({ ...form, vencimiento: e.target.value })} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit">Guardar</Button>
          </div>
        </form>
      </Modal>

      <Modal open={usuarioModal} onClose={() => setUsuarioModal(false)} title="Nuevo usuario">
        <form onSubmit={crearUsuario} className="space-y-3">
          <Input
            label="Usuario"
            value={usuarioForm.usuario}
            onChange={(e) => setUsuarioForm({ ...usuarioForm, usuario: e.target.value })}
            placeholder="ej. juan"
          />
          <Input
            label="Nombre completo"
            value={usuarioForm.nombre}
            onChange={(e) => setUsuarioForm({ ...usuarioForm, nombre: e.target.value })}
            placeholder="ej. Juan Perez"
          />
          <Input
            label="Contrasena"
            type="password"
            value={usuarioForm.password}
            onChange={(e) => setUsuarioForm({ ...usuarioForm, password: e.target.value })}
          />
          <Select label="Rol" value={usuarioForm.rol} onChange={(e) => setUsuarioForm({ ...usuarioForm, rol: e.target.value as RolUsuario })}>
            <option value="CAJERO">Cajero (solo caja y facturacion)</option>
            <option value="ADMIN">Administrador (todo el sistema)</option>
          </Select>
          {usuarioError && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{usuarioError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setUsuarioModal(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!usuarioForm.usuario.trim() || !usuarioForm.password}>
              Guardar
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!passwordModal} onClose={() => setPasswordModal(null)} title={`Cambiar contrasena de ${passwordModal?.usuario ?? ""}`}>
        <form onSubmit={cambiarPassword} className="space-y-3">
          <Input label="Nueva contrasena" type="password" value={nuevaPassword} onChange={(e) => setNuevaPassword(e.target.value)} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setPasswordModal(null)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!nuevaPassword}>
              Guardar
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
