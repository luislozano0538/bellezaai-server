const uuid=value=>typeof value==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const date=value=>typeof value==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value+"T12:00:00Z"))&&new Date(value+"T12:00:00Z").toISOString().slice(0,10)===value;
const fail=(status,message)=>Object.assign(new Error(message),{status});

export async function appointmentIsClosed(db,salonId,professionalId,start,end) {
  const result=await db.query(
    "SELECT c.id FROM salon_closures c JOIN salons s ON s.id=c.salon_id WHERE c.salon_id=$1 AND c.active=true AND (c.professional_id IS NULL OR c.professional_id=$2) AND $3::timestamptz < ((c.ends_on::timestamp + COALESCE(c.ends_minute,1440)*INTERVAL '1 minute') AT TIME ZONE (s.business_hours->>'timezone')) AND $4::timestamptz > ((c.starts_on::timestamp + COALESCE(c.starts_minute,0)*INTERVAL '1 minute') AT TIME ZONE (s.business_hours->>'timezone')) LIMIT 1",
    [salonId,professionalId||null,start,end]);
  return !!result.rows[0];
}

export function registerClosures({app,pool,auth,validBusinessHours}) {
  app.get("/api/salon/closures",auth,async(req,res)=>{
    try{
      const shop=(await pool.query("SELECT business_hours FROM salons WHERE id=$1",[req.user.salonId])).rows[0];
      if(!validBusinessHours(shop?.business_hours))return res.json({timezone:null,closures:[]});
      const timezone=shop.business_hours.timezone;
      const rows=await pool.query(
        "SELECT c.id,c.professional_id,p.name AS professional_name,c.starts_on::text,c.ends_on::text,c.starts_minute,c.ends_minute,c.reason FROM salon_closures c LEFT JOIN professionals p ON p.id=c.professional_id AND p.salon_id=c.salon_id WHERE c.salon_id=$1 AND c.active=true AND c.ends_on >= (NOW() AT TIME ZONE $2)::date ORDER BY c.starts_on,c.created_at",[req.user.salonId,timezone]);
      res.json({timezone,closures:rows.rows});
    }catch{res.status(500).json({error:"No se pudieron cargar los cierres."});}
  });
  app.post("/api/salon/closures",auth,async(req,res)=>{
    if(req.user.role!=="owner")return res.status(403).json({error:"Solo el propietario puede gestionar cierres."});
    const {startsOn,endsOn,professionalId=null,reason="",requestId,startsMinute=null,endsMinute=null}=req.body||{};
    if(!date(startsOn)||!date(endsOn)||startsOn>endsOn||Date.parse(endsOn)-Date.parse(startsOn)>366*86400000||(professionalId!==null&&!uuid(professionalId))||typeof reason!=="string"||reason.length>200||!uuid(requestId))return res.status(400).json({error:"Revisa las fechas y el motivo (máximo 200 caracteres)."});
    const partial=startsMinute!==null||endsMinute!==null;
    if(partial&&(!Number.isInteger(startsMinute)||!Number.isInteger(endsMinute)||startsMinute<0||endsMinute>1440||startsMinute>=endsMinute||startsOn!==endsOn))return res.status(400).json({error:"El bloqueo por horas debe empezar y terminar el mismo día, con la hora final posterior al inicio."});
    let db;
    try{
      db=await pool.connect();await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))",[req.user.salonId]);
      const shop=(await db.query("SELECT business_hours FROM salons WHERE id=$1 FOR SHARE",[req.user.salonId])).rows[0];
      if(!validBusinessHours(shop?.business_hours))throw fail(400,"Configura primero el horario y zona horaria del salón.");
      const timezone=shop.business_hours.timezone;
      const existing=(await db.query("SELECT salon_id,professional_id,starts_on::text,ends_on::text,starts_minute,ends_minute,reason,active FROM salon_closures WHERE id=$1",[requestId])).rows[0];
      if(existing && (existing.salon_id!==req.user.salonId||existing.professional_id!==professionalId||existing.starts_on!==startsOn||existing.ends_on!==endsOn||existing.starts_minute!==startsMinute||existing.ends_minute!==endsMinute||existing.reason!==reason.trim()||!existing.active))throw fail(409,"Esta solicitud ya se usó. Vuelve a abrir el formulario.");
      if(!existing){
        const past=(await db.query("SELECT $1::date < (NOW() AT TIME ZONE $2)::date AS past",[startsOn,timezone])).rows[0].past;
        if(past)throw fail(400,"Elige hoy o una fecha futura.");
        if(professionalId && !(await db.query("SELECT id FROM professionals WHERE id=$1 AND salon_id=$2 AND active=true FOR SHARE",[professionalId,req.user.salonId])).rows[0])throw fail(400,"Profesional no disponible.");
        await db.query("INSERT INTO salon_closures(id,salon_id,professional_id,starts_on,ends_on,reason,starts_minute,ends_minute) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[requestId,req.user.salonId,professionalId,startsOn,endsOn,reason.trim(),startsMinute,endsMinute]);
      }
      const impacted=(await db.query(
        "SELECT COUNT(*)::int AS total FROM appointments WHERE salon_id=$1 AND status='confirmed' AND ends_at>NOW() AND ($2::uuid IS NULL OR professional_id=$2) AND starts_at < (($4::date::timestamp+COALESCE($7::int,1440)*INTERVAL '1 minute') AT TIME ZONE $5) AND ends_at > (($3::date::timestamp+COALESCE($6::int,0)*INTERVAL '1 minute') AT TIME ZONE $5)",[req.user.salonId,professionalId,startsOn,endsOn,timezone,startsMinute,endsMinute])).rows[0].total;
      await db.query("COMMIT");res.status(existing?200:201).json({id:requestId,affectedAppointments:impacted});
    }catch(error){if(db)await db.query("ROLLBACK").catch(()=>{});res.status(error.status||500).json({error:error.status?error.message:"No se pudo guardar el cierre."});}
    finally{if(db)db.release();}
  });
  app.patch("/api/salon/closures/:id",auth,async(req,res)=>{
    if(req.user.role!=="owner")return res.status(403).json({error:"Solo el propietario puede gestionar cierres."});
    if(!uuid(req.params.id)||req.body?.active!==false)return res.status(400).json({error:"Cierre inválido."});
    let db;
    try{
      db=await pool.connect();await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))",[req.user.salonId]);
      const result=await db.query("UPDATE salon_closures SET active=false WHERE id=$1 AND salon_id=$2 RETURNING id",[req.params.id,req.user.salonId]);
      if(!result.rows[0])throw fail(404,"Cierre no encontrado.");
      await db.query("COMMIT");res.json({id:req.params.id,active:false});
    }catch(error){if(db)await db.query("ROLLBACK").catch(()=>{});res.status(error.status||500).json({error:error.status?error.message:"No se pudo quitar el bloqueo."});}
    finally{if(db)db.release();}
  });
}
