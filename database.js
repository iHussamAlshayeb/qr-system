// database.js
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

const setupDatabase = async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS events (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        location TEXT,
        event_date TIMESTAMPTZ,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // --- التعديل هنا ---
    await client.query(`
      CREATE TABLE IF NOT EXISTS registrations (
        id SERIAL PRIMARY KEY,
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        national_id TEXT,
        dynamic_data JSONB,
        ticket_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'UNUSED',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (event_id, email, national_id) -- هذا هو القانون الجديد: التركيبة فريدة
      )
    `);
    // --- نهاية التعديل ---

    await client.query(`
      CREATE TABLE IF NOT EXISTS form_fields (
        id SERIAL PRIMARY KEY,
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'text',
        options TEXT,
        required BOOLEAN NOT NULL DEFAULT TRUE,
        is_active BOOLEAN NOT NULL DEFAULT TRUE
      )
    `);

    await client.query(`
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    role TEXT NOT NULL -- 'admin' or 'scanner'
  )
`);
    console.log("PostgreSQL database tables are ready.");
  } finally {
    client.release();
  }
};
module.exports = {
  query: (text, params) => pool.query(text, params),
  setupDatabase: setupDatabase,
};
