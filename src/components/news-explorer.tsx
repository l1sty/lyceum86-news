'use client';
import { useState } from 'react';
import { Search, X } from 'lucide-react';
import { categories, type Post } from '@/lib/types';
import NewsCard from './news-card';
import { EmptyState } from './ui';
export default function NewsExplorer({ posts, initialQuery = '', search = false }: { posts: Post[]; initialQuery?: string; search?: boolean }) {
  const [category, setCategory] = useState<string>('Усі новини'); const [query, setQuery] = useState(initialQuery); const [limit, setLimit] = useState(9);
  const normalized = query.trim().toLocaleLowerCase('uk-UA');
  const filtered = posts.filter(p => (category === 'Усі новини' || p.category === category) && (!normalized || `${p.title} ${p.summary} ${p.body}`.toLocaleLowerCase('uk-UA').includes(normalized)));
  return <><div className={`explorer-toolbar ${search ? 'search-toolbar' : ''}`}><div className="filters" role="group" aria-label="Категорії новин">{categories.map(c => <button key={c} aria-pressed={category === c} onClick={() => { setCategory(c); setLimit(9); }}>{c}</button>)}</div><div className="search-field"><Search size={18}/><input type="search" aria-label="Пошук матеріалів" placeholder="Знайти цікаве…" value={query} onChange={e => { setQuery(e.target.value); setLimit(9); }}/>{query && <button className="icon-button" aria-label="Очистити пошук" onClick={() => setQuery('')}><X size={16}/></button>}</div></div><p className="results-count" role="status">{filtered.length ? `Знайдено матеріалів: ${filtered.length}` : 'За цим запитом немає матеріалів'}</p>{filtered.length ? <div className="news-grid">{filtered.slice(0,limit).map(post => <NewsCard post={post} key={post.id}/>)}</div> : <EmptyState title="Спробуйте інший запит" text="Змініть пошукові слова або виберіть іншу категорію."/>}{filtered.length > limit && <div className="load-more"><button className="button button-outline" onClick={() => setLimit(limit + 9)}>Показати ще</button></div>}</>;
}
