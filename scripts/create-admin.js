const readline = require('readline/promises');
const runMigrations = require('../Database/migrate');
const { hashPassword } = require('../Security/password');

async function hiddenQuestion(prompt) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    const fallback = readline.createInterface({ input: process.stdin, output: process.stdout });
    try { return await fallback.question(prompt); } finally { fallback.close(); }
  }

  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let answer = '';
    function finish() {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      resolve(answer);
    }
    function onData(chunk) {
      for (const character of chunk) {
        if (character === '\u0003') {
          process.stdin.off('data', onData);
          process.stdin.setRawMode(false);
          reject(new Error('Dibatalkan.'));
          return;
        }
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u007f' || character === '\b') {
          if (answer.length) {
            answer = answer.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else if (character >= ' ') {
          answer += character;
          process.stdout.write('*');
        }
      }
    }
    process.stdin.on('data', onData);
  });
}

async function main() {
  await runMigrations();
  const pool = require('../Database/connection');
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const username = (await terminal.question('Username admin [admin]: ')).trim() || 'admin';
    const fullname = (await terminal.question('Nama lengkap [Administrator]: ')).trim() || 'Administrator';
    terminal.close();
    const password = await hiddenQuestion('Password baru (minimal 14 karakter): ');
    const confirmation = await hiddenQuestion('Ulangi password: ');
    if (password !== confirmation) throw new Error('Konfirmasi password tidak sama.');
    if (!/^[A-Za-z0-9._-]{3,100}$/.test(username)) {
      throw new Error('Username harus 3-100 karakter dan hanya boleh huruf, angka, titik, garis bawah, atau minus.');
    }
    const passwordHash = await hashPassword(password);
    await pool.execute(
      `INSERT INTO users (fullname, username, password, role, status)
       VALUES (?, ?, ?, 'ADMIN', 'ACTIVE')
       ON DUPLICATE KEY UPDATE fullname = VALUES(fullname), password = VALUES(password),
         role = 'ADMIN', status = 'ACTIVE', failed_login_attempts = 0, locked_until = NULL`,
      [fullname, username, passwordHash],
    );
    await pool.execute(
      'DELETE s FROM admin_sessions s JOIN users u ON u.id = s.user_id WHERE u.username = ?',
      [username],
    );
    console.log(`Admin "${username}" berhasil dibuat/reset. Semua sesi lama telah dicabut.`);
  } finally {
    if (!terminal.closed) terminal.close();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`Gagal membuat admin: ${error.message}`);
  process.exitCode = 1;
});
