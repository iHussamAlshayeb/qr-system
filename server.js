// 1. Import Libraries
const express = require("express");
const db = require("./database.js");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const qr = require("qrcode");
const session = require("express-session");
const fs = require("fs");
const bcrypt = require("bcrypt");
// const sgMail = require('@sendgrid/mail');

// 2. App Setup
const app = express();
app.use(
  session({
    secret: "a-very-secret-key-that-you-should-change",
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }, // Set to true in production with HTTPS
  })
);
app.use(express.urlencoded({ extended: true }));
const port = process.env.PORT || 3000;
// sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// --- Middleware ---
// حارس خاص بصفحات المدير فقط
const checkAdmin = (req, res, next) => {
  if (req.session.isLoggedIn && req.session.role === "admin") {
    next();
  } else {
    res
      .status(403)
      .send(
        "<h1>403 - Forbidden</h1><p>ليس لديك صلاحية للوصول لهذه الصفحة.</p>"
      );
  }
};

// حارس يسمح للمدير والماسح الضوئي بالوصول
const checkScanner = (req, res, next) => {
  if (
    req.session.isLoggedIn &&
    (req.session.role === "admin" || req.session.role === "scanner")
  ) {
    next();
  } else {
    res.redirect("/login");
  }
};

// --- Public Routes ---

// Homepage to list all events
app.get("/", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM events WHERE is_active = TRUE ORDER BY created_at DESC`
    );
    const eventsGridHtml = result.rows
      .map(
        (event) => `
            <div class="bg-white rounded-xl shadow-md overflow-hidden transform hover:-translate-y-1 transition-transform duration-300">
                <div class="p-6">
                    <h3 class="text-xl font-bold text-gray-800 mb-2">${
                      event.name
                    }</h3>
                    <p class="text-gray-600 text-sm mb-4">${
                      event.description || ""
                    }</p>
                    <a href="/register/${
                      event.id
                    }" class="mt-4 inline-block bg-blue-600 text-white py-2 px-5 rounded-lg font-semibold hover:bg-blue-700">سجل الآن</a>
                </div>
            </div>
        `
      )
      .join("");

    res.send(`
            <!DOCTYPE html><html lang="ar" dir="rtl"><head><title>قائمة المناسبات</title><script src="https://cdn.tailwindcss.com"></script></head>
            <body class="bg-gray-100"><div class="container mx-auto max-w-5xl py-12 px-4">
                <h1 class="text-4xl font-bold text-center text-gray-800 mb-10">المناسبات المتاحة</h1>
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    ${
                      eventsGridHtml.length > 0
                        ? eventsGridHtml
                        : '<p class="text-center text-gray-500 col-span-3">لا توجد مناسبات متاحة حاليًا.</p>'
                    }
                </div>
            </div></body></html>
        `);
  } catch (err) {
    console.error("Homepage Error:", err);
    res.status(500).send("Error fetching events.");
  }
});

// Registration page for a specific event
app.get("/register/:eventId", async (req, res) => {
  const { eventId } = req.params;
  try {
    const eventResult = await db.query(
      `SELECT name FROM events WHERE id = $1`,
      [eventId]
    );
    const fieldsResult = await db.query(
      `SELECT * FROM form_fields WHERE event_id = $1 AND is_active = TRUE ORDER BY id`,
      [eventId]
    );

    const event = eventResult.rows[0];
    if (!event) return res.status(404).send("Event not found.");

    const fields = fieldsResult.rows;
    const dynamicFieldsHtml = fields
      .map((field) => {
        const requiredAttr = field.required ? "required" : "";
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
          return `<div class="mb-4">${labelHtml}<select id="${field.name}" name="${field.name}" ${commonClasses} ${requiredAttr}>${optionTags}</select></div>`;
        } else {
          return `<div class="mb-4">${labelHtml}<input type="${field.type}" id="${field.name}" name="${field.name}" ${commonClasses} ${requiredAttr}></div>`;
        }
      })
      .join("");

    fs.readFile(path.join(__dirname, "index.html"), "utf8", (err, htmlData) => {
      if (err) throw err;
      const finalHtml = htmlData
        .replace("{-- EVENT_TITLE --}", event.name)
        .replace("{-- DYNAMIC_FIELDS --}", dynamicFieldsHtml)
        .replace('action="/register"', `action="/register/${eventId}"`);
      res.send(finalHtml);
    });
  } catch (err) {
    console.error("Registration Page Error:", err);
    res.status(500).send("Error preparing form.");
  }
});

// Handle form submission
app.post("/register/:eventId", async (req, res) => {
  const { eventId } = req.params;
  const { name, email, ...dynamicData } = req.body;
  const ticketId = uuidv4();
  const dynamicDataJson = JSON.stringify(dynamicData);

  try {
    // --- الخطوة 1: التحقق أولاً ---
    // سنتحقق إذا كان هذا الإيميل مسجل مسبقًا في هذه المناسبة تحديدًا
    const checkResult = await db.query(
      `SELECT id FROM registrations WHERE event_id = $1 AND email = $2`,
      [eventId, email]
    );

    // إذا وجدنا أي نتيجة، فهذا يعني أنه مسجل بالفعل
    if (checkResult.rows.length > 0) {
      return res.status(400).send(`
                <body class="bg-gray-100 flex items-center justify-center min-h-screen">
                <script src="https://cdn.tailwindcss.com"></script>
                <div class="text-center bg-white p-10 rounded-xl shadow-lg">
                    <h1 class="text-3xl font-bold text-yellow-700 mb-4">تنبيه</h1>
                    <p class="text-gray-600 mb-6">هذا البريد الإلكتروني مسجل بالفعل في هذه المناسبة.</p>
                    <a href="/register/${eventId}" class="text-blue-500 hover:underline">العودة إلى صفحة التسجيل</a>
                </div>
                </body>
            `);
    }

    // --- الخطوة 2: التسجيل ---
    // إذا لم يكن مسجلاً، نقوم بإضافته
    await db.query(
      `INSERT INTO registrations (event_id, name, email, dynamic_data, ticket_id) VALUES ($1, $2, $3, $4, $5)`,
      [eventId, name, email, dynamicDataJson, ticketId]
    );

    // --- الخطوة 3: إنشاء QR Code وإرسال الرد ---
    const verificationUrl = `${
      process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`
    }/verify/${ticketId}`;
    const qrCodeUrl = await qr.toDataURL(verificationUrl);

    // (يمكنك وضع كود إرسال الإيميل هنا)

    res.status(200).send(`
            <body class="bg-gray-100 flex items-center justify-center min-h-screen">
            <script src="https://cdn.tailwindcss.com"></script>
            <div class="text-center bg-white p-10 rounded-xl shadow-lg">
                <h1 class="text-3xl font-bold text-green-600 mb-4">تم التسجيل بنجاح!</h1>
                <p class="text-gray-600 mb-6">شكرًا لك، ${name}. تم إرسال تذكرتك إلى بريدك الإلكتروني.</p>
                <div class="p-4 border rounded-lg inline-block"><img src="${qrCodeUrl}" alt="QR Code"></div><br><br>
                <a href="${qrCodeUrl}" download="ticket-qrcode.png" class="mt-4 inline-block bg-green-500 text-white py-3 px-6 rounded-lg font-semibold hover:bg-green-600">تحميل الـ QR Code</a>
            </div></body>
        `);
  } catch (err) {
    // في حال حدوث خطأ غير متوقع (مثل مشكلة في قاعدة البيانات)
    console.error("--- DATABASE INSERTION ERROR ---");
    console.error(err); // سيطبع الخطأ الفعلي من قاعدة البيانات في سجلات Render
    console.error("---------------------------------");
    res
      .status(500)
      .send("حدث خطأ غير متوقع أثناء التسجيل. يرجى مراجعة سجلات الخادم.");
  }
});

// QR Code verification route
app.get("/verify/:ticketId", checkScanner, async (req, res) => {
  const { ticketId } = req.params;
  try {
    const result = await db.query(
      `SELECT r.*, e.name as event_name FROM registrations r JOIN events e ON r.event_id = e.id WHERE r.ticket_id = $1`,
      [ticketId]
    );
    const row = result.rows[0];

    if (!row) {
      return res.status(404).send(`
        <!DOCTYPE html><html lang="ar" dir="rtl"><head><title>خطأ</title><script src="https://cdn.tailwindcss.com"></script></head>
        <body class="bg-gray-100 flex items-center justify-center min-h-screen">
        <div class="w-full max-w-md bg-white p-8 rounded-xl shadow-lg text-center">
            <div class="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-red-100">
                <svg class="h-8 w-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
            </div>
            <h1 class="text-3xl font-bold text-red-700 mt-4">تذكرة غير صالحة</h1>
            <p class="text-gray-600 mt-2">لم يتم العثور على هذا الرمز في النظام. يرجى التأكد من الرمز والمحاولة مرة أخرى.</p>
        </div></body></html>
      `);
    }
    if (row.status === "USED") {
      return res.status(409).send(`
        <!DOCTYPE html><html lang="ar" dir="rtl"><head><title>تنبيه</title><script src="https://cdn.tailwindcss.com"></script></head>
        <body class="bg-gray-100 flex items-center justify-center min-h-screen">
        <div class="w-full max-w-md bg-white p-8 rounded-xl shadow-lg text-center">
            <div class="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-yellow-100">
                <svg class="h-8 w-8 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            </div>
            <h1 class="text-3xl font-bold text-yellow-700 mt-4">التذكرة مستخدمة</h1>
            <p class="text-gray-600 mt-2">تم استخدام هذه التذكرة مسبقًا لتسجيل الدخول.</p>
            <div class="mt-4 text-left bg-gray-50 p-4 rounded-lg border">
                <p><strong>المناسبة:</strong> ${row.event_name}</p>
                <p><strong>الاسم:</strong> ${row.name}</p>
            </div>
        </div></body></html>
      `);
    }

    await db.query(
      `UPDATE registrations SET status = 'USED' WHERE ticket_id = $1`,
      [ticketId]
    );
    const dynamicData = row.dynamic_data || {};
    let dynamicDataHtml = Object.entries(dynamicData)
      .map(
        ([key, value]) =>
          `<div class="py-2"><p class="text-sm font-semibold text-gray-700">${key.replace(
            /_/g,
            " "
          )}
        </p><p class="text-gray-900">${value}</p></div>`
      )
      .join("");
    res.send(`
            <!DOCTYPE html><html lang="ar" dir="rtl"><head><title>تم التحقق</title><script src="https://cdn.tailwindcss.com"></script></head>
            <body class="bg-gray-100 flex items-center justify-center min-h-screen">
            <div class="w-full max-w-md bg-white p-8 rounded-xl shadow-lg text-center">
                <div class="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-green-100"><svg class="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg></div>
                <h1 class="text-3xl font-bold text-green-700 mt-4">تم التحقق بنجاح</h1>
                <p class="text-gray-600 mt-2">مرحبًا بك!</p>
                <div class="mt-6 text-left bg-gray-50 p-4 rounded-lg border divide-y">
                    <div class="py-2"><p class="text-sm font-semibold text-gray-700">المناسبة</p><p class="text-gray-900">${row.event_name}</p></div>
                    <div class="py-2"><p class="text-sm font-semibold text-gray-700">الاسم</p><p class="text-gray-900">${row.name}</p></div>
                    <div class="py-2"><p class="text-sm font-semibold text-gray-700">البريد الإلكتروني</p><p class="text-gray-900">${row.email}</p></div>
                    ${dynamicDataHtml}
                </div>
            </div></body></html>
        `);
  } catch (err) {
    console.error("Verification Error:", err);
    res.status(500).send("Server error during verification.");
  }
});

// --- Admin Routes ---
const STAFF_PASSWORD = "password123";

app.get("/login", (req, res) =>
  res.sendFile(path.join(__dirname, "login.html"))
);

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await db.query("SELECT * FROM users WHERE username = $1", [
      username,
    ]);
    const user = result.rows[0];

    if (user && (await bcrypt.compare(password, user.password))) {
      req.session.isLoggedIn = true;
      req.session.role = user.role;
      req.session.username = user.username;
      req.session.userId = user.id; // <-- هذا هو السطر الجديد والمهم

      if (user.role === "admin") {
        res.redirect("/admin/home");
      } else {
        res.redirect("/scanner");
      }
    } else {
      res.send("اسم المستخدم أو كلمة المرور خاطئة!");
    }
  } catch (err) {
    res.status(500).send("حدث خطأ في الخادم.");
  }
});

// New admin homepage/main menu
app.get("/admin/home", checkAdmin, (req, res) => {
  res.send(`
        <!DOCTYPE html>
        <html lang="ar" dir="rtl">
        <head>
            <meta charset="UTF-8">
            <title>لوحة التحكم الرئيسية</title>
            <script src="https://cdn.tailwindcss.com"></script>
        </head>
        <body class="bg-gray-100">
            <div class="container mx-auto max-w-4xl mt-16 p-8">
                <h1 class="text-4xl font-bold text-center text-gray-800 mb-4">لوحة التحكم الرئيسية</h1>
                <p class="text-center text-gray-500 mb-12">أهلاً بك، ${req.session.username}. اختر القسم الذي تريد إدارته.</p>
                
                <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <a href="/admin/events" class="block bg-white p-8 rounded-xl shadow-lg hover:shadow-xl transform hover:-translate-y-1 transition-all duration-300">
                        <h2 class="text-2xl font-bold text-blue-600 mb-2">إدارة المناسبات</h2>
                        <p class="text-gray-600">إنشاء مناسبات جديدة، عرض روابط التسجيل، والوصول إلى لوحات التحكم الخاصة بكل مناسبة.</p>
                    </a>
                    
                    <a href="/admin/users" class="block bg-white p-8 rounded-xl shadow-lg hover:shadow-xl transform hover:-translate-y-1 transition-all duration-300">
                        <h2 class="text-2xl font-bold text-green-600 mb-2">إدارة المستخدمين</h2>
                        <p class="text-gray-600">إضافة مستخدمين جدد (مدراء أو ماسحين ضوئيين) وتعيين صلاحياتهم.</p>
                    </a>
                </div>
                 <div class="text-center mt-12">
                    <a href="/logout" class="text-red-500 hover:underline">تسجيل الخروج</a>
                </div>
            </div>
        </body>
        </html>
    `);
});

// Main page for event management
app.get("/admin/events", checkAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM events ORDER BY created_at DESC`
    );
    const eventRows = result.rows
      .map(
        (event) => `
            <tr class="${event.is_active ? "" : "bg-gray-200 opacity-60"}">
                <td class="py-3 px-4">${event.name}</td>
                <td class="py-3 px-4">
                    <span class="px-2 py-1 font-semibold text-xs rounded-full ${
                      event.is_active
                        ? "bg-green-100 text-green-800"
                        : "bg-red-100 text-red-800"
                    }">
                        ${event.is_active ? "نشط" : "غير نشط"}
                    </span>
                </td>
                <td class="py-3 px-4"><a href="/register/${
                  event.id
                }" target="_blank" class="text-blue-500 hover:underline">/register/${
          event.id
        }</a></td>
                <td class="py-3 px-4 flex gap-4">
                    <a href="/admin/dashboard/${
                      event.id
                    }" class="font-bold text-blue-600 hover:underline">إدارة</a>
                    <form action="/admin/events/toggle/${
                      event.id
                    }" method="POST" class="inline-block">
                        <button type="submit" class="font-bold text-yellow-600 hover:underline">تغيير الحالة</button>
                    </form>
                    <form action="/admin/events/delete/${
                      event.id
                    }" method="POST" onsubmit="return confirm('تحذير: سيتم حذف المناسبة وكل المسجلين فيها نهائياً. هل أنت متأكد؟');" class="inline-block">
                        <button type="submit" class="font-bold text-red-600 hover:underline">حذف</button>
                    </form>
                </td>
            </tr>
        `
      )
      .join("");

    fs.readFile(
      path.join(__dirname, "events.html"),
      "utf8",
      (err, htmlData) => {
        if (err) throw err;
        res.send(htmlData.replace("{-- EVENTS_TABLE_ROWS --}", eventRows));
      }
    );
  } catch (err) {
    res.status(500).send("خطأ في جلب المناسبات.");
  }
});

// Add a new event
app.post("/admin/events/add", checkAdmin, async (req, res) => {
  const { name, description } = req.body;
  try {
    const result = await db.query(
      `INSERT INTO events (name, description) VALUES ($1, $2) RETURNING id`,
      [name, description]
    );
    const eventId = result.rows[0].id;
    // Add default fields for the new event
    await db.query(
      `INSERT INTO form_fields (event_id, label, name, type) VALUES ($1, 'الاسم الكامل', 'name', 'text')`,
      [eventId]
    );
    await db.query(
      `INSERT INTO form_fields (event_id, label, name, type) VALUES ($1, 'البريد الإلكتروني', 'email', 'email')`,
      [eventId]
    );
    res.redirect("/admin/events");
  } catch (err) {
    console.error("Add Event Error:", err);
    res.status(500).send("Error creating event.");
  }
});

// مسار لتغيير حالة المناسبة (نشط/غير نشط)
app.post("/admin/events/toggle/:eventId", checkAdmin, async (req, res) => {
  const { eventId } = req.params;
  try {
    await db.query(
      `UPDATE events SET is_active = NOT is_active WHERE id = $1`,
      [eventId]
    );
    res.redirect("/admin/events");
  } catch (err) {
    res.status(500).send("خطأ في تغيير حالة المناسبة.");
  }
});

// مسار لحذف مناسبة
app.post("/admin/events/delete/:eventId", checkAdmin, async (req, res) => {
  const { eventId } = req.params;
  try {
    // بفضل خاصية ON DELETE CASCADE، سيتم حذف كل المسجلين والحقول تلقائيًا
    await db.query(`DELETE FROM events WHERE id = $1`, [eventId]);
    res.redirect("/admin/events");
  } catch (err) {
    res.status(500).send("خطأ في حذف المناسبة.");
  }
});

// Event-specific dashboard
app.get("/admin/dashboard/:eventId", checkAdmin, async (req, res) => {
  const { eventId } = req.params;
  try {
    const [
      eventResult,
      totalResult,
      attendedResult,
      usersResult,
      fieldsResult,
    ] = await Promise.all([
      db.query(`SELECT name FROM events WHERE id = $1`, [eventId]),
      db.query(
        `SELECT COUNT(*) as total FROM registrations WHERE event_id = $1`,
        [eventId]
      ),
      db.query(
        `SELECT COUNT(*) as attended FROM registrations WHERE event_id = $1 AND status = 'USED'`,
        [eventId]
      ),
      db.query(
        `SELECT id, name, email, status, created_at FROM registrations WHERE event_id = $1 ORDER BY created_at DESC`,
        [eventId]
      ),
      db.query(`SELECT * FROM form_fields WHERE event_id = $1 ORDER BY id`, [
        eventId,
      ]),
    ]);

    const event = eventResult.rows[0];
    if (!event) return res.status(404).send("المناسبة غير موجودة.");

    const totalRow = totalResult.rows[0];
    const attendedRow = attendedResult.rows[0];
    const users = usersResult.rows;
    const fields = fieldsResult.rows;

    // --- الكود المكتمل ---
    const userRows = users
      .map(
        (user) => `
            <tr class="border-b">
                <td class="py-3 px-4">${user.name}</td>
                <td class="py-3 px-4">${user.email}</td>
                <td class="py-3 px-4">
                    <span class="px-2 py-1 text-xs font-semibold rounded-full ${
                      user.status === "USED"
                        ? "bg-green-100 text-green-800"
                        : "bg-yellow-100 text-yellow-800"
                    }">
                        ${user.status === "USED" ? "حضر" : "لم يحضر"}
                    </span>
                </td>
                <td class="py-3 px-4">${new Date(
                  user.created_at
                ).toLocaleString("ar-SA")}</td>
                <td class="py-3 px-4">
                    <a href="/admin/registration/${
                      user.id
                    }" class="text-blue-500 hover:underline">عرض التفاصيل</a>
                </td>
            </tr>
        `
      )
      .join("");

    const fieldRows = fields
      .map(
        (field) => `
            <tr class="border-b">
                <td class="py-3 px-4">${field.label}</td>
                <td class="py-3 px-4 font-mono text-sm">${field.name}</td>
                <td class="py-3 px-4">${field.type}</td>
                <td class="py-3 px-4">${field.required ? "نعم" : "لا"}</td>
                <td class="py-3 px-4">
                    <form action="/admin/delete-field/${eventId}/${
          field.id
        }" method="POST" onsubmit="return confirm('هل أنت متأكد؟');">
                        <button type="submit" class="bg-red-500 text-white px-3 py-1 text-sm rounded-md hover:bg-red-600">حذف</button>
                    </form>
                </td>
            </tr>
        `
      )
      .join("");
    // --- نهاية الكود المكتمل ---

    res.send(`
            <!DOCTYPE html>
            <html lang="ar" dir="rtl">
            <head>
                <meta charset="UTF-8">
                <title>لوحة تحكم: ${event.name}</title>
                <script src="https://cdn.tailwindcss.com"></script>
            </head>
            <body class="bg-gray-100">
                <div class="container mx-auto max-w-6xl mt-10 mb-10 p-8 bg-white rounded-xl shadow-lg">
                    <a href="/admin/events" class="inline-block mb-8 bg-gray-200 text-gray-700 py-2 px-4 rounded-lg font-semibold hover:bg-gray-300 transition duration-300">
                        &larr; العودة إلى كل المناسبات
                    </a>
                    <h1 class="text-3xl font-bold text-center text-gray-800">لوحة تحكم لـ: ${event.name}</h1>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-6 my-8">
                        <div class="bg-blue-50 p-6 rounded-lg text-center"><h3 class="text-lg font-semibold text-blue-800">إجمالي المسجلين</h3><p class="text-4xl font-bold text-blue-600 mt-2">${totalRow.total}</p></div>
                        <div class="bg-green-50 p-6 rounded-lg text-center"><h3 class="text-lg font-semibold text-green-800">إجمالي الحضور</h3><p class="text-4xl font-bold text-green-600 mt-2">${attendedRow.attended}</p></div>
                    </div>
                    <div class="mt-10">
                        <h2 class="text-2xl font-semibold text-gray-700 mb-4">قائمة الحضور</h2>
                        <div class="overflow-x-auto border rounded-lg">
                            <table class="min-w-full bg-white text-sm text-gray-700">
                                <thead class="bg-gray-800 text-white"><tr><th class="text-right py-3 px-4">الاسم</th><th class="text-right py-3 px-4">الإيميل</th><th class="text-right py-3 px-4">الحالة</th><th class="text-right py-3 px-4">وقت التسجيل</th><th class="text-right py-3 px-4">الإجراءات</th></tr></thead>
                                <tbody class="divide-y">${userRows}</tbody>
                            </table>
                        </div>
                    </div>
                    <div class="mt-12">
                        <h2 class="text-2xl font-semibold text-gray-700 mb-4">إدارة حقول الفورم</h2>
                        <div class="overflow-x-auto border rounded-lg">
                            <table class="min-w-full bg-white text-sm text-gray-700">
                                <thead class="bg-gray-800 text-white"><tr><th class="text-right py-3 px-4">اسم الحقل</th><th class="text-right py-3 px-4">الاسم البرمجي</th><th class="text-right py-3 px-4">النوع</th><th class="text-right py-3 px-4">إجباري</th><th class="text-right py-3 px-4">الإجراءات</th></tr></thead>
                                <tbody class="divide-y">${fieldRows}</tbody>
                            </table>
                        </div>
                        <div class="mt-6 p-6 bg-gray-50 rounded-lg border">
                            <h3 class="text-xl font-semibold text-gray-700 mb-4">إضافة حقل جديد</h3>
                            <form action="/admin/add-field/${eventId}" method="POST" class="grid grid-cols-1 md:grid-cols-5 gap-4 items-center">
                                <input type="text" name="label" placeholder="اسم الحقل" class="md:col-span-1 w-full px-3 py-2 border rounded-lg" required>
                                <input type="text" name="name" placeholder="الاسم البرمجي" class="md:col-span-1 w-full px-3 py-2 border rounded-lg" required>
                                <select name="type" id="fieldType" onchange="toggleOptionsInput()" class="md:col-span-1 w-full px-3 py-2 border rounded-lg"><option value="text">نص</option><option value="email">إيميل</option><option value="number">رقم</option><option value="dropdown">قائمة منسدلة</option></select>
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
  } catch (err) {
    console.error("Dashboard Error:", err);
    res.status(500).send("Error loading dashboard.");
  }
});

// Show registration details
// app.get("/admin/registration/:registrationId", checkAdmin, async (req, res) => {
//   const { registrationId } = req.params;
//   try {
//     const result = await db.query(
//       `SELECT r.*, e.name as event_name 
//              FROM registrations r
//              JOIN events e ON r.event_id = e.id
//              WHERE r.id = $1`,
//       [registrationId]
//     );

//     const row = result.rows[0];
//     if (!row) return res.status(404).send("التسجيل غير موجود.");

//     // --- THIS IS THE MISSING PART ---
//     const dynamicData = row.dynamic_data || {};
//     let dynamicDataHtml = Object.entries(dynamicData)
//       .map(([key, value]) => {
//         const formattedKey = key.replace(/_/g, " ");
//         return `<div class="mb-2"><dt class="font-semibold text-gray-800 capitalize">${formattedKey}</dt><dd class="text-gray-600">${value}</dd></div>`;
//       })
//       .join("");
//     // --- END OF MISSING PART ---

//     res.send(`
//             <!DOCTYPE html>
//             <html lang="ar" dir="rtl">
//             <head>
//                 <title>تفاصيل التسجيل</title>
//                 <script src="https://cdn.tailwindcss.com"></script>
//             </head>
//             <body class="bg-gray-100 flex items-center justify-center min-h-screen py-12">
//                 <div class="w-full max-w-2xl bg-white p-8 rounded-xl shadow-lg">
//                     <h1 class="text-2xl font-bold text-center text-gray-800 mb-2">تفاصيل التسجيل</h1>
//                     <p class="text-center text-gray-500 mb-6">للمناسبة: ${
//                       row.event_name
//                     }</p>
                    
//                     <div class="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
//                         <div class="bg-gray-50 p-4 rounded-lg border">
//                             <h2 class="font-bold text-lg mb-4 border-b pb-2">البيانات الأساسية</h2>
//                             <dl class="space-y-2">
//                                 <div><dt class="font-semibold text-gray-800">الاسم الكامل</dt><dd class="text-gray-600">${
//                                   row.name
//                                 }</dd></div>
//                                 <div><dt class="font-semibold text-gray-800">البريد الإلكتروني</dt><dd class="text-gray-600">${
//                                   row.email
//                                 }</dd></div>
//                                 <div><dt class="font-semibold text-gray-800">حالة التذكرة</dt><dd class="font-bold ${
//                                   row.status === "USED"
//                                     ? "text-green-600"
//                                     : "text-yellow-600"
//                                 }">${
//       row.status === "USED" ? "تم استخدامها" : "لم تُستخدم"
//     }</dd></div>
//                             </dl>
//                         </div>
//                         <div class="bg-gray-50 p-4 rounded-lg border">
//                             <h2 class="font-bold text-lg mb-4 border-b pb-2">البيانات الإضافية</h2>
//                             <dl class="space-y-2">
//                                 ${
//                                   dynamicDataHtml.length > 0
//                                     ? dynamicDataHtml
//                                     : '<p class="text-gray-500">لا توجد بيانات إضافية.</p>'
//                                 }
//                             </dl>
//                         </div>
//                     </div>
//                     <div class="text-center mt-8">
//                         <a href="/admin/dashboard/${
//                           row.event_id
//                         }" class="text-blue-500 hover:underline">&larr; العودة إلى لوحة التحكم</a>
//                     </div>
//                 </div>
//             </body>
//             </html>
//         `);
//   } catch (err) {
//     console.error("Registration Details Error:", err);
//     res.status(500).send("Error fetching registration details.");
//   }
// });

app.get('/admin/registration/:registrationId', checkAuth, async (req, res) => {
    const { registrationId } = req.params;
    try {
        const result = await db.query(
            `SELECT r.*, e.name as event_name 
             FROM registrations r
             JOIN events e ON r.event_id = e.id
             WHERE r.id = $1`,
            [registrationId]
        );

        const row = result.rows[0];
        if (!row) return res.status(404).send("التسجيل غير موجود.");

        const verificationUrl = `${process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`}/verify/${row.ticket_id}`;
        const qrCodeUrl = await qr.toDataURL(verificationUrl);

        const dynamicData = row.dynamic_data || {};
        let dynamicDataHtml = Object.entries(dynamicData).map(([key, value]) => {
            const formattedKey = key.replace(/_/g, ' '); 
            return `<div class="mb-2"><dt class="font-semibold text-gray-800 capitalize">${formattedKey}</dt><dd class="text-gray-600">${value}</dd></div>`;
        }).join('');

        res.send(`
            <!DOCTYPE html>
            <html lang="ar" dir="rtl">
            <head>
                <title>تفاصيل التسجيل</title>
                <script src="https://cdn.tailwindcss.com"></script>
            </head>
            <body class="bg-gray-100 flex items-center justify-center min-h-screen py-12">
                <div class="w-full max-w-4xl bg-white p-8 rounded-xl shadow-lg">
                    <div class="flex justify-between items-center mb-6">
                        <div>
                            <h1 class="text-2xl font-bold text-gray-800">تفاصيل التسجيل</h1>
                            <p class="text-gray-500">للمناسبة: ${row.event_name}</p>
                        </div>
                        <a href="/admin/registration/edit/${row.id}" class="bg-yellow-500 text-white py-2 px-5 rounded-lg font-semibold hover:bg-yellow-600 transition duration-300">
                            تعديل البيانات
                        </a>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div class="md:col-span-1 bg-gray-50 p-4 rounded-lg border">
                            <h2 class="font-bold text-lg mb-4 border-b pb-2">البيانات الأساسية</h2>
                            <dl class="space-y-2 text-sm">
                                <div><dt class="font-semibold text-gray-800">الاسم الكامل</dt><dd class="text-gray-600">${row.name}</dd></div>
                                <div><dt class="font-semibold text-gray-800">البريد الإلكتروني</dt><dd class="text-gray-600">${row.email}</dd></div>
                                <div><dt class="font-semibold text-gray-800">حالة التذكرة</dt><dd class="font-bold ${row.status === 'USED' ? 'text-green-600' : 'text-yellow-600'}">${row.status === 'USED' ? 'تم استخدامها' : 'لم تُستخدم'}</dd></div>
                            </dl>
                        </div>

                        <div class="md:col-span-1 bg-gray-50 p-4 rounded-lg border">
                            <h2 class="font-bold text-lg mb-4 border-b pb-2">البيانات الإضافية</h2>
                            <dl class="space-y-2 text-sm">
                                ${dynamicDataHtml.length > 0 ? dynamicDataHtml : '<p class="text-gray-500">لا توجد بيانات إضافية.</p>'}
                            </dl>
                        </div>
                        
                        <div class="md:col-span-1 flex flex-col items-center justify-center bg-gray-50 p-4 rounded-lg border">
                            <h2 class="font-bold text-lg mb-4">رمز الدخول (QR Code)</h2>
                            <div class="p-2 border bg-white rounded-lg">
                                <img src="${qrCodeUrl}" alt="QR Code" class="w-48 h-48">
                            </div>
                            <a href="${qrCodeUrl}" download="qrcode-${row.name.replace(/\s/g, '_')}.png" class="mt-4 text-sm text-blue-500 hover:underline">تحميل الرمز</a>
                        </div>
                    </div>

                    <div class="text-center mt-8">
                        <a href="/admin/dashboard/${row.event_id}" class="text-gray-500 hover:underline">&larr; العودة إلى لوحة التحكم</a>
                    </div>
                </div>
            </body>
            </html>
        `);
    } catch (err) {
        console.error("Registration Details Error:", err);
        res.status(500).send("Error fetching registration details.");
    }
});

// 1. عرض صفحة تعديل بيانات المسجل
app.get('/admin/registration/edit/:registrationId', checkAdmin, async (req, res) => {
    const { registrationId } = req.params;
    try {
        const result = await db.query('SELECT * FROM registrations WHERE id = $1', [registrationId]);
        const registration = result.rows[0];
        if (!registration) return res.status(404).send("التسجيل غير موجود.");

        // استخراج البيانات الديناميكية لملء الفورم
        const dynamicData = registration.dynamic_data || {};
        const fieldsResult = await db.query('SELECT name, label FROM form_fields WHERE event_id = $1 ORDER BY id', [registration.event_id]);
        
        // بناء حقول الفورم الديناميكية مع تعبئة القيم الحالية
        let dynamicFieldsHtml = fieldsResult.rows.map(field => {
            if (field.name === 'name' || field.name === 'email') return ''; // تخطي الحقول الأساسية
            const value = dynamicData[field.name] || '';
            return `<div class="mb-4"><label for="${field.name}" class="block font-semibold">${field.label}</label><input type="text" name="${field.name}" id="${field.name}" value="${value}" class="w-full px-4 py-2 border rounded-lg"></div>`;
        }).join('');

        res.send(`
            <!DOCTYPE html><html lang="ar" dir="rtl"><head><title>تعديل البيانات</title><script src="https://cdn.tailwindcss.com"></script></head>
            <body class="bg-gray-100 flex items-center justify-center min-h-screen">
            <div class="w-full max-w-lg bg-white p-8 rounded-xl shadow-lg">
                <h1 class="text-2xl font-bold text-center mb-6">تعديل بيانات: ${registration.name}</h1>
                <form action="/admin/registration/update/${registrationId}" method="POST" class="space-y-4">
                    <div class="mb-4"><label for="name" class="block font-semibold">الاسم الكامل</label><input type="text" name="name" id="name" value="${registration.name}" class="w-full px-4 py-2 border rounded-lg" required></div>
                    <div class="mb-4"><label for="email" class="block font-semibold">البريد الإلكتروني</label><input type="email" name="email" id="email" value="${registration.email}" class="w-full px-4 py-2 border rounded-lg" required></div>
                    ${dynamicFieldsHtml}
                    <div class="flex items-center gap-4 pt-4">
                        <button type="submit" class="w-full bg-green-600 text-white py-3 rounded-lg font-semibold hover:bg-green-700">حفظ التعديلات</button>
                        <a href="/admin/registration/${registrationId}" class="w-full text-center bg-gray-200 text-gray-700 py-3 rounded-lg font-semibold hover:bg-gray-300">إلغاء</a>
                    </div>
                </form>
            </div></body></html>
        `);
    } catch (err) {
        res.status(500).send("خطأ في تحميل صفحة التعديل.");
    }
});

// 2. استقبال البيانات المحدثة وحفظها في قاعدة البيانات
app.post('/admin/registration/update/:registrationId', checkAdmin, async (req, res) => {
    const { registrationId } = req.params;
    const { name, email, ...dynamicData } = req.body;
    
    try {
        // تحديث البيانات الأساسية والديناميكية
        await db.query(
            'UPDATE registrations SET name = $1, email = $2, dynamic_data = $3 WHERE id = $4',
            [name, email, dynamicData, registrationId]
        );
        // إعادة توجيهه إلى صفحة التفاصيل لرؤية التغييرات
        res.redirect(`/admin/registration/${registrationId}`);
    } catch (err) {
        console.error("Update Registration Error:", err);
        res.status(500).send("خطأ في حفظ التعديلات.");
    }
});

// Add/Delete form fields for an event
app.post("/admin/add-field/:eventId", checkAdmin, async (req, res) => {
  const { eventId } = req.params;
  const { label, name, type, options } = req.body;
  const required = req.body.required ? true : false;
  const fieldOptions = type === "dropdown" ? options : null;
  try {
    await db.query(
      `INSERT INTO form_fields (event_id, label, name, type, options, required) VALUES ($1, $2, $3, $4, $5, $6)`,
      [eventId, label, name, type, fieldOptions, required]
    );
    res.redirect(`/admin/dashboard/${eventId}`);
  } catch (err) {
    console.error("Add Field Error:", err);
    res.status(500).send("Error adding field.");
  }
});

app.post(
  "/admin/delete-field/:eventId/:fieldId",
  checkAdmin,
  async (req, res) => {
    const { eventId, fieldId } = req.params;
    try {
      await db.query(
        `DELETE FROM form_fields WHERE id = $1 AND event_id = $2`,
        [fieldId, eventId]
      );
      res.redirect(`/admin/dashboard/${eventId}`);
    } catch (err) {
      console.error("Delete Field Error:", err);
      res.status(500).send("Error deleting field.");
    }
  }
);

// 1. عرض صفحة إدارة المستخدمين (قائمة المستخدمين + فورم الإضافة)
app.get("/admin/users", checkAdmin, async (req, res) => {
  try {
    const result = await db.query(
      "SELECT id, username, role FROM users ORDER BY role, username"
    );
    const users = result.rows;

    const userRows = users
      .map(
        (user) => `
            <tr class="border-b">
                <td class="py-3 px-4">${user.username}</td>
                <td class="py-3 px-4">
                    <span class="px-2 py-1 font-semibold text-xs rounded-full ${
                      user.role === "admin"
                        ? "bg-indigo-100 text-indigo-800"
                        : "bg-blue-100 text-blue-800"
                    }">
                        ${user.role}
                    </span>
                </td>
                <td class="py-3 px-4 flex items-center gap-4">
                    <a href="/admin/users/edit/${
                      user.id
                    }" class="text-yellow-600 hover:underline">تغيير كلمة المرور</a>
                    ${
                      user.id === req.session.userId
                        ? '<button class="text-gray-400 cursor-not-allowed" disabled>حذف</button>'
                        : `<form action="/admin/users/delete/${user.id}" method="POST" onsubmit="return confirm('هل أنت متأكد من حذف هذا المستخدم؟');">
                            <button type="submit" class="text-red-600 hover:underline">حذف</button>
                         </form>`
                    }
                </td>
            </tr>
        `
      )
      .join("");

    res.send(`
            <!DOCTYPE html>
            <html lang="ar" dir="rtl">
            <head>
                <title>إدارة المستخدمين</title>
                <script src="https://cdn.tailwindcss.com"></script>
            </head>
            <body class="bg-gray-100">
                <div class="container mx-auto max-w-4xl mt-10 p-8 bg-white rounded-xl shadow-lg">
                    <a href="/admin/home" class="inline-block mb-8 bg-gray-200 text-gray-700 py-2 px-4 rounded-lg font-semibold hover:bg-gray-300">&larr; العودة للرئيسية</a>
                    <h1 class="text-3xl font-bold text-center text-gray-800 mb-8">إدارة المستخدمين</h1>
                    
                    <div class="overflow-x-auto border rounded-lg">
                        <table class="min-w-full bg-white text-gray-700">
                            <thead class="bg-gray-800 text-white">
                                <tr>
                                    <th class="text-right py-3 px-4">اسم المستخدم</th>
                                    <th class="text-right py-3 px-4">الدور (الصلاحية)</th>
                                    <th class="text-right py-3 px-4">الإجراءات</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y">${userRows}</tbody>
                        </table>
                    </div>

                    <div class="mt-10 p-6 bg-gray-50 rounded-lg border">
                        <h2 class="text-2xl font-semibold text-gray-700 mb-4">إضافة مستخدم جديد</h2>
                        <form action="/admin/users/add" method="POST" class="grid grid-cols-1 md:grid-cols-4 gap-4 items-center">
                            <input type="text" name="username" placeholder="اسم المستخدم" class="w-full px-4 py-2 border rounded-lg" required>
                            <input type="password" name="password" placeholder="كلمة المرور" class="w-full px-4 py-2 border rounded-lg" required>
                            <select name="role" class="w-full px-4 py-2 border rounded-lg">
                                <option value="scanner">ماسح ضوئي (Scanner)</option>
                                <option value="admin">مدير (Admin)</option>
                            </select>
                            <button type="submit" class="w-full bg-green-600 text-white py-2 rounded-lg font-semibold hover:bg-green-700">إضافة مستخدم</button>
                        </form>
                    </div>
                </div>
            </body>
            </html>
        `);
  } catch (err) {
    res.status(500).send("خطأ في تحميل صفحة المستخدمين.");
  }
});

// 2. منطق إضافة مستخدم جديد
app.post("/admin/users/add", checkAdmin, async (req, res) => {
  const { username, password, role } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    await db.query(
      "INSERT INTO users (username, password, role) VALUES ($1, $2, $3)",
      [username, hashedPassword, role]
    );
    res.redirect("/admin/users");
  } catch (err) {
    res.status(500).send("خطأ في إضافة المستخدم، قد يكون الاسم مكررًا.");
  }
});

// 3. منطق حذف مستخدم
app.post("/admin/users/delete/:userId", checkAdmin, async (req, res) => {
  const { userId } = req.params;
  // حماية إضافية: لا تسمح للمدير بحذف نفسه
  if (parseInt(userId, 10) === req.session.userId) {
    return res.status(403).send("لا يمكنك حذف حسابك الخاص.");
  }
  try {
    await db.query("DELETE FROM users WHERE id = $1", [userId]);
    res.redirect("/admin/users");
  } catch (err) {
    res.status(500).send("خطأ في حذف المستخدم.");
  }
});

// 4. عرض صفحة تغيير كلمة المرور
app.get("/admin/users/edit/:userId", checkAdmin, async (req, res) => {
  const { userId } = req.params;
  const result = await db.query("SELECT username FROM users WHERE id = $1", [
    userId,
  ]);
  const user = result.rows[0];
  res.send(`
        <!DOCTYPE html><html lang="ar" dir="rtl"><head><title>تغيير كلمة المرور</title><script src="https://cdn.tailwindcss.com"></script></head>
        <body class="bg-gray-100 flex items-center justify-center min-h-screen">
        <div class="w-full max-w-sm bg-white p-8 rounded-xl shadow-lg">
            <h1 class="text-2xl font-bold text-center text-gray-800 mb-6">تغيير كلمة المرور لـ <span class="text-blue-600">${user.username}</span></h1>
            <form action="/admin/users/update-password/${userId}" method="POST" class="space-y-6">
                <div><label for="password" class="block font-semibold">كلمة المرور الجديدة</label><input type="password" name="password" id="password" class="w-full px-4 py-2 border rounded-lg" required></div>
                <button type="submit" class="w-full bg-yellow-500 text-white py-3 rounded-lg font-semibold hover:bg-yellow-600">تحديث كلمة المرور</button>
            </form>
            <div class="text-center mt-6"><a href="/admin/users" class="text-gray-500 hover:underline">&larr; إلغاء والعودة</a></div>
        </div></body></html>
    `);
});

// 5. منطق تحديث كلمة المرور
app.post(
  "/admin/users/update-password/:userId",
  checkAdmin,
  async (req, res) => {
    const { userId } = req.params;
    const { password } = req.body;
    try {
      const hashedPassword = await bcrypt.hash(password, 10);
      await db.query("UPDATE users SET password = $1 WHERE id = $2", [
        hashedPassword,
        userId,
      ]);
      res.redirect("/admin/users");
    } catch (err) {
      res.status(500).send("خطأ في تحديث كلمة المرور.");
    }
  }
);

// Scanner's welcome page
app.get("/scanner", checkScanner, (req, res) => {
  // We only need to check if the user is logged in.
  // The login route already directs them here if they are a scanner.
  res.send(`
        <!DOCTYPE html>
        <html lang="ar" dir="rtl">
        <head>
            <meta charset="UTF-8">
            <title>جاهز للمسح</title>
            <script src="https://cdn.tailwindcss.com"></script>
        </head>
        <body class="bg-gray-100 flex items-center justify-center min-h-screen">
            <div class="w-full max-w-md bg-white p-8 rounded-xl shadow-lg text-center">
                <div class="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-blue-100 mb-4">
                    <svg class="h-8 w-8 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 4.875c0-1.036.84-1.875 1.875-1.875h4.5c1.036 0 1.875.84 1.875 1.875v4.5c0 1.036-.84 1.875-1.875 1.875h-4.5A1.875 1.875 0 013.75 9.375v-4.5zM3.75 14.625c0-1.036.84-1.875 1.875-1.875h4.5c1.036 0 1.875.84 1.875 1.875v4.5c0 1.036-.84 1.875-1.875 1.875h-4.5a1.875 1.875 0 01-1.875-1.875v-4.5zM13.5 4.875c0-1.036.84-1.875 1.875-1.875h4.5c1.036 0 1.875.84 1.875 1.875v4.5c0 1.036-.84 1.875-1.875 1.875h-4.5a1.875 1.875 0 01-1.875-1.875v-4.5zM13.5 14.625c0-1.036.84-1.875 1.875-1.875h4.5c1.036 0 1.875.84 1.875 1.875v4.5c0 1.036-.84 1.875-1.875 1.875h-4.5a1.875 1.875 0 01-1.875-1.875v-4.5z" />
                    </svg>
                </div>
                <h1 class="text-2xl font-bold text-gray-800">أهلاً بك، ${req.session.username}!</h1>
                <p class="text-gray-600 mt-2">أنت الآن جاهز لمسح تذاكر الزوار.</p>
                <p class="mt-4 font-semibold text-blue-600">الرجاء استخدام كاميرا جوالك الأساسية لمسح رموز QR.</p>
                
                <div class="mt-8">
                    <a href="/logout" class="w-full bg-red-500 text-white py-3 rounded-lg font-semibold hover:bg-red-600 transition duration-300">تسجيل الخروج</a>
                </div>
            </div>
        </body>
        </html>
    `);
});

// Logout route
app.get("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.redirect("/");
    }
    res.clearCookie("connect.sid"); // The default session cookie name
    res.redirect("/login");
  });
});

// server.js (في نهاية الملف)

// دالة لبدء تشغيل الخادم
const startServer = () => {
  app.listen(port, () => {
    console.log(`الخادم يعمل على المنفذ ${port}`);
  });
};

// دالة لإنشاء المدير الأول إذا لم يكن موجودًا
const createFirstAdmin = async () => {
  try {
    const result = await db.query("SELECT COUNT(*) FROM users");
    if (parseInt(result.rows[0].count, 10) === 0) {
      console.log("جدول المستخدمين فارغ، سيتم إنشاء حساب المدير الافتراضي...");
      const username = "admin";
      const password = "password123"; // <-- كلمة مرور افتراضية، يجب تغييرها
      const role = "admin";

      const hashedPassword = await bcrypt.hash(password, 10);
      await db.query(
        "INSERT INTO users (username, password, role) VALUES ($1, $2, $3)",
        [username, hashedPassword, role]
      );

      console.log("=============================================");
      console.log("تم إنشاء حساب المدير الافتراضي بنجاح!");
      console.log(`اسم المستخدم: ${username}`);
      console.log(`كلمة المرور: ${password}`);
      console.log("الرجاء تسجيل الدخول وتغيير كلمة المرور فورًا.");
      console.log("=============================================");
    }
  } catch (err) {
    console.error("فشل في إنشاء حساب المدير الأول:", err);
  }
};

// تشغيل الإعدادات ثم الخادم
db.setupDatabase()
  .then(async () => {
    await createFirstAdmin(); // <-- إضافة هذه الخطوة
    console.log("إعداد قاعدة البيانات اكتمل. بدء تشغيل الخادم...");
    startServer();
  })
  .catch((err) => {
    console.error("فشل إعداد قاعدة البيانات. لم يتم تشغيل الخادم.", err);
    process.exit(1);
  });
