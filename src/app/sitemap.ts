import type { MetadataRoute } from 'next';
import { getPosts } from '@/lib/data';
export const dynamic = 'force-dynamic';
export default async function sitemap(): Promise<MetadataRoute.Sitemap> { const base = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'; const results = await Promise.all([getPosts(), getPosts('announcement')]); return [...['', '/news','/announcements','/about','/contacts','/privacy'].map(path => ({ url: `${base}${path}` })), ...results.flatMap(r => r.posts).map(p => ({ url: `${base}/news/${p.slug}`, lastModified: p.updated_at }))]; }
