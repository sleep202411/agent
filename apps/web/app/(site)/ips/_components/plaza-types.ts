export interface PlazaProject {
  channelType?: "ip" | "community";
  id: string;
  roomNumber: string;
  name: string;
  subtitle: string;
  description: string;
  cover: string;
  trailer: string;
  /** Creator user id — seeds the dicebear fallback + resolves the live avatar. */
  ownerId: string;
  ownerName: string;
  ownerAvatar: string;
  genres: string[];
  tags: string[];
  episodes: number;
  viewCount: number;
  likeCount: number;
  collectionCount: number;
  eyebrow: string;
  /** ISO-3166 alpha-2 or 'GLOBAL'; "" = unspecified. */
  region: string;
}
