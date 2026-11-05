import { readFile, writeFile } from 'node:fs/promises';
import { verifiedPosts } from '../src/lib/content';
const quote = (value: unknown) => value === null ? 'null' : typeof value === 'boolean' ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
const columns = ['id','slug','title','summary','body','category','kind','image_url','image_alt','source_url','published','pinned','published_at','updated_at','expires_at'] as const;
const seed = '-- Перевірені новини з офіційного сайту. Не змінює наявні записи.\ninsert into public.posts (' + columns.join(',') + ') values\n' + verifiedPosts.map(p => '('+columns.map(c => quote(p[c])).join(',')+')').join(',\n') + '\non conflict (slug) do nothing;\n';
await writeFile('supabase/seed.sql',seed);
const migration = await readFile('supabase/migrations/202611060001_initial.sql','utf8');
if (!/commit;\s*$/i.test(migration)) throw new Error('Migration must end with COMMIT.');
// Schema and initial content either commit together or roll back together.
await writeFile('supabase/setup.sql',migration.replace(/commit;\s*$/i, seed + '\ncommit;\n'));
console.log('Створено supabase/setup.sql та supabase/seed.sql.');
