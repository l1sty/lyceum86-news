'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowUpRight, Menu, Search, X } from 'lucide-react';
const links = [['/', 'Головна'], ['/news', 'Новини'], ['/announcements', 'Оголошення'], ['/about', 'Про ліцей'], ['/contacts', 'Контакти']];
export function Brand() { return <Link href="/" className="brand" aria-label="Одеський ліцей № 86 — головна"><span className="brand-mark">86<span /></span><span>Одеський ліцей<span className="brand-sub">Вчимося. Діємо. Зростаємо.</span></span></Link>; }
export default function Header() {
  const path = usePathname(); const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => { const close = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); }; document.addEventListener('keydown', close); return () => document.removeEventListener('keydown', close); }, []);
  return <header className="site-header"><div className="container header-inner"><Brand />
    <nav aria-label="Головна навігація" className="desktop-nav">{links.map(([url, title]) => <Link key={url} href={url} aria-current={(url === '/' ? path === '/' : path.startsWith(url)) ? 'page' : undefined}>{title}</Link>)}</nav>
    <div className="header-actions"><Link href="/search" className="icon-button" aria-label="Пошук"><Search size={20} /></Link><Link href="/chat" className="button button-dark header-chat">Чат ліцею <ArrowUpRight size={16} /></Link><button className="icon-button mobile-toggle" aria-label={open ? 'Закрити меню' : 'Відкрити меню'} aria-expanded={open} aria-controls="mobile-nav" onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</button></div>
    {open && <nav className="mobile-nav" id="mobile-nav" aria-label="Мобільна навігація">{[...links, ['/chat','Чат ліцею']].map(([url, title]) => <Link key={url} href={url} aria-current={path === url ? 'page' : undefined}>{title}</Link>)}</nav>}
  </div></header>;
}
