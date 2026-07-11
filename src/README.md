# Pushinator

Forward your Grafana alerts to the [Pushinator](https://pushinator.com) app as real-time push
notifications — get instant alerts on your phone without checking a dashboard.

## Overview

Pushinator connects your Grafana instance to your Pushinator account so that firing and resolved
alerts show up as push notifications, not just in Grafana's own UI. You can send alerts to a brand
new Pushinator channel created straight from Grafana, or attach a channel you already use for
another integration (e.g. Shopify or Stripe) so the same phone/team gets everything in one place.

Connecting doesn't require any manual API tokens on the Grafana side beyond your own Pushinator
account token — the plugin handles registering itself with the delivery backend and walks you
through configuring a signed webhook contact point in Grafana Alerting.

## Requirements

- A [Pushinator](https://pushinator.com) account and account token.
- Grafana Alerting configured with at least one alert rule.

## Getting Started

1. Install and enable this plugin, then open **Apps → Pushinator → Configuration**.
2. Paste your Pushinator account token and click **Connect**.
3. Create a new channel, or attach an existing Pushinator channel by its ID.
4. Click **Show webhook setup values** and use them to create a **Webhook** contact point under
   **Alerting → Contact points** (enable HMAC Signature, paste the secret, and set the signature/
   timestamp header names exactly as shown).
5. Route a notification policy to that contact point.
6. Use Grafana's own **Test** button on the contact point to confirm delivery end to end.

## Documentation

- [Pushinator](https://pushinator.com)
- [Source code and issue tracker](https://github.com/appricos/grafana-plugin)

## Contributing

Issues and pull requests are welcome at
[github.com/appricos/grafana-plugin](https://github.com/appricos/grafana-plugin).
