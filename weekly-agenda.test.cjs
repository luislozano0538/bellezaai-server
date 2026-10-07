const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
function setup(){
 const nodes=new Map();
 function node(){return {value:'',style:{},children:[],setAttribute(){},append(...items){this.children.push(...items);},replaceChildren(){this.children=[];}};}
 function get(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);}
 const context=vm.createContext({Date,Intl,document:{getElementById:get,createElement:node,querySelectorAll:()=>[]},lang:'es',filter:'all',appointments:[],localDate:()=> '2026-10-06',prettyDate:d=>d,sortAppt:(a,b)=>(a.date+a.time).localeCompare(b.date+b.time),appointmentHTML:a=>'['+a.id+']',emptyHTML:()=> 'empty',tr:{es:{noAppointments:'none'}}});
 vm.runInContext(html.slice(html.indexOf("let agendaMode='list';"),html.indexOf('function initials(')),context);
 return {context,get,run:code=>vm.runInContext(code,context)};
}
test('week includes Monday through Sunday across year and DST boundaries',()=>{
 const w=setup();
 assert.equal(w.run("agendaWeekDates('2027-01-03').join(',')"),'2026-12-28,2026-12-29,2026-12-30,2026-12-31,2027-01-01,2027-01-02,2027-01-03');
 assert.equal(w.run("agendaWeekDates('2026-11-01').join(',')"),'2026-10-26,2026-10-27,2026-10-28,2026-10-29,2026-10-30,2026-10-31,2026-11-01');
});
test('week uses selected anchor and preserves professional, status and text filters',()=>{
 const w=setup();w.get('appointmentDateFilter').value='2026-10-07';w.get('agendaProfessional').value='p1';w.get('appointmentSearch').value='corte';
 w.context.filter='confirmed';
 w.context.appointments=[{id:1,date:'2026-10-05',time:'09:00',professional_id:'p1',status:'confirmed',name:'Ana',service:'Corte'}, {id:2,date:'2026-10-06',time:'09:00',professional_id:'p2',status:'confirmed',name:'Ana',service:'Corte'}, {id:3,date:'2026-10-07',time:'09:00',professional_id:'p1',status:'cancelled',name:'Ana',service:'Corte'}, {id:4,date:'2026-10-12',time:'09:00',professional_id:'p1',status:'confirmed',name:'Ana',service:'Corte'}];
 w.run("setAgendaMode('week')");
 const sections=w.get('appointmentList').children;assert.equal(sections.length,7);assert.equal(sections[0].children[1].innerHTML,'[1]');assert.match(w.get('agendaWeekRange').textContent,/1 citas/);
 assert.ok(sections.slice(1).every(s=>s.children[1].textContent==='Sin citas con estos filtros.'));
});
test('next/previous/current navigation and Today switch keep deterministic dates',()=>{
 const w=setup();w.run("setAgendaMode('week');moveAgendaWeek(1)");assert.equal(w.get('appointmentDateFilter').value,'2026-10-12');
 w.run('moveAgendaWeek(-1)');assert.equal(w.get('appointmentDateFilter').value,'2026-10-05');
 w.run('moveAgendaWeek(0)');assert.equal(w.get('appointmentDateFilter').value,'2026-10-06');
 w.run("setFilter(null,'today')");assert.equal(w.run('agendaMode'),'list');assert.equal(w.get('agendaWeekNav').hidden,true);
});
test('all inline scripts parse',()=>{for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);});
