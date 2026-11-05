import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { configured, supabaseKey, supabaseUrl } from '@/lib/supabase/config';
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  if (!configured) return response;
  const db = createServerClient(supabaseUrl, supabaseKey, { cookies: {
    getAll: () => request.cookies.getAll(),
    setAll: values => { values.forEach(({ name, value }) => request.cookies.set(name, value)); response = NextResponse.next({ request }); values.forEach(({ name, value, options }) => response.cookies.set(name, value, options)); },
  } });
  const { data: { user } } = await db.auth.getUser();
  if (request.nextUrl.pathname.startsWith('/admin') && !user) {
    const target = new URL('/auth', request.url); target.searchParams.set('next', request.nextUrl.pathname);
    const login = NextResponse.redirect(target); response.cookies.getAll().forEach(cookie => login.cookies.set(cookie));
    login.headers.set('Cache-Control', 'private, no-store'); return login;
  }
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
export const config = { matcher: ['/admin/:path*', '/chat', '/auth/:path*'] };
