// 1. استدعاء المكتبات
const express = require("express");
const db = require("./database.js");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const qr = require("qrcode");
const session = require("express-session");
const fs = require("fs");
// const sgMail = require('@sendgrid/mail');

// 2. إعداد التطبيق
const app = express();
app.use(
  session({
    secret: "a-very-secret-key-that-you-should-change",
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false },
  })
);
app.use(express.urlencoded({ extended: true }));
const port = process.env.PORT || 3000;
// sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// --- Middleware ---
const checkAuth = (req, res, next) => {
  if (req.session.isLoggedIn) {
    next();
  } else {
    res.redirect("/login");
  }
};

// --- المسارات العامة ---

// New homepage to list all events
app.get("/", (req, res) => {
  // The SQL query is now corrected
  const sql = `SELECT * FROM events ORDER BY created_at DESC`;
  
  db.all(sql, [], (err, events) => {
    if (err) {
      console.error("Error fetching events for homepage:", err.message);
      return res.status(500).send("Error fetching events.");
    }

    const eventsListHtml = events.map(event => 
      `<li class="border-b last:border-b-0"><a href="/register/${event.id}" class="block py-4 px-2 hover:bg-gray-50 transition duration-300">${event.name}</a></li>`
    ).join('');

    res.send(`
      <!DOCTYPE html>
      <html lang="ar" dir="rtl">
      <head>
        <title>قائمة المناسبات</title>
        <script src="https://cdn.tailwindcss.com"></script>
      </head>
      <body class="bg-gray-100 flex items-center justify-center min-h-screen">
        <div class="w-full max-w-lg bg-white p-8 rounded-xl shadow-lg">
          <h1 class="text-3xl font-bold text-center text-gray-800 mb-6">المناسبات المتاحة</h1>
          <ul class="list-none p-0 border rounded-lg overflow-hidden">
            ${eventsListHtml.length > 0 ? eventsListHtml : '<li class="p-4 text-center text-gray-500">لا توجد مناسبات متاحة حاليًا.</li>'}
          </ul>
        </div>
      </body>
      </html>
    `);
  });
});
// صفحة التسجيل لمناسبة معينة
app.get("/register/:eventId", (req, res) => {
  const { eventId } = req.params;
  const sql = `SELECT * FROM form_fields WHERE event_id = ? AND is_active = 1 ORDER BY id`;

  db.all(sql, [eventId], (err, fields) => {
    if (err) {
      return res.status(500).send("Error preparing the form.");
    }

    // (The logic for dynamicFieldsHtml remains the same)
    let dynamicFieldsHtml = fields
      .map((field) => {
        const commonClasses =
          "class='w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500'";
        const labelHtml = `<label for="${field.name}" class="block text-gray-700 font-semibold mb-2">${field.label}</label>`;
        if (field.type === "dropdown") {
          const optionsArray = field.options.split(",");
          const optionTags = optionsArray
            .map(
              (opt) => `<option value="${opt.trim()}">${opt.trim()}</option>`
            )
            .join("");
          return `<div class="mb-4">${labelHtml}<select id="${
            field.name
          }" name="${field.name}" ${commonClasses} ${
            field.required ? "required" : ""
          }>${optionTags}</select></div>`;
        } else {
          return `<div class="mb-4">${labelHtml}<input type="${
            field.type
          }" id="${field.name}" name="${field.name}" ${commonClasses} ${
            field.required ? "required" : ""
          }></div>`;
        }
      })
      .join("");

    fs.readFile(path.join(__dirname, "index.html"), "utf8", (err, htmlData) => {
      if (err) {
        return res.status(500).send("Error loading the page.");
      }

      // --- New Change Starts Here ---

      // 1. Define the correct submission URL
      const formActionUrl = `/register/${eventId}`;

      // 2. Replace the placeholder and the form action
      const finalHtml = htmlData
        .replace("{-- DYNAMIC_FIELDS --}", dynamicFieldsHtml)
        .replace('action="/register"', `action="${formActionUrl}"`); // This is the new line

      // --- New Change Ends Here ---

      res.send(finalHtml);
    });
  });
});

// استقبال بيانات التسجيل لمناسبة معينة
app.post("/register/:eventId", (req, res) => {
  const { eventId } = req.params;
  const { name, email, ...dynamicData } = req.body;
  const ticketId = uuidv4();
  const dynamicDataJson = JSON.stringify(dynamicData);
  db.run(
    `INSERT INTO registrations (event_id, name, email, dynamic_data, ticket_id) VALUES (?, ?, ?, ?, ?)`,
    [eventId, name, email, dynamicDataJson, ticketId],
    function (err) {
      if (err) return res.status(400).send("خطأ: قد يكون الإيميل مسجل مسبقًا.");
      const verificationUrl = `${
        process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`
      }/verify/${ticketId}`;
      qr.toDataURL(verificationUrl, (qrErr, qrCodeUrl) => {
        if (qrErr) return res.status(500).send("فشل إنشاء QR Code.");
        // كود إرسال الإيميل
        res.send(`
    <body class="bg-gray-100 flex items-center justify-center min-h-screen">
    <script src="https://cdn.tailwindcss.com"></script>
    <div class="text-center bg-white p-10 rounded-xl shadow-lg">
        <h1 class="text-3xl font-bold text-green-600 mb-4">تم التسجيل بنجاح!</h1>
        <p class="text-gray-600 mb-6">شكرًا لك، ${name}. تم إرسال تذكرتك إلى بريدك الإلكتروني.</p>
        <div class="p-4 border rounded-lg inline-block">
            <img src="${qrCodeUrl}" alt="QR Code">
        </div>
        <br><br>
        <a href="${qrCodeUrl}" download="ticket-qrcode.png" class="mt-4 inline-block bg-green-500 text-white py-3 px-6 rounded-lg font-semibold hover:bg-green-600 transition duration-300">
            تحميل الـ QR Code
        </a>
    </div>
    </body>
`);
      });
    }
  );
});

// مسار التحقق من التذكرة
app.get("/verify/:ticketId", checkAuth, (req, res) => {
  const { ticketId } = req.params;
  const sql = `SELECT r.*, e.name as event_name FROM registrations r JOIN events e ON r.event_id = e.id WHERE r.ticket_id = ?`;
  db.get(sql, [ticketId], (err, row) => {
    if (err || !row) return res.status(404).send("<h1>التذكرة غير صالحة</h1>");
    if (row.status === "USED")
      return res
        .status(409)
        .send(`<h1>التذكرة مستخدمة لمناسبة: ${row.event_name}</h1>`);
    db.run(
      `UPDATE registrations SET status = 'USED' WHERE ticket_id = ?`,
      [ticketId],
      (updateErr) => {
        if (updateErr) return res.status(500).send("خطأ في تحديث التذكرة.");
        const dynamicData = JSON.parse(row.dynamic_data || "{}");
        let dynamicDataHtml = Object.entries(dynamicData)
          .map(
            ([key, value]) =>
              `<p><strong>${key.replace(/_/g, " ")}:</strong> ${value}</p>`
          )
          .join("");
        res.send(
          `<h1>✅ تم التحقق لمناسبة: ${row.event_name}</h1><p>الاسم: ${row.name}</p><p>الإيميل: ${row.email}</p>${dynamicDataHtml}`
        );
      }
    );
  });
});

// --- مسارات المدير ---
const STAFF_PASSWORD = "password123";
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "login.html"));
});
app.post("/login", (req, res) => {
  if (req.body.password === STAFF_PASSWORD) {
    req.session.isLoggedIn = true;
    res.redirect("/admin/events");
  } else {
    res.send("كلمة المرور خاطئة!");
  }
});

// صفحة إدارة المناسبات
app.get("/admin/events", checkAuth, (req, res) => {
  db.all(`SELECT * FROM events ORDER BY created_at DESC`, [], (err, events) => {
    if (err) return res.status(500).send("خطأ في جلب المناسبات.");
    const eventRows = events
      .map(
        (event) => `
            <tr>
                <td>${event.name}</td>
                <td><a href="/register/${event.id}" target="_blank">/register/${event.id}</a></td>
                <td><a href="/admin/dashboard/${event.id}">عرض لوحة التحكم</a></td>
            </tr>
        `
      )
      .join("");
    fs.readFile(
      path.join(__dirname, "events.html"),
      "utf8",
      (err, htmlData) => {
        if (err) return res.status(500).send("خطأ في تحميل الصفحة.");
        res.send(htmlData.replace("{-- EVENTS_TABLE_ROWS --}", eventRows));
      }
    );
  });
});

// إضافة مناسبة جديدة
app.post("/admin/events/add", checkAuth, (req, res) => {
  const { name, description } = req.body;
  db.run(
    `INSERT INTO events (name, description) VALUES (?, ?)`,
    [name, description],
    function (err) {
      if (err) return res.status(500).send("خطأ في إنشاء المناسبة.");
      const eventId = this.lastID;
      const defaultFields = [
        { label: "الاسم الكامل", name: "name", type: "text" },
        { label: "البريد الإلكتروني", name: "email", type: "email" },
      ];
      defaultFields.forEach((f) => {
        db.run(
          `INSERT INTO form_fields (event_id, label, name, type) VALUES (?, ?, ?, ?)`,
          [eventId, f.label, f.name, f.type]
        );
      });
      res.redirect("/admin/events");
    }
  );
});

// **لوحة التحكم الكاملة لمناسبة معينة**
app.get('/admin/dashboard/:eventId', checkAuth, (req, res) => {
    const { eventId } = req.params;
    const queries = [
        db.get.bind(db, `SELECT name FROM events WHERE id = ?`, [eventId]),
        db.get.bind(db, `SELECT COUNT(*) as total FROM registrations WHERE event_id = ?`, [eventId]),
        db.get.bind(db, `SELECT COUNT(*) as attended FROM registrations WHERE event_id = ? AND status = 'USED'`, [eventId]),
        db.all.bind(db, `SELECT name, email, status, created_at FROM registrations WHERE event_id = ? ORDER BY created_at DESC`, [eventId]),
        db.all.bind(db, `SELECT * FROM form_fields WHERE event_id = ? ORDER BY id`, [eventId])
    ];

    Promise.all(queries.map(q => new Promise((resolve, reject) => q((err, result) => err ? reject(err) : resolve(result)))))
    .then(([event, totalRow, attendedRow, users, fields]) => {
        if (!event) return res.status(404).send("Event not found.");

        const userRows = users.map(user => `
            <tr class="border-b">
                <td class="py-3 px-4">${user.name}</td>
                <td class="py-3 px-4">${user.email}</td>
                <td class="py-3 px-4">
                    <span class="px-2 py-1 text-xs font-semibold rounded-full ${user.status === 'USED' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}">
                        ${user.status === 'USED' ? 'حضر' : 'لم يحضر'}
                    </span>
                </td>
                <td class="py-3 px-4">${new Date(user.created_at).toLocaleString('ar-SA')}</td>
            </tr>
        `).join('');

        const fieldRows = fields.map(field => `
            <tr class="border-b">
                <td class="py-3 px-4">${field.label}</td>
                <td class="py-3 px-4 font-mono text-sm">${field.name}</td>
                <td class="py-3 px-4">${field.type}</td>
                <td class="py-3 px-4">${field.required ? 'نعم' : 'لا'}</td>
                <td class="py-3 px-4">
                    <form action="/admin/delete-field/${eventId}/${field.id}" method="POST" onsubmit="return confirm('هل أنت متأكد؟');">
                        <button type="submit" class="bg-red-500 text-white px-3 py-1 text-sm rounded-md hover:bg-red-600">حذف</button>
                    </form>
                </td>
            </tr>
        `).join('');

        res.send(`
            <!DOCTYPE html>
            <html lang="ar" dir="rtl">
            <head>
                <meta charset="UTF-8">
                <title>لوحة تحكم: ${event.name}</title>
                <script src="https://cdn.tailwindcss.com"></script>
            </head>
            <body class="bg-gray-100">
                <div class="container mx-auto max-w-6xl mt-10 p-8 bg-white rounded-xl shadow-lg">
                    <a href="/admin/events" class="text-blue-500 hover:underline mb-6 block">&larr; العودة لكل المناسبات</a>
                    <h1 class="text-3xl font-bold text-center text-gray-800">لوحة تحكم لـ: ${event.name}</h1>
                    
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-6 my-8">
                        <div class="bg-blue-50 p-6 rounded-lg text-center">
                            <h3 class="text-lg font-semibold text-blue-800">إجمالي المسجلين</h3>
                            <p class="text-4xl font-bold text-blue-600 mt-2">${totalRow.total}</p>
                        </div>
                        <div class="bg-green-50 p-6 rounded-lg text-center">
                            <h3 class="text-lg font-semibold text-green-800">إجمالي الحضور</h3>
                            <p class="text-4xl font-bold text-green-600 mt-2">${attendedRow.attended}</p>
                        </div>
                    </div>

                    <div class="mt-10">
                        <h2 class="text-2xl font-semibold text-gray-700 mb-4">قائمة الحضور</h2>
                        <div class="overflow-x-auto border rounded-lg">
                            <table class="min-w-full bg-white text-sm text-gray-700">
                                <thead class="bg-gray-800 text-white"><tr><th class="text-right py-3 px-4">الاسم</th><th class="text-right py-3 px-4">الإيميل</th><th class="text-right py-3 px-4">الحالة</th><th class="text-right py-3 px-4">وقت التسجيل</th></tr></thead>
                                <tbody class="divide-y">${userRows}</tbody>
                            </table>
                        </div>
                    </div>
                    
                    <div class="mt-12">
                        <h2 class="text-2xl font-semibold text-gray-700 mb-4">إدارة حقول الفورم</h2>
                        <div class="overflow-x-auto border rounded-lg">
                            <table class="min-w-full bg-white text-sm text-gray-700">
                                <thead class="bg-gray-800 text-white"><tr><th class="text-right py-3 px-4">اسم الحقل</th><th class="text-right py-3 px-4">الاسم البرمجي</th><th class="text-right py-3 px-4">النوع</th><th class="text-right py-3 px-4">إجباري</th><th class="text-right py-3 px-4">إجراءات</th></tr></thead>
                                <tbody class="divide-y">${fieldRows}</tbody>
                            </table>
                        </div>
                        <div class="mt-6 p-6 bg-gray-50 rounded-lg border">
                            <h3 class="text-xl font-semibold text-gray-700 mb-4">إضافة حقل جديد</h3>
                            <form action="/admin/add-field/${eventId}" method="POST" class="grid grid-cols-1 md:grid-cols-5 gap-4 items-center">
                                <input type="text" name="label" placeholder="اسم الحقل" class="md:col-span-1 w-full px-3 py-2 border rounded-lg" required>
                                <input type="text" name="name" placeholder="الاسم البرمجي" class="md:col-span-1 w-full px-3 py-2 border rounded-lg" required>
                                <select name="type" id="fieldType" onchange="toggleOptionsInput()" class="md:col-span-1 w-full px-3 py-2 border rounded-lg">
                                    <option value="text">نص</option><option value="email">إيميل</option><option value="number">رقم</option><option value="dropdown">قائمة منسدلة</option>
                                </select>
                                <input type="text" name="options" id="optionsInput" placeholder="الخيارات (فاصلة)" class="md:col-span-2 w-full px-3 py-2 border rounded-lg" style="display:none;">
                                <div class="md:col-span-5 flex items-center justify-between mt-2">
                                    <label class="flex items-center gap-2 text-gray-600"><input type="checkbox" name="required" value="1" checked class="h-4 w-4 rounded"> إجباري</label>
                                    <button type="submit" class="bg-blue-600 text-white py-2 px-5 rounded-lg font-semibold hover:bg-blue-700">إضافة</button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
                <script>function toggleOptionsInput(){var t=document.getElementById("fieldType").value,e=document.getElementById("optionsInput");"dropdown"===t?(e.style.display="block",e.required=!0,e.classList.remove("md:col-span-2")):(e.style.display="none",e.required=!1,e.classList.add("md:col-span-2"))}</script>
            </body></html>
        `);
    }).catch(err => res.status(500).send('Error loading dashboard: ' + err));
});

// إضافة وحذف الحقول لمناسبة معينة
app.post("/admin/add-field/:eventId", checkAuth, (req, res) => {
  const { eventId } = req.params;
  const { label, name, type, options } = req.body;
  const required = req.body.required ? 1 : 0;
  const fieldOptions = type === "dropdown" ? options : null;
  db.run(
    `INSERT INTO form_fields (event_id, label, name, type, options, required) VALUES (?, ?, ?, ?, ?, ?)`,
    [eventId, label, name, type, fieldOptions, required],
    (err) => {
      if (err) return res.status(500).send("خطأ في إضافة الحقل.");
      res.redirect(`/admin/dashboard/${eventId}`);
    }
  );
});

app.post("/admin/delete-field/:eventId/:fieldId", checkAuth, (req, res) => {
  const { eventId, fieldId } = req.params;
  db.run(
    `DELETE FROM form_fields WHERE id = ? AND event_id = ?`,
    [fieldId, eventId],
    function (err) {
      if (err) return res.status(500).send("خطأ أثناء حذف الحقل.");
      res.redirect(`/admin/dashboard/${eventId}`);
    }
  );
});

// 4. تشغيل الخادم
app.listen(port, () => {
  console.log(`الخادم يعمل على المنفذ ${port}`);
});
