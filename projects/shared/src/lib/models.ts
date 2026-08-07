export type ScreenOrientation = 'landscape' | 'portrait';
export type ContentType = 'image' | 'video' | 'youtube';
export type ContentState = 'draft' | 'published';

export interface Television {
  id: string;
  deviceId: string;
  name: string;
  location?: string;
  description?: string;
  orientation: ScreenOrientation;
  resolution?: { width: number; height: number };
  pairingStatus: 'paired' | 'unpaired';
  publishedRevision: number;
  playlists?: Array<{ id: string; name: string }>;
  activePlaylistId?: string;
  broadcastEnabled?: boolean;
  publishedAt?: Date;
  updatedAt: Date;
  createdAt: Date;
}

export interface TelevisionContentItem {
  id: string;
  name: string;
  type: ContentType;
  mimeType: string;
  storagePath?: string;
  sourceUrl?: string;
  youtubeVideoId?: string;
  playlistId?: string;
  order: number;
  durationSeconds?: number;
  size: number;
  createdAt: Date;
  updatedAt: Date;
  state: ContentState;
  revision?: number;
}

export interface PairingRequest {
  deviceId: string;
  code: string;
  status: 'pending' | 'paired' | 'expired';
  createdAt: Date;
  expiresAt: Date;
  pairedTelevisionId?: string;
}
