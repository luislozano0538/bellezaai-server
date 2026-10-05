const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/server.js','utf8');
const start=source.indexOf('app.patch("/api/services/:id"');
const route=source.slice(start,source.indexOf('app.patch("/api/services/:id/availability"',start));
async function run(body, rows) {
 let handler, queries=[];
 vm.runInNewContext(route,{app:{patch:(path,auth,fn)=>handler=fn},auth(){},console,
 pool:{query:async(sql,params)=>{queries.push({sql,params});return {rows};}}});
 const res={code:200,status(code){this.code=code;return this;},json(value){this.value=value;return this;}};
 await handler({body,params:{id:'11111111-1111-1111-1111-111111111111'},user:{id:'owner-user',role:'owner',salonId:'salon-a'}},res);
 return {res,queries};
}
test('service edit is scoped to active services of the signed-in salon and leaves appointments untouched',async()=>{
 const {res,queries}=await run({name:' Balayage ',duration_minutes:240,price_label:' 600 '},[{id:'service'}]);
 assert.equal(res.code,200);
 assert.equal(queries.length,1);
 assert.match(queries[0].sql,/WHERE id=\$1 AND salon_id=\$2 AND active=true/);
 assert.doesNotMatch(queries[0].sql,/appointments/i);
 assert.equal(queries[0].params[1],'salon-a');
 assert.equal(queries[0].params[2],'Balayage');
 assert.equal(queries[0].params[4],'600');
});
test('missing or other-salon service is not reported as updated',async()=>{
 const {res}=await run({name:'Corte',duration_minutes:45,price_label:'50'},[]);
 assert.equal(res.code,404);
});
test('invalid duration is rejected before database access',async()=>{
 for(const duration_minutes of [0,1441,1.5,'45']){
  const {res,queries}=await run({name:'Corte',duration_minutes,price_label:'50'},[]);
  assert.equal(res.code,400);assert.equal(queries.length,0);
 }
});
