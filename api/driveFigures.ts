import { readRefreshToken } from './oauthStorage.js';
import { storageTarget } from './storageTarget.js';
import sanitizeHtml from 'sanitize-html';

let cached: { token: string; expires: number } | undefined;
let tokenOwner = '';
let refreshing: Promise<string> | undefined;

export async function driveToken() {
  const refreshToken = await readRefreshToken();
  const owner = [process.env.GOOGLE_DRIVE_CLIENT_ID, refreshToken].join(':');
  if (owner !== tokenOwner) { cached = undefined; tokenOwner = owner; }
  if (cached && cached.expires > Date.now()) return cached.token;
  if (refreshing) return refreshing;
  const { GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET } = process.env;
  if (!GOOGLE_DRIVE_CLIENT_ID || !GOOGLE_DRIVE_CLIENT_SECRET || !refreshToken)
    throw new Error('Server storage setup incomplete: configure Google Drive OAuth credentials.');
  refreshing = (async () => {
    const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST',
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: GOOGLE_DRIVE_CLIENT_ID,
        client_secret: GOOGLE_DRIVE_CLIENT_SECRET, refresh_token: refreshToken }) });
    if (!response.ok) throw new Error('Drive authorization failed. Check the server OAuth credentials.');
    const data = await response.json();
    if (!data.access_token) throw new Error('Google did not issue a Drive access token.');
    cached = { token: data.access_token, expires: Date.now() + (Number(data.expires_in || 3600) - 60) * 1000 };
    return cached.token;
  })().finally(() => { refreshing = undefined; });
  return refreshing;
}

export function safeFigureSvg(svg: string) {
  return sanitizeHtml(svg, {
    parser: { lowerCaseAttributeNames: false, lowerCaseTags: false },
    allowedTags: 'svg g path line polyline polygon rect circle ellipse text tspan title desc'.split(' '),
    allowedAttributes: { '*': 'xmlns viewBox width height x y x1 y1 x2 y2 dx dy cx cy rx ry r d points transform fill stroke stroke-width stroke-linecap stroke-linejoin stroke-dasharray opacity fill-opacity stroke-opacity fill-rule font-family font-size font-weight font-style text-anchor dominant-baseline'.split(' ') },
    transformTags: { '*': (tagName, attribs) => {
      for (const key of ['fill','stroke']) if (attribs[key] && !/^(?:[a-z]+|#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(attribs[key])) delete attribs[key];
      return {tagName, attribs};
    } },
  });
}

export async function drive(token: string, path: string, options: RequestInit = {}) {
  const response = await fetch('https://www.googleapis.com/' + path, { ...options,
    headers: { Authorization: 'Bearer ' + token, ...options.headers } });
  if (!response.ok) {
    if (response.status === 401 && cached?.token === token) cached = undefined;
    const error = await response.json().catch(() => null);
    throw new Error(error?.error?.message || 'Google Drive request failed (' + response.status + ').');
  }
  return response;
}

export async function uploadDriveFigure(imageData: string, filename: string, svg?: string, destination?: { id: string; token: string; resourceKey?: string }) {
  const { id: parent, resourceKey } = destination || storageTarget('folder');
  const token = destination?.token || await driveToken();
  const created: string[] = [];
  async function upload(blob: Blob, name: string) {
    const boundary = 'figure-' + crypto.randomUUID();
    const metadata = JSON.stringify({ name, parents: [parent], mimeType: blob.type });
    const body = new Blob([
      '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + metadata,
      '\r\n--' + boundary + '\r\nContent-Type: ' + blob.type + '\r\n\r\n', blob, '\r\n--' + boundary + '--\r\n',
    ], { type: 'multipart/related; boundary=' + boundary });
    const result = await drive(token, 'upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,resourceKey', { method: 'POST', body, headers: resourceKey ? { 'X-Goog-Drive-Resource-Keys': parent + '/' + resourceKey } : {} });
    const file = await result.json();
    created.push(file.id);
    await drive(token, 'drive/v3/files/' + file.id + '/permissions?supportsAllDrives=true', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'anyone', role: 'reader', allowFileDiscovery: false }) });
    return file;
  }
  try {
    if (!/^data:image\/(png|jpeg);base64,/i.test(imageData)) throw new Error('Invalid figure image.');
    const blob = await (await fetch(imageData)).blob();
    const file = await upload(blob, filename + (blob.type === 'image/jpeg' ? '.jpg' : '.png'));
    if (svg) await upload(new Blob([safeFigureSvg(svg)], { type: 'image/svg+xml' }), filename + '.svg');
    const url = new URL('https://drive.google.com/thumbnail');
    url.searchParams.set('id', file.id);
    url.searchParams.set('sz', 'w2000');
    if (file.resourceKey) url.searchParams.set('resourcekey', file.resourceKey);
    return { url: url.href, filename, storageProvider: 'Google Drive', isCloud: true };
  } catch (error) {
    await Promise.allSettled(created.map(id => drive(token, 'drive/v3/files/' + id + '?supportsAllDrives=true', { method: 'DELETE' })));
    throw error;
  }
}
