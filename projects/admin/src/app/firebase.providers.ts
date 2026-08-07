import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { provideFirebaseApp, initializeApp } from '@angular/fire/app';
import { connectAuthEmulator, getAuth, provideAuth } from '@angular/fire/auth';
import { connectFirestoreEmulator, getFirestore, provideFirestore } from '@angular/fire/firestore';
import { connectStorageEmulator, getStorage, provideStorage } from '@angular/fire/storage';
import { environment } from '../environments/environment';

export function provideFirebase(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideFirebaseApp(() => initializeApp(environment.firebase)),
    provideAuth(() => {
      const auth = getAuth();
      if (environment.useFirebaseEmulators)
        connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      return auth;
    }),
    provideFirestore(() => {
      const firestore = getFirestore();
      if (environment.useFirebaseEmulators) connectFirestoreEmulator(firestore, '127.0.0.1', 8080);
      return firestore;
    }),
    provideStorage(() => {
      const storage = getStorage();
      if (environment.useFirebaseEmulators) connectStorageEmulator(storage, '127.0.0.1', 9199);
      return storage;
    }),
  ]);
}
