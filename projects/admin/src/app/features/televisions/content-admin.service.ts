import { Injectable, inject, signal } from '@angular/core';
import {
  Firestore,
  collection,
  deleteDoc,
  doc,
  getDocs,
  increment,
  serverTimestamp,
  writeBatch,
} from '@angular/fire/firestore';
import type { ContentListItem } from 'shared';
import { ContentUploadService, isSupportedImageFile } from './content-upload.service';
import { TelevisionEditorStore } from './television-editor.store';

export function extractYouTubeVideoId(url: URL): string | null {
  const host = url.hostname.replace(/^www\./, '');
  let candidate: string | null = null;
  if (host === 'youtu.be') candidate = url.pathname.split('/').filter(Boolean)[0] ?? null;
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    candidate =
      url.searchParams.get('v') ??
      url.pathname.match(/^\/(?:shorts|embed|live)\/([^/?]+)/)?.[1] ??
      null;
  }
  return candidate && /^[a-zA-Z0-9_-]{11}$/.test(candidate) ? candidate : null;
}

export function contentCollectionPath(
  televisionId: string,
  playlistId: string,
  libraryMode: boolean,
): string {
  return libraryMode
    ? `playlists/${playlistId}/contentItems`
    : `televisions/${televisionId}/contentItems`;
}

@Injectable({ providedIn: 'root' })
export class ContentAdminService {
  private readonly firestore = inject(Firestore);
  private readonly uploads = inject(ContentUploadService);
  private readonly editor = inject(TelevisionEditorStore);
  private readonly cache = new Map<string, ContentListItem[]>();

  readonly items = signal<ContentListItem[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');

  async load(televisionId: string, forceRefresh = false): Promise<void> {
    const playlistId = this.editor.selectedPlaylistId();
    const cacheKey = this.cacheKey(televisionId, playlistId);
    const cachedItems = this.cache.get(cacheKey);
    if (!forceRefresh && cachedItems) {
      this.items.set(cachedItems);
      this.loading.set(false);
      this.error.set('');
      return;
    }

    this.loading.set(true);
    this.error.set('');
    try {
      const libraryMode = this.editor.libraryMode();
      const snapshot = await getDocs(
        collection(this.firestore, contentCollectionPath(televisionId, playlistId, libraryMode)),
      );
      const items = snapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }) as ContentListItem)
        .filter(
          (item) =>
            libraryMode ||
            item.playlistId === playlistId ||
            (!item.playlistId && playlistId === 'default'),
        )
        .sort((a, b) => a.order - b.order);
      this.cache.set(cacheKey, items);
      this.items.set(items);
    } catch (error) {
      console.error('Unable to load content', error);
      this.error.set('Не удалось загрузить плейлист.');
    } finally {
      this.loading.set(false);
    }
  }

  async add(
    televisionId: string,
    value: {
      name: string;
      type: 'image' | 'video' | 'youtube';
      sourceUrl: string;
      durationSeconds: number;
      imageFile?: File | null;
    },
  ): Promise<void> {
    const name = value.name.trim();
    const imageFile = value.type === 'image' ? value.imageFile : null;
    if (imageFile && (!isSupportedImageFile(imageFile) || imageFile.size > 10 * 1024 * 1024)) {
      throw new Error('INVALID_IMAGE_FILE');
    }

    let storagePath: string | null = null;
    let sourceUrl = value.sourceUrl.trim();
    if (imageFile) {
      storagePath = this.uploads.createStoragePath(televisionId, imageFile);
      sourceUrl = await this.uploads.uploadImage(storagePath, imageFile);
    }

    if (!name || !sourceUrl) {
      if (storagePath) await this.uploads.deleteFile(storagePath);
      throw new Error('INVALID_CONTENT');
    }
    const parsedUrl = new URL(sourceUrl);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('INVALID_CONTENT');
    const youtubeVideoId = extractYouTubeVideoId(parsedUrl);
    const type = youtubeVideoId ? 'youtube' : value.type;
    if (type === 'youtube' && !youtubeVideoId) throw new Error('INVALID_YOUTUBE_URL');

    const playlistId = this.editor.selectedPlaylistId();
    const contentPath = contentCollectionPath(televisionId, playlistId, this.editor.libraryMode());
    const itemRef = doc(collection(this.firestore, contentPath));
    const batch = writeBatch(this.firestore);
    batch.set(itemRef, {
      name,
      type,
      sourceUrl,
      youtubeVideoId: youtubeVideoId ?? null,
      playlistId,
      order: this.items().length,
      durationSeconds: type === 'image' ? Math.max(1, value.durationSeconds) : null,
      storagePath,
      state: 'draft',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(this.firestore, `televisions/${televisionId}`), {
      updatedAt: serverTimestamp(),
    });
    try {
      await batch.commit();
    } catch (error) {
      if (storagePath) await this.uploads.deleteFile(storagePath);
      throw error;
    }
    await this.load(televisionId, true);
  }

  async delete(televisionId: string, contentId: string): Promise<void> {
    const item = this.items().find((content) => content.id === contentId);
    const itemRef = doc(
      this.firestore,
      `${contentCollectionPath(televisionId, this.editor.selectedPlaylistId(), this.editor.libraryMode())}/${contentId}`,
    );
    if (item?.state === 'published') {
      await writeBatch(this.firestore)
        .update(itemRef, { pendingDelete: true, updatedAt: serverTimestamp() })
        .commit();
    } else {
      await deleteDoc(itemRef);
      if (item?.storagePath) await this.uploads.deleteFile(item.storagePath);
    }
    await this.load(televisionId, true);
  }

  async restore(televisionId: string, contentId: string): Promise<void> {
    await writeBatch(this.firestore)
      .update(
        doc(
          this.firestore,
          `${contentCollectionPath(televisionId, this.editor.selectedPlaylistId(), this.editor.libraryMode())}/${contentId}`,
        ),
        {
          pendingDelete: false,
          updatedAt: serverTimestamp(),
        },
      )
      .commit();
    await this.load(televisionId, true);
  }

  async publish(televisionId: string): Promise<void> {
    const items = this.items();
    if (!items.length) throw new Error('EMPTY_PLAYLIST');
    const batch = writeBatch(this.firestore);
    const storagePathsToDelete: string[] = [];
    items.forEach((item, index) => {
      const itemRef = doc(
        this.firestore,
        `${contentCollectionPath(televisionId, this.editor.selectedPlaylistId(), this.editor.libraryMode())}/${item.id}`,
      );
      if (item.pendingDelete) {
        batch.delete(itemRef);
        if (item.storagePath) storagePathsToDelete.push(item.storagePath);
        return;
      }
      let youtubeVideoId = item.youtubeVideoId ?? null;
      try {
        youtubeVideoId ??= extractYouTubeVideoId(new URL(item.sourceUrl ?? ''));
      } catch {
        youtubeVideoId = null;
      }
      batch.update(itemRef, {
        order: index,
        state: 'published',
        type: youtubeVideoId ? 'youtube' : item.type,
        youtubeVideoId,
        playlistId: this.editor.selectedPlaylistId(),
        updatedAt: serverTimestamp(),
      });
    });
    batch.update(doc(this.firestore, `televisions/${televisionId}`), {
      publishedRevision: increment(1),
      publishedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
    await Promise.all(storagePathsToDelete.map((path) => this.uploads.deleteFile(path)));
    await this.load(televisionId, true);
  }

  clearTelevision(televisionId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${televisionId}:`)) this.cache.delete(key);
    }
    this.items.set([]);
  }

  private cacheKey(televisionId: string, playlistId: string): string {
    return `${televisionId}:${playlistId}`;
  }
}
