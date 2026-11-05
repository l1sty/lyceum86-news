import { requireAdmin } from '@/lib/supabase/server';
import PostEditor from '@/components/post-editor';
export default async function NewPost() { await requireAdmin(); return <PostEditor/>; }
