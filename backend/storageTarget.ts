/** Resolve a server-configured Google share link without fetching the supplied URL. */
export function storageTarget(kind: 'folder' | 'sheet') {
  const folder = kind === 'folder';
  const setting = folder ? 'GOOGLE_DRIVE_FOLDER_URL' : 'GOOGLE_QUESTIONS_SPREADSHEET_URL';
  const value = process.env[setting]?.trim() || process.env[folder ? 'GOOGLE_DRIVE_FOLDER_ID' : 'GOOGLE_QUESTIONS_SPREADSHEET_ID']?.trim();
  if (!value) throw new Error('Set ' + setting + ' in the server .env.');
  const idPattern = /^[A-Za-z0-9_-]+$/;
  if (idPattern.test(value)) return { id: value, resourceKey: '' };
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Invalid Google share link in ' + setting); }
  let id: string | undefined;
  if (url.protocol === 'https:' && !url.username && !url.password && !url.port) {
    if (folder && url.hostname === 'drive.google.com') {
      id = url.pathname.match(/^\/drive\/(?:u\/\d+\/)?folders\/([\w-]+)\/?$/)?.[1];
    } else if (!folder && url.hostname === 'docs.google.com') {
      id = url.pathname.match(/^\/spreadsheets\/(?:u\/\d+\/)?d\/(?!e\/)([\w-]+)(?:\/|$)/)?.[1];
    }
    if (!id && url.hostname === 'drive.google.com' && url.pathname === '/open') id = url.searchParams.get('id') || undefined;
  }
  if (!id || !idPattern.test(id)) throw new Error('Expected a Google ' + kind + ' share link in ' + setting);
  const resourceKey = url.searchParams.get('resourcekey') || '';
  if (resourceKey && !idPattern.test(resourceKey)) throw new Error('Invalid Google resource key in ' + setting);
  return { id, resourceKey };
}
