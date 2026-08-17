import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  doc,
  getDoc,
  increment,
  serverTimestamp,
  writeBatch,
} from '@angular/fire/firestore';
import type { PlaylistSummary, TelevisionListItem } from 'shared';
import { PlaylistLibraryService } from './playlist-library.service';
import { TelevisionAdminService } from './television-admin.service';
import { TelevisionEditorStore } from './television-editor.store';

@Injectable({ providedIn: 'root' })
export class PlaylistAdminService {
  private readonly firestore = inject(Firestore);
  private readonly televisions = inject(TelevisionAdminService);
  private readonly store = inject(TelevisionEditorStore);
  private readonly library = inject(PlaylistLibraryService);

  readonly playlists = this.store.playlists;
  readonly selectedPlaylistId = this.store.selectedPlaylistId;
  readonly activePlaylistId = this.store.activePlaylistId;
  readonly broadcastEnabled = this.store.broadcastEnabled;
  readonly broadcastSource = this.store.broadcastSource;

  async openTelevision(televisionId: string): Promise<void> {
    await this.library.migrateTelevision(televisionId);
    const snapshot = await getDoc(doc(this.firestore, `televisions/${televisionId}`));
    const television = snapshot.data() as TelevisionListItem | undefined;
    const playlistIds = television?.playlistIds ?? [];
    const playlists = await this.library.loadSummaries(playlistIds);
    const activePlaylistId = television?.libraryActivePlaylistId ?? playlists[0]?.id ?? 'default';

    this.store.libraryMode.set(true);
    this.playlists.set(playlists);
    this.activePlaylistId.set(activePlaylistId);
    this.broadcastEnabled.set(television?.broadcastEnabled ?? true);
    let broadcastSource = television?.broadcastSource ?? 'television';
    if (!television?.broadcastSource && television?.groupId && television.broadcastEnabled) {
      const groupSnapshot = await getDoc(doc(this.firestore, `groups/${television.groupId}`));
      const group = groupSnapshot.data() as
        | { activePlaylistId?: string; broadcastEnabled?: boolean }
        | undefined;
      if (
        group?.broadcastEnabled &&
        group.activePlaylistId === television.libraryActivePlaylistId
      ) {
        broadcastSource = 'group';
      }
    }
    this.broadcastSource.set(broadcastSource);
    this.selectedPlaylistId.set(
      television?.personalPlaylistId && playlistIds.includes(television.personalPlaylistId)
        ? television.personalPlaylistId
        : (playlists[0]?.id ?? activePlaylistId),
    );
  }

  select(playlistId: string): boolean {
    if (this.selectedPlaylistId() === playlistId) return false;
    this.selectedPlaylistId.set(playlistId);
    return true;
  }

  async create(televisionId: string, nameInput: string): Promise<void> {
    const name = nameInput.trim();
    if (!name) throw new Error('INVALID_PLAYLIST_NAME');
    const television = await this.televisions.get(televisionId);
    if (!television) throw new Error('TELEVISION_NOT_FOUND');
    const playlist = await this.library.createForTelevision(television, name);
    const playlists = [...this.playlists(), playlist];
    this.playlists.set(playlists);
    this.selectedPlaylistId.set(playlist.id);
    await this.televisions.refresh();
  }

  async rename(televisionId: string, playlistId: string, nameInput: string): Promise<void> {
    const name = nameInput.trim();
    if (!name) throw new Error('INVALID_PLAYLIST_NAME');
    const playlists = this.playlists().map((playlist) =>
      playlist.id === playlistId ? { ...playlist, name } : playlist,
    );
    await this.library.rename(playlistId, name);
    this.playlists.set(playlists);
    await this.televisions.refresh();
  }

  async activate(televisionId: string): Promise<void> {
    const playlistId = this.selectedPlaylistId();
    const television = await this.televisions.get(televisionId);
    if (!television) throw new Error('TELEVISION_NOT_FOUND');
    await writeBatch(this.firestore)
      .update(doc(this.firestore, `televisions/${televisionId}`), {
        personalPlaylistId: playlistId,
        ...(television.broadcastSource === 'group' ? {} : { libraryActivePlaylistId: playlistId }),
        publishedRevision: increment(1),
        updatedAt: serverTimestamp(),
      })
      .commit();
    if (television.broadcastSource !== 'group') this.activePlaylistId.set(playlistId);
    await this.televisions.refresh();
  }

  async setBroadcastEnabled(televisionId: string, enabled: boolean): Promise<void> {
    const television = await this.televisions.get(televisionId);
    if (!television) throw new Error('TELEVISION_NOT_FOUND');
    let nextEnabled = enabled;
    let nextSource: 'television' | 'group' = 'television';
    let nextPlaylistId = this.selectedPlaylistId();

    if (!enabled && television.broadcastSource === 'television' && television.groupId) {
      const groupSnapshot = await getDoc(doc(this.firestore, `groups/${television.groupId}`));
      const group = groupSnapshot.data() as
        | { activePlaylistId?: string; broadcastEnabled?: boolean }
        | undefined;
      if (group?.broadcastEnabled && group.activePlaylistId) {
        nextEnabled = true;
        nextSource = 'group';
        nextPlaylistId = group.activePlaylistId;
      }
    }

    await writeBatch(this.firestore)
      .update(doc(this.firestore, `televisions/${televisionId}`), {
        broadcastEnabled: nextEnabled,
        broadcastSource: nextSource,
        ...(nextEnabled ? { libraryActivePlaylistId: nextPlaylistId } : {}),
        ...(enabled ? { personalPlaylistId: this.selectedPlaylistId() } : {}),
        updatedAt: serverTimestamp(),
      })
      .commit();
    this.broadcastEnabled.set(nextEnabled);
    this.broadcastSource.set(nextSource);
    if (nextEnabled) this.activePlaylistId.set(nextPlaylistId);
    await this.televisions.refresh();
  }

  reset(): void {
    this.store.reset();
  }
}
