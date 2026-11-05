'use server';
import { z } from 'zod';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { serverClient } from '@/lib/supabase/server';
import { passwordSchema, safeRedirect } from '@/lib/validation';
export type AuthState = { error?: string; success?: string };
export async function authenticate(_previous: AuthState, form: FormData): Promise<AuthState> {
  const db = await serverClient(); if (!db) return { error: 'Вхід тимчасово недоступний. Спробуйте пізніше.' };
  const mode = String(form.get('mode')); const email = String(form.get('email') || '').trim(); const password = String(form.get('password') || '');
  if (!z.email().safeParse(email).success) return { error: 'Вкажіть коректну електронну адресу.' };
  if (mode === 'reset') {
    const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/auth/confirm?next=/auth/password` });
    return error ? { error: 'Не вдалося надіслати лист. Зачекайте та спробуйте ще раз.' } : { success: 'Якщо обліковий запис існує, на цю адресу надійде лист для відновлення пароля.' };
  }
  if (mode === 'signup') {
    const name = String(form.get('display_name') || '').trim();
    if (name.length < 2 || name.length > 60) return { error: 'Ім’я має містити від 2 до 60 символів.' };
    if (!passwordSchema.safeParse(password).success) return { error: 'Пароль має містити від 12 до 128 символів.' };
    if (form.get('consent') !== 'on') return { error: 'Ознайомтеся з правилами спілкування та приватності.' };
    const { error } = await db.auth.signUp({ email, password, options: { data: { display_name: name }, emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/auth/confirm` } });
    return error ? { error: 'Не вдалося створити обліковий запис. Перевірте дані або спробуйте пізніше.' } : { success: 'Перевірте пошту та підтвердьте адресу за посиланням у листі. Якщо ви вже реєструвалися, увійдіть або відновіть пароль.' };
  }
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) return { error: 'Не вдалося увійти. Перевірте адресу, пароль і підтвердження пошти.' };
  revalidatePath('/', 'layout'); redirect(safeRedirect(String(form.get('next') || '/chat')));
}
export async function signOut() { const db = await serverClient(); if (db) await db.auth.signOut(); revalidatePath('/', 'layout'); redirect('/auth'); }
export async function changePassword(_previous: AuthState, form: FormData): Promise<AuthState> {
  const password = String(form.get('password') || '');
  if (!passwordSchema.safeParse(password).success) return { error: 'Пароль має містити від 12 до 128 символів.' };
  if (password !== form.get('confirmation')) return { error: 'Паролі не збігаються.' };
  const db = await serverClient(); if (!db) return { error: 'Сервіс тимчасово недоступний.' };
  const { data: { user } } = await db.auth.getUser(); if (!user) return { error: 'Посилання недійсне або застаріло. Запросіть новий лист для відновлення.' };
  const { error } = await db.auth.updateUser({ password });
  return error ? { error: 'Не вдалося змінити пароль. Спробуйте інший або запросіть новий лист.' } : { success: 'Пароль змінено. Можна перейти до чату.' };
}
