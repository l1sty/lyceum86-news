import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { serverClient } from '@/lib/supabase/server';
import { PageHeading, EmptyState } from '@/components/ui';
import ChatRoom from '@/components/chat-room';
import { signOut } from '@/app/auth/actions';
import type { Message } from '@/lib/types';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Чат ліцею', robots: { index: false, follow: false } };
export default async function Chat() { const db = await serverClient(); const user = db ? (await db.auth.getUser()).data.user : null; let messages: Message[] = []; let unavailable = false;
  if (db && user) { const { data, error } = await db.from('messages').select('*').order('created_at', { ascending: false }).limit(100); messages = (data || []).reverse() as Message[]; unavailable = Boolean(error); }
  return <div className="container page-content"><PageHeading title="Чат ліцею" description="Спільні питання. Корисні відповіді. Живе спілкування.">{user && <form action={signOut}><button className="button button-outline button-small">Вийти</button></form>}</PageHeading><div className="chat-layout"><div>{!db ? <EmptyState title="Чат тимчасово недоступний" text="Спробуйте повернутися пізніше. Контакти ліцею доступні у відповідному розділі."/> : !user ? <div className="empty-state"><ShieldCheck/><h3>Розмова у колі спільноти</h3><p>Для читання та надсилання повідомлень увійдіть до облікового запису.</p><Link className="button button-dark mt-6" href="/auth?next=/chat">Увійти до чату</Link></div> : unavailable ? <EmptyState error title="Чат тимчасово недоступний" text="Не вдалося завантажити повідомлення. Спробуйте пізніше."/> : <ChatRoom userId={user.id} initialMessages={messages}/>}</div><aside className="chat-rules"><ShieldCheck size={28}/><h2>Місце для поваги</h2><p>Спілкуйтеся доброзичливо та по суті. Тут можна поставити питання або поділитися ідеєю.</p><p>Повідомлення з’являються для всіх після перевірки модератором.</p><p>Не публікуйте особисті дані дітей, адреси чи номери телефонів.</p><Link className="text-link" href="/privacy">Правила спілкування</Link></aside></div></div>;
}
