// 1. استدعاء المكتبات التي نحتاجها
const express = require("express");
const db = require("./database.js");
const path = require("path");
const { v4: uuidv4 } = require("uuid"); // لاستيراد وظيفة إنشاء الرموز
const qr = require("qrcode"); // لاستيراد مكتبة QR Code
const nodemailer = require("nodemailer");
const session = require("express-session");

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

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
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
app.get("/admin", checkAuth, (req, res) => {
  const sqlTotal = `SELECT COUNT(*) as total FROM registrations`;
  const sqlAttended = `SELECT COUNT(*) as attended FROM registrations WHERE status = 'USED'`;
  const sqlAllUsers = `SELECT name, email, status, created_at FROM registrations ORDER BY created_at DESC`;

  // 1. جلب العدد الإجمالي للمسجلين
  db.get(sqlTotal, [], (err, totalRow) => {
    if (err) return res.status(500).send("خطأ في جلب البيانات");

    // 2. جلب عدد الحضور
    db.get(sqlAttended, [], (err, attendedRow) => {
      if (err) return res.status(500).send("خطأ في جلب البيانات");

      // 3. جلب قائمة كل المسجلين
      db.all(sqlAllUsers, [], (err, users) => {
        if (err) return res.status(500).send("خطأ في جلب البيانات");

        // 4. بناء وإرسال صفحة HTML الديناميكية
        const pageTitle = "لوحة التحكم";
        let userRows = users
          .map(
            (user) => `
          <tr>
            <td>${user.name}</td>
            <td>${user.email}</td>
            <td class="${user.status.toLowerCase()}">${
              user.status === "USED" ? "حضر" : "لم يحضر"
            }</td>
            <td>${new Date(user.created_at).toLocaleString("ar-SA")}</td>
          </tr>
        `
          )
          .join("");

        res.send(`
          <!DOCTYPE html>
          <html lang="ar" dir="rtl">
          <head>
            <meta charset="UTF-8">
            <title>${pageTitle}</title>
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
            </style>
          </head>
          <body>
            <div class="container">
              <h1>${pageTitle}</h1>
              <div class="stats">
                <div class="stat-box">
                  <h3>إجمالي المسجلين</h3>
                  <p>${totalRow.total}</p>
                </div>
                <div class="stat-box">
                  <h3>إجمالي الحضور</h3>
                  <p>${attendedRow.attended}</p>
                </div>
              </div>
              <h2>قائمة الحضور</h2>
              <table>
                <thead>
                  <tr>
                    <th>الاسم</th>
                    <th>البريد الإلكتروني</th>
                    <th>الحالة</th>
                    <th>وقت التسجيل</th>
                  </tr>
                </thead>
                <tbody>
                  ${userRows}
                </tbody>
              </table>
            </div>
          </body>
          </html>
        `);
      });
    });
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
