import { type NextRequest, NextResponse } from 'next/server';
import { serverClient } from '@/lib/supabase/server';
import { safeRedirect } from '@/lib/validation';
export async function GET(request: NextRequest) {
  const url = new URL(request.url); const hash = url.searchParams.get('token_hash'); const type = url.searchParams.get('type'); const code = url.searchParams.get('code');
  const db = await serverClient();
  if (db && hash && (type === 'signup' || type === 'recovery' || type === 'email')) {
    const { error } = await db.auth.verifyOtp({ token_hash: hash, type });
    if (!error) return NextResponse.redirect(new URL(type === 'recovery' ? '/auth/password' : safeRedirect(url.searchParams.get('next')), url.origin));
  } else if (db && code) { const { error } = await db.auth.exchangeCodeForSession(code); if (!error) return NextResponse.redirect(new URL(safeRedirect(url.searchParams.get('next')), url.origin)); }
  return NextResponse.redirect(new URL('/auth?error=link', url.origin));
}
