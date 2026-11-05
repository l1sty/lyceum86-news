import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

async function fixture(existingPublication: boolean) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}',email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    grant usage on schema public,auth,storage to anon,authenticated;
    grant select,insert,update,delete on storage.objects to anon,authenticated;
    alter default privileges in schema public grant all on tables to anon,authenticated;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
    set search_path = pg_catalog;`);
  if (existingPublication) await db.exec('create table public.existing_feed(id int); create publication supabase_realtime for table public.existing_feed;');
  return db;
}
const setupUrl = new URL('../supabase/setup.sql',import.meta.url);
test('complete setup runs on fresh Supabase schemas with restricted search_path', async () => {
  const db = await fixture(false);
  try {
    await db.exec(await readFile(setupUrl,'utf8'));
    assert.equal((await db.query('select * from public.posts')).rows.length,3);
    assert.equal((await db.query("select * from pg_catalog.pg_publication_tables where pubname='supabase_realtime' and tablename='messages'")).rows.length,1);
    assert.equal((await db.query('select * from public.admin_users')).rows.length,0);
    assert.equal((await db.query("select * from storage.buckets where id='news-images' and file_size_limit=5242880")).rows.length,1);
    const tables = await db.query<{relname:string;relrowsecurity:boolean}>("select relname,relrowsecurity from pg_catalog.pg_class where relnamespace='public'::regnamespace and relkind='r'");
    assert.ok(tables.rows.every(row=>row.relrowsecurity),JSON.stringify(tables.rows));
    await db.exec('set role anon'); assert.equal((await db.query('select * from public.posts')).rows.length,3);
    await assert.rejects(db.query('select * from public.messages'),/permission denied/);
  } finally { await db.close(); }
});
test('existing realtime publication keeps its other tables', async () => {
  const db = await fixture(true);
  try { await db.exec(await readFile(setupUrl,'utf8')); const r = await db.query<{tablename:string}>("select tablename from pg_catalog.pg_publication_tables where pubname='supabase_realtime' order by tablename"); assert.deepEqual(r.rows.map(x=>x.tablename),['existing_feed','messages']); }
  finally { await db.close(); }
});
test('seed failure rolls back the schema and triggers with it', async () => {
  const db = await fixture(false);
  try {
    const setup = (await readFile(setupUrl,'utf8')).replace("'mizhnarodnyi-dialoh'","'INVALID SLUG'");
    await assert.rejects(db.exec(setup),/check constraint/); await db.exec('rollback');
    const r = await db.query<{posts:string|null}>("select pg_catalog.to_regclass('public.posts') as posts"); assert.equal(r.rows[0].posts,null);
    assert.equal((await db.query("select * from pg_catalog.pg_trigger where tgname='on_auth_user_created'")).rows.length,0);
  } finally { await db.close(); }
});
test('all uid calls stay auth-qualified; bootstrap never runs automatically', async () => {
  const setup = await readFile(setupUrl,'utf8');
  assert.doesNotMatch(setup,/(?<![\w.])uid\s*\(/);
  assert.match(setup,/sender_id uuid := auth\.uid\(\)/);
  assert.equal((setup.match(/create function public\.bootstrap_first_admin\(/g)||[]).length,1);
  assert.doesNotMatch(setup,/select public\.bootstrap_first_admin\(/);
  assert.match(setup,/security invoker set search_path = ''/);
});
