const empty=()=>({description:"",address:"",phone:"",photos:[]});
function validPhoto(value){
  if(typeof value!=="string"||value.length>220000)return false;
  const match=/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if(!match)return false;
  const bytes=Buffer.from(match[2],"base64");
  return match[1]==="jpeg"?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:
    match[1]==="png"?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):
    bytes.toString("ascii",0,4)==="RIFF"&&bytes.toString("ascii",8,12)==="WEBP";
}
export function registerSalonProfile({app,pool,auth,validBusinessHours}){

  app.get("/api/salon/setup",auth,async(req,res)=>{
    res.set("Cache-Control","no-store");
    try{
      const row=(await pool.query("SELECT s.name,s.business_hours,s.public_booking_enabled,s.public_profile->>'description' AS description,s.public_profile->>'address' AS address,s.public_profile->>'phone' AS phone,jsonb_array_length(COALESCE(s.public_profile->'photos','[]'::jsonb)) AS photos,(SELECT COUNT(*)::int FROM services v WHERE v.salon_id=s.id AND v.active=true) AS services,(SELECT COUNT(*)::int FROM services v WHERE v.salon_id=s.id AND v.active=true AND (v.duration_minutes IS NULL OR v.duration_minutes<1 OR v.duration_minutes>1440)) AS invalid_services,(SELECT COUNT(*)::int FROM professionals p WHERE p.salon_id=s.id AND p.active=true) AS professionals FROM salons s WHERE s.id=$1",[req.user.salonId])).rows[0];
      if(!row)return res.status(404).json({error:"Salón no encontrado."});
      const hours=validBusinessHours(row.business_hours)&&row.business_hours.days.some(day=>day.open);
      const items=[
        {id:"name",label:"Nombre del salón",complete:!!row.name?.trim(),required:true,detail:row.name||"Añade el nombre de tu negocio."},
        {id:"hours",label:"Horario y zona horaria",complete:hours,required:true,detail:hours?row.business_hours.timezone:"Configura al menos un día de atención."},
        {id:"services",label:"Servicios para reservar",complete:row.services>0&&row.invalid_services===0,required:true,detail:row.services+" servicio(s) activo(s)."+(row.invalid_services?" Revisa la duración de "+row.invalid_services+" servicio(s).":"")},
        {id:"published",label:"Reservas en línea",complete:row.public_booking_enabled,required:true,detail:row.public_booking_enabled?"Página habilitada.":"Activa tu página cuando estés listo."},
        {id:"team",label:"Equipo",complete:row.professionals>0,required:false,detail:row.professionals?row.professionals+" profesional(es) activo(s).":"Opcional: puedes usar la agenda del salón sin equipo."},
        {id:"description",label:"Descripción del salón",complete:!!row.description,required:false,detail:"Presenta tu negocio a los clientes."},
        {id:"address",label:"Dirección pública",complete:!!row.address,required:false,detail:"Ayuda a los clientes a encontrarte."},
        {id:"phone",label:"Teléfono público",complete:!!row.phone,required:false,detail:"Permite que te llamen desde la página."},
        {id:"photos",label:"Fotos del salón",complete:row.photos>0,required:false,detail:row.photos+" de 3 fotos guardadas."}
      ];
      res.json({items,ready:items.filter(item=>item.required).every(item=>item.complete),path:"/reservar/"+req.user.salonId,owner:req.user.role==="owner"});
    }catch{res.status(500).json({error:"No se pudo cargar el progreso de configuración."});}
  });
  app.get("/api/salon/profile",auth,async(req,res)=>{
    res.set("Cache-Control","no-store");
    try{
      const row=(await pool.query("SELECT public_profile,public_booking_enabled FROM salons WHERE id=$1",[req.user.salonId])).rows[0];
      if(!row)return res.status(404).json({error:"Salón no encontrado."});
      res.json({profile:row.public_profile||empty(),published:row.public_booking_enabled,path:"/reservar/"+req.user.salonId});
    }catch{res.status(500).json({error:"No se pudo cargar la presentación del salón."});}
  });
  app.put("/api/salon/profile",auth,async(req,res)=>{
    if(req.user.role!=="owner")return res.status(403).json({error:"Solo el propietario puede editar la página pública."});
    const {description="",address="",phone="",photos=[]}=req.body||{};
    if(typeof description!=="string"||description.length>1200||typeof address!=="string"||address.length>300||typeof phone!=="string"||phone.length>30||(phone.trim()&&(phone.replace(/\D/g,"").length<7||!/^\+?[\d ()-]{7,30}$/.test(phone.trim())))||!Array.isArray(photos)||photos.length>3||!photos.every(validPhoto))return res.status(400).json({error:"Revisa los textos, teléfono y fotos (máximo 3)."});
    const profile={description:description.trim(),address:address.trim(),phone:phone.trim(),photos};
    try{
      const result=await pool.query("UPDATE salons SET public_profile=$2::jsonb WHERE id=$1 RETURNING id",[req.user.salonId,JSON.stringify(profile)]);
      if(!result.rows[0])return res.status(404).json({error:"Salón no encontrado."});
      res.json({saved:true});
    }catch{res.status(500).json({error:"No se pudo guardar la presentación."});}
  });
}
