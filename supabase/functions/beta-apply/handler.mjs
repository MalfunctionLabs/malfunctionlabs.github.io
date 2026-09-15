const ORIGINS = new Set([
  'https://malfunctionlabs.com',
  'https://www.malfunctionlabs.com',
  'https://malfunctionlabs.github.io',
]);
const CONSENT_VERSION = 'beta-contact-v1';
const MAX_BYTES = 16384;
const ACCEPTED = { message: 'Application received for review. If you already applied with this email, your original application remains on file. Applying does not grant tester access.' };

export function validateApplication(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid application.');
  const field = (key, max, required = true) => {
    if (!required && input[key] === undefined) return '';
    if (typeof input[key] !== 'string') throw new Error('Check ' + key + '.');
    const value = input[key].trim();
    if ((required && !value) || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
      throw new Error('Check ' + key + '.');
    }
    return value;
  };
  if (field('company', 200, false)) throw new Error('Unable to accept this application.');
  const email = field('email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Check your email address.');
  const platform = field('platform', 20);
  if (!['Windows', 'Linux', 'macOS', 'Other'].includes(platform)) throw new Error('Choose a platform.');
  if (input.contact_consent !== true) throw new Error('Contact permission is required.');
  return {
    project: 'MRS', display_name: field('display_name', 100), email,
    discord: field('discord', 100, false), platform,
    specs: field('specs', 1500), availability: field('availability', 300),
    experience: field('experience', 2000, false), motivation: field('motivation', 2000),
    contact_consent: true, consent_version: CONSENT_VERSION,
  };
}

async function boundedJSON(request) {
  if (Number(request.headers.get('content-length')) > MAX_BYTES) throw new RangeError();
  if (!request.body) throw new SyntaxError();
  const reader = request.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw new RangeError(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const all = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(all));
}

export function createHandler(config, fetcher = fetch) {
  return async function handler(request) {
    const origin = request.headers.get('origin');
    const allowed = ORIGINS.has(origin);
    const headers = {
      'Content-Type': 'application/json', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Vary': 'Origin',
      ...(allowed ? { 'Access-Control-Allow-Origin': origin } : {}),
    };
    const reply = (code, data) => new Response(JSON.stringify(data), { status: code, headers });
    if (!allowed) return reply(403, { error: 'Origin not allowed.' });
    if (request.method === 'OPTIONS') return new Response(null, {
      status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Max-Age': '600' },
    });
    if (request.method !== 'POST') return reply(405, { error: 'Use POST.' });
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return reply(415, { error: 'Use JSON.' });
    }
    if (!config.supabaseUrl || !config.serviceKey || !config.turnstileSecret) {
      return reply(503, { error: 'Applications are temporarily unavailable. Please try again later.' });
    }
    let input, application;
    try { input = await boundedJSON(request); }
    catch (error) { return reply(error instanceof RangeError ? 413 : 400, { error: 'Invalid or oversized application.' }); }
    try { application = validateApplication(input); }
    catch (error) { return reply(400, { error: error.message }); }
    if (typeof input.turnstile_token !== 'string' || !input.turnstile_token || input.turnstile_token.length > 2048) {
      return reply(400, { error: 'Complete the anti-spam check.' });
    }
    try {
      const verification = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: config.turnstileSecret, response: input.turnstile_token }),
        signal: AbortSignal.timeout(10000),
      });
      if (!verification.ok) throw new Error('Verification unavailable');
      const result = await verification.json();
      if (result.success !== true || result.action !== 'beta_apply' || result.hostname !== new URL(origin).hostname) {
        return reply(400, { error: 'The anti-spam check expired or failed. Please complete it again.' });
      }
      // Unique project/email + DO NOTHING makes retries safe and never overwrites an existing applicant.
      const saved = await fetcher(config.supabaseUrl.replace(/\/$/, '') + '/rest/v1/beta_applications?on_conflict=project,email', {
        method: 'POST', headers: {
          'Content-Type': 'application/json', 'apikey': config.serviceKey,
          'Authorization': 'Bearer ' + config.serviceKey,
          'Prefer': 'resolution=ignore-duplicates,return=minimal',
        },
        body: JSON.stringify(application), signal: AbortSignal.timeout(10000),
      });
      if (!saved.ok) throw new Error('Storage unavailable');
      // Identical response for new applications and duplicates. Never exposes account/email existence.
      return reply(200, ACCEPTED);
    } catch {
      // Do not return database errors or log application data, tokens or secrets.
      return reply(503, { error: 'We could not confirm your application was saved. Please retry; duplicate submissions will not create another application.' });
    }
  };
}
