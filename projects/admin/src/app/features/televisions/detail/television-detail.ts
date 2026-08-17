import { Component, ElementRef, OnInit, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzModalModule } from 'ng-zorro-antd/modal';
import { GroupAdminService } from '../../groups/group-admin.service';
import {
  ContentListItem,
  PairingAdminService,
  TelevisionListItem,
  isSupportedImageFile,
} from '../pairing-admin.service';
import { PlaylistLibraryService } from '../playlist-library.service';
import { TelevisionAdminService } from '../television-admin.service';
import { ContentDropZoneDirective } from './content-drop-zone.directive';

@Component({
  selector: 'app-television-detail',
  imports: [
    FormsModule,
    RouterLink,
    NzButtonModule,
    NzInputModule,
    NzModalModule,
    ContentDropZoneDirective,
  ],
  templateUrl: './television-detail.html',
  styleUrl: './television-detail.scss',
})
export class TelevisionDetail implements OnInit {
  @ViewChild('imageFileInput') private imageFileInput?: ElementRef<HTMLInputElement>;
  private readonly pairingService = inject(PairingAdminService);
  private readonly playlistLibrary = inject(PlaylistLibraryService);
  private readonly televisionAdmin = inject(TelevisionAdminService);
  private readonly groupAdmin = inject(GroupAdminService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly television = signal<TelevisionListItem | null>(null);
  protected readonly pageLoading = signal(true);
  protected readonly contentItems = this.pairingService.contentItems;
  protected readonly contentLoading = this.pairingService.contentLoading;
  protected readonly contentError = this.pairingService.contentError;
  protected readonly playlists = this.pairingService.playlists;
  protected readonly selectedPlaylistId = this.pairingService.selectedPlaylistId;
  protected readonly activePlaylistId = this.pairingService.activePlaylistId;
  protected readonly broadcastEnabled = this.pairingService.broadcastEnabled;
  protected readonly broadcastSource = this.pairingService.broadcastSource;
  protected readonly newPlaylistName = signal('');
  protected readonly contentForm = signal({
    name: '',
    type: 'image' as 'image' | 'video' | 'youtube',
    sourceUrl: '',
    durationSeconds: 10,
  });
  protected readonly contentBusy = signal(false);
  protected readonly contentModalVisible = signal(false);
  protected readonly selectedImage = signal<File | null>(null);
  protected readonly contentMessage = signal('');
  protected readonly contentFormError = signal('');
  protected readonly contentUploadError = signal('');
  protected readonly draggedContentIndex = signal<number | null>(null);
  protected readonly contentDropIndex = signal<number | null>(null);
  protected readonly playlistTransferVisible = signal(false);
  protected readonly playlistTransferAction = signal<'copy' | 'move'>('copy');
  protected readonly playlistTargetType = signal<'television' | 'group'>('television');
  protected readonly playlistTargetId = signal('');
  protected readonly playlistTransferBusy = signal(false);
  protected readonly playlistTransferError = signal('');
  protected readonly televisions = this.televisionAdmin.televisions;
  protected readonly groups = this.groupAdmin.groups;

  async ngOnInit(): Promise<void> {
    const televisionId = this.route.snapshot.paramMap.get('id');
    if (!televisionId) {
      await this.router.navigateByUrl('/404');
      return;
    }
    const television = await this.pairingService.getTelevision(televisionId);
    if (!television) {
      await this.router.navigateByUrl('/404');
      return;
    }
    this.television.set(television);
    await this.pairingService.openTelevision(television.id);
    this.pageLoading.set(false);
  }

  protected selectPlaylist(playlistId: string): void {
    const television = this.television();
    if (television) void this.pairingService.selectPlaylist(television.id, playlistId);
  }

  protected updateContentForm(patch: Partial<ReturnType<typeof this.contentForm>>): void {
    this.contentForm.update((value) => ({ ...value, ...patch }));
    if (patch.type && patch.type !== 'image') this.clearSelectedImage();
  }

  protected selectImage(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.contentFormError.set('');
    this.contentUploadError.set('');
    if (file && !isSupportedImageFile(file)) {
      this.contentFormError.set('Формат HEIC не поддерживается. Выберите JPEG, PNG, WebP или GIF.');
      this.clearSelectedImage();
      return;
    }
    if (file && file.size > 10 * 1024 * 1024) {
      this.contentFormError.set('Размер изображения не должен превышать 10 МБ.');
      this.clearSelectedImage();
      return;
    }
    this.selectedImage.set(file);
    if (file && !this.contentForm().name.trim()) {
      this.updateContentForm({ name: file.name.replace(/\.[^.]+$/, '') });
    }
  }

  protected openContentModal(): void {
    this.contentFormError.set('');
    this.contentUploadError.set('');
    this.contentModalVisible.set(true);
  }

  protected closeContentModal(): void {
    if (this.contentBusy()) return;
    this.contentModalVisible.set(false);
    this.resetContentForm();
    this.contentFormError.set('');
    this.contentUploadError.set('');
  }

  protected async addContent(): Promise<void> {
    const television = this.television();
    if (!television) return;
    this.contentBusy.set(true);
    this.contentMessage.set('');
    this.contentFormError.set('');
    this.contentUploadError.set('');
    try {
      await this.pairingService.addContent(television.id, {
        ...this.contentForm(),
        imageFile: this.selectedImage(),
      });
      this.contentModalVisible.set(false);
      this.resetContentForm();
      this.contentMessage.set('Материал сохранён в черновик.');
    } catch (error) {
      const code =
        typeof error === 'object' && error && 'code' in error
          ? String((error as { code: unknown }).code)
          : '';
      if (code.startsWith('storage/')) {
        this.contentUploadError.set(
          code === 'storage/network-unavailable' || code === 'storage/retry-limit-exceeded' || code === 'storage/canceled'
            ? 'Не удалось загрузить файл: нет соединения с интернетом. Проверьте сеть и попробуйте снова.'
            : code === 'storage/quota-exceeded' || code === 'storage/unknown'
            ? 'Firebase Storage отклонил загрузку. Для этого проекта необходимо подключить тариф Blaze.'
            : code === 'storage/unauthorized'
              ? 'Нет разрешения на загрузку файла. Проверьте тариф проекта и правила Firebase Storage.'
              : 'Не удалось загрузить файл в Firebase Storage. Попробуйте ещё раз.',
        );
      } else {
        this.contentFormError.set(
          this.contentForm().type === 'image'
            ? 'Укажите название и загрузите изображение или добавьте корректную ссылку.'
            : 'Укажите название и корректный URL видео или YouTube.',
        );
      }
    } finally {
      this.contentBusy.set(false);
    }
  }

  protected async deleteContent(item: ContentListItem): Promise<void> {
    const television = this.television();
    if (!television) return;
    await this.pairingService.deleteContent(television.id, item.id);
    this.contentMessage.set(
      item.state === 'published'
        ? 'Материал будет удалён после публикации изменений.'
        : 'Черновик удалён.',
    );
  }

  protected async restoreContent(item: ContentListItem): Promise<void> {
    const television = this.television();
    if (!television) return;
    await this.pairingService.restoreContent(television.id, item.id);
    this.contentMessage.set('Удаление отменено.');
  }

  protected startContentDrag(event: DragEvent, index: number): void {
    this.draggedContentIndex.set(index);
    this.contentDropIndex.set(index);
    event.dataTransfer?.setData('text/plain', String(index));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  protected markContentDropTarget(index: number): void {
    this.contentDropIndex.set(index);
  }

  protected dropContent(event: DragEvent, index: number): void {
    event.preventDefault();
    const television = this.television();
    const fromIndex = this.draggedContentIndex();
    if (television && fromIndex !== null) {
      this.pairingService.reorderContent(television.id, fromIndex, index);
      if (fromIndex !== index) {
        this.contentMessage.set('Порядок изменён. Опубликуйте изменения, чтобы обновить эфир.');
      }
    }
    this.finishContentDrag();
  }

  protected finishContentDrag(): void {
    this.draggedContentIndex.set(null);
    this.contentDropIndex.set(null);
  }

  protected async publishContent(): Promise<void> {
    const television = this.television();
    if (!television) return;
    this.contentBusy.set(true);
    this.contentMessage.set('');
    this.contentFormError.set('');
    try {
      await this.pairingService.publishContent(television.id);
      this.contentMessage.set('Изменения опубликованы.');
    } catch {
      this.contentFormError.set('Добавьте хотя бы один материал перед публикацией.');
    } finally {
      this.contentBusy.set(false);
    }
  }

  protected async createPlaylist(): Promise<void> {
    const television = this.television();
    if (!television || !this.newPlaylistName().trim()) return;
    await this.pairingService.createPlaylist(television.id, this.newPlaylistName());
    this.newPlaylistName.set('');
  }

  protected async renamePlaylist(playlistId: string, currentName: string): Promise<void> {
    const television = this.television();
    const name = window.prompt('Новое название плейлиста', currentName)?.trim();
    if (!television || !name || name === currentName) return;
    await this.pairingService.renamePlaylist(television.id, playlistId, name);
  }

  protected openPlaylistTransfer(): void {
    this.playlistTransferAction.set('copy');
    this.playlistTargetType.set('television');
    this.playlistTargetId.set(this.availableTargetTelevisions()[0]?.id ?? '');
    this.playlistTransferError.set('');
    this.playlistTransferVisible.set(true);
  }

  protected closePlaylistTransfer(): void {
    if (!this.playlistTransferBusy()) this.playlistTransferVisible.set(false);
  }

  protected setPlaylistTransferAction(action: 'copy' | 'move'): void {
    this.playlistTransferAction.set(action);
    if (action === 'move') this.playlistTargetType.set('television');
    this.selectFirstPlaylistTarget();
  }

  protected setPlaylistTargetType(type: 'television' | 'group'): void {
    this.playlistTargetType.set(type);
    this.selectFirstPlaylistTarget();
  }

  protected availableTargetTelevisions(): TelevisionListItem[] {
    const currentId = this.television()?.id;
    return this.televisions().filter((item) => item.id !== currentId);
  }

  protected async transferPlaylist(): Promise<void> {
    const playlistId = this.selectedPlaylistId();
    const targetId = this.playlistTargetId();
    const current = this.television();
    if (!playlistId || !targetId || !current) return;

    this.playlistTransferBusy.set(true);
    this.playlistTransferError.set('');
    try {
      if (this.playlistTransferAction() === 'move') {
        await this.playlistLibrary.moveToTelevision(playlistId, targetId, current.id);
        this.contentMessage.set('Плейлист перемещён на другой телевизор.');
      } else if (this.playlistTargetType() === 'group') {
        await this.playlistLibrary.copyToGroup(playlistId, targetId);
        this.contentMessage.set('Копия плейлиста создана для группы.');
      } else {
        await this.playlistLibrary.copyToTelevision(playlistId, targetId);
        this.contentMessage.set('Копия плейлиста создана на другом телевизоре.');
      }
      this.playlistTransferVisible.set(false);
      const refreshed = await this.pairingService.getTelevision(current.id);
      if (refreshed) this.television.set(refreshed);
      await Promise.all([
        this.pairingService.openTelevision(current.id),
        this.televisionAdmin.refresh(),
        this.groupAdmin.refresh(),
      ]);
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      this.playlistTransferError.set(
        code === 'GROUP_PLAYLIST_MOVE_NOT_SUPPORTED'
          ? 'Общий плейлист группы нельзя переместить. Его можно скопировать.'
          : code === 'PLAYLIST_TOO_LARGE'
            ? 'В плейлисте слишком много материалов для одного копирования.'
            : 'Не удалось выполнить операцию. Проверьте соединение и попробуйте снова.',
      );
    } finally {
      this.playlistTransferBusy.set(false);
    }
  }

  protected async activatePlaylist(): Promise<void> {
    const television = this.television();
    if (television) await this.pairingService.activatePlaylist(television.id);
  }

  protected async toggleBroadcast(): Promise<void> {
    const television = this.television();
    if (television) {
      const personalBroadcastIsActive =
        this.broadcastEnabled() && this.broadcastSource() === 'television';
      await this.pairingService.setBroadcastEnabled(television.id, !personalBroadcastIsActive);
    }
  }

  protected playlistName(playlistId: string): string {
    return this.playlists().find((playlist) => playlist.id === playlistId)?.name ?? 'Основной';
  }

  protected async deleteTelevision(): Promise<void> {
    const television = this.television();
    if (!television) return;
    if (!window.confirm(`Удалить телевизор «${television.name}» и весь его контент?`)) return;
    await this.pairingService.deleteTelevision(television);
    await this.router.navigateByUrl('/televisions');
  }

  private clearSelectedImage(): void {
    this.selectedImage.set(null);
    if (this.imageFileInput) this.imageFileInput.nativeElement.value = '';
  }

  private resetContentForm(): void {
    this.contentForm.set({ name: '', type: 'image', sourceUrl: '', durationSeconds: 10 });
    this.clearSelectedImage();
  }

  private selectFirstPlaylistTarget(): void {
    const targets = this.playlistTargetType() === 'group' ? this.groups() : this.availableTargetTelevisions();
    this.playlistTargetId.set(targets[0]?.id ?? '');
  }
}
