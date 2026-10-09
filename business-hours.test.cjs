const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/server.js','utf8');
const {helperSource:helper}=require('./booking-test-helpers.cjs');
const ctx={Intl,Date};vm.createContext(ctx);vm.runInContext(helper,ctx);
const hours=()=>({timezone:'America/New_York',days:Array.from({length:7},()=>({open:true,start:'09:00',end:'18:00'}))});
test('unconfigured hours do not impose invented restrictions',()=>assert.equal(ctx.withinBusinessHours(null,new Date(),new Date()),null));
test('validates timezone, seven days and opening before closing',()=>{
 assert.equal(ctx.validBusinessHours(hours()),true);
 for(const h of [{...hours(),timezone:'bad-zone'},{...hours(),days:[]},{...hours(),days:Array(7).fill({open:true,start:'18:00',end:'09:00'})}])
 assert.equal(ctx.validBusinessHours(h),false);
});
test('allows exact opening and closing, rejects early start and late end',()=>{
 const h=hours(),d=s=>new Date('2026-09-28T'+s+'-04:00');
 assert.equal(ctx.withinBusinessHours(h,d('09:00'),d('18:00')),true);
 assert.equal(ctx.withinBusinessHours(h,d('08:59'),d('10:00')),false);
 assert.equal(ctx.withinBusinessHours(h,d('17:00'),d('18:01')),false);
});
test('closed days and appointments spanning dates warn',()=>{
 const h=hours();h.days[1]={open:false};
 assert.equal(ctx.withinBusinessHours(h,new Date('2026-09-28T14:00Z'),new Date('2026-09-28T15:00Z')),false);
 assert.equal(ctx.withinBusinessHours(hours(),new Date('2026-09-28T14:00Z'),new Date('2026-09-29T15:00Z')),false);
});
test('uses salon timezone including winter offset',()=>{
 assert.equal(ctx.withinBusinessHours(hours(),new Date('2026-12-01T14:00Z'),new Date('2026-12-01T23:00Z')),true);
 assert.equal(ctx.withinBusinessHours(hours(),new Date('2026-12-01T13:00Z'),new Date('2026-12-01T15:00Z')),false);
});
test('only owner may save hours and authenticated salon determines update',async()=>{
 const route=source.slice(source.indexOf('app.patch("/api/salon/hours"'),source.indexOf('app.post("/api/salon/check-hours"'));
 let handler,params;
 vm.runInNewContext(helper+route,{Intl,Date,app:{patch:(p,a,f)=>handler=f},auth(){},pool:{query:async(s,p)=>{params=p;return {rows:[{business_hours:hours()}]};}}});
 const res={code:200,status(c){this.code=c;return this;},json(){}};
 await handler({user:{role:'staff',salonId:'mine'},body:hours()},res);
 assert.equal(res.code,403);assert.equal(params,undefined);
 res.code=200;await handler({user:{role:'owner',salonId:'mine'},body:{...hours(),salonId:'other'}},res);
 assert.equal(res.code,200);assert.equal(params[0],'mine');
});
