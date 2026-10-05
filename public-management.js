import crypto from "crypto";

const uuid=value=>typeof value==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const fail=(status,message)=>Object.assign(new Error(message),{status});
const selectDetails="SELECT a.id,a.status,a.starts_at,a.ends_at,a.price_label_snapshot,s.name AS salon_name,s.business_hours->>'timezone' AS timezone,v.name AS service_name,p.name AS professional_name,r.request_id FROM appointments a JOIN salons s ON s.id=a.salon_id JOIN public_booking_requests r ON r.appointment_id=a.id AND r.salon_id=a.salon_id LEFT JOIN services v ON v.id=a.service_id AND v.salon_id=a.salon_id LEFT JOIN professionals p ON p.id=a.professional_id AND p.salon_id=a.salon_id WHERE a.salon_id=$1 AND a.id=$2";
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
export function registerPublicManagement({app,pool,limit,secret}){
  app.get("/mi-reserva/:salonId/:appointmentId",(_req,res)=>{
    res.set({"Cache-Control":"no-store","Referrer-Policy":"no-referrer","X-Robots-Tag":"noindex, nofollow"}).sendFile("manage-booking.html",{root:process.cwd()});
  });
  for(const action of ["manage","cancel"]){
    app.post("/api/public/salons/:id/bookings/:appointmentId/"+action,limit,async(req,res)=>{
      res.set("Cache-Control","no-store");
      const {token,expectedStartsAt}=req.body||{};
      if(!uuid(req.params.appointmentId)||typeof token!=="string"||!/^[A-Za-z0-9_-]{43}$/.test(token))return res.status(404).json({error:"El enlace no es válido o ha vencido."});
      let db,committed=false;
      try{
        db=await pool.connect();await db.query("BEGIN");
        if(action==="cancel")await db.query("SELECT pg_advisory_xact_lock(hashtext($1))",[req.params.id]);
        const row=(await db.query(selectDetails+" AND r.created_at>NOW()-INTERVAL '180 days'"+(action==="cancel"?" FOR UPDATE OF a":""),[req.params.id,req.params.appointmentId])).rows[0];
        const expected=row?key(secret,req.params.id,row.id,row.request_id):"";
        if(!row||!crypto.timingSafeEqual(Buffer.from(token),Buffer.from(expected)))throw fail(404,"El enlace no es válido o ha vencido.");
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
