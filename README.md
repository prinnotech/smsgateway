# SMS Gateway

Turn an Android phone into a self-hosted SMS gateway, driven by a web panel.
Queue single, bulk, or scheduled messages from the browser; the phone polls the
server, sends them over its own SIM(s), and reports back. Incoming SMS are
forwarded to the panel too.

No third-party SMS provider, no Firebase/push, no Play Store — you host the
backend yourself and install the app directly.

<p>
  <a href="https://github.com/prinnotech/smsgateway/releases/latest/download/sms-gateway.apk"><img alt="Download the Android APK" src="https://img.shields.io/badge/Download-Android%20APK-3ddc84?style=for-the-badge&logo=android&logoColor=white"></a>
  <a href="https://github.com/prinnotech/smsgateway/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/prinnotech/smsgateway?style=for-the-badge&label=latest"></a>
</p>

- **Download the app:** the button above always serves the **latest APK**
  (`releases/latest/download/sms-gateway.apk`). Install it on each phone
  (enable "Install unknown apps"). See every version on the
  [Releases page](https://github.com/prinnotech/smsgateway/releases).
- **Host the backend:** one-click [Deploy on Railway](#deploy-on-railway), or
  self-host with Docker (see [DEPLOY.md](DEPLOY.md)).

## How it works

```
┌──────────────┐        HTTPS         ┌──────────────┐      REST/SDK     ┌──────────────┐
│  Web panel   │  ───────────────▶    │  Next.js API  │  ─────────────▶  │  PocketBase  │
│  (browser)   │   auth, queue SMS    │  (the panel)  │   data + auth    │  (SQLite)    │
└──────────────┘                      └──────────────┘                   └──────────────┘
                                            ▲
                                            │  poll /outgoing, POST /status, /incoming
                                            │  (Authorization: Bearer <api-key>)
                                      ┌──────────────┐
                                      │  Android app │  sends/receives SMS over the SIM
                                      └──────────────┘
```

- **Interval polling** (no push): the phone asks the server "anything to send?"
  every few seconds. Works through mobile NAT.
- **Bearer-token auth** for the phone; **PocketBase user auth** for the panel.
- Message lifecycle: `pending` → (claimed by `/outgoing`) `sending` →
  (`/status`) `sent`/`failed`. Scheduled messages start `scheduled` and are
  released when due. Incoming SMS are stored as `received`.

## Repository layout

| Folder | What it is |
| ------ | ---------- |
| [`smsgateway-panel/`](smsgateway-panel) | Next.js web panel + the phone-facing API routes. |
| [`pocketbase/`](pocketbase) | PocketBase config. `pb_migrations/` holds the schema (auto-applied on start). |
| [`smsgateway-app/`](smsgateway-app) | The Android app (React Native / Expo prebuild) + native SMS module. |

## Quick start (local)

**1. Backend + panel** — with Docker:

```bash
cp .env.example .env      # set a strong POCKETBASE_ADMIN_PASSWORD
docker compose up -d --build
```

- Panel → http://localhost:3000
- PocketBase admin → http://localhost:8090/_/

Or run them without Docker: start `pocketbase serve` in `pocketbase/`, then
`npm install && npm run dev` in `smsgateway-panel/` (see
[`smsgateway-panel/README.md`](smsgateway-panel/README.md)).

**2. The phone**

- Install the APK from **[Releases](../../releases)**, or build it yourself
  (see [`smsgateway-app/BUILD_APK.md`](smsgateway-app/BUILD_APK.md)).
- In the panel: register → create an API key → **Generate QR**.
- Scan the QR in the app, grant SMS + phone permissions. Done.

> The QR's "Panel URL" must be reachable from the phone — your public panel URL
> in production, or your PC's LAN IP (not `localhost`) for local testing.

## Deploy on Railway

<!-- RAILWAY_BUTTON -->
One click, one service, one URL. The template runs the all-in-one image
(PocketBase + panel), adds a persistent volume for your data, and asks only for
an admin email + password. The superuser and database tables are created
automatically on first boot.

> After deploying: open the generated URL, register, create an API key,
> **Generate QR**, and scan it in the app. The QR's "Panel URL" is your Railway
> URL — reachable from the phone anywhere.

## Other ways to deploy

The root `Dockerfile` bundles PocketBase + the panel into a single container
(the panel proxies PocketBase at `/pb`). Run it anywhere:

```bash
docker run -d -p 3000:3000 \
  -e POCKETBASE_ADMIN_EMAIL=admin@example.com \
  -e POCKETBASE_ADMIN_PASSWORD='a-strong-password' \
  -v sms_pb_data:/pb/pb_data \
  ghcr.io/prinnotech/smsgateway:latest
```

See [`DEPLOY.md`](DEPLOY.md) for Railway-by-hand, the split two-service setup
(`docker-compose.yml`), and the full environment-variable reference.

## The phone API (bearer-token)

The app calls these at `<panel-url>/…`:

| Endpoint | Purpose |
| -------- | ------- |
| `GET /outgoing` | Returns queued messages `[{ id, to, body, sim }]`, honoring per-SIM rate limits. |
| `POST /status` | Reports a send result: `{ id, status: "sent"\|"failed", error? }`. |
| `POST /incoming` | Stores a received SMS: `{ from, body, sim, timestamp }`. |
| `POST /register` | Upserts the phone's SIMs so the panel can target them. |

## Notes & limitations

- Because there's no push, the app must keep a foreground service alive and be
  exempt from battery optimization, or Android will kill the poll loop.
- A SIM's phone number is often blank (carrier/privacy); SIM slot + carrier are
  reliable, the number may need manual entry.
- Distribute the APK directly — `SEND_SMS`/`RECEIVE_SMS` are restricted on the
  Play Store.

## Building the APK

See [`smsgateway-app/BUILD_APK.md`](smsgateway-app/BUILD_APK.md) — icon setup,
signing keystore, and the Gradle release build. Keep your `release.keystore`
safe; it's required to ship updates and is intentionally not committed.
