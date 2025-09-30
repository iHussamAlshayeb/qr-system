// 1. استدعاء المكتبات التي نحتاجها
const express = require("express");
const db = require("./database.js");
const path = require("path");
const { v4: uuidv4 } = require("uuid"); // لاستيراد وظيفة إنشاء الرموز
const qr = require("qrcode"); // لاستيراد مكتبة QR Code
const nodemailer = require("nodemailer");
const session = require("express-session");
const fs = require("fs");

// 2. إنشاء تطبيق Express
const app = express();
// إعدادات الجلسة
app.use(
  session({
    secret: "a-very-secret-key-that-you-should-change", // مفتاح سري لتشفير الجلسة
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }, // اجعله true إذا كنت تستخدم HTTPS
  })
);
// middleware لفهم البيانات القادمة من الفورم
app.use(express.urlencoded({ extended: true }));
const port = process.env.PORT || 3000; // سنشغل الخادم على هذا المنفذ

// Middleware للتحقق مما إذا كان المستخدم موظفًا مسجلاً
const checkAuth = (req, res, next) => {
  if (req.session.isLoggedIn) {
    next(); // إذا كان مسجلاً، اسمح له بالمرور
  } else {
    res.redirect("/login"); // إذا لم يكن، أعد توجيهه لصفحة الدخول
  }
};

// 3. بناء الفورم الرئيسي بشكل ديناميكي
app.get("/", (req, res) => {
  const sql = `SELECT * FROM form_fields WHERE is_active = 1 ORDER BY id`;

  db.all(sql, [], (err, fields) => {
    if (err) {
      console.error(err.message);
      return res.status(500).send("Error preparing the form.");
    }

    // --- تعديل: بناء الحقول بناءً على نوعها ---
    let dynamicFieldsHtml = fields.map(field => {
      const requiredAttr = field.required ? 'required' : '';
      let fieldHtml = '';

      if (field.type === 'dropdown') {
        const optionsArray = field.options.split(',');
        const optionTags = optionsArray.map(opt => `<option value="${opt.trim()}">${opt.trim()}</option>`).join('');
        fieldHtml = `
          <div class="form-group">
            <label for="${field.name}">${field.label}</label>
            <select id="${field.name}" name="${field.name}" ${requiredAttr}>
              ${optionTags}
            </select>
          </div>
        `;
      } else {
        fieldHtml = `
          <div class="form-group">
            <label for="${field.name}">${field.label}</label>
            <input type="${field.type}" id="${field.name}" name="${field.name}" ${requiredAttr}>
          </div>
        `;
      }
      return fieldHtml;
    }).join('');

    fs.readFile(path.join(__dirname, "index.html"), "utf8", (err, htmlData) => {
      if (err) {
        console.error(err);
        return res.status(500).send("Error loading the registration page.");
      }
      const finalHtml = htmlData.replace("{-- DYNAMIC_FIELDS --}", dynamicFieldsHtml);
      res.send(finalHtml);
    });
  });
});

// كلمة المرور الخاصة بالموظفين (يمكن تغييرها)
const STAFF_PASSWORD = "password123";

// مسارات تسجيل دخول الموظفين
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "login.html"));
});

app.post("/login", (req, res) => {
  const { password } = req.body;
  if (password === STAFF_PASSWORD) {
    req.session.isLoggedIn = true;
    res.redirect("/admin"); // توجيه المدير إلى لوحة التحكم مباشرة
  } else {
    res.send("كلمة المرور خاطئة!");
  }
});

// صفحة لوحة التحكم والإحصائيات
app.get('/admin', checkAuth, (req, res) => {
  const sqlTotal = `SELECT COUNT(*) as total FROM registrations`;
  const sqlAttended = `SELECT COUNT(*) as attended FROM registrations WHERE status = 'USED'`;
  const sqlAllUsers = `SELECT name, email, status, created_at FROM registrations ORDER BY created_at DESC`;
  const sqlAllFields = `SELECT * FROM form_fields ORDER BY id`;

  Promise.all([
    new Promise((resolve, reject) => db.get(sqlTotal, [], (err, row) => err ? reject(err) : resolve(row))),
    new Promise((resolve, reject) => db.get(sqlAttended, [], (err, row) => err ? reject(err) : resolve(row))),
    new Promise((resolve, reject) => db.all(sqlAllUsers, [], (err, rows) => err ? reject(err) : resolve(rows))),
    new Promise((resolve, reject) => db.all(sqlAllFields, [], (err, rows) => err ? reject(err) : resolve(rows)))
  ]).then(([totalRow, attendedRow, users, fields]) => {
    
    let userRows = users.map(user => `
      <tr>
        <td>${user.name}</td>
        <td>${user.email}</td>
        <td class="${user.status.toLowerCase()}">${user.status === 'USED' ? 'حضر' : 'لم يحضر'}</td>
        <td>${new Date(user.created_at).toLocaleString('ar-SA')}</td>
      </tr>
    `).join('');

    let fieldRows = fields.map(field => `
      <tr>
        <td>${field.label}</td>
        <td>${field.name}</td>
        <td>${field.type}</td>
        <td>${field.required ? 'نعم' : 'لا'}</td>
        <td style="display: flex; gap: 5px;">
          <button disabled hidden>تعديل</button>
          <form action="/admin/delete-field" method="POST" onsubmit="return confirm('هل أنت متأكد من حذف هذا الحقل؟');">
            <input type="hidden" name="field_id" value="${field.id}">
            <button type="submit" style="background-color: #dc3545;">حذف</button>
          </form>
        </td>
      </tr>
    `).join('');

    // --- تعديل: إضافة حقل الخيارات و JavaScript ---
    res.send(`
      <!DOCTYPE html>
      <html lang="ar" dir="rtl">
      <head>
        <meta charset="UTF-8">
        <title>لوحة التحكم</title>
        <style>
          body { font-family: Arial, sans-serif; background-color: #f9f9f9; color: #333; margin: 20px; }
          .container { max-width: 1000px; margin: auto; background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
          h1, h2 { text-align: center; color: #0056b3; }
          .stats { display: flex; justify-content: space-around; text-align: center; margin: 30px 0; }
          .stat-box { background: #eef7ff; padding: 20px; border-radius: 8px; width: 45%; }
          .stat-box h3 { margin-top: 0; }
          .stat-box p { font-size: 2.5em; font-weight: bold; color: #007bff; margin: 0; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          th, td { padding: 12px; border: 1px solid #ddd; text-align: right; }
          th { background-color: #007bff; color: white; }
          tr:nth-child(even) { background-color: #f2f2f2; }
          .used { color: green; font-weight: bold; }
          .unused { color: #cc8400; font-weight: bold; }
          .field-form { margin-top: 15px; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>لوحة التحكم</h1>
          <div class="stats">
            <div class="stat-box"><h3>إجمالي المسجلين</h3><p>${totalRow.total}</p></div>
            <div class="stat-box"><h3>إجمالي الحضور</h3><p>${attendedRow.attended}</p></div>
          </div>
          <h2>قائمة الحضور</h2>
          <table>
            <thead><tr><th>الاسم</th><th>البريد الإلكتروني</th><th>الحالة</th><th>وقت التسجيل</th></tr></thead>
            <tbody>${userRows}</tbody>
          </table>
          <h2 style="margin-top: 40px;">إدارة حقول الفورم</h2>
          <table>
            <thead><tr><th>اسم الحقل</th><th>الاسم البرمجي</th><th>النوع</th><th>إجباري</th><th>إجراءات</th></tr></thead>
            <tbody>${fieldRows}</tbody>
          </table>
          <h3 style="margin-top: 30px;">إضافة حقل جديد</h3>
          <form action="/admin/add-field" method="POST" class="field-form">
            <input type="text" name="label" placeholder="اسم الحقل" required>
            <input type="text" name="name" placeholder="الاسم البرمجي" required>
            <select name="type" id="fieldType" onchange="toggleOptionsInput()">
              <option value="text">نص</option>
              <option value="email">إيميل</option>
              <option value="number">رقم</option>
              <option value="dropdown">قائمة منسدلة</option>
            </select>
            <input type="text" name="options" id="optionsInput" placeholder="الخيارات (مثال: نعم,لا)" style="display:none;">
            <label><input type="checkbox" name="required" value="1" checked> إجباري</label>
            <button type="submit">إضافة الحقل</button>
          </form>
        </div>
        <script>
          function toggleOptionsInput() {
            var fieldType = document.getElementById('fieldType').value;
            var optionsInput = document.getElementById('optionsInput');
            if (fieldType === 'dropdown') {
              optionsInput.style.display = 'block';
              optionsInput.required = true;
            } else {
              optionsInput.style.display = 'none';
              optionsInput.required = false;
            }
          }
        </script>
      </body>
      </html>
    `);
  }).catch(err => {
    console.error(err);
    res.status(500).send('خطأ في جلب بيانات لوحة التحكم');
  });
});

// --- تعديل: مسار إضافة حقل جديد ليدعم الخيارات ---
app.post("/admin/add-field", checkAuth, (req, res) => {
  const { label, name, type, options } = req.body;
  const required = req.body.required ? 1 : 0;
  const fieldOptions = (type === 'dropdown') ? options : null;

  const sql = `INSERT INTO form_fields (label, name, type, options, required) VALUES (?, ?, ?, ?, ?)`;
  db.run(sql, [label, name, type, fieldOptions, required], (err) => {
    if (err) {
      console.error(err.message);
      return res.status(500).send("خطأ في إضافة الحقل، قد يكون الاسم البرمجي مكررًا.");
    }
    res.redirect("/admin");
  });
});

// مسار لمعالجة حذف حقل
app.post('/admin/delete-field', checkAuth, (req, res) => {
  const { field_id } = req.body;
  const sql = `DELETE FROM form_fields WHERE id = ?`;
  db.run(sql, [field_id], function(err) {
    if (err) {
      console.error(err.message);
      return res.status(500).send('حدث خطأ أثناء حذف الحقل.');
    }
    console.log(`تم حذف الحقل بنجاح. ID: ${field_id}`);
    res.redirect('/admin');
  });
});

app.post("/register", (req, res) => {
  // 1. فصل البيانات الأساسية عن البيانات الديناميكية
  const { name, email, ...dynamicData } = req.body;
  const ticketId = uuidv4();

  // تحويل البيانات الديناميكية إلى نص JSON لتخزينها
  const dynamicDataJson = JSON.stringify(dynamicData);

  // 2. أمر SQL جديد لحفظ كل البيانات
  const sql = `INSERT INTO registrations (name, email, dynamic_data, ticket_id) VALUES (?, ?, ?, ?)`;
  const params = [name, email, dynamicDataJson, ticketId];

  db.run(sql, params, function (err) {
    if (err) {
      console.error("Database error:", err.message);
      return res.status(400).send("حدث خطأ. قد يكون هذا البريد الإلكتروني مسجلاً من قبل.");
    }

    console.log(`User registered successfully. Ticket ID: ${ticketId}`);

    // 3. بقية الخطوات (إنشاء QR وإرسال الإيميل) تعمل كما هي
    const verificationUrl = `${process.env.RENDER_EXTERNAL_URL || "http://localhost:3000"}/verify/${ticketId}`;

    qr.toDataURL(verificationUrl, (qrErr, qrCodeUrl) => {
      if (qrErr) {
        console.error("QR Code generation error:", qrErr);
        return res.status(500).send("تم التسجيل، ولكن حدث خطأ أثناء إنشاء QR Code.");
      }

      // (الكود الخاص بإرسال الإيميل هنا، لم يتغير)
      // ... يمكنك إضافة كود الإيميل الخاص بك هنا بنفس الطريقة السابقة ...

      res.status(200).send(`
        <div style="text-align: center; font-family: Arial;">
          <h1>تم التسجيل بنجاح!</h1>
          <p>شكرًا لك، ${name}. هذه هي تذكرتك الإلكترونية.</p>
          <img src="${qrCodeUrl}" alt="QR Code">
          <br><br>
          <a href="${qrCodeUrl}" download="ticket-qrcode.png" style="padding: 10px 20px; background-color: #28a745; color: white; text-decoration: none; border-radius: 5px;">
            تحميل الـ QR Code
          </a>
        </div>
      `);
    });
  });
});

app.get("/verify/:ticketId", checkAuth, (req, res) => {
  const { ticketId } = req.params;
  const sql = `SELECT * FROM registrations WHERE ticket_id = ?`;

  db.get(sql, [ticketId], (err, row) => {
    if (err) {
      return res.status(500).send("An error occurred on the server.");
    }

    if (!row) {
      return res.status(404).send(`
        <div style="text-align: center; font-family: Arial, sans-serif; padding: 50px; background-color: #ffdddd; color: #d8000c;">
          <h1>❌ Error</h1>
          <p>This ticket is not valid or does not exist.</p>
        </div>
      `);
    } else if (row.status === "USED") {
      return res.status(409).send(`
        <div style="text-align: center; font-family: Arial, sans-serif; padding: 50px; background-color: #fff3cd; color: #856404;">
          <h1>⚠️ Alert</h1>
          <p>This ticket has already been used.</p>
          <p><strong>Name:</strong> ${row.name}</p>
        </div>
      `);
    } else {
      const updateSql = `UPDATE registrations SET status = 'USED' WHERE ticket_id = ?`;
      db.run(updateSql, [ticketId], (updateErr) => {
        if (updateErr) {
          return res.status(500).send("An error occurred while updating the ticket.");
        }

        // --- New code starts here ---
        // 1. Parse the extra data from the JSON string
        const dynamicData = JSON.parse(row.dynamic_data || '{}');

        // 2. Build HTML for the extra data
        let dynamicDataHtml = Object.entries(dynamicData).map(([key, value]) => {
          return `<p><strong>${key.replace(/_/g, ' ')}:</strong> ${value}</p>`;
        }).join('');
        // --- New code ends here ---

        res.send(`
          <div style="text-align: center; font-family: Arial, sans-serif; padding: 50px; background-color: #d4edda; color: #155724;">
            <h1>✅ Verified Successfully</h1>
            <p>Welcome!</p>
            <hr style="border-top: 1px solid #155724; border-bottom: none; margin: 20px 40px;">
            <p><strong>Name:</strong> ${row.name}</p>
            <p><strong>Email:</strong> ${row.email}</p>
            ${dynamicDataHtml}
          </div>
        `);
      });
    }
  });
});

// تشغيل الخادم
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});