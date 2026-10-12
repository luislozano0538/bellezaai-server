import crypto from "crypto";

const uuid=value=>typeof value==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const fail=(status,message)=>Object.assign(new Error(message),{status});
const selectDetails="SELECT (SELECT json_build_object('rating',rating,'comment',comment) FROM salon_reviews WHERE appointment_id=a.id AND salon_id=a.salon_id) AS review,a.id,a.service_id,a.professional_id,a.status,a.starts_at,a.ends_at,a.price_label_snapshot,s.name AS salon_name,s.business_hours->>'timezone' AS timezone,v.name AS service_name,p.name AS professional_name,r.request_id FROM appointments a JOIN salons s ON s.id=a.salon_id JOIN public_booking_requests r ON r.appointment_id=a.id AND r.salon_id=a.salon_id LEFT JOIN services v ON v.id=a.service_id AND v.salon_id=a.salon_id LEFT JOIN professionals p ON p.id=a.professional_id AND p.salon_id=a.salon_id WHERE a.salon_id=$1 AND a.id=$2";
function key(secret,salonId,appointmentId,requestId){
  if(!secret)throw fail(503,"La gestión de reservas no está disponible.");
  return crypto.createHmac("sha256",secret).update(JSON.stringify(["booking-management-v1",salonId,appointmentId,requestId])).digest("base64url");
}
function details(row){
  return {reference:row.id,status:row.status,startsAt:new Date(row.starts_at).toISOString(),endsAt:new Date(row.ends_at).toISOString(),
    salonName:row.salon_name,serviceName:row.service_name||"Servicio",professionalName:row.professional_name||"Sin preferencia de profesional",
    review:row.review||null,canReview:row.status==="completed"&&new Date(row.ends_at)<=new Date()&&!row.review,timezone:row.timezone||"UTC",canCancel:row.status==="confirmed"&&new Date(row.starts_at)>new Date()};
}
export async function bookingReceipt(db,secret,salonId,appointmentId){
  const row=(await db.query(selectDetails,[salonId,appointmentId])).rows[0];
  if(!row)throw fail(404,"Reserva no disponible.");
  return {...details(row),managePath:"/mi-reserva/"+salonId+"/"+appointmentId+"#"+key(secret,salonId,appointmentId,row.request_id)};
}

export async function initSalonReviews(pool){
  await pool.query(`CREATE TABLE IF NOT EXISTS salon_reviews(
    appointment_id UUID PRIMARY KEY REFERENCES appointments(id) ON DELETE CASCADE,
    salon_id UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
    comment TEXT NOT NULL CHECK(length(trim(comment)) BETWEEN 1 AND 1000),
    service_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_salon_reviews ON salon_reviews(salon_id,created_at DESC,appointment_id DESC);`);
}

export function registerPublicManagement({app,pool,limit,secret,availability}){
  app.get("/mi-reserva/:salonId/:appointmentId",(_req,res)=>{
    res.set({"Cache-Control":"no-store","Referrer-Policy":"no-referrer","X-Robots-Tag":"noindex, nofollow"}).sendFile("manage-booking.html",{root:process.cwd()});
  });
  app.get("/api/public/salons/:id/reviews",limit,async(req,res)=>{
    res.set("Cache-Control","no-store");
    if(!uuid(req.params.id))return res.status(404).json({error:"Reseñas no disponibles."});
    const offset=Number(req.query.offset||0);
    if(!Number.isInteger(offset)||offset<0||offset>10000)return res.status(400).json({error:"Página inválida."});
    try{
      const shop=(await pool.query("SELECT id FROM salons WHERE id=$1 AND public_booking_enabled=true",[req.params.id])).rows[0];
      if(!shop)return res.status(404).json({error:"Reseñas no disponibles."});
      const stats=(await pool.query("SELECT COUNT(*)::int AS count,ROUND(AVG(rating),1)::float AS average FROM salon_reviews WHERE salon_id=$1",[shop.id])).rows[0];
      const rows=(await pool.query('SELECT rating,comment,service_name AS "serviceName",created_at AS "createdAt" FROM salon_reviews WHERE salon_id=$1 ORDER BY created_at DESC,appointment_id DESC LIMIT 12 OFFSET $2',[shop.id,offset])).rows;
      res.json({count:stats.count,average:stats.average,reviews:rows,nextOffset:offset+rows.length<stats.count?offset+rows.length:null});
    }catch{res.status(500).json({error:"No se pudieron cargar las reseñas."});}
  });
  for(const action of ["manage","cancel","slots","reschedule","review"]){
    app.post("/api/public/salons/:id/bookings/:appointmentId/"+action,limit,async(req,res)=>{
      res.set("Cache-Control","no-store");
      const {token,expectedStartsAt,date,startsAt}=req.body||{};
      if(!uuid(req.params.id)||!uuid(req.params.appointmentId)||typeof token!=="string"||!/^[A-Za-z0-9_-]{43}$/.test(token))return res.status(404).json({error:"El enlace no es válido o ha vencido."});
      let db,committed=false;
      try{
        db=await pool.connect();await db.query("BEGIN");
        if((action==="cancel"||action==="reschedule"||action==="review"))await db.query("SELECT pg_advisory_xact_lock(hashtext($1))",[req.params.id]);
        const row=(await db.query(selectDetails+" AND r.created_at>NOW()-INTERVAL '180 days'"+((action==="cancel"||action==="reschedule"||action==="review")?" FOR UPDATE OF a":""),[req.params.id,req.params.appointmentId])).rows[0];
        const expected=row?key(secret,req.params.id,row.id,row.request_id):"";
        if(!row||!crypto.timingSafeEqual(Buffer.from(token),Buffer.from(expected)))throw fail(404,"El enlace no es válido o ha vencido.");
        if(action==="review"){
          if(row.status!=="completed"||new Date(row.ends_at)>new Date())throw fail(409,"Solo puedes opinar después de una cita atendida.");
          if(!row.review){
            const {rating,comment,publishConsent}=req.body||{};
            if(!Number.isInteger(rating)||rating<1||rating>5||typeof comment!=="string"||!comment.trim()||comment.trim().length>1000||publishConsent!==true)throw fail(400,"Elige de 1 a 5 estrellas, escribe tu reseña y acepta publicarla.");
            await db.query("INSERT INTO salon_reviews(appointment_id,salon_id,rating,comment,service_name) VALUES($1,$2,$3,$4,$5)",[row.id,req.params.id,rating,comment.trim(),row.service_name||"Servicio"]);
            row.review={rating,comment:comment.trim()};
          }
        }
        if(action==="slots"||action==="reschedule"){
          if(row.status!=="confirmed"||new Date(row.starts_at)<=new Date())throw fail(409,"Esta cita ya no se puede cambiar en línea. Contacta con el salón.");
          if(typeof expectedStartsAt!=="string"||expectedStartsAt!==new Date(row.starts_at).toISOString())throw fail(409,"La cita cambió. Actualiza los datos antes de elegir otro horario.");
          const duration=(new Date(row.ends_at)-new Date(row.starts_at))/60000;
          const available=await availability(db,req.params.id,row.service_id,row.professional_id,date,row.id,duration);
          if(action==="slots"){
            await db.query("COMMIT");committed=true;
            return res.json({timezone:available.shop.business_hours.timezone,slots:available.slots.filter(slot=>slot.getTime()!==new Date(row.starts_at).getTime()).map(slot=>slot.toISOString())});
          }
          const next=typeof startsAt==="string"?new Date(startsAt):new Date(NaN);
          if(Number.isNaN(next.getTime())||next.getTime()===new Date(row.starts_at).getTime()||!available.slots.some(slot=>slot.getTime()===next.getTime()))throw fail(409,"Ese horario ya no está disponible. Busca otro.");
          const end=new Date(next.getTime()+duration*60000);
          await db.query("UPDATE appointments SET starts_at=$3,ends_at=$4 WHERE salon_id=$1 AND id=$2",[req.params.id,row.id,next,end]);
          await db.query("UPDATE reminders SET status='cancelled' WHERE appointment_id=$1 AND sent_at IS NULL AND status<>'sent'",[row.id]);
          await db.query("INSERT INTO reminders(id,appointment_id,status,scheduled_at) VALUES($1,$2,CASE WHEN $3::timestamptz-INTERVAL '24 hours'<=NOW() THEN 'skipped' ELSE 'awaiting_connection' END,$3::timestamptz-INTERVAL '24 hours')",[crypto.randomUUID(),row.id,next]);
          row.starts_at=next;row.ends_at=end;
        }
        if(action==="cancel"&&row.status!=="cancelled"){
          if(row.status!=="confirmed"||new Date(row.starts_at)<=new Date())throw fail(409,"Esta cita ya no se puede cancelar en línea. Contacta con el salón.");
          if(typeof expectedStartsAt!=="string"||expectedStartsAt!==new Date(row.starts_at).toISOString())throw fail(409,"El horario de la cita cambió. Actualiza los datos antes de cancelar.");
          await db.query("UPDATE appointments SET status='cancelled' WHERE id=$1 AND salon_id=$2",[row.id,req.params.id]);
          await db.query("UPDATE reminders SET status='cancelled' WHERE appointment_id=$1 AND sent_at IS NULL AND status<>'sent'",[row.id]);
          row.status="cancelled";
        }
        await db.query("COMMIT");committed=true;res.json(details(row));
      }catch(error){res.status(error.status||500).json({error:error.status?error.message:"No se pudo completar la solicitud. Actualiza para consultar el estado."});}
      finally{if(db){if(!committed)await db.query("ROLLBACK").catch(()=>{});db.release();}}
    });
  }
}

