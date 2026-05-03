import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { isNativeApp } from './native';

export async function triggerSuccessHaptic(): Promise<void> {
  if (!isNativeApp()) {
    return;
  }

  await Haptics.notification({ type: NotificationType.Success }).catch(() => {});
}

export async function triggerErrorHaptic(): Promise<void> {
  if (!isNativeApp()) {
    return;
  }

  await Haptics.notification({ type: NotificationType.Error }).catch(() => {});
}

export async function triggerTapHaptic(): Promise<void> {
  if (!isNativeApp()) {
    return;
  }

  await Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
}