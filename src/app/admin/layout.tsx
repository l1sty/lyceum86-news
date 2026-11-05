import Link from 'next/link';
import { redirect } from 'next/navigation';
import { serverClient } from '@/lib/supabase/server';
import { PageHeading, EmptyState } from '@/components/ui';
import { signOut } from '@/app/auth/actions';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Адміністрування', robots: { index: false, follow: false } };
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const db = await serverClient(); if (!db) return <div className="container page-content"><EmptyState title="Кабінет тимчасово недоступний" text="Спробуйте повернутися пізніше."/></div>;
  const { data: { user } } = await db.auth.getUser(); if (!user) redirect('/auth?next=/admin');
  const { data, error } = await db.rpc('is_admin');
  if (error || data !== true) return <div className="container page-content"><EmptyState title="Доступ лише для адміністрації" text="Ваш обліковий запис не має прав керування сайтом. Зверніться до адміністратора."/><form action={signOut} className="mt-5"><button className="button button-outline">Вийти з облікового запису</button></form></div>;
  return <div className="container page-content"><PageHeading title="Кабінет адміністрації" description="Публікації, оголошення та безпечне спілкування."><form action={signOut}><button className="button button-outline button-small">Вийти</button></form></PageHeading><nav className="admin-nav" aria-label="Керування сайтом"><Link href="/admin">Публікації</Link><Link href="/admin/posts/new">Створити матеріал</Link><Link href="/admin/moderation">Модерація чату</Link></nav>{children}</div>;
}
