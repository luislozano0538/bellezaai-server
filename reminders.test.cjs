const {bookingHelpers}=require('./booking-test-helpers.cjs');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {test} = require('node:test');
const source = readFileSync(__dirname + '/server.js', 'utf8');
function route(path, method, query) {
  let handler;
  const start = source.indexOf('app.' + method + '("' + path + '"');
  const end = source.indexOf('\napp.', start + 1);
  const auth = () => {};
  const context = {app: {[method](p, middleware, fn) {assert.equal(middleware, auth); handler = fn;}},
    ...bookingHelpers(), auth, pool: {query, async connect() { return {
      async query(sql, values) {
        if (sql.includes('FROM salon_closures'))return {rows:[]};
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) || sql.includes('pg_advisory_xact_lock')) return {rows: []};
        return query(sql, values);
      }, release() {}
    }; }}, crypto: require('node:crypto'), console: {error() {}}};
  vm.runInNewContext(source.slice(start, end), context);
  const res = {code: 200, status(n) {this.code = n; return this;}, json(body) {this.body = body;}};
  return {handler, res};
}
test('new appointment and reminder use one atomic database statement', async () => {
  const writes = [];
  const t = route('/api/appointments', 'post', async (sql, values) => {
    if (sql.includes('FROM services')) return {rows: [{id: 'service', duration_minutes: 240}]};
    if (sql.includes('FROM clients')) return {rows: [{id: 'client'}]};
    if (sql.includes('LIMIT 1')) return {rows: []};
    writes.push({sql, values});
    return {rows: [{id: values[0]}]};
  });
  await t.handler({user: {salonId: 'salon-A'}, body: {
    clientId: 'client', serviceId: 'service', startsAt: '2099-11-02T10:00:00-05:00'
  }}, t.res);
  assert.equal(t.res.code, 201);
  assert.equal(writes.length, 1);
  assert.match(writes[0].sql, /INSERT INTO appointments[\s\S]*INSERT INTO reminders/);
  assert.match(writes[0].sql, /INTERVAL '24 hours'/);
  assert.match(writes[0].sql, /THEN 'skipped' ELSE 'awaiting_connection'/);
  assert.equal(writes[0].values[1], 'salon-A');
  assert.equal(writes[0].values[6] - writes[0].values[5], 240 * 60000);
  assert.notEqual(writes[0].values[0], writes[0].values[8]);
});
test('conflicting appointments do not create reminders', async () => {
  const t = route('/api/appointments', 'post', async sql => {
    if (sql.includes('INSERT')) assert.fail('must not write');
    if (sql.includes('FROM services')) return {rows: [{duration_minutes: 45}]};
    return {rows: [{id: 'existing'}]};
  });
  await t.handler({user: {salonId: 'A'}, body: {clientId: 'c', serviceId: 's', startsAt: '2099-10-01T10:00:00Z'}}, t.res);
  assert.equal(t.res.code, 409);
});
test('failed atomic write never reports success', async () => {
  const t = route('/api/appointments', 'post', async sql => {
    if (sql.includes('FROM services')) return {rows: [{duration_minutes: 45}]};
    if (sql.includes('FROM clients')) return {rows: [{id: 'c'}]};
    if (sql.includes('LIMIT 1')) return {rows: []};
    throw Error('write failed');
  });
  await t.handler({user: {salonId: 'A'}, body: {clientId: 'c', serviceId: 's', startsAt: '2099-10-01T10:00:00Z'}}, t.res);
  assert.equal(t.res.code, 500);
});
test('reminder list uses authenticated salon and excludes cancelled or past appointments', async () => {
  const t = route('/api/reminders', 'get', async (sql, values) => {
    assert.equal(values[0], 'A');
    assert.match(sql, /a.salon_id=\$1/);
    assert.match(sql, /a.status='confirmed' AND a.starts_at > NOW\(\)/);
    assert.match(sql, /WHEN r.scheduled_at <= NOW\(\) THEN 'expired'/);
    return {rows: []};
  });
  await t.handler({user: {salonId: 'A'}, query: {salonId: 'B'}}, t.res);
  assert.equal(t.res.body.connected, false);
  assert.equal(t.res.body.hoursBefore, 24);
  assert.equal(t.res.body.reminders.length, 0);
});
test('reminder query failure returns an error, not an empty successful list', async () => {
  const t = route('/api/reminders', 'get', async () => {throw Error('offline');});
  await t.handler({user: {salonId: 'A'}}, t.res);
  assert.equal(t.res.code, 500);
});
