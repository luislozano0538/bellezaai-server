const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/server.js','utf8');
function setup(method,path){
 let handler,writes=[];
 const db={release(){},async query(sql,params){
 if(sql.includes('FOR UPDATE')) return {rows:[{id:'a',status:'confirmed',service_id:'old'}]};
 if(sql.includes('FROM services'))return {rows:[{duration_minutes:45,...(sql.includes('price_label')?{price_label:'600'}:{})}]};
 if(sql.includes('FROM clients'))return {rows:[{id:'c'}]};
 if(sql.includes('UPDATE appointments')||sql.includes('INSERT INTO appointments'))writes.push({sql,params});
 return {rows:sql.includes('LIMIT 1')?[]:[{id:'a'}]};
 }};
 const start=source.indexOf('app.'+method+'("'+path+'"'),end=source.indexOf('\napp.',start+1);
 vm.runInNewContext(source.slice(start,end),{app:{[method]:(p,a,f)=>handler=f},auth(){},pool:{connect:async()=>db},crypto:require('node:crypto'),console,
 scopedProfessionalId:()=>null,appointmentIsClosed:async()=>false,professionalWorks:async()=>true});
 const res={code:200,status(c){this.code=c;return this;},json(v){this.body=v;}};
 return {handler,res,writes};
}
test('past new booking returns 400 without writing an appointment',async()=>{
 const t=setup('post','/api/appointments');
 await t.handler({user:{id:'owner-user',role:'owner',salonId:'mine'},body:{clientId:'c',serviceId:'s',startsAt:'2000-01-01T10:00Z'}},t.res);
 assert.equal(t.res.code,400);assert.equal(t.writes.length,0);
});
test('changing a booking service loads its price before snapshot update',async()=>{
 const t=setup('patch','/api/appointments/:id');
 await t.handler({params:{id:'11111111-1111-1111-1111-111111111111'},user:{id:'owner-user',role:'owner',salonId:'mine'},body:{clientId:'c',serviceId:'new',startsAt:'2099-01-01T10:00Z'}},t.res);
 assert.equal(t.res.code,200);assert.equal(t.writes[0].params[6],'600');
});
