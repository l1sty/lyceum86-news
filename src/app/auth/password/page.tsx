import { PasswordForm } from '@/components/auth-form';
import { LockKeyhole } from 'lucide-react';
export const metadata = { title: 'Зміна пароля', robots: { index: false, follow: false } };
export default function Password() { return <div className="container"><div className="auth-layout"><div className="auth-intro"><LockKeyhole size={38}/><h1>Новий пароль.<br/>Ваш простір.</h1><p>Виберіть унікальний пароль довжиною від 12 символів.</p></div><PasswordForm/></div></div>; }
