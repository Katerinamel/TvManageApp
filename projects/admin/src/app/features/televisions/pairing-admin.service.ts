import { Injectable, inject, signal } from '@angular/core';
import {
  Firestore,
  Timestamp,
  collection,
  collectionData,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from '@angular/fire/firestore';
import {
  Storage,
  deleteObject,
  getDownloadURL,
  ref as storageRef,
  uploadBytesResumable,
} from '@angular/fire/storage';
import { Observable, map } from 'rxjs';

export interface PendingPairingRequest {
  deviceId: string;
  code: string;
  expiresAt: Timestamp;
}

export interface TelevisionListItem {
  id: string;
  name: string;
  deviceId: string;
  pairingStatus: 'paired' | 'unpaired';
  playlists?: PlaylistSummary[];
  activePlaylistId?: string;
  broadcastEnabled?: boolean;
}

export interface PlaylistSummary {
  id: string;
  name: string;
}

export interface ContentListItem {
  id: string;
  name: string;
  type: 'image' | 'video' | 'youtube';
  sourceUrl: string;
  youtubeVideoId?: string;
  order: number;
  durationSeconds?: number;
  state: 'draft' | 'published';
  playlistId?: string;
  pendingDelete?: boolean;
  storagePath?: string;
}

const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const SUPPORTED_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);

export function isSupportedImageFile(file: File): boolean {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return SUPPORTED_IMAGE_TYPES.has(file.type.toLowerCase()) || SUPPORTED_IMAGE_EXTENSIONS.has(extension);
}

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

@Injectable({ providedIn: 'root' })
export class PairingAdminService {
  private readonly firestore = inject(Firestore);
  private readonly storage = inject(Storage);
  private readonly contentCache = new Map<string, ContentListItem[]>();

  readonly televisions = signal<TelevisionListItem[]>([]);
  readonly televisionsLoading = signal(true);
  readonly televisionsError = signal('');
  readonly contentItems = signal<ContentListItem[]>([]);
  readonly contentLoading = signal(false);
  readonly contentError = signal('');
  readonly playlists = signal<PlaylistSummary[]>([]);
  readonly selectedPlaylistId = signal('default');
  readonly activePlaylistId = signal('default');
  readonly broadcastEnabled = signal(true);

  readonly pendingRequests$: Observable<PendingPairingRequest[]> = collectionData(
    query(collection(this.firestore, 'pairingRequests'), where('status', '==', 'pending')),
  ).pipe(
    map((requests) =>
      (requests as PendingPairingRequest[])
        .filter((request) => request.expiresAt.toMillis() > Date.now())
        .sort((a, b) => a.expiresAt.toMillis() - b.expiresAt.toMillis()),
    ),
  );

  constructor() {
    void this.refreshTelevisions();
  }

  async refreshTelevisions(): Promise<void> {
    this.televisionsLoading.set(true);
    this.televisionsError.set('');
    try {
      const snapshot = await getDocs(collection(this.firestore, 'televisions'));
      this.televisions.set(
        snapshot.docs
          .map((item) => ({ id: item.id, ...item.data() }) as TelevisionListItem)
          .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
      );
    } catch (error) {
      console.error('Unable to load televisions', error);
      this.televisionsError.set('Не удалось загрузить список. Нажмите «Обновить».');
    } finally {
      this.televisionsLoading.set(false);
    }
  }

  async getTelevision(televisionId: string): Promise<TelevisionListItem | null> {
    const snapshot = await getDoc(doc(this.firestore, `televisions/${televisionId}`));
    return snapshot.exists()
      ? ({ id: snapshot.id, ...snapshot.data() } as TelevisionListItem)
      : null;
  }

  async pair(codeInput: string, nameInput: string): Promise<void> {
    const code = codeInput.replace(/\D/g, '');
    const name = nameInput.trim();
    if (code.length !== 6 || !name) throw new Error('INVALID_INPUT');

    const matches = await getDocs(
      query(collection(this.firestore, 'pairingRequests'), where('code', '==', code)),
    );
    const match = matches.docs.find((item) => {
      const data = item.data() as { status?: string; expiresAt?: Timestamp };
      return data.status === 'pending' && !!data.expiresAt && data.expiresAt.toMillis() > Date.now();
    });
    if (!match) throw new Error('PAIRING_NOT_FOUND');

    const request = match.data() as PendingPairingRequest;
    const televisionRef = doc(collection(this.firestore, 'televisions'));
    const batch = writeBatch(this.firestore);
    batch.set(televisionRef, {
      deviceId: request.deviceId,
      name,
      orientation: 'landscape',
      pairingStatus: 'paired',
      publishedRevision: 0,
      playlists: [{ id: 'default', name: 'Основной' }],
      activePlaylistId: 'default',
      broadcastEnabled: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.update(match.ref, {
      status: 'paired',
      pairedTelevisionId: televisionRef.id,
    });
    await batch.commit();
    await this.refreshTelevisions();
  }

  async loadContent(televisionId: string, forceRefresh = false): Promise<void> {
    const selectedPlaylistId = this.selectedPlaylistId();
    const cacheKey = this.contentCacheKey(televisionId, selectedPlaylistId);
    const cachedItems = this.contentCache.get(cacheKey);
    if (!forceRefresh && cachedItems) {
      this.contentItems.set(cachedItems);
      this.contentLoading.set(false);
      this.contentError.set('');
      return;
    }

    this.contentLoading.set(true);
    this.contentError.set('');
    try {
      const snapshot = await getDocs(
        collection(this.firestore, `televisions/${televisionId}/contentItems`),
      );
      const items = snapshot.docs
          .map((item) => ({ id: item.id, ...item.data() }) as ContentListItem)
          .filter(
            (item) =>
              item.playlistId === selectedPlaylistId ||
              (!item.playlistId && selectedPlaylistId === 'default'),
          )
          .sort((a, b) => a.order - b.order);
      this.contentCache.set(cacheKey, items);
      this.contentItems.set(items);
    } catch (error) {
      console.error('Unable to load content', error);
      this.contentError.set('Не удалось загрузить плейлист.');
    } finally {
      this.contentLoading.set(false);
    }
  }

  async addContent(
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
      const extension = imageFile.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? '';
      storagePath = `televisions/${televisionId}/content/${crypto.randomUUID()}${extension ? `.${extension}` : ''}`;
      sourceUrl = await this.uploadImageFile(storagePath, imageFile);
    }

    if (!name || !sourceUrl) {
      if (storagePath) await this.deleteStorageFile(storagePath);
      throw new Error('INVALID_CONTENT');
    }
    const parsedUrl = new URL(sourceUrl);
    if (!name || !['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('INVALID_CONTENT');
    const youtubeVideoId = extractYouTubeVideoId(parsedUrl);
    const type = youtubeVideoId ? 'youtube' : value.type;
    if (type === 'youtube' && !youtubeVideoId) throw new Error('INVALID_YOUTUBE_URL');

    const itemRef = doc(collection(this.firestore, `televisions/${televisionId}/contentItems`));
    const nextOrder = this.contentItems().length;
    const batch = writeBatch(this.firestore);
    batch.set(itemRef, {
      name,
      type,
      sourceUrl,
      youtubeVideoId: youtubeVideoId ?? null,
      playlistId: this.selectedPlaylistId(),
      order: nextOrder,
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
      if (storagePath) await this.deleteStorageFile(storagePath);
      throw error;
    }
    await this.loadContent(televisionId, true);
  }

  async deleteContent(televisionId: string, contentId: string): Promise<void> {
    const item = this.contentItems().find((content) => content.id === contentId);
    const itemRef = doc(this.firestore, `televisions/${televisionId}/contentItems/${contentId}`);
    if (item?.state === 'published') {
      const batch = writeBatch(this.firestore);
      batch.update(itemRef, { pendingDelete: true, updatedAt: serverTimestamp() });
      await batch.commit();
    } else {
      await deleteDoc(itemRef);
      if (item?.storagePath) await this.deleteStorageFile(item.storagePath);
    }
    await this.loadContent(televisionId, true);
  }

  async restoreContent(televisionId: string, contentId: string): Promise<void> {
    const batch = writeBatch(this.firestore);
    batch.update(doc(this.firestore, `televisions/${televisionId}/contentItems/${contentId}`), {
      pendingDelete: false,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
    await this.loadContent(televisionId, true);
  }

  async publishContent(televisionId: string): Promise<void> {
    const items = this.contentItems();
    if (!items.length) throw new Error('EMPTY_PLAYLIST');
    const batch = writeBatch(this.firestore);
    const storagePathsToDelete: string[] = [];
    items.forEach((item, index) => {
      const itemRef = doc(this.firestore, `televisions/${televisionId}/contentItems/${item.id}`);
      if (item.pendingDelete) {
        batch.delete(itemRef);
        if (item.storagePath) storagePathsToDelete.push(item.storagePath);
        return;
      }
      let youtubeVideoId = item.youtubeVideoId ?? null;
      try {
        youtubeVideoId ??= extractYouTubeVideoId(new URL(item.sourceUrl));
      } catch {
        youtubeVideoId = null;
      }
      batch.update(itemRef, {
        order: index,
        state: 'published',
        type: youtubeVideoId ? 'youtube' : item.type,
        youtubeVideoId,
        playlistId: this.selectedPlaylistId(),
        updatedAt: serverTimestamp(),
      });
    });
    batch.update(doc(this.firestore, `televisions/${televisionId}`), {
      publishedRevision: increment(1),
      publishedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
    await Promise.all(storagePathsToDelete.map((path) => this.deleteStorageFile(path)));
    await this.loadContent(televisionId, true);
  }

  async openTelevision(televisionId: string): Promise<void> {
    const televisionSnapshot = await getDoc(doc(this.firestore, `televisions/${televisionId}`));
    const television = televisionSnapshot.data() as TelevisionListItem | undefined;
    const playlists = television?.playlists?.length
      ? television.playlists
      : [{ id: 'default', name: 'Основной' }];
    const activePlaylistId = television?.activePlaylistId ?? playlists[0]?.id ?? 'default';
    this.playlists.set(playlists);
    this.activePlaylistId.set(activePlaylistId);
    this.broadcastEnabled.set(television?.broadcastEnabled ?? true);
    this.selectedPlaylistId.set(activePlaylistId);

    if (!television?.playlists?.length) {
      const batch = writeBatch(this.firestore);
      batch.update(televisionSnapshot.ref, {
        playlists,
        activePlaylistId,
        broadcastEnabled: television?.broadcastEnabled ?? true,
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
    }
    await this.loadContent(televisionId);
  }

  async selectPlaylist(televisionId: string, playlistId: string): Promise<void> {
    if (this.selectedPlaylistId() === playlistId) return;
    this.selectedPlaylistId.set(playlistId);
    await this.loadContent(televisionId);
  }

  async createPlaylist(televisionId: string, nameInput: string): Promise<void> {
    const name = nameInput.trim();
    if (!name) throw new Error('INVALID_PLAYLIST_NAME');
    const playlist: PlaylistSummary = { id: crypto.randomUUID(), name };
    const playlists = [...this.playlists(), playlist];
    await writeBatch(this.firestore)
      .update(doc(this.firestore, `televisions/${televisionId}`), {
        playlists,
        updatedAt: serverTimestamp(),
      })
      .commit();
    this.playlists.set(playlists);
    this.selectedPlaylistId.set(playlist.id);
    this.contentCache.set(this.contentCacheKey(televisionId, playlist.id), []);
    this.contentItems.set([]);
    await this.refreshTelevisions();
  }

  async renamePlaylist(televisionId: string, playlistId: string, nameInput: string): Promise<void> {
    const name = nameInput.trim();
    if (!name) throw new Error('INVALID_PLAYLIST_NAME');
    const playlists = this.playlists().map((playlist) =>
      playlist.id === playlistId ? { ...playlist, name } : playlist,
    );
    await writeBatch(this.firestore)
      .update(doc(this.firestore, `televisions/${televisionId}`), {
        playlists,
        updatedAt: serverTimestamp(),
      })
      .commit();
    this.playlists.set(playlists);
    await this.refreshTelevisions();
  }

  async activatePlaylist(televisionId: string): Promise<void> {
    const playlistId = this.selectedPlaylistId();
    await writeBatch(this.firestore)
      .update(doc(this.firestore, `televisions/${televisionId}`), {
        activePlaylistId: playlistId,
        publishedRevision: increment(1),
        updatedAt: serverTimestamp(),
      })
      .commit();
    this.activePlaylistId.set(playlistId);
    await this.refreshTelevisions();
  }

  async setBroadcastEnabled(televisionId: string, enabled: boolean): Promise<void> {
    await writeBatch(this.firestore)
      .update(doc(this.firestore, `televisions/${televisionId}`), {
        broadcastEnabled: enabled,
        updatedAt: serverTimestamp(),
      })
      .commit();
    this.broadcastEnabled.set(enabled);
    await this.refreshTelevisions();
  }

  async deleteTelevision(television: TelevisionListItem): Promise<void> {
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
    await Promise.all(storagePaths.map((path) => this.deleteStorageFile(path)));

    for (const key of this.contentCache.keys()) {
      if (key.startsWith(`${television.id}:`)) this.contentCache.delete(key);
    }
    this.contentItems.set([]);
    await this.refreshTelevisions();
  }

  private contentCacheKey(televisionId: string, playlistId: string): string {
    return `${televisionId}:${playlistId}`;
  }

  private async deleteStorageFile(path: string): Promise<void> {
    try {
      await deleteObject(storageRef(this.storage, path));
    } catch (error) {
      console.warn('Unable to delete content file', path, error);
    }
  }

  private async uploadImageFile(path: string, file: File): Promise<string> {
    if (!navigator.onLine) throw this.storageNetworkError();

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
        finish(() => reject(this.storageNetworkError()));
      };
      const timeoutId = window.setTimeout(() => {
        void task.cancel();
        finish(() => reject(this.storageNetworkError()));
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

  private storageNetworkError(): Error & { code: string } {
    return Object.assign(new Error('STORAGE_NETWORK_UNAVAILABLE'), {
      code: 'storage/network-unavailable',
    });
  }

}
