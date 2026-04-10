import { type FormEvent, useEffect, useState } from "react";
import { Modal } from "@/components/common/Modal";
import { OwnerToggleList } from "@/components/common/OwnerToggleList";
import type { FamilyMemberProfile, FamilySummary } from "@/services/family/familyService";
import { listFamilyMembersProfiles } from "@/services/family/familyService";
import { getSupabaseClient } from "@/lib/supabaseClient";
import {
  createRecurringSubscription,
  type CreateRecurringInput,
  type PeriodType,
  type RecurringSubscriptionRow,
  updateRecurringSubscription,
  type UpdateRecurringInput,
} from "@/services/subscriptions/subscriptionService";
import { useSession } from "@/hooks/useSession";

const PERIOD_OPTIONS: { value: PeriodType; label: string }[] = [
  { value: "weekly", label: "Hebdomadaire" },
  { value: "monthly", label: "Mensuel" },
  { value: "yearly", label: "Annuel" },
  { value: "other", label: "Autre" },
];

type RecurringSubscriptionModalProps = {
  open: boolean;
  mode: "create" | "edit";
  families: FamilySummary[];
  initial: RecurringSubscriptionRow | null;
  onClose: () => void;
  onSaved: () => void;
};

export function RecurringSubscriptionModal({
  open,
  mode,
  families,
  initial,
  onClose,
  onSaved,
}: RecurringSubscriptionModalProps) {
  const { session } = useSession();
  const myId = session?.user?.id ?? "";
  const myDisplayName =
    (session?.user.user_metadata as { display_name?: string } | undefined)
      ?.display_name?.trim() ||
    session?.user.email?.split("@")[0] ||
    "Moi";

  const [familyId, setFamilyId] = useState("");
  const [name, setName] = useState("");
  const [periodType, setPeriodType] = useState<PeriodType>("monthly");
  const [price, setPrice] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
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
      setName(initial.name);
      setPeriodType(initial.period_type);
      setPrice(String(initial.price_euros));
      setStartDate(initial.start_date);
      setEndDate(initial.end_date ?? "");
      setNotes(initial.notes);
      setSelectedOwners(new Set(initial.owner_ids));
    } else {
      setFamilyId(families[0]?.id ?? "");
      setName("");
      setPeriodType("monthly");
      setPrice("");
      setStartDate(new Date().toISOString().slice(0, 10));
      setEndDate("");
      setNotes("");
      setSelectedOwners(myId ? new Set([myId]) : new Set());
    }
  }, [open, mode, initial, families, myId]);

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

  useEffect(() => {
    if (!open || mode !== "create" || !myId) {
      return;
    }
    if (!familyId) {
      return;
    }
    setSelectedOwners((prev) => {
      if (prev.size === 0) {
        return new Set([myId]);
      }
      return prev;
    });
  }, [open, mode, familyId, myId]);

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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const priceNum = parseFloat(price.replace(",", "."));
    if (!name.trim()) {
      setError("Le nom est requis.");
      return;
    }
    if (Number.isNaN(priceNum) || priceNum < 0) {
      setError("Le prix doit être un nombre positif.");
      return;
    }
    if (!startDate) {
      setError("La date de début est requise.");
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
      if (mode === "create") {
        const input: CreateRecurringInput = {
          familyId: familyId || null,
          name: name.trim(),
          periodType,
          priceEuros: priceNum,
          startDate,
          notes,
          ownerIds,
        };
        const r = await createRecurringSubscription(supabase, input);
        if (!r.ok) {
          setError(r.error);
          return;
        }
      } else if (initial) {
        const input: UpdateRecurringInput = {
          id: initial.id,
          name: name.trim(),
          periodType,
          priceEuros: priceNum,
          startDate,
          endDate: endDate || null,
          notes,
          ownerIds,
          nextPaymentDate:
            initial.status === "cancelled" ? null : initial.next_payment_date,
          lastPaymentDate: initial.last_payment_date,
        };
        const r = await updateRecurringSubscription(supabase, input);
        if (!r.ok) {
          setError(r.error);
          return;
        }
      }
      onSaved();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const showEndDate = mode === "edit";

  return (
    <Modal
      open={open}
      title={mode === "create" ? "Ajouter un abonnement" : "Modifier l’abonnement"}
      maxWidth="42rem"
      onClose={onClose}
    >
      <form className="sub-modal-form" onSubmit={(e) => void handleSubmit(e)}>
        {error ? <p className="sub-modal-error">{error}</p> : null}

        <div className="sub-modal-grid">
          <div className="sub-modal-field">
            <label htmlFor="sub-family">Foyer</label>
            <select
              id="sub-family"
              value={familyId}
              onChange={(ev) => setFamilyId(ev.target.value)}
              disabled={busy || mode === "edit"}
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
            <label htmlFor="sub-name">Nom *</label>
            <input
              id="sub-name"
              type="text"
              value={name}
              onChange={(ev) => setName(ev.target.value)}
              required
              disabled={busy}
              autoComplete="off"
            />
          </div>

          <div className="sub-modal-field">
            <label htmlFor="sub-period">Type *</label>
            <select
              id="sub-period"
              value={periodType}
              onChange={(ev) =>
                setPeriodType(ev.target.value as PeriodType)
              }
              disabled={busy}
            >
              {PERIOD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {periodType === "other" ? (
              <p className="sub-modal-hint">
                Précise le détail dans les notes (ex. engagement 24 mois, montant
                total).
              </p>
            ) : null}
          </div>

          <div className="sub-modal-field">
            <label htmlFor="sub-price">Prix * (€)</label>
            <input
              id="sub-price"
              type="text"
              inputMode="decimal"
              value={price}
              onChange={(ev) => setPrice(ev.target.value)}
              required
              disabled={busy}
              placeholder="0,00"
            />
          </div>

          <div
            className={
              showEndDate
                ? "sub-modal-field"
                : "sub-modal-field sub-modal-field--single"
            }
          >
            <label htmlFor="sub-start">Date de début *</label>
            <input
              id="sub-start"
              type="date"
              value={startDate}
              onChange={(ev) => setStartDate(ev.target.value)}
              required
              disabled={busy}
            />
          </div>

          {showEndDate ? (
            <div className="sub-modal-field">
              <label htmlFor="sub-end">Date de fin</label>
              <input
                id="sub-end"
                type="date"
                value={endDate}
                onChange={(ev) => setEndDate(ev.target.value)}
                disabled={busy}
              />
              <p className="sub-modal-hint">
                Utile après résiliation ou pour historiser la fin réelle.
              </p>
            </div>
          ) : null}

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
            {members.length === 0 && familyId ? (
              <p className="sub-modal-hint">Chargement des membres…</p>
            ) : null}
          </div>

          <div className="sub-modal-field sub-modal-field--full">
            <label htmlFor="sub-notes">Notes</label>
            <textarea
              id="sub-notes"
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
              : mode === "create"
                ? "Créer l’abonnement"
                : "Enregistrer"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
