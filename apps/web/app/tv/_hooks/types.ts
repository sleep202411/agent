/**
 * One entry in the TV IP list. Preview URLs prefer trailers; the server
 * withholds mediaAsset URLs for locked episodes.
 */
export interface TvItem {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  cover: string;
  trailer: string;
  ownerName: string;
  episodeCount: number;
}
