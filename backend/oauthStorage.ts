import { createClient } from '@supabase/supabase-js';
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const bucket = 'private-google-oauth';
function store() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Set server SUPABASE_URL and SUPABASE_SECRET_KEY to enable permanent Google connection storage.');
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}).storage;
}
function encryptionKey() {
  const secret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  if (!secret) throw new Error('Google OAuth client secret missing.');
  return createHash('sha256').update(secret).digest();
}
export function checkOAuthStorage() { store(); }
export async function saveRefreshToken(token: string, objectName = 'drive-token.enc') {
  const storage = store();
  const exists = await storage.getBucket(bucket);
  if (exists.error) {
    const created = await storage.createBucket(bucket,{public:false});
    if(created.error && (await storage.getBucket(bucket)).error) throw new Error('Could not initialize private Google credential storage.');
  } else if (exists.data.public) throw new Error('Google credential bucket must be private.');
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm',encryptionKey(),iv);
  const payload = Buffer.concat([iv,cipher.update(token,'utf8'),cipher.final(),cipher.getAuthTag()]);
  const result = await storage.from(bucket).upload(objectName,payload,{upsert:true,contentType:'application/octet-stream'});
  if(result.error) throw new Error('Could not save Google authorization to private storage.');
}
export async function readRefreshToken(objectName = 'drive-token.enc') {
  if (!process.env.SUPABASE_SECRET_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY) return objectName === 'drive-token.enc' ? process.env.GOOGLE_DRIVE_REFRESH_TOKEN || '' : '';
  const result = await store().from(bucket).download(objectName);
  if(result.error) {
    if (String(result.error.statusCode) === '404' || /not found|does not exist/i.test(result.error.message))
      return objectName === 'drive-token.enc' ? process.env.GOOGLE_DRIVE_REFRESH_TOKEN || '' : '';
    throw new Error('Google credential storage is unavailable.');
  }
  const data = Buffer.from(await result.data.arrayBuffer());
  const decipher = createDecipheriv('aes-256-gcm',encryptionKey(),data.subarray(0,12));
  decipher.setAuthTag(data.subarray(-16));
  return Buffer.concat([decipher.update(data.subarray(12,-16)),decipher.final()]).toString('utf8');
}
