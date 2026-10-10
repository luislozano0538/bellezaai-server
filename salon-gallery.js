import crypto from "node:crypto";

const uuid = value => typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const MAX_PHOTOS = 18;
const maxImageDataLength = 220000;

function decodePhoto(value) {
  if (typeof value !== "string" || value.length > maxImageDataLength) return null;
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return null;
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length < 12 || bytes.length > 165000) return null;
  const valid = match[1] === "jpeg" ?
    bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 :
    match[1] === "png" ?
      bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) :
      bytes.toString("ascii",0,4) === "RIFF" && bytes.toString("ascii",8,12) === "WEBP";
  return valid ? {mime: "image/" + match[1], bytes} : null;
}

export async function initSalonGallery(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS salon_gallery_photos (
      id UUID PRIMARY KEY,
      salon_id UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
      caption TEXT NOT NULL DEFAULT '',
      image_data TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_salon_gallery_photos
      ON salon_gallery_photos (salon_id,created_at DESC,id DESC);
  `);
}

export function registerSalonGallery({app,pool,auth}) {
  app.get("/api/salon/gallery", auth, async (req,res) => {
    res.set("Cache-Control","no-store");
    try {
      const result = await pool.query(
        'SELECT id,caption,image_data AS "imageData",created_at AS "createdAt" FROM salon_gallery_photos WHERE salon_id=$1 ORDER BY created_at DESC,id DESC LIMIT 18',
        [req.user.salonId]
      );
      res.json({photos:result.rows,maxPhotos:MAX_PHOTOS});
    } catch {
      res.status(500).json({error:"No se pudo cargar la galería."});
    }
  });

  app.post("/api/salon/gallery", auth, async (req,res) => {
    res.set("Cache-Control","no-store");
    if (req.user.role !== "owner") return res.status(403).json({error:"Solo el propietario puede subir fotos."});
    const {caption="",imageData} = req.body || {};
    if (typeof caption !== "string" || caption.length > 120 || !decodePhoto(imageData))
      return res.status(400).json({error:"Elige una foto JPG, PNG o WebP válida y una descripción breve."});
    let db,committed=false;
    try {
      db=await pool.connect();
      await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))",[req.user.salonId]);
      const count = await db.query("SELECT COUNT(*)::int AS total FROM salon_gallery_photos WHERE salon_id=$1",[req.user.salonId]);
      if (count.rows[0].total >= MAX_PHOTOS) {
        await db.query("ROLLBACK");
        return res.status(409).json({error:"Tu galería ya tiene 18 fotos. Quita alguna antes de subir otra."});
      }
      const id=crypto.randomUUID();
      const result=await db.query(
        'INSERT INTO salon_gallery_photos(id,salon_id,caption,image_data) VALUES($1,$2,$3,$4) RETURNING id,caption,image_data AS "imageData",created_at AS "createdAt"',
        [id,req.user.salonId,caption.trim(),imageData]
      );
      await db.query("COMMIT");committed=true;
      res.status(201).json({photo:result.rows[0]});
    } catch {
      res.status(500).json({error:"No se pudo guardar la foto."});
    } finally {
      if (db) {
        if (!committed) await db.query("ROLLBACK").catch(()=>{});
        db.release();
      }
    }
  });

  app.delete("/api/salon/gallery/:id", auth, async (req,res) => {
    if (req.user.role !== "owner") return res.status(403).json({error:"Solo el propietario puede quitar fotos."});
    if (!uuid(req.params.id)) return res.status(400).json({error:"Foto inválida."});
    try {
      const result=await pool.query(
        "DELETE FROM salon_gallery_photos WHERE id=$1 AND salon_id=$2 RETURNING id",
        [req.params.id,req.user.salonId]
      );
      if (!result.rows[0]) return res.status(404).json({error:"Foto no encontrada."});
      res.json({deleted:true,id:req.params.id});
    } catch {
      res.status(500).json({error:"No se pudo quitar la foto."});
    }
  });

  app.get("/api/public/salons/:salonId/gallery", async (req,res) => {
    res.set("Cache-Control","no-store");
    if (!uuid(req.params.salonId)) return res.status(404).json({error:"Galería no disponible."});
    try {
      const shop = await pool.query("SELECT id FROM salons WHERE id=$1 AND public_booking_enabled=true",[req.params.salonId]);
      if (!shop.rows[0]) return res.status(404).json({error:"Galería no disponible."});
      const result=await pool.query(
        "SELECT id,caption FROM salon_gallery_photos WHERE salon_id=$1 ORDER BY created_at DESC,id DESC LIMIT 18",
        [req.params.salonId]
      );
      res.json({photos:result.rows.map(row=>({
        id:row.id,caption:row.caption,
        imageUrl:"/api/public/salons/"+req.params.salonId+"/gallery/"+row.id+"/image"
      }))});
    } catch {
      res.status(500).json({error:"No se pudo cargar la galería."});
    }
  });

  app.get("/api/public/salons/:salonId/gallery/:id/image", async (req,res) => {
    if (!uuid(req.params.salonId) || !uuid(req.params.id)) return res.sendStatus(404);
    try {
      const result=await pool.query(
        "SELECT p.image_data FROM salon_gallery_photos p JOIN salons s ON s.id=p.salon_id WHERE p.id=$1 AND p.salon_id=$2 AND s.public_booking_enabled=true",
        [req.params.id,req.params.salonId]
      );
      const image=decodePhoto(result.rows[0]?.image_data);
      if (!image) return res.sendStatus(404);
      res.set("Content-Type",image.mime);
      res.set("X-Content-Type-Options","nosniff");
      res.set("Cache-Control","public, max-age=300");
      res.end(image.bytes);
    } catch {
      res.sendStatus(500);
    }
  });
}
