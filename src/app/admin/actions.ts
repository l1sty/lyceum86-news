'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireAdmin } from '@/lib/supabase/server';
import { postSchema, safeImage } from '@/lib/validation';
export type SaveState = { error?: string; success?: string };
const uuid = z.uuid();
function refreshPosts(slug?: string) { revalidatePath('/'); revalidatePath('/news'); revalidatePath('/search'); revalidatePath('/announcements'); revalidatePath('/admin'); revalidatePath('/sitemap.xml'); if (slug) revalidatePath(`/news/${slug}`); }
export async function savePost(_previous: SaveState, form: FormData): Promise<SaveState> {
  let slug = '';
  try {
    const { db } = await requireAdmin();
    const parsed = postSchema.safeParse({ ...Object.fromEntries(form), published: form.get('published') === 'on', pinned: form.get('pinned') === 'on' });
    if (!parsed.success) return { error: 'Перевірте поля: заголовок 5–180 символів, опис 10–400, текст від 10, адреса — латиницею через дефіс. Для зображення потрібен опис.' };
    const value = parsed.data; slug = value.slug;
    if (value.image_url && safeImage(value.image_url) !== value.image_url) return { error: 'Використайте зображення, завантажене через форму.' };
    const payload = { ...value, image_url: value.image_url || null, source_url: value.source_url || null, expires_at: value.expires_at ? new Date(value.expires_at).toISOString() : null };
    const id = String(form.get('id') || '');
    if (id) {
      if (!uuid.safeParse(id).success) return { error: 'Некоректний ідентифікатор матеріалу.' };
      const { data, error } = await db.from('posts').update(payload).eq('id', id).eq('updated_at', String(form.get('updated_at'))).select('id').maybeSingle();
      if (error) return { error: error.code === '23505' ? 'Ця адреса вже використовується. Вкажіть іншу.' : 'Не вдалося зберегти матеріал. Спробуйте ще раз.' };
      if (!data) return { error: 'Матеріал уже змінено або видалено. Скопіюйте свої правки й оновіть сторінку.' };
      const oldSlug = String(form.get('old_slug') || ''); if (/^[a-z0-9-]+$/.test(oldSlug)) revalidatePath(`/news/${oldSlug}`);
    } else {
      const { error } = await db.from('posts').insert(payload);
      if (error) return { error: error.code === '23505' ? 'Ця адреса вже використовується. Вкажіть іншу.' : 'Не вдалося створити матеріал. Спробуйте ще раз.' };
    }
    refreshPosts(slug);
  } catch { return { error: 'Немає доступу або втрачено з’єднання. Увійдіть знову.' }; }
  redirect('/admin?saved=1');
}
export async function deletePost(_previous: SaveState, form: FormData): Promise<SaveState> {
  try { const { db } = await requireAdmin(); const id = String(form.get('id') || ''); if (!uuid.safeParse(id).success || form.get('confirmation') !== 'ВИДАЛИТИ') return { error: 'Для підтвердження введіть ВИДАЛИТИ.' };
    const { data, error } = await db.from('posts').delete().eq('id', id).eq('updated_at', String(form.get('updated_at'))).select('slug').maybeSingle();
    if (error || !data) return { error: 'Не вдалося видалити матеріал. Можливо, його вже змінено. Оновіть сторінку.' }; refreshPosts(data.slug);
  } catch { return { error: 'Немає доступу до видалення.' }; }
  redirect('/admin?deleted=1');
}
export async function uploadImage(form: FormData): Promise<{ url?: string; error?: string }> {
  try {
    const { db } = await requireAdmin(); const file = form.get('image');
    if (!(file instanceof File) || file.size === 0 || file.size > 5 * 1024 * 1024) return { error: 'Виберіть зображення розміром до 5 МБ.' };
    const bytes = new Uint8Array(await file.arrayBuffer());
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const png = bytes.slice(0,8).join(',') === '137,80,78,71,13,10,26,10';
    const webp = new TextDecoder().decode(bytes.slice(0,4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8,12)) === 'WEBP';
    const mime = jpeg ? 'image/jpeg' : png ? 'image/png' : webp ? 'image/webp' : '';
    if (!mime || mime !== file.type) return { error: 'Підтримуються лише справжні зображення JPEG, PNG або WebP.' };
    const path = `${crypto.randomUUID()}.${jpeg ? 'jpg' : png ? 'png' : 'webp'}`;
    const { error } = await db.storage.from('news-images').upload(path, bytes, { contentType: mime, upsert: false, cacheControl: '31536000' });
    if (error) return { error: 'Не вдалося завантажити зображення. Перевірте доступ до сховища.' };
    return { url: db.storage.from('news-images').getPublicUrl(path).data.publicUrl };
  } catch { return { error: 'Завантаження недоступне. Увійдіть знову.' }; }
}
export async function moderate(_previous: SaveState, form: FormData): Promise<SaveState> {
  try {
    const { db } = await requireAdmin(); const id = String(form.get('id') || ''); const action = String(form.get('action'));
    if (!uuid.safeParse(id).success) return { error: 'Некоректний запис.' };
    if (action === 'approved' || action === 'rejected') {
      const { error, data } = await db.from('messages').update({ status: action }).eq('id',id).select('id').maybeSingle(); if (error || !data) return { error: 'Повідомлення не знайдено або його не вдалося змінити.' };
    } else if (action === 'dismiss') {
      const { error } = await db.from('message_reports').delete().eq('id',id); if (error) return { error: 'Не вдалося закрити скаргу.' };
    } else if (action === 'ban') {
      const reason = String(form.get('reason') || '').trim(); if (reason.length < 3 || reason.length > 300) return { error: 'Вкажіть причину обмеження: від 3 до 300 символів.' };
      const { error } = await db.from('chat_bans').upsert({ user_id: id, reason, expires_at: new Date(Date.now() + 86400000).toISOString() }); if (error) return { error: 'Не вдалося обмежити надсилання.' };
    } else if (action === 'unban') { const { error } = await db.from('chat_bans').delete().eq('user_id', id); if (error) return { error: 'Не вдалося зняти обмеження.' }; }
    else return { error: 'Невідома дія.' };
    revalidatePath('/admin/moderation'); revalidatePath('/chat'); return { success: 'Зміни збережено.' };
  } catch { return { error: 'Немає доступу або втрачено з’єднання.' }; }
}
