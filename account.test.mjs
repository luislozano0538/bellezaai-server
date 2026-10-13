import test from 'node:test';
import assert from 'node:assert/strict';
import { registerAccount } from './account.js';

function fixture({ role = 'owner', valid = true, fail = false, missing = false, active, sessionVersion } = {}) {
  let handler;
  const queries = [];
  let released = false;
  const db = { async query(sql, values) {
    queries.push({ sql, values });
    if (fail && sql.startsWith('DELETE')) throw new Error('database failure');
    return { rows: sql.startsWith('SELECT * FROM users') && !missing ? [{ role, password_hash: 'hash', active, session_version: sessionVersion }] : [] };
  }, release() { released = true; } };
  registerAccount({ app: { get(){}, delete(path, auth, fn) { assert.equal(path, '/api/account'); handler = fn; } }, pool: { connect: async () => db }, auth() {}, verifyPassword: async (value, hash) => valid && value === 'password' && hash === 'hash' });
  async function call(body = { password: 'password', confirmation: 'ELIMINAR' }) {
    const response = { code: 200, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
    await handler({ user: { id: 'user-a', salonId: 'salon-a', role: 'owner' }, body }, response);
    return response;
  }
  return { call, queries, released: () => released };
}
test('owner deletes dependent rows first, scoped to authenticated salon, then commits', async () => {
  const f = fixture(); const r = await f.call(); assert.equal(r.code, 200);
  const deletes = f.queries.filter(q => q.sql.startsWith('DELETE'));
  assert.deepEqual(deletes.map(q => q.sql.split(' ')[2]), ['appointments', 'professional_services', 'salons']);
  for (const q of deletes) assert.deepEqual(q.values, ['salon-a']);
  assert.equal(f.queries.at(-1).sql, 'COMMIT'); assert.ok(f.released());
});
test('staff uses current database role and only deletes own login', async () => {
  const f = fixture({ role: 'staff' }); await f.call();
  assert.deepEqual(f.queries.filter(q => q.sql.startsWith('DELETE')), [{ sql: 'DELETE FROM users WHERE id=$1 AND salon_id=$2', values: ['user-a', 'salon-a'] }]);
});
for (const options of [{ valid: false }, { missing: true }, { role: 'unexpected' }, { active: false }, { sessionVersion: 1 }]) {
  test(`unauthorized deletion changes no records ${JSON.stringify(options)}`, async () => {
    const f = fixture(options); assert.equal((await f.call()).code, 403);
    assert.ok(!f.queries.some(q => q.sql.startsWith('DELETE'))); assert.equal(f.queries.at(-1).sql, 'ROLLBACK');
  });
}
test('current remote schema works with session version and no active column', async () => {
  const f = fixture({ sessionVersion: 0 }); assert.equal((await f.call()).code, 200);
});
test('local schema works with active column and no session version', async () => {
  const f = fixture({ active: true }); assert.equal((await f.call()).code, 200);
});
test('requires exact confirmation before connecting', async () => {
  const f = fixture(); assert.equal((await f.call({ password: 'password', confirmation: 'yes' })).code, 400); assert.equal(f.queries.length, 0);
});
test('database error rolls back and releases connection', async () => {
  const f = fixture({ fail: true }); assert.equal((await f.call()).code, 500); assert.equal(f.queries.at(-1).sql, 'ROLLBACK'); assert.ok(f.released());
});
test('repeated password failures are limited', async () => {
  const f = fixture({ valid: false }); for (let i = 0; i < 5; i++) assert.equal((await f.call()).code, 403);
  assert.equal((await f.call()).code, 429);
});
