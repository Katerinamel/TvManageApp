import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { Auth, signInAnonymously } from '@angular/fire/auth';
import {
  Firestore,
  Timestamp,
  collection,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from '@angular/fire/firestore';

type PlayerState = 'loading' | 'pending' | 'paired' | 'error';

interface PairingDocument {
  code: string;
  deviceId: string;
  status: 'pending' | 'paired' | 'expired';
  expiresAt: Timestamp;
  pairedTelevisionId?: string;
}

function youtubeIdFromUrl(sourceUrl: string): string | null {
  try {
    const url = new URL(sourceUrl);
    const host = url.hostname.replace(/^www\./, '');
    const candidate =
      host === 'youtu.be'
        ? (url.pathname.split('/').filter(Boolean)[0] ?? null)
        : host === 'youtube.com' || host === 'm.youtube.com'
          ? (url.searchParams.get('v') ??
            url.pathname.match(/^\/(?:shorts|embed|live)\/([^/?]+)/)?.[1] ??
            null)
          : null;
    return candidate && /^[a-zA-Z0-9_-]{11}$/.test(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

export interface PlayerContentItem {
  id: string;
  name: string;
  type: 'image' | 'video' | 'youtube';
  sourceUrl: string;
  youtubeVideoId?: string;
  order: number;
  durationSeconds?: number;
  state: 'draft' | 'published';
  playlistId?: string;
}

@Injectable({ providedIn: 'root' })
export class PairingService implements OnDestroy {
  private readonly auth = inject(Auth);
  private readonly firestore = inject(Firestore);
  private unsubscribe?: () => void;
  private unsubscribeContent?: () => void;
  private unsubscribeTelevision?: () => void;
  private watchedTelevisionId?: string;
  private allContentItems: PlayerContentItem[] = [];
  private currentPlaylistId = 'default';

  readonly code = signal('');
  readonly state = signal<PlayerState>('loading');
  readonly errorMessage = signal('');
  readonly televisionId = signal<string | null>(null);
  readonly contentItems = signal<PlayerContentItem[]>([]);
  readonly contentError = signal('');
  readonly broadcastEnabled = signal(true);
  readonly activePlaylistName = signal('Основной');

  async start(): Promise<void> {
    try {
      this.state.set('loading');
      const credential = this.auth.currentUser
        ? { user: this.auth.currentUser }
        : await signInAnonymously(this.auth);
      const deviceId = credential.user.uid;
      const requestRef = doc(this.firestore, `pairingRequests/${deviceId}`);
      const existing = await getDoc(requestRef);
      const existingData = existing.data() as PairingDocument | undefined;

      this.unsubscribe?.();
      this.unsubscribe = onSnapshot(
        requestRef,
        (snapshot) => {
          const request = snapshot.data() as PairingDocument | undefined;
          if (!request && this.state() === 'paired') {
            this.unsubscribe?.();
            this.unsubscribe = undefined;
            this.resetTelevision();
            this.state.set('loading');
            queueMicrotask(() => void this.start());
            return;
          }
          if (request?.status === 'paired') {
            this.televisionId.set(request.pairedTelevisionId ?? null);
            this.state.set('paired');
            if (request.pairedTelevisionId) this.watchContent(request.pairedTelevisionId);
          }
        },
        (error) => {
          console.error('Pairing listener failed', error);
          this.errorMessage.set('Связь с Firebase прервана. Обновите страницу через несколько секунд.');
          this.state.set('error');
        },
      );

      if (existingData?.status === 'paired') {
        this.televisionId.set(existingData.pairedTelevisionId ?? null);
        this.state.set('paired');
        if (existingData.pairedTelevisionId) this.watchContent(existingData.pairedTelevisionId);
        return;
      }

      const canReuse =
        existingData?.status === 'pending' && existingData.expiresAt.toMillis() > Date.now();
      const code = canReuse ? existingData.code : this.createCode();

      if (!canReuse) {
        await setDoc(requestRef, {
          deviceId,
          code,
          status: 'pending',
          createdAt: serverTimestamp(),
          expiresAt: Timestamp.fromMillis(Date.now() + 10 * 60 * 1000),
        });
      }

      this.code.set(code);
      this.state.set('pending');
    } catch (error) {
      console.error('Unable to start pairing', error);
      this.errorMessage.set('Не удалось подключиться к Firebase. Проверьте интернет и обновите страницу.');
      this.state.set('error');
    }
  }

  ngOnDestroy(): void {
    this.unsubscribe?.();
    this.unsubscribeContent?.();
    this.unsubscribeTelevision?.();
  }

  private watchContent(televisionId: string): void {
    if (this.watchedTelevisionId === televisionId) return;
    this.watchedTelevisionId = televisionId;
    this.unsubscribeContent?.();
    this.unsubscribeTelevision?.();
    this.unsubscribeTelevision = onSnapshot(
      doc(this.firestore, `televisions/${televisionId}`),
      (snapshot) => {
        const television = snapshot.data() as
          | {
              activePlaylistId?: string;
              broadcastEnabled?: boolean;
              playlists?: Array<{ id: string; name: string }>;
            }
          | undefined;
        this.currentPlaylistId = television?.activePlaylistId ?? 'default';
        this.broadcastEnabled.set(television?.broadcastEnabled ?? true);
        this.activePlaylistName.set(
          television?.playlists?.find((playlist) => playlist.id === this.currentPlaylistId)?.name ??
            'Основной',
        );
        this.applyActivePlaylist();
      },
      (error) => {
        console.error('Television listener failed', error);
        this.contentError.set('Не удалось получить настройки трансляции.');
      },
    );
    this.unsubscribeContent = onSnapshot(
      collection(this.firestore, `televisions/${televisionId}/contentItems`),
      (snapshot) => {
        this.contentError.set('');
        this.allContentItems = snapshot.docs
            .map((item) => {
              const content = { id: item.id, ...item.data() } as PlayerContentItem;
              const youtubeVideoId = content.youtubeVideoId ?? youtubeIdFromUrl(content.sourceUrl);
              return youtubeVideoId
                ? { ...content, type: 'youtube' as const, youtubeVideoId }
                : content;
            });
        this.applyActivePlaylist();
      },
      (error) => {
        console.error('Content listener failed', error);
        this.contentError.set('Не удалось получить опубликованный контент.');
      },
    );
  }

  private applyActivePlaylist(): void {
    if (!this.broadcastEnabled()) {
      this.contentItems.set([]);
      return;
    }
    this.contentItems.set(
      this.allContentItems
        .filter(
          (item) =>
            item.state === 'published' &&
            (item.playlistId === this.currentPlaylistId ||
              (!item.playlistId && this.currentPlaylistId === 'default')),
        )
        .sort((a, b) => a.order - b.order),
    );
  }

  private resetTelevision(): void {
    this.unsubscribeContent?.();
    this.unsubscribeContent = undefined;
    this.unsubscribeTelevision?.();
    this.unsubscribeTelevision = undefined;
    this.watchedTelevisionId = undefined;
    this.allContentItems = [];
    this.televisionId.set(null);
    this.contentItems.set([]);
    this.contentError.set('');
    this.broadcastEnabled.set(true);
    this.activePlaylistName.set('Основной');
  }

  private createCode(): string {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return String((values[0] ?? 0) % 1_000_000).padStart(6, '0');
  }
}
