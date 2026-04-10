import type { SupabaseClient } from "@supabase/supabase-js";

export type PeriodType = "weekly" | "monthly" | "yearly" | "other";

export type RecurringSubscriptionRow = {
  id: string;
  family_id: string | null;
  name: string;
  period_type: PeriodType;
  price_euros: number;
  start_date: string;
  end_date: string | null;
  status: "active" | "cancelled";
  next_payment_date: string | null;
  last_payment_date: string | null;
  notes: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  owner_ids: string[];
};

export type OneOffPurchaseRow = {
  id: string;
  family_id: string | null;
  site_name: string;
  purchase_date: string;
  amount_euros: number;
  credits_received: number;
  notes: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  owner_ids: string[];
};

/** Équivalent mensuel du prix selon la période facturée. */
export function monthlyEquivalentEuros(
  priceEuros: number,
  period: PeriodType
): number {
  switch (period) {
    case "weekly":
      return (priceEuros * 52) / 12;
    case "monthly":
      return priceEuros;
    case "yearly":
      return priceEuros / 12;
    default:
      return priceEuros;
  }
}

/** Équivalent annuel du prix selon la période facturée. */
export function yearlyEquivalentEuros(
  priceEuros: number,
  period: PeriodType
): number {
  switch (period) {
    case "weekly":
      return priceEuros * 52;
    case "monthly":
      return priceEuros * 12;
    case "yearly":
      return priceEuros;
    default:
      return priceEuros * 12;
  }
}

function parseIsoDate(isoDate: string): Date {
  const [y, m, d] = isoDate.split("-").map((v) => parseInt(v, 10));
  return new Date(y, (m || 1) - 1, d || 1);
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function endOfMonthDay(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function withYearMonthAndClampedDay(
  year: number,
  monthIndex: number,
  wantedDay: number
): Date {
  const day = Math.min(wantedDay, endOfMonthDay(year, monthIndex));
  return new Date(year, monthIndex, day);
}

function addMonthsClamped(base: Date, months: number): Date {
  const wantedDay = base.getDate();
  const year = base.getFullYear();
  const monthIndex = base.getMonth() + months;
  const target = new Date(year, monthIndex, 1);
  return withYearMonthAndClampedDay(
    target.getFullYear(),
    target.getMonth(),
    wantedDay
  );
}

/**
 * Calcule la prochaine échéance à partir d'aujourd'hui.
 */
export function computeNextPaymentDate(
  startDateIso: string,
  period: PeriodType,
  nowDate: Date = new Date()
): string {
  const start = parseIsoDate(startDateIso);
  const now = new Date(
    nowDate.getFullYear(),
    nowDate.getMonth(),
    nowDate.getDate()
  );

  if (period === "other") {
    return toIsoDate(start);
  }

  if (period === "weekly") {
    const msPerDay = 24 * 60 * 60 * 1000;
    const diffDays = Math.floor((now.getTime() - start.getTime()) / msPerDay);
    if (diffDays < 0) {
      return toIsoDate(start);
    }
    const mod = diffDays % 7;
    const add = mod === 0 ? 7 : 7 - mod;
    const next = new Date(now);
    next.setDate(now.getDate() + add);
    return toIsoDate(next);
  }

  if (period === "monthly") {
    const wantedDay = start.getDate();
    let candidate = withYearMonthAndClampedDay(
      now.getFullYear(),
      now.getMonth(),
      wantedDay
    );
    if (candidate <= now) {
      candidate = addMonthsClamped(candidate, 1);
    }
    return toIsoDate(candidate);
  }

  let yearlyCandidate = withYearMonthAndClampedDay(
    now.getFullYear(),
    start.getMonth(),
    start.getDate()
  );
  if (yearlyCandidate <= now) {
    yearlyCandidate = withYearMonthAndClampedDay(
      now.getFullYear() + 1,
      start.getMonth(),
      start.getDate()
    );
  }
  return toIsoDate(yearlyCandidate);
}

/**
 * Calcule la dernière échéance passée (ou aujourd'hui si exactement le jour J).
 */
export function computeLastPaymentDate(
  startDateIso: string,
  period: PeriodType,
  nowDate: Date = new Date()
): string {
  const start = parseIsoDate(startDateIso);
  const now = new Date(
    nowDate.getFullYear(),
    nowDate.getMonth(),
    nowDate.getDate()
  );

  if (period === "other") {
    return toIsoDate(start <= now ? start : now);
  }

  if (period === "weekly") {
    if (start > now) {
      return toIsoDate(start);
    }
    const msPerDay = 24 * 60 * 60 * 1000;
    const diffDays = Math.floor((now.getTime() - start.getTime()) / msPerDay);
    const elapsedCycles = Math.floor(diffDays / 7);
    const last = new Date(start);
    last.setDate(start.getDate() + elapsedCycles * 7);
    return toIsoDate(last);
  }

  if (period === "monthly") {
    let candidate = withYearMonthAndClampedDay(
      now.getFullYear(),
      now.getMonth(),
      start.getDate()
    );
    if (candidate > now) {
      candidate = addMonthsClamped(candidate, -1);
    }
    if (candidate < start) {
      return toIsoDate(start);
    }
    return toIsoDate(candidate);
  }

  let yearlyCandidate = withYearMonthAndClampedDay(
    now.getFullYear(),
    start.getMonth(),
    start.getDate()
  );
  if (yearlyCandidate > now) {
    yearlyCandidate = withYearMonthAndClampedDay(
      now.getFullYear() - 1,
      start.getMonth(),
      start.getDate()
    );
  }
  if (yearlyCandidate < start) {
    return toIsoDate(start);
  }
  return toIsoDate(yearlyCandidate);
}

function mapRecurring(
  raw: Record<string, unknown>,
  owners: { user_id: string }[]
): RecurringSubscriptionRow {
  return {
    id: raw.id as string,
    family_id: (raw.family_id as string | null) ?? null,
    name: raw.name as string,
    period_type: raw.period_type as PeriodType,
    price_euros: Number(raw.price_euros),
    start_date: String(raw.start_date),
    end_date: raw.end_date != null ? String(raw.end_date) : null,
    status: raw.status as "active" | "cancelled",
    next_payment_date:
      raw.next_payment_date != null ? String(raw.next_payment_date) : null,
    last_payment_date:
      raw.last_payment_date != null ? String(raw.last_payment_date) : null,
    notes: String(raw.notes ?? ""),
    created_by: raw.created_by as string,
    created_at: String(raw.created_at),
    updated_at: String(raw.updated_at),
    owner_ids: owners.map((o) => o.user_id),
  };
}

function mapOneOff(
  raw: Record<string, unknown>,
  owners: { user_id: string }[]
): OneOffPurchaseRow {
  return {
    id: raw.id as string,
    family_id: (raw.family_id as string | null) ?? null,
    site_name: String(raw.site_name),
    purchase_date: String(raw.purchase_date),
    amount_euros: Number(raw.amount_euros),
    credits_received: Number(raw.credits_received ?? 0),
    notes: String(raw.notes ?? ""),
    created_by: raw.created_by as string,
    created_at: String(raw.created_at),
    updated_at: String(raw.updated_at),
    owner_ids: owners.map((o) => o.user_id),
  };
}

export async function listRecurringSubscriptions(
  supabase: SupabaseClient
): Promise<RecurringSubscriptionRow[]> {
  const { data, error } = await supabase
    .from("recurring_subscriptions")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) {
    console.error(error);
    return [];
  }
  const subs = (data ?? []) as Record<string, unknown>[];
  if (subs.length === 0) {
    return [];
  }
  const ids = subs.map((s) => s.id as string);
  const { data: ownRows } = await supabase
    .from("recurring_subscription_owners")
    .select("subscription_id, user_id")
    .in("subscription_id", ids);
  const bySub = new Map<string, { user_id: string }[]>();
  for (const o of ownRows ?? []) {
    const r = o as { subscription_id: string; user_id: string };
    const list = bySub.get(r.subscription_id) ?? [];
    list.push({ user_id: r.user_id });
    bySub.set(r.subscription_id, list);
  }
  return subs.map((raw) =>
    mapRecurring(raw, bySub.get(raw.id as string) ?? [])
  );
}

export async function listOneOffPurchases(
  supabase: SupabaseClient
): Promise<OneOffPurchaseRow[]> {
  const { data, error } = await supabase
    .from("one_off_purchases")
    .select("*")
    .order("purchase_date", { ascending: false });
  if (error) {
    console.error(error);
    return [];
  }
  const rows = (data ?? []) as Record<string, unknown>[];
  if (rows.length === 0) {
    return [];
  }
  const ids = rows.map((r) => r.id as string);
  const { data: ownRows } = await supabase
    .from("one_off_purchase_owners")
    .select("purchase_id, user_id")
    .in("purchase_id", ids);
  const byP = new Map<string, { user_id: string }[]>();
  for (const o of ownRows ?? []) {
    const r = o as { purchase_id: string; user_id: string };
    const list = byP.get(r.purchase_id) ?? [];
    list.push({ user_id: r.user_id });
    byP.set(r.purchase_id, list);
  }
  return rows.map((raw) => mapOneOff(raw, byP.get(raw.id as string) ?? []));
}

export async function distinctPurchaseSites(
  supabase: SupabaseClient
): Promise<string[]> {
  const { data, error } = await supabase
    .from("one_off_purchases")
    .select("site_name");
  if (error || !data) {
    return [];
  }
  const set = new Set(
    (data as { site_name: string }[]).map((r) => r.site_name.trim()).filter(Boolean)
  );
  return [...set].sort((a, b) => a.localeCompare(b, "fr"));
}

export type CreateRecurringInput = {
  familyId: string | null;
  name: string;
  periodType: PeriodType;
  priceEuros: number;
  startDate: string;
  notes: string;
  ownerIds: string[];
};

export async function createRecurringSubscription(
  supabase: SupabaseClient,
  input: CreateRecurringInput
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Non connecté." };
  }
  if (!input.ownerIds.length) {
    return { ok: false, error: "Sélectionne au moins un propriétaire." };
  }
  const subId = crypto.randomUUID();
  const { error: e1 } = await supabase
    .from("recurring_subscriptions")
    .insert({
      id: subId,
      family_id: input.familyId,
      name: input.name.trim(),
      period_type: input.periodType,
      price_euros: input.priceEuros,
      start_date: input.startDate,
      notes: input.notes.trim(),
      status: "active",
      next_payment_date: computeNextPaymentDate(input.startDate, input.periodType),
      /* created_by : DEFAULT auth.uid() côté Supabase (aligné RLS) */
    })
    ;
  if (e1) {
    return { ok: false, error: e1?.message ?? "Création impossible." };
  }
  const ownerRows = input.ownerIds.map((user_id) => ({
    subscription_id: subId,
    user_id,
  }));
  const { error: e2 } = await supabase
    .from("recurring_subscription_owners")
    .insert(ownerRows);
  if (e2) {
    await supabase.from("recurring_subscriptions").delete().eq("id", subId);
    return { ok: false, error: e2.message };
  }
  return { ok: true, id: subId };
}

export type UpdateRecurringInput = {
  id: string;
  name: string;
  periodType: PeriodType;
  priceEuros: number;
  startDate: string;
  endDate: string | null;
  notes: string;
  ownerIds: string[];
  nextPaymentDate: string | null;
  lastPaymentDate: string | null;
};

export async function updateRecurringSubscription(
  supabase: SupabaseClient,
  input: UpdateRecurringInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!input.ownerIds.length) {
    return { ok: false, error: "Sélectionne au moins un propriétaire." };
  }
  const { error: e1 } = await supabase
    .from("recurring_subscriptions")
    .update({
      name: input.name.trim(),
      period_type: input.periodType,
      price_euros: input.priceEuros,
      start_date: input.startDate,
      end_date: input.endDate,
      notes: input.notes.trim(),
      next_payment_date:
        input.endDate || input.nextPaymentDate === null
          ? null
          : computeNextPaymentDate(input.startDate, input.periodType),
      last_payment_date: input.lastPaymentDate,
    })
    .eq("id", input.id);
  if (e1) {
    return { ok: false, error: e1.message };
  }
  const { error: delErr } = await supabase
    .from("recurring_subscription_owners")
    .delete()
    .eq("subscription_id", input.id);
  if (delErr) {
    return { ok: false, error: delErr.message };
  }
  const ownerRows = input.ownerIds.map((user_id) => ({
    subscription_id: input.id,
    user_id,
  }));
  const { error: e2 } = await supabase
    .from("recurring_subscription_owners")
    .insert(ownerRows);
  if (e2) {
    return { ok: false, error: e2.message };
  }
  return { ok: true };
}

export async function cancelRecurringSubscription(
  supabase: SupabaseClient,
  id: string,
  endDateIso: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: cur } = await supabase
    .from("recurring_subscriptions")
    .select("start_date, period_type, last_payment_date")
    .eq("id", id)
    .single();
  const current = cur as
    | {
        start_date: string;
        period_type: PeriodType;
        last_payment_date: string | null;
      }
    | null;

  /**
   * Dernier prélèvement effectif : on ne le confond pas avec la date de résiliation.
   * Si déjà renseigné en base, on le conserve. Sinon on estime la dernière échéance
   * **strictement avant** le jour de résiliation (référence = veille de endDateIso),
   * pour éviter que « dernier prélèvement » et « fin d’abonnement » tombent le même jour par erreur.
   */
  let lastPaymentToStore: string;
  if (!current) {
    lastPaymentToStore = endDateIso;
  } else if (current.last_payment_date) {
    lastPaymentToStore = current.last_payment_date;
  } else {
    const dayBeforeEnd = new Date(`${endDateIso}T12:00:00`);
    dayBeforeEnd.setDate(dayBeforeEnd.getDate() - 1);
    lastPaymentToStore = computeLastPaymentDate(
      current.start_date,
      current.period_type,
      dayBeforeEnd
    );
  }

  const { error } = await supabase
    .from("recurring_subscriptions")
    .update({
      status: "cancelled",
      end_date: endDateIso,
      next_payment_date: null,
      last_payment_date: lastPaymentToStore,
    })
    .eq("id", id);
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export type CreateOneOffInput = {
  familyId: string | null;
  siteName: string;
  purchaseDate: string;
  amountEuros: number;
  creditsReceived: number;
  notes: string;
  ownerIds: string[];
};

export async function createOneOffPurchase(
  supabase: SupabaseClient,
  input: CreateOneOffInput
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Non connecté." };
  }
  if (!input.ownerIds.length) {
    return { ok: false, error: "Sélectionne au moins un propriétaire." };
  }
  const pid = crypto.randomUUID();
  const { error: e1 } = await supabase
    .from("one_off_purchases")
    .insert({
      id: pid,
      family_id: input.familyId,
      site_name: input.siteName.trim(),
      purchase_date: input.purchaseDate,
      amount_euros: input.amountEuros,
      credits_received: input.creditsReceived,
      notes: input.notes.trim(),
      /* created_by : DEFAULT auth.uid() côté Supabase */
    })
    ;
  if (e1) {
    return { ok: false, error: e1?.message ?? "Création impossible." };
  }
  const ownerRows = input.ownerIds.map((user_id) => ({
    purchase_id: pid,
    user_id,
  }));
  const { error: e2 } = await supabase
    .from("one_off_purchase_owners")
    .insert(ownerRows);
  if (e2) {
    await supabase.from("one_off_purchases").delete().eq("id", pid);
    return { ok: false, error: e2.message };
  }
  return { ok: true, id: pid };
}

export type UpdateOneOffInput = {
  id: string;
  familyId: string | null;
  siteName: string;
  purchaseDate: string;
  amountEuros: number;
  creditsReceived: number;
  notes: string;
  ownerIds: string[];
};

export async function updateOneOffPurchase(
  supabase: SupabaseClient,
  input: UpdateOneOffInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!input.ownerIds.length) {
    return { ok: false, error: "Sélectionne au moins un propriétaire." };
  }
  const { error: e1 } = await supabase
    .from("one_off_purchases")
    .update({
      family_id: input.familyId,
      site_name: input.siteName.trim(),
      purchase_date: input.purchaseDate,
      amount_euros: input.amountEuros,
      credits_received: input.creditsReceived,
      notes: input.notes.trim(),
    })
    .eq("id", input.id);
  if (e1) {
    return { ok: false, error: e1.message };
  }
  const { error: delErr } = await supabase
    .from("one_off_purchase_owners")
    .delete()
    .eq("purchase_id", input.id);
  if (delErr) {
    return { ok: false, error: delErr.message };
  }
  const ownerRows = input.ownerIds.map((user_id) => ({
    purchase_id: input.id,
    user_id,
  }));
  const { error: e2 } = await supabase
    .from("one_off_purchase_owners")
    .insert(ownerRows);
  if (e2) {
    return { ok: false, error: e2.message };
  }
  return { ok: true };
}

/** Part utilisateur courant pour un montant total et N propriétaires. */
export function userShareEuros(
  totalEuros: number,
  ownerCount: number,
  userId: string,
  ownerIds: string[]
): number {
  if (ownerCount <= 0 || !ownerIds.includes(userId)) {
    return 0;
  }
  return totalEuros / ownerCount;
}

export type OneOffPeriodFilter = "all" | "month" | "year";

export function purchaseInPeriod(
  purchaseDateIso: string,
  filter: OneOffPeriodFilter
): boolean {
  if (filter === "all") {
    return true;
  }
  const d = new Date(purchaseDateIso + "T12:00:00");
  const now = new Date();
  if (filter === "month") {
    return (
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth()
    );
  }
  return d.getFullYear() === now.getFullYear();
}
