# Pushinator: Grafana Alerts

Forward your Grafana alerts to the [Pushinator](https://pushinator.com) app as real-time push
notifications — get instant alerts on your phone without checking a dashboard.

## What it does

- Connects your Grafana instance to your Pushinator account.
- Lets you create new Pushinator channels, or attach existing ones (e.g. a channel you already use
  for Shopify or Stripe alerts) directly from Grafana.
- Walks you through setting up a Grafana Alerting webhook contact point, with HMAC-signed delivery.
- Shows connection status, last event received, and per-channel delivery status.
- Optional notification prefix, prepended to every alert (e.g. `[PROD] | 3 alerts firing: ...`).

## Prerequisites

- A [Pushinator](https://pushinator.com) account and account token.
- Grafana Alerting configured with at least one alert rule.

## Setup

1. Install and enable this plugin, then open **Apps → Pushinator → Configuration**.
2. Paste your Pushinator account token and click **Connect**.
3. Create a new channel, or attach an existing Pushinator channel by its ID.
4. Click **Show webhook setup values** and use them to create a **Webhook** contact point under
   **Alerting → Contact points** (enable HMAC Signature, paste the secret, and set the signature/
   timestamp header names exactly as shown).
5. Route a notification policy to that contact point.
6. Use Grafana's own **Test** button on the contact point to confirm delivery end to end.

## Development

This plugin has two parts: this repository (the Grafana app plugin — React frontend + Go backend)
and a separate [pushinator-adapter](https://github.com/appricos/pushinator-adapter) Cloudflare
Worker that verifies signed alert webhooks and forwards them to Pushinator's own API. The plugin's
Go backend never talks to Pushinator directly — it manages this installation's settings on the
adapter over a per-installation bearer secret that's minted on first Connect and never leaves the
backend.

### Backend

```bash
mage -v build:linuxARM64   # or the target matching your platform - see `mage -l` for the full list
```

### Frontend

```bash
npm install
npm run dev         # build in watch mode
npm run build       # production build
npm run typecheck
npm run lint
```

### Run locally

```bash
npm run server       # spins up Grafana via docker compose, with this plugin loaded
```

Then open http://localhost:3000.

### Tests

```bash
npm run test:ci
npm run e2e
```

## Contributing

Issues and pull requests are welcome at
[github.com/appricos/grafana-plugin](https://github.com/appricos/grafana-plugin).

## Learn more

- [Pushinator](https://pushinator.com)
- [Grafana `plugin.json` reference](https://grafana.com/developers/plugin-tools/reference/plugin-jsonplugin-json)
