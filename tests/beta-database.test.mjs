import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');

test('Postgres schema: private records, duplicate safety, review status and constraints', async () => {
  const db = new PGlite();
  try {
    // Stand-ins for Supabase roles. Tests exercise real Postgres grants and constraints.
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon, authenticated, service_role;');
    await db.exec(await readFile(new URL('../supabase/migrations/202609150001_beta_applications.sql', import.meta.url), 'utf8'));
    const insert = `insert into public.beta_applications
      (display_name,email,platform,specs,availability,motivation,contact_consent)
      values ('Example','tester@example.com','Windows','Example PC','Evenings','Test',true)`;
    for (const role of ['anon', 'authenticated']) {
      await db.exec('set role ' + role);
      for (const sql of ['select * from public.beta_applications', insert,
        "update public.beta_applications set status='accepted'", 'delete from public.beta_applications']) {
        await assert.rejects(db.exec(sql), /permission denied/);
      }
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    await db.exec(insert);
    await db.exec(insert.replace("'Example'", "'Overwrite attempt'") + ' on conflict (project,email) do nothing');
    const { rows } = await db.query('select * from public.beta_applications');
    assert.equal(rows.length, 1); assert.equal(rows[0].display_name, 'Example'); assert.equal(rows[0].status, 'pending');
    for (const [from, to] of [["true)","false)"], ["'Windows'","'Invalid'"], ["'Example'","''"], ["'tester@example.com'","'BAD@EXAMPLE.COM'"]]) {
      await assert.rejects(db.exec(insert.replace(from, to)), /check constraint/);
    }
    await db.exec("update public.beta_applications set status='accepted', admin_notes='Reviewed'");
    assert.equal((await db.query('select status from public.beta_applications')).rows[0].status, 'accepted');
    await assert.rejects(db.exec("update public.beta_applications set status='admin'"), /check constraint/);
    const tables = (await db.query("select tablename from pg_tables where schemaname='public'")).rows;
    assert.deepEqual(tables.map(t => t.tablename), ['beta_applications']);
  } finally { await db.close(); }
});
