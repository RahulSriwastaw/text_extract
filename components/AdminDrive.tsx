import React, { useEffect, useState } from 'react';

export function AdminDrive({ headers }: { headers: () => Record<string,string> }) {
  const [info,setInfo] = useState<{configured:boolean;connected:boolean;redirectUri:string;folder:string;sheet:string}>();
  const [message,setMessage] = useState('');
  const [busy,setBusy] = useState(false);
  const [loading,setLoading] = useState(false);
  async function loadSettings() {
    setLoading(true);
    setMessage('');
    try {
      const response = await fetch('/api/admin/drive', { headers: headers(), cache: 'no-store' });
      if (!response.headers.get('content-type')?.includes('application/json'))
        throw new Error('Drive route unavailable. Restart the app server and retry.');
      const data = await response.json();
      if (!response.ok) throw new Error(
        response.status === 401 || response.status === 403
          ? 'Admin session expired. Log out and sign in again.'
          : data.error || 'Drive settings request failed (' + response.status + ').');
      setInfo(data);
      const result = new URLSearchParams(location.search).get('drive');
      if (result) setMessage(result === 'connected' ? 'Google authorization saved.' : 'Authorization ' + result + '. Try connecting again.');
    } catch (e) { setInfo(undefined); setMessage(e instanceof Error ? e.message : 'Drive settings unavailable.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void loadSettings(); }, []);
  async function connect() {
    setBusy(true);
    try {
      const r=await fetch('/api/admin/drive/connect',{method:'POST',headers:headers()});
      if (!r.headers.get('content-type')?.includes('application/json'))
        throw new Error('Google connection backend failed (HTTP ' + r.status + '). Check server logs and redeploy the latest fix.');
      const data=await r.json();
      if(!r.ok) throw Error(data.error);
      location.assign(data.url);
    } catch(e) {setMessage(e instanceof Error ? e.message : 'Connection failed.');setBusy(false);}
  }
  return <section className="card p-5 space-y-3">
    <h2 className="font-semibold text-lg">Google Drive &amp; Sheets storage</h2>
    <p>{info?.connected ? 'Google authorization saved' : 'Connect the Google account that owns your storage folder and question sheet.'}</p>
    {info && !info.configured && <p>Set GOOGLE_DRIVE_CLIENT_ID and GOOGLE_DRIVE_CLIENT_SECRET in the server .env, then restart the server.</p>}
    {info?.redirectUri && <p className="text-sm break-all">Google OAuth authorized redirect URI — {info.redirectUri}</p>}
    <div className="flex flex-wrap gap-4">
      {info?.folder && <a href={info.folder} target="_blank" rel="noreferrer">Open image folder</a>}
      {info?.sheet && <a href={info.sheet} target="_blank" rel="noreferrer">Open question sheet</a>}
    </div>
    <p className="text-sm">Images upload to the configured shared folder with anyone-with-link viewing. Questions save to the configured spreadsheet.</p>
    <button className="btn btn-primary" disabled={loading || busy || !info?.configured} onClick={connect}>{busy ? 'Connecting…' : info?.connected ? 'Reconnect Google account' : 'Connect Google Drive'}</button>
    <button className="btn btn-secondary ml-2" disabled={loading || busy} onClick={loadSettings}>{loading ? 'Loading…' : 'Reload connection status'}</button>
    {message && <p role="status">{message}</p>}
  </section>;
}
