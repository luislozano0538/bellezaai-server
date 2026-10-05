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
export function registerSalonProfile({app,pool,auth}){
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
