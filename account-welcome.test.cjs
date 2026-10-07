const {test,before}=require('node:test');
let createAuthGate;
before(async()=>{({createAuthGate}=await import('./auth-limits.js'));});
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/server.js','utf8');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
const routes=source.slice(source.indexOf('function normalizedAccountEmail'),source.indexOf('function validBusinessHours'));
const good={name:' Luis ',salonName:' Salón nuevo ',email:' OWNER@example.com ',password:'long-password-123'};
function api(failure){
 const handlers={},calls=[];let released=false;
 const query=async(sql,params)=>{calls.push({sql,params});if(sql.includes('INSERT INTO users')&&failure==='duplicate')throw Object.assign(Error(),{code:'23505'});return {rows:sql.startsWith('SELECT')?[{id:'owner',salon_id:'salon',role:'owner',password_hash:'hash'}]:[]};};
 vm.runInNewContext(routes,{authGate:createAuthGate(),Buffer,crypto:require('node:crypto'),JWT_SECRET:'isolated',requireConfig:()=>true,console:{error(){}},app:{post:(path,fn)=>handlers[path]=fn},pool:{query,connect:async()=>{if(failure==='connect')throw Error();return {query,release:()=>released=true};}},bcrypt:{hash:async()=> 'hash',compare:async p=>p==='legacy'},jwt:{sign:()=>{if(failure==='sign')throw Error();return 'isolated-token';}}});
 return {calls,get released(){return released;},async run(path,body){const res={code:200,status(n){this.code=n;return this;},json(value){this.value=value;return this;}};await handlers['/api/auth/'+path]({body},res);return res;}};
}
test('register normalizes account and atomically commits salon and owner',async()=>{const a=api();const r=await a.run('register',good);assert.equal(r.code,201);assert.equal(a.calls.at(-1).sql,'COMMIT');assert.equal(a.calls.find(c=>c.sql.includes('INSERT INTO users')).params[2],'owner@example.com');assert.equal(a.calls.find(c=>c.sql.includes('INSERT INTO salons')).params[1],'Salón nuevo');assert.ok(a.released);});
test('invalid registration never reaches database',async()=>{for(const body of [{...good,password:'short'},{...good,password:'é'.repeat(40)},{...good,name:{}},{...good,salonName:''},{...good,email:'bad'},{...good,password:123}]){const a=api();assert.equal((await a.run('register',body)).code,400);assert.equal(a.calls.length,0);}});
test('duplicate account rolls back new salon and releases connection',async()=>{const a=api('duplicate');assert.equal((await a.run('register',good)).code,409);assert.equal(a.calls.at(-1).sql,'ROLLBACK');assert.ok(!a.calls.some(c=>c.sql==='COMMIT'));assert.ok(a.released);});
test('signing failure rolls back before commit; connection failure returns 503',async()=>{const a=api('sign');assert.equal((await a.run('register',good)).code,503);assert.equal(a.calls.at(-1).sql,'ROLLBACK');assert.ok(a.released);assert.equal((await api('connect').run('register',good)).code,503);});
test('login accepts legacy password and normalizes email',async()=>{const a=api();assert.equal((await a.run('login',{email:' OWNER@example.com ',password:'legacy'})).code,200);assert.equal(a.calls[0].params[0],'owner@example.com');assert.equal((await a.run('login',{email:'owner@example.com',password:{}})).code,401);});

function welcome({path='/reservar/new',owner=true,marker='/reservar/new',fail=false}={}){
 let token=null;
 const nodes=new Map(),events={},opened=[],actions=[],store=new Map(marker?[['bellezaAIWelcomePath',marker]]:[]);
 class Node{constructor(){this.children=[];this.style={};}append(...a){this.children.push(...a);}prepend(...a){this.children.unshift(...a);}after(){}cloneNode(){return new Node();}querySelector(s){return node(s);}replaceChildren(...a){this.children=a;}setAttribute(){}click(){actions.push('click');this.onclick?.();}focus(){actions.push('focus');}scrollIntoView(){} }
 function node(s){if(!nodes.has(s))nodes.set(s,new Node());return nodes.get(s);}
 const data={path,owner,ready:false,items:[{id:'name',label:'Nombre',required:true,complete:true},{id:'hours',label:'Horario',required:true,complete:false}]};
 const script=html.slice(html.lastIndexOf('<script>')+8,html.lastIndexOf('</script>'));
 vm.runInNewContext(script,{document:{createElement:()=>new Node(),querySelector:node,getElementById:id=>node('#'+id)},window:{addEventListener:(n,f)=>events[n]=f},localStorage:{getItem:()=>token},sessionStorage:{getItem:k=>store.get(k),removeItem:k=>store.delete(k)},openModal:id=>opened.push(id),closeModal(){},showView:v=>actions.push(v),fetch:async()=>{if(fail)throw Error('offline');return {ok:true,json:async()=>data};}});
 // The real login handler stores the token before dispatching the event.
 return {nodes,opened,store,actions,events,async login(){token='isolated-token';await events['account-signed-in']();}};
}
test('guide does not open automatically for existing accounts without marker',async()=>{const w=welcome({marker:null});await w.events['account-signed-in']();assert.equal(w.opened.length,0);});
test('new owner gets guide once and Continue leads to first missing step',async()=>{const w=welcome();await w.login();assert.deepEqual(w.opened,['setupModal']);assert.equal(w.store.size,0);const next=w.nodes.get('#setupNext');assert.equal(next.hidden,false);assert.equal(next.textContent,'Continuar: Horario');next.onclick();assert.deepEqual(w.actions,['settings','focus']);await w.login();assert.equal(w.opened.length,1);});
test('other salon or non-owner never receives new-salon welcome',async()=>{for(const options of [{path:'/reservar/other'},{owner:false}]){const w=welcome(options);await w.login();assert.equal(w.opened.length,0);assert.equal(w.store.size,1);}});
test('failed setup request retains welcome for retry',async()=>{const w=welcome({fail:true});await w.login();assert.equal(w.opened.length,0);assert.equal(w.store.size,1);assert.equal(w.nodes.get('#setupRefresh').disabled,false);});
