import { Injectable, inject } from '@angular/core';
import {
  DocumentData,
  Firestore,
  QueryDocumentSnapshot,
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  writeBatch,
} from '@angular/fire/firestore';
import type { Playlist, PlaylistSummary, TelevisionListItem } from 'shared';

const PLAYLIST_SCHEMA_VERSION = 2;
const MAX_BATCH_OPERATIONS = 450;

export function legacyPlaylistDocumentId(televisionId: string, playlistId: string): string {
  const safePlaylistId = encodeURIComponent(playlistId);
  return `${televisionId}_${safePlaylistId}`;
}

@Injectable({ providedIn: 'root' })
export class PlaylistLibraryService {
  private readonly firestore = inject(Firestore);

  /**
   * Copies legacy embedded playlists into the top-level playlist collection.
   * Legacy fields and content are deliberately retained as a rollback path.
   */
  async migrateTelevision(televisionId: string): Promise<string[]> {
    const televisionRef = doc(this.firestore, `televisions/${televisionId}`);
    const televisionSnapshot = await getDoc(televisionRef);
    if (!televisionSnapshot.exists()) throw new Error('TELEVISION_NOT_FOUND');

    const television = {
      id: televisionSnapshot.id,
      ...televisionSnapshot.data(),
    } as TelevisionListItem;
    if (
      (television.playlistSchemaVersion ?? 0) >= PLAYLIST_SCHEMA_VERSION &&
      television.playlistIds?.length
    ) {
      return television.playlistIds;
    }

    const legacyPlaylists = television.playlists?.length
      ? television.playlists
      : [{ id: 'default', name: 'Основной' }];
    const contentSnapshot = await getDocs(
      collection(this.firestore, `televisions/${televisionId}/contentItems`),
    );
    const playlistIds = legacyPlaylists.map((playlist) =>
      legacyPlaylistDocumentId(televisionId, playlist.id),
    );
    const libraryActivePlaylistId = this.mapLegacyPlaylistId(
      televisionId,
      television.activePlaylistId ?? legacyPlaylists[0]?.id ?? 'default',
      legacyPlaylists,
    );

    const operations: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];
    legacyPlaylists.forEach((playlist) => {
      const playlistId = legacyPlaylistDocumentId(televisionId, playlist.id);
      const playlistRef = doc(this.firestore, `playlists/${playlistId}`);
      operations.push((batch) =>
        batch.set(playlistRef, {
          name: playlist.name,
          ownerType: 'television',
          ownerId: televisionId,
          assignedTelevisionIds: [televisionId],
          viewerDeviceIds: [television.deviceId],
          legacyPlaylistId: playlist.id,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        } satisfies Omit<Playlist, 'id' | 'createdAt' | 'updatedAt'> & {
          legacyPlaylistId: string;
          createdAt: unknown;
          updatedAt: unknown;
        }),
      );

      this.contentForPlaylist(contentSnapshot.docs, playlist.id).forEach((content) => {
        const contentRef = doc(
          this.firestore,
          `playlists/${playlistId}/contentItems/${content.id}`,
        );
        operations.push((batch) =>
          batch.set(contentRef, {
            ...content.data(),
            playlistId,
            legacyPlaylistId: playlist.id,
          }),
        );
      });
    });

    for (let index = 0; index < operations.length; index += MAX_BATCH_OPERATIONS) {
      const batch = writeBatch(this.firestore);
      operations
        .slice(index, index + MAX_BATCH_OPERATIONS)
        .forEach((operation) => operation(batch));
      await batch.commit();
    }

    await writeBatch(this.firestore)
      .update(televisionRef, {
        playlistIds,
        libraryActivePlaylistId,
        playlistSchemaVersion: PLAYLIST_SCHEMA_VERSION,
        updatedAt: serverTimestamp(),
      })
      .commit();

    return playlistIds;
  }

  async loadSummaries(playlistIds: string[]): Promise<PlaylistSummary[]> {
    const snapshots = await Promise.all(
      playlistIds.map((playlistId) => getDoc(doc(this.firestore, `playlists/${playlistId}`))),
    );
    return snapshots
      .filter((snapshot) => snapshot.exists())
      .map((snapshot) => ({
        id: snapshot.id,
        name: String(snapshot.data()['name'] ?? 'Плейлист'),
      }));
  }

  async createForTelevision(
    television: TelevisionListItem,
    name: string,
  ): Promise<PlaylistSummary> {
    const playlistRef = doc(collection(this.firestore, 'playlists'));
    await writeBatch(this.firestore)
      .set(playlistRef, {
        name,
        ownerType: 'television',
        ownerId: television.id,
        assignedTelevisionIds: [television.id],
        viewerDeviceIds: [television.deviceId],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      .update(doc(this.firestore, `televisions/${television.id}`), {
        playlistIds: [...(television.playlistIds ?? []), playlistRef.id],
        updatedAt: serverTimestamp(),
      })
      .commit();
    return { id: playlistRef.id, name };
  }

  async rename(playlistId: string, name: string): Promise<void> {
    await writeBatch(this.firestore)
      .update(doc(this.firestore, `playlists/${playlistId}`), {
        name,
        updatedAt: serverTimestamp(),
      })
      .commit();
  }

  private mapLegacyPlaylistId(
    televisionId: string,
    legacyPlaylistId: string,
    playlists: PlaylistSummary[],
  ): string {
    const selected = playlists.some((playlist) => playlist.id === legacyPlaylistId)
      ? legacyPlaylistId
      : (playlists[0]?.id ?? 'default');
    return legacyPlaylistDocumentId(televisionId, selected);
  }

  private contentForPlaylist(
    documents: QueryDocumentSnapshot<DocumentData>[],
    playlistId: string,
  ): QueryDocumentSnapshot<DocumentData>[] {
    return documents.filter((item) => {
      const contentPlaylistId = item.data()['playlistId'] as string | undefined;
      return contentPlaylistId === playlistId || (!contentPlaylistId && playlistId === 'default');
    });
  }
}
