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

// The non-secret half of this plugin installation's settings (AppInstanceSettings.JSONData).
export type AppJsonData = {
  accountId?: string;
};
