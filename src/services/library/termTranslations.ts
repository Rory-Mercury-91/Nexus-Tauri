// Dictionnaire de traduction des termes bibliothèque (MAL/Jikan -> FR)
// Basé sur les équivalences déjà utilisées dans l'ancien projet Nexus.

type TranslationKind = "genre" | "theme" | "demographic" | "workStatus" | "mediaType";

function normalizeTranslationKey(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const GENRE_TRANSLATIONS: Record<string, string> = {
  action: "Action",
  adventure: "Aventure",
  comedy: "Comédie",
  drama: "Drame",
  ecchi: "Ecchi",
  fantasy: "Fantastique",
  horror: "Horreur",
  mystery: "Mystère",
  psychological: "Psychologique",
  romance: "Romance",
  "sci fi": "Science-Fiction",
  "slice of life": "Tranche de vie",
  sports: "Sport",
  supernatural: "Surnaturel",
  thriller: "Thriller",
  suspense: "Suspense",
  "award winning": "Primé",
  "girls love": "Amour entre filles",
  "boys love": "Amour entre garçons",
  shonen: "Shōnen",
  shounen: "Shōnen",
  shojo: "Shōjo",
  shoujo: "Shōjo",
  seinen: "Seinen",
  josei: "Josei",
  isekai: "Isekai",
  mecha: "Mecha",
  harem: "Harem",
  "reverse harem": "Harem inversé",
};

const THEME_TRANSLATIONS: Record<string, string> = {
  "adult cast": "Distribution adulte",
  anthropomorphic: "Anthropomorphe",
  cgdct: "Filles mignonnes",
  childcare: "Garde d'enfants",
  crossdressing: "Travestissement",
  delinquents: "Délinquants",
  "gag humor": "Humour absurde",
  gore: "Gore",
  historical: "Historique",
  "idols (female)": "Idoles (Femmes)",
  "idols (male)": "Idoles (Hommes)",
  iyashikei: "Iyashikei",
  "love polygon": "Triangle amoureux",
  "magical sex shift": "Changement de sexe magique",
  "martial arts": "Arts martiaux",
  medical: "Médical",
  military: "Militaire",
  music: "Musique",
  mythology: "Mythologie",
  parody: "Parodie",
  reincarnation: "Réincarnation",
  samurai: "Samouraï",
  school: "Vie scolaire",
  showbiz: "Show-business",
  space: "Espace",
  "super power": "Super pouvoir",
  survival: "Survie",
  "time travel": "Voyage dans le temps",
  "urban fantasy": "Fantasy urbaine",
  vampire: "Vampire",
  "video game": "Jeu vidéo",
  villainess: "Vilaine",
  workplace: "Travail",
};

const DEMOGRAPHIC_TRANSLATIONS: Record<string, string> = {
  shonen: "Shōnen",
  shounen: "Shōnen",
  shojo: "Shōjo",
  shoujo: "Shōjo",
  seinen: "Seinen",
  josei: "Josei",
  kids: "Enfants",
};

const WORK_STATUS_TRANSLATIONS: Record<string, string> = {
  publishing: "En cours",
  finished: "Terminé",
  "finished airing": "Terminé",
  "currently airing": "En cours de diffusion",
  "not yet aired": "Pas encore diffusé",
  "not yet published": "Pas encore publié",
  "on hiatus": "En pause",
  discontinued: "Abandonné",
  currently_airing: "En cours de diffusion",
  finished_airing: "Terminé",
  not_yet_aired: "Pas encore diffusé",
};

const MEDIA_TYPE_TRANSLATIONS: Record<string, string> = {
  tv: "TV",
  movie: "Film",
  ova: "OVA",
  ona: "ONA",
  special: "Spécial",
  music: "Musique",
  manga: "Manga",
  manhwa: "Manhwa",
  manhua: "Manhua",
  novel: "Roman",
  "light novel": "Light novel",
  one_shot: "One-shot",
  doujinshi: "Doujinshi",
  unknown: "Inconnu",
};

function dictionaryFor(kind: TranslationKind): Record<string, string> {
  switch (kind) {
    case "genre":
      return GENRE_TRANSLATIONS;
    case "theme":
      return THEME_TRANSLATIONS;
    case "demographic":
      return DEMOGRAPHIC_TRANSLATIONS;
    case "workStatus":
      return WORK_STATUS_TRANSLATIONS;
    case "mediaType":
      return MEDIA_TYPE_TRANSLATIONS;
    default:
      return {};
  }
}

export function translateLibraryTerm(kind: TranslationKind, value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "";
  }
  const normalized = normalizeTranslationKey(raw);
  return dictionaryFor(kind)[normalized] ?? raw;
}

export function translateLibraryTerms(kind: TranslationKind, values: string[]): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const translated = translateLibraryTerm(kind, value);
    const key = normalizeTranslationKey(translated);
    if (!translated || seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(translated);
  }
  return output;
}
