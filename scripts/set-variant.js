const fs = require("fs");
const path = require("path");

// full = Darasistema (oficina, gas) · caja = Cajapunto1 · colmado = Darasistema Colmado (oficina del colmado)
// cajacolmado = Cajapunto1 Colmado (la caja del colmado, factura en tabla)
const VARIANTES = ["full", "caja", "colmado", "cajacolmado"];
const variant = VARIANTES.includes(process.argv[2]) ? process.argv[2] : "full";
const target = path.join(__dirname, "..", "electron", "variant.generated.ts");

fs.writeFileSync(
  target,
  `// Generado por scripts/set-variant.js antes de cada build. No editar a mano.\nexport const APP_VARIANT: "caja" | "full" | "colmado" | "cajacolmado" = "${variant}";\n`
);

console.log(`[set-variant] electron/variant.generated.ts -> "${variant}"`);
