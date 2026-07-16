import { execSync } from 'node:child_process';

// Diagnose remote D1
const cmd = 'npx wrangler d1 execute tomriddle-auth --remote --command="SELECT id,friend_name,enabled,daily_limit FROM invites LIMIT 2;" --json';
try {
  const o = execSync(cmd, { encoding: 'utf-8', stdio: 'pipe', maxBuffer: 10 * 1024 * 1024 });
  console.log('=== RAW ===');
  console.log(o.slice(0, 2000));
} catch (e) {
  console.log('=== STDOUT ===');
  console.log((e.stdout || '').slice(0, 2000));
  console.log('=== STDERR ===');
  console.log((e.stderr || '').slice(0, 2000));
}

// Also check what tables exist
const cmd2 = 'npx wrangler d1 execute tomriddle-auth --remote --command="SELECT name FROM sqlite_master WHERE type=\'table\' ORDER BY name;" --json';
try {
  const o2 = execSync(cmd2, { encoding: 'utf-8', stdio: 'pipe', maxBuffer: 10 * 1024 * 1024 });
  console.log('\n=== TABLES ===');
  console.log(o2.slice(0, 2000));
} catch (e) {
  console.log('\n=== TABLES STDOUT ===');
  console.log((e.stdout || '').slice(0, 2000));
  console.log('=== TABLES STDERR ===');
  console.log((e.stderr || '').slice(0, 2000));
}
