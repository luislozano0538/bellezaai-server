const {readFileSync} = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {test} = require('node:test');
const source = readFileSync(__dirname + '/server.js', 'utf8');
const start = source.indexOf('app.patch("/api/appointments/:id"');
const end = source.indexOf('\napp.', start + 1);
const id = '11111111-1111-4111-8111-111111111111';
function setup({exists = true, conflict = false, failReminder = false, cancelled = false} = {}) {
  let handler, released = false;
  const calls = [];
  const auth = () => {};
  const db = {
    async query(sql, values) {
      calls.push({sql, values});
      if (sql.includes('FOR UPDATE')) return {rows: exists ? [{id, status: cancelled ? 'cancelled' : 'confirmed', professional_id: null}] : []};
      if (sql.includes('FROM clients')) return {rows: [{id: 'client'}]};
      if (sql.includes('FROM services')) return {rows: [{duration_minutes: 240}]};
      if (sql.includes('LIMIT 1')) return {rows: conflict ? [{id: 'busy'}] : []};
      if (sql.includes('INSERT INTO reminders') && failReminder) throw Error('reminder failed');
      return {rows: [{id}]};
    },
    release() {released = true;}
  };
  vm.runInNewContext(source.slice(start, end), {
    app: {patch(path, middleware, fn) {assert.equal(middleware, auth); handler = fn;}},
    auth, pool: {async connect() {return db;}}, crypto: require('node:crypto'), console: {error() {}}
  });
  const res = {code: 200, status(n) {this.code=n; return this;}, json(body) {this.body=body;}};
  return {handler, res, calls, released: () => released};
}
const req = body => ({params: {id}, user: {salonId: 'salon-A'}, body});
const edit = {clientId: 'client', serviceId: 'service', startsAt: '2099-09-30T15:30:00Z'};
test('reschedule updates duration and replaces unsent reminder in one transaction', async () => {
  const t = setup();
  await t.handler(req(edit), t.res);
  assert.equal(t.res.code, 200);
  const lock = t.calls.find(x => x.sql.includes('FOR UPDATE'));
  assert.equal(lock.values[1], 'salon-A');
  const conflict = t.calls.find(x => x.sql.includes('LIMIT 1'));
  assert.match(conflict.sql, /id<>\$2/);
  assert.equal(conflict.values[1], id);
  const update = t.calls.find(x => x.sql.includes('SET client_id'));
  assert.equal(update.values[5] - update.values[4], 240 * 60000);
  const reminder = t.calls.find(x => x.sql.includes('INSERT INTO reminders'));
  assert.match(reminder.sql, /INTERVAL '24 hours'/);
  assert.equal(reminder.values[2].toISOString(), edit.startsAt.replace('Z', '.000Z'));
  assert.equal(t.calls.at(-1).sql, 'COMMIT');
  assert.equal(t.released(), true);
});
test('another salons appointment cannot be changed', async () => {
  const t = setup({exists:false});
  await t.handler(req(edit), t.res);
  assert.equal(t.res.code, 404);
  assert.equal(t.calls.some(x => x.sql.startsWith('UPDATE')), false);
  assert.equal(t.calls.at(-1).sql, 'ROLLBACK');
});
test('overlap prevents appointment and reminder changes', async () => {
  const t = setup({conflict:true});
  await t.handler(req(edit), t.res);
  assert.equal(t.res.code, 409);
  assert.equal(t.calls.some(x => x.sql.startsWith('UPDATE')), false);
  assert.equal(t.calls.at(-1).sql, 'ROLLBACK');
});
test('reminder failure rolls back appointment change', async () => {
  const t = setup({failReminder:true});
  await t.handler(req(edit), t.res);
  assert.equal(t.res.code, 500);
  assert.equal(t.calls.at(-1).sql, 'ROLLBACK');
  assert.equal(t.calls.some(x => x.sql === 'COMMIT'), false);
});
test('cancellation preserves sent history and cancels unsent reminders', async () => {
  const t = setup();
  await t.handler(req({status:'cancelled'}), t.res);
  assert.equal(t.res.code, 200);
  assert.ok(t.calls.some(x => x.sql.includes("SET status='cancelled' WHERE id=")));
  assert.ok(t.calls.some(x => x.sql.includes("sent_at IS NULL AND status<>'sent'")));
  assert.equal(t.calls.some(x => x.sql.includes('INSERT')), false);
  assert.equal(t.calls.at(-1).sql, 'COMMIT');
});
test('cancelled appointment cannot be silently reopened', async () => {
  const t = setup({cancelled:true});
  await t.handler(req(edit), t.res);
  assert.equal(t.res.code, 409);
  assert.equal(t.calls.at(-1).sql, 'ROLLBACK');
});
