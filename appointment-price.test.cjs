const {bookingHelpers}=require('./booking-test-helpers.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/server.js','utf8');
test('creation snapshots selected service price alongside appointment and reminder',async()=>{
 let handler,write;
 const start=source.indexOf('app.post("/api/appointments"'),end=source.indexOf('\napp.',start+1);
 const db={release(){},async query(sql,params){
 if(sql.includes('FROM services'))return {rows:[{id:'s',duration_minutes:45,price_label:'600'}]};
 if(sql.includes('FROM clients'))return {rows:[{id:'c'}]};
 if(sql.includes('INSERT INTO appointments')){write={sql,params};return {rows:[{id:'a'}]};}
 return {rows:[]};
 }};
 vm.runInNewContext(source.slice(start,end),{app:{post:(p,a,f)=>handler=f},...bookingHelpers(),auth(){},pool:{connect:async()=>db},crypto:require('node:crypto'),console});
 const res={code:200,status(c){this.code=c;return this;},json(){}};
 await handler({user:{salonId:'mine'},body:{clientId:'c',serviceId:'s',startsAt:'2099-10-01T14:00Z'}},res);
 assert.equal(res.code,201);assert.equal(write.params[9],'600');
 assert.match(write.sql,/notes, price_label_snapshot/);
});
test('rescheduling same service preserves snapshot; changed service uses new price',()=>{
 assert.match(source,/price_label_snapshot=CASE WHEN service_id=\$4 THEN price_label_snapshot ELSE \$7 END/);
 assert.match(source,/a.price_label_snapshot AS price/);
 assert.doesNotMatch(source,/s.price_label AS price,/);
});
test('legacy backfill only fills missing snapshots and matches salon',()=>{
 assert.match(source,/a.salon_id=s.salon_id AND a.price_label_snapshot IS NULL/);
});
