'use strict';
// UserError = a problem the customer/admin can understand and fix. Its message is safe to display.
class UserError extends Error { constructor(msg, extra = {}) { super(msg); this.name = 'UserError'; Object.assign(this, extra); } }
module.exports = { UserError };
