import { Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { PairingService } from './pairing.service';
import { YouTubePlayer } from './youtube-player';

@Component({
  selector: 'app-root',
  imports: [YouTubePlayer],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  protected readonly pairing = inject(PairingService);
  protected readonly currentIndex = signal(0);
  protected readonly currentItem = computed(() => {
    const items = this.pairing.contentItems();
    return items[this.currentIndex() % Math.max(items.length, 1)] ?? null;
  });

  private readonly rotateImages = effect((onCleanup) => {
    const item = this.currentItem();
    const itemCount = this.pairing.contentItems().length;
    if (!item || item.type !== 'image' || itemCount < 2) return;
    const timeout = window.setTimeout(
      () => this.nextItem(),
      Math.max(1, item.durationSeconds ?? 10) * 1000,
    );
    onCleanup(() => window.clearTimeout(timeout));
  });

  ngOnInit(): void {
    void this.pairing.start();
  }

  protected codePart(index: 0 | 1): string {
    return this.pairing.code().slice(index * 3, index * 3 + 3);
  }

  protected nextItem(): void {
    const count = this.pairing.contentItems().length;
    if (count) this.currentIndex.update((index) => (index + 1) % count);
  }
}
