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
