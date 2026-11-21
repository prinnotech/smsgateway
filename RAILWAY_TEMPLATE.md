# Publishing the Railway template

A live demo already runs on Railway (one service, built from the root
`Dockerfile`). To give **everyone** a one-click "Deploy on Railway" button that
reproduces it without touching this (private) repo, we publish a template that
deploys the public image instead.

Everything below the two one-time steps is already done:
- ✅ The all-in-one image is published to `ghcr.io/prinnotech/smsgateway:latest`
  (rebuilt automatically on every GitHub release by
  `.github/workflows/docker-publish.yml`).
- ✅ The README has the download + deploy sections ready for the button.

## Step 1 — make the image public (once)

GHCR packages are private by default. Make it public so anyone can deploy it:

1. Open <https://github.com/users/prinnotech/packages/container/smsgateway/settings>
2. **Danger Zone → Change visibility → Public** → confirm.

(Repo stays private; only the built image is public.)

## Step 2 — publish the template (once)

1. Go to <https://railway.com/compose> (or Dashboard → **+ New** → **Template**).
2. Add one service, **Source → Docker Image**:
   `ghcr.io/prinnotech/smsgateway:latest`
3. **Variables** (mark both as required, no default so the deployer must set them):
   - `POCKETBASE_ADMIN_EMAIL`
   - `POCKETBASE_ADMIN_PASSWORD`
4. **Volume**: mount path `/pb/pb_data`.
5. Name it "SMS Gateway", add a short description, **Publish**.
6. Copy the template code from the URL
   (`https://railway.com/new/template/XXXXXX` → `XXXXXX`).

Send me the code and I'll drop the button into the README (replacing the
`<!-- RAILWAY_BUTTON -->` marker):

```markdown
[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template/XXXXXX?utm_medium=integration&utm_source=button&utm_campaign=smsgateway)
```

## Template summary (what it provisions)

| Setting | Value |
| ------- | ----- |
| Image | `ghcr.io/prinnotech/smsgateway:latest` |
| Volume | `/pb/pb_data` (SQLite data — persists across redeploys) |
| Variable | `POCKETBASE_ADMIN_EMAIL` (required) |
| Variable | `POCKETBASE_ADMIN_PASSWORD` (required) |
| Port | auto (`$PORT`, the panel listens on it) |

On first boot the container creates the superuser from those variables, applies
the migrations (creating all tables), starts PocketBase on `127.0.0.1:8090`, and
serves the panel — which proxies PocketBase at `/pb`. One service, one URL.

> Alternative: if you'd rather make the **repo** public, you can skip the image
> entirely and publish the template straight from the repo (Source → GitHub repo,
> root `Dockerfile`). Same volume + variables.
