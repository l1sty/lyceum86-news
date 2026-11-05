import Link from 'next/link';
import { Pencil, Plus } from 'lucide-react';
import { requireAdmin } from '@/lib/supabase/server';
import { formatDate } from '@/lib/content';
import { EmptyState } from '@/components/ui';
import type { Post } from '@/lib/types';
export default async function Admin({ searchParams }: { searchParams: Promise<{ saved?: string; deleted?: string; page?: string }> }) {
  const { db } = await requireAdmin(); const params = await searchParams; const page = Math.max(1, Number(params.page) || 1);
  const [posts, pending, announcements] = await Promise.all([
    db.from('posts').select('*',{count:'exact'}).order('published_at',{ascending:false}).range((page-1)*30,page*30-1),
    db.from('messages').select('id',{count:'exact',head:true}).eq('status','pending'),
    db.from('posts').select('id',{count:'exact',head:true}).eq('kind','announcement'),
  ]);
  return <>{params.saved && <p className="form-status mb-5" role="status">Матеріал збережено.</p>}{params.deleted && <p className="form-status mb-5" role="status">Матеріал видалено.</p>}<div className="admin-summary"><div><strong>{posts.count ?? '—'}</strong><span>Матеріалів загалом</span></div><div><strong>{announcements.count ?? '—'}</strong><span>Оголошень</span></div><div><strong>{pending.count ?? '—'}</strong><span>Повідомлень на перевірці</span></div></div><div className="section-heading"><h2>Усі матеріали</h2><Link href="/admin/posts/new" className="button button-dark button-small"><Plus size={15}/> Створити</Link></div>{posts.error ? <EmptyState error title="Не вдалося завантажити матеріали" text="Перевірте з’єднання та оновіть сторінку."/> : posts.data?.length ? posts.data.map((p: Post) => <div key={p.id} className="admin-post"><div><span className="tag">{p.kind === 'announcement' ? 'Оголошення' : p.category}</span><h2>{p.title}</h2><p>{p.published ? 'Опубліковано' : 'Чернетка'} · {formatDate(p.published_at)}</p></div><Link className="button button-outline button-small" href={`/admin/posts/${p.id}`}><Pencil size={14}/> Редагувати</Link></div>) : <EmptyState title="Почніть із першої публікації" text="Створіть новину або оголошення. Можна зберегти чернетку й опублікувати її пізніше."/>}<div className="editor-actions mt-6">{page > 1 && <Link className="button button-outline button-small" href={`/admin?page=${page-1}`}>Попередня сторінка</Link>}{(posts.count || 0) > page*30 && <Link className="button button-outline button-small" href={`/admin?page=${page+1}`}>Наступна сторінка</Link>}</div></>;
}
