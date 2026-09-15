import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, validateApplication } from '../supabase/functions/beta-apply/handler.mjs';

const valid = {
  display_name: 'Test Applicant', email: ' TEST@example.com ', discord: '', platform: 'Windows',
  specs: 'Example PC', availability: 'Evenings, Mountain Time', experience: '', motivation: 'Report bugs',
  contact_consent: true, company: '', turnstile_token: 'fake-test-token',
};
const config = { supabaseUrl: 'https://example.supabase.co', serviceKey: 'test-only', turnstileSecret: 'test-only' };
function request(data = valid, overrides = {}) {
  return new Request('https://example.supabase.co/functions/v1/beta-apply', {
    method: 'POST', headers: { origin: 'https://malfunctionlabs.com', 'content-type': 'application/json' },
    body: JSON.stringify(data), ...overrides,
  });
}
function fixture({ verification = {}, saveStatus = 201 } = {}) {
  const calls = [];
  const handler = createHandler(config, async (url, options) => {
    calls.push({ url, options });
    return url.includes('siteverify')
      ? Response.json({ success: true, hostname: 'malfunctionlabs.com', action: 'beta_apply', ...verification })
      : new Response(null, { status: saveStatus });
  });
  return { handler, calls };
}
test('normalizes email and never accepts caller-supplied review/access fields', () => {
  const payload = validateApplication({ ...valid, status: 'accepted', admin_notes: 'fake', project: 'other', approved: true });
  assert.equal(payload.email, 'test@example.com'); assert.equal(payload.project, 'MRS');
  for (const key of ['status', 'admin_notes', 'approved', 'turnstile_token']) assert.equal(key in payload, false);
});
test('valid application verifies challenge before storing and returns no personal data', async () => {
  const { handler, calls } = fixture(); const response = await handler(request());
  assert.equal(response.status, 200); assert.equal(calls.length, 2);
  assert.match(calls[0].url, /siteverify/); assert.match(calls[1].options.headers.Prefer, /ignore-duplicates/);
  const text = await response.text(); assert.ok(!text.includes('test@example.com'));
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://malfunctionlabs.com');
});
for (const [name, patch] of Object.entries({
  'missing consent': { contact_consent: false }, 'string consent': { contact_consent: 'true' },
  'blank name': { display_name: '  ' }, 'invalid email': { email: 'bad' },
  'invalid platform': { platform: 'invented' }, 'oversized specs': { specs: 'a'.repeat(1501) },
  honeypot: { company: 'bot' }, 'missing challenge': { turnstile_token: '' },
})) test('rejects ' + name + ' before any upstream call', async () => {
  const { handler, calls } = fixture(); assert.equal((await handler(request({ ...valid, ...patch }))).status, 400);
  assert.equal(calls.length, 0);
});
for (const verification of [{ success: false }, { hostname: 'evil.example' }, { action: 'other' }]) {
  test('rejects invalid challenge ' + JSON.stringify(verification), async () => {
    const { handler, calls } = fixture({ verification });
    assert.equal((await handler(request())).status, 400); assert.equal(calls.length, 1);
  });
}
test('database failure never reports success or leaks upstream errors', async () => {
  const { handler } = fixture({ saveStatus: 500 }); const response = await handler(request());
  assert.equal(response.status, 503); assert.match((await response.json()).error, /could not confirm/);
});
test('network failure is retryable', async () => {
  const handler = createHandler(config, async () => { throw new Error('private details'); });
  const response = await handler(request()); assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes('private details'));
});
test('unconfigured backend fails closed', async () => {
  assert.equal((await createHandler({})(request())).status, 503);
});
test('foreign origin, bad method, malformed JSON and oversized bodies rejected', async () => {
  const { handler, calls } = fixture();
  assert.equal((await handler(request(valid, { headers: { origin: 'https://evil.example' } }))).status, 403);
  assert.equal((await handler(request(valid, { method: 'GET', body: undefined }))).status, 405);
  assert.equal((await handler(request(valid, { body: '{' }))).status, 400);
  assert.equal((await handler(request(valid, { body: ' '.repeat(16385) }))).status, 413);
  assert.equal((await handler(request(valid, { headers: { origin: 'https://malfunctionlabs.com', 'content-type': 'text/plain' } }))).status, 415);
  assert.equal(calls.length, 0);
});
test('CORS preflight permits only the expected method and header', async () => {
  const { handler } = fixture(); const response = await handler(request(valid, { method: 'OPTIONS', body: undefined }));
  assert.equal(response.status, 204); assert.equal(response.headers.get('access-control-allow-headers'), 'content-type');
});
