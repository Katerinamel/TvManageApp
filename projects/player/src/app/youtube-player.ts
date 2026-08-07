import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';

interface YouTubePlayerInstance {
  destroy(): void;
  loadVideoById(videoId: string): void;
  mute(): void;
  playVideo(): void;
}

interface YouTubeApi {
  Player: new (
    element: HTMLElement,
    options: {
      width: string;
      height: string;
      videoId: string;
      playerVars: Record<string, number | string>;
      events: {
        onReady: (event: { target: YouTubePlayerInstance }) => void;
        onStateChange: (event: { data: number }) => void;
      };
    },
  ) => YouTubePlayerInstance;
  PlayerState: { ENDED: number };
}

interface YouTubeWindow extends Window {
  YT?: YouTubeApi;
  onYouTubeIframeAPIReady?: () => void;
}

let apiPromise: Promise<YouTubeApi> | undefined;

function loadYouTubeApi(): Promise<YouTubeApi> {
  const youtubeWindow = window as YouTubeWindow;
  if (youtubeWindow.YT?.Player) return Promise.resolve(youtubeWindow.YT);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<YouTubeApi>((resolve) => {
    const previousReady = youtubeWindow.onYouTubeIframeAPIReady;
    youtubeWindow.onYouTubeIframeAPIReady = () => {
      previousReady?.();
      if (youtubeWindow.YT) resolve(youtubeWindow.YT);
    };
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      document.head.appendChild(script);
    }
  });
  return apiPromise;
}

@Component({
  selector: 'app-youtube-player',
  standalone: true,
  template: '<div #host class="youtube-host"></div>',
  styles: `
    :host, .youtube-host { display: block; width: 100%; height: 100%; background: #000; }
  `,
})
export class YouTubePlayer implements AfterViewInit, OnChanges, OnDestroy {
  @Input({ required: true }) videoId = '';
  @Input() loop = false;
  @Output() readonly playbackEnded = new EventEmitter<void>();
  @ViewChild('host', { static: true }) private host?: ElementRef<HTMLElement>;

  private player?: YouTubePlayerInstance;
  private api?: YouTubeApi;
  private destroyed = false;

  async ngAfterViewInit(): Promise<void> {
    this.api = await loadYouTubeApi();
    if (this.destroyed || !this.host) return;
    this.player = new this.api.Player(this.host.nativeElement, {
      width: '100%',
      height: '100%',
      videoId: this.videoId,
      playerVars: {
        autoplay: 1,
        controls: 0,
        disablekb: 1,
        playsinline: 1,
        rel: 0,
        mute: 1,
        origin: window.location.origin,
      },
      events: {
        onReady: ({ target }) => {
          target.mute();
          target.playVideo();
        },
        onStateChange: ({ data }) => {
          if (data !== this.api?.PlayerState.ENDED) return;
          if (this.loop) {
            this.player?.loadVideoById(this.videoId);
          } else {
            this.playbackEnded.emit();
          }
        },
      },
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['videoId'] && !changes['videoId'].firstChange && this.player) {
      this.player.loadVideoById(this.videoId);
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.player?.destroy();
  }
}
