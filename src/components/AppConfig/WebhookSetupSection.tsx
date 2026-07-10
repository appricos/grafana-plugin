import React, { useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Button, ClipboardButton, Field, FieldSet, Input, useStyles2 } from '@grafana/ui';
import { extractErrorMessage, getWebhookConfig } from './api';
import { WebhookConfig } from './types';

type Props = {
  pluginId: string;
  onError: (message: string) => void;
};

/**
 * Manual webhook setup instructions - the primary path for most installs, not a rare fallback:
 * automatic contact point provisioning needs Grafana's `externalServiceAccounts` feature toggle,
 * which is Public preview and off by default, so most admins will land here.
 *
 * The webhook secret is fetched on demand (button click) rather than loaded alongside the rest
 * of the page, so it doesn't transit the network on every page view - only when actually needed.
 */
export function WebhookSetupSection({ pluginId, onError }: Props) {
  const s = useStyles2(getStyles);
  const [config, setConfig] = useState<WebhookConfig | null>(null);
  const [loading, setLoading] = useState(false);

  const reveal = async () => {
    setLoading(true);
    try {
      setConfig(await getWebhookConfig(pluginId));
    } catch (e) {
      onError(extractErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <FieldSet label="Webhook setup">
      <p className={s.instructions}>
        In Grafana, go to <strong>Alerting → Contact points → New contact point</strong>, choose{' '}
        <strong>Webhook</strong>, and fill in the values below. Then add a{' '}
        <strong>notification policy</strong> routing alerts to it.
      </p>

      {!config ? (
        <Button onClick={reveal} disabled={loading} variant="secondary">
          Show webhook setup values
        </Button>
      ) : (
        <>
          <Field label="URL">
            <div className={s.copyRow}>
              <Input readOnly value={config.webhookUrl} width={60} />
              <ClipboardButton icon="copy" getText={() => config.webhookUrl} variant="secondary" aria-label="Copy webhook URL" />
            </div>
          </Field>
          <Field label="HTTP Method">
            <Input readOnly value="POST" width={20} />
          </Field>
          <Field label='Enable "HMAC Signature", then Secret'>
            <div className={s.copyRow}>
              <Input readOnly value={config.secret} width={60} />
              <ClipboardButton icon="copy" getText={() => config.secret} variant="secondary" aria-label="Copy webhook secret" />
            </div>
          </Field>
          <Field label="Signature header" description="Grafana's default - only change this if you customize it there.">
            <Input readOnly value={config.signatureHeader} width={40} />
          </Field>
          <Field label="Timestamp header" description="Optional in Grafana, but required here for replay protection.">
            <Input readOnly value={config.timestampHeader} width={40} />
          </Field>
        </>
      )}
    </FieldSet>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  instructions: css`
    color: ${theme.colors.text.secondary};
    max-width: 640px;
  `,
  copyRow: css`
    display: flex;
    gap: ${theme.spacing(1)};
    align-items: center;
  `,
});
