import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { Express } from "express";
import { readRefreshToken, saveRefreshToken } from "./oauthStorage.js";
import { requireUser } from "./auth.js";

type Provider = "google" | "airtable";
const objectKey = (uid: string, kind: string) =>
  "qb/" + createHash("sha256").update(uid).digest("hex") + "/" + kind + ".enc";
export async function readPrivate<T>(
  uid: string,
  kind: string,
): Promise<T | null> {
  const value = await readRefreshToken(objectKey(uid, kind));
  return value ? JSON.parse(value) : null;
}
export const writePrivate = (uid: string, kind: string, value: unknown) =>
  saveRefreshToken(JSON.stringify(value), objectKey(uid, kind));
function config(provider: Provider) {
  const google = provider === "google";
  const client =
    process.env[google ? "GOOGLE_DRIVE_CLIENT_ID" : "AIRTABLE_CLIENT_ID"];
  const secret =
    process.env[
      google ? "GOOGLE_DRIVE_CLIENT_SECRET" : "AIRTABLE_CLIENT_SECRET"
    ];
  const origin =
    process.env.QB_APP_ORIGIN ||
    (process.env.GOOGLE_DRIVE_REDIRECT_URI &&
      new URL(process.env.GOOGLE_DRIVE_REDIRECT_URI).origin);
  if (!origin || !client || !secret)
    throw Error(
      "Configure the " +
        provider +
        " OAuth client and QB_APP_ORIGIN on the server.",
    );
  return {
    client,
    secret,
    redirect: new URL("/api/qb/oauth/" + provider + "/callback", origin).href,
    tokenUrl: google
      ? "https://oauth2.googleapis.com/token"
      : "https://airtable.com/oauth2/v1/token",
  };
}
interface Tokens {
  access_token: string;
  refresh_token: string;
  expires: number;
}
async function exchange(
  uid: string,
  provider: Provider,
  params: URLSearchParams,
  previous?: Tokens,
) {
  const c = config(provider);
  const headers: Record<string, string> = {};
  if (provider === "google") {
    params.set("client_id", c.client);
    params.set("client_secret", c.secret);
  } else
    headers.Authorization =
      "Basic " + Buffer.from(c.client + ":" + c.secret).toString("base64");
  const response = await fetch(c.tokenUrl, {
    method: "POST",
    headers,
    body: params,
  });
  if (!response.ok)
    throw Error("Reconnect " + provider + " from My question bank.");
  const t = await response.json();
  const tokens: Tokens = {
    access_token: t.access_token,
    refresh_token: t.refresh_token || previous?.refresh_token,
    expires: Date.now() + Number(t.expires_in) * 1000,
  };
  if (!tokens.refresh_token || !tokens.access_token)
    throw Error("Offline access was not granted. Connect again.");
  await writePrivate(uid, provider, tokens);
  return tokens.access_token;
}
const renewing = new Map<string, Promise<string>>();
export async function personalToken(uid: string, provider: Provider) {
  const t = await readPrivate<Tokens>(uid, provider);
  if (!t) throw Error("Connect " + provider + " in My question bank first.");
  if (t.expires > Date.now() + 60000) return t.access_token;
  const key = objectKey(uid, provider);
  if (!renewing.has(key))
    renewing.set(
      key,
      exchange(
        uid,
        provider,
        new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: t.refresh_token,
        }),
        t,
      ).finally(() => renewing.delete(key)),
    );
  return renewing.get(key)!;
}
export function registerPersonalOAuth(app: Express) {
  for (const provider of ["google", "airtable"] as const) {
    const path = "/api/qb/oauth/" + provider;
    app.post(path, requireUser, async (req, res) => {
      try {
        const uid = res.locals.user.uid;
        if (uid === "anonymous")
          return res.status(401).json({ error: "Sign in first." });
        const c = config(provider);
        if (req.get("origin") !== new URL(c.redirect).origin)
          throw Error("The configured callback origin must match this app.");
        const state = randomBytes(24).toString("hex"),
          verifier = randomBytes(48).toString("base64url");
        const payload = Buffer.from(
          JSON.stringify({
            uid,
            state,
            verifier,
            expires: Date.now() + 600000,
          }),
        ).toString("base64url");
        const sig = createHmac("sha256", c.secret)
          .update(payload)
          .digest("hex");
        res.cookie("qb_" + state, payload + "." + sig, {
          httpOnly: true,
          sameSite: "lax",
          secure: c.redirect.startsWith("https:"),
          path,
          maxAge: 600000,
        });
        const google = provider === "google";
        const url = new URL(
          google
            ? "https://accounts.google.com/o/oauth2/v2/auth"
            : "https://airtable.com/oauth2/v1/authorize",
        );
        url.search = new URLSearchParams({
          client_id: c.client,
          redirect_uri: c.redirect,
          response_type: "code",
          state,
          code_challenge_method: "S256",
          code_challenge: createHash("sha256")
            .update(verifier)
            .digest("base64url"),
          scope: google
            ? "https://www.googleapis.com/auth/drive"
            : "schema.bases:read schema.bases:write data.records:read data.records:write",
          ...(google ? { access_type: "offline", prompt: "consent" } : {}),
        }).toString();
        res.json({ url: url.href });
      } catch (e) {
        res.status(400).json({ error: (e as Error).message });
      }
    });
    app.get(path + "/callback", async (req, res) => {
      try {
        const c = config(provider),
          state = String(req.query.state || "");
        if (!/^[a-f0-9]{48}$/.test(state))
          throw Error("Invalid connection request.");
        const cookie =
          req.headers.cookie
            ?.split(";")
            .map((x) => x.trim())
            .find((x) => x.startsWith("qb_" + state + "="))
            ?.split("=")[1] || "";
        const [payload, sig] = cookie.split(".");
        const check = createHmac("sha256", c.secret).update(payload).digest();
        if (
          !sig ||
          !/^[a-f0-9]{64}$/.test(sig) ||
          !timingSafeEqual(Buffer.from(sig, "hex"), check)
        )
          throw Error("Connection expired.");
        const data = JSON.parse(Buffer.from(payload, "base64url").toString());
        res.clearCookie("qb_" + state, { path });
        if (
          data.state !== state ||
          data.expires < Date.now() ||
          typeof req.query.code !== "string"
        )
          throw Error("Connection cancelled or expired.");
        await exchange(
          data.uid,
          provider,
          new URLSearchParams({
            grant_type: "authorization_code",
            code: req.query.code,
            redirect_uri: c.redirect,
            code_verifier: data.verifier,
          }),
        );
        res
          .type("html")
          .send(
            "<p>Connected. Return to My question bank.</p><script>window.opener?.postMessage({qbAuth:true},location.origin);window.close()</script>",
          );
      } catch {
        res
          .status(400)
          .send(
            "Connection failed or expired. Close this tab and reconnect from My question bank.",
          );
      }
    });
  }
}
