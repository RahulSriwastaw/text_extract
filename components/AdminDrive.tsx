import React, { useEffect, useState } from 'react';
import { apiFetch } from '../services/apiClient';

export function AdminDrive() {
  const [info,setInfo] = useState<{configured:boolean;connected:boolean;redirectUri:string;folder:string;sheet:string}>();
  const [message,setMessage] = useState('');
  const [busy,setBusy] = useState(false);
  const [loading,setLoading] = useState(false);
  async function loadSettings() {
    setLoading(true);
    setMessage('');
    try {
      const response = await apiFetch('/api/admin/drive', { cache: 'no-store' });
      if (!response.headers.get('content-type')?.includes('application/json'))
        throw new Error('Drive route unavailable. Restart the app server and retry.');
      const data = await response.json();
      if (!response.ok) throw new Error(
        response.status === 401 || response.status === 403
          ? 'Admin session expired. Sign in again.'
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
      const r=await apiFetch('/api/admin/drive/connect',{method:'POST'});
      if (!r.headers.get('content-type')?.includes('application/json'))
        throw new Error('Google connection backend failed (HTTP ' + r.status + '). Check server logs and redeploy the latest fix.');
      const data=await r.json();
      if(!r.ok) throw Error(data.error);
      location.assign(data.url);
    } catch(e) {setMessage(e instanceof Error ? e.message : 'Connection failed.');setBusy(false);}
  }
  return <section className="space-y-3">
    <p className="text-sm">{info?.connected ? 'Google authorization saved' : 'Connect the Google account that owns your storage folder and question sheet.'}</p>
    {info && !info.configured && <p className="text-xs text-ink-3">Set GOOGLE_DRIVE_CLIENT_ID and GOOGLE_DRIVE_CLIENT_SECRET in the server .env, then restart the server.</p>}
    {info?.redirectUri && <p className="text-xs text-ink-3 break-all">OAuth redirect URI: {info.redirectUri}</p>}
    <div className="flex flex-wrap gap-3 text-xs">
      {info?.folder && <a href={info.folder} target="_blank" rel="noreferrer" className="text-accent hover:underline">Open image folder</a>}
      {info?.sheet && <a href={info.sheet} target="_blank" rel="noreferrer" className="text-accent hover:underline">Open question sheet</a>}
    </div>
    <div className="flex gap-2">
      <button className="px-3 py-2 bg-accent text-on-accent text-xs font-bold rounded-lg disabled:opacity-50" disabled={loading || busy || !info?.configured} onClick={connect}>{busy ? 'Connecting...' : info?.connected ? 'Reconnect' : 'Connect Google Drive'}</button>
      <button className="px-3 py-2 bg-surface-2 border border-line text-xs font-bold rounded-lg" disabled={loading || busy} onClick={loadSettings}>{loading ? 'Loading...' : 'Reload'}</button>
    </div>
    {message && <p className="text-xs text-ink-3 mt-2">{message}</p>}
  </section>;
}
