export type ScreenOrientation = 'landscape' | 'portrait';
export type ContentType = 'image' | 'video' | 'youtube';
export type ContentState = 'draft' | 'published';

export interface PlaylistSummary {
  id: string;
  name: string;
}

export type PlaylistOwnerType = 'television' | 'group';
export type BroadcastSource = 'television' | 'group';

export interface Playlist {
  id: string;
  name: string;
  ownerType: PlaylistOwnerType;
  ownerId: string;
  assignedTelevisionIds: string[];
  viewerDeviceIds: string[];
  sourcePlaylistId?: string;
  previousOwnerType?: PlaylistOwnerType;
  previousOwnerId?: string;
  previousAssignedTelevisionIds?: string[];
  previousViewerDeviceIds?: string[];
  createdAt?: Date;
  updatedAt?: Date;
}

export interface TelevisionGroup {
  id: string;
  name: string;
  televisionIds: string[];
  deviceIds: string[];
  activePlaylistId?: string;
  broadcastEnabled: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

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
  playlists?: PlaylistSummary[];
  playlistIds?: string[];
  libraryActivePlaylistId?: string;
  personalPlaylistId?: string;
  playlistSchemaVersion?: number;
  groupId?: string;
  activePlaylistId?: string;
  broadcastEnabled?: boolean;
  broadcastSource?: BroadcastSource;
  publishedAt?: Date;
  updatedAt: Date;
  createdAt: Date;
}

export interface TelevisionContentItem {
  id: string;
  name: string;
  type: ContentType;
  mimeType?: string;
  storagePath?: string;
  sourceUrl: string;
  youtubeVideoId?: string;
  playlistId?: string;
  order: number;
  durationSeconds?: number;
  size?: number;
  createdAt?: Date;
  updatedAt?: Date;
  state: ContentState;
  revision?: number;
  pendingDelete?: boolean;
}

export type TelevisionListItem = Pick<
  Television,
  | 'id'
  | 'name'
  | 'deviceId'
  | 'pairingStatus'
  | 'playlists'
  | 'playlistIds'
  | 'libraryActivePlaylistId'
  | 'personalPlaylistId'
  | 'playlistSchemaVersion'
  | 'groupId'
  | 'activePlaylistId'
  | 'broadcastEnabled'
  | 'broadcastSource'
>;

export type ContentListItem = Pick<
  TelevisionContentItem,
  | 'id'
  | 'name'
  | 'type'
  | 'sourceUrl'
  | 'youtubeVideoId'
  | 'order'
  | 'durationSeconds'
  | 'state'
  | 'playlistId'
  | 'pendingDelete'
  | 'storagePath'
>;

export interface PairingRequest {
  deviceId: string;
  code: string;
  status: 'pending' | 'paired' | 'expired';
  createdAt: Date;
  expiresAt: Date;
  pairedTelevisionId?: string;
}
