import type { Express, RequestHandler } from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function registerDriveOAuth(app: Express, admin: RequestHandler) {
  const attempts = new Map<string, { cookie: string; expires: number; redirect: string }>();
  app.get('/api/admin/drive', admin, (_req,res) => res.json({
    configured: !!(process.env.GOOGLE_DRIVE_CLIENT_ID && process.env.GOOGLE_DRIVE_CLIENT_SECRET),
    connected: !!process.env.GOOGLE_DRIVE_REFRESH_TOKEN,
    redirectUri: process.env.GOOGLE_DRIVE_REDIRECT_URI || '',
    folder: process.env.GOOGLE_DRIVE_FOLDER_URL || '',
    sheet: process.env.GOOGLE_QUESTIONS_SPREADSHEET_URL || '',
  }));
  app.post('/api/admin/drive/connect', admin, (_req,res) => {
    const client = process.env.GOOGLE_DRIVE_CLIENT_ID;
    const secret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
    const redirect = process.env.GOOGLE_DRIVE_REDIRECT_URI;
    if (!client || !secret || !redirect) return res.status(400).json({error:'Set GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET and GOOGLE_DRIVE_REDIRECT_URI in .env first.'});
    for (const [key,value] of attempts) if (value.expires < Date.now()) attempts.delete(key);
    const state = randomBytes(32).toString('hex'), cookie = randomBytes(32).toString('hex');
    attempts.set(state,{cookie,expires:Date.now()+600000,redirect});
    res.cookie('drive_oauth',cookie,{httpOnly:true,sameSite:'lax',secure:redirect.startsWith('https:'),maxAge:600000,path:'/api/admin/drive'});
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({client_id:client,redirect_uri:redirect,response_type:'code',access_type:'offline',prompt:'consent',
      scope:'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets',state}).toString();
    res.json({url:url.href});
  });
  app.get('/api/admin/drive/callback', async(req,res) => {
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const attempt = attempts.get(state);
    const cookie = req.headers.cookie?.split(';').map(v=>v.trim()).find(v=>v.startsWith('drive_oauth='))?.slice(12) || '';
    if (!attempt || attempt.expires < Date.now() || cookie.length !== attempt.cookie.length ||
      !timingSafeEqual(Buffer.from(cookie),Buffer.from(attempt.cookie))) return res.status(400).send('Authorization expired or invalid. Open admin panel and connect again.');
    attempts.delete(state);
    res.clearCookie('drive_oauth',{path:'/api/admin/drive'});
    const finish = (status: string) => res.redirect('/admin?drive='+status);
    if (req.query.error || typeof req.query.code !== 'string') return finish('cancelled');
    try {
      const response = await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({
        client_id:process.env.GOOGLE_DRIVE_CLIENT_ID!,client_secret:process.env.GOOGLE_DRIVE_CLIENT_SECRET!,
        redirect_uri:attempt.redirect,code:req.query.code,grant_type:'authorization_code'
      })});
      const result = await response.json();
      if (!response.ok || typeof result.refresh_token !== 'string' || !/^[\w./~+-]+$/.test(result.refresh_token)) return finish('failed');
      const file = path.resolve('.env');
      const original = fs.readFileSync(file,'utf8');
      const line = 'GOOGLE_DRIVE_REFRESH_TOKEN='+result.refresh_token;
      const updated = /^GOOGLE_DRIVE_REFRESH_TOKEN=.*$/m.test(original)
        ? original.replace(/^GOOGLE_DRIVE_REFRESH_TOKEN=.*$/m,line) : original+'\n'+line+'\n';
      const temporary = file+'.oauth-'+randomBytes(8).toString('hex');
      try { fs.writeFileSync(temporary,updated,{mode:0o600}); fs.renameSync(temporary,file); }
      finally { if(fs.existsSync(temporary))fs.unlinkSync(temporary); }
      process.env.GOOGLE_DRIVE_REFRESH_TOKEN=result.refresh_token;
      finish('connected');
    } catch { finish('failed'); }
  });
}
