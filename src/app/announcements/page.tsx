import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowUpRight, Pin } from 'lucide-react';
import { getPosts } from '@/lib/data';
import { formatDate } from '@/lib/content';
import { EmptyState, PageHeading } from '@/components/ui';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Оголошення', alternates: { canonical: '/announcements' } };
export default async function Announcements() { const { posts, unavailable } = await getPosts('announcement'); return <div className="container page-content"><PageHeading title="Важливо знати" description="Оголошення адміністрації для ліцейної спільноти."/>{unavailable ? <EmptyState error title="Оголошення недоступні" text="Спробуйте оновити сторінку."/> : posts.length ? <div className="announcement-list">{posts.map(p => <Link href={`/news/${p.slug}`} key={p.id}><div><span className="tag">{p.pinned ? <><Pin size={13}/> Закріплено</> : p.category}</span><time dateTime={p.published_at}>{formatDate(p.published_at)}</time></div><h2>{p.title}</h2><p>{p.summary}</p><ArrowUpRight size={24}/></Link>)}</div> : <EmptyState title="Актуальних оголошень поки немає" text="Коли адміністрація опублікує повідомлення, воно з’явиться на цій сторінці."/>}</div>; }
