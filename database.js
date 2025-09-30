const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./tickets.db', (err) => {
  if (err) {
    console.error(err.message);
  }
  console.log('تم الاتصال بقاعدة البيانات بنجاح.');
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      dynamic_data TEXT, -- <-- هذا هو الحقل الجديد لتخزين البيانات الإضافية
      ticket_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'UNUSED',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS form_fields (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL DEFAULT 'text',
      options TEXT,
      required BOOLEAN NOT NULL DEFAULT 1,
      is_active BOOLEAN NOT NULL DEFAULT 1
    )
  `);

  console.log('تم التأكد من وجود جدولي registrations و form_fields.');
});

module.exports = db;