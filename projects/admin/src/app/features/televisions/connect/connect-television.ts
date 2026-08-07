import { AsyncPipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { PairingAdminService, PendingPairingRequest } from '../pairing-admin.service';

@Component({
  selector: 'app-connect-television',
  imports: [AsyncPipe, FormsModule, RouterLink, NzButtonModule, NzInputModule],
  templateUrl: './connect-television.html',
  styleUrl: './connect-television.scss',
})
export class ConnectTelevision {
  private readonly pairingService = inject(PairingAdminService);
  private readonly router = inject(Router);

  protected readonly pendingRequests$ = this.pairingService.pendingRequests$;
  protected readonly pairing = signal({ code: '', name: '' });
  protected readonly isPairing = signal(false);
  protected readonly errorMessage = signal('');

  protected selectRequest(request: PendingPairingRequest): void {
    this.pairing.update((value) => ({ ...value, code: request.code }));
    this.errorMessage.set('');
  }

  protected async pairTelevision(): Promise<void> {
    this.errorMessage.set('');
    this.isPairing.set(true);
    try {
      await this.pairingService.pair(this.pairing().code, this.pairing().name);
      await this.router.navigateByUrl('/televisions');
    } catch (error) {
      this.errorMessage.set(
        error instanceof Error && error.message === 'PAIRING_NOT_FOUND'
          ? 'Активный запрос с таким кодом не найден. Проверьте код на экране.'
          : 'Введите шестизначный код и название телевизора.',
      );
    } finally {
      this.isPairing.set(false);
    }
  }
}
