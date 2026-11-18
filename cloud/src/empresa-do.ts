import { DurableObject } from "cloudflare:workers";
import { conRegistro, type Handler } from "./electron-shim";
import { DurableObjectDB } from "./do-db";
import { puedeInvocar, type Rol } from "./permisos";
import { SCHEMA_SQL } from "../../electron/db/schema";
import { migrar } from "../../electron/db/migraciones";
import { seedCatalogo, seedDemo, seedDemoColmado, type DatosEmpresa } from "../../electron/db/seed";
import { nuevoPasswordHash } from "../../electron/db/password";
import { registerCuentasIpc } from "../../electron/ipc/cuentas";
import { registerAsientosIpc } from "../../electron/ipc/asientos";
import { registerClientesIpc } from "../../electron/ipc/clientes";
import { registerProductosIpc } from "../../electron/ipc/productos";
import { registerFacturasIpc } from "../../electron/ipc/facturas";
import { registerCobrosIpc } from "../../electron/ipc/cobros";
import { registerEnvasesIpc } from "../../electron/ipc/envases";
import { registerReportesIpc } from "../../electron/ipc/reportes";
import { registerConfigIpc } from "../../electron/ipc/config";
import { registerComprobantesIpc } from "../../electron/ipc/comprobantes";
import { registerAuthIpc } from "../../electron/ipc/auth";
import { registerComprasIpc } from "../../electron/ipc/compras";
import { registerProveedoresIpc } from "../../electron/ipc/proveedores";
import { registerCajaIpc } from "../../electron/ipc/caja";
import { registerGastosIpc } from "../../electron/ipc/gastos";
import { registerBancosIpc } from "../../electron/ipc/bancos";
import { registerPlatosIpc } from "../../electron/ipc/platos";
import { registerPiezasIpc } from "../../electron/ipc/piezas";
import { registerNominaIpc } from "../../electron/ipc/nomina";
import { registerEcfIpc, type ServicioEcf } from "../../electron/ipc/ecf";
import type { ConfigEcf } from "../../electron/shared/ecf";

export interface InicializarEmpresa {
  empresa: DatosEmpresa;
  rubro?: "gas" | "colmado";
  admin: { usuario: string; nombre: string; password: string };
  demo: boolean;
}

export interface SesionEmpresa {
  id: number;
  usuario: string;
  nombre: string;
  rol: Rol;
}

const MAX_FALLOS = 5;
const CANALES_CON_AUTOR = new Set(["facturas:crear", "recibos:crear", "gastos:crear"]);
// Canales de caja: en que argumento va el objeto donde se inyecta { autor } desde la sesion.
const CANALES_CAJA_AUTOR: Record<string, number> = {
  "caja:abrir": 0,
  "caja:cerrar": 0,
  "caja:movimiento": 0,
  // la compra puede traer piezas o salir del efectivo de la caja: queda a nombre de quien la registra
  "compras:crear": 0,
  // borrar un producto definitivamente queda en la auditoria a nombre de quien lo hizo
  "productos:eliminar": 1,
  "caja:misCierres": 0,
  "caja:detalle": 1,
  "cajas:crear": 0,
  "cajas:actualizar": 1,
  "cierres:corregir": 0,
  "usuarios:eliminar": 1,
  "platos:guardar": 0,
  "platos:quitar": 0,
  "platos:copiar": 0,
  "mercancias:guardar": 0,
  "mercancias:quitar": 0,
  "piezas:comprar": 0,
  "piezas:terminar": 0,
  "piezas:quitar": 0,
  // la nomina queda a nombre de quien paga
  "nomina:pagar": 0,
  "nomina:anular": 0,
  // cambiar el modo de la factura electronica queda a nombre de quien lo hizo
  "ecf:cambiarModo": 0,
};
const BLOQUEO_MS = 10 * 60 * 1000;

// Una instancia por empresa cliente: su propia base SQLite, aislada del resto.
export class Empresa extends DurableObject {
  private db: DurableObjectDB;
  private handlers: Record<string, Handler> = {};

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as any);
    this.db = new DurableObjectDB(ctx.storage);
    this.prepararEsquema();

    const db = this.db;
    conRegistro(this.handlers, () => {
      registerCuentasIpc(db);
      registerAsientosIpc(db);
      registerClientesIpc(db);
      registerProductosIpc(db);
      registerFacturasIpc(db);
      registerCobrosIpc(db);
      registerEnvasesIpc(db);
      registerReportesIpc(db);
      registerConfigIpc(db);
      registerComprobantesIpc(db);
      registerAuthIpc(db);
      registerComprasIpc(db);
      registerProveedoresIpc(db);
      registerCajaIpc(db);
      registerGastosIpc(db);
      registerBancosIpc(db);
      registerPlatosIpc(db);
      registerPiezasIpc(db);
      registerNominaIpc(db);
      registerEcfIpc(db, this.servicioEcf());
    });
  }

  // ---------- facturacion electronica (ef2) ----------
  // La configuracion (modo apagado / prueba / real y los datos del emisor) vive en _meta: la pone el administrador de Darasistema.
  // El token de ef2 NO esta aqui ni en el codigo: es un secreto de Cloudflare (EF2_TOKENS) con una clave por empresa.
  ecfConfig(): ConfigEcf & { token_clave?: string } {
    const fila = this.db.prepare(`SELECT valor FROM _meta WHERE clave = 'ecf_config'`).get() as { valor: string } | undefined;
    try {
      const c = fila ? JSON.parse(fila.valor) : {};
      return { ...c, modo: c.modo === "prueba" || c.modo === "real" ? c.modo : "apagado" };
    } catch {
      return { modo: "apagado" };
    }
  }

  ecfConfigurar(cambios: Partial<ConfigEcf> & { token_clave?: string }): ConfigEcf & { token_clave?: string; token_cargado: boolean } {
    const permitidos = ["modo", "token_clave", "razon_social", "nombre_comercial", "direccion", "correo", "telefono", "municipio", "provincia", "vencimiento_31", "vencimiento_45", "tope_consumo_sin_comprador"];
    const nuevo: Record<string, unknown> = { ...this.ecfConfig() };
    for (const [k, v] of Object.entries(cambios ?? {})) if (permitidos.includes(k)) nuevo[k] = v;
    if (!["apagado", "prueba", "real"].includes(String(nuevo.modo))) throw new Error("El modo debe ser apagado, prueba o real");
    if (nuevo.modo !== "apagado" && !this.tokenEcf(nuevo.token_clave as string | undefined)) {
      throw new Error("Este servidor no tiene el token de ef2 para esa empresa (secreto EF2_TOKENS)");
    }
    this.db.prepare(`INSERT INTO _meta (clave, valor) VALUES ('ecf_config', @v) ON CONFLICT(clave) DO UPDATE SET valor = @v`).run({ v: JSON.stringify(nuevo) });
    const c = this.ecfConfig();
    return { ...c, token_cargado: !!this.tokenEcf(c.token_clave) };
  }

  // Prueba de conexion con ef2 desde la nube (no emite nada): pide la lista de tipos de comprobante. Sirve para saber
  // si el token vale y si ef2 acepta las peticiones que salen de Cloudflare (podria tener una lista de IP permitidas).
  async ecfProbar(): Promise<{ http: number; ok: boolean; tipos: string[]; mensaje: string | null }> {
    const { http, cuerpo } = await this.servicioEcf().llamar("GET", "/ecf_secuencia_api.php?resource=tipos_ecf");
    const tipos = Array.isArray(cuerpo?.data) ? cuerpo.data.map((t: any) => String(t?.prefijo ?? "")).filter(Boolean) : [];
    return { http, ok: http === 200 && tipos.length > 0, tipos, mensaje: http === 200 ? null : String(cuerpo?.message ?? cuerpo?.error ?? "sin detalle").slice(0, 200) };
  }

  private tokenEcf(clave?: string): string | null {
    if (!clave) return null;
    try {
      const tokens = JSON.parse(((this.env as any)?.EF2_TOKENS as string | undefined) ?? "{}");
      const t = tokens?.[clave];
      return typeof t === "string" && t.startsWith("tok_") ? t : null;
    } catch {
      return null;
    }
  }

  private servicioEcf(): ServicioEcf {
    return {
      config: () => this.ecfConfig(),
      cambiarModo: (modo) => this.ecfConfigurar({ modo }),
      ajustes: () => {
        const c = this.ecfConfig();
        return { tokenCargado: !!this.tokenEcf(c.token_clave), correo: c.correo?.trim() || null, razonSocial: (c.razon_social || c.nombre_comercial)?.trim() || null };
      },
      llamar: async (metodo, ruta, cuerpo) => {
        const token = this.tokenEcf(this.ecfConfig().token_clave);
        if (!token) throw new Error("Falta el token de ef2 en el servidor");
        const base = ((this.env as any)?.EF2_BASE as string | undefined) ?? "https://master.ef2.do/api2";
        const control = new AbortController();
        // ef2 emite de forma sincrona con la DGII: puede tardar. Se espera hasta casi 2 minutos.
        const corte = setTimeout(() => control.abort(), 115_000);
        try {
          const r = await fetch(base + ruta, {
            method: metodo,
            headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(cuerpo !== undefined ? { "Content-Type": "application/json" } : {}) },
            body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
            signal: control.signal,
          });
          const texto = await r.text();
          let json: any = null;
          try {
            json = JSON.parse(texto);
          } catch {
            json = { success: false, message: texto.slice(0, 300) };
          }
          return { http: r.status, cuerpo: json };
        } finally {
          clearTimeout(corte);
        }
      },
    };
  }

  private prepararEsquema() {
    this.db.exec(SCHEMA_SQL);
    this.db.exec(`CREATE TABLE IF NOT EXISTS _meta (clave TEXT PRIMARY KEY, valor TEXT)`);
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS _login_intentos (
         usuario TEXT PRIMARY KEY,
         fallos INTEGER NOT NULL DEFAULT 0,
         bloqueado_hasta INTEGER NOT NULL DEFAULT 0
       )`
    );
    migrar(this.db);
  }

  private inicializada(): boolean {
    return !!this.db.prepare(`SELECT valor FROM _meta WHERE clave = 'inicializada'`).get();
  }

  inicializar(datos: InicializarEmpresa): void {
    if (this.inicializada()) throw new Error("Esta empresa ya fue creada");
    const usuario = datos.admin.usuario.trim().toLowerCase();
    if (!usuario) throw new Error("El usuario administrador es obligatorio");
    if (!datos.admin.password || datos.admin.password.length < 6) {
      throw new Error("La contrasena del administrador debe tener al menos 6 caracteres");
    }

    this.db.transaction(() => {
      const rubro = datos.rubro === "colmado" ? "colmado" : "gas";
      seedCatalogo(this.db, datos.empresa, rubro);
      if (datos.demo) {
        if (rubro === "colmado") seedDemoColmado(this.db);
        else seedDemo(this.db);
      }
      this.db
        .prepare(`INSERT INTO usuarios (usuario, nombre, password_hash, rol, activo) VALUES (@usuario, @nombre, @password_hash, 'ADMIN', 1)`)
        .run({ usuario, nombre: datos.admin.nombre || usuario, password_hash: nuevoPasswordHash(datos.admin.password) });
      this.db.prepare(`INSERT INTO _meta (clave, valor) VALUES ('inicializada', @fecha)`).run({ fecha: new Date().toISOString() });
    })();
  }

  login(usuario: string, password: string): SesionEmpresa {
    const nombre = (usuario ?? "").trim().toLowerCase();
    const ahora = Date.now();
    const intento = this.db.prepare(`SELECT fallos, bloqueado_hasta FROM _login_intentos WHERE usuario = ?`).get(nombre) as
      | { fallos: number; bloqueado_hasta: number }
      | undefined;

    if (intento && intento.bloqueado_hasta > ahora) {
      const minutos = Math.ceil((intento.bloqueado_hasta - ahora) / 60000);
      throw new Error(`Demasiados intentos fallidos. Intenta de nuevo en ${minutos} minuto(s).`);
    }

    try {
      const sesion = this.handlers["auth:login"]({}, nombre, password) as SesionEmpresa;
      this.db.prepare(`DELETE FROM _login_intentos WHERE usuario = ?`).run(nombre);
      return sesion;
    } catch (err) {
      const fallos = (intento?.fallos ?? 0) + 1;
      const bloqueo = fallos >= MAX_FALLOS ? ahora + BLOQUEO_MS : 0;
      this.db
        .prepare(
          `INSERT INTO _login_intentos (usuario, fallos, bloqueado_hasta) VALUES (@usuario, @fallos, @bloqueo)
           ON CONFLICT(usuario) DO UPDATE SET fallos = @fallos, bloqueado_hasta = @bloqueo`
        )
        .run({ usuario: nombre, fallos: bloqueo ? 0 : fallos, bloqueo });
      throw err;
    }
  }

  async invoke(canal: string, args: unknown[], rol: Rol, uid?: number, empresa?: string): Promise<unknown> {
    // Un usuario eliminado o desactivado no sigue entrando con la sesion que tenia guardada
    // (la caja la recuerda 30 dias); y si le cambiaron el rol, vale el de ahora.
    if (uid) {
      const actual = this.db.prepare(`SELECT rol, activo FROM usuarios WHERE id = ?`).get(uid) as { rol: Rol; activo: number } | undefined;
      if (!actual || !actual.activo) throw new Error("Sesion expirada. Vuelve a iniciar sesion.");
      rol = actual.rol;
    }
    if (!puedeInvocar(rol, canal, empresa)) throw new Error("No tienes permiso para esta operacion");
    const handler = this.handlers[canal];
    if (!handler) throw new Error(`Operacion desconocida: ${canal}`);
    const lista = [...(args ?? [])];
    // Quien hizo la operacion sale de la sesion, no de lo que mande la pantalla.
    if (CANALES_CON_AUTOR.has(canal) && lista[0] && typeof lista[0] === "object") {
      const u = uid ? (this.db.prepare(`SELECT nombre FROM usuarios WHERE id = ?`).get(uid) as { nombre: string } | undefined) : undefined;
      lista[0] = { ...(lista[0] as object), creado_por: u?.nombre ?? null };
    }
    if (canal === "facturas:crear" && lista[0] && typeof lista[0] === "object") {
      // Con facturacion electronica encendida el numero lo da el proveedor; lo que mande la pantalla no cuenta.
      const modo = this.ecfConfig().modo;
      const { ncf_diferido: _a, ecf_modo: _b, ...limpio } = lista[0] as Record<string, unknown>;
      // real: la factura espera su e-NCF. prueba: sigue con su NCF B normal y la proforma sale aparte.
      lista[0] = modo === "apagado" ? limpio : { ...limpio, ncf_diferido: modo === "real", ecf_modo: modo };
    }
    const posAutor = CANALES_CAJA_AUTOR[canal];
    if (posAutor !== undefined) {
      const u = uid ? (this.db.prepare(`SELECT id, nombre, rol FROM usuarios WHERE id = ?`).get(uid) as { id: number; nombre: string; rol: Rol } | undefined) : undefined;
      if (!u) throw new Error("Sesion expirada. Vuelve a iniciar sesion.");
      while (lista.length <= posAutor) lista.push(undefined);
      const base = lista[posAutor] && typeof lista[posAutor] === "object" ? (lista[posAutor] as object) : {};
      lista[posAutor] = { ...base, autor: { id: u.id, nombre: u.nombre, rol: u.rol } };
    }
    let resultado = await handler({}, ...lista);
    // Con la facturacion electronica encendida la factura se emite aqui mismo, al crearla: asi no depende de que la
    // caja (aunque sea una version vieja) pida el comprobante, y la respuesta ya trae el e-NCF. Si ef2 falla, la venta
    // NO se pierde: queda anotado en ecf_documentos para reintentar (la caja nueva muestra el aviso y un boton).
    if (canal === "facturas:crear" && resultado?.id && this.ecfConfig().modo !== "apagado") {
      try {
        await this.handlers["ecf:emitir"]({}, resultado.id);
      } catch (err: any) {
        this.db
          .prepare(`UPDATE ecf_documentos SET estado = 'ERROR', mensaje = ? WHERE factura_id = ? AND clase = 'FACTURA' AND estado = 'PENDIENTE'`)
          .run(String(err?.message ?? "No se pudo emitir el comprobante electronico").slice(0, 300), resultado.id);
      }
      resultado = this.db.prepare(`SELECT * FROM facturas WHERE id = ?`).get(resultado.id) ?? resultado;
    }
    // Anular una factura electronica en modo real: la nota de credito electronica sale sola. Si ef2 falla,
    // la anulacion en el sistema ya quedo hecha y la nota queda pendiente para reenviarla (no se pierde).
    if (canal === "facturas:anular" && typeof lista[0] === "number" && this.ecfConfig().modo === "real") {
      try {
        await this.handlers["ecf:anularFactura"]({}, lista[0], typeof lista[1] === "string" ? lista[1] : undefined);
      } catch {
        /* queda anotado en ecf_documentos */
      }
    }
    return resultado;
  }

  // Deja la empresa como recien creada para empezar a usarla de verdad: borra ventas, clientes,
  // productos, compras, proveedores, NCF y cajas de prueba. Conserva el codigo, los usuarios
  // (con sus contrasenas), los datos de la empresa y el catalogo de cuentas.
  // (Cloudflare guarda 30 dias de historial por si hiciera falta recuperar algo.)
  // Corrige los datos del negocio (nombre, RNC, direccion, telefono) desde la administracion de Darasistema,
  // sin entrar con el usuario de la empresa. Lo demas de la configuracion queda igual.
  async datosEmpresa(cambios: { nombre_empresa?: string; rnc?: string; direccion?: string; telefono?: string }): Promise<unknown> {
    const actual = this.db.prepare(`SELECT * FROM company_config WHERE id = 1`).get() as Record<string, unknown> | undefined;
    if (!actual) throw new Error("La empresa no tiene configuracion");
    const limpios = Object.fromEntries(
      Object.entries(cambios).filter(([k, v]) => ["nombre_empresa", "rnc", "direccion", "telefono"].includes(k) && typeof v === "string").map(([k, v]) => [k, (v as string).trim()])
    );
    await this.handlers["config:actualizar"]({}, { ...actual, ...limpios });
    return this.db.prepare(`SELECT nombre_empresa, rnc, direccion, telefono FROM company_config WHERE id = 1`).get();
  }

  vaciar(): Record<string, number> {
    // Primero los detalles y despues lo principal, para respetar las relaciones entre tablas.
    const tablas = [
      "factura_lineas", "piezas", "notas_factura", "platos_dia", "cobros", "recibos_cobro", "envase_movimientos", "envases_cliente", "botellas_fiadas", "caja_movimientos", "caja_correcciones",
      "pagos_compra", "compra_lineas", "producto_proveedor", "comprobantes_varios", "pagos_gasto", "gastos", "banco_movimientos",
      "ecf_documentos", "facturas", "compras", "caja_sesiones", "cajas",
      "asiento_lineas", "asientos",
      "proveedores", "productos", "mercancias", "clientes", "ncf_secuencias", "auditoria", "_login_intentos",
    ];
    const borradas: Record<string, number> = {};
    this.db.transaction(() => {
      for (const t of tablas) {
        borradas[t] = (this.db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number }).n;
        this.db.exec(`DELETE FROM "${t}"`);
      }
      this.db.exec(`INSERT INTO clientes (codigo, nombre, rnc_cedula, tipo, telefono, email, direccion, activo) VALUES ('CLI-0000', 'Consumidor Final', '', 'FISICA', '', '', '', 1)`);
      this.db.exec(`INSERT INTO cajas (nombre) VALUES ('Caja principal')`);
    })();
    return borradas;
  }

  /**
   * Borra el historial de ventas (facturas, notas, comprobantes electronicos, cobros, cilindros prestados, cierres y movimientos de caja)
   * y los asientos contables que esas ventas generaron. NO toca clientes, productos (ni su existencia), proveedores, compras, gastos,
   * secuencias de NCF (para no repetir numeros), usuarios ni configuracion.
   */
  limpiarHistorial(): Record<string, number> {
    // Detalles primero, despues lo principal.
    const tablas = [
      "factura_lineas", "notas_factura", "ecf_documentos", "cobros", "recibos_cobro",
      "envase_movimientos", "botellas_fiadas", "envases_cliente",
      "caja_movimientos", "caja_correcciones", "facturas", "caja_sesiones",
    ];
    const borradas: Record<string, number> = {};
    this.db.transaction(() => {
      // asientos de lo que se va a borrar (solo los que ninguna tabla que se queda usa)
      const todas = (this.db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'`).all() as { name: string }[]).map((t) => t.name);
      const conAsiento = (t: string) => (this.db.prepare(`PRAGMA table_info("${t}")`).all() as { name: string }[]).filter((c) => c.name === "asiento_id" || c.name === "asiento_diferencia_id").map((c) => c.name);
      const idsAsiento = new Set<number>();
      for (const t of tablas) {
        for (const col of conAsiento(t)) {
          for (const r of this.db.prepare(`SELECT "${col}" AS id FROM "${t}" WHERE "${col}" IS NOT NULL`).all() as { id: number }[]) idsAsiento.add(r.id);
        }
      }
      for (const t of todas) {
        if (tablas.includes(t) || t === "asientos" || t === "asiento_lineas") continue;
        for (const col of conAsiento(t)) {
          for (const r of this.db.prepare(`SELECT "${col}" AS id FROM "${t}" WHERE "${col}" IS NOT NULL`).all() as { id: number }[]) idsAsiento.delete(r.id);
        }
      }
      // las nominas guardan la jornada de caja donde se pagaron: se conserva la nomina, se suelta la jornada
      this.db.exec(`UPDATE nominas SET caja_sesion_id = NULL WHERE caja_sesion_id IS NOT NULL`);
      for (const t of tablas) {
        borradas[t] = (this.db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number }).n;
        this.db.exec(`DELETE FROM "${t}"`);
      }
      let asientos = 0;
      for (const id of idsAsiento) {
        this.db.prepare(`DELETE FROM asiento_lineas WHERE asiento_id = ?`).run(id);
        asientos += this.db.prepare(`DELETE FROM asientos WHERE id = ?`).run(id).changes;
      }
      borradas["asientos"] = asientos;
    })();
    return borradas;
  }

  exportar(): Record<string, unknown[]> {
    const tablas = this.db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'`)
      .all() as { name: string }[];
    const resultado: Record<string, unknown[]> = {};
    for (const { name } of tablas) {
      resultado[name] = this.db.prepare(`SELECT * FROM "${name}"`).all();
    }
    return resultado;
  }

  // Borra todos los datos de la empresa (cuando un cliente deja el sistema).
  // Cloudflare guarda 30 dias de historial, asi que se puede recuperar si fue un error.
  async borrar(): Promise<void> {
    await this.ctx.storage.deleteAll();
    this.prepararEsquema();
  }
}
