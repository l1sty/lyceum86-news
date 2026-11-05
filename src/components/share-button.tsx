'use client';
import { useState } from 'react';
import { Share2 } from 'lucide-react';
export default function ShareButton() { const [status, setStatus] = useState(''); return <div><button className="button button-outline" onClick={async () => { try { if (navigator.share) await navigator.share({ title: document.title, url: location.href }); else { await navigator.clipboard.writeText(location.href); setStatus('Посилання скопійовано.'); } } catch { setStatus('Посилання можна скопіювати з адресного рядка.'); } }}><Share2 size={16}/> Поділитися</button><p role="status">{status}</p></div>; }
