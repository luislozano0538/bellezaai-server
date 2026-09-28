const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/server.js','utf8');
const route=source.slice(source.indexOf('app.patch("/api/salon"'),source.indexOf('app.get("/api/dashboard"'));
async function run(role,name){
 let handler,queries=[];
 vm.runInNewContext(route,{app:{patch:(p,a,f)=>handler=f},auth(){},pool:{query:async(sql,params)=>{queries.push({sql,params});return {rows:[{name:params[1]}]};}}});
 const res={code:200,status(c){this.code=c;return this;},json(v){this.value=v;}};
 await handler({user:{salonId:'salon-a',role},body:{name,salonId:'other-salon'}},res);
 return {res,queries};
}
test('salon name update uses authenticated salon, not body salon',async()=>{
 const r=await run('owner',' Mi salón ');
 assert.equal(r.res.code,200);assert.equal(r.queries[0].params[0],'salon-a');
 assert.equal(r.res.value.name,'Mi salón');
 assert.match(r.queries[0].sql,/WHERE id=\$1/);
});
test('non owner cannot change salon name',async()=>{
 const r=await run('staff','Name');assert.equal(r.res.code,403);assert.equal(r.queries.length,0);
});
test('blank and oversized names rejected',async()=>{
 for(const name of [' ', 'x'.repeat(121),123]){
 const r=await run('owner',name);assert.equal(r.res.code,400);assert.equal(r.queries.length,0);
 }
});
