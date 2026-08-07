export const environment = {
  production: false,
  useFirebaseEmulators: true,
  firebase: {
    apiKey: 'demo-api-key',
    authDomain: 'demo-tv-manage-app.firebaseapp.com',
    projectId: 'demo-tv-manage-app',
    storageBucket: 'demo-tv-manage-app.appspot.com',
    appId: 'demo-app-id',
  },
} as const;
