/**
 * Types alignés sur les réponses Jikan v4 (anime / recherche / annexes).
 * Champs optionnels là où l’API peut omettre des valeurs.
 */

export type JikanMalMini = {
  mal_id: number;
  type: string;
  name: string;
  url: string;
};

export type JikanImageJpg = {
  image_url: string | null;
  small_image_url: string | null;
  large_image_url: string | null;
};

export type JikanImageWebp = {
  image_url: string | null;
  small_image_url: string | null;
  large_image_url: string | null;
};

export type JikanAnimeImages = {
  jpg: JikanImageJpg;
  webp: JikanImageWebp;
};

export type JikanTrailer = {
  youtube_id: string | null;
  url: string | null;
  embed_url: string | null;
  images: {
    image_url: string | null;
    small_image_url: string | null;
    medium_image_url: string | null;
    large_image_url: string | null;
    maximum_image_url: string | null;
  };
};

export type JikanTitleVariant = {
  type: string;
  title: string;
};

export type JikanAiredProp = {
  from: { day: number | null; month: number | null; year: number | null };
  to: { day: number | null; month: number | null; year: number | null };
};

export type JikanAired = {
  from: string | null;
  to: string | null;
  prop: JikanAiredProp;
  string: string | null;
};

export type JikanBroadcast = {
  day: string | null;
  time: string | null;
  timezone: string | null;
  string: string | null;
};

export type JikanRelationGroup = {
  relation: string;
  entry: JikanMalMini[];
};

export type JikanThemeSongs = {
  openings: string[];
  endings: string[];
};

export type JikanExternalLink = {
  name: string;
  url: string;
};

export type JikanStreamingLink = {
  name: string;
  url: string;
};

/** Corps principal retourné par GET /anime/{id}/full (clé data). */
export type JikanAnimeFull = {
  mal_id: number;
  url: string;
  images: JikanAnimeImages;
  trailer: JikanTrailer;
  approved: boolean;
  titles: JikanTitleVariant[];
  title: string;
  title_english: string | null;
  title_japanese: string | null;
  title_synonyms: string[];
  type: string;
  source: string;
  episodes: number | null;
  status: string;
  airing: boolean;
  aired: JikanAired;
  duration: string;
  rating: string;
  score: number | null;
  scored_by: number | null;
  rank: number | null;
  popularity: number | null;
  members: number | null;
  favorites: number | null;
  synopsis: string | null;
  background: string | null;
  season: string | null;
  year: number | null;
  broadcast: JikanBroadcast;
  producers: JikanMalMini[];
  licensors: JikanMalMini[];
  studios: JikanMalMini[];
  genres: JikanMalMini[];
  explicit_genres: JikanMalMini[];
  themes: JikanMalMini[];
  demographics: JikanMalMini[];
  relations: JikanRelationGroup[];
  theme: JikanThemeSongs;
  external: JikanExternalLink[];
  streaming: JikanStreamingLink[];
};

export type JikanAnimeFullResponse = {
  data: JikanAnimeFull;
};

/** Résultat de recherche (aperçu). */
export type JikanAnimeSearchItem = {
  mal_id: number;
  url: string;
  images: JikanAnimeImages;
  title: string;
  type: string;
  synopsis: string | null;
  episodes: number | null;
  score: number | null;
  aired: { from: string | null; to: string | null; string: string | null };
};

export type JikanPagination = {
  last_visible_page: number;
  has_next_page: boolean;
  current_page?: number;
  items?: { count: number; total: number; per_page: number };
};

export type JikanAnimeSearchResponse = {
  pagination: JikanPagination;
  data: JikanAnimeSearchItem[];
};

export type JikanAnimeByIdResponse = {
  data: JikanAnimeFull;
};

export type JikanCharacterMini = {
  mal_id: number;
  url: string;
  images: {
    jpg: { image_url: string | null };
    webp: {
      image_url: string | null;
      small_image_url: string | null;
    };
  };
  name: string;
};

export type JikanPersonMini = {
  mal_id: number;
  url: string;
  images: { jpg: { image_url: string | null } };
  name: string;
};

export type JikanAnimeCharacterEntry = {
  character: JikanCharacterMini;
  role: string;
  favorites: number;
  voice_actors: Array<{
    person: JikanPersonMini;
    language: string;
  }>;
};

export type JikanAnimeCharactersResponse = {
  data: JikanAnimeCharacterEntry[];
};

export type JikanAnimeStaffEntry = {
  person: JikanPersonMini;
  positions: string[];
};

export type JikanAnimeStaffResponse = {
  data: JikanAnimeStaffEntry[];
};

export type JikanEpisodeEntry = {
  mal_id: number;
  url: string;
  title: string;
  japanese_title: string | null;
  aired: string | null;
  filler: boolean;
  recap: boolean;
  forum_url: string | null;
};

export type JikanAnimeEpisodesResponse = {
  pagination: JikanPagination;
  data: JikanEpisodeEntry[];
};

export type JikanNewsEntry = {
  mal_id: number;
  url: string;
  title: string;
  date: string;
  author_username: string;
  author_url: string;
  forum_url: string;
  images: { jpg: { image_url: string | null } };
  comments: number;
  excerpt: string;
};

export type JikanAnimeNewsResponse = {
  pagination: JikanPagination;
  data: JikanNewsEntry[];
};

export type JikanPictureEntry = {
  jpg: {
    image_url: string | null;
    large_image_url: string | null;
  };
};

export type JikanAnimePicturesResponse = {
  data: JikanPictureEntry[];
};

export type JikanAnimeVideosData = {
  promo: Array<{
    title: string;
    trailer: JikanTrailer;
  }>;
  episodes: Array<{
    mal_id: number;
    url: string;
    title: string;
    episode: string;
    images: { jpg: { image_url: string | null } };
  }>;
  music_videos: unknown[];
};

export type JikanAnimeVideosResponse = {
  data: JikanAnimeVideosData;
};

export type JikanScoreDistribution = {
  score: number;
  votes: number;
  percentage: number;
};

export type JikanAnimeStatisticsData = {
  watching: number;
  completed: number;
  on_hold: number;
  dropped: number;
  plan_to_watch: number;
  total: number;
  scores?: JikanScoreDistribution[];
};

export type JikanAnimeStatisticsResponse = {
  data: JikanAnimeStatisticsData;
};

export type JikanRecommendationEntry = {
  entry: JikanAnimeSearchItem;
  votes: number;
};

export type JikanAnimeRecommendationsResponse = {
  data: JikanRecommendationEntry[];
};

export type JikanReviewReactions = {
  overall: number;
  nice: number;
  love_it: number;
  funny: number;
  informative: number;
  well_written: number;
  creative: number;
};

export type JikanReviewEntry = {
  mal_id: number;
  url: string;
  type: string;
  reactions: JikanReviewReactions;
  date: string;
  review: string;
  score: number;
  tags: string[];
  is_spoiler: boolean;
  is_preliminary: boolean;
  episodes_watched: number | null;
  user: {
    url: string;
    username: string;
    images: {
      jpg: {
        image_url: string | null;
      };
    };
  };
};

export type JikanAnimeReviewsResponse = {
  pagination: JikanPagination;
  data: JikanReviewEntry[];
};

export type JikanUserUpdateEntry = {
  user: {
    url: string;
    username: string;
    images: { jpg: { image_url: string | null } };
  };
  score: number | null;
  status: string | null;
  episodes_seen: number | null;
  date: string;
};

export type JikanAnimeUserUpdatesResponse = {
  pagination: JikanPagination;
  data: JikanUserUpdateEntry[];
};
