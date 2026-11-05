import { MessageCircle } from 'lucide-react';
import { AuthForm } from '@/components/auth-form';
import { configured } from '@/lib/supabase/config';
import { safeRedirect } from '@/lib/validation';
export const metadata = { title: 'Вхід до спільноти', robots: { index: false, follow: false } };
export default async function Auth({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) { const params = await searchParams; return <div className="container"><div className="auth-layout"><div className="auth-intro"><MessageCircle size={38}/><h1>Свої люди.<br/>Спільні розмови.</h1><p>Увійдіть, щоб долучитися до чату ліцею. Нові повідомлення проходять модерацію — так спілкування залишається комфортним для всіх.</p>{params.error && <p className="mt-5">Посилання підтвердження недійсне або застаріло. Спробуйте відновити пароль.</p>}</div><AuthForm enabled={configured} next={safeRedirect(params.next || null)}/></div></div>; }
