import { convertSource, readSource, type Settings } from './universalCsv';

self.onmessage = (event: MessageEvent<{ text: string; settings?: Settings }>) => {
  try {
    const source = readSource(event.data.text);
    if (!event.data.settings) { self.postMessage({ type: 'source', source }); return; }
    const rows = convertSource(source, event.data.settings, n => {
      if (n % 100 === 0 || n === source.rows.length) self.postMessage({ type: 'progress', value: n, total: source.rows.length });
    });
    self.postMessage({ type: 'result', rows });
  } catch (error) { self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) }); }
};
