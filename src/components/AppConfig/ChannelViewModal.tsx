import React from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Button, LoadingPlaceholder, Modal, useStyles2 } from '@grafana/ui';
import { useQrDataUrl } from './useQrDataUrl';
import { Channel } from './types';

type Props = {
  channel: Channel;
  onDismiss: () => void;
};

const QR_SIZE = 280;

/** Full channel details + a larger QR code - mirrors shopify-app's channel detail page (minus
 * the editable form, which stays in this plugin's separate edit modal). */
export function ChannelViewModal({ channel, onDismiss }: Props) {
  const s = useStyles2(getStyles);
  const dataUrl = useQrDataUrl(channel.subscribeUrl, QR_SIZE);

  return (
    <Modal title={channel.name} isOpen onDismiss={onDismiss}>
      <div className={s.details}>
        {channel.description && <p>{channel.description}</p>}
        <dl className={s.definitionList}>
          <dt>Topics</dt>
          <dd>{channel.topics.length > 0 ? channel.topics.join(', ') : 'none'}</dd>
          <dt>Acknowledgment</dt>
          <dd>{channel.acknowledgmentEnabled ? 'Required' : 'Not required'}</dd>
          {channel.lastDeliveryStatus && (
            <>
              <dt>Last delivery status</dt>
              <dd>{channel.lastDeliveryStatus}</dd>
            </>
          )}
        </dl>
      </div>

      <div className={s.center}>
        <h4>Subscribe in the Pushinator app</h4>
        {dataUrl ? (
          <img
            src={dataUrl}
            width={QR_SIZE}
            height={QR_SIZE}
            alt={`QR code to subscribe to ${channel.name} in the Pushinator app`}
          />
        ) : (
          <LoadingPlaceholder text="Generating QR code..." />
        )}
        <p className={s.caption}>
          Scan this code in the Pushinator app to receive alerts sent to this channel. Anyone who scans it - not
          just one person - will get the alerts.
        </p>
      </div>

      <Modal.ButtonRow>
        <Button onClick={onDismiss}>Close</Button>
      </Modal.ButtonRow>
    </Modal>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  details: css`
    margin-bottom: ${theme.spacing(3)};
  `,
  definitionList: css`
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: ${theme.spacing(2)};
    row-gap: ${theme.spacing(0.5)};

    dt {
      color: ${theme.colors.text.secondary};
    }
  `,
  center: css`
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: ${theme.spacing(2)};
  `,
  caption: css`
    color: ${theme.colors.text.secondary};
    text-align: center;
    max-width: 400px;
  `,
});
