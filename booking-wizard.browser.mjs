import {chromium} from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const html=fs.readFileSync(new URL('./booking.html',import.meta.url));
const catalog={name:'Salón de demostración',timezone:'America/New_York',profile:{description:'Vista de prueba. Datos ficticios.'},hours:Array.from({length:7},(_,i)=>({open:i!==0,start:'09:00',end:'18:00'})),services:[{id:'cut',name:'Corte de pelo',duration_minutes:45,price_label:'50'},{id:'color',name:'Balayage',duration_minutes:240,price_label:'600'},{id:'style',name:'Peinado clásico',duration_minutes:60,price_label:'80'}],professionals:[{id:'pro',name:'Profesional de prueba'}]};
let attempts=[];
const server=http.createServer(async(req,res)=>{
  // Serve newly added static gallery script without changing the mocked booking flow.
  if(req.url==='/salon-gallery-public.js'){
    res.setHeader('Content-Type','application/javascript');
    return res.end(fs.readFileSync(new URL('./salon-gallery-public.js',import.meta.url)));
  }
  res.setHeader('Content-Type',req.url.startsWith('/api')?'application/json':'text/html');
  if(req.url.includes('/slots?')){
    const d=new URL(req.url,'http://localhost').searchParams.get('date');
    return res.end(JSON.stringify({slots:[d+'T14:00:00Z',d+'T15:00:00Z']}));
  }
  if(req.url.endsWith('/bookings')){
    let input='';for await(const part of req)input+=part;
    const body=JSON.parse(input);attempts.push(body);
    if(attempts.length===1){res.statusCode=503;return res.end(JSON.stringify({error:'Interrupción de prueba. Reintenta.'}));}
    return res.end(JSON.stringify({reference:'demo-reference',status:'confirmed',salonName:catalog.name,serviceName:'Balayage',startsAt:body.startsAt,endsAt:new Date(new Date(body.startsAt).getTime()+240*60000).toISOString(),price:'600',timezone:catalog.timezone,professionalName:'Profesional de prueba',managePath:'/gestionar/demo#private-demo'}));
  }
  if(req.url.startsWith('/api'))return res.end(JSON.stringify(catalog));
  res.end(html);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try{
 browser=await chromium.launch();
 const page=await browser.newPage({viewport:{width:390,height:844}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port+'/reservar/demo');
 await page.locator('#bookingForm').waitFor({state:'visible'});
 assert.equal(await page.locator('#step2').isVisible(),false);
 assert.equal(await page.locator('#toSchedule').isDisabled(),true);
 await page.locator('#serviceSearch').fill('clasico');
 assert.equal(await page.locator('#serviceCards article:visible').count(),1);
 await page.locator('#serviceSearch').fill('no existe');
 assert.equal(await page.locator('#serviceCards article:visible').count(),0);
 await page.locator('#serviceSearch').fill('');
 await page.getByRole('button',{name:'Elegir Balayage',exact:true}).click();
 fs.mkdirSync('booking-preview',{recursive:true});
 await page.screenshot({path:'booking-preview/01-services-mobile.png',fullPage:true});
 await page.locator('#toSchedule').click();
 await page.locator('#slots button').first().waitFor();
 assert.equal(await page.locator('#step1').isVisible(),false);
 assert.equal(await page.locator('#toDetails').isDisabled(),true);
 assert.ok(await page.locator('#quickDates button').count()>=1);
 await page.locator('#slots button').first().click();
 await page.locator('#toDetails').click();
 await page.locator('#name').fill('Cliente de prueba');
 await page.locator('#phone').fill('2025550100');
 await page.locator('#backToSchedule').click();
 await page.locator('#professional').selectOption('pro');
 assert.equal(await page.locator('#toDetails').isDisabled(),true);
 await page.locator('#findSlots').click();
 await page.locator('#slots button').first().waitFor();
 await page.screenshot({path:'booking-preview/02-schedule-mobile.png',fullPage:true});
 await page.locator('#slots button').first().click();
 await page.locator('#toDetails').click();
 assert.equal(await page.locator('#name').inputValue(),'Cliente de prueba');
 await page.locator('#stepNav1').click();
 await page.getByRole('button',{name:'Elegir Corte de pelo',exact:true}).click();
 await page.locator('#toSchedule').click();
 assert.equal(await page.locator('#toDetails').isDisabled(),true);
 await page.locator('#backToService').click();
 await page.getByRole('button',{name:'Elegir Balayage',exact:true}).click();
 await page.locator('#toSchedule').click();
 await page.locator('#slots button').first().waitFor();
 await page.locator('#slots button').first().click();
 await page.locator('#toDetails').click();
 assert.match(await page.locator('#summary').innerText(),/Balayage.*240 minutos.*600/);
 await page.screenshot({path:'booking-preview/03-review-mobile.png',fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.locator('#submitBooking').click();
 await page.getByText('Interrupción de prueba. Reintenta.').waitFor();
 assert.equal(await page.locator('#stepNav2').isDisabled(),false);
 await page.locator('#submitBooking').click();
 await page.locator('#confirmation').waitFor({state:'visible'});
 assert.equal(attempts.length,2);
 assert.equal(attempts[0].requestId,attempts[1].requestId);
 assert.equal(attempts[1].serviceId,'color');
 assert.equal(attempts[1].professionalId,'pro');
 assert.deepEqual(errors,[]);
 console.log('Reserva guiada aprobada: búsqueda, pasos, cambio de selección, datos conservados, reintento y confirmación. HTTP simulado, sin citas reales.');
}finally{
 if(browser)await browser.close();
 await new Promise(r=>server.close(r));
}
