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
  db.run(`
    CREATE TABLE IF NOT EXISTS registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      ticket_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'UNUSED',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ),
    CREATE TABLE IF NOT EXISTS form_fields (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,                      -- اسم الحقل الذي يراه المستخدم (مثال: "الاسم الكامل")
    name TEXT NOT NULL UNIQUE,                -- الاسم البرمجي للحقل (مثال: "full_name")
    type TEXT NOT NULL DEFAULT 'text',        -- نوع الحقل (text, email, number)
    required BOOLEAN NOT NULL DEFAULT 1,      -- هل الحقل إجباري؟ (1 = نعم, 0 = لا)
    is_active BOOLEAN NOT NULL DEFAULT 1      -- هل الحقل مفعل ويظهر في الفورم؟
  )
  `, (err) => {
    if (err) {
      console.error(err.message);
    }
    console.log('جدول المسجلين جاهز.');
  });
});

// تصدير كائن قاعدة البيانات لنتمكن من استخدامه في ملفات أخرى
module.exports = db;