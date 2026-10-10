const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/server.js','utf8');
const route=source.slice(source.indexOf('app.get("/api/profile"'),source.indexOf('app.get("/api/salon"'));
async function run(role,rows=[{name:'Luis'}]){
 let handler,values;
 vm.runInNewContext(route,{app:{get:(path,auth,fn)=>handler=fn},auth(){},pool:{query:async(sql,params)=>{values=params;return {rows};}}});
 const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;}};
 await handler({user:{id:'account',salonId:'mine',role},body:{role:'owner',salonId:'other'}},res);return {res,values};
}
test('profile exposes the authenticated owner role for mobile salon settings',async()=>{
 const {res,values}=await run('owner');assert.equal(res.code,200);assert.equal(res.body.name,'Luis');assert.equal(res.body.role,'owner');assert.equal(values[0],'account');assert.equal(values[1],'mine');
});
test('profile preserves staff role and ignores body role claims',async()=>{
 const {res}=await run('staff');assert.equal(res.body.role,'staff');
});
test('missing account remains an error, without a default owner role',async()=>{
 const {res}=await run('owner',[]);assert.equal(res.code,404);assert.equal(res.body.role,undefined);
});
