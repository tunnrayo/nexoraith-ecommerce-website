'use strict';
// One-time local setup:  npm run setup:local
// Creates your private ".env.local" (never committed to Git) with a freshly generated SESSION_SECRET, and creates/updates your admin account.
// It asks for your admin email and password. (Non-interactive: SETUP_EMAIL=... SETUP_PASSWORD=... npm run setup:local)
const fs = require('fs'); const path = require('path'); const crypto = require('crypto'); const readline = require('readline');
const root = path.join(__dirname, '..'); const file = path.join(root, '.env.local');
const ask = (rl, q) => new Promise((r) => rl.question(q, r));
(async () => {
  let email = process.env.SETUP_EMAIL, pw = process.env.SETUP_PASSWORD;
  if (fs.existsSync(file) && !process.argv.includes('--force')) { console.log('.env.local already exists, so it was left unchanged. To start over, run: npm run setup:local -- --force'); process.exit(0); }
  if (!email || !pw) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    email = (await ask(rl, 'Admin email [NEXORAITHABSOLUTEVENTURES@GMAIL.COM]: ')).trim() || 'NEXORAITHABSOLUTEVENTURES@GMAIL.COM';
    pw = await ask(rl, 'Admin password (at least 12 characters; what you type is visible): '); rl.close();
  }
  email = String(email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { console.error('That is not a valid email address.'); process.exit(1); }
  if (String(pw).length < 12) { console.error('The password must be at least 12 characters.'); process.exit(1); }
  const secret = crypto.randomBytes(48).toString('base64url');
  fs.writeFileSync(file, `# Private local settings. NEVER commit or share this file (Git ignores it).\nNODE_ENV=development\nPORT=3000\nSITE_URL=http://localhost:3000\nADMIN_EMAIL=${email}\nADMIN_PASSWORD=${pw}\nSESSION_SECRET=${secret}\n`, { mode: 0o600 });
  require('child_process').execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(__dirname, 'create-admin.js')], { cwd: root, stdio: 'inherit' });
  console.log('\nDone. Your private settings are in .env.local. Start the shop with:  npm start\nThen open  http://localhost:3000/admin/login  and sign in with that email and password.');
})();
