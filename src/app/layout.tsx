import type { Metadata } from 'next';
import '@fontsource-variable/manrope';
import './globals.css';
import Header from '@/components/header';
import Footer from '@/components/footer';
export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'),
  title: { default: 'Одеський ліцей № 86 — новини та спільнота', template: '%s | Одеський ліцей № 86' },
  description: 'Новини Одеського ліцею № 86, оголошення, контакти та простір спілкування ліцейної спільноти.',
  openGraph: { locale: 'uk_UA', type: 'website', siteName: 'Одеський ліцей № 86', images: [{ url: '/images/facade.jpg', alt: 'Будівля Одеського ліцею № 86' }] },
  twitter: { card: 'summary_large_image' },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="uk"><body><a className="skip-link" href="#main">Перейти до вмісту</a><Header/><main id="main">{children}</main><Footer/></body></html>; }
