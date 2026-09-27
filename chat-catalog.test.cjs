const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const source = readFileSync(__dirname + '/server.js', 'utf8');
const route = source.slice(source.indexOf('app.post("/api/chat"'), source.indexOf('app.get("/api/plans"'));
function setup(rows, fail = false) {
  let handler, request, queries = [];
  const auth = () => {};
  vm.runInNewContext(route, {
    app: { post(path, middleware, fn) { assert.equal(middleware, auth); handler = fn; } },
    auth, process: { env: { OPENAI_API_KEY: 'test' } }, console: { error() {} },
    pool: { async query(sql, params) { queries.push({sql, params}); if (fail) throw Error('offline'); return {rows}; } },
    OpenAI: class { responses = { create: async input => { request = input; return {output_text: 'respuesta'}; } }; }
  });
  const res = { code: 200, status(n) { this.code = n; return this; }, json(body) { this.body = body; } };
  return { handler, res, queries, request: () => request };
}
test('loads catalog without appointments and scopes query to authenticated salon', async () => {
  const t = setup([{name: 'valalla', duration_minutes: 240, price_label: '600'}]);
  await t.handler({user: {salonId: 'salon-A'}, body: {message: '¿Cuánto cuesta valalla?', salonId: 'salon-B'}}, t.res);
  assert.equal(t.queries[0].params[0], 'salon-A');
  assert.match(t.queries[0].sql, /salon_id=\$1 AND active=true/);
  assert.match(t.request().instructions, /"name":"valalla","duration_minutes":240,"price_label":"600"/);
  assert.equal(t.res.code, 200);
});
test('empty catalog is explicit', async () => {
  const t = setup([]);
  await t.handler({user: {salonId: 'salon-A'}, body: {message: 'precios'}}, t.res);
  assert.match(t.request().instructions, /service_catalog: \[\]/);
});
test('database failure does not send an uninformed AI request', async () => {
  const t = setup([], true);
  await t.handler({user: {salonId: 'salon-A'}, body: {message: 'precios'}}, t.res);
  assert.equal(t.res.code, 500);
  assert.equal(t.request(), undefined);
});
test('frontend chat sends the saved session token and scripts parse', () => {
  const html = readFileSync(__dirname + '/index.html', 'utf8');
  const chat = html.slice(html.indexOf("const r=await fetch('https://bellezaai-server.onrender.com/api/chat'"));
  assert.ok(chat.slice(0, 400).includes("Authorization:'Bearer '+(localStorage.getItem('bellezaAIToken')||'')"));
  for (const match of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
});
