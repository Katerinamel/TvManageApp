import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { PairingAdminService } from './pairing-admin.service';

const FIRESTORE_AUTO_ID = /^[A-Za-z0-9]{20}$/;

export const televisionExistsGuard: CanActivateFn = async (route) => {
  const router = inject(Router);
  const pairingService = inject(PairingAdminService);
  const televisionId = route.paramMap.get('id');

  if (!televisionId || !FIRESTORE_AUTO_ID.test(televisionId)) {
    return router.createUrlTree(['/404']);
  }

  const television = await pairingService.getTelevision(televisionId);
  return television ? true : router.createUrlTree(['/404']);
};
