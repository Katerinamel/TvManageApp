import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzModalModule } from 'ng-zorro-antd/modal';
import { NzPopconfirmModule } from 'ng-zorro-antd/popconfirm';
import type { TelevisionGroup, TelevisionListItem } from 'shared';
import { TelevisionAdminService } from '../televisions/television-admin.service';
import { GroupAdminService } from './group-admin.service';

@Component({
  selector: 'app-groups',
  imports: [FormsModule, NzButtonModule, NzInputModule, NzModalModule, NzPopconfirmModule],
  templateUrl: './groups.html',
  styleUrl: './groups.scss',
})
export class Groups {
  private readonly groupAdmin = inject(GroupAdminService);
  private readonly televisionAdmin = inject(TelevisionAdminService);

  protected readonly groups = this.groupAdmin.groups;
  protected readonly groupsLoading = this.groupAdmin.loading;
  protected readonly groupsError = this.groupAdmin.error;
  protected readonly televisions = this.televisionAdmin.televisions;
  protected readonly televisionsLoading = this.televisionAdmin.loading;
  protected readonly playlists = this.groupAdmin.playlists;
  protected readonly newGroupName = signal('');
  protected readonly activeGroup = signal<TelevisionGroup | null>(null);
  protected readonly editName = signal('');
  protected readonly selectedTelevisionIds = signal<string[]>([]);
  protected readonly selectedPlaylistId = signal('');
  protected readonly modalVisible = signal(false);
  protected readonly busy = signal(false);
  protected readonly message = signal('');

  protected async createGroup(): Promise<void> {
    if (!this.newGroupName().trim() || this.busy()) return;
    this.busy.set(true);
    this.message.set('');
    try {
      await this.groupAdmin.create(this.newGroupName());
      this.newGroupName.set('');
      this.message.set('Группа создана.');
    } finally {
      this.busy.set(false);
    }
  }

  protected refreshGroups(): void {
    void Promise.all([this.groupAdmin.refresh(), this.televisionAdmin.refresh()]);
  }

  protected openGroup(group: TelevisionGroup): void {
    this.activeGroup.set(group);
    this.editName.set(group.name);
    this.selectedTelevisionIds.set(
      this.televisions()
        .filter((television) => television.groupId === group.id)
        .map((television) => television.id),
    );
    this.selectedPlaylistId.set(group.activePlaylistId ?? '');
    this.modalVisible.set(true);
    this.message.set('');
  }

  protected closeModal(): void {
    if (this.busy()) return;
    this.modalVisible.set(false);
    this.activeGroup.set(null);
  }

  protected async saveGroup(): Promise<void> {
    const group = this.activeGroup();
    if (!group || !this.editName().trim() || this.busy()) return;
    this.busy.set(true);
    try {
      await this.groupAdmin.update(
        group,
        this.editName(),
        this.selectedTelevisionIds(),
        this.televisions(),
      );
      if (this.selectedPlaylistId()) {
        await this.groupAdmin.assignPlaylist(group, this.selectedPlaylistId(), this.televisions());
      } else if (group.activePlaylistId) {
        await this.groupAdmin.clearPlaylist(group, this.televisions());
      }
      this.modalVisible.set(false);
      this.activeGroup.set(null);
      this.message.set('Настройки группы сохранены.');
    } finally {
      this.busy.set(false);
    }
  }

  protected toggleTelevision(television: TelevisionListItem, checked: boolean): void {
    if (this.belongsToAnotherGroup(television)) return;
    this.selectedTelevisionIds.update((ids) =>
      checked ? [...new Set([...ids, television.id])] : ids.filter((id) => id !== television.id),
    );
  }

  protected isSelected(televisionId: string): boolean {
    return this.selectedTelevisionIds().includes(televisionId);
  }

  protected belongsToAnotherGroup(television: TelevisionListItem): boolean {
    return !!television.groupId && television.groupId !== this.activeGroup()?.id;
  }

  protected groupName(groupId: string | undefined): string {
    return this.groups().find((group) => group.id === groupId)?.name ?? 'другой группе';
  }

  protected members(group: TelevisionGroup): TelevisionListItem[] {
    return this.televisions().filter((television) => television.groupId === group.id);
  }

  protected playlistName(playlistId: string | undefined): string {
    return this.playlists().find((playlist) => playlist.id === playlistId)?.name ?? 'Не назначен';
  }

  protected async deleteGroup(group: TelevisionGroup): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await this.groupAdmin.delete(group, this.televisions());
      this.message.set(`Группа «${group.name}» удалена. Телевизоры сохранены.`);
    } finally {
      this.busy.set(false);
    }
  }
}
