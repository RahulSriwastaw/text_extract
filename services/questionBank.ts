import { useEffect, useState } from "react";
import { apiFetch } from "./apiClient";
export interface BankProfile {
  mode: "google" | "link";
  name: string;
  root: string;
  images: string;
  documents: string;
  sheet: string;
  provider: "sheets" | "airtable";
  base: string;
  table: string;
}
export async function bankRequest(path: string, body?: unknown) {
  const response = await apiFetch(
    "/api/qb/" + path,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Error(
      data.error || "Question bank request failed (" + response.status + ").",
    );
  return data;
}
export function useBankProfile(uid?: string) {
  const [state, setState] = useState<{
    uid: string;
    profile: BankProfile | null;
  }>();
  useEffect(() => {
    let active = true;
    async function reload() {
      if (!uid || uid === "guest") return;
      try {
        const { profile } = await bankRequest("profile");
        if (active) setState({ uid, profile });
      } catch {
        /* Local exports stay available. */
      }
    }
    void reload();
    window.addEventListener("qb-profile", reload);
    return () => {
      active = false;
      window.removeEventListener("qb-profile", reload);
    };
  }, [uid]);
  return state?.uid === uid ? state?.profile : null;
}
