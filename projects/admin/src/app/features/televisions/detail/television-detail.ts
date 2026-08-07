import { Component, ElementRef, OnInit, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzModalModule } from 'ng-zorro-antd/modal';
import {
  ContentListItem,
  PairingAdminService,
  TelevisionListItem,
  isSupportedImageFile,
} from '../pairing-admin.service';

@Component({
  selector: 'app-television-detail',
  imports: [FormsModule, RouterLink, NzButtonModule, NzInputModule, NzModalModule],
  templateUrl: './television-detail.html',
  styleUrl: './television-detail.scss',
})
export class TelevisionDetail implements OnInit {
  @ViewChild('imageFileInput') private imageFileInput?: ElementRef<HTMLInputElement>;
  private readonly pairingService = inject(PairingAdminService);
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

  protected async activatePlaylist(): Promise<void> {
    const television = this.television();
    if (television) await this.pairingService.activatePlaylist(television.id);
  }

  protected async toggleBroadcast(): Promise<void> {
    const television = this.television();
    if (television) {
      await this.pairingService.setBroadcastEnabled(television.id, !this.broadcastEnabled());
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
}
