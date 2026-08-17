import { Injectable, signal } from '@angular/core';
import type { PlaylistSummary } from 'shared';

@Injectable({ providedIn: 'root' })
export class TelevisionEditorStore {
  readonly playlists = signal<PlaylistSummary[]>([]);
  readonly selectedPlaylistId = signal('default');
  readonly activePlaylistId = signal('default');
  readonly broadcastEnabled = signal(true);
  readonly libraryMode = signal(false);

  reset(): void {
    this.playlists.set([]);
    this.selectedPlaylistId.set('default');
    this.activePlaylistId.set('default');
    this.broadcastEnabled.set(true);
    this.libraryMode.set(false);
  }
}
