const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/server.js','utf8');
const closures=fs.readFileSync(__dirname+'/closures.js','utf8');
const helperSource=source.slice(source.indexOf('function validBusinessHours'),source.indexOf('app.patch("/api/professionals/:id/hours"'));
const closureSource=closures.slice(closures.indexOf('export async function appointmentIsClosed'),closures.indexOf('export function registerClosures')).replace('export async function','async function');
function bookingHelpers(){
 const ctx={Intl,Date};vm.createContext(ctx);vm.runInContext(helperSource+'\n'+closureSource,ctx);
 return {validBusinessHours:ctx.validBusinessHours,withinBusinessHours:ctx.withinBusinessHours,professionalWorks:ctx.professionalWorks,appointmentIsClosed:ctx.appointmentIsClosed};
}
module.exports={bookingHelpers,helperSource};
