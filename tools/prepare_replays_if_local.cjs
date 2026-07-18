const { spawnSync } = require('node:child_process');

if (process.env.VERCEL === '1') {
  console.log('Vercel build: using committed prepared replay assets.');
  process.exit(0);
}

const result = spawnSync('python', ['tools/prepare_replay_cache.py', '--all'], {
  stdio: 'inherit',
  shell: false,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
