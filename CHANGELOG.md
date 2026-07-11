# Changelog

## 1.0.0 (Unreleased)

### Features

- Connect a Grafana instance to a Pushinator account.
- Manage Pushinator channels from Grafana: create a new channel, attach an existing one by ID,
  edit topics/acknowledgment, view details with a QR code, or delete (unlinks a channel that's
  shared with another integration instead of deleting it outright).
- Guided manual setup for a Grafana Alerting webhook contact point, with HMAC-signed delivery.
- Optional notification prefix, prepended to every alert.
- Disconnect, which fully removes this installation's data from the adapter.
