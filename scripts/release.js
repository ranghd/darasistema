const { execSync } = require('child_process');

function run(cmd) {
  console.log('>', cmd);
  execSync(cmd, { stdio: 'inherit' });
}

if (!process.env.GH_TOKEN) {
  try {
    process.env.GH_TOKEN = execSync('gh auth token', { encoding: 'utf8' }).trim();
  } catch {
    console.error('No hay GH_TOKEN y no se pudo obtener de gh. Autenticate con: gh auth login');
    process.exit(1);
  }
}

const variantes = [
  { nombre: 'full', config: 'electron-builder.yml' },
  { nombre: 'caja', config: 'electron-builder.caja.yml' },
];

for (const v of variantes) {
  console.log(`\n=== Publicando variante: ${v.nombre} ===`);
  run(`node scripts/set-variant.js ${v.nombre}`);
  run(`npx cross-env VITE_APP_VARIANT=${v.nombre} npm run build`);
  run(`npx electron-builder --config ${v.config} --publish always`);
}

console.log('\nListo. Ambas apps publicadas en GitHub Releases.');
