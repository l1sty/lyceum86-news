import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { configured, supabaseKey, supabaseUrl } from './config';
export async function serverClient() {
  if (!configured) return null;
  const jar = await cookies();
  return createServerClient(supabaseUrl, supabaseKey, { cookies: {
    getAll: () => jar.getAll(),
    setAll: values => { try { values.forEach(({ name, value, options }) => jar.set(name, value, options)); } catch { /* Proxy refreshes cookies for server components. */ } },
  } });
}
export async function requireAdmin() {
  const db = await serverClient(); if (!db) throw new Error('Сервіс недоступний.');
  const { data: { user } } = await db.auth.getUser();
  if (!user) throw new Error('Увійдіть до облікового запису.');
  const { data, error } = await db.rpc('is_admin');
  if (error || data !== true) throw new Error('Недостатньо прав доступу.');
  return { db, user };
}
