import { apiFetch } from './apiClient';

export async function uploadDriveFigure(imageData: string, filename: string, svg?: string) {
  const response = await apiFetch('/api/upload-figure', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageData, filename, svg }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Drive upload failed.');
  return result as { url: string; filename: string; storageProvider: string; isCloud: boolean };
}
