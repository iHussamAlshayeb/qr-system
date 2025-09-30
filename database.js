// استدعاء مكتبة SQLite
const sqlite3 = require('sqlite3').verbose();

// إنشاء أو فتح ملف قاعدة البيانات (سيتم إنشاؤه تلقائياً)
const db = new sqlite3.Database('./tickets.db', (err) => {
  if (err) {
    console.error(err.message);
  }
  console.log('تم الاتصال بقاعدة البيانات بنجاح.');
});

// إنشاء جدول لتخزين بيانات المسجلين (سيتم تنفيذه مرة واحدة فقط)
db.serialize(() => {
  // الأمر الأول: إنشاء جدول المسجلين
  db.run(`
    CREATE TABLE IF NOT EXISTS registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      ticket_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'UNUSED',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // الأمر الثاني: إنشاء جدول حقول الفورم
  db.run(`
    CREATE TABLE IF NOT EXISTS form_fields (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL DEFAULT 'text',
      required BOOLEAN NOT NULL DEFAULT 1,
      is_active BOOLEAN NOT NULL DEFAULT 1
    )
  `);
  
  console.log('تم التأكد من وجود جدولي registrations و form_fields.');
});
// تصدير كائن قاعدة البيانات لنتمكن من استخدامه في ملفات أخرى
module.exports = db;