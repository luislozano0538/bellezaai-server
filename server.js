
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
app.use(express.json({limit:"1mb"}));

function requireConfig(res) {
  const missing = ["DATABASE_URL","JWT_SECRET"].filter(k => !process.env[k]);
  if (missing.length) {
    res.status(503).json({error:`Falta configurar: ${missing.join(", ")}`});
    return false;
  }
  return true;
}
function auth(req,res,next){
  if(!JWT_SECRET) return res.status(503).json({error:"JWT_SECRET no configurado."});
  try {
    req.user = jwt.verify((req.headers.authorization||"").replace("Bearer ",""), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({error:"Sesión inválida."});
  }
}

app.get("/health", async (_req,res)=>{
  try {
    if(!process.env.DATABASE_URL) return res.json({ok:true,database:false});
    await pool.query("SELECT 1");
    res.json({ok:true,database:true});
  } catch { res.status(503).json({ok:false,database:false}); }
});

app.post("/api/auth/register", async (req,res)=>{
  if(!requireConfig(res)) return;
  const {email,password,name,salonName="Color & Stillo"}=req.body||{};
  if(!email||!password||!name) return res.status(400).json({error:"Faltan datos."});
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    const salonId=crypto.randomUUID(), userId=crypto.randomUUID();
    const slug=`${salonName.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")}-${salonId.slice(0,6)}`;
    await client.query("INSERT INTO salons(id,name,slug) VALUES($1,$2,$3)",[salonId,salonName,slug]);
    const hash=await bcrypt.hash(password,12);
    await client.query("INSERT INTO users(id,salon_id,email,password_hash,name) VALUES($1,$2,$3,$4,$5)",
      [userId,salonId,email.toLowerCase(),hash,name]);
    await client.query("COMMIT");
    const token=jwt.sign({id:userId,salonId,role:"owner"},JWT_SECRET,{expiresIn:"7d"});
    res.status(201).json({token,salonId});
  } catch(e) {
    await client.query("ROLLBACK");
    res.status(409).json({error:"No se pudo crear la cuenta."});
  } finally { client.release(); }
});

app.post("/api/auth/login", async(req,res)=>{
  if(!requireConfig(res)) return;
  const {email,password}=req.body||{};
  const q=await pool.query("SELECT * FROM users WHERE email=$1",[String(email).toLowerCase()]);
  const u=q.rows[0];
  if(!u || !(await bcrypt.compare(password||"",u.password_hash)))
    return res.status(401).json({error:"Credenciales incorrectas."});
  const token=jwt.sign({id:u.id,salonId:u.salon_id,role:u.role},JWT_SECRET,{expiresIn:"7d"});
  res.json({token});
});

app.get("/api/dashboard",auth,async(req,res)=>{
  const sid=req.user.salonId;
  const [a,c,r]=await Promise.all([
    pool.query("SELECT COUNT(*)::int n FROM appointments WHERE salon_id=$1 AND status<>'cancelled'",[sid]),
    pool.query("SELECT COUNT(*)::int n FROM clients WHERE salon_id=$1",[sid]),
    pool.query("SELECT COUNT(*)::int n FROM reminders x JOIN appointments a ON a.id=x.appointment_id WHERE a.salon_id=$1 AND x.status='pending'",[sid])
  ]);
  res.json({appointments:a.rows[0].n,clients:c.rows[0].n,pendingReminders:r.rows[0].n});
});

app.get("/api/appointments",auth,async(req,res)=>{
  const q=await pool.query(
    `SELECT a.id,a.starts_at,a.ends_at,a.status,c.name,c.phone,s.name service,s.price_label price
     FROM appointments a JOIN clients c ON c.id=a.client_id JOIN services s ON s.id=a.service_id
     WHERE a.salon_id=$1 ORDER BY a.starts_at`,[req.user.salonId]);
  res.json(q.rows);
});

app.post("/api/chat",async(req,res)=>{
  if(!process.env.OPENAI_API_KEY) return res.status(503).json({error:"OPENAI_API_KEY no configurada."});
  const message=String(req.body?.message||"").trim();
  if(!message) return res.status(400).json({error:"Falta mensaje."});
  const ai=new OpenAI({apiKey:process.env.OPENAI_API_KEY});
  const out=await ai.responses.create({
    model:process.env.OPENAI_MODEL||"gpt-5.6-sol",
    instructions:`You are BellezaAI, a bilingual salon receptionist.
Match Spanish or English. Never invent prices, discounts, appointment availability, or confirmations.
Availability must come from the booking database. Keep replies concise and professional.`,
    input:message,
    max_output_tokens:300,
    store:false
  });
  res.json({reply:out.output_text?.trim()||""});
});

app.get("/api/plans",(_req,res)=>res.json([
  {id:"starter",monthly:49},{id:"pro",monthly:79},{id:"premium",monthly:129}
]));

// These deliberately refuse to fake external services until credentials/providers are connected.
app.post("/api/payments/checkout",auth,(_req,res)=>
  res.status(501).json({error:"Proveedor de pagos aún no conectado."})
);
app.post("/api/messages/send",auth,(_req,res)=>
  res.status(501).json({error:"Proveedor SMS/WhatsApp aún no conectado."})
);

app.listen(PORT,()=>console.log(`BellezaAI production API on ${PORT}`));
