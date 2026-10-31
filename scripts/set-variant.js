const fs = require("fs");
const path = require("path");

// full = Darasistema (oficina, gas) · caja = Cajapunto1 · colmado = Darasistema Colmado (oficina del colmado)
// cajacolmado = Cajapunto1 Colmado (la caja del colmado, factura en tabla)
// puntoventa = Gas Damian (solo vender y clientes, con apertura y cierre de caja)
// puntoventaadmin = Gas Damian Admin (el dueno: todo lo de Darasistema con lo propio de Gas Damian)
const VARIANTES = ["full", "caja", "colmado", "cajacolmado", "puntoventa", "puntoventaadmin"];
const variant = VARIANTES.includes(process.argv[2]) ? process.argv[2] : "full";
// "win7": compilado con Electron 22 para Windows 7; se actualiza por el canal <variante>-win7
const paraWin7 = process.argv[3] === "win7";
const target = path.join(__dirname, "..", "electron", "variant.generated.ts");

fs.writeFileSync(
  target,
  `// Generado por scripts/set-variant.js antes de cada build. No editar a mano.\nexport const APP_VARIANT: "caja" | "full" | "colmado" | "cajacolmado" | "puntoventa" | "puntoventaadmin" = "${variant}";\nexport const PARA_WIN7: boolean = ${paraWin7};\n`
);

console.log(`[set-variant] electron/variant.generated.ts -> "${variant}"${paraWin7 ? " (Windows 7)" : ""}`);
