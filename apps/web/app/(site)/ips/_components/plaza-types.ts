export interface PlazaProject {
  id: string;
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
  eyebrow: string;
}
