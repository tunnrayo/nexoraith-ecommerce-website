'use strict';
const db = require('../src/db');
db.open();
console.log('Database is up to date at schema version', db.migrate());
