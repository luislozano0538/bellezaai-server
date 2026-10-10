import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {initSalonGallery} from './salon-gallery.js';

test('gallery creates independent table without touching clients or bookings',async()=>{
 let ddl='';
 await initSalonGallery({query:async sql=>{ddl=sql;}});
 assert.match(ddl,/CREATE TABLE IF NOT EXISTS salon_gallery_photos/);
 assert.match(ddl,/ADD COLUMN IF NOT EXISTS category/);
 assert.doesNotMatch(ddl,/DROP TABLE|TRUNCATE|DELETE FROM/i);
});
test('50 photos and valid categories are implemented in server and UI',()=>{
 const server=fs.readFileSync(new URL('./salon-gallery.js',import.meta.url),'utf8');
 const ui=fs.readFileSync(new URL('./salon-gallery-ui.js',import.meta.url),'utf8');
 const page=fs.readFileSync(new URL('./salon-gallery-public.js',import.meta.url),'utf8');
 assert.match(server,/MAX_PHOTOS = 50/);
 assert.match(server,/COUNT\(\*\)::int AS total/);
 assert.match(server,/CATEGORIES\.has\(category\)/);
 assert.match(server,/public_booking_enabled=true/);
 assert.match(ui,/Hasta 50 fotografías/);
 assert.match(ui,/galleryCategory/);
 assert.match(page,/Filtrar trabajos por servicio/);
});


test('gallery API rejects a 51st photo and accepts valid categories only',async()=>{
  const {registerSalonGallery}=await import('./salon-gallery.js');
  const salonId='11111111-1111-4111-8111-111111111111';
  const jpg='data:image/jpeg;base64,'+Buffer.from([255,216,255,1,1,1,1,1,1,1,1,1]).toString('base64');
  let total=50,handler,inserted=0;
  const query=async sql=>{
    if(sql.includes('COUNT(*)::int AS total'))return {rows:[{total}]};
    if(sql.includes('INSERT INTO salon_gallery_photos')){
      inserted++;return {rows:[{id:'photo',category:'Uñas'}]};
    }
    return {rows:[]};
  };
  const app={
    get(){},delete(){},
    post(path,...args){if(path==='/api/salon/gallery')handler=args.at(-1);}
  };
  const pool={query,connect:async()=>({query,release(){}})};
  registerSalonGallery({app,pool,auth(){}});
  const request=async({category='Uñas',role='owner',imageData=jpg}={})=>{
    const res={code:200,set(){return this;},status(n){this.code=n;return this;},json(value){this.body=value;return this;}};
    await handler({body:{imageData,category},user:{role,salonId}},res);
    return res;
  };
  assert.equal((await request()).code,409);
  assert.equal(inserted,0);
  total=49;
  assert.equal((await request()).code,201);
  assert.equal(inserted,1);
  assert.equal((await request({category:'Inexistente'})).code,400);
  assert.equal((await request({role:'staff'})).code,403);
});
