import type { Empresa, InicializarEmpresa } from "./empresa-do";
import type { Registro } from "./registro-do";
import { firmarToken, verificarToken } from "./token";

export { Empresa } from "./empresa-do";
export { Registro } from "./registro-do";

interface Env {
  EMPRESAS: DurableObjectNamespace<Empresa>;
  REGISTRO: DurableObjectNamespace<Registro>;
  TOKEN_SECRET: string;
  ADMIN_KEY: string;
}

class ErrorHttp extends Error {
  constructor(public status: number, mensaje: string) {
    super(mensaje);
  }
}

function json(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });
}

function normalizarCodigo(codigo: unknown): string {
  const c = String(codigo ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(c)) {
    throw new ErrorHttp(400, "Codigo de empresa invalido (3-40 letras minusculas, numeros o guiones)");
  }
  return c;
}

async function leerJson(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    throw new ErrorHttp(400, "Cuerpo JSON invalido");
  }
}

function registro(env: Env) {
  return env.REGISTRO.get(env.REGISTRO.idFromName("global"));
}

function empresa(env: Env, codigo: string) {
  return env.EMPRESAS.get(env.EMPRESAS.idFromName(codigo));
}

async function exigirAdmin(req: Request, env: Env) {
  const recibida = new TextEncoder().encode(req.headers.get("X-Admin-Key") ?? "");
  const esperada = new TextEncoder().encode(env.ADMIN_KEY ?? "");
  const ok = esperada.length > 0 && recibida.length === esperada.length && crypto.subtle.timingSafeEqual(recibida, esperada);
  if (!ok) throw new ErrorHttp(401, "Clave de administrador incorrecta");
}

async function login(req: Request, env: Env): Promise<Response> {
  const body = await leerJson(req);
  const codigo = normalizarCodigo(body.empresa);
  if (!(await registro(env).existe(codigo))) throw new ErrorHttp(404, "Empresa no encontrada. Revisa el codigo de empresa.");

  let sesion;
  try {
    sesion = await empresa(env, codigo).login(String(body.usuario ?? ""), String(body.password ?? ""));
  } catch (err: any) {
    throw new ErrorHttp(401, err?.message ?? "Usuario o contrasena incorrectos");
  }
  const token = await firmarToken({ empresa: codigo, uid: sesion.id, usuario: sesion.usuario, rol: sesion.rol }, env.TOKEN_SECRET);
  return json({ resultado: { token, sesion, empresa: codigo } });
}

async function invoke(req: Request, env: Env): Promise<Response> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const datos = token ? await verificarToken(token, env.TOKEN_SECRET) : null;
  if (!datos) throw new ErrorHttp(401, "Sesion expirada. Vuelve a iniciar sesion.");

  const body = await leerJson(req);
  if (typeof body.canal !== "string") throw new ErrorHttp(400, "Falta el canal");
  try {
    const resultado = await empresa(env, datos.empresa).invoke(body.canal, Array.isArray(body.args) ? body.args : [], datos.rol);
    return json({ resultado: resultado ?? null });
  } catch (err: any) {
    const mensaje = err?.message ?? "Error en el servidor";
    throw new ErrorHttp(mensaje.startsWith("No tienes permiso") ? 403 : 400, mensaje);
  }
}

async function crearEmpresa(req: Request, env: Env): Promise<Response> {
  await exigirAdmin(req, env);
  const body = await leerJson(req);
  const codigo = normalizarCodigo(body.codigo);
  const nombre = String(body.nombre_empresa ?? "").trim();
  if (!nombre) throw new ErrorHttp(400, "Falta el nombre de la empresa");

  const datos: InicializarEmpresa = {
    empresa: { nombre_empresa: nombre, rnc: body.rnc ?? null, direccion: body.direccion ?? null, telefono: body.telefono ?? null },
    admin: { usuario: String(body.admin_usuario ?? ""), nombre: String(body.admin_nombre ?? ""), password: String(body.admin_password ?? "") },
    demo: body.demo === true,
  };

  const reg = registro(env);
  try {
    await reg.registrar(codigo, nombre);
  } catch (err: any) {
    throw new ErrorHttp(409, err?.message ?? "La empresa ya existe");
  }
  try {
    await empresa(env, codigo).inicializar(datos);
  } catch (err: any) {
    await reg.quitar(codigo);
    throw new ErrorHttp(400, err?.message ?? "No se pudo crear la empresa");
  }
  return json({ resultado: { codigo, nombre } }, 201);
}

async function enrutar(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const ruta = url.pathname.replace(/\/+$/, "");

  if (req.method === "GET" && ruta === "/health") return json({ ok: true });
  if (req.method === "POST" && ruta === "/api/login") return login(req, env);
  if (req.method === "POST" && ruta === "/api/invoke") return invoke(req, env);

  if (ruta === "/admin/empresas" && req.method === "POST") return crearEmpresa(req, env);
  if (ruta === "/admin/empresas" && req.method === "GET") {
    await exigirAdmin(req, env);
    return json({ resultado: await registro(env).listar() });
  }
  const exportar = ruta.match(/^\/admin\/empresas\/([^/]+)\/exportar$/);
  if (exportar && req.method === "GET") {
    await exigirAdmin(req, env);
    const codigo = normalizarCodigo(decodeURIComponent(exportar[1]));
    if (!(await registro(env).existe(codigo))) throw new ErrorHttp(404, "Empresa no encontrada");
    return json({ resultado: await empresa(env, codigo).exportar() });
  }

  throw new ErrorHttp(404, "Ruta no encontrada");
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      return await enrutar(req, env);
    } catch (err: any) {
      if (err instanceof ErrorHttp) return json({ error: err.message }, err.status);
      return json({ error: "Error interno del servidor" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
