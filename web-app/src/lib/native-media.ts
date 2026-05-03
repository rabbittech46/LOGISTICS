import { Camera } from '@capacitor/camera';
import { isNativeApp } from './native';

export interface UploadablePhoto {
  id: string;
  file: File;
  previewUrl: string;
}

export async function pickNativePodPhotos(limit = 5): Promise<UploadablePhoto[]> {
  if (!isNativeApp()) {
    return [];
  }

  const selection = await Camera.pickImages({
    quality: 80,
    limit,
  });

  const timestamp = Date.now();
  const photos = await Promise.all(
    selection.photos.map(async (photo, index) => {
      const source = photo.webPath ?? photo.path;
      if (!source) {
        return null;
      }

      const response = await fetch(source);
      const blob = await response.blob();
      const mimeType = blob.type || 'image/jpeg';
      if (!mimeType.includes('jpeg')) {
        return null;
      }

      const file = new File([blob], `pod-${timestamp}-${index}.jpg`, {
        type: 'image/jpeg',
        lastModified: timestamp,
      });

      return {
        id: `pod-${timestamp}-${index}`,
        file,
        previewUrl: photo.webPath ?? URL.createObjectURL(file),
      } satisfies UploadablePhoto;
    }),
  );

  return photos.filter((photo): photo is UploadablePhoto => photo !== null);
}