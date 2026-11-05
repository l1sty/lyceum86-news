import Image from 'next/image';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import type { Post } from '@/lib/types';
import { formatDate } from '@/lib/content';
import { safeImage } from '@/lib/validation';
export default function NewsCard({ post, featured = false }: { post: Post; featured?: boolean }) { return <article className={`news-card ${featured ? 'featured-card' : ''}`}><Link href={`/news/${post.slug}`} className="news-image" tabIndex={-1} aria-hidden="true"><Image src={safeImage(post.image_url)} alt={post.image_alt} fill sizes={featured ? '(max-width: 700px) 100vw, 65vw' : '(max-width: 700px) 100vw, 33vw'} /></Link><div className="card-meta"><span className="tag">{post.category}</span><time dateTime={post.published_at}>{formatDate(post.published_at)}</time></div><h3><Link href={`/news/${post.slug}`}>{post.title}<ArrowUpRight className="card-arrow" size={21}/></Link></h3><p>{post.summary}</p></article>; }
