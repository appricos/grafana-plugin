import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/**
 * Generates a QR code as a data URL for the given text, client-side (this plugin's frontend has
 * no server-side rendering step to do it ahead of time, unlike shopify-app's Remix loaders).
 * Mirrors shopify-app's `QRCode.toDataURL(url, { margin: 1, width })` call exactly, just moved
 * into an effect since there's no loader to run it in here.
 */
export function useQrDataUrl(text: string | undefined, width: number): string | null {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!text) {
      // Resetting derived state when the input disappears (e.g. the channel prop changes) - a
      // legitimate use of an effect, not the derived-state anti-pattern
      // react-hooks/set-state-in-effect is meant to catch (see AppConfig.tsx's mount-fetch effect
      // for the same reasoning).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(text, { margin: 1, width })
      .then((url) => {
        if (!cancelled) {
          setDataUrl(url);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDataUrl(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [text, width]);

  return dataUrl;
}
