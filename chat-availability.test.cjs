const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const server=fs.readFileSync(__dirname+'/server.js','utf8');
const route=server.slice(server.indexOf('let chatAvailability;'),server.indexOf('app.get("/api/plans"'));
const slot={id:'svc',name:'Corte',duration_minutes:45,price_label:'50'};
function fixture({toolError=false,empty=false}={}){
  let handler,aiCalls=[],lookups=[];
  const pool={async query(sql,params){
    if(sql.includes('FROM services'))return {rows:[slot]};
    if(sql.includes('FROM salons'))return {rows:[{name:'Salon',business_hours:{timezone:'America/New_York'},public_booking_enabled:true}]};
    throw Error('Unexpected database call');
  }};
  const context=vm.createContext({
    app:{post(path,middleware,fn){assert.equal(path,'/api/chat');handler=fn;}},
    auth(){},pool,console:{error(){}},process:{env:{OPENAI_API_KEY:'fake-test-key'}},
    OpenAI:class{responses={create:async args=>{
      aiCalls.push(structuredClone(args));
      if(empty)return {output:[],output_text:''};
      if(aiCalls.length===1)return {output:[{type:'function_call',name:'consultar_horarios',call_id:'lookup1',arguments:JSON.stringify({serviceId:'svc',professionalId:null,date:'2030-01-01'})}]};
      return {output:[],output_text:'A las 10:00 hay disponibilidad; la cita no está reservada.'};
    }};}
  });
  vm.runInContext(route,context);
  context.lookup=async (_db,salonId,serviceId,professionalId,date)=>{
    lookups.push([salonId,serviceId,professionalId,date]);
    if(toolError)throw Error('database temporarily unavailable');
    return {shop:{business_hours:{timezone:'America/New_York'}},service:slot,slots:[new Date('2030-01-01T15:00:00.000Z')]};
  };
  vm.runInContext('chatAvailability=lookup',context);
  return {aiCalls,lookups,async request(message,body={}){
    const res={code:200,status(n){this.code=n;return this;},json(obj){this.body=obj;return this;}};
    await handler({user:{salonId:'my-salon'},body:{message,...body}},res);
    return res;
  }};
}
test('in-app Luna uses authenticated salon only and returns real database slots to model',async()=>{
  const f=fixture();
  const res=await f.request('¿Hay corte mañana a las 10?',{salonId:'another-salon'});
  assert.equal(res.code,200);
  assert.equal(f.lookups.length,1);
  assert.deepEqual(f.lookups[0],['my-salon','svc',null,'2030-01-01']);
  assert.match(f.aiCalls[0].instructions,/do not claim an appointment has been booked/i);
  assert.match(f.aiCalls[1].input.at(-1).output,/2030-01-01T15:00:00\.000Z/);
  assert.equal(res.body.reply.includes('no está reservada'),true);
});
test('unavailable slot lookup sends an error, never fictional availability',async()=>{
  const f=fixture({toolError:true});
  await f.request('Horarios para mañana');
  const message=JSON.parse(f.aiCalls[1].input.at(-1).output);
  assert.ok(message.error);
  assert.equal(message.slots,undefined);
});
test('empty and oversized messages are rejected before requesting slots',async()=>{
  const f=fixture();
  assert.equal((await f.request(' ')).code,400);
  assert.equal((await f.request('X'.repeat(1201))).code,400);
  assert.equal(f.aiCalls.length,0);
});
test('empty AI answer returns an explicit error',async()=>{
  const f=fixture({empty:true});
  assert.equal((await f.request('Hola')).code,502);
});
test('booking module exposes its existing validated availability function',()=>{
  const source=fs.readFileSync(__dirname+'/public-booking.js','utf8');
  assert.match(source,/return availability; \/\/ Reuse the same validated lookup/);
  assert.match(server,/chatAvailability = registerPublicBooking\(/);
});
