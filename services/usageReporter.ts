/**
 * services/usageReporter.ts — Report client-side bridge/own-key usage to the server.
 *
 * Call reportClientUsage() after each bridge page run or userGeminiService call.
 * Failures are silently ignored — this is best-effort telemetry.
 */
import { apiFetch } from './apiClient';

export interface ClientUsageEvent {
  feature: string;
  engine: 'own_key' | 'bridge';
  provider?: string;
  model?: string;
  pages?: number;
  input_tokens?: number;
  output_tokens?: number;
  duration_ms?: number;
}

export async function reportClientUsage(event: ClientUsageEvent): Promise<void> {
  try {
    await apiFetch('/api/usage/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
  } catch {
    // Best-effort; never block the user's workflow
  }
}
