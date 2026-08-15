#!/usr/bin/env node
/**
 * Get an Authelia OIDC access token for testing the Dishes client API.
 *
 * There is no native app yet, so there is no way to complete an authorization
 * code + PKCE flow by hand. This runs that flow from the terminal: it opens the
 * browser at Authelia, catches the redirect, exchanges the code, and prints a
 * token you can paste into curl.
 *
 * Usage:
 *   node scripts/oidc-token.mjs                          # loopback flow (default)
 *   node scripts/oidc-token.mjs --manual                 # paste the redirect URL yourself
 *   node scripts/oidc-token.mjs --whoami                 # also call /api/v1/auth/whoami
 *   node scripts/oidc-token.mjs --refresh <token>        # exchange a refresh token
 *
 * Configuration, by flag or environment variable:
 *   --issuer    DISHES_OIDC_ISSUER      https://auth.example.com
 *   --client    DISHES_OIDC_CLIENT_ID   dishes-mobile
 *   --app       DISHES_APP_URL          https://dishes.example.com   (for --whoami)
 *   --port      OIDC_CALLBACK_PORT      8765
 *
 * The loopback flow needs `http://localhost:<port>/callback` in the client's
 * redirect_uris in Authelia. RFC 8252 recommends loopback redirects for native
 * apps, so this is the normal way to do it — but it is only needed for testing,
 * and can be removed from the Authelia config once a real app exists.
 * Use --manual to avoid touching the Authelia config at all.
 *
 * This prints access and refresh tokens to your terminal in full. That is the
 * point of the tool, but they are live credentials for your account: don't
 * paste the output into a shared channel, and prefer short access token
 * lifespans while testing.
 */

import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";

// --- Arguments --------------------------------------------------------------

const argv = process.argv.slice(2);

function flag(name) {
  return argv.includes(`--${name}`);
}

function option(name, envVar, fallback) {
  const i = argv.indexOf(`--${name}`);
  if (i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--")) return argv[i + 1];
  return process.env[envVar] ?? fallback;
}

const ISSUER = (option("issuer", "DISHES_OIDC_ISSUER") ?? "").replace(/\/$/, "");
const CLIENT_ID = option("client", "DISHES_OIDC_CLIENT_ID", "dishes-mobile");
const APP_URL = (option("app", "DISHES_APP_URL") ?? "").replace(/\/$/, "");
const PORT = Number(option("port", "OIDC_CALLBACK_PORT", "8765"));
const SCOPE = "openid profile email groups offline_access";

const MANUAL = flag("manual");
const WHOAMI = flag("whoami");
const REFRESH = (() => {
  const i = argv.indexOf("--refresh");
  return i !== -1 ? argv[i + 1] : null;
})();

if (!ISSUER) {
  console.error(
    "Missing issuer. Pass --issuer https://auth.example.com or set DISHES_OIDC_ISSUER."
  );
  process.exit(1);
}

// --- Helpers ----------------------------------------------------------------

const b64url = (buf) => buf.toString("base64url");

function pkce() {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

async function discover() {
  const url = `${ISSUER}/.well-known/openid-configuration`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) }).catch((err) => {
    throw new Error(`Could not reach ${url}: ${err.message}`);
  });
  if (!res.ok) throw new Error(`Discovery failed: ${res.status} ${res.statusText} (${url})`);

  const doc = await res.json();
  for (const key of ["authorization_endpoint", "token_endpoint"]) {
    if (!doc[key]) throw new Error(`Discovery document is missing ${key}`);
  }
  return doc;
}

function openBrowser(url) {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
    return true;
  } catch {
    return false;
  }
}

/** Serve one request on the loopback port and resolve with its query params. */
function awaitCallback(port, expectedState) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${port}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end("Not found");
        return;
      }

      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");

      const ok = !error && code && state === expectedState;
      res.writeHead(ok ? 200 : 400, { "content-type": "text/html; charset=utf-8" });
      res.end(
        `<!doctype html><meta charset="utf-8"><title>Dishes</title>` +
          `<body style="font:16px system-ui;padding:3rem;max-width:34rem;margin:auto">` +
          `<h1>${ok ? "Signed in ✅" : "Sign-in failed ❌"}</h1>` +
          `<p>${ok ? "Token printed in your terminal. You can close this tab." : escapeHtml(error ?? "state mismatch")}</p>`
      );

      server.close();
      if (error) return reject(new Error(`Authorization failed: ${error}`));
      if (!code) return reject(new Error("No authorization code in the callback"));
      if (state !== expectedState) {
        return reject(new Error("State mismatch — discarding this response"));
      }
      resolve(code);
    });

    server.on("error", (err) => {
      reject(
        err.code === "EADDRINUSE"
          ? new Error(`Port ${port} is in use. Pass --port <n> (and register that URI).`)
          : err
      );
    });

    server.listen(port, "127.0.0.1");
    setTimeout(() => {
      server.close();
      reject(new Error("Timed out after 5 minutes waiting for the callback"));
    }, 300_000).unref();
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

async function exchange(tokenEndpoint, body) {
  const res = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(15_000),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Token endpoint returned non-JSON (${res.status}):\n${text.slice(0, 400)}`);
  }

  if (!res.ok || json.error) {
    throw new Error(
      `Token exchange failed (${res.status}): ${json.error ?? "unknown"}` +
        (json.error_description ? ` — ${json.error_description}` : "")
    );
  }
  return json;
}

function report(tokens) {
  console.log("\n─────────────────────────────────────────────");
  console.log("ACCESS TOKEN\n");
  console.log(tokens.access_token);
  if (tokens.refresh_token) {
    console.log("\nREFRESH TOKEN (re-run with --refresh <token>)\n");
    console.log(tokens.refresh_token);
  }
  console.log("\n─────────────────────────────────────────────");
  console.log(`token_type : ${tokens.token_type ?? "?"}`);
  console.log(`expires_in : ${tokens.expires_in ?? "?"}s`);
  console.log(`scope      : ${tokens.scope ?? "?"}`);
  console.log(
    `format     : ${tokens.access_token?.split(".").length === 3 ? "JWT" : "opaque (Authelia default)"}`
  );

  const target = APP_URL || "https://dishes.example.com";
  console.log("\nTry it:\n");
  console.log(`  curl -s -H "Authorization: Bearer ${tokens.access_token}" \\`);
  console.log(`    ${target}/api/v1/auth/whoami | jq\n`);
}

async function callWhoami(accessToken) {
  if (!APP_URL) {
    console.error("--whoami needs --app https://dishes.example.com (or DISHES_APP_URL).");
    return;
  }
  const url = `${APP_URL}/api/v1/auth/whoami`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.text();

  console.log(`whoami → HTTP ${res.status}`);
  try {
    console.log(JSON.stringify(JSON.parse(body), null, 2));
  } catch {
    console.log(body.slice(0, 500));
  }

  if (res.status === 401) {
    console.log(
      "\n401 with a fresh token usually means DISHES_OIDC_ISSUER isn't set on the\n" +
        "server, or doesn't match this issuer. Check: docker exec dishes printenv DISHES_OIDC_ISSUER"
    );
  }
}

// --- Main -------------------------------------------------------------------

async function main() {

  const doc = await discover();
  console.log(`issuer   : ${doc.issuer ?? ISSUER}`);
  console.log(`client   : ${CLIENT_ID}`);

  if (REFRESH) {
    const tokens = await exchange(doc.token_endpoint, {
      grant_type: "refresh_token",
      refresh_token: REFRESH,
      client_id: CLIENT_ID,
    });
    report(tokens);
    if (WHOAMI) await callWhoami(tokens.access_token);
    return;
  }

  const { verifier, challenge } = pkce();
  const state = b64url(randomBytes(16));
  const redirectUri = MANUAL ? "dishes://auth/callback" : `http://localhost:${PORT}/callback`;

  const authUrl = new URL(doc.authorization_endpoint);
  authUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    scope: SCOPE,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();

  console.log(`redirect : ${redirectUri}\n`);

  let code;

  if (MANUAL) {
    console.log("Open this URL, sign in, then copy the FULL URL you land on:\n");
    console.log(authUrl.toString() + "\n");
    console.log(
      "(The browser will fail to open dishes://… — that's expected. Copy the URL\n" +
        " from the address bar or the error page.)\n"
    );
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const pasted = (await rl.question("Paste the redirect URL: ")).trim();
    rl.close();

    let parsed;
    try {
      parsed = new URL(pasted);
    } catch {
      throw new Error("That isn't a URL.");
    }
    if (parsed.searchParams.get("error")) {
      throw new Error(`Authorization failed: ${parsed.searchParams.get("error")}`);
    }
    if (parsed.searchParams.get("state") !== state) {
      throw new Error("State mismatch — discarding this response.");
    }
    code = parsed.searchParams.get("code");
    if (!code) throw new Error("No ?code= in that URL.");
  } else {
    const waiting = awaitCallback(PORT, state);
    console.log("Opening your browser to sign in…");
    if (!openBrowser(authUrl.toString())) {
      console.log("Couldn't open a browser. Visit:\n\n" + authUrl.toString() + "\n");
    }
    console.log(
      `Waiting for the redirect to http://localhost:${PORT}/callback …\n` +
        "If the browser shows an Authelia error instead, that IS the failure —\n" +
        "read it there and Ctrl-C here (this waits 5 minutes for a human sign-in)."
    );
    code = await waiting;
  }

  const tokens = await exchange(doc.token_endpoint, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: CLIENT_ID,
    code_verifier: verifier,
  });

  report(tokens);
  if (WHOAMI) await callWhoami(tokens.access_token);

}

main().catch((err) => {
  // Anything that reaches here is a flow failure the user needs to read, not a
  // stack trace. Keep it to one line plus a hint where one helps.
  console.error(`\n✗ ${err.message}`);

  if (REFRESH && /invalid_grant/i.test(err.message)) {
    console.error(
      "  The refresh token was rejected — expired, already used, or revoked.\n" +
        "  Run without --refresh to sign in again."
    );
  } else if (/PKCE|invalid_grant/i.test(err.message)) {
    console.error(
      "  The code was rejected. Most often the redirect_uri isn't registered on\n" +
        "  the client, or it doesn't match exactly (scheme, host, port, path)."
    );
  } else if (/invalid_client|unauthorized_client/i.test(err.message)) {
    console.error(`  Check the client id "${CLIENT_ID}" exists in Authelia and is public.`);
  } else if (/Could not reach|ENOTFOUND|ECONNREFUSED/i.test(err.message)) {
    console.error("  Is the issuer URL right, and reachable from this machine?");
  }

  process.exit(1);
});
