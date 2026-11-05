import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getPost } from '@/lib/data';
import { formatDate } from '@/lib/content';
import { safeImage } from '@/lib/validation';
import { SourceLink } from '@/components/ui';
import ShareButton from '@/components/share-button';
type Props = { params: Promise<{ slug: string }> };
export const dynamic = 'force-dynamic';
export async function generateMetadata({ params }: Props): Promise<Metadata> { const p = await getPost((await params).slug); if (!p) return { title: 'Матеріал не знайдено' }; return { title: p.title, description: p.summary, alternates: { canonical: `/news/${p.slug}` }, openGraph: { title: p.title, description: p.summary, type: 'article', publishedTime: p.published_at, modifiedTime: p.updated_at, images: [safeImage(p.image_url)] } }; }
export default async function Article({ params }: Props) { const p = await getPost((await params).slug); if (!p) notFound(); const origin = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'; const jsonLd = { '@context': 'https://schema.org', '@type': 'NewsArticle', headline: p.title, datePublished: p.published_at, dateModified: p.updated_at, image: new URL(safeImage(p.image_url), origin).href, description: p.summary, mainEntityOfPage: `${origin}/news/${p.slug}`, author: { '@type': 'Organization', name: 'Одеський ліцей № 86' } }; return <article className="container article-page"><Link className="text-link" href={p.kind === 'announcement' ? '/announcements' : '/news'}><ArrowLeft size={16}/> {p.kind === 'announcement' ? 'До оголошень' : 'До новин'}</Link><div className="article-heading"><div className="card-meta"><span className="tag">{p.category}</span><time dateTime={p.published_at}>{formatDate(p.published_at)}</time></div><h1>{p.title}</h1><p>{p.summary}</p></div>{p.image_url && <figure className="article-image"><Image src={safeImage(p.image_url)} alt={p.image_alt} fill priority sizes="(max-width: 1000px) 100vw, 1000px"/></figure>}<div className="article-body">{p.body.split(/\n\s*\n/).map((paragraph, i) => <p key={i}>{paragraph}</p>)}{p.source_url && <div className="source-box"><p>Матеріал підготовлено за повідомленням першоджерела.</p><SourceLink url={p.source_url}/></div>}<ShareButton/></div><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}/></article>; }
