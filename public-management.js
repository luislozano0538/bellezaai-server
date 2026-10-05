import crypto from "crypto";

const uuid=value=>typeof value==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const fail=(status,message)=>Object.assign(new Error(message),{status});
const selectDetails="SELECT a.id,a.service_id,a.professional_id,a.status,a.starts_at,a.ends_at,a.price_label_snapshot,s.name AS salon_name,s.business_hours->>'timezone' AS timezone,v.name AS service_name,p.name AS professional_name,r.request_id FROM appointments a JOIN salons s ON s.id=a.salon_id JOIN public_booking_requests r ON r.appointment_id=a.id AND r.salon_id=a.salon_id LEFT JOIN services v ON v.id=a.service_id AND v.salon_id=a.salon_id LEFT JOIN professionals p ON p.id=a.professional_id AND p.salon_id=a.salon_id WHERE a.salon_id=$1 AND a.id=$2";
function key(secret,salonId,appointmentId,requestId){
  if(!secret)throw fail(503,"La gestión de reservas no está disponible.");
  return crypto.createHmac("sha256",secret).update(JSON.stringify(["booking-management-v1",salonId,appointmentId,requestId])).digest("base64url");
}
function details(row){
  return {reference:row.id,status:row.status,startsAt:new Date(row.starts_at).toISOString(),endsAt:new Date(row.ends_at).toISOString(),
    salonName:row.salon_name,serviceName:row.service_name||"Servicio",professionalName:row.professional_name||"Sin preferencia de profesional",
    price:row.price_label_snapshot||"",timezone:row.timezone||"UTC",canCancel:row.status==="confirmed"&&new Date(row.starts_at)>new Date()};
}
export async function bookingReceipt(db,secret,salonId,appointmentId){
  const row=(await db.query(selectDetails,[salonId,appointmentId])).rows[0];
  if(!row)throw fail(404,"Reserva no disponible.");
  return {...details(row),managePath:"/mi-reserva/"+salonId+"/"+appointmentId+"#"+key(secret,salonId,appointmentId,row.request_id)};
}
export function registerPublicManagement({app,pool,limit,secret,availability}){
  app.get("/mi-reserva/:salonId/:appointmentId",(_req,res)=>{
    res.set({"Cache-Control":"no-store","Referrer-Policy":"no-referrer","X-Robots-Tag":"noindex, nofollow"}).sendFile("manage-booking.html",{root:process.cwd()});
  });
  for(const action of ["manage","cancel","slots","reschedule"]){
    app.post("/api/public/salons/:id/bookings/:appointmentId/"+action,limit,async(req,res)=>{
      res.set("Cache-Control","no-store");
      const {token,expectedStartsAt,date,startsAt}=req.body||{};
      if(!uuid(req.params.appointmentId)||typeof token!=="string"||!/^[A-Za-z0-9_-]{43}$/.test(token))return res.status(404).json({error:"El enlace no es válido o ha vencido."});
      let db,committed=false;
      try{
        db=await pool.connect();await db.query("BEGIN");
        if((action==="cancel"||action==="reschedule"))await db.query("SELECT pg_advisory_xact_lock(hashtext($1))",[req.params.id]);
        const row=(await db.query(selectDetails+" AND r.created_at>NOW()-INTERVAL '180 days'"+((action==="cancel"||action==="reschedule")?" FOR UPDATE OF a":""),[req.params.id,req.params.appointmentId])).rows[0];
        const expected=row?key(secret,req.params.id,row.id,row.request_id):"";
        if(!row||!crypto.timingSafeEqual(Buffer.from(token),Buffer.from(expected)))throw fail(404,"El enlace no es válido o ha vencido.");
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
