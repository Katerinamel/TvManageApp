import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  Timestamp,
  collection,
  collectionData,
  doc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from '@angular/fire/firestore';
import { Observable, map } from 'rxjs';
import { TelevisionAdminService } from './television-admin.service';

export interface PendingPairingRequest {
  deviceId: string;
  code: string;
  expiresAt: Timestamp;
}

@Injectable({ providedIn: 'root' })
export class PairingRequestsService {
  private readonly firestore = inject(Firestore);
  private readonly televisions = inject(TelevisionAdminService);

  readonly pendingRequests$: Observable<PendingPairingRequest[]> = collectionData(
    query(collection(this.firestore, 'pairingRequests'), where('status', '==', 'pending')),
  ).pipe(
    map((requests) =>
      (requests as PendingPairingRequest[])
        .filter((request) => request.expiresAt.toMillis() > Date.now())
        .sort((a, b) => a.expiresAt.toMillis() - b.expiresAt.toMillis()),
    ),
  );

  async pair(codeInput: string, nameInput: string): Promise<void> {
    const code = codeInput.replace(/\D/g, '');
    const name = nameInput.trim();
    if (code.length !== 6 || !name) throw new Error('INVALID_INPUT');

    const matches = await getDocs(
      query(collection(this.firestore, 'pairingRequests'), where('code', '==', code)),
    );
    const match = matches.docs.find((item) => {
      const data = item.data() as { status?: string; expiresAt?: Timestamp };
      return (
        data.status === 'pending' && !!data.expiresAt && data.expiresAt.toMillis() > Date.now()
      );
    });
    if (!match) throw new Error('PAIRING_NOT_FOUND');

    const request = match.data() as PendingPairingRequest;
    const televisionRef = doc(collection(this.firestore, 'televisions'));
    const batch = writeBatch(this.firestore);
    batch.set(televisionRef, {
      deviceId: request.deviceId,
      name,
      orientation: 'landscape',
      pairingStatus: 'paired',
      publishedRevision: 0,
      playlists: [{ id: 'default', name: 'Основной' }],
      activePlaylistId: 'default',
      broadcastEnabled: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.update(match.ref, {
      status: 'paired',
      pairedTelevisionId: televisionRef.id,
    });
    await batch.commit();
    await this.televisions.refresh();
  }
}
