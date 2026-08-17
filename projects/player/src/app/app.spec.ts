import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { App } from './app';
import { PairingService } from './pairing.service';

const pairingServiceMock = {
  code: signal('483921'),
  state: signal<'loading' | 'pending' | 'paired' | 'error'>('pending'),
  errorMessage: signal(''),
  televisionId: signal<string | null>(null),
  televisionName: signal('Телевизор в сауне'),
  contentItems: signal<
    Array<{
      id: string;
      name: string;
      type: 'image' | 'video';
      sourceUrl: string;
      order: number;
      state: 'published';
    }>
  >([]),
  contentError: signal(''),
  broadcastEnabled: signal(true),
  activePlaylistName: signal('Основной'),
  start: vi.fn().mockResolvedValue(undefined),
};

describe('App', () => {
  beforeEach(async () => {
    pairingServiceMock.state.set('pending');
    pairingServiceMock.contentItems.set([]);
    pairingServiceMock.broadcastEnabled.set(true);
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [{ provide: PairingService, useValue: pairingServiceMock }],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render title', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Подключите этот экран');
    expect(compiled.querySelector('.pairing-code')?.textContent).toContain('483');
    expect(compiled.querySelector('.pairing-code')?.textContent).toContain('921');
  });

  it('does not show a pairing code while checking an existing connection', async () => {
    pairingServiceMock.state.set('loading');
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Загружаем экран');
    expect(fixture.nativeElement.querySelector('.pairing-code')).toBeNull();
  });

  it('renders published image content after pairing', async () => {
    pairingServiceMock.state.set('paired');
    pairingServiceMock.contentItems.set([
      {
        id: 'item-1',
        name: 'Меню',
        type: 'image',
        sourceUrl: 'https://example.com/menu.jpg',
        order: 0,
        state: 'published',
      },
    ]);
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const image = fixture.nativeElement.querySelector('.playback-screen img') as HTMLImageElement;
    expect(image.alt).toBe('Меню');
    expect(image.src).toContain('menu.jpg');
  });

  it('shows when broadcasting is disabled', async () => {
    pairingServiceMock.state.set('paired');
    pairingServiceMock.broadcastEnabled.set(false);
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Трансляция приостановлена');
    expect(fixture.nativeElement.textContent).toContain('Телевизор в сауне');
  });
});
