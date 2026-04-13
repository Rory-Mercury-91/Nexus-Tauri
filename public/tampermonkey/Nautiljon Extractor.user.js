// ==UserScript==
// @name         Nautiljon → Nexus-Tauri (Lectures VF)
// @namespace    https://nexus-tauri.local
// @version      2.0.1
// @description  Extrait les données des mangas/light novels depuis Nautiljon (édition VF uniquement) et les envoie vers Nexus-Tauri
// @author       Nexus Team
// @homepageURL  https://github.com/Rory-Mercury-91/Nexus-Tauri
// @supportURL   https://github.com/Rory-Mercury-91/Nexus-Tauri/issues
// @updateURL    https://raw.githubusercontent.com/Rory-Mercury-91/Nexus-Tauri/main/public/tampermonkey/Nautiljon%20Extractor.user.js
// @downloadURL  https://raw.githubusercontent.com/Rory-Mercury-91/Nexus-Tauri/main/public/tampermonkey/Nautiljon%20Extractor.user.js
// @match        https://www.nautiljon.com/mangas/*
// @match        https://www.nautiljon.com/light_novels/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=nautiljon.com
// @grant        GM_xmlhttpRequest
// @connect      localhost
// @connect      127.0.0.1
// @connect      nautiljon.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const PORT = 40000;
  const BASE_URL = `http://127.0.0.1:${PORT}`;

  // ============================================================================
  // Utilitaires de normalisation
  // ============================================================================

  function normalizeSpace(value) {
    return String(value ?? "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function toAbsoluteUrl(value) {
    const raw = normalizeSpace(value);
    if (!raw) return "";
    try {
      return new URL(raw, "https://www.nautiljon.com").href;
    } catch {
      return raw;
    }
  }

  function parsePriceEur(value) {
    const text = normalizeSpace(value);
    const match = text.match(/(\d+(?:[.,]\d+)?)\s*€/);
    if (!match) return null;
    const parsed = Number(match[1].replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function toIsoDate(value) {
    const raw = normalizeSpace(value).toLowerCase();
    if (!raw) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

    const frMonths = {
      janvier: "01",
      fevrier: "02",
      février: "02",
      mars: "03",
      avril: "04",
      mai: "05",
      juin: "06",
      juillet: "07",
      aout: "08",
      août: "08",
      septembre: "09",
      octobre: "10",
      novembre: "11",
      decembre: "12",
      décembre: "12",
    };

    // Format DD/MM/YYYY
    const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slashMatch) {
      return `${slashMatch[3]}-${slashMatch[2].padStart(2, "0")}-${slashMatch[1].padStart(2, "0")}`;
    }

    // Format "16 juin 2021"
    const frMatch = raw.match(/^(\d{1,2})\s+([a-zéûôîàùç]+)\s+(\d{4})$/i);
    if (!frMatch) return null;
    const normalizedMonth = frMatch[2]
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    const month = frMonths[frMatch[2].toLowerCase()] || frMonths[normalizedMonth];
    if (!month) return null;
    return `${frMatch[3]}-${month}-${frMatch[1].padStart(2, "0")}`;
  }

  // ============================================================================
  // Extraction des métadonnées principales
  // ============================================================================

  function extractTitle() {
    const titleNode = document.querySelector('h1 span[itemprop="name"]');
    if (titleNode) {
      const title = normalizeSpace(titleNode.textContent);
      console.log("✅ Titre:", title);
      return title;
    }

    const h1 = document.querySelector("h1");
    if (!h1) {
      console.error("❌ Impossible de trouver le titre (h1)");
      return "";
    }

    const h1Clone = h1.cloneNode(true);
    h1Clone.querySelectorAll("a, button, .edit, .modifier").forEach((n) => n.remove());
    const title = normalizeSpace(h1Clone.textContent).replace(/^modifier\s+/i, "");
    console.log("✅ Titre:", title);
    return title;
  }

  function extractSynopsis() {
    const descNode = document.querySelector(".description, #description, [itemprop='description']");
    if (!descNode) {
      console.warn("⚠️ Synopsis non trouvé");
      return null;
    }

    const clone = descNode.cloneNode(true);
    clone.querySelectorAll(".fader, .showmore, .bio_infos, p.aright, p.center100, a, button").forEach((n) => n.remove());
    const synopsis = normalizeSpace(clone.textContent);
    console.log("✅ Synopsis:", synopsis.substring(0, 100) + (synopsis.length > 100 ? "..." : ""));
    return synopsis || null;
  }

  function extractMetadataBlock() {
    const metaList = document.querySelector("ul.mb10");
    if (!metaList) {
      console.warn("⚠️ Bloc de métadonnées (ul.mb10) non trouvé");
      return {};
    }

    const items = Array.from(metaList.querySelectorAll("li"));
    const meta = {};

    for (const item of items) {
      const boldLabel = item.querySelector("span.bold, .bold");
      if (!boldLabel) continue;

      const label = normalizeSpace(boldLabel.textContent).replace(/\s*:\s*$/, "");
      const clone = item.cloneNode(true);
      clone.querySelectorAll("span.bold, .bold").forEach((n) => n.remove());
      const value = normalizeSpace(clone.textContent);

      meta[label] = value;
    }

    console.group("📋 Métadonnées extraites");
    console.log(meta);
    console.groupEnd();

    return meta;
  }

  function extractGenres(metaBlock) {
    const genresRaw = metaBlock["Genres"] || "";
    const genres = genresRaw
      .split(/[-|,•]/g)
      .map((g) => normalizeSpace(g))
      .filter(Boolean);
    console.log("🎭 Genres:", genres);
    return genres;
  }

  function extractThemes(metaBlock) {
    const themesRaw = metaBlock["Thèmes"] || "";
    const themes = themesRaw
      .split(/[-|,•]/g)
      .map((t) => normalizeSpace(t))
      .filter(Boolean);
    console.log("🏷️ Thèmes:", themes);
    return themes;
  }

  function extractDemographic(metaBlock) {
    const type = metaBlock["Type"] || "";
    console.log("📊 Type/Démographie:", type || "—");
    return type || null;
  }

  function extractStatus(metaBlock) {
    const nbVolumesVF = metaBlock["Nb volumes VF"] || "";
    const normalized = nbVolumesVF.toLowerCase();
    let status = "Terminé";

    if (normalized.includes("en cours")) {
      status = "En cours";
    } else if (normalized.includes("terminé")) {
      status = "Terminé";
    } else if (normalized.includes("abandonn")) {
      status = "Abandonné";
    } else if (normalized.includes("pause") || normalized.includes("hiatus")) {
      status = "En pause";
    }

    console.log("📌 Statut publication:", status);
    return status;
  }

  function extractVolumeCount(metaBlock) {
    const nbVolumesVF = metaBlock["Nb volumes VF"] || "";
    const match = nbVolumesVF.match(/\d+/);
    const count = match ? Number(match[0]) : null;
    console.log("📚 Nb volumes VF:", count ?? "—");
    return count;
  }

  function extractChapterCount(metaBlock) {
    const nbChapitres = metaBlock["Nb chapitres"] || "";
    const match = nbChapitres.match(/\d+/);
    const count = match ? Number(match[0]) : null;
    console.log("📖 Nb chapitres:", count ?? "—");
    return count;
  }

  function extractCoverUrl() {
    const image =
      document.querySelector(".coverimg img") ||
      document.querySelector(".cover img") ||
      document.querySelector("img[itemprop='image']");

    if (!image) {
      console.warn("⚠️ Couverture série non trouvée");
      return "";
    }

    let src = image.getAttribute("src") || "";
    
    // Transformation mini → haute résolution
    if (src.includes("/mini/")) {
      src = src.replace("/mini/", "/");
    }
    if (src.includes("/imagesmin/")) {
      src = src.replace("/imagesmin/", "/images/");
    }
    
    // Corriger le timestamp mal formaté (1XXXXXXXXXX → XXXXXXXXXX)
    src = src.replace(/\?1(\d{10,})/, "?$1");
    
    const absolute = toAbsoluteUrl(src);
    console.log("🖼️ Couverture série:", absolute);
    return absolute;
  }

  function extractDefaultPrice(metaBlock) {
    const prixRaw = metaBlock["Prix"] || "";
    const price = parsePriceEur(prixRaw);
    console.log("💰 Prix par défaut:", price ? `${price} €` : "—");
    return price;
  }

  // ============================================================================
  // Extraction des volumes (édition VF uniquement)
  // ============================================================================

  function findFrenchEditionBlock() {
    const editionHeaders = Array.from(document.querySelectorAll("h2 a.infos_edition"));

    for (const header of editionHeaders) {
      const flagFr = header.querySelector('img[alt="France"]');
      if (flagFr) {
        const editionId = header.getAttribute("onclick")?.match(/swap\('([^']+)'\)/)?.[1];
        if (!editionId) continue;

        const editionBlock = document.getElementById(editionId);
        if (editionBlock) {
          console.log("✅ Édition VF trouvée:", editionId);
          return editionBlock;
        }
      }
    }

    console.warn("⚠️ Aucune édition VF (drapeau France) trouvée");
    return null;
  }

  function extractVolumesFromEdition(editionBlock) {
    if (!editionBlock) return [];

    // Chercher la section "Volume simple"
    const headers = Array.from(editionBlock.querySelectorAll("h3"));
    const volumeSimpleHeader = headers.find((h) =>
      normalizeSpace(h.textContent).toLowerCase().includes("volume simple")
    );

    if (!volumeSimpleHeader) {
      console.warn("⚠️ Section 'Volume simple' non trouvée dans l'édition VF");
      return [];
    }

    const sectionDiv = volumeSimpleHeader.nextElementSibling;
    if (!sectionDiv) {
      console.warn("⚠️ Div de la section 'Volume simple' non trouvée");
      return [];
    }

    const volumeNodes = Array.from(sectionDiv.querySelectorAll(".unVol"));
    const volumes = [];

    for (const node of volumeNodes) {
      const anchor = node.querySelector("a[href*='/volume-']");
      if (!anchor) continue;

      const href = anchor.getAttribute("href") || "";
      const volumeUrl = toAbsoluteUrl(href);
      const titleAttr = anchor.getAttribute("title") || "";
      const numberMatch = titleAttr.match(/vol\.\s*(\d+)/i) || href.match(/volume-(\d+)/i);
      if (!numberMatch) continue;

      const volumeNumber = Number(numberMatch[1]);
      if (!Number.isFinite(volumeNumber) || volumeNumber <= 0) continue;

      volumes.push({
        numero: volumeNumber,
        couverture_url: null, // Sera rempli par fetchVolumeDates depuis la page individuelle
        page_url: volumeUrl,
        date_sortie: null, // Sera rempli par fetchVolumeDates
      });
    }

    console.log(`📚 ${volumes.length} volume(s) VF trouvé(s) (section Volume simple)`);
    return volumes.sort((a, b) => a.numero - b.numero);
  }

  // ============================================================================
  // Récupération des dates de sortie VF en parallèle
  // ============================================================================

  function fetchVolumePage(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        onload: (response) => {
          if (response.status >= 200 && response.status < 300) {
            resolve(response.responseText);
          } else {
            reject(new Error(`HTTP ${response.status}`));
          }
        },
        onerror: () => reject(new Error("Erreur réseau")),
      });
    });
  }

  function extractVolumeDetailsFromHtml(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    let releaseDate = null;
    let coverUrl = null;

    // Extraire la date de parution VF
    const items = Array.from(doc.querySelectorAll("li"));
    for (const item of items) {
      const text = normalizeSpace(item.textContent);
      if (/Date de parution VF\s*:/i.test(text)) {
        const match = text.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
        if (match) {
          releaseDate = toIsoDate(match[1]);
          break;
        }
      }
    }

    // Extraire l'URL de couverture haute résolution - plusieurs stratégies
    // Stratégie 1: Lien avec id contenant "couverture"
    let coverLink = doc.querySelector('a[id*="couverture"][href*="/images/"]');
    
    // Stratégie 2: Lien avec classe cboxImage/cboxElement vers /images/
    if (!coverLink) {
      coverLink = doc.querySelector('a.cboxImage[href*="/images/"], a.cboxElement[href*="/images/"]');
    }
    
    // Stratégie 3: Premier lien vers /images/manga_volumes/ (pas mini, pas imagesmin)
    if (!coverLink) {
      const allLinks = Array.from(doc.querySelectorAll('a[href*="/manga_volumes/"]'));
      coverLink = allLinks.find((link) => {
        const href = link.getAttribute("href") || "";
        return href.includes("/images/") && !href.includes("/mini/") && !href.includes("/imagesmin/");
      });
    }

    if (coverLink) {
      const href = coverLink.getAttribute("href");
      if (href) {
        coverUrl = toAbsoluteUrl(href);
      }
    }

    // Si toujours pas trouvé, chercher dans les images directement et corriger le timestamp
    if (!coverUrl) {
      const img = doc.querySelector('img[itemprop="image"], img[src*="/manga_volumes/"]');
      if (img) {
        let src = img.getAttribute("src") || "";
        
        // Transformation mini → haute résolution
        if (src.includes("/mini/")) {
          src = src.replace("/mini/", "/");
        }
        if (src.includes("/imagesmin/")) {
          src = src.replace("/imagesmin/", "/images/");
        }
        
        // Corriger le timestamp mal formaté (1XXXXXXXXXX → XXXXXXXXXX)
        // Nautiljon ajoute un "1" devant le timestamp pour les images miniatures
        src = src.replace(/\?1(\d{10,})/, "?$1");
        
        if (src.includes("/images/")) {
          coverUrl = toAbsoluteUrl(src);
        }
      }
    }

    return { releaseDate, coverUrl };
  }

  async function fetchVolumeDates(volumes) {
    console.log(`🔄 Récupération des détails VF pour ${volumes.length} volume(s)...`);

    const promises = volumes.map(async (vol) => {
      try {
        const html = await fetchVolumePage(vol.page_url);
        const details = extractVolumeDetailsFromHtml(html);
        
        vol.date_sortie = details.releaseDate;
        if (details.coverUrl) {
          vol.couverture_url = details.coverUrl;
        }
        
        const dateStr = details.releaseDate || "—";
        const coverStr = details.coverUrl ? "✓" : "✗";
        const status = details.coverUrl ? "✅" : "⚠️";
        console.log(`  ${status} Vol. ${vol.numero}: date=${dateStr}, cover=${coverStr}`);
        
        if (!details.coverUrl) {
          console.warn(`    ⚠️ Vol. ${vol.numero}: couverture non trouvée sur ${vol.page_url}`);
        }
      } catch (error) {
        console.error(`  ❌ Vol. ${vol.numero}: erreur lors de la récupération`, error);
      }
    });

    await Promise.all(promises);
    const withCovers = volumes.filter((v) => v.couverture_url).length;
    console.log(`✅ Détails VF récupérés: ${withCovers}/${volumes.length} couvertures trouvées`);
  }

  // ============================================================================
  // Construction du payload final
  // ============================================================================

  async function extractReadingPayload() {
    console.group("🎬 Extraction des données Nautiljon");

    const title = extractTitle();
    if (!title) {
      throw new Error("Titre introuvable sur la page Nautiljon.");
    }

    const synopsis = extractSynopsis();
    const metaBlock = extractMetadataBlock();
    const coverUrl = extractCoverUrl();
    const genres = extractGenres(metaBlock);
    const themes = extractThemes(metaBlock);
    const demographic = extractDemographic(metaBlock);
    const status = extractStatus(metaBlock);
    const nbVolumes = extractVolumeCount(metaBlock);
    const nbChapters = extractChapterCount(metaBlock);
    const defaultPrice = extractDefaultPrice(metaBlock);

    const titreOriginal = metaBlock["Titre original"] || null;
    const titreAlternatif = metaBlock["Titre alternatif"] || null;
    const editeurVF = metaBlock["Éditeur VF"] || null;
    const editeurVO = metaBlock["Éditeur VO"] || null;
    const anneeVF = metaBlock["Année VF"] || null;
    const anneeVO = metaBlock["Origine"]?.match(/\d{4}/)?.[0] || null;
    const origine = metaBlock["Origine"] || null;
    const ageConseille = metaBlock["Âge conseillé"] || null;
    const groupe = metaBlock["Groupe"] || null;
    const traducteur = metaBlock["Traducteur"] || null;
    const scenarist = metaBlock["Scénariste"] || null;
    const dessinateur = metaBlock["Dessinateur"] || null;
    const prepublie = metaBlock["Prépublié dans"] || null;

    console.log("🇯🇵 Titre original:", titreOriginal || "—");
    console.log("🏷️ Titre alternatif:", titreAlternatif || "—");
    console.log("📦 Éditeur VF:", editeurVF || "—");
    console.log("📦 Éditeur VO:", editeurVO || "—");
    console.log("📅 Année VF:", anneeVF || "—");
    console.log("📅 Année VO:", anneeVO || "—");
    console.log("🌍 Origine:", origine || "—");
    console.log("🔞 Âge conseillé:", ageConseille || "—");
    console.log("🔗 Groupe/Franchise:", groupe || "—");
    console.log("✍️ Traducteur:", traducteur || "—");
    console.log("✍️ Scénariste:", scenarist || "—");
    console.log("🎨 Dessinateur:", dessinateur || "—");
    console.log("📰 Prépublié dans:", prepublie || "—");

    const isLightNovel = window.location.pathname.includes("/light_novels/");
    const typeContenu = isLightNovel ? "Light novel" : "Manga";
    const typeVolume = isLightNovel ? "Light Novel" : "Broché";

    console.log("📖 Type de contenu:", typeContenu);

    const editionBlock = findFrenchEditionBlock();
    const volumes = extractVolumesFromEdition(editionBlock);

    if (volumes.length > 0) {
      await fetchVolumeDates(volumes);
    }

    // Nettoyer les volumes pour n'envoyer que les champs nécessaires
    const volumesPayload = volumes.map((v) => ({
      numero: v.numero,
      couverture_url: v.couverture_url,
      date_sortie: v.date_sortie,
      prix: defaultPrice,
    }));

    console.group("📦 Volumes préparés pour envoi");
    volumesPayload.forEach((v) => {
      console.log(`Vol. ${v.numero}:`, {
        cover: v.couverture_url || "❌ MANQUANTE",
        date: v.date_sortie || "—",
        prix: v.prix || 0,
      });
    });
    console.groupEnd();

    const payload = {
      titre: title,
      description: synopsis,
      titre_original: titreOriginal,
      titre_alternatif: titreAlternatif,
      statut_publication: status,
      statut: status,
      type_contenu: typeContenu,
      type_volume: typeVolume,
      genres,
      _themes: themes,
      demographie: demographic,
      editeur_vf: editeurVF,
      editeur_vo: editeurVO,
      annee_vf: anneeVF,
      annee_vo: anneeVO,
      nb_volumes: nbVolumes,
      nb_chapitres: nbChapters,
      couverture_url: coverUrl,
      _prix_defaut: defaultPrice,
      _age_conseille: ageConseille,
      _traducteur: traducteur,
      _scenarist: scenarist,
      _dessinateur: dessinateur,
      _prepublie: prepublie,
      _groupe: groupe,
      nautiljon_url: window.location.href,
      _url: window.location.href,
      _source: "Nautiljon",
      volumes: volumesPayload,
    };

    console.log("📦 Payload final:");
    console.log(payload);
    console.groupEnd();

    return payload;
  }

  // ============================================================================
  // Communication avec le serveur Tauri
  // ============================================================================

  function requestJson(endpoint, payload) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "POST",
        url: `${BASE_URL}${endpoint}`,
        headers: { "Content-Type": "application/json" },
        data: JSON.stringify(payload || {}),
        onload: (response) => {
          try {
            const data = JSON.parse(response.responseText || "{}");
            console.log(`🔌 Réponse ${endpoint}:`, data);

            if (response.status >= 200 && response.status < 300) {
              resolve(data);
              return;
            }
            reject(new Error(data.error || `HTTP ${response.status}`));
          } catch (error) {
            reject(error instanceof Error ? error : new Error("Réponse invalide"));
          }
        },
        onerror: () =>
          reject(new Error("Connexion impossible avec Nexus-Tauri (serveur local port 40000).")),
      });
    });
  }

  // ============================================================================
  // Interface utilisateur
  // ============================================================================

  function showNotification(message, kind = "info") {
    const box = document.createElement("div");
    const bg =
      kind === "success"
        ? "linear-gradient(135deg, #10b981, #059669)"
        : kind === "error"
        ? "linear-gradient(135deg, #ef4444, #dc2626)"
        : "linear-gradient(135deg, #6366f1, #4f46e5)";

    box.innerHTML = message;
    box.style.cssText = `
      position: fixed; top: 16px; right: 16px; z-index: 99999999;
      max-width: 430px; padding: 14px 18px; color: #fff;
      background: ${bg}; border-radius: 10px;
      box-shadow: 0 12px 30px rgba(0,0,0,.35); font-size: 14px; line-height: 1.5;
      font-family: Segoe UI, Arial, sans-serif;
    `;

    document.body.appendChild(box);
    setTimeout(() => {
      box.style.transition = "opacity .25s";
      box.style.opacity = "0";
      setTimeout(() => box.remove(), 260);
    }, 4600);
  }

  function createBusyOverlay() {
    const overlay = document.createElement("div");
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 99999998;
      background: rgba(10,12,18,.85); backdrop-filter: blur(8px);
      display: grid; place-items: center; color: #fff;
      font-family: Segoe UI, Arial, sans-serif;
    `;
    overlay.innerHTML = `
      <div style="background:#1f2937;border:1px solid #374151;border-radius:16px;padding:32px 40px;min-width:380px;text-align:center;box-shadow:0 20px 50px rgba(0,0,0,.5);">
        <div style="font-size:48px;margin-bottom:16px;">⏳</div>
        <div style="font-size:20px;font-weight:600;margin-bottom:12px;">Extraction en cours…</div>
        <div style="font-size:14px;color:#9ca3af;">Récupération des données depuis Nautiljon.<br>Ne touchez pas à la page.</div>
      </div>
    `;
    document.body.appendChild(overlay);
    return overlay;
  }

  async function handleImport(mode) {
    const overlay = createBusyOverlay();
    try {
      await requestJson("/api/import-start", { source: "nautiljon", mode });
      const payload = await extractReadingPayload();
      const endpoint = mode === "tomes_only" ? "/api/import-tomes-only" : "/api/import-manga";
      const result = await requestJson(endpoint, payload);

      if (result && result.queued) {
        showNotification(
          `📥 Données reçues pour <strong>${payload.titre}</strong>.<br><small>Finalise l'import dans Nexus-Tauri.</small>`,
          "success"
        );
      } else {
        showNotification("✅ Import envoyé avec succès.", "success");
      }
    } catch (error) {
      console.error("❌ Erreur durant l'import:", error);
      showNotification(
        `❌ ${error instanceof Error ? error.message : "Erreur pendant l'import."}`,
        "error"
      );
      try {
        await requestJson("/api/import-cancel", { source: "nautiljon" });
      } catch {
        // Ignoré
      }
    } finally {
      overlay.remove();
    }
  }

  function mountReadingMenu() {
    if (document.getElementById("nexus-nautiljon-menu")) return;

    const host = document.createElement("div");
    host.id = "nexus-nautiljon-menu";
    host.style.cssText =
      "position:fixed;left:16px;bottom:16px;z-index:99999997;display:flex;gap:10px;align-items:center;";

    const full = document.createElement("button");
    full.type = "button";
    full.textContent = "📚 Import complet";
    full.style.cssText =
      "border:0;color:#fff;font-weight:600;font-size:14px;padding:12px 16px;border-radius:10px;cursor:pointer;background:linear-gradient(135deg,#f59e0b,#d97706);box-shadow:0 8px 20px rgba(0,0,0,.3);transition:all .2s;";
    full.onmouseover = () => {
      full.style.transform = "translateY(-2px)";
      full.style.boxShadow = "0 12px 28px rgba(245,158,11,.4)";
    };
    full.onmouseout = () => {
      full.style.transform = "translateY(0)";
      full.style.boxShadow = "0 8px 20px rgba(0,0,0,.3)";
    };
    full.onclick = () => void handleImport("full");

    const tomes = document.createElement("button");
    tomes.type = "button";
    tomes.textContent = "📖 Import tomes";
    tomes.style.cssText =
      "border:0;color:#fff;font-weight:600;font-size:14px;padding:12px 16px;border-radius:10px;cursor:pointer;background:linear-gradient(135deg,#ec4899,#db2777);box-shadow:0 8px 20px rgba(0,0,0,.3);transition:all .2s;";
    tomes.onmouseover = () => {
      tomes.style.transform = "translateY(-2px)";
      tomes.style.boxShadow = "0 12px 28px rgba(236,72,153,.4)";
    };
    tomes.onmouseout = () => {
      tomes.style.transform = "translateY(0)";
      tomes.style.boxShadow = "0 8px 20px rgba(0,0,0,.3)";
    };
    tomes.onclick = () => void handleImport("tomes_only");

    host.appendChild(full);
    host.appendChild(tomes);
    document.body.appendChild(host);
  }

  function boot() {
    const isReading =
      window.location.pathname.includes("/mangas/") ||
      window.location.pathname.includes("/light_novels/");

    if (isReading) {
      mountReadingMenu();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
