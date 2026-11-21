import type { Express, RequestHandler } from 'express';
import { randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { checkOAuthStorage, saveRefreshToken, readRefreshToken } from './oauthStorage.js';

export function registerDriveOAuth(app: Express, admin: RequestHandler) {
  const cookieName = (state: string) => 'drive_oauth_' + state;
  const sign = (value: string) => createHmac('sha256',process.env.GOOGLE_DRIVE_CLIENT_SECRET!).update(value).digest('hex');
  app.get('/api/admin/drive', admin, async (_req,res) => {
    try { res.json({
      configured: !!(process.env.GOOGLE_DRIVE_CLIENT_ID && process.env.GOOGLE_DRIVE_CLIENT_SECRET),
      connected: !!(await readRefreshToken()),
      redirectUri: process.env.GOOGLE_DRIVE_REDIRECT_URI || '',
      folder: process.env.GOOGLE_DRIVE_FOLDER_URL || '',
      sheet: process.env.GOOGLE_QUESTIONS_SPREADSHEET_URL || '',
    }); } catch (e) { res.status(503).json({error:e instanceof Error ? e.message : 'Storage unavailable'}); }
  });
  app.post('/api/admin/drive/connect', admin, (req,res) => {
    const client = process.env.GOOGLE_DRIVE_CLIENT_ID;
    const secret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
    const redirect = process.env.GOOGLE_DRIVE_REDIRECT_URI;
    if (!client || !secret || !redirect) return res.status(400).json({error:'Set GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET and GOOGLE_DRIVE_REDIRECT_URI in .env first.'});
    const target = new URL(redirect);
    if (req.get('origin') !== target.origin) return res.status(400).json({
      error: 'Open the admin panel at ' + target.origin + '/admin and connect there so the Google callback uses the same browser host.'
    });
    try { checkOAuthStorage(); } catch(e) { return res.status(503).json({error:e instanceof Error ? e.message : 'Storage missing'}); }
    const state = randomBytes(32).toString('hex');
    const payload = Buffer.from(JSON.stringify({state,expires:Date.now()+600000,redirect})).toString('base64url');
    res.cookie(cookieName(state),payload+'.'+sign(payload),{httpOnly:true,sameSite:'lax',secure:redirect.startsWith('https:'),maxAge:600000,path:'/api/admin/drive'});
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({client_id:client,redirect_uri:redirect,response_type:'code',access_type:'offline',prompt:'consent',
      scope:'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets',state}).toString();
    res.json({url:url.href});
  });
  app.get('/api/admin/drive/callback', async(req,res) => {
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    if (!/^[a-f0-9]{64}$/.test(state) || !process.env.GOOGLE_DRIVE_CLIENT_SECRET) return res.status(400).send('Invalid authorization state. Connect again.');
    const prefix = cookieName(state) + '=';
    const cookie = req.headers.cookie?.split(';').map(v=>v.trim()).find(v=>v.startsWith(prefix))?.slice(prefix.length) || '';
    const [payload,signature] = cookie.split('.');
    const expected = payload ? sign(payload) : '';
    if (!signature || signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))
      return res.status(400).send('Authorization expired or invalid. Connect again from admin.');
    let attempt: {state:string;expires:number;redirect:string};
    try { attempt = JSON.parse(Buffer.from(payload,'base64url').toString()); }
    catch { return res.status(400).send('Invalid authorization cookie.'); }
    if (attempt.state !== state || attempt.expires < Date.now() || attempt.redirect !== process.env.GOOGLE_DRIVE_REDIRECT_URI)
      return res.status(400).send('Authorization expired. Connect again.');
    res.clearCookie(cookieName(state),{path:'/api/admin/drive'});
    const finish = (status: string) => res.redirect('/admin?drive='+status);
    if (req.query.error || typeof req.query.code !== 'string') return finish('cancelled');
    try {
      const response = await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({
        client_id:process.env.GOOGLE_DRIVE_CLIENT_ID!,client_secret:process.env.GOOGLE_DRIVE_CLIENT_SECRET!,
        redirect_uri:attempt.redirect,code:req.query.code,grant_type:'authorization_code'
      })});
      const result = await response.json();
      if (!response.ok || typeof result.refresh_token !== 'string' || !/^[\w./~+-]+$/.test(result.refresh_token)) return finish('failed');
      await saveRefreshToken(result.refresh_token);
      finish('connected');
    } catch { finish('failed'); }
  });
}
