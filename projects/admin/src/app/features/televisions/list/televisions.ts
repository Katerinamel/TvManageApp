import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { PairingAdminService } from '../pairing-admin.service';

@Component({
  selector: 'app-televisions',
  imports: [RouterLink, NzButtonModule],
  templateUrl: './televisions.html',
  styleUrl: './televisions.scss',
})
export class Televisions {
  private readonly pairingService = inject(PairingAdminService);

  protected readonly televisions = this.pairingService.televisions;
  protected readonly televisionsLoading = this.pairingService.televisionsLoading;
  protected readonly televisionsError = this.pairingService.televisionsError;
  protected refreshTelevisions(): void {
    void this.pairingService.refreshTelevisions();
  }
}
