const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/server.js','utf8');
const route=source.slice(source.indexOf('app.get("/api/clients/:id/history"'),source.indexOf('app.patch("/api/clients/:id"'));
async function run(found,appointments=[]){
 let handler,queries=[];
 vm.runInNewContext(route,{app:{get:(p,a,f)=>handler=f},auth(){},console,scopedProfessionalId:()=>null,pool:{query:async(sql,params)=>{
 queries.push({sql,params});return {rows:queries.length===1?(found?[{id:'client',name:'Cliente'}]:[]):appointments};}}});
 const res={code:200,status(c){this.code=c;return this;},json(v){this.value=v;}};
 await handler({params:{id:'11111111-1111-1111-1111-111111111111'},user:{id:'owner-user',role:'owner',salonId:'salon-a'}},res);
 return {res,queries};
}
test('history checks client ownership before querying appointments',async()=>{
 const {res,queries}=await run(false);
 assert.equal(res.code,404);assert.equal(queries.length,1);
 assert.match(queries[0].sql,/c\.id=\$1 AND c\.salon_id=\$2/);
 assert.equal(queries[0].params[1],'salon-a');
});
test('history scopes appointments to both client and salon and retains cancellations',async()=>{
 const {res,queries}=await run(true,[{id:'a',status:'cancelled'}]);
 assert.equal(res.code,200);assert.equal(res.value.appointments[0].status,'cancelled');
 assert.match(queries[1].sql,/a\.client_id=\$1 AND a\.salon_id=\$2/);
 assert.equal(queries[1].params[1],'salon-a');
 assert.match(queries[1].sql,/ORDER BY a.starts_at DESC/);
});
test('client without appointments gets an empty history',async()=>{
 const {res}=await run(true);assert.equal(res.code,200);assert.equal(res.value.appointments.length,0);
});
