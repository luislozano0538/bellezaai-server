
import crypto from "crypto";
import { registerPublicLuna } from "./public-luna.js";
import OpenAI from "openai";
import { bookingReceipt, registerPublicManagement } from "./public-management.js";

export function registerPublicBooking({app,pool,auth,validBusinessHours,withinBusinessHours,managementSecret}) {
  const uuid = value => typeof value==="string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  const fail = (code,message) => Object.assign(new Error(message),{status:code});
  const reads = new Map();
  function limit(req,res,next) {
    const key=req.params.id, now=Date.now();
    if(!uuid(key))return res.status(404).json({error:'Página no disponible.'});
    if(reads.size>=2000) for(const [id,item] of reads) if(item.until<=now) reads.delete(id);
    const item=reads.get(key);
    if(!item && reads.size>=2000)return res.status(429).json({error:'Inténtalo más tarde.'});
    if(item && item.until>now && item.count>=180) return res.status(429).json({error:"Espera un minuto antes de consultar otra vez."});
    reads.set(key,item && item.until>now ? {...item,count:item.count+1}:{until:now+60000,count:1});
    next();
  }
  registerPublicManagement({app,pool,limit,secret:managementSecret,availability});
  registerPublicLuna({app,pool,limit,salon,availability,OpenAI});
  async function salon(db,id) {
    if(!uuid(id)) throw fail(404,"Página de reservas no disponible.");
    const result=await db.query("SELECT id,name,business_hours FROM salons WHERE id=$1 AND public_booking_enabled=true FOR SHARE",[id]);
    const row=result.rows[0];
    if(!row || !validBusinessHours(row.business_hours)) throw fail(404,"Este salón todavía no acepta reservas en línea.");
    return row;
  }
  async function availability(db,id,serviceId,professionalId,date,excludeAppointmentId=null,durationOverride=null) {
    const shop=await salon(db,id);
    if(!uuid(serviceId) || (professionalId && !uuid(professionalId)) || (typeof date!=="string" || !/^\d{4}-\d{2}-\d{2}$/.test(date))) throw fail(400,"Selecciona servicio, profesional y fecha.");
    const parsed=new Date(date+"T12:00:00Z");
    if(Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0,10)!==date || parsed.getTime()<Date.now()-86400000 || parsed.getTime()>Date.now()+90*86400000) throw fail(400,"Elige una fecha entre hoy y los próximos 90 días.");
    const service=(await db.query("SELECT id,name,duration_minutes,price_label FROM services WHERE id=$1 AND salon_id=$2 AND active=true FOR SHARE",[serviceId,id])).rows[0];
    if(!service || !Number.isInteger(service.duration_minutes) || service.duration_minutes<1 || service.duration_minutes>1440) throw fail(400,"Servicio no disponible.");
    if(durationOverride!==null){
      if(!Number.isFinite(durationOverride)||durationOverride<1||durationOverride>1440)throw fail(409,"Contacta con el salón para cambiar esta cita.");
      service.duration_minutes=durationOverride;
    }
    const team=(await db.query("SELECT id,weekly_hours FROM professionals WHERE salon_id=$1 AND active=true AND ($2::uuid IS NULL OR id=$2) FOR SHARE",[id,professionalId||null])).rows;
    if(professionalId && !team.length)throw fail(400,"Profesional no disponible.");
    const closures=(await db.query("SELECT professional_id,((starts_on::timestamp+COALESCE(starts_minute,0)*INTERVAL '1 minute') AT TIME ZONE $3) AS starts_at,((ends_on::timestamp+COALESCE(ends_minute,1440)*INTERVAL '1 minute') AT TIME ZONE $3) AS ends_at FROM salon_closures WHERE salon_id=$1 AND active=true AND starts_on<=$2::date AND ends_on>=$2::date",[id,date,shop.business_hours.timezone])).rows;
    const blocked=(professional,start,end)=>closures.some(closure=>(closure.professional_id===null||closure.professional_id===professional)&&start<new Date(closure.ends_at)&&end>new Date(closure.starts_at));
    const works=(member,start,end)=>{
      if(blocked(member.id,start,end))return false;
      if(member.weekly_hours===null)return true;
      const hours={timezone:shop.business_hours.timezone,days:member.weekly_hours};
      return validBusinessHours(hours)&&withinBusinessHours(hours,start,end);
    };
    const day=shop.business_hours.days[parsed.getUTCDay()];
    if(!day?.open) return {shop,service,slots:[]};
    const rows=await db.query(`
      SELECT slot AS starts_at FROM generate_series(
        (($1::date + $2::time) AT TIME ZONE $4),
        (($1::date + $3::time) AT TIME ZONE $4) - $5 * INTERVAL '1 minute',
        INTERVAL '15 minutes') slot
      WHERE slot > NOW() + INTERVAL '30 minutes'
      AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.salon_id=$6
        AND ($8::uuid IS NULL OR a.id<>$8) AND a.status<>'cancelled' AND a.starts_at < slot + $5 * INTERVAL '1 minute' AND a.ends_at>slot
        AND ($7::uuid IS NULL OR a.professional_id=$7 OR a.professional_id IS NULL))
      ORDER BY slot`,[date,day.start,day.end,shop.business_hours.timezone,service.duration_minutes,id,professionalId||null,excludeAppointmentId]);
    return {shop,service,slots:rows.rows.map(row=>new Date(row.starts_at)).filter(start=>!blocked(null,start,new Date(start.getTime()+service.duration_minutes*60000)) && withinBusinessHours(shop.business_hours,start,new Date(start.getTime()+service.duration_minutes*60000)) && (!team.length || team.some(member=>works(member,start,new Date(start.getTime()+service.duration_minutes*60000)))))};
  }
  app.get("/reservar/:id",(_req,res)=>res.sendFile("booking.html",{root:process.cwd()}));
  app.get("/api/salon/public-booking",auth,async(req,res)=>{
    try {
      const row=(await pool.query("SELECT id,public_booking_enabled,business_hours FROM salons WHERE id=$1",[req.user.salonId])).rows[0];
      res.json({enabled:!!row?.public_booking_enabled,path:"/reservar/"+req.user.salonId,ready:validBusinessHours(row?.business_hours)&&row.business_hours.days.some(day=>day.open)});
    } catch {res.status(500).json({error:"No se pudo cargar la configuración."});}
  });
  app.patch("/api/salon/public-booking",auth,async(req,res)=>{
    if(req.user.role!=="owner") return res.status(403).json({error:"Solo el propietario puede publicar las reservas."});
    if(typeof req.body?.enabled!=="boolean")return res.status(400).json({error:"Estado inválido."});
    let db;
    try {
      db=await pool.connect();await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))",[req.user.salonId]);
      const row=(await db.query("SELECT business_hours FROM salons WHERE id=$1",[req.user.salonId])).rows[0];
      if(req.body.enabled && (!validBusinessHours(row?.business_hours)||!row.business_hours.days.some(day=>day.open)))throw fail(400,"Configura primero el horario del salón y al menos un día de atención.");
      if(req.body.enabled && !(await db.query("SELECT id FROM services WHERE salon_id=$1 AND active=true LIMIT 1",[req.user.salonId])).rows[0])throw fail(400,"Añade al menos un servicio activo.");
      await db.query("UPDATE salons SET public_booking_enabled=$2 WHERE id=$1",[req.user.salonId,req.body.enabled]);
      await db.query("COMMIT");res.json({enabled:req.body.enabled});
    }catch(error){if(db)await db.query("ROLLBACK").catch(()=>{});res.status(error.status||500).json({error:error.status?error.message:"No se pudo actualizar la publicación."});}
    finally{if(db)db.release();}
  });
  app.get("/api/public/salons/:id",limit,async(req,res)=>{
    try {
      const shop=await salon(pool,req.params.id);
      const [services,professionals,profile]=await Promise.all([
        pool.query("SELECT id,name,duration_minutes,price_label FROM services WHERE salon_id=$1 AND active=true ORDER BY name",[shop.id]),
        pool.query("SELECT id,name FROM professionals WHERE salon_id=$1 AND active=true ORDER BY name",[shop.id]),
        pool.query("SELECT public_profile FROM salons WHERE id=$1",[shop.id])
      ]);
      res.set("Cache-Control","no-store").json({profile:profile.rows[0]?.public_profile||{},name:shop.name,timezone:shop.business_hours.timezone,hours:shop.business_hours.days.map(day=>({open:day.open,start:day.start,end:day.end})),services:services.rows,professionals:professionals.rows});
    }catch(error){res.status(error.status||500).json({error:error.status?error.message:"No se pudo cargar el salón."});}
  });
  app.get("/api/public/salons/:id/slots",limit,async(req,res)=>{
    try{
      const data=await availability(pool,req.params.id,req.query.serviceId,req.query.professionalId,req.query.date);
      res.set("Cache-Control","no-store").json({timezone:data.shop.business_hours.timezone,slots:data.slots.map(date=>date.toISOString())});
    }catch(error){res.status(error.status||500).json({error:error.status?error.message:"No se pudieron cargar los horarios."});}
  });
  app.post("/api/public/salons/:id/bookings",limit,async(req,res)=>{
    res.set("Cache-Control","no-store");
    if(!managementSecret)return res.status(503).json({error:"Las reservas están temporalmente no disponibles."});
    const {name,phone,email="",serviceId,professionalId=null,startsAt,date,requestId,website=""}=req.body||{};
    if(!uuid(req.params.id)||!uuid(requestId)||typeof name!=="string"||!name.trim()||name.length>120||typeof phone!=="string"||phone.replace(/\D/g,"").length<7||!/^\+?[\d ()-]{7,30}$/.test(phone)||typeof email!=="string"||email.length>254||(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))||website) return res.status(400).json({error:"Revisa tu nombre y teléfono; el correo es opcional."});
    const start=new Date(startsAt);
    if((professionalId!==null&&!uuid(professionalId))||Number.isNaN(start.getTime()))return res.status(400).json({error:"Selecciona un horario disponible."});
    const fingerprint=crypto.createHash("sha256").update(JSON.stringify([name.trim(),phone.trim(),email.trim(),serviceId,professionalId,start.toISOString(),date])).digest("hex");
    let db,committed=false;
    try{
      db=await pool.connect();await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))",[req.params.id]);
      const previous=(await db.query("SELECT payload_hash,appointment_id FROM public_booking_requests WHERE salon_id=$1 AND request_id=$2",[req.params.id,requestId])).rows[0];
      if(previous) {
        if(previous.payload_hash!==fingerprint)throw fail(409,"Esta solicitud ya se usó. Actualiza los horarios.");
        const receipt=await bookingReceipt(db,managementSecret,req.params.id,previous.appointment_id);
        await db.query("COMMIT");committed=true;return res.json(receipt);
      }
      const data=await availability(db,req.params.id,serviceId,professionalId,date);
      if(!data.slots.some(slot=>slot.getTime()===start.getTime()))throw fail(409,"Ese horario ya no está disponible. Elige otro.");
      // Persistent limits also apply across restarts and instances.
      const contactHash=crypto.createHash("sha256").update(phone.replace(/\D/g,"")).digest("hex");
      const count=(await db.query("SELECT COUNT(*)::int AS total,COUNT(*) FILTER (WHERE contact_hash=$2)::int AS contact FROM public_booking_requests WHERE salon_id=$1 AND created_at>NOW()-INTERVAL '1 hour'",[req.params.id,contactHash])).rows[0];
      if(count.total>=30||count.contact>=3)throw fail(429,"Se alcanzó el límite de reservas en línea. Contacta con el salón o inténtalo más tarde.");
      const clientId=crypto.randomUUID(),appointmentId=crypto.randomUUID();
      await db.query("INSERT INTO clients(id,salon_id,name,phone,email) VALUES($1,$2,$3,$4,$5)",[clientId,req.params.id,name.trim(),phone.trim(),email.trim()]);
      await db.query("INSERT INTO appointments(id,salon_id,client_id,service_id,professional_id,starts_at,ends_at,status,notes,price_label_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,'confirmed','Reserva en línea',$8)",[appointmentId,req.params.id,clientId,serviceId,professionalId||null,start,new Date(start.getTime()+data.service.duration_minutes*60000),data.service.price_label||""]);
      await db.query("INSERT INTO reminders(id,appointment_id,status,scheduled_at) VALUES($1,$2,CASE WHEN $3::timestamptz-INTERVAL '24 hours'<=NOW() THEN 'skipped' ELSE 'awaiting_connection' END,$3::timestamptz-INTERVAL '24 hours')",[crypto.randomUUID(),appointmentId,start]);
      await db.query("INSERT INTO public_booking_requests(salon_id,request_id,payload_hash,contact_hash,appointment_id) VALUES($1,$2,$3,$4,$5)",[req.params.id,requestId,fingerprint,contactHash,appointmentId]);
      const receipt=await bookingReceipt(db,managementSecret,req.params.id,appointmentId);
      await db.query("COMMIT");committed=true;res.status(201).json(receipt);
    }catch(error){console.error("Public booking:",error.status||500);res.status(error.status||500).json({error:error.status?error.message:"No se pudo confirmar la reserva. Puedes reintentar sin duplicarla."});}
    finally{if(db){if(!committed)await db.query("ROLLBACK").catch(()=>{});db.release();}}
  });
  return availability; // Reuse the same validated lookup in authenticated Luna.
}
