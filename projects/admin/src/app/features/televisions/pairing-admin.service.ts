import { Injectable, inject } from '@angular/core';
import type { ContentListItem, PlaylistSummary, TelevisionListItem } from 'shared';
import { ContentAdminService, extractYouTubeVideoId } from './content-admin.service';
import { isSupportedImageFile } from './content-upload.service';
import { PairingRequestsService, type PendingPairingRequest } from './pairing-requests.service';
import { PlaylistAdminService } from './playlist-admin.service';
import { TelevisionAdminService } from './television-admin.service';

export { extractYouTubeVideoId, isSupportedImageFile };
export type { ContentListItem, PendingPairingRequest, PlaylistSummary, TelevisionListItem };

/**
 * Compatibility facade for the television feature.
 *
 * Components keep a small stable API while the actual work is split between
 * pairing, television, playlist, content and upload services.
 */
@Injectable({ providedIn: 'root' })
export class PairingAdminService {
  private readonly pairing = inject(PairingRequestsService);
  private readonly televisionAdmin = inject(TelevisionAdminService);
  private readonly playlistAdmin = inject(PlaylistAdminService);
  private readonly contentAdmin = inject(ContentAdminService);

  readonly televisions = this.televisionAdmin.televisions;
  readonly televisionsLoading = this.televisionAdmin.loading;
  readonly televisionsError = this.televisionAdmin.error;
  readonly contentItems = this.contentAdmin.items;
  readonly contentLoading = this.contentAdmin.loading;
  readonly contentError = this.contentAdmin.error;
  readonly playlists = this.playlistAdmin.playlists;
  readonly selectedPlaylistId = this.playlistAdmin.selectedPlaylistId;
  readonly activePlaylistId = this.playlistAdmin.activePlaylistId;
  readonly broadcastEnabled = this.playlistAdmin.broadcastEnabled;
  readonly broadcastSource = this.playlistAdmin.broadcastSource;
  readonly pendingRequests$ = this.pairing.pendingRequests$;

  refreshTelevisions(): Promise<void> {
    return this.televisionAdmin.refresh();
  }

  getTelevision(televisionId: string): Promise<TelevisionListItem | null> {
    return this.televisionAdmin.get(televisionId);
  }

  pair(code: string, name: string): Promise<void> {
    return this.pairing.pair(code, name);
  }

  loadContent(televisionId: string, forceRefresh = false): Promise<void> {
    return this.contentAdmin.load(televisionId, forceRefresh);
  }

  addContent(
    televisionId: string,
    value: {
      name: string;
      type: 'image' | 'video' | 'youtube';
      sourceUrl: string;
      durationSeconds: number;
      imageFile?: File | null;
    },
  ): Promise<void> {
    return this.contentAdmin.add(televisionId, value);
  }

  deleteContent(televisionId: string, contentId: string): Promise<void> {
    return this.contentAdmin.delete(televisionId, contentId);
  }

  restoreContent(televisionId: string, contentId: string): Promise<void> {
    return this.contentAdmin.restore(televisionId, contentId);
  }

  publishContent(televisionId: string): Promise<void> {
    return this.contentAdmin.publish(televisionId);
  }

  reorderContent(televisionId: string, fromIndex: number, toIndex: number): void {
    this.contentAdmin.reorder(televisionId, fromIndex, toIndex);
  }

  async openTelevision(televisionId: string): Promise<void> {
    await this.playlistAdmin.openTelevision(televisionId);
    await this.contentAdmin.load(televisionId);
  }

  async selectPlaylist(televisionId: string, playlistId: string): Promise<void> {
    if (this.playlistAdmin.select(playlistId)) await this.contentAdmin.load(televisionId);
  }

  async createPlaylist(televisionId: string, name: string): Promise<void> {
    await this.playlistAdmin.create(televisionId, name);
    await this.contentAdmin.load(televisionId);
  }

  renamePlaylist(televisionId: string, playlistId: string, name: string): Promise<void> {
    return this.playlistAdmin.rename(televisionId, playlistId, name);
  }

  activatePlaylist(televisionId: string): Promise<void> {
    return this.playlistAdmin.activate(televisionId);
  }

  setBroadcastEnabled(televisionId: string, enabled: boolean): Promise<void> {
    return this.playlistAdmin.setBroadcastEnabled(televisionId, enabled);
  }

  async deleteTelevision(television: TelevisionListItem): Promise<void> {
    await this.televisionAdmin.delete(television);
    this.contentAdmin.clearTelevision(television.id);
    this.playlistAdmin.reset();
  }
}
