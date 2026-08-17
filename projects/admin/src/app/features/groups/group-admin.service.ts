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
import type { TelevisionGroup, TelevisionListItem } from 'shared';
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

  constructor() {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const snapshot = await getDocs(collection(this.firestore, 'groups'));
      this.groups.set(
        snapshot.docs
          .map((item) => ({ id: item.id, ...item.data() }) as TelevisionGroup)
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
        broadcastEnabled: true,
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
          updatedAt: serverTimestamp(),
        }),
      );
    selectedTelevisions.forEach((television) =>
      batch.update(doc(this.firestore, `televisions/${television.id}`), {
        groupId: group.id,
        updatedAt: serverTimestamp(),
      }),
    );
    batch.update(doc(this.firestore, `groups/${group.id}`), {
      name,
      televisionIds: selectedTelevisions.map((television) => television.id),
      deviceIds: selectedTelevisions.map((television) => television.deviceId),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
    await Promise.all([this.refresh(), this.televisions.refresh()]);
  }

  async delete(group: TelevisionGroup, allTelevisions: TelevisionListItem[]): Promise<void> {
    const batch = writeBatch(this.firestore);
    allTelevisions
      .filter((television) => television.groupId === group.id)
      .forEach((television) =>
        batch.update(doc(this.firestore, `televisions/${television.id}`), {
          groupId: deleteField(),
          updatedAt: serverTimestamp(),
        }),
      );
    batch.delete(doc(this.firestore, `groups/${group.id}`));
    await batch.commit();
    await Promise.all([this.refresh(), this.televisions.refresh()]);
  }
}
