import { Injectable, inject, signal } from '@angular/core';
import { Firestore, collection, doc, getDoc, getDocs, writeBatch } from '@angular/fire/firestore';
import type { ContentListItem, TelevisionListItem } from 'shared';
import { ContentUploadService } from './content-upload.service';

@Injectable({ providedIn: 'root' })
export class TelevisionAdminService {
  private readonly firestore = inject(Firestore);
  private readonly uploads = inject(ContentUploadService);

  readonly televisions = signal<TelevisionListItem[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');

  constructor() {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const snapshot = await getDocs(collection(this.firestore, 'televisions'));
      this.televisions.set(
        snapshot.docs
          .map((item) => ({ id: item.id, ...item.data() }) as TelevisionListItem)
          .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
      );
    } catch (error) {
      console.error('Unable to load televisions', error);
      this.error.set('Не удалось загрузить список. Нажмите «Обновить».');
    } finally {
      this.loading.set(false);
    }
  }

  async get(televisionId: string): Promise<TelevisionListItem | null> {
    const snapshot = await getDoc(doc(this.firestore, `televisions/${televisionId}`));
    return snapshot.exists()
      ? ({ id: snapshot.id, ...snapshot.data() } as TelevisionListItem)
      : null;
  }

  async delete(television: TelevisionListItem): Promise<void> {
    const contentSnapshot = await getDocs(
      collection(this.firestore, `televisions/${television.id}/contentItems`),
    );
    const storagePaths = contentSnapshot.docs
      .map((item) => (item.data() as ContentListItem).storagePath)
      .filter((path): path is string => !!path);

    for (let index = 0; index < contentSnapshot.docs.length; index += 450) {
      const batch = writeBatch(this.firestore);
      contentSnapshot.docs.slice(index, index + 450).forEach((item) => batch.delete(item.ref));
      await batch.commit();
    }

    const finalBatch = writeBatch(this.firestore);
    finalBatch.delete(doc(this.firestore, `pairingRequests/${television.deviceId}`));
    finalBatch.delete(doc(this.firestore, `televisions/${television.id}`));
    await finalBatch.commit();
    await Promise.all(storagePaths.map((path) => this.uploads.deleteFile(path)));
    await this.refresh();
  }
}
