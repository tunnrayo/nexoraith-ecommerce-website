'use strict';
// Removes the old demonstration catalogue (DummyJSON imports and built-in samples) from YOUR existing database.
//   npm run catalogue:remove-demo -- --dry-run   shows what would be removed, changes nothing
//   npm run catalogue:remove-demo                makes a backup copy of the database, then removes it
// Orders, payments, refunds, admin accounts, delivery zones and settings are never touched. A demo product that appears in
// a customer order is archived (hidden from the shop) instead of deleted, so that order stays complete.
const { removeDemoCatalogue } = require('../src/catalog-cleanup');
const dryRun = process.argv.includes('--dry-run');
try {
  const r = removeDemoCatalogue({ dryRun, log: console.log });
  console.log(dryRun ? 'DRY RUN - nothing was changed.' : 'Done.');
  console.log(`Demo products found: ${r.demoProductsFound}. ${dryRun ? 'Would delete' : 'Deleted'}: ${r.deleted}. ${dryRun ? 'Would archive' : 'Archived'} (used in orders): ${r.archivedBecauseInOrders}.`);
  if (r.editedByOwner.length) console.log(`Of these, edited by you in Admin: ${r.editedByOwner.length} (e.g. ${r.editedByOwner.slice(0, 3).join(', ')}).`);
  console.log(`Demo categories ${dryRun ? 'to remove' : 'removed'}: ${r.categoriesRemoved.length}${r.keptCategories.length ? `; kept (still used by an archived product): ${r.keptCategories.join(', ')}` : ''}.`);
  if (!dryRun) console.log(`Unused saved copies of demo photos removed: ${r.imageCopiesRemoved}.`);
  console.log(`Active products after: ${r.activeProductsAfter}. Orders: ${r.ordersBefore}${dryRun ? '' : ` -> ${r.ordersAfter}`}. Payments: ${r.paymentsBefore}${dryRun ? '' : ` -> ${r.paymentsAfter}`}.`);
} catch (err) { console.error('Nothing was removed:', err.message); process.exit(1); }
