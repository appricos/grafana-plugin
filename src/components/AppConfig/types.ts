export const SELECTABLE_TOPICS = ['firing', 'resolved'] as const;
export type Topic = (typeof SELECTABLE_TOPICS)[number];

export type Channel = {
  id: string;
  name: string;
  description?: string;
  topics: Topic[];
  acknowledgmentEnabled: boolean;
  subscribeUrl?: string;
  lastDeliveryStatus?: string;
};

export type StatusResponse = {
  connected: boolean;
  accountId?: string;
  tokenSet?: boolean;
  tokenLast4?: string;
  lastEventAt?: string | null;
  notificationPrefix?: string;
};

export type ConnectResponse = {
  accountId: string;
  // Only present in the response to the very first Connect call - see api.ts.
  managementSecret?: string;
  tokenLast4?: string;
};

export type UpsertChannelRequest = {
  name: string;
  description?: string;
  topics: Topic[];
  acknowledgmentEnabled: boolean;
};

export type AttachChannelRequest = {
  pushinatorChannelId: string;
  topics: Topic[];
  acknowledgmentEnabled: boolean;
};

// Everything needed to manually configure a Grafana Alerting webhook contact point pointed at
// this installation - the primary setup path for most installs (autoprovisioning needs a
// Public-preview, off-by-default Grafana feature toggle, so isn't the common case).
export type WebhookConfig = {
  webhookUrl: string;
  signatureHeader: string;
  timestampHeader: string;
  secret: string;
};

// The non-secret half of this plugin installation's settings (AppInstanceSettings.JSONData).
export type AppJsonData = {
  accountId?: string;
};
