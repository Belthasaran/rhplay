import { showAlert, showTwitchReauthChoice, type TwitchReauthChoice } from './dialogs';

export type TwitchOAuthMode = 'external' | 'embedded';

export { type TwitchReauthChoice };

function isElectronAvailable(): boolean {
  return typeof window !== 'undefined' && !!(window as any).electronAPI;
}

export async function runTwitchOAuth(
  mode: TwitchOAuthMode = 'external'
): Promise<{ success: boolean; error?: string; twitch_username?: string }> {
  if (!isElectronAvailable()) {
    return { success: false, error: 'Electron not available' };
  }

  try {
    const result = await (window as any).electronAPI.openTwitchOAuth({ mode });
    if (result?.success) {
      return { success: true, twitch_username: result.twitch_username };
    }
    return { success: false, error: result?.error || 'OAuth failed' };
  } catch (error: any) {
    return { success: false, error: error?.message || 'OAuth failed' };
  }
}

export async function promptTwitchReauthentication(reason?: string): Promise<TwitchReauthChoice> {
  const message = reason
    ? `${reason}\n\nChoose how to re-authenticate with Twitch.`
    : 'Your Twitch token needs to be refreshed before predictions can be used.\n\nChoose how to re-authenticate with Twitch.';
  return showTwitchReauthChoice(message, 'Twitch Re-authentication Required');
}

export async function handleTwitchReauthChoice(
  choice: TwitchReauthChoice
): Promise<{ success: boolean; error?: string; openedSetup?: boolean }> {
  if (choice === 'cancel') {
    return { success: false };
  }

  const mode: TwitchOAuthMode = choice === 'system_browser' ? 'external' : 'embedded';
  const result = await runTwitchOAuth(mode);
  if (!result.success && result.error) {
    await showAlert(`Failed to complete Twitch authorization: ${result.error}`, 'OAuth Error');
  }
  return result;
}
