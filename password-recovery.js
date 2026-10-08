import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

const message='Si existe una cuenta con ese correo, recibirás un enlace. Revisa también correo no deseado; puedes pedir otro en 15 minutos.';
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');

export function recoveryMailer(env=process.env) {
  let origin;
  try {
    const url=new URL(env.PUBLIC_APP_URL);
    if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)return null;
    origin=url.origin;
  } catch { return null; }
  if(!env.RESEND_API_KEY||!env.RECOVERY_EMAIL_FROM)return null;
  return {origin,async send({email,link,id}) {
    const response=await fetch('https://api.resend.com/emails',{
      method:'POST',signal:AbortSignal.timeout(10000),
      headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'password-reset/'+id},
      body:JSON.stringify({from:env.RECOVERY_EMAIL_FROM,to:[email],subject:'Recupera tu acceso a BellezaAI',
        text:'Solicitaste cambiar tu contraseña de BellezaAI. Abre este enlace en los próximos 30 minutos:\n\n'+link+'\n\nSolo puede usarse una vez. Si no lo solicitaste, ignora este correo. Tu contraseña sigue igual.'})
    });
    if(!response.ok)throw Error('Email delivery failed');
  }};
}

export async function initPasswordRecovery(pool) {
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0;
    CREATE TABLE IF NOT EXISTS password_resets (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT UNIQUE NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

export function registerPasswordRecovery({app,pool,gate,mailer=recoveryMailer()}) {
  app.get('/recuperar',(_req,res)=>{
    res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex'});
    res.sendFile('recover.html',{root:process.cwd()});
  });
  app.get('/api/auth/recovery',(_req,res)=>res.set('Cache-Control','no-store').json({enabled:!!mailer}));
  app.post('/api/auth/forgot-password',async(req,res)=>{
    res.set('Cache-Control','no-store');
    if(!mailer)return res.status(503).json({error:'La recuperación por correo todavía no está disponible.'});
    const email=typeof req.body?.email==='string'?req.body.email.trim().toLowerCase():'';
    if(email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.status(400).json({error:'Escribe un correo válido.'});
    const release=gate.enter('recovery',email,res);if(!release)return;
    // Reply independently of account existence and email provider latency.
    res.status(202).json({message});
    try {
      const token=crypto.randomBytes(32).toString('base64url');
      const rows=await pool.query(`
        INSERT INTO password_resets(user_id,token_hash,expires_at)
        SELECT id,$2,NOW()+INTERVAL '30 minutes' FROM users WHERE email=$1
        ON CONFLICT(user_id) DO UPDATE SET token_hash=EXCLUDED.token_hash,
          expires_at=EXCLUDED.expires_at,requested_at=NOW()
        WHERE password_resets.requested_at<=NOW()-INTERVAL '15 minutes'
        RETURNING user_id
      `,[email,digest(token)]);
      if(rows.rowCount)await mailer.send({email,link:mailer.origin+'/recuperar#'+token,id:digest(token)});
    } catch { console.error('Password recovery delivery unavailable'); }
    finally {release();}
  });
  app.post('/api/auth/reset-password',async(req,res)=>{
    res.set('Cache-Control','no-store');
    const {token,password}=req.body||{};
    if(typeof token!=='string'||! /^[A-Za-z0-9_-]{43}$/.test(token))return res.status(400).json({error:'El enlace no es válido o ya caducó.'});
    if(typeof password!=='string'||password.length<12||Buffer.byteLength(password,'utf8')>72)return res.status(400).json({error:'Usa al menos 12 caracteres y un máximo de 72 bytes.'});
    const release=gate.enter('reset',token,res);if(!release)return;
    let db;
    try {
      // Hash outside the transaction; consuming the token and replacing the password are atomic.
      const hash=await bcrypt.hash(password,10);
      db=await pool.connect();await db.query('BEGIN');
      const found=await db.query('DELETE FROM password_resets WHERE token_hash=$1 AND expires_at>NOW() RETURNING user_id',[digest(token)]);
      if(!found.rowCount){await db.query('ROLLBACK');return res.status(400).json({error:'El enlace no es válido o ya caducó. Solicita uno nuevo.'});}
      await db.query('UPDATE users SET password_hash=$2,session_version=session_version+1 WHERE id=$1',[found.rows[0].user_id,hash]);
      // Preserve cooldown without retaining a usable recovery token.
      await db.query("INSERT INTO password_resets(user_id,token_hash,expires_at) VALUES($1,$2,NOW())",[found.rows[0].user_id,digest(crypto.randomBytes(32))]);
      await db.query('COMMIT');
      res.json({message:'Contraseña actualizada. Inicia sesión con tu nueva contraseña.'});
    } catch {
      if(db)await db.query('ROLLBACK').catch(()=>{});
      res.status(503).json({error:'No pudimos confirmar el cambio. Intenta iniciar sesión con tu nueva contraseña antes de repetirlo.'});
    } finally {if(db)db.release();release();}
  });
}
