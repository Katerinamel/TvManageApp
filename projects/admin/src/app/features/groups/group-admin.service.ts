import { Injectable, inject, signal } from '@angular/core';
import {
  Firestore,
  collection,
  deleteField,
  doc,
  getDocs,
  serverTimestamp,
  writeBatch,
} from '@angular/fire/firestore';
import type { Playlist, TelevisionGroup, TelevisionListItem } from 'shared';
import { TelevisionAdminService } from '../televisions/television-admin.service';

export function canAssignTelevisionToGroup(
  television: Pick<TelevisionListItem, 'groupId'>,
  groupId: string,
): boolean {
  return !television.groupId || television.groupId === groupId;
}

@Injectable({ providedIn: 'root' })
export class GroupAdminService {
  private readonly firestore = inject(Firestore);
  private readonly televisions = inject(TelevisionAdminService);

  readonly groups = signal<TelevisionGroup[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly playlists = signal<Playlist[]>([]);

  constructor() {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const [snapshot, playlistSnapshot] = await Promise.all([
        getDocs(collection(this.firestore, 'groups')),
        getDocs(collection(this.firestore, 'playlists')),
      ]);
      this.groups.set(
        snapshot.docs
          .map((item) => ({ id: item.id, ...item.data() }) as TelevisionGroup)
          .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
      );
      this.playlists.set(
        playlistSnapshot.docs
          .map((item) => ({ id: item.id, ...item.data() }) as Playlist)
          .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
      );
    } catch (error) {
      console.error('Unable to load groups', error);
      this.error.set('Не удалось загрузить группы.');
    } finally {
      this.loading.set(false);
    }
  }

  async create(nameInput: string): Promise<void> {
    const name = nameInput.trim();
    if (!name) throw new Error('INVALID_GROUP_NAME');
    const groupRef = doc(collection(this.firestore, 'groups'));
    await writeBatch(this.firestore)
      .set(groupRef, {
        name,
        televisionIds: [],
        deviceIds: [],
        broadcastEnabled: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      .commit();
    await this.refresh();
  }

  async update(
    group: TelevisionGroup,
    nameInput: string,
    selectedTelevisionIds: string[],
    allTelevisions: TelevisionListItem[],
  ): Promise<void> {
    const name = nameInput.trim();
    if (!name) throw new Error('INVALID_GROUP_NAME');

    const selectedIds = new Set(selectedTelevisionIds);
    const currentMembers = allTelevisions.filter((television) => television.groupId === group.id);
    const selectedTelevisions = allTelevisions.filter((television) =>
      selectedIds.has(television.id),
    );
    if (
      selectedTelevisions.some((television) => !canAssignTelevisionToGroup(television, group.id))
    ) {
      throw new Error('TELEVISION_ALREADY_GROUPED');
    }
    const batch = writeBatch(this.firestore);

    currentMembers
      .filter((television) => !selectedIds.has(television.id))
      .forEach((television) =>
        batch.update(doc(this.firestore, `televisions/${television.id}`), {
          groupId: deleteField(),
          ...(group.activePlaylistId && television.broadcastSource === 'group'
            ? {
                libraryActivePlaylistId: deleteField(),
                broadcastEnabled: false,
                broadcastSource: deleteField(),
              }
            : {}),
          updatedAt: serverTimestamp(),
        }),
      );
    selectedTelevisions.forEach((television) =>
      batch.update(doc(this.firestore, `televisions/${television.id}`), {
        groupId: group.id,
        ...(group.activePlaylistId && group.broadcastEnabled
          ? {
              libraryActivePlaylistId: group.activePlaylistId,
              broadcastEnabled: true,
              broadcastSource: 'group',
            }
          : {}),
        updatedAt: serverTimestamp(),
      }),
    );
    batch.update(doc(this.firestore, `groups/${group.id}`), {
      name,
      televisionIds: selectedTelevisions.map((television) => television.id),
      deviceIds: selectedTelevisions.map((television) => television.deviceId),
      updatedAt: serverTimestamp(),
    });
    if (group.activePlaylistId) {
      batch.update(doc(this.firestore, `playlists/${group.activePlaylistId}`), {
        assignedTelevisionIds: selectedTelevisions.map((television) => television.id),
        viewerDeviceIds: selectedTelevisions.map((television) => television.deviceId),
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
    await Promise.all([this.refresh(), this.televisions.refresh()]);
  }

  async assignPlaylist(
    group: TelevisionGroup,
    playlistId: string,
    allTelevisions: TelevisionListItem[],
  ): Promise<void> {
    const playlist = this.playlists().find((item) => item.id === playlistId);
    if (!playlist) throw new Error('PLAYLIST_NOT_FOUND');
    if (playlist.ownerType === 'group' && playlist.ownerId !== group.id) {
      throw new Error('PLAYLIST_ALREADY_ASSIGNED');
    }
    const members = allTelevisions.filter((television) => television.groupId === group.id);
    const batch = writeBatch(this.firestore);
    if (group.activePlaylistId && group.activePlaylistId !== playlistId) {
      const previousPlaylist = this.playlists().find((item) => item.id === group.activePlaylistId);
      if (previousPlaylist) this.restorePlaylistOwnership(batch, previousPlaylist, allTelevisions);
    }
    batch.update(doc(this.firestore, `groups/${group.id}`), {
      activePlaylistId: playlistId,
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(this.firestore, `playlists/${playlistId}`), {
      ownerType: 'group',
      ownerId: group.id,
      assignedTelevisionIds: members.map((television) => television.id),
      viewerDeviceIds: members.map((television) => television.deviceId),
      ...(playlist.ownerType !== 'group'
        ? {
            previousOwnerType: playlist.ownerType,
            previousOwnerId: playlist.ownerId,
            previousAssignedTelevisionIds: playlist.assignedTelevisionIds,
            previousViewerDeviceIds: playlist.viewerDeviceIds,
          }
        : {}),
      updatedAt: serverTimestamp(),
    });
    members.forEach((television) =>
      batch.update(doc(this.firestore, `televisions/${television.id}`), {
        ...(group.broadcastEnabled
          ? {
              libraryActivePlaylistId: playlistId,
              broadcastEnabled: true,
              broadcastSource: 'group',
            }
          : {}),
        updatedAt: serverTimestamp(),
      }),
    );
    await batch.commit();
    await Promise.all([this.refresh(), this.televisions.refresh()]);
  }

  async clearPlaylist(group: TelevisionGroup, allTelevisions: TelevisionListItem[]): Promise<void> {
    const members = allTelevisions.filter((television) => television.groupId === group.id);
    const batch = writeBatch(this.firestore);
    const activePlaylist = this.playlists().find((item) => item.id === group.activePlaylistId);
    const restoredOwner = activePlaylist
      ? this.originalTelevisionOwner(activePlaylist, allTelevisions)
      : undefined;
    if (activePlaylist) this.restorePlaylistOwnership(batch, activePlaylist, allTelevisions);
    batch.update(doc(this.firestore, `groups/${group.id}`), {
      activePlaylistId: deleteField(),
      broadcastEnabled: false,
      updatedAt: serverTimestamp(),
    });
    members.forEach((television) =>
      batch.update(doc(this.firestore, `televisions/${television.id}`), {
        ...(television.broadcastSource === 'group'
          ? {
              libraryActivePlaylistId:
                restoredOwner?.id === television.id && activePlaylist
                  ? activePlaylist.id
                  : deleteField(),
              broadcastEnabled: false,
              broadcastSource: deleteField(),
            }
          : {}),
        updatedAt: serverTimestamp(),
      }),
    );
    await batch.commit();
    await Promise.all([this.refresh(), this.televisions.refresh()]);
  }

  async setBroadcastEnabled(
    group: TelevisionGroup,
    enabled: boolean,
    allTelevisions: TelevisionListItem[],
  ): Promise<void> {
    if (enabled && !group.activePlaylistId) throw new Error('GROUP_PLAYLIST_REQUIRED');
    const members = allTelevisions.filter((television) => television.groupId === group.id);
    if (enabled && !members.length) throw new Error('GROUP_MEMBERS_REQUIRED');

    const batch = writeBatch(this.firestore);
    batch.update(doc(this.firestore, `groups/${group.id}`), {
      broadcastEnabled: enabled,
      updatedAt: serverTimestamp(),
    });
    members.forEach((television) =>
      batch.update(
        doc(this.firestore, `televisions/${television.id}`),
        enabled
          ? {
              broadcastEnabled: true,
              broadcastSource: 'group',
              libraryActivePlaylistId: group.activePlaylistId,
              updatedAt: serverTimestamp(),
            }
          : television.broadcastSource === 'group'
            ? {
                broadcastEnabled: false,
                broadcastSource: deleteField(),
                updatedAt: serverTimestamp(),
              }
            : { updatedAt: serverTimestamp() },
      ),
    );
    await batch.commit();
    await Promise.all([this.refresh(), this.televisions.refresh()]);
  }

  async delete(group: TelevisionGroup, allTelevisions: TelevisionListItem[]): Promise<void> {
    const batch = writeBatch(this.firestore);
    const activePlaylist = this.playlists().find((item) => item.id === group.activePlaylistId);
    const restoredOwner = activePlaylist
      ? this.originalTelevisionOwner(activePlaylist, allTelevisions)
      : undefined;
    if (activePlaylist) this.restorePlaylistOwnership(batch, activePlaylist, allTelevisions);
    allTelevisions
      .filter((television) => television.groupId === group.id)
      .forEach((television) =>
        batch.update(doc(this.firestore, `televisions/${television.id}`), {
          groupId: deleteField(),
          ...(group.activePlaylistId && television.broadcastSource === 'group'
            ? {
                libraryActivePlaylistId:
                  restoredOwner?.id === television.id
                    ? group.activePlaylistId
                    : deleteField(),
                broadcastEnabled: false,
                broadcastSource: deleteField(),
              }
            : {}),
          updatedAt: serverTimestamp(),
        }),
      );
    batch.delete(doc(this.firestore, `groups/${group.id}`));
    await batch.commit();
    await Promise.all([this.refresh(), this.televisions.refresh()]);
  }

  private restorePlaylistOwnership(
    batch: ReturnType<typeof writeBatch>,
    playlist: Playlist,
    allTelevisions: TelevisionListItem[],
  ): void {
    const fallbackOwner = this.originalTelevisionOwner(playlist, allTelevisions);
    const ownerType = playlist.previousOwnerType ?? (fallbackOwner ? 'television' : undefined);
    const ownerId = playlist.previousOwnerId ?? fallbackOwner?.id;
    if (!ownerType || !ownerId) return;

    batch.update(doc(this.firestore, `playlists/${playlist.id}`), {
      ownerType,
      ownerId,
      assignedTelevisionIds:
        playlist.previousAssignedTelevisionIds ?? (fallbackOwner ? [fallbackOwner.id] : []),
      viewerDeviceIds:
        playlist.previousViewerDeviceIds ?? (fallbackOwner ? [fallbackOwner.deviceId] : []),
      previousOwnerType: deleteField(),
      previousOwnerId: deleteField(),
      previousAssignedTelevisionIds: deleteField(),
      previousViewerDeviceIds: deleteField(),
      updatedAt: serverTimestamp(),
    });
  }

  private originalTelevisionOwner(
    playlist: Playlist,
    allTelevisions: TelevisionListItem[],
  ): TelevisionListItem | undefined {
    if (playlist.previousOwnerType === 'television' && playlist.previousOwnerId) {
      return allTelevisions.find((television) => television.id === playlist.previousOwnerId);
    }
    return allTelevisions.find((television) => television.playlistIds?.includes(playlist.id));
  }
}
