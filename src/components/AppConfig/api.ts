import { lastValueFrom } from 'rxjs';
import { PluginMeta } from '@grafana/data';
import { getBackendSrv } from '@grafana/runtime';
import { AttachChannelRequest, Channel, ConnectResponse, StatusResponse, UpsertChannelRequest } from './types';

async function callResource<T>(pluginId: string, method: string, path: string, data?: unknown): Promise<T> {
  const response = await getBackendSrv().fetch<T>({
    url: `api/plugins/${pluginId}/resources${path}`,
    method,
    data,
  });
  const result = await lastValueFrom(response);
  return result.data;
}

export const getStatus = (pluginId: string) => callResource<StatusResponse>(pluginId, 'GET', '/status');

export const connect = (pluginId: string, token: string) =>
  callResource<ConnectResponse>(pluginId, 'POST', '/connect', { token });

export const setToken = (pluginId: string, token: string) =>
  callResource<{ tokenLast4: string }>(pluginId, 'POST', '/token', { token });

export const setPrefix = (pluginId: string, prefix: string) =>
  callResource<{ prefix: string }>(pluginId, 'POST', '/prefix', { prefix });

export const listChannels = (pluginId: string) => callResource<Channel[]>(pluginId, 'GET', '/channels');

export const createChannel = (pluginId: string, req: UpsertChannelRequest) =>
  callResource<Channel>(pluginId, 'POST', '/channels', req);

export const attachChannel = (pluginId: string, req: AttachChannelRequest) =>
  callResource<Channel>(pluginId, 'POST', '/channels/attach', req);

export const updateChannel = (pluginId: string, id: string, req: UpsertChannelRequest) =>
  callResource<Channel>(pluginId, 'PUT', `/channels/${id}`, req);

export const deleteChannel = (pluginId: string, id: string) => callResource<void>(pluginId, 'DELETE', `/channels/${id}`);

export const disconnectAccount = (pluginId: string) => callResource<void>(pluginId, 'POST', '/disconnect');

export async function persistPluginSettings(pluginId: string, data: Partial<PluginMeta>) {
  const response = await getBackendSrv().fetch({
    url: `/api/plugins/${pluginId}/settings`,
    method: 'POST',
    data,
  });
  return lastValueFrom(response);
}

// Grafana rejects the fetch() observable on a non-2xx resource response, with the
// backend's own JSON body attached under `.data`. Our resource handlers always
// respond with `{"error": "..."}` on failure (see pkg/plugin/resources.go), so
// surface that message rather than a generic one.
export function extractErrorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === 'object' && 'error' in data) {
      const message = (data as { error: unknown }).error;
      if (typeof message === 'string' && message) {
        return message;
      }
    }
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message) {
      return message;
    }
  }
  return 'Something went wrong. Please try again.';
}
