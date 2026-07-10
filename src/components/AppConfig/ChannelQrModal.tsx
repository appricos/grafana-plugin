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

const QR_SIZE = 220;

/** Quick "scan to subscribe" modal, triggered by the QR icon next to a channel's name - mirrors
 * shopify-app's equivalent list-page modal (channel name as title, a caption, Close). */
export function ChannelQrModal({ channel, onDismiss }: Props) {
  const s = useStyles2(getStyles);
  const dataUrl = useQrDataUrl(channel.subscribeUrl, QR_SIZE);

  return (
    <Modal title={channel.name} isOpen onDismiss={onDismiss}>
      <div className={s.center}>
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
        <p className={s.caption}>Scan this in the Pushinator app to subscribe to this channel.</p>
      </div>
      <Modal.ButtonRow>
        <Button onClick={onDismiss}>Close</Button>
      </Modal.ButtonRow>
    </Modal>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  center: css`
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: ${theme.spacing(2)};
  `,
  caption: css`
    color: ${theme.colors.text.secondary};
    text-align: center;
    max-width: 320px;
  `,
});
