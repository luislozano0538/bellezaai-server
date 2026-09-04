import "dotenv/config";
import express from "express";
import cors from "cors";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pg from "pg";
import OpenAI from "openai";

const { Pool } = pg;
const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const PORT = Number(process.env.PORT || 3001);
const JWT_SECRET = process.env.JWT_SECRET;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS salons (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      salon_id UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'owner',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS clients (
      id UUID PRIMARY KEY,
      salon_id UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS services (
      id UUID PRIMARY KEY,
      salon_id UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      price_label TEXT,
      duration_minutes INTEGER DEFAULT 60,
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id UUID PRIMARY KEY,
      salon_id UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
      client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      service_id UUID NOT NULL REFERENCES services(id),
      starts_at TIMESTAMPTZ NOT NULL,
      ends_at TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL DEFAULT 'confirmed',
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS reminders (
      id UUID PRIMARY KEY,
      appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      scheduled_at TIMESTAMPTZ,
      sent_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_clients_salon
      ON clients(salon_id);

    CREATE INDEX IF NOT EXISTS idx_services_salon
      ON services(salon_id);

    CREATE INDEX IF NOT EXISTS idx_appointments_salon_start
      ON appointments(salon_id, starts_at);

    CREATE INDEX IF NOT EXISTS idx_reminders_appointment
      ON reminders(appointment_id);
  `);

  console.log("BellezaAI database ready");
}

function requireConfig(res) {
  const missing = ["DATABASE_URL", "JWT_SECRET"].filter(
    k => !process.env[k]
  );

  if (missing.length) {
    res.status(503).json({
      error: `Falta configurar: ${missing.join(", ")}`
    });
    return false;
  }

  return true;
}

function auth(req, res, next) {
  if (!JWT_SECRET) {
    return res.status(503).json({
      error: "JWT_SECRET no configurado."
    });
  }

  try {
    const token = (req.headers.authorization || "")
      .replace("Bearer ", "");

    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({
      error: "Sesión inválida."
    });
  }
}

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      ok: true,
      database: true
    });
  } catch {
    res.status(503).json({
      ok: false,
      database: false
    });
  }
});

app.post("/api/auth/register", async (req, res) => {
  if (!requireConfig(res)) return;

  const {
    email,
    password,
    name,
    salonName = "Color & Stillo"
  } = req.body || {};

  if (!email || !password || !name) {
    return res.status(400).json({
      error: "Faltan datos."
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const salonId = crypto.randomUUID();
    const userId = crypto.randomUUID();

    const slug =
      `${salonName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")}-${salonId.slice(0, 6)}`;

    await client.query(
      "INSERT INTO salons(id,name,slug) VALUES($1,$2,$3)",
      [salonId, salonName, slug]
    );

    const hash = await bcrypt.hash(password, 12);

    await client.query(
      `INSERT INTO users
       (id,salon_id,email,password_hash,name)
       VALUES($1,$2,$3,$4,$5)`,
      [
        userId,
        salonId,
        email.toLowerCase(),
        hash,
        name
      ]
    );

    await client.query("COMMIT");

    const token = jwt.sign(
      {
        id: userId,
        salonId,
        role: "owner"
      },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(201).json({
      token,
      salonId
    });
  } catch (error) {
    await client.query("ROLLBACK");

    console.error(error);

    res.status(409).json({
      error: "No se pudo crear la cuenta."
    });
  } finally {
    client.release();
  }
});

app.post("/api/auth/login", async (req, res) => {
  if (!requireConfig(res)) return;

  const { email, password } = req.body || {};

  const q = await pool.query(
    "SELECT * FROM users WHERE email=$1",
    [String(email || "").toLowerCase()]
  );

  const user = q.rows[0];

  if (
    !user ||
    !(await bcrypt.compare(
      password || "",
      user.password_hash
    ))
  ) {
    return res.status(401).json({
      error: "Credenciales incorrectas."
    });
  }

  const token = jwt.sign(
    {
      id: user.id,
      salonId: user.salon_id,
      role: user.role
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );

  res.json({ token });
});

app.get("/api/dashboard", auth, async (req, res) => {
  const sid = req.user.salonId;

  const [appointments, clients, reminders] =
    await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int n
         FROM appointments
         WHERE salon_id=$1
         AND status<>'cancelled'`,
        [sid]
      ),

      pool.query(
        `SELECT COUNT(*)::int n
         FROM clients
         WHERE salon_id=$1`,
        [sid]
      ),

      pool.query(
        `SELECT COUNT(*)::int n
         FROM reminders r
         JOIN appointments a
         ON a.id=r.appointment_id
         WHERE a.salon_id=$1
         AND r.status='pending'`,
        [sid]
      )
    ]);

  res.json({
    appointments: appointments.rows[0].n,
    clients: clients.rows[0].n,
    pendingReminders: reminders.rows[0].n
  });
});

app.get("/api/appointments", auth, async (req, res) => {
  const q = await pool.query(
    `SELECT
       a.id,
       a.starts_at,
       a.ends_at,
       a.status,
       c.name,
       c.phone,
       s.name AS service,
       s.price_label AS price
     FROM appointments a
     JOIN clients c ON c.id=a.client_id
     JOIN services s ON s.id=a.service_id
     WHERE a.salon_id=$1
     ORDER BY a.starts_at`,
    [req.user.salonId]
  );

  res.json(q.rows);
});  
app.get("/api/clients", auth, async (req, res) => {
  try {
    const q = await pool.query(
      `SELECT id, name, phone, email, notes, created_at
       FROM clients
       WHERE salon_id=$1
       ORDER BY name`,
      [req.user.salonId]
    );

    res.json(q.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudieron cargar los clientes." });
  }
});

app.post("/api/clients", auth, async (req, res) => {
  try {
    const { name, phone = "", email = "", notes = "" } = req.body || {};

    if (!name) {
      return res.status(400).json({ error: "Falta el nombre del cliente." });
    }

    const id = crypto.randomUUID();

    const q = await pool.query(
      `INSERT INTO clients
       (id, salon_id, name, phone, email, notes)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, name, phone, email, notes, created_at`,
      [id, req.user.salonId, name, phone, email, notes]
    );

    res.status(201).json(q.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudo guardar el cliente." });
  }
});

app.get("/api/services", auth, async (req, res) => {
  try {
    const q = await pool.query(
      `SELECT id, name, duration_minutes, price_label
       FROM services
       WHERE salon_id=$1 AND active=true
       ORDER BY name`,
      [req.user.salonId]
    );

    res.json(q.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudieron cargar los servicios." });
  }
});

app.post("/api/appointments", auth, async (req, res) => {
  try {
    const { clientId, serviceId, startsAt, notes = "" } = req.body || {};

    if (!clientId || !serviceId || !startsAt) {
      return res.status(400).json({ error: "Faltan datos de la cita." });
    }

    const service = await pool.query(
      `SELECT id, duration_minutes
       FROM services
       WHERE id=$1 AND salon_id=$2 AND active=true`,
      [serviceId, req.user.salonId]
    );

    if (!service.rows[0]) {
      return res.status(404).json({ error: "Servicio no encontrado." });
    }

    const client = await pool.query(
      `SELECT id FROM clients
       WHERE id=$1 AND salon_id=$2`,
      [clientId, req.user.salonId]
    );

    if (!client.rows[0]) {
      return res.status(404).json({ error: "Cliente no encontrado." });
    }

    const start = new Date(startsAt);

    if (Number.isNaN(start.getTime())) {
      return res.status(400).json({ error: "Fecha de cita inválida." });
    }

    const end = new Date(
      start.getTime() + service.rows[0].duration_minutes * 60000
    );

    const conflict = await pool.query(
      `SELECT id FROM appointments
       WHERE salon_id=$1
       AND status<>'cancelled'
       AND starts_at < $3
       AND ends_at > $2
       LIMIT 1`,
      [req.user.salonId, start, end]
    );

    if (conflict.rows[0]) {
      return res.status(409).json({
        error: "Ese horario ya tiene una cita."
      });
    }

    const id = crypto.randomUUID();

    const q = await pool.query(
      `INSERT INTO appointments
       (id, salon_id, client_id, service_id, starts_at, ends_at, status, notes)
       VALUES ($1,$2,$3,$4,$5,$6,'confirmed',$7)
       RETURNING *`,
      [
        id,
        req.user.salonId,
        clientId,
        serviceId,
        start,
        end,
        notes
      ]
    );

    res.status(201).json(q.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudo guardar la cita." });
  }
});
app.post("/api/chat", async (req, res) => {
  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({
      error: "OPENAI_API_KEY no configurada."
    });
  }

  const message =
    String(req.body?.message || "").trim();

  if (!message) {
    return res.status(400).json({
      error: "Falta mensaje."
    });
  }

  try {
    const ai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    const out = await ai.responses.create({
      model:
        process.env.OPENAI_MODEL ||
        "gpt-5.6-sol",

      instructions:
        `You are BellezaAI, a bilingual salon receptionist.
Match Spanish or English.
Never invent prices, discounts, appointment availability, or confirmations.
Keep replies concise and professional.`,

      input: message,
      max_output_tokens: 300,
      store: false
    });

    res.json({
      reply: out.output_text?.trim() || ""
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "No se pudo obtener respuesta de BellezaAI."
    });
  }
});

app.get("/api/plans", (_req, res) => {
  res.json([
    { id: "starter", monthly: 49 },
    { id: "pro", monthly: 79 },
    { id: "premium", monthly: 129 }
  ]);
});

app.post("/api/payments/checkout", auth, (_req, res) => {
  res.status(501).json({
    error: "Proveedor de pagos aún no conectado."
  });
});

app.post("/api/messages/send", auth, (_req, res) => {
  res.status(501).json({
    error: "Proveedor SMS/WhatsApp aún no conectado."
  });
});

async function start() {
  try {
    await initDatabase();

    app.listen(PORT, () => {
      console.log(
        `BellezaAI production API on ${PORT}`
      );
    });
  } catch (error) {
    console.error(
      "Error preparando BellezaAI database:",
      error
    );

    process.exit(1);
  }
}

start();
