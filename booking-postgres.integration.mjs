import {spawn} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import pg from 'pg';
import express from 'express';
import {createAuthGate} from './auth-limits.js';
import {registerPasswordRecovery} from './password-recovery.js';
import {fileURLToPath} from 'node:url';

process.chdir(path.dirname(fileURLToPath(import.meta.url)));
// This script must never receive the production DATABASE_URL.
const connectionString=process.env.TEST_DATABASE_URL;
if(!connectionString)throw Error('TEST_DATABASE_URL is required');
const target=new URL(connectionString);
if(!['127.0.0.1','localhost'].includes(target.hostname)||target.pathname!='/belleza_test')
 throw Error('Only a local, disposable belleza_test database is allowed');
const password=crypto.randomBytes(24).toString('hex');
async function freePort(){const s=net.createServer();await new Promise((ok,fail)=>s.listen(0,'127.0.0.1',ok).on('error',fail));const port=s.address().port;await new Promise(ok=>s.close(ok));return port;}
let server,client,recoveryServer,recoveryPool;
const results=[];
try{
 const appPort=await freePort();
 client=new pg.Client({connectionString});await client.connect();
 const existing=await client.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'");
 assert.equal(existing.rows[0].n,0,'The disposable database must be empty');
 server=spawn(process.execPath,['server.js'],{env:{PATH:process.env.PATH,DATABASE_URL:connectionString,JWT_SECRET:crypto.randomBytes(32).toString('hex'),PORT:String(appPort)},stdio:['ignore','pipe','pipe']});
 let serverLog='';server.stdout.on('data',b=>serverLog+=b);server.stderr.on('data',b=>serverLog+=b);
 const base=`http://127.0.0.1:${appPort}`;
 let ready=false;
 for(let i=0;i<100;i++){if(server.exitCode!==null)throw Error('La aplicación no arrancó: '+serverLog);try{const r=await fetch(base);if(r.ok){ready=true;break;}}catch{}await new Promise(ok=>setTimeout(ok,200));}
 assert.ok(ready,'La aplicación no respondió a tiempo');
 async function api(url,method='GET',body,token){const r=await fetch(base+url,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};}
 const account={name:'Prueba aislada',salonName:'Salón de prueba',email:'local@example.invalid',password:'Local-test-'+password};
 const registration=await api('/api/auth/register','POST',account);assert.equal(registration.status,201);const salonId=registration.data.salonId;
 const login=await api('/api/auth/login','POST',{email:account.email,password:account.password});assert.equal(login.status,200);const token=login.data.token;results.push('Registro e inicio de sesión con PostgreSQL y contraseñas reales');
 const setup=await api('/api/salon/setup','GET',null,token);assert.equal(setup.data.path,'/reservar/'+salonId);assert.equal(setup.data.ready,false);
 const hours={timezone:'America/New_York',days:Array.from({length:7},()=>({open:true,start:'09:00',end:'18:00'}))};
 assert.equal((await api('/api/salon/hours','PATCH',hours,token)).status,200);
 const service=await api('/api/services','POST',{name:'Balayage de prueba',duration_minutes:240,price_label:'600'},token);assert.equal(service.status,201);
 const services=await api('/api/services','GET',null,token);const serviceId=services.data[0].id;
 assert.equal((await api('/api/salon/public-booking','PATCH',{enabled:true},token)).status,200);
 const date=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
 const prefix='/api/public/salons/'+salonId;
 const slots=await api(prefix+'/slots?serviceId='+serviceId+'&date='+date);assert.equal(slots.status,200);assert.ok(slots.data.slots.length>=2);
 const body={name:'Cliente aislado',phone:'2025550100',serviceId,date,startsAt:slots.data.slots[0],requestId:crypto.randomUUID()};
 const [first,retry]=await Promise.all([api(prefix+'/bookings','POST',body),api(prefix+'/bookings','POST',body)]);
 assert.deepEqual([first.status,retry.status].sort(),[200,201]);assert.equal(first.data.reference,retry.data.reference);results.push('Reintentos simultáneos crean una sola cita');
 assert.equal((await api(prefix+'/bookings','POST',{...body,requestId:crypto.randomUUID()})).status,409);results.push('El horario ocupado rechaza una segunda reserva');
 const receipt=first.data,privateToken=receipt.managePath.split('#')[1],manage=prefix+'/bookings/'+receipt.reference;
 const agenda=await api('/api/appointments','GET',null,token);assert.ok(agenda.data.some(a=>a.id===receipt.reference));results.push('La reserva pública aparece en la agenda del salón');
 const other=await api('/api/auth/register','POST',{...account,email:'other@example.invalid'});
 assert.equal(other.status,201);
 const otherAgenda=await api('/api/appointments','GET',null,other.data.token);assert.ok(!otherAgenda.data.some(a=>a.id===receipt.reference));results.push('Otra cuenta no recibe la reserva en su agenda');
 assert.equal((await api(manage+'/cancel','POST',{token:'x'.repeat(43),expectedStartsAt:receipt.startsAt})).status,404);
 const nextDate=new Date(Date.now()+8*86400000).toISOString().slice(0,10);
 const moveSlots=await api(manage+'/slots','POST',{token:privateToken,expectedStartsAt:receipt.startsAt,date:nextDate});assert.equal(moveSlots.status,200);assert.ok(moveSlots.data.slots.length);
 const moved=await api(manage+'/reschedule','POST',{token:privateToken,expectedStartsAt:receipt.startsAt,date:nextDate,startsAt:moveSlots.data.slots[0]});assert.equal(moved.status,200);assert.equal(moved.data.price,'600');assert.equal(new Date(moved.data.endsAt)-new Date(moved.data.startsAt),240*60000);results.push('Reprogramación conserva precio y duración');
 assert.equal((await api(manage+'/cancel','POST',{token:privateToken,expectedStartsAt:receipt.startsAt})).status,409);
 for(let i=0;i<2;i++)assert.equal((await api(manage+'/cancel','POST',{token:privateToken,expectedStartsAt:moved.data.startsAt})).data.status,'cancelled');
 assert.equal((await client.query('SELECT count(*)::int AS n FROM appointments')).rows[0].n,1);
 assert.equal((await client.query("SELECT count(*)::int AS n FROM reminders WHERE status NOT IN ('cancelled','sent')")).rows[0].n,0);results.push('Cancelación repetida conserva una sola cita y cancela recordatorios');

 // Exercise recovery with real database/HTTP and an in-memory mail transport.
 // There is no production environment flag or endpoint that exposes tokens.
 assert.equal((await api('/api/auth/recovery')).data.enabled,false);
 assert.equal((await api('/api/auth/forgot-password','POST',{email:account.email})).status,503);
 recoveryPool=new pg.Pool({connectionString});
 const recoveryApp=express();recoveryApp.use(express.json());const mail=[];
 registerPasswordRecovery({app:recoveryApp,pool:recoveryPool,gate:createAuthGate(),
   mailer:{origin:'https://example.invalid',send:async value=>{mail.push(value);}}});
 recoveryServer=await new Promise(resolve=>{const listener=recoveryApp.listen(0,'127.0.0.1',()=>resolve(listener));});
 const recoveryBase='http://127.0.0.1:'+recoveryServer.address().port;
 async function recovery(action,body) {
   const r=await fetch(recoveryBase+'/api/auth/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   return {status:r.status,data:await r.json()};
 }
 async function waitMail(count){for(let i=0;i<100&&mail.length<count;i++)await new Promise(r=>setTimeout(r,20));assert.equal(mail.length,count);}
 const requested=await recovery('forgot-password',{email:account.email});assert.equal(requested.status,202);
 assert.deepEqual((await recovery('forgot-password',{email:'absent@example.invalid'})),requested);
 await waitMail(1);
 const recoveryToken=mail[0].link.split('#')[1];
 assert.equal((await client.query('SELECT token_hash FROM password_resets')).rows[0].token_hash,crypto.createHash('sha256').update(recoveryToken).digest('hex'));
 await recovery('forgot-password',{email:account.email});
 await new Promise(r=>setTimeout(r,100));assert.equal(mail.length,1);
 const newPassword='New-local-password-'+password;
 assert.equal((await recovery('reset-password',{token:recoveryToken,password:'short'})).status,400);
 await client.query("UPDATE password_resets SET expires_at=NOW()-INTERVAL '1 minute'");
 assert.equal((await recovery('reset-password',{token:recoveryToken,password:newPassword})).status,400);
 await client.query("UPDATE password_resets SET requested_at=NOW()-INTERVAL '16 minutes'");
 await recovery('forgot-password',{email:account.email});await waitMail(2);
 const freshToken=mail[1].link.split('#')[1];
 assert.notEqual(freshToken,recoveryToken);
 const changed=await Promise.all([recovery('reset-password',{token:freshToken,password:newPassword}),recovery('reset-password',{token:freshToken,password:newPassword})]);
 assert.deepEqual(changed.map(r=>r.status).sort(),[200,400]);
 assert.equal((await recovery('reset-password',{token:freshToken,password:newPassword})).status,400);
 assert.equal((await api('/api/appointments','GET',null,token)).status,401);
 assert.equal((await api('/api/auth/login','POST',{email:account.email,password:account.password})).status,401);
 const renewed=await api('/api/auth/login','POST',{email:account.email,password:newPassword});assert.equal(renewed.status,200);
 assert.equal((await api('/api/appointments','GET',null,renewed.data.token)).status,200);
 results.push('Recuperación: caducidad, uso único concurrente, correo simulado, contraseña nueva y sesiones revocadas');
 writeFileSync('integration-result.json',JSON.stringify({passed:true,at:new Date().toISOString(),checks:results,scope:'HTTP API + isolated PostgreSQL; no browser UI'},null,2));
 console.log('PRUEBA COMPLETA DE API APROBADA: '+results.length+' comprobaciones. No se usó Render.');
}catch(error){writeFileSync('integration-result.json',JSON.stringify({passed:false,at:new Date().toISOString(),completed:results,error:error.message},null,2));console.error('Prueba detenida: '+error.message);process.exitCode=1;}
finally{
 if(recoveryServer)await new Promise(r=>recoveryServer.close(r));
 if(recoveryPool)await recoveryPool.end();
 if(client)await client.end();
 if(server&&server.exitCode===null){server.kill('SIGTERM');await new Promise(ok=>server.once('exit',ok));}
}
