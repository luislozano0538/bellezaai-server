import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {bookingReceipt,registerPublicManagement} from './public-management.js';
const html=fs.readFileSync(new URL('./booking.html',import.meta.url),'utf8');
const source=fs.readFileSync(new URL('./public-booking.js',import.meta.url),'utf8');
function requestCache(storage){
 const context=vm.createContext({id:'salon',sessionStorage:storage,crypto});
 vm.runInContext(html.slice(html.indexOf('  let bookingAttempt='),html.indexOf('  const dateKey=')),context);
 return hash=>vm.runInContext(`bookingRequestId(${JSON.stringify(hash)})`,context);
}
test('blocked browser storage still allows stable booking retries',()=>{
 const next=requestCache({getItem(){throw Error();},setItem(){throw Error();}});
 const id=next('same-payload');assert.equal(next('same-payload'),id);assert.notEqual(next('changed-payload'),id);
});
test('stored request survives page recreation; malformed saved IDs are replaced',()=>{
 const entries=new Map(),storage={getItem:k=>entries.get(k),setItem:(k,v)=>entries.set(k,v)};
 const id=requestCache(storage)('same');assert.equal(requestCache(storage)('same'),id);
 storage.setItem('bellezaBooking:salon',JSON.stringify({hash:'same',requestId:'broken'}));
 assert.match(requestCache(storage)('same'),/^[0-9a-f-]{36}$/);
});
test('full public request limiter reclaims expired salons',()=>{
 let now=100000,accepted=0;
 const context=vm.createContext({uuid:()=>true,Date:{now:()=>now}});
 vm.runInContext(source.slice(source.indexOf('  const reads ='),source.indexOf('  registerPublicManagement(')),context);
 const res={status(){return this;},json(){}};
 for(let n=0;n<2000;n++)context.limit({params:{id:String(n)}},res,()=>accepted++);
 context.limit({params:{id:'new'}},res,()=>accepted++);assert.equal(accepted,2000);
 now+=60000;context.limit({params:{id:'new'}},res,()=>accepted++);assert.equal(accepted,2001);
});
const salonId='11111111-1111-4111-8111-111111111111',appointmentId='22222222-2222-4222-8222-222222222222';
async function management(){
 const handlers={},calls=[];let released=0;
 const start=new Date(Date.now()+7*86400000),next=new Date(start.getTime()+86400000);
 const row={id:appointmentId,request_id:crypto.randomUUID(),service_id:crypto.randomUUID(),professional_id:null,status:'confirmed',starts_at:start,ends_at:new Date(start.getTime()+240*60000),price_label_snapshot:'600',salon_name:'Isolated salon',service_name:'Balayage',timezone:'America/New_York'};
 const db={async query(sql,params){calls.push({sql,params});return {rows:sql.startsWith('SELECT a.id')?[row]:[]};},release(){released++;}};
 let availabilityArgs;
 registerPublicManagement({app:{get(){},post:(path,...args)=>handlers[path.split('/').at(-1)]=args.at(-1)},pool:{connect:async()=>db},limit(){},secret:'isolated-test-secret',availability:async(...args)=>{availabilityArgs=args;return {shop:{business_hours:{timezone:'America/New_York'}},slots:[next]};}});
 const receipt=await bookingReceipt(db,'isolated-test-secret',salonId,appointmentId),token=receipt.managePath.split('#')[1];calls.length=0;
 return {row,calls,next,receipt,get availabilityArgs(){return availabilityArgs;},get released(){return released;},async request(action,extra={}){const res={code:200,set(){return this;},status(c){this.code=c;return this;},json(value){this.value=value;}};await handlers[action]({params:{id:salonId,appointmentId},body:{token,expectedStartsAt:new Date(row.starts_at).toISOString(),...extra}},res);return res;}};
}
test('receipt has private link and valid token reads the booking',async()=>{const m=await management(),res=await m.request('manage');assert.equal(res.code,200);assert.equal(res.value.reference,appointmentId);assert.equal(res.value.price,'600');assert.match(m.receipt.managePath,/#.{43}$/);assert.equal(m.released,1);});
test('invalid private token cannot mutate booking',async()=>{const m=await management(),res=await m.request('cancel',{token:'x'.repeat(43)});assert.equal(res.code,404);assert.ok(!m.calls.some(c=>c.sql.startsWith('UPDATE')));assert.equal(m.calls.at(-1).sql,'ROLLBACK');});
test('reschedule retains duration and price and replaces pending reminders',async()=>{const m=await management();const res=await m.request('reschedule',{date:'2030-01-01',startsAt:m.next.toISOString()});assert.equal(res.code,200);assert.equal(res.value.price,'600');assert.equal(new Date(res.value.endsAt)-new Date(res.value.startsAt),240*60000);assert.equal(m.availabilityArgs[5],appointmentId);assert.equal(m.availabilityArgs[6],240);assert.ok(m.calls.some(c=>c.sql.startsWith('INSERT INTO reminders')));assert.equal(m.calls.at(-1).sql,'COMMIT');});
test('stale reschedule and occupied slot leave appointment unchanged',async()=>{for(const extra of [{expectedStartsAt:'2000-01-01T00:00:00.000Z'},{startsAt:'2030-01-01T10:00:00.000Z'}]){const m=await management();assert.equal((await m.request('reschedule',extra)).code,409);assert.ok(!m.calls.some(c=>c.sql.startsWith('UPDATE')));}});
test('cancel is idempotent and cancels pending reminders',async()=>{const m=await management();assert.equal((await m.request('cancel')).value.status,'cancelled');const count=m.calls.filter(c=>c.sql.startsWith('UPDATE')).length;assert.equal(count,2);assert.equal((await m.request('cancel')).value.status,'cancelled');assert.equal(m.calls.filter(c=>c.sql.startsWith('UPDATE')).length,count);});
