// 1. استدعاء المكتبات التي نحتاجها
const express = require("express");
const db = require("./database.js");
const path = require("path");
const { v4: uuidv4 } = require("uuid"); // لاستيراد وظيفة إنشاء الرموز
const qr = require("qrcode"); // لاستيراد مكتبة QR Code
const nodemailer = require("nodemailer");
const session = require("express-session");
const fs = require('fs');

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
// 3. تحديد ما سيحدث عند زيارة الصفحة الرئيسية
// req = الطلب القادم من المتصفح
// res = الرد الذي سنرسله للمتصفح
// نحتاج استدعاء مكتبة path للمساعدة في تحديد مسار الملف

app.get('/', (req, res) => {
  // 1. Get active fields from the database
  const sql = `SELECT * FROM form_fields WHERE is_active = 1 ORDER BY id`;

  db.all(sql, [], (err, fields) => {
    if (err) {
      console.error(err.message);
      return res.status(500).send('Error preparing the form.');
    }

    // 2. Build the HTML for the new fields
    let dynamicFieldsHtml = fields.map(field => {
      const requiredAttr = field.required ? 'required' : '';
      return `
        <div class="form-group">
          <label for="${field.name}">${field.label}</label>
          <input type="${field.type}" id="${field.name}" name="${field.name}" ${requiredAttr}>
        </div>
      `;
    }).join('');

    // 3. Read the original index.html file
    fs.readFile(path.join(__dirname, 'index.html'), 'utf8', (err, htmlData) => {
      if (err) {
        console.error(err);
        return res.status(500).send('Error loading the registration page.');
      }

      // 4. Replace the placeholder with the new fields
      const finalHtml = htmlData.replace('', dynamicFieldsHtml);

      // 5. Send the final, modified page to the user
      res.send(finalHtml);
    });
  });
});

// كلمة المرور الخاصة بالموظفين (يمكن تغييرها)
const STAFF_PASSWORD = "password123";

// لعرض صفحة تسجيل الدخول
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "login.html"));
});

// لمعالجة طلب تسجيل الدخول
app.post("/login", (req, res) => {
  const { password } = req.body;
  if (password === STAFF_PASSWORD) {
    req.session.isLoggedIn = true; // تخزين حالة تسجيل الدخول في الجلسة
    res.redirect("/scanner"); // توجيهه لصفحة السكانر بعد النجاح
  } else {
    res.send("كلمة المرور خاطئة!");
  }
});

// صفحة افتراضية للموظف بعد تسجيل الدخول
app.get("/scanner", (req, res) => {
  if (!req.session.isLoggedIn) {
    return res.redirect("/login");
  }
  res.send(`
        <div style="text-align: center; font-family: Arial;">
            <h1>أهلاً بك أيها الموظف</h1>
            <p>أنت الآن مسجل وجاهز لمسح التذاكر.</p>
            <p>استخدم كاميرا جوالك الآن لمسح أي QR Code.</p>
        </div>
    `);
});

// لعرض صفحة لوحة التحكم والإحصائيات
// (استبدل المسار القديم بالكامل بهذا)
app.get('/admin', checkAuth, (req, res) => {
  // جلب كل البيانات اللازمة بشكل متوازي
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

    // بناء صفوف جدول المستخدمين
    let userRows = users.map(user => `...`).join(''); // الكود هنا كما هو لم يتغير

    // بناء صفوف جدول حقول الفورم
    let fieldRows = fields.map(field => `
      <tr>
        <td>${field.label}</td>
        <td>${field.name}</td>
        <td>${field.type}</td>
        <td>${field.required ? 'نعم' : 'لا'}</td>
        <td><button>تعديل</button> <button>حذف</button></td>
      </tr>
    `).join('');

    // إرسال صفحة HTML الكاملة
    res.send(`
      <!DOCTYPE html>
      <body>
        <div class="container">
          <h2 style="margin-top: 40px;">إدارة حقول الفورم</h2>
          <table>
            <thead>
              <tr>
                <th>اسم الحقل (Label)</th>
                <th>الاسم البرمجي (Name)</th>
                <th>النوع</th>
                <th>إجباري</th>
                <th>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              ${fieldRows}
            </tbody>
          </table>

          <h3 style="margin-top: 30px;">إضافة حقل جديد</h3>
          <form action="/admin/add-field" method="POST" class="field-form">
            <input type="text" name="label" placeholder="اسم الحقل (مثال: رقم الجوال)" required>
            <input type="text" name="name" placeholder="الاسم البرمجي (مثال: mobile_number)" required>
            <select name="type">
              <option value="text">نص (Text)</option>
              <option value="email">بريد إلكتروني (Email)</option>
              <option value="number">رقم (Number)</option>
            </select>
            <label><input type="checkbox" name="required" value="1" checked> إجباري</label>
            <button type="submit">إضافة الحقل</button>
          </form>
        </div>
      </body>
      </html>
    `);
  }).catch(err => {
    console.error(err);
    res.status(500).send('خطأ في جلب بيانات لوحة التحكم');
  });
});

// مسار لإضافة حقل جديد
app.post('/admin/add-field', checkAuth, (req, res) => {
  const { label, name, type } = req.body;
  const required = req.body.required ? 1 : 0; // تحويل قيمة checkbox

  const sql = `INSERT INTO form_fields (label, name, type, required) VALUES (?, ?, ?, ?)`;
  db.run(sql, [label, name, type, required], (err) => {
    if (err) {
      console.error(err.message);
      return res.status(500).send('خطأ في إضافة الحقل، قد يكون الاسم البرمجي مكررًا.');
    }
    res.redirect('/admin'); // أعد التوجيه إلى لوحة التحكم لرؤية التغييرات
  });
});

app.post("/register", (req, res) => {
  const { name, email } = req.body;
  const ticketId = uuidv4();

  const sql = `INSERT INTO registrations (name, email, ticket_id) VALUES (?, ?, ?)`;
  const params = [name, email, ticketId];

  db.run(sql, params, function (err) {
    if (err) {
      console.error("Database error:", err.message);
      // إذا حدث خطأ في قاعدة البيانات، أرسل هذا الرد وتوقف هنا
      return res
        .status(400)
        .send("حدث خطأ. قد يكون هذا البريد الإلكتروني مسجلاً من قبل.");
    }

    console.log(`User registered successfully. Ticket ID: ${ticketId}`);

    const verificationUrl = `${
      process.env.RENDER_EXTERNAL_URL || "http://localhost:3000"
    }/verify/${ticketId}`;

    qr.toDataURL(verificationUrl, (qrErr, qrCodeUrl) => {
      if (qrErr) {
        console.error("QR Code generation error:", qrErr);
        // إذا حدث خطأ في إنشاء الرمز، أرسل هذا الرد وتوقف هنا
        return res
          .status(500)
          .send("تم التسجيل، ولكن حدث خطأ أثناء إنشاء QR Code.");
      }

      // إعداد الإيميل
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: "hassomalshayeb@gmail.com", // <-- ضع إيميلك هنا
          pass: "nzgmemuozzwjwnhq", // <-- ضع كلمة مرور التطبيقات هنا
        },
      });

      const mailOptions = {
        from: '"اسم الحدث او الشركة" <hassomalshayeb@gmail.com>',
        to: email,
        subject: "تذكرتك الإلكترونية جاهزة!",
        html: `<div dir="rtl" style="text-align: right; font-family: Arial;"><h1>أهلاً بك، ${name}!</h1><p>شكرًا لتسجيلك. هذه هي تذكرتك التي تحتوي على رمز الدخول.</p><img src="${qrCodeUrl}" alt="QR Code"></div>`,
      };

      // إرسال الإيميل (لا ننتظر الرد منه)
      transporter.sendMail(mailOptions, (mailErr, info) => {
        if (mailErr) {
          console.error("Error sending email:", mailErr);
        } else {
          console.log("Email sent successfully:", info.response);
        }
      });

      // أرسل رد النجاح النهائي للمتصفح
      // هذا هو الرد الوحيد الذي يجب أن يصل في حالة النجاح
      res.status(200).send(`
        <div style="text-align: center; font-family: Arial;">
          <h1>تم التسجيل بنجاح!</h1>
          <p>شكرًا لك، ${name}. لقد أرسلنا التذكرة إلى بريدك الإلكتروني.</p>
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

// نقطة التحقق من التذكرة عند مسح الـ QR Code
app.get("/verify/:ticketId", checkAuth, (req, res) => {
  // 1. استخراج ID التذكرة من الرابط
  const { ticketId } = req.params;

  // 2. البحث عن التذكرة في قاعدة البيانات
  const sql = `SELECT * FROM registrations WHERE ticket_id = ?`;

  db.get(sql, [ticketId], (err, row) => {
    if (err) {
      return res.status(500).send("حدث خطأ في الخادم.");
    }

    // 3. التحقق من حالة التذكرة
    if (!row) {
      // إذا لم يتم العثور على التذكرة
      return res.status(404).send(`
        <div style="text-align: center; font-family: Arial; padding: 50px; background-color: #ffdddd; color: #d8000c;">
          <h1>❌ خطأ</h1>
          <p>هذه التذكرة غير موجودة أو غير صالحة.</p>
        </div>
      `);
    } else if (row.status === "USED") {
      // إذا كانت التذكرة مستخدمة من قبل
      return res.status(409).send(`
        <div style="text-align: center; font-family: Arial; padding: 50px; background-color: #fff3cd; color: #856404;">
          <h1>⚠️ تنبيه</h1>
          <p>هذه التذكرة تم استخدامها مسبقًا.</p>
          <p><strong>الاسم:</strong> ${row.name}</p>
        </div>
      `);
    } else {
      // إذا كانت التذكرة صالحة وغير مستخدمة
      const updateSql = `UPDATE registrations SET status = 'USED' WHERE ticket_id = ?`;
      db.run(updateSql, [ticketId], (updateErr) => {
        if (updateErr) {
          return res.status(500).send("حدث خطأ أثناء تحديث حالة التذكرة.");
        }

        // إظهار رسالة نجاح
        res.send(`
          <div style="text-align: center; font-family: Arial; padding: 50px; background-color: #d4edda; color: #155724;">
            <h1>✅ تم التحقق بنجاح</h1>
            <p>مرحبًا بك!</p>
            <p><strong>الاسم:</strong> ${row.name}</p>
            <p><strong>البريد الإلكتروني:</strong> ${row.email}</p>
          </div>
        `);
      });
    }
  });
});

// 4. تشغيل الخادم ليكون جاهزاً لاستقبال الزوار
app.listen(port, () => {
  console.log(`${process.env.RENDER_EXTERNAL_URL}:${port}`);
});
