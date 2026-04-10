type LibraryReferenceLink = {
  key: string;
  label: string;
  href: string;
};

type LibraryReferenceLinksSectionProps = {
  title?: string;
  links: LibraryReferenceLink[];
  emptyMessage?: string;
  containerClassName?: string;
  linkClassName?: string;
};

export function LibraryReferenceLinksSection({
  title = "Liens de référence",
  links,
  emptyMessage = "Aucun lien configuré.",
  containerClassName = "anime-detail-left-actions",
  linkClassName = "anime-detail-link-btn",
}: LibraryReferenceLinksSectionProps) {
  return (
    <div className="anime-detail-subsection">
      <h3 className="anime-detail-subtitle-heading">{title}</h3>
      {links.length === 0 ? (
        <p className="anime-detail-prose">{emptyMessage}</p>
      ) : (
        <div className={containerClassName}>
          {links.map((item) => (
            <a key={item.key} className={linkClassName} href={item.href} target="_blank" rel="noreferrer">
              {item.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
