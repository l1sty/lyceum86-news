import Link from 'next/link';
export default function NotFound() { return <div className="container error-page"><span className="error-number">404</span><h1>Ця сторінка не знайшлася</h1><p>Можливо, адресу змінено або матеріал ще не опубліковано.</p><Link href="/" className="button button-dark">На головну</Link></div>; }
