require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

(async () => {
  const [emailArg, nameArg] = process.argv.slice(2);
  const email = String(emailArg || '').trim().toLowerCase();
  const name = String(nameArg || 'Administrateur ZAYNO').trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error('Usage : npm run admin:create -- admin@zayno.ma "Nom administrateur"');
    process.exit(1);
  }
  const password = process.env.ADMIN_INITIAL_PASSWORD;
  if (!password || password.length < 14) {
    console.error('Définissez ADMIN_INITIAL_PASSWORD (14 caractères minimum) dans .env avant de continuer.');
    process.exit(1);
  }
  const file = path.join(__dirname, 'data', 'store.json');
  if (!fs.existsSync(file)) {
    console.error('Base locale introuvable. Lancez d’abord npm run dev, puis arrêtez le serveur.');
    process.exit(1);
  }
  const db = JSON.parse(fs.readFileSync(file, 'utf8'));
  db.users = Array.isArray(db.users) ? db.users : [];
  if (db.users.some(u => String(u.email).toLowerCase() === email)) {
    console.error('Un compte utilise déjà cette adresse. Aucun changement effectué.');
    process.exit(1);
  }
  const user = { id: crypto.randomUUID(), name, email, passwordHash: await bcrypt.hash(password, 12), role: 'admin', createdAt: new Date().toISOString() };
  db.users.push(user);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
  console.log(`Compte administrateur créé : ${email}`);
  console.log('Supprimez ADMIN_INITIAL_PASSWORD du fichier .env après cette opération.');
})().catch(err => { console.error(err.message); process.exit(1); });
