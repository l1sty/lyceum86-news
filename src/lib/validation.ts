import { z } from 'zod';
export const postSchema = z.object({
  title: z.string().trim().min(5).max(180), slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120),
  summary: z.string().trim().min(10).max(400), body: z.string().trim().min(10).max(30000),
  category: z.enum(['Життя ліцею','Навчання','Культура','Безпека']), kind: z.enum(['news','announcement']),
  image_url: z.string().refine(v => !v || /^\/images\/[a-z0-9-]+\.jpg$/.test(v) || /^https:\/\//.test(v)),
  image_alt: z.string().max(200), source_url: z.union([z.literal(''), z.url().refine(v => new URL(v).protocol === 'https:')]),
  published: z.boolean(), pinned: z.boolean(), expires_at: z.string().refine(v => !v || !Number.isNaN(Date.parse(v))),
}).refine(v => !v.image_url || v.image_alt.trim().length > 2, { path: ['image_alt'], message: 'Додайте опис зображення.' });
export const messageSchema = z.string().trim().min(1).max(1500);
export const passwordSchema = z.string().min(12).max(128);
export function safeRedirect(value: string | null) { return value && value.startsWith('/') && !value.startsWith('//') && !/[\\\r\n]/.test(value) ? value : '/chat'; }
export function safeImage(value: string | null) { if (!value) return '/images/facade.jpg'; if (/^\/images\/[a-z0-9-]+\.jpg$/.test(value)) return value; try { const u = new URL(value); return u.protocol === 'https:' && (u.hostname.endsWith('.supabase.co') || u.origin === new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://invalid.local').origin) ? value : '/images/facade.jpg'; } catch { return '/images/facade.jpg'; } }
