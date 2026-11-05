export const categories = ['Усі новини', 'Життя ліцею', 'Навчання', 'Культура', 'Безпека'] as const;
export type Category = Exclude<typeof categories[number], 'Усі новини'>;
export type Post = {
  id: string; slug: string; title: string; summary: string; body: string;
  category: Category; kind: 'news' | 'announcement'; image_url: string | null;
  image_alt: string; source_url: string | null; published: boolean; pinned: boolean;
  published_at: string; updated_at: string; expires_at: string | null;
};
export type Message = { id: string; user_id: string; display_name: string; body: string; status: 'pending' | 'approved' | 'rejected'; created_at: string };
