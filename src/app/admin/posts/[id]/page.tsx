import { notFound } from 'next/navigation';
import { z } from 'zod';
import { requireAdmin } from '@/lib/supabase/server';
import PostEditor from '@/components/post-editor';
import type { Post } from '@/lib/types';
export default async function EditPost({ params }: { params: Promise<{ id: string }> }) { const { db } = await requireAdmin(); const { id } = await params; if (!z.uuid().safeParse(id).success) notFound(); const { data, error } = await db.from('posts').select('*').eq('id',id).maybeSingle(); if (error) throw new Error('Не вдалося завантажити матеріал.'); if (!data) notFound(); return <PostEditor post={data as Post}/>; }
