import { Injectable, inject } from '@angular/core';
import {
  DocumentData,
  Firestore,
  QueryDocumentSnapshot,
  arrayRemove,
  arrayUnion,
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  writeBatch,
} from '@angular/fire/firestore';
import type { Playlist, PlaylistSummary, TelevisionGroup, TelevisionListItem } from 'shared';

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
        personalPlaylistId: libraryActivePlaylistId,
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

  async copyToTelevision(playlistId: string, televisionId: string): Promise<string> {
    const [sourceSnapshot, televisionSnapshot] = await Promise.all([
      getDoc(doc(this.firestore, `playlists/${playlistId}`)),
      getDoc(doc(this.firestore, `televisions/${televisionId}`)),
    ]);
    if (!sourceSnapshot.exists()) throw new Error('PLAYLIST_NOT_FOUND');
    if (!televisionSnapshot.exists()) throw new Error('TELEVISION_NOT_FOUND');

    const television = { id: televisionSnapshot.id, ...televisionSnapshot.data() } as TelevisionListItem;
    return this.copyPlaylist(playlistId, sourceSnapshot.data() as Omit<Playlist, 'id'>, {
      ownerType: 'television',
      ownerId: television.id,
      assignedTelevisionIds: [television.id],
      viewerDeviceIds: [television.deviceId],
      afterCreate: (batch, copiedPlaylistId) =>
        batch.update(televisionSnapshot.ref, {
          playlistIds: arrayUnion(copiedPlaylistId),
          updatedAt: serverTimestamp(),
        }),
    });
  }

  async copyToGroup(playlistId: string, groupId: string): Promise<string> {
    const [sourceSnapshot, groupSnapshot] = await Promise.all([
      getDoc(doc(this.firestore, `playlists/${playlistId}`)),
      getDoc(doc(this.firestore, `groups/${groupId}`)),
    ]);
    if (!sourceSnapshot.exists()) throw new Error('PLAYLIST_NOT_FOUND');
    if (!groupSnapshot.exists()) throw new Error('GROUP_NOT_FOUND');

    const group = { id: groupSnapshot.id, ...groupSnapshot.data() } as TelevisionGroup;
    return this.copyPlaylist(playlistId, sourceSnapshot.data() as Omit<Playlist, 'id'>, {
      ownerType: 'group',
      ownerId: group.id,
      assignedTelevisionIds: group.televisionIds,
      viewerDeviceIds: group.deviceIds,
    });
  }

  async moveToTelevision(
    playlistId: string,
    televisionId: string,
    sourceTelevisionId?: string,
  ): Promise<void> {
    const [playlistSnapshot, targetSnapshot] = await Promise.all([
      getDoc(doc(this.firestore, `playlists/${playlistId}`)),
      getDoc(doc(this.firestore, `televisions/${televisionId}`)),
    ]);
    if (!playlistSnapshot.exists()) throw new Error('PLAYLIST_NOT_FOUND');
    if (!targetSnapshot.exists()) throw new Error('TELEVISION_NOT_FOUND');

    const playlist = { id: playlistSnapshot.id, ...playlistSnapshot.data() } as Playlist;
    const target = { id: targetSnapshot.id, ...targetSnapshot.data() } as TelevisionListItem;
    let sourceId = playlist.ownerId;
    if (playlist.ownerType === 'group') {
      const groupSnapshot = await getDoc(doc(this.firestore, `groups/${playlist.ownerId}`));
      if (groupSnapshot.exists() && groupSnapshot.data()['activePlaylistId'] === playlistId) {
        throw new Error('GROUP_PLAYLIST_MOVE_NOT_SUPPORTED');
      }
      if (!sourceTelevisionId) throw new Error('SOURCE_TELEVISION_NOT_FOUND');
      sourceId = sourceTelevisionId;
    }
    if (sourceId === televisionId) throw new Error('SAME_TELEVISION');

    const sourceSnapshot = await getDoc(doc(this.firestore, `televisions/${sourceId}`));
    if (!sourceSnapshot.exists()) throw new Error('SOURCE_TELEVISION_NOT_FOUND');
    const source = { id: sourceSnapshot.id, ...sourceSnapshot.data() } as TelevisionListItem;
    if (!source.playlistIds?.includes(playlistId)) throw new Error('SOURCE_TELEVISION_NOT_FOUND');
    const remainingPlaylistIds = (source.playlistIds ?? []).filter((id) => id !== playlistId);
    const batch = writeBatch(this.firestore);
    batch.update(playlistSnapshot.ref, {
      ownerType: 'television',
      ownerId: target.id,
      assignedTelevisionIds: [target.id],
      viewerDeviceIds: [target.deviceId],
      previousOwnerType: deleteField(),
      previousOwnerId: deleteField(),
      previousAssignedTelevisionIds: deleteField(),
      previousViewerDeviceIds: deleteField(),
      updatedAt: serverTimestamp(),
    });
    batch.update(targetSnapshot.ref, {
      playlistIds: arrayUnion(playlistId),
      updatedAt: serverTimestamp(),
    });
    batch.update(sourceSnapshot.ref, {
      playlistIds: arrayRemove(playlistId),
      ...(source.libraryActivePlaylistId === playlistId
        ? { libraryActivePlaylistId: remainingPlaylistIds[0] ?? deleteField() }
        : {}),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  }

  private async copyPlaylist(
    sourcePlaylistId: string,
    source: Omit<Playlist, 'id'>,
    target: {
      ownerType: Playlist['ownerType'];
      ownerId: string;
      assignedTelevisionIds: string[];
      viewerDeviceIds: string[];
      afterCreate?: (batch: ReturnType<typeof writeBatch>, playlistId: string) => void;
    },
  ): Promise<string> {
    const contentSnapshot = await getDocs(
      collection(this.firestore, `playlists/${sourcePlaylistId}/contentItems`),
    );
    if (contentSnapshot.size + 2 > MAX_BATCH_OPERATIONS) throw new Error('PLAYLIST_TOO_LARGE');

    const copiedPlaylistRef = doc(collection(this.firestore, 'playlists'));
    const batch = writeBatch(this.firestore);
    batch.set(copiedPlaylistRef, {
      name: `${source.name} — копия`,
      ownerType: target.ownerType,
      ownerId: target.ownerId,
      assignedTelevisionIds: target.assignedTelevisionIds,
      viewerDeviceIds: target.viewerDeviceIds,
      sourcePlaylistId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    contentSnapshot.docs.forEach((item) => {
      batch.set(doc(collection(this.firestore, `playlists/${copiedPlaylistRef.id}/contentItems`)), {
        ...item.data(),
        playlistId: copiedPlaylistRef.id,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
    target.afterCreate?.(batch, copiedPlaylistRef.id);
    await batch.commit();
    return copiedPlaylistRef.id;
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
