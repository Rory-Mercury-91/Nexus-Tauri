import { type FormEvent, useEffect, useState } from "react";
import { Modal } from "@/components/common/Modal";
import { OwnerToggleList } from "@/components/common/OwnerToggleList";
import type { FamilyMemberProfile, FamilySummary } from "@/services/family/familyService";
import { listFamilyMembersProfiles } from "@/services/family/familyService";
import { getSupabaseClient } from "@/lib/supabaseClient";
import {
  createOneOffPurchase,
  type OneOffPurchaseRow,
  updateOneOffPurchase,
} from "@/services/subscriptions/subscriptionService";
import { useSession } from "@/hooks/useSession";

const NEW_SITE_VALUE = "__new__";

type OneOffPurchaseModalProps = {
  open: boolean;
  mode: "create" | "edit";
  initial: OneOffPurchaseRow | null;
  families: FamilySummary[];
  existingSites: string[];
  onClose: () => void;
  onSaved: () => void;
};

export function OneOffPurchaseModal({
  open,
  mode,
  initial,
  families,
  existingSites,
  onClose,
  onSaved,
}: OneOffPurchaseModalProps) {
  const { session } = useSession();
  const myId = session?.user?.id ?? "";
  const myDisplayName =
    (session?.user.user_metadata as { display_name?: string } | undefined)
      ?.display_name?.trim() ||
    session?.user.email?.split("@")[0] ||
    "Moi";

  const [familyId, setFamilyId] = useState("");
  const [siteSelect, setSiteSelect] = useState<string>(NEW_SITE_VALUE);
  const [siteNew, setSiteNew] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [amount, setAmount] = useState("");
  const [credits, setCredits] = useState("");
  const [notes, setNotes] = useState("");
  const [members, setMembers] = useState<FamilyMemberProfile[]>([]);
  const [selectedOwners, setSelectedOwners] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    setError(null);
    if (mode === "edit" && initial) {
      setFamilyId(initial.family_id ?? "");
      const knownSite = existingSites.includes(initial.site_name);
      setSiteSelect(knownSite ? initial.site_name : NEW_SITE_VALUE);
      setSiteNew(knownSite ? "" : initial.site_name);
      setPurchaseDate(initial.purchase_date);
      setAmount(String(initial.amount_euros));
      setCredits(String(initial.credits_received));
      setNotes(initial.notes);
      setSelectedOwners(new Set(initial.owner_ids));
    } else {
      setFamilyId(families[0]?.id ?? "");
      setSiteSelect(
        existingSites.length > 0 ? existingSites[0] : NEW_SITE_VALUE
      );
      setSiteNew("");
      setPurchaseDate(new Date().toISOString().slice(0, 10));
      setAmount("");
      setCredits("");
      setNotes("");
      setSelectedOwners(myId ? new Set([myId]) : new Set());
    }
  }, [open, mode, initial, families, existingSites, myId]);

  useEffect(() => {
    if (!open) {
      setMembers([]);
      return;
    }
    if (!familyId) {
      if (myId) {
        setMembers([
          {
            id: myId,
            display_name: myDisplayName,
            avatar_storage_path: null,
          },
        ]);
      } else {
        setMembers([]);
      }
      return;
    }
    let cancelled = false;
    (async () => {
      const supabase = getSupabaseClient();
      const list = await listFamilyMembersProfiles(supabase, familyId);
      if (!cancelled) {
        setMembers(list);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, familyId, myId, myDisplayName]);

  function toggleOwner(id: string) {
    setSelectedOwners((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function resolveSiteName(): string | null {
    if (siteSelect === NEW_SITE_VALUE) {
      return siteNew.trim() || null;
    }
    return siteSelect;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const siteName = resolveSiteName();
    if (!siteName) {
      setError("Indique le nom du site (sélection ou nouveau).");
      return;
    }
    const amountNum = parseFloat(amount.replace(",", "."));
    const creditsNum =
      credits.trim() === "" ? 0 : parseFloat(credits.replace(",", "."));
    if (Number.isNaN(amountNum) || amountNum < 0) {
      setError("Le montant doit être un nombre positif.");
      return;
    }
    if (Number.isNaN(creditsNum) || creditsNum < 0) {
      setError("Les crédits doivent être un nombre positif ou zéro.");
      return;
    }
    if (!purchaseDate) {
      setError("La date d’achat est requise.");
      return;
    }
    const ownerIds = [...selectedOwners];
    if (ownerIds.length === 0) {
      setError("Sélectionne au moins un propriétaire.");
      return;
    }

    setBusy(true);
    try {
      const supabase = getSupabaseClient();
      const r =
        mode === "edit" && initial
          ? await updateOneOffPurchase(supabase, {
              id: initial.id,
              familyId: familyId || null,
              siteName,
              purchaseDate,
              amountEuros: amountNum,
              creditsReceived: creditsNum,
              notes,
              ownerIds,
            })
          : await createOneOffPurchase(supabase, {
              familyId: familyId || null,
              siteName,
              purchaseDate,
              amountEuros: amountNum,
              creditsReceived: creditsNum,
              notes,
              ownerIds,
            });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      onSaved();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title={mode === "edit" ? "Modifier l’achat ponctuel" : "Achat ponctuel"}
      maxWidth="42rem"
      onClose={onClose}
    >
      <form className="sub-modal-form" onSubmit={(e) => void handleSubmit(e)}>
        {error ? <p className="sub-modal-error">{error}</p> : null}

        <div className="sub-modal-grid">
          <div className="sub-modal-field">
            <label htmlFor="one-family">Foyer</label>
            <select
              id="one-family"
              value={familyId}
              onChange={(ev) => setFamilyId(ev.target.value)}
              disabled={busy}
            >
              <option value="">Personnel (sans foyer)</option>
              {families.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>

          <div className="sub-modal-field">
            <label htmlFor="one-date">Date d’achat *</label>
            <input
              id="one-date"
              type="date"
              value={purchaseDate}
              onChange={(ev) => setPurchaseDate(ev.target.value)}
              required
              disabled={busy}
            />
          </div>

          <div className="sub-modal-field sub-modal-field--full">
            <label htmlFor="one-site-select">Nom du site *</label>
            <select
              id="one-site-select"
              value={siteSelect}
              onChange={(ev) => setSiteSelect(ev.target.value)}
              disabled={busy}
            >
              {existingSites.length === 0 ? (
                <option value={NEW_SITE_VALUE}>Nouveau site</option>
              ) : (
                <>
                  {existingSites.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                  <option value={NEW_SITE_VALUE}>Autre (nouveau site)</option>
                </>
              )}
            </select>
            {siteSelect === NEW_SITE_VALUE || existingSites.length === 0 ? (
              <input
                type="text"
                className="sub-modal-input-mt"
                value={siteNew}
                onChange={(ev) => setSiteNew(ev.target.value)}
                placeholder="Nom du site"
                disabled={busy}
                required={siteSelect === NEW_SITE_VALUE}
              />
            ) : null}
          </div>

          <div className="sub-modal-field">
            <label htmlFor="one-amount">Montant * (€)</label>
            <input
              id="one-amount"
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(ev) => setAmount(ev.target.value)}
              required
              disabled={busy}
            />
          </div>

          <div className="sub-modal-field">
            <label htmlFor="one-credits">Crédits reçus *</label>
            <input
              id="one-credits"
              type="text"
              inputMode="decimal"
              value={credits}
              onChange={(ev) => setCredits(ev.target.value)}
              required
              disabled={busy}
              placeholder="0"
            />
          </div>

          <div className="sub-modal-field sub-modal-field--full">
            <span className="sub-modal-label-block">Propriétaire(s) *</span>
            <OwnerToggleList
              items={members.map((m) => ({
                id: m.id,
                displayName: m.display_name?.trim() || m.id.slice(0, 8),
                avatarStoragePath: m.avatar_storage_path,
              }))}
              selectedIds={[...selectedOwners]}
              onToggle={(ownerId) => toggleOwner(ownerId)}
              disabled={busy}
              listClassName="sub-modal-owners"
              rowClassName="sub-modal-owner-row"
              mainClassName="sub-modal-owner-main"
              avatarSize={32}
            />
          </div>

          <div className="sub-modal-field sub-modal-field--full">
            <label htmlFor="one-notes">Notes</label>
            <textarea
              id="one-notes"
              rows={3}
              value={notes}
              onChange={(ev) => setNotes(ev.target.value)}
              disabled={busy}
            />
          </div>
        </div>

        <div className="sub-modal-actions">
          <button type="button" className="sub-btn-secondary" disabled={busy} onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="sub-btn-primary" disabled={busy}>
            {busy
              ? "Enregistrement…"
              : mode === "edit"
                ? "Enregistrer"
                : "Enregistrer l’achat"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
