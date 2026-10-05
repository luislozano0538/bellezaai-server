const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const source=fs.readFileSync(__dirname+'/server.js','utf8');
const staffId='22222222-2222-4222-8222-222222222222';
const otherId='33333333-3333-4333-8333-333333333333';

function sliceRoute(signature){
  const start=source.indexOf(signature);
  if(start<0) throw new Error('Route not found: '+signature);
  const end=source.indexOf('\napp.',start+1);
  return source.slice(start,end);
}

test('staff appointment list is scoped to its professional id',async()=>{
  let handler,query;
  const route=sliceRoute('app.get("/api/appointments"');
  const auth=()=>{};
  vm.runInNewContext(route,{
    app:{get:(p,a,f)=>{assert.equal(a,auth);handler=f;}},
    auth,
    scopedProfessionalId:()=>staffId,
    pool:{query:async(sql,values)=>{query={sql,values};return {rows:[]};}}
  });
  const res={status(){return this;},json(v){this.value=v;}};
  await handler({user:{id:'staff-user',role:'staff',salonId:'salon-a',professionalId:staffId}},res);
  assert.equal(query.values[0],'salon-a');
  assert.equal(query.values[1],staffId);
  assert.match(query.sql,/a\.professional_id=\$2/);
});

test('staff cannot assign a new appointment to another professional',async()=>{
  let handler,insert;
  const route=sliceRoute('app.post("/api/appointments"');
  const auth=()=>{};
  const db={
    async query(sql,values){
      if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)||sql.includes('pg_advisory_xact_lock')) return {rows:[]};
      if(sql.includes('FROM services')) return {rows:[{id:'service',duration_minutes:60,price_label:'75'}]};
      if(sql.includes('FROM clients')) return {rows:[{id:'client'}]};
      if(sql.includes('FROM professionals')) return {rows:[{id:staffId}]};
      if(sql.includes('LIMIT 1')) return {rows:[]};
      if(sql.includes('INSERT INTO appointments')) {insert={sql,values};return {rows:[{id:values[0]}]};}
      return {rows:[]};
    },
    release(){}
  };
  vm.runInNewContext(route,{
    app:{post:(p,a,f)=>{assert.equal(a,auth);handler=f;}},
    auth,
    scopedProfessionalId:()=>staffId,
    appointmentIsClosed:async()=>false,
    professionalWorks:async()=>true,
    pool:{connect:async()=>db},
    crypto:require('node:crypto'),
    console:{error(){}}
  });
  const res={code:200,status(c){this.code=c;return this;},json(v){this.value=v;}};
  await handler({
    user:{id:'staff-user',role:'staff',salonId:'salon-a',professionalId:staffId},
    body:{
      clientId:'client',
      serviceId:'service',
      professionalId:otherId,
      startsAt:'2099-01-01T15:00:00Z'
    }
  },res);
  assert.equal(res.code,201);
  assert.ok(insert);
  assert.equal(insert.values[4],staffId);
  assert.notEqual(insert.values[4],otherId);
});

test('staff cannot edit salon services',async()=>{
  let handler,queried=false;
  const start=source.indexOf('app.patch("/api/services/:id"');
  const end=source.indexOf('app.patch("/api/services/:id/availability"',start);
  const route=source.slice(start,end);
  const auth=()=>{};
  vm.runInNewContext(route,{
    app:{patch:(p,a,f)=>{assert.equal(a,auth);handler=f;}},
    auth,
    pool:{query:async()=>{queried=true;return {rows:[]};}},
    console
  });
  const res={code:200,status(c){this.code=c;return this;},json(v){this.value=v;}};
  await handler({
    user:{id:'staff-user',role:'staff',salonId:'salon-a',professionalId:staffId},
    params:{id:'11111111-1111-4111-8111-111111111111'},
    body:{name:'Corte',duration_minutes:45,price_label:'50'}
  },res);
  assert.equal(res.code,403);
  assert.equal(queried,false);
});
