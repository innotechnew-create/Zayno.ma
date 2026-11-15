const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zayno-v12-'));
process.env.DATA_DIR = tempDir;
process.env.SESSION_SECRET = 'test-secret-with-more-than-thirty-two-characters';
process.env.NODE_ENV = 'test';
const { app, db } = require('../server');

let agent;
const email = `test-${Date.now()}@example.com`;
const password = 'TestPassword!2026';

before(() => { agent = request.agent(app); });

test('health endpoint responds', async () => {
  const res = await request(app).get('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
});

test('catalogue returns seeded products', async () => {
  const res = await request(app).get('/api/products');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body));
  assert.ok(res.body.length >= 1);
});

test('registration creates a customer and authenticates session', async () => {
  const res = await agent.post('/api/auth/register').send({ name: 'Client Test', email, password });
  assert.equal(res.status, 201);
  assert.equal(res.body.user.email, email);
  assert.equal(res.body.user.role, 'customer');
  assert.equal('passwordHash' in res.body.user, false);
  const me = await agent.get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.user.email, email);
});

test('duplicate registration is rejected', async () => {
  const res = await request(app).post('/api/auth/register').send({ name: 'Client Test', email, password });
  assert.equal(res.status, 409);
});

test('logout clears the session', async () => {
  const out = await agent.post('/api/auth/logout').send({});
  assert.equal(out.status, 200);
  const me = await agent.get('/api/auth/me');
  assert.equal(me.body.user, null);
});

test('admin endpoints reject unauthenticated users', async () => {
  const res = await request(app).get('/api/admin/products');
  assert.equal(res.status, 401);
});

test('order creation rejects invalid payload', async () => {
  const res = await request(app).post('/api/orders').send({ items: [] });
  assert.equal(res.status, 401);
});
