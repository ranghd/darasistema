const fs = require("fs");
const path = require("path");

const variant = process.argv[2] === "caja" ? "caja" : "full";
const target = path.join(__dirname, "..", "electron", "variant.generated.ts");

fs.writeFileSync(
  target,
  `// Generado por scripts/set-variant.js antes de cada build. No editar a mano.\nexport const APP_VARIANT: "caja" | "full" = "${variant}";\n`
);

console.log(`[set-variant] electron/variant.generated.ts -> "${variant}"`);
