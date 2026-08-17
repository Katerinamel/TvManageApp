import { Injectable, inject } from '@angular/core';
import {
  Storage,
  deleteObject,
  getDownloadURL,
  ref as storageRef,
  uploadBytesResumable,
} from '@angular/fire/storage';

const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const SUPPORTED_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);

export function isSupportedImageFile(file: File): boolean {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return (
    SUPPORTED_IMAGE_TYPES.has(file.type.toLowerCase()) || SUPPORTED_IMAGE_EXTENSIONS.has(extension)
  );
}

@Injectable({ providedIn: 'root' })
export class ContentUploadService {
  private readonly storage = inject(Storage);

  createStoragePath(televisionId: string, file: File): string {
    const extension =
      file.name
        .split('.')
        .pop()
        ?.toLowerCase()
        .replace(/[^a-z0-9]/g, '') ?? '';
    return `televisions/${televisionId}/content/${crypto.randomUUID()}${extension ? `.${extension}` : ''}`;
  }

  async deleteFile(path: string): Promise<void> {
    try {
      await deleteObject(storageRef(this.storage, path));
    } catch (error) {
      console.warn('Unable to delete content file', path, error);
    }
  }

  async uploadImage(path: string, file: File): Promise<string> {
    if (!navigator.onLine) throw this.networkError();

    const fileRef = storageRef(this.storage, path);
    const task = uploadBytesResumable(fileRef, file, { contentType: file.type });

    return new Promise<string>((resolve, reject) => {
      let settled = false;
      const finish = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        window.removeEventListener('offline', handleOffline);
        callback();
      };
      const handleOffline = (): void => {
        void task.cancel();
        finish(() => reject(this.networkError()));
      };
      const timeoutId = window.setTimeout(() => {
        void task.cancel();
        finish(() => reject(this.networkError()));
      }, 15_000);

      window.addEventListener('offline', handleOffline);
      task.on(
        'state_changed',
        undefined,
        (error) => finish(() => reject(error)),
        () => {
          void getDownloadURL(fileRef).then(
            (url) => finish(() => resolve(url)),
            (error) => finish(() => reject(error)),
          );
        },
      );
    });
  }

  private networkError(): Error & { code: string } {
    return Object.assign(new Error('STORAGE_NETWORK_UNAVAILABLE'), {
      code: 'storage/network-unavailable',
    });
  }
}
