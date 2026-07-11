import React, { useEffect, useState } from 'react';
import { css } from '@emotion/css';
import { AppPluginMeta, GrafanaTheme2, PluginConfigPageProps } from '@grafana/data';
import { Alert, Button, ConfirmModal, Field, FieldSet, Input, LoadingPlaceholder, SecretInput, useStyles2 } from '@grafana/ui';
import { testIds } from '../testIds';
import { ChannelsSection } from './ChannelsSection';
import { WebhookSetupSection } from './WebhookSetupSection';
import {
  connect,
  disconnectAccount,
  extractErrorMessage,
  getStatus,
  listChannels,
  persistPluginSettings,
  setPrefix,
  setToken,
} from './api';
import { AppJsonData, Channel, StatusResponse } from './types';

export interface AppConfigProps extends PluginConfigPageProps<AppPluginMeta<AppJsonData>> {}

const AppConfig = ({ plugin }: AppConfigProps) => {
  const s = useStyles2(getStyles);
  const pluginId = plugin.meta.id;

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [tokenInput, setTokenInput] = useState('');
  const [connecting, setConnecting] = useState(false);

  const [prefixInput, setPrefixInput] = useState('');
  const [savingPrefix, setSavingPrefix] = useState(false);

  const [updateTokenInput, setUpdateTokenInput] = useState('');
  const [savingToken, setSavingToken] = useState(false);

  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  // No synchronous setState before the first await, so this is safe to call
  // directly from the mount effect below without tripping
  // react-hooks/set-state-in-effect - error/loading handling around the initial
  // load lives in the effect itself instead.
  const refreshStatusAndChannels = async () => {
    const nextStatus = await getStatus(pluginId);
    setStatus(nextStatus);
    setPrefixInput(nextStatus.notificationPrefix ?? '');
    setChannels(nextStatus.connected ? await listChannels(pluginId) : []);
  };

  useEffect(() => {
    // A one-time fetch on mount, not derived state - the canonical use of an
    // effect per https://react.dev/learn/you-might-not-need-an-effect, which
    // react-hooks/set-state-in-effect flags anyway (as of eslint-plugin-react-hooks
    // 7.0.0) since it can't distinguish this from the anti-pattern it targets.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshStatusAndChannels()
      .catch((e) => setError(extractErrorMessage(e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);
    try {
      const result = await connect(pluginId, tokenInput);
      if (result.managementSecret) {
        // First-time bootstrap: persist the freshly-issued secret into this
        // installation's own encrypted secureJsonData. This is the only way to
        // get it there - Grafana has no backend-to-backend API for a plugin to
        // write its own settings, only the admin's authenticated browser session
        // can call /api/plugins/:id/settings.
        await persistPluginSettings(pluginId, {
          enabled: plugin.meta.enabled,
          pinned: plugin.meta.pinned,
          jsonData: { accountId: result.accountId },
          secureJsonData: { managementSecret: result.managementSecret },
        });
        window.location.reload();
        return;
      }
      await refreshStatusAndChannels();
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setConnecting(false);
    }
  };

  const handleSavePrefix = async () => {
    setSavingPrefix(true);
    setError(null);
    try {
      await setPrefix(pluginId, prefixInput.trim());
      await refreshStatusAndChannels();
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setSavingPrefix(false);
    }
  };

  const handleUpdateToken = async () => {
    setSavingToken(true);
    setError(null);
    try {
      await setToken(pluginId, updateTokenInput);
      setUpdateTokenInput('');
      await refreshStatusAndChannels();
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setSavingToken(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    setError(null);
    try {
      await disconnectAccount(pluginId);
      // Full delete, not a status flag: clear this installation's settings too,
      // so a reinstall/reconnect looks exactly like a first connect.
      await persistPluginSettings(pluginId, {
        enabled: plugin.meta.enabled,
        pinned: plugin.meta.pinned,
        jsonData: {},
        secureJsonData: { managementSecret: '' },
      });
      window.location.reload();
    } catch (e) {
      setError(extractErrorMessage(e));
      setDisconnecting(false);
      setConfirmingDisconnect(false);
    }
  };

  if (loading) {
    return <LoadingPlaceholder text="Loading..." />;
  }

  return (
    <div>
      {error && (
        <Alert title="Error" severity="error" onRemove={() => setError(null)}>
          {error}
        </Alert>
      )}

      {!status?.connected ? (
        <FieldSet label="Connect to Pushinator">
          <Field label="Pushinator account token" description="Find this in your Pushinator account settings.">
            <SecretInput
              width={60}
              data-testid={testIds.appConfig.connectTokenInput}
              value={tokenInput}
              isConfigured={false}
              placeholder="Your Pushinator account token"
              onChange={(e) => setTokenInput(e.currentTarget.value)}
              onReset={() => setTokenInput('')}
            />
          </Field>
          <Button data-testid={testIds.appConfig.connectButton} onClick={handleConnect} disabled={!tokenInput || connecting}>
            Connect
          </Button>
        </FieldSet>
      ) : (
        <>
          <Alert
            title={status.tokenSet ? 'Connected' : 'Connected, but no Pushinator token is set'}
            severity={status.tokenSet ? 'success' : 'warning'}
          >
            {status.lastEventAt
              ? `Last event received: ${new Date(status.lastEventAt).toLocaleString()}`
              : 'No events received yet.'}
          </Alert>

          <FieldSet label="Notification prefix">
            <Field
              label="Prefix"
              description={'Prepended to every notification as "<prefix> | <message>". Leave empty for no prefix.'}
            >
              <Input
                width={60}
                data-testid={testIds.appConfig.prefixInput}
                value={prefixInput}
                onChange={(e) => setPrefixInput(e.currentTarget.value)}
                placeholder="e.g. [PROD]"
              />
            </Field>
            <Button
              data-testid={testIds.appConfig.savePrefixButton}
              onClick={handleSavePrefix}
              disabled={savingPrefix || prefixInput === (status.notificationPrefix ?? '')}
            >
              Save prefix
            </Button>
          </FieldSet>

          <FieldSet label="Pushinator account token">
            <Field label="Token" description={status.tokenLast4 ? `Currently set, ending in ${status.tokenLast4}` : 'Not set'}>
              <SecretInput
                width={60}
                value={updateTokenInput}
                isConfigured={Boolean(status.tokenSet)}
                placeholder="New Pushinator account token"
                onChange={(e) => setUpdateTokenInput(e.currentTarget.value)}
                onReset={() => setUpdateTokenInput('')}
              />
            </Field>
            <Button onClick={handleUpdateToken} disabled={!updateTokenInput || savingToken}>
              Update token
            </Button>
          </FieldSet>

          <WebhookSetupSection pluginId={pluginId} onError={setError} />

          <ChannelsSection pluginId={pluginId} channels={channels} onChanged={refreshStatusAndChannels} onError={setError} />

          <div className={s.marginTop}>
            <Button
              data-testid={testIds.appConfig.disconnectButton}
              variant="destructive"
              onClick={() => setConfirmingDisconnect(true)}
              disabled={disconnecting}
            >
              Disconnect
            </Button>
          </div>

          <ConfirmModal
            isOpen={confirmingDisconnect}
            title="Disconnect Pushinator"
            body="This permanently deletes your Pushinator token and all channels configured from this Grafana instance. This cannot be undone."
            confirmText="Disconnect"
            confirmButtonVariant="destructive"
            disabled={disconnecting}
            onConfirm={handleDisconnect}
            onDismiss={() => setConfirmingDisconnect(false)}
          />
        </>
      )}
    </div>
  );
};

export default AppConfig;

const getStyles = (theme: GrafanaTheme2) => ({
  marginTop: css`
    margin-top: ${theme.spacing(3)};
  `,
});
