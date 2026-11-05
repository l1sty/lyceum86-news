import type { Metadata } from 'next';
import { getPosts } from '@/lib/data';
import { PageHeading, EmptyState } from '@/components/ui';
import NewsExplorer from '@/components/news-explorer';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Пошук', robots: { index: false, follow: true } };
export default async function Search({ searchParams }: { searchParams: Promise<{ q?: string }> }) { const [news, announcements, params] = await Promise.all([getPosts(), getPosts('announcement'), searchParams]); return <div className="container page-content"><PageHeading title="Знайдімо потрібне" description="Шукайте серед новин та оголошень ліцею."/>{news.unavailable || announcements.unavailable ? <EmptyState error title="Пошук тимчасово недоступний" text="Спробуйте знову пізніше."/> : <NewsExplorer posts={[...news.posts, ...announcements.posts]} initialQuery={params.q?.slice(0,200) || ''} search/>}</div>; }
