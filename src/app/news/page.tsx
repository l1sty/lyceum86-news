import type { Metadata } from 'next';
import { getPosts } from '@/lib/data';
import { PageHeading, EmptyState } from '@/components/ui';
import NewsExplorer from '@/components/news-explorer';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Новини', alternates: { canonical: '/news' } };
export default async function News() { const { posts, unavailable } = await getPosts(); return <div className="container page-content"><PageHeading title="Новини ліцею" description="Від маленьких відкриттів до спільних досягнень."/>{unavailable ? <EmptyState error title="Не вдалося завантажити новини" text="Спробуйте оновити сторінку."/> : <NewsExplorer posts={posts}/>}</div>; }
