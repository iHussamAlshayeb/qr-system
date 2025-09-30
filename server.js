// 1. Import Libraries
const express = require("express");
const db = require("./database.js");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const qr = require("qrcode");
const session = require("express-session");
const fs = require("fs");
// const sgMail = require('@sendgrid/mail');

// 2. App Setup
const app = express();
app.use(session({
    secret: "a-very-secret-key-that-you-should-change",
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }, // Set to true in production with HTTPS
}));
app.use(express.urlencoded({ extended: true }));
const port = process.env.PORT || 3000;
// sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// --- Middleware ---
const checkAuth = (req, res, next) => {
    if (req.session.isLoggedIn) { next(); } else { res.redirect("/login"); }
};

// --- Public Routes ---

// Homepage to list all events
app.get("/", async (req, res) => {
    try {
        const result = await db.query(`SELECT * FROM events ORDER BY created_at DESC`);
        const eventsGridHtml = result.rows.map(event => `
            <div class="bg-white rounded-xl shadow-md overflow-hidden transform hover:-translate-y-1 transition-transform duration-300">
                <div class="p-6">
                    <h3 class="text-xl font-bold text-gray-800 mb-2">${event.name}</h3>
                    <p class="text-gray-600 text-sm mb-4">${event.description || ''}</p>
                    <a href="/register/${event.id}" class="mt-4 inline-block bg-blue-600 text-white py-2 px-5 rounded-lg font-semibold hover:bg-blue-700">سجل الآن</a>
                </div>
            </div>
        `).join('');

        res.send(`
            <!DOCTYPE html><html lang="ar" dir="rtl"><head><title>قائمة المناسبات</title><script src="https://cdn.tailwindcss.com"></script></head>
            <body class="bg-gray-100"><div class="container mx-auto max-w-5xl py-12 px-4">
                <h1 class="text-4xl font-bold text-center text-gray-800 mb-10">المناسبات المتاحة</h1>
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    ${eventsGridHtml.length > 0 ? eventsGridHtml : '<p class="text-center text-gray-500 col-span-3">لا توجد مناسبات متاحة حاليًا.</p>'}
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
        const eventResult = await db.query(`SELECT name FROM events WHERE id = $1`, [eventId]);
        const fieldsResult = await db.query(`SELECT * FROM form_fields WHERE event_id = $1 AND is_active = TRUE ORDER BY id`, [eventId]);
        
        const event = eventResult.rows[0];
        if (!event) return res.status(404).send("Event not found.");

        const fields = fieldsResult.rows;
        const dynamicFieldsHtml = fields.map(field => {
            const requiredAttr = field.required ? 'required' : '';
            const commonClasses = "class='w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500'";
            const labelHtml = `<label for="${field.name}" class="block text-gray-700 font-semibold mb-2">${field.label}</label>`;

            if (field.type === 'dropdown') {
                const optionsArray = field.options.split(',');
                const optionTags = optionsArray.map(opt => `<option value="${opt.trim()}">${opt.trim()}</option>`).join('');
                return `<div class="mb-4">${labelHtml}<select id="${field.name}" name="${field.name}" ${commonClasses} ${requiredAttr}>${optionTags}</select></div>`;
            } else {
                return `<div class="mb-4">${labelHtml}<input type="${field.type}" id="${field.name}" name="${field.name}" ${commonClasses} ${requiredAttr}></div>`;
            }
        }).join('');

        fs.readFile(path.join(__dirname, "index.html"), "utf8", (err, htmlData) => {
            if (err) throw err;
            const finalHtml = htmlData
                .replace('{-- EVENT_TITLE --}', event.name)
                .replace('{-- DYNAMIC_FIELDS --}', dynamicFieldsHtml)
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
    
    try {
        await db.query(`INSERT INTO registrations (event_id, name, email, dynamic_data, ticket_id) VALUES ($1, $2, $3, $4, $5)`, [eventId, name, email, dynamicData]);
        const verificationUrl = `${process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`}/verify/${ticketId}`;
        const qrCodeUrl = await qr.toDataURL(verificationUrl);
        
        // Add your email sending logic here

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
        console.error("Registration Submission Error:", err);
        res.status(400).send("Error: Email may be already registered.");
    }
});

// QR Code verification route
app.get("/verify/:ticketId", checkAuth, async (req, res) => {
    const { ticketId } = req.params;
    try {
        const result = await db.query(`SELECT r.*, e.name as event_name FROM registrations r JOIN events e ON r.event_id = e.id WHERE r.ticket_id = $1`, [ticketId]);
        const row = result.rows[0];

        if (!row) {
             return res.status(404).send(`... HTML for invalid ticket ...`);
        }
        if (row.status === "USED") {
            return res.status(409).send(`... HTML for already used ticket ...`);
        }

        await db.query(`UPDATE registrations SET status = 'USED' WHERE ticket_id = $1`, [ticketId]);
        const dynamicData = row.dynamic_data || {};
        let dynamicDataHtml = Object.entries(dynamicData).map(([key, value]) => `<div class="py-2"><p class="text-sm font-semibold text-gray-700">${key.replace(/_/g, ' ')}</p><p class="text-gray-900">${value}</p></div>`).join('');
        res.send(`... HTML for successful verification with dynamic data ...`);
    } catch (err) {
        console.error("Verification Error:", err);
        res.status(500).send("Server error during verification.");
    }
});


// --- Admin Routes ---
const STAFF_PASSWORD = "password123";

app.get("/login", (req, res) => res.sendFile(path.join(__dirname, "login.html")));

app.post("/login", (req, res) => {
    if (req.body.password === STAFF_PASSWORD) {
        req.session.isLoggedIn = true;
        res.redirect("/admin/events");
    } else {
        res.send("Incorrect password!");
    }
});

// Main page for event management
app.get('/admin/events', checkAuth, async (req, res) => {
    try {
        const result = await db.query(`SELECT * FROM events ORDER BY created_at DESC`);
        const eventRows = result.rows.map(event => `
            <tr>
                <td class="py-3 px-4">${event.name}</td>
                <td class="py-3 px-4"><a href="/register/${event.id}" target="_blank" class="text-blue-500 hover:underline">/register/${event.id}</a></td>
                <td class="py-3 px-4"><a href="/admin/dashboard/${event.id}" class="font-bold text-green-600 hover:underline">عرض لوحة التحكم</a></td>
            </tr>
        `).join('');
        fs.readFile(path.join(__dirname, "events.html"), "utf8", (err, htmlData) => {
            if (err) throw err;
            res.send(htmlData.replace("{-- EVENTS_TABLE_ROWS --}", eventRows));
        });
    } catch (err) {
        console.error("Admin Events Error:", err);
        res.status(500).send("Error fetching events.");
    }
});

// Add a new event
app.post('/admin/events/add', checkAuth, async (req, res) => {
    const { name, description } = req.body;
    try {
        const result = await db.query(`INSERT INTO events (name, description) VALUES ($1, $2) RETURNING id`, [name, description]);
        const eventId = result.rows[0].id;
        // Add default fields for the new event
        await db.query(`INSERT INTO form_fields (event_id, label, name, type) VALUES ($1, 'الاسم الكامل', 'name', 'text')`, [eventId]);
        await db.query(`INSERT INTO form_fields (event_id, label, name, type) VALUES ($1, 'البريد الإلكتروني', 'email', 'email')`, [eventId]);
        res.redirect('/admin/events');
    } catch (err) {
        console.error("Add Event Error:", err);
        res.status(500).send("Error creating event.");
    }
});

// Event-specific dashboard
app.get('/admin/dashboard/:eventId', checkAuth, async (req, res) => {
    const { eventId } = req.params;
    try {
        const [eventResult, totalResult, attendedResult, usersResult, fieldsResult] = await Promise.all([
            db.query(`SELECT name FROM events WHERE id = $1`, [eventId]),
            db.query(`SELECT COUNT(*) as total FROM registrations WHERE event_id = $1`, [eventId]),
            db.query(`SELECT COUNT(*) as attended FROM registrations WHERE event_id = $1 AND status = 'USED'`, [eventId]),
            db.query(`SELECT id, name, email, status, created_at FROM registrations WHERE event_id = $1 ORDER BY created_at DESC`, [eventId]),
            db.query(`SELECT * FROM form_fields WHERE event_id = $1 ORDER BY id`, [eventId])
        ]);

        const event = eventResult.rows[0];
        if (!event) return res.status(404).send("Event not found.");

        const totalRow = totalResult.rows[0];
        const attendedRow = attendedResult.rows[0];
        const users = usersResult.rows;
        const fields = fieldsResult.rows;

        const userRows = users.map(user => `...`).join(''); // Your existing userRows HTML generation
        const fieldRows = fields.map(field => `...`).join(''); // Your existing fieldRows HTML generation

        res.send(`... Your full admin dashboard HTML, now populated with this data ...`);
    } catch (err) {
        console.error("Dashboard Error:", err);
        res.status(500).send('Error loading dashboard.');
    }
});

// Show registration details
app.get('/admin/registration/:registrationId', checkAuth, async (req, res) => {
    const { registrationId } = req.params;
    try {
        const result = await db.query(`SELECT r.*, e.name as event_name FROM registrations r JOIN events e ON r.event_id = e.id WHERE r.id = $1`, [registrationId]);
        const row = result.rows[0];
        if (!row) return res.status(404).send("Registration not found.");

        // ... HTML generation for the details page ...
        res.send(`... Full HTML for registration details page ...`);
    } catch(err) {
        console.error("Registration Details Error:", err);
        res.status(500).send("Error fetching registration details.");
    }
});

// Add/Delete form fields for an event
app.post("/admin/add-field/:eventId", checkAuth, async (req, res) => {
    const { eventId } = req.params;
    const { label, name, type, options } = req.body;
    const required = req.body.required ? true : false;
    const fieldOptions = (type === 'dropdown') ? options : null;
    try {
        await db.query(`INSERT INTO form_fields (event_id, label, name, type, options, required) VALUES ($1, $2, $3, $4, $5, $6)`, [eventId, label, name, type, fieldOptions, required]);
        res.redirect(`/admin/dashboard/${eventId}`);
    } catch (err) {
        console.error("Add Field Error:", err);
        res.status(500).send("Error adding field.");
    }
});

app.post('/admin/delete-field/:eventId/:fieldId', checkAuth, async (req, res) => {
    const { eventId, fieldId } = req.params;
    try {
        await db.query(`DELETE FROM form_fields WHERE id = $1 AND event_id = $2`, [fieldId, eventId]);
        res.redirect(`/admin/dashboard/${eventId}`);
    } catch (err) {
        console.error("Delete Field Error:", err);
        res.status(500).send('Error deleting field.');
    }
});

// Start Server
// A function to start the server
const startServer = () => {
  app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });
};

// Call the database setup function, and ONLY if it succeeds, start the server
db.setupDatabase()
  .then(() => {
    console.log("Database setup complete. Starting server...");
    startServer();
  })
  .catch(err => {
    console.error("Failed to set up database. Server not started.", err);
    process.exit(1); // Exit the process with an error code
  });