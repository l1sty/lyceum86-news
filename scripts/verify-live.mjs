import {createClient} from '@supabase/supabase-js';
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const db=createClient(url,key,{auth:{persistSession:false}});
for(const table of ['posts','profiles','admin_users','messages','chat_bans','message_reports','audit_log','message_rate_log']){const {data,error}=await db.from(table).select('*').limit(5);console.log(table, error?error.code+': '+error.message:'OK rows='+data.length);}
const {data:posts}=await db.from('posts').select('slug,image_url');
console.log('posts',posts);
for(const [name,operation] of [['admin escalation',()=>db.from('admin_users').insert({user_id:crypto.randomUUID()})],['post write',()=>db.from('posts').insert({title:'Unauthorized'})],['storage upload',()=>db.storage.from('news-images').upload('unauthorized-probe.txt',new Blob(['probe']),{contentType:'text/plain'})]]){const {error}=await operation(); console.log(name,error?'DENIED':'UNEXPECTED SUCCESS');}
const channel=db.channel('verification-readonly').on('postgres_changes',{event:'*',schema:'public',table:'messages'},()=>{});
await new Promise(resolve=>{const timer=setTimeout(()=>resolve(null),12000);channel.subscribe(status=>{console.log('realtime',status);if(status==='SUBSCRIBED'||status==='CHANNEL_ERROR'){clearTimeout(timer);resolve(null);}})});
await db.removeChannel(channel);
const r=await fetch(url+'/storage/v1/object/public/news-images/nonexistent-verification.jpg');console.log('storage endpoint',r.status,await r.text());
