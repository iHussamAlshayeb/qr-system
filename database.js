// database.js
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./tickets.db');

db.serialize(() => {
  // 1. الجدول الجديد للمناسبات
  db.run(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 2. تحديث جدول المسجلين لإضافة رابط المناسبة
  db.run(`
    CREATE TABLE IF NOT EXISTS registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      dynamic_data TEXT,
      ticket_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'UNUSED',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE
    )
  `);
  
  // 3. تحديث جدول الحقول لربط كل حقل بمناسبة
  db.run(`
    CREATE TABLE IF NOT EXISTS form_fields (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      label TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'text',
      options TEXT,
      required BOOLEAN NOT NULL DEFAULT 1,
      is_active BOOLEAN NOT NULL DEFAULT 1,
      FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE
    )
  `);
});

module.exports = db;