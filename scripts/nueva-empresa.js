// Da de alta un cliente nuevo (empresa) en el servidor en la nube.
// Uso:  npm run nube:nueva-empresa     -> pregunta los datos
//       npm run nube:empresas          -> lista las empresas creadas
//       npm run nube:borrar-empresa -- <codigo>  -> borra una empresa y todos sus datos
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline/promises");

const NUBE_URL = process.env.DARASISTEMA_NUBE_URL || "https://darasistema.ranghd732.workers.dev";
const RUTA_CLAVE = path.join(__dirname, "..", "cloud", ".admin-key");

function claveAdmin() {
  try {
    return fs.readFileSync(RUTA_CLAVE, "utf-8").trim();
  } catch {
    console.error(`No se encontro la clave de administrador en ${RUTA_CLAVE}.`);
    console.error("Esa clave se genero al publicar el servidor; sin ella no se pueden crear empresas.");
    process.exit(1);
  }
}

async function pedir(url, opciones = {}) {
  const res = await fetch(NUBE_URL + url, {
    ...opciones,
    headers: { "Content-Type": "application/json", "X-Admin-Key": claveAdmin(), ...(opciones.headers || {}) },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Error del servidor (${res.status})`);
  return json.resultado;
}

async function listar() {
  const empresas = await pedir("/admin/empresas");
  if (empresas.length === 0) return console.log("Todavia no hay empresas.");
  console.table(empresas.map((e) => ({ codigo: e.codigo, nombre: e.nombre, creada: e.creada_en })));
}

async function crear() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const preguntar = async (texto, porDefecto = "") => {
    const r = (await rl.question(porDefecto ? `${texto} [${porDefecto}]: ` : `${texto}: `)).trim();
    return r || porDefecto;
  };

  console.log(`\nNueva empresa en ${NUBE_URL}\n`);
  const nombre = await preguntar("Nombre de la empresa");
  const sugerido = nombre
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const codigo = await preguntar("Codigo de empresa (lo escribe el cliente al iniciar sesion)", sugerido);
  const rnc = await preguntar("RNC (opcional)");
  const telefono = await preguntar("Telefono (opcional)");
  const direccion = await preguntar("Direccion (opcional)");
  const adminUsuario = await preguntar("Usuario administrador", "admin");
  const adminNombre = await preguntar("Nombre de esa persona", "Administrador");
  let adminPassword = "";
  while (adminPassword.length < 6) {
    adminPassword = await preguntar("Contrasena del administrador (minimo 6 caracteres)");
  }
  const demo = (await preguntar("Cargar datos de ejemplo? (s/n)", "n")).toLowerCase().startsWith("s");
  rl.close();

  const r = await pedir("/admin/empresas", {
    method: "POST",
    body: JSON.stringify({
      codigo,
      nombre_empresa: nombre,
      rnc: rnc || null,
      telefono: telefono || null,
      direccion: direccion || null,
      admin_usuario: adminUsuario,
      admin_nombre: adminNombre,
      admin_password: adminPassword,
      demo,
    }),
  });

  console.log("\nEmpresa creada. Datos para entregar al cliente:");
  console.log(`  Codigo de empresa: ${r.codigo}`);
  console.log(`  Usuario:           ${adminUsuario.toLowerCase()}`);
  console.log("  Contrasena:        la que escribiste arriba");
  console.log("\nCon eso inicia sesion en Darasistema o Cajapunto1 desde cualquier computadora.");
  console.log("Desde Configuracion → Usuarios puede crear sus cajeros.");
}

async function borrar(codigo) {
  if (!codigo) throw new Error("Indica el codigo: npm run nube:borrar-empresa -- <codigo>");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log(`\nSe borraran TODOS los datos de la empresa "${codigo}" (facturas, clientes, inventario, usuarios...).`);
  const confirmacion = (await rl.question("Para confirmar escribe el codigo otra vez: ")).trim();
  rl.close();
  if (confirmacion !== codigo) return console.log("Cancelado: el codigo no coincide.");
  await pedir(`/admin/empresas/${encodeURIComponent(codigo)}`, { method: "DELETE" });
  console.log(`Empresa "${codigo}" borrada.`);
}

const comando = process.argv[2];
(comando === "listar" ? listar() : comando === "borrar" ? borrar(process.argv[3]) : crear()).catch((e) => {
  console.error("\nNo se pudo completar:", e.message);
  process.exit(1);
});
