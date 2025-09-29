// 1. استدعاء المكتبات التي نحتاجها
const express = require("express");
const db = require("./database.js");
const path = require("path");
const { v4: uuidv4 } = require("uuid"); // لاستيراد وظيفة إنشاء الرموز
const qr = require("qrcode"); // لاستيراد مكتبة QR Code

// 2. إنشاء تطبيق Express
const app = express();
// middleware لفهم البيانات القادمة من الفورم
app.use(express.urlencoded({ extended: true }));
const port = process.env.PORT || 3000; // سنشغل الخادم على هذا المنفذ

// 3. تحديد ما سيحدث عند زيارة الصفحة الرئيسية
// req = الطلب القادم من المتصفح
// res = الرد الذي سنرسله للمتصفح
// نحتاج استدعاء مكتبة path للمساعدة في تحديد مسار الملف

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// نقطة استقبال بيانات الفورم عند إرسالها
app.post("/register", (req, res) => {
  // 1. استخراج البيانات من الطلب
  const { name, email } = req.body;

  // 2. إنشاء رمز تذكرة فريد
  const ticketId = uuidv4();

  // 3. تعريف أمر SQL لإدخال البيانات في الجدول
  const sql = `INSERT INTO registrations (name, email, ticket_id) VALUES (?, ?, ?)`;
  const params = [name, email, ticketId];

  // 4. تنفيذ الأمر لحفظ البيانات في قاعدة البيانات
  db.run(sql, params, function (err) {
    if (err) {
      // في حال حدوث خطأ (مثل إيميل مكرر)
      console.error(err.message);
      return res
        .status(400)
        .send("حدث خطأ. قد يكون هذا البريد الإلكتروني مسجلاً من قبل.");
    }

    // 5. إذا نجح الحفظ، نقوم بإنشاء QR Code
    console.log(`تم تسجيل مستخدم جديد بنجاح. ID التذكرة: ${ticketId}`);

    // الرابط الذي سيتم تضمينه في الـ QR Code
    const verificationUrl = `https://qr-system-app.onrender.com/verify/${ticketId}`;

    qr.toDataURL(verificationUrl, (err, qrCodeUrl) => {
      if (err) {
        return res.send("تم التسجيل، ولكن حدث خطأ أثناء إنشاء QR Code.");
      }

      // 6. إرسال صفحة نجاح تحتوي على الـ QR Code للمستخدم
      res.send(`
        <div style="text-align: center; font-family: Arial;">
          <h1>تم التسجيل بنجاح!</h1>
          <p>شكرًا لك، ${name}. هذه هي تذكرتك الإلكترونية.</p>
          <p>يرجى إظهار هذا الرمز عند الدخول.</p>
          <img src="${qrCodeUrl}" alt="QR Code">
        </div>
      `);
    });
  });
});

// نقطة التحقق من التذكرة عند مسح الـ QR Code
app.get("/verify/:ticketId", (req, res) => {
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
  console.log(`الخادم يعمل الآن على الرابط http://localhost:${port}`);
});
