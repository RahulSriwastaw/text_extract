import { auth } from './firebase';

export async function uploadDriveFigure(imageData: string, filename: string, svg?: string) {
  const user = auth?.currentUser;
  if (!user) throw new Error('Sign in to TextExtract to upload a figure.');
  const response = await fetch('/api/upload-figure', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await user.getIdToken() },
    body: JSON.stringify({ imageData, filename, svg }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Drive upload failed.');
  return result as { url: string; filename: string; storageProvider: string; isCloud: boolean };
}
