'use strict';
// Sets up a new store on your computer: adds the preliminary delivery zones (Lagos, other Nigerian locations).
//   npm run seed
// It never adds products: the shop starts empty and you add your own products in Admin > Products.
// Safe to run repeatedly. Never deletes anything.
const db = require('../src/db');
const { ensureZones } = require('../src/bootstrap');
db.open();
const z = ensureZones();
console.log(z ? `Delivery zones added: ${z} (preliminary; confirm them in Admin > Delivery).` : 'Delivery zones already set up.');
console.log('No products are added. Add your own in Admin > Products.');
