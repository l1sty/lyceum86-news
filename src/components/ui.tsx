import Link from 'next/link';
import { ArrowUpRight, Inbox, RotateCcw } from 'lucide-react';
import type { ReactNode } from 'react';
export function PageHeading({ title, description, children }: { title: string; description?: string; children?: ReactNode }) { return <div className="page-heading"><div><Link href="/" className="breadcrumb">Головна <span>/</span></Link><h1>{title}</h1>{description && <p>{description}</p>}</div>{children}</div>; }
export function EmptyState({ title, text, error = false }: { title: string; text: string; error?: boolean }) { return <div className="empty-state">{error ? <RotateCcw size={28}/> : <Inbox size={28}/>}<h3>{title}</h3><p>{text}</p>{error && <a className="text-link" href="">Спробувати ще раз <ArrowUpRight size={16}/></a>}</div>; }
export function SourceLink({ url, children = 'Переглянути першоджерело' }: { url: string; children?: ReactNode }) { return <a className="text-link" href={url} target="_blank" rel="noreferrer">{children}<ArrowUpRight size={16}/></a>; }
