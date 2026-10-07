import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAuthGate} from './auth-limits.js';
function response(){return {headers:{},set(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(v){this.body=v;}};}
test('registration limit normalizes email and expires after fifteen minutes',()=>{
 let time=100000;const gate=createAuthGate({now:()=>time}),res=response();
 for(let n=0;n<5;n++)gate.enter('register',' Owner@example.com ',res)();
 assert.equal(gate.enter('register','owner@example.com',res),null);
 assert.equal(res.code,429);assert.equal(res.headers['Retry-After'],'900');
 time+=900000;assert.equal(typeof gate.enter('register','owner@example.com',res),'function');
});
test('login and registration quotas are independent and login stops at twenty',()=>{
 const gate=createAuthGate(),res=response();
 for(let n=0;n<20;n++)gate.enter('login','owner@example.com',res)();
 assert.equal(gate.enter('login','owner@example.com',res),null);
 assert.equal(typeof gate.enter('register','owner@example.com',res),'function');
});
test('concurrent work is bounded and releasing twice cannot bypass limit',()=>{
 const gate=createAuthGate({maxActive:1}),res=response();const release=gate.enter('login','a',res);
 assert.equal(gate.enter('login','b',res),null);release();release();
 const second=gate.enter('login','b',res);assert.equal(typeof second,'function');
 assert.equal(gate.enter('login','c',res),null);second();
});
test('rotating addresses hits global quota and recovers after minute',()=>{
 let time=100000;const gate=createAuthGate({now:()=>time}),res=response();
 for(let n=0;n<120;n++)gate.enter('login',String(n),res)();
 assert.equal(gate.enter('login','next',res),null);assert.equal(res.headers['Retry-After'],'60');
 time+=60000;assert.equal(typeof gate.enter('login','next',res),'function');
});
test('address storage is bounded and expired entries are reclaimed',()=>{
 let time=100000;const gate=createAuthGate({maxEntries:1,now:()=>time}),res=response();
 gate.enter('login','a',res)();assert.equal(gate.enter('login','b',res),null);
 time+=900000;assert.equal(typeof gate.enter('login','b',res),'function');
});
