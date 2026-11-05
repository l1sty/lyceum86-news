import test from 'node:test';
import assert from 'node:assert/strict';
import { messageSchema, postSchema, safeRedirect, safeImage, passwordSchema } from '../src/lib/validation';
import { verifiedPosts } from '../src/lib/content';
test('rejects unsafe redirect targets', () => { for (const url of ['https://evil.test','//evil.test','/\\evil.test','/\r\nevil']) assert.equal(safeRedirect(url), '/chat'); assert.equal(safeRedirect('/admin/posts'), '/admin/posts'); });
test('restricts image origins and rejects active content', () => { assert.equal(safeImage('javascript:alert(1)'), '/images/facade.jpg'); assert.equal(safeImage('https://evil.test/track.png'), '/images/facade.jpg'); assert.equal(safeImage('/images/library.jpg'), '/images/library.jpg'); });
test('validates publication data and accessible images', () => { const p = { ...verifiedPosts[0], source_url: verifiedPosts[0].source_url!, image_url: verifiedPosts[0].image_url!, expires_at: '' }; assert.equal(postSchema.safeParse(p).success,true); assert.equal(postSchema.safeParse({...p, source_url:'javascript:alert(1)'}).success,false); assert.equal(postSchema.safeParse({...p,image_alt:''}).success,false); assert.equal(postSchema.safeParse({...p,slug:'../admin'}).success,false); });
test('enforces chat and password limits', () => { assert.equal(messageSchema.safeParse('   ').success,false); assert.equal(messageSchema.safeParse('x'.repeat(1501)).success,false); assert.equal(messageSchema.parse(' Привіт! '),'Привіт!'); assert.equal(passwordSchema.safeParse('short').success,false); });
