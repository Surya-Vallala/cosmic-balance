// Share a message (an invite link, a reminder) the best way the device allows.
import { Platform, Share } from 'react-native';

export type ShareResult = 'shared' | 'copied' | 'failed';

export async function shareText(message: string): Promise<ShareResult> {
  if (Platform.OS === 'web') {
    const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { share?: (d: ShareData) => Promise<void> }) : undefined;
    if (nav?.share) {
      try {
        await nav.share({ text: message });
        return 'shared';
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return 'shared'; // closed the share sheet
      }
    }
    try {
      await navigator.clipboard.writeText(message);
      return 'copied';
    } catch {
      return 'failed';
    }
  }
  try {
    await Share.share({ message });
    return 'shared';
  } catch {
    return 'failed';
  }
}
