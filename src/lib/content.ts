import type { Post } from './types';
export const school = {
  name: 'Одеський ліцей № 86', fullName: 'Одеський ліцей № 86 Одеської міської ради',
  address: '65122, м. Одеса, вул. Євгена Чикаленка, 79', phone: '(093) 545 13 82',
  director: 'Шакіна Валентина Миколаївна', website: 'https://lyceum86.krvo.od.ua',
  source: 'https://lyceum86.krvo.od.ua/about/kontaktna-informaciya', verified: '6 листопада 2026 року',
};
const entries = [
  { slug: 'mizhnarodnyi-dialoh', title: 'Діалог, що об’єднує: про культуру та цінності', summary: 'Старшокласники ліцею долучилися до міжнародної відеозустрічі з учнями України, Індії та Індонезії.', body: '4 листопада учні 10-х та 11-х класів взяли участь у міжнародному освітньому проєкті «Глобальне покоління». Тема зустрічі — культура, переконання та цінності.\n\nУчасники практикували англійську мову та обговорювали культурне різноманіття. Зустріч відбулася під керівництвом учителів англійської мови Ю. В. Круглякової та В. М. Штоцької.', category: 'Навчання', date: '2026-11-04', image: 'dialogue', source: 'videokonferenciya-mezax-miznarodnogo-osvitnyogo-proyektu-generation-global' },
  { slug: 'radiodyktant-2026', title: 'Пишемо разом: Радіодиктант національної єдності', summary: 'Учителі ліцею приєдналися до щорічного Радіодиктанту національної єдності.', body: '27 жовтня вчителі ліцею долучилися до Радіодиктанту національної єдності 2026. Про участь повідомлено на офіційному сайті закладу.\n\nПовідомлення першоджерела доступне за посиланням нижче.', category: 'Культура', date: '2026-10-27', image: 'dictation', source: 'vciteli-liceyu-dolucilis-do-napisannya-radiodiktantu-nacionalnoyi-yednosti-2026' },
  { slug: 'den-biblioteky', title: 'День шкільної бібліотеки', summary: 'У ліцеї відзначили День шкільної бібліотеки. Фотозвіт опубліковано на сайті закладу.', body: '26 жовтня ліцей поділився новиною про День шкільної бібліотеки.\n\nПереглянути повідомлення та фотогалерею можна в першоджерелі.', category: 'Життя ліцею', date: '2026-10-26', image: 'library', source: 'den-skilnoyi-biblioteki' },
] as const;
export const verifiedPosts: Post[] = entries.map((item, i) => ({
  id: `00000000-0000-4000-8000-00000000000${i+1}`, slug: item.slug, title: item.title,
  summary: item.summary, body: item.body, category: item.category, kind: 'news',
  image_url: `/images/${item.image}.jpg`, image_alt: item.title, source_url: `${school.website}/news/${item.source}`,
  published: true, pinned: i === 0, published_at: `${item.date}T09:00:00+02:00`,
  updated_at: `${item.date}T09:00:00+02:00`, expires_at: null,
}));
export function formatDate(value: string) { return new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Kyiv' }).format(new Date(value)); }
