const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/server.js','utf8');
const route=source.slice(source.indexOf('app.patch("/api/clients/:id"'),source.indexOf('app.get("/api/services"'));
async function run(body,rows=[]){
 let handler,queries=[];
 vm.runInNewContext(route,{app:{patch:(p,a,f)=>handler=f},auth(){},console,pool:{query:async(sql,params)=>{queries.push({sql,params});return {rows};}}});
 const res={code:200,status(c){this.code=c;return this;},json(v){this.value=v;}};
 await handler({body,params:{id:'11111111-1111-1111-1111-111111111111'},user:{salonId:'salon-a'}},res);
 return {res,queries};
}
test('client edits are scoped to salon and preserve notes and appointments',async()=>{
 const {res,queries}=await run({name:' Luis ',phone:' 123 ',email:'luis@example.com'},[{id:'client',notes:'keep'}]);
 assert.equal(res.code,200);assert.equal(queries.length,1);
 assert.match(queries[0].sql,/WHERE id=\$1 AND salon_id=\$2/);
 assert.doesNotMatch(queries[0].sql,/SET[^]*notes=|appointments/);
 assert.equal(queries[0].params[1],'salon-a');assert.equal(queries[0].params[2],'Luis');
 assert.equal(res.value.notes,'keep');
});
test('unknown or other salon client returns not found',async()=>{
 assert.equal((await run({name:'Luis'})).res.code,404);
});
test('invalid contact fields fail before database access',async()=>{
 for(const body of [{name:''},{name:'Luis',email:'bad address'},{name:'Luis',phone:123}]){
 const r=await run(body);assert.equal(r.res.code,400);assert.equal(r.queries.length,0);
 }
});
