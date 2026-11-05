import { createClient } from '@supabase/supabase-js';
import { configured, supabaseKey, supabaseUrl } from './supabase/config';
import { verifiedPosts } from './content';
import type { Post } from './types';
export async function getPosts(kind: Post['kind'] = 'news'): Promise<{ posts: Post[]; unavailable: boolean }> {
  if (!configured) return { posts: kind === 'news' ? verifiedPosts : [], unavailable: false };
  const db = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (url, init) => fetch(url, { ...init, cache: 'no-store' }) } });
  const { data, error } = await db.from('posts').select('*').eq('kind', kind).eq('published', true).lte('published_at', new Date().toISOString()).or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`).order('pinned', { ascending: false }).order('published_at', { ascending: false }).limit(500);
  return { posts: (data || []) as Post[], unavailable: Boolean(error) };
}
export async function getPost(slug: string) {
  if (!configured) return verifiedPosts.find(p => p.slug === slug) || null;
  const db = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.from('posts').select('*').eq('slug', slug).eq('published', true).maybeSingle();
  if (error) throw new Error('Не вдалося завантажити матеріал.');
  return data as Post | null;
}
