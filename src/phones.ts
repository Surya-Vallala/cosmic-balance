// Friends' phone numbers, kept on this phone only (never in the shared
// database), so the WhatsApp invite can open their chat directly.
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'cosmic-khaata:phones';

async function readAll(): Promise<Record<string, string>> {
  try {
    return JSON.parse((await AsyncStorage.getItem(KEY)) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

export async function rememberPhone(personId: string, phone: string | null | undefined): Promise<void> {
  if (!phone) return;
  const all = await readAll();
  all[personId] = phone;
  await AsyncStorage.setItem(KEY, JSON.stringify(all)).catch(() => {});
}

export async function phonesFor(personIds: string[]): Promise<Record<string, string>> {
  const all = await readAll();
  return Object.fromEntries(personIds.filter((id) => all[id]).map((id) => [id, all[id]]));
}
