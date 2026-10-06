const { execFileSync } = require('child_process');
const pkg = require('../package.json');

const msg = process.argv[2] || `update v${pkg.version}`;

function run(args) {
  console.log('>', 'git', args.join(' '));
  execFileSync('git', args, { stdio: 'inherit' });
}

run(['add', '-A']);

try {
  run(['commit', '-m', msg]);
} catch (e) {
  console.log('Sin cambios nuevos para commitear.');
}

run(['push']);
