-- Apply once to a fresh Supabase project through SQL Editor or `supabase db push`.
-- Requires the trusted database owner; never run with a browser/anon key.
begin;
do $$
begin
  if pg_catalog.to_regprocedure('auth.uid()') is null
     or pg_catalog.to_regclass('auth.users') is null
     or pg_catalog.to_regclass('storage.buckets') is null
     or pg_catalog.to_regclass('storage.objects') is null then
    raise exception 'SUPABASE_REQUIRED: Auth and Storage must be initialized first.';
  end if;
end; $$;
create table public.admin_users (user_id uuid primary key references auth.users(id) on delete cascade);
alter table public.admin_users enable row level security;
revoke all on public.admin_users from public, anon, authenticated;
create function public.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.admin_users where user_id = (select auth.uid()));
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;
create policy admin_self on public.admin_users for select to authenticated using (user_id = (select auth.uid()));
grant select on public.admin_users to authenticated;

-- Explicit, one-time owner action. Never auto-promote the first signup.
-- SECURITY INVOKER means this function cannot grant its caller extra privileges.
create function public.bootstrap_first_admin(target_user_id uuid) returns uuid
language plpgsql security invoker set search_path = '' as $$
begin
  lock table public.admin_users in exclusive mode;
  if exists(select 1 from public.admin_users) then
    raise exception 'ADMIN_ALREADY_ASSIGNED';
  end if;
  if target_user_id is null or not exists (
    select 1 from auth.users as u
    where u.id = target_user_id and u.email_confirmed_at is not null
      and nullif(pg_catalog.btrim(u.email), '') is not null
  ) then
    raise exception 'CONFIRMED_EMAIL_USER_REQUIRED';
  end if;
  insert into public.admin_users(user_id) values(target_user_id);
  return target_user_id;
end; $$;
revoke all on function public.bootstrap_first_admin(uuid) from public, anon, authenticated, service_role;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 2 and 60)
);
alter table public.profiles enable row level security;
revoke all on public.profiles from public, anon, authenticated;
create policy own_profile on public.profiles for select to authenticated using (id = (select auth.uid()) or (select public.is_admin()));
grant select on public.profiles to authenticated;
create function public.new_profile() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, display_name) values(new.id,
    case when char_length(btrim(coalesce(new.raw_user_meta_data->>'display_name',''))) between 2 and 60
    then btrim(new.raw_user_meta_data->>'display_name') else 'Учасник' end);
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.new_profile();
insert into public.profiles(id, display_name) select id, 'Учасник' from auth.users on conflict do nothing;

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 120),
  title text not null check(char_length(btrim(title)) between 5 and 180),
  summary text not null check(char_length(btrim(summary)) between 10 and 400),
  body text not null check(char_length(btrim(body)) between 10 and 30000),
  category text not null check(category in ('Життя ліцею','Навчання','Культура','Безпека')),
  kind text not null default 'news' check(kind in ('news','announcement')),
  image_url text check(image_url is null or image_url ~ '^https://' or image_url ~ '^/images/[a-z0-9-]+\.jpg$'),
  image_alt text not null default '' check(char_length(image_alt) <= 200),
  source_url text check(source_url is null or source_url ~ '^https://'),
  published boolean not null default false, pinned boolean not null default false,
  published_at timestamptz not null default now(), updated_at timestamptz not null default now(), expires_at timestamptz,
  check(image_url is null or char_length(btrim(image_alt)) >= 3)
);
create index posts_feed on public.posts(kind, published, published_at desc);
create index posts_search on public.posts using gin(to_tsvector('simple', title || ' ' || summary || ' ' || body));
alter table public.posts enable row level security;
revoke all on public.posts from public, anon, authenticated;
create policy read_published on public.posts for select to anon, authenticated using ((published and published_at <= now() and (expires_at is null or expires_at > now())) or (select public.is_admin()));
create policy admin_posts_insert on public.posts for insert to authenticated with check ((select public.is_admin()));
create policy admin_posts_update on public.posts for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy admin_posts_delete on public.posts for delete to authenticated using ((select public.is_admin()));
grant select on public.posts to anon, authenticated;
grant insert, update, delete on public.posts to authenticated;
create function public.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$ begin new.updated_at = now(); return new; end; $$;
create trigger posts_updated before update on public.posts for each row execute function public.touch_updated_at();

create table public.chat_bans (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reason text not null check(char_length(reason) between 3 and 300), expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.chat_bans enable row level security;
revoke all on public.chat_bans from public, anon, authenticated;
create policy bans_read on public.chat_bans for select to authenticated using(user_id = (select auth.uid()) or (select public.is_admin()));
create policy bans_manage on public.chat_bans for all to authenticated using((select public.is_admin())) with check((select public.is_admin()));
grant select, insert, update, delete on public.chat_bans to authenticated;

create table public.messages (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null default '', body text not null check(char_length(btrim(body)) between 1 and 1500),
  status text not null default 'pending' check(status in ('pending','approved','rejected')),
  created_at timestamptz not null default now()
);
create index messages_feed on public.messages(created_at desc);
create index messages_author on public.messages(user_id, created_at desc);
alter table public.messages enable row level security;
revoke all on public.messages from public, anon, authenticated;
create policy messages_read on public.messages for select to authenticated using(status = 'approved' or user_id = (select auth.uid()) or (select public.is_admin()));
create policy messages_send on public.messages for insert to authenticated with check(user_id = (select auth.uid()) and status = 'pending');
create policy messages_moderate on public.messages for update to authenticated using((select public.is_admin())) with check((select public.is_admin()));
create policy messages_delete on public.messages for delete to authenticated using(user_id = (select auth.uid()) or (select public.is_admin()));
grant select, insert, delete on public.messages to authenticated;
grant update(status) on public.messages to authenticated;
create table public.message_rate_log (user_id uuid not null references auth.users(id) on delete cascade, sent_at timestamptz not null default now());
create index message_rate_user on public.message_rate_log(user_id, sent_at desc);
alter table public.message_rate_log enable row level security;
revoke all on public.message_rate_log from public, anon, authenticated;
create function public.prepare_message() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  sender_id uuid := auth.uid();
begin
  if sender_id is null or new.user_id is distinct from sender_id then raise exception 'AUTH_REQUIRED'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(sender_id::text));
  if exists(select 1 from public.chat_bans where user_id = sender_id and expires_at > now()) then raise exception 'CHAT_BANNED'; end if;
  delete from public.message_rate_log where user_id = sender_id and sent_at < now() - interval '1 hour';
  if exists(select 1 from public.message_rate_log where user_id = sender_id and sent_at > now() - interval '5 seconds')
     or (select count(*) from public.message_rate_log where user_id = sender_id) >= 30 then raise exception 'RATE_LIMIT'; end if;
  insert into public.message_rate_log(user_id) values(sender_id);
  new.created_at = now(); new.status = 'pending'; new.body = btrim(new.body);
  select display_name into new.display_name from public.profiles where id = sender_id;
  return new;
end; $$;
create trigger messages_prepare before insert on public.messages for each row execute function public.prepare_message();

create table public.message_reports (
  id uuid primary key default gen_random_uuid(), message_id uuid not null references public.messages(id) on delete cascade,
  reporter_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  reason text not null check(char_length(btrim(reason)) between 3 and 500), created_at timestamptz not null default now(),
  unique(message_id, reporter_id)
);
alter table public.message_reports enable row level security;
revoke all on public.message_reports from public, anon, authenticated;
create policy reports_send on public.message_reports for insert to authenticated with check(reporter_id = (select auth.uid()) and exists(select 1 from public.messages where id = message_id and status = 'approved'));
create policy reports_read on public.message_reports for select to authenticated using((select public.is_admin()));
create policy reports_delete on public.message_reports for delete to authenticated using((select public.is_admin()));
grant select, insert, delete on public.message_reports to authenticated;

create table public.audit_log (id bigint generated always as identity primary key, actor uuid, action text not null, entity text not null, entity_id uuid, created_at timestamptz not null default now());
alter table public.audit_log enable row level security;
revoke all on public.audit_log from public, anon, authenticated;
create policy audit_read on public.audit_log for select to authenticated using((select public.is_admin()));
grant select on public.audit_log to authenticated;
create function public.audit_change() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_log(actor, action, entity, entity_id) values(auth.uid(), TG_OP, TG_TABLE_NAME, case when TG_OP = 'DELETE' then old.id else new.id end);
  if TG_OP = 'DELETE' then return old; end if; return new;
end; $$;
create trigger posts_audit after insert or update or delete on public.posts for each row execute function public.audit_change();
create trigger messages_audit after update or delete on public.messages for each row execute function public.audit_change();

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values('news-images','news-images',true,5242880,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
create policy news_images_read on storage.objects for select to anon, authenticated using(bucket_id = 'news-images');
create policy news_images_insert on storage.objects for insert to authenticated with check(bucket_id = 'news-images' and (select public.is_admin()));
create policy news_images_update on storage.objects for update to authenticated using(bucket_id = 'news-images' and (select public.is_admin())) with check(bucket_id = 'news-images' and (select public.is_admin()));
create policy news_images_delete on storage.objects for delete to authenticated using(bucket_id = 'news-images' and (select public.is_admin()));

revoke all on function public.new_profile(), public.prepare_message(), public.audit_change(), public.touch_updated_at() from public, anon, authenticated;
-- A hosted Supabase project normally has this publication already.
-- Also support fresh/self-hosted Supabase without replacing other subscriptions.
do $$
begin
  if not exists(select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    execute 'create publication supabase_realtime';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    execute 'alter publication supabase_realtime add table public.messages';
  end if;
end; $$;
-- Перевірені новини з офіційного сайту. Не змінює наявні записи.
insert into public.posts (id,slug,title,summary,body,category,kind,image_url,image_alt,source_url,published,pinned,published_at,updated_at,expires_at) values
('00000000-0000-4000-8000-000000000001','mizhnarodnyi-dialoh','Діалог, що об’єднує: про культуру та цінності','Старшокласники ліцею долучилися до міжнародної відеозустрічі з учнями України, Індії та Індонезії.','4 листопада учні 10-х та 11-х класів взяли участь у міжнародному освітньому проєкті «Глобальне покоління». Тема зустрічі — культура, переконання та цінності.

Учасники практикували англійську мову та обговорювали культурне різноманіття. Зустріч відбулася під керівництвом учителів англійської мови Ю. В. Круглякової та В. М. Штоцької.','Навчання','news','/images/dialogue.jpg','Діалог, що об’єднує: про культуру та цінності','https://lyceum86.krvo.od.ua/news/videokonferenciya-mezax-miznarodnogo-osvitnyogo-proyektu-generation-global',true,true,'2026-11-04T09:00:00+02:00','2026-11-04T09:00:00+02:00',null),
('00000000-0000-4000-8000-000000000002','radiodyktant-2026','Пишемо разом: Радіодиктант національної єдності','Учителі ліцею приєдналися до щорічного Радіодиктанту національної єдності.','27 жовтня вчителі ліцею долучилися до Радіодиктанту національної єдності 2026. Про участь повідомлено на офіційному сайті закладу.

Повідомлення першоджерела доступне за посиланням нижче.','Культура','news','/images/dictation.jpg','Пишемо разом: Радіодиктант національної єдності','https://lyceum86.krvo.od.ua/news/vciteli-liceyu-dolucilis-do-napisannya-radiodiktantu-nacionalnoyi-yednosti-2026',true,false,'2026-10-27T09:00:00+02:00','2026-10-27T09:00:00+02:00',null),
('00000000-0000-4000-8000-000000000003','den-biblioteky','День шкільної бібліотеки','У ліцеї відзначили День шкільної бібліотеки. Фотозвіт опубліковано на сайті закладу.','26 жовтня ліцей поділився новиною про День шкільної бібліотеки.

Переглянути повідомлення та фотогалерею можна в першоджерелі.','Життя ліцею','news','/images/library.jpg','День шкільної бібліотеки','https://lyceum86.krvo.od.ua/news/den-skilnoyi-biblioteki',true,false,'2026-10-26T09:00:00+02:00','2026-10-26T09:00:00+02:00',null)
on conflict (slug) do nothing;

commit;
