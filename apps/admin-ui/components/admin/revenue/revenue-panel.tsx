"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useRevenuePage } from "./use-revenue-page";
import {
  revenueApi,
  revenueMinorUnits,
  revenueShareBps,
  revenueMoney,
  RevenueRequestError,
  type RevenueCrew,
  type RevenueMember,
  type RevenueContract,
  type RevenueReceipt,
  type RevenueReceiptDetail,
  type Allocation,
} from "./revenue-api";

type RevenueDraft = {
  currency: "USD" | "CNY";
  contract: string;
  additionalContracts: string[];
  incomeDate: string;
  incomeType: string;
  incomeSource: string;
  notes: string;
  contractNumber: string;
  signingParty: string;
  contractExpiresOn: string;
  amount: string;
  reference: string;
  title: string;
  shares: Record<string, string>;
};
type SavedDraft = {
  revision: number;
  data: RevenueDraft | null;
  updatedAt: string | null;
  contracts?: RevenueContract[];
};
function draftSnapshot(data: RevenueDraft) {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries({
        ...data,
        shares: Object.fromEntries(
          Object.entries(data.shares).sort(([a], [b]) => a.localeCompare(b))
        ),
      }).sort(([a], [b]) => a.localeCompare(b))
    )
  );
}
const incomeTypes: Record<string, string> = {
  licensing: "Licensing",
  advertising: "Advertising",
  merchandise: "Merchandise",
  course_sales: "Course sales",
  other: "Other",
};
const selectClass = "w-full rounded-md border bg-background px-3 py-2 text-sm";
const message = (error: unknown) =>
  error instanceof Error ? error.message : "The request failed.";
function PageControls({
  data,
  refreshDisabled = false,
}: {
  refreshDisabled?: boolean;
  data: {
    loading: boolean;
    error: string;
    nextCursor: string | null;
    refresh: () => void;
    more: () => Promise<void>;
  };
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {data.loading && <span role="status">Loading…</span>}
      {data.error && (
        <span role="alert" className="text-destructive">
          {data.error}
        </span>
      )}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={data.loading || refreshDisabled}
        onClick={data.refresh}
      >
        Refresh
      </Button>
      {data.nextCursor && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={data.loading}
          onClick={() => void data.more()}
        >
          Load more
        </Button>
      )}
    </div>
  );
}
export function RevenuePanel({ currency }: { currency: "USD" | "CNY" }) {
  const [crew, setCrew] = useState<RevenueCrew | null>(null);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">Crew revenue</h1>
        <p className="text-sm text-muted-foreground">
          Allocate confirmed revenue for the current site. Participants can request withdrawal after
          posting.
        </p>
      </header>
      {crew ? (
        <CrewRevenue
          key={`${crew.id}:${currency}`}
          crew={crew}
          currency={currency}
          onBack={() => setCrew(null)}
        />
      ) : (
        <>
          <form
            className="flex max-w-lg gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setQuery(search.trim());
            }}
          >
            <Input
              aria-label="Search Crews"
              placeholder="Search Crews"
              value={search}
              maxLength={100}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Button type="submit">Search</Button>
          </form>
          <CrewResults key={query} query={query} choose={setCrew} />
        </>
      )}
    </div>
  );
}
function CrewResults({ query, choose }: { query: string; choose: (crew: RevenueCrew) => void }) {
  const crews = useRevenuePage<RevenueCrew>(`/crews?q=${encodeURIComponent(query)}`);
  return (
    <div className="space-y-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Crew</TableHead>
            <TableHead className="w-24">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {crews.items.map((crew) => (
            <TableRow key={crew.id}>
              <TableCell>
                {crew.name}
                <span className="block text-xs text-muted-foreground">{crew.id}</span>
              </TableCell>
              <TableCell>
                <Button size="sm" variant="outline" onClick={() => choose(crew)}>
                  Select
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {!crews.loading && !crews.error && !crews.items.length && (
        <p className="text-sm text-muted-foreground">No Crews found.</p>
      )}
      <PageControls data={crews} />
    </div>
  );
}
function CrewRevenue({
  crew,
  currency,
  onBack,
}: {
  crew: RevenueCrew;
  currency: "USD" | "CNY";
  onBack: () => void;
}) {
  const base = `/crews/${encodeURIComponent(crew.id)}`;
  const members = useRevenuePage<RevenueMember>(`${base}/members`);
  const contracts = useRevenuePage<RevenueContract>(`${base}/contracts`);
  const history = useRevenuePage<RevenueReceipt>(`${base}/distributions`);
  const [draftRevision, setDraftRevision] = useState(0);
  const [changeOpen, setChangeOpen] = useState(false);
  const [loadOpen, setLoadOpen] = useState(false);
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  const [contract, setContract] = useState("");
  const [uploaded, setUploaded] = useState<RevenueContract[]>([]);
  const [additionalContracts, setAdditionalContracts] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const [incomeDate, setIncomeDate] = useState("");
  const [incomeType, setIncomeType] = useState("");
  const [incomeSource, setIncomeSource] = useState("");
  const [notes, setNotes] = useState("");
  const [contractNumber, setContractNumber] = useState("");
  const [signingParty, setSigningParty] = useState("");
  const [contractExpiresOn, setContractExpiresOn] = useState("");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [title, setTitle] = useState("");
  const [shares, setShares] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Allocation | null>(null);
  const [receipt, setReceipt] = useState<RevenueReceiptDetail | null>(null);
  const [reversalReason, setReversalReason] = useState("");
  const [reverseOpen, setReverseOpen] = useState(false);
  const [reversalPending, setReversalPending] = useState<{ id: string; reason: string } | null>(
    null
  );
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const operation = useRef<AbortController | null>(null);
  const requestId = useRef<string | null>(null);
  useEffect(() => () => operation.current?.abort(), []);
  async function run(action: (signal: AbortSignal) => Promise<void>) {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await action(controller.signal);
    } catch (failure) {
      if (!controller.signal.aborted) setError(message(failure));
    } finally {
      if (!controller.signal.aborted) {
        operation.current = null;
        setBusy(false);
      }
    }
  }
  async function openContract(id: string, signal: AbortSignal) {
    const link = await revenueApi<{ url: string; expiresAt: string }>(
      `/contracts/${encodeURIComponent(id)}/download`,
      signal,
      {}
    );
    if (signal.aborted) return;
    const url = new URL(link.url);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !Number.isFinite(Date.parse(link.expiresAt)) ||
      Date.parse(link.expiresAt) <= Date.now()
    )
      throw new Error("The contract download link is invalid or expired. Try again.");
    const anchor = document.createElement("a");
    anchor.href = url.href;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.click();
  }
  const draft: RevenueDraft = {
    currency,
    contract,
    additionalContracts,
    incomeDate,
    incomeType,
    incomeSource,
    notes,
    contractNumber,
    signingParty,
    contractExpiresOn,
    amount,
    reference,
    title,
    shares,
  };
  const snapshot = draftSnapshot(draft);
  const hasValues = Boolean(
    contract ||
    additionalContracts.length ||
    incomeDate ||
    incomeType ||
    incomeSource ||
    notes ||
    contractNumber ||
    signingParty ||
    contractExpiresOn ||
    amount ||
    reference ||
    title ||
    Object.keys(shares).length
  );
  const dirty = Boolean(
    files.length || (savedSnapshot === null ? hasValues : savedSnapshot !== snapshot)
  );
  useEffect(() => {
    if (!dirty && !uncertain) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, uncertain]);
  async function loadDraft() {
    await run(async (signal) => {
      const result = await revenueApi<SavedDraft>(`${base}/draft`, signal);
      if (signal.aborted) return;
      setDraftRevision(result.revision);
      if (!result.data) {
        setSuccess("No saved draft for this Crew.");
        return;
      }
      const data = result.data;
      if (data.currency !== currency)
        throw new Error("This draft belongs to a different site currency.");
      setContract(data.contract);
      setAdditionalContracts(data.additionalContracts);
      setIncomeDate(data.incomeDate);
      setIncomeType(data.incomeType);
      setIncomeSource(data.incomeSource);
      setNotes(data.notes);
      setContractNumber(data.contractNumber);
      setSigningParty(data.signingParty);
      setContractExpiresOn(data.contractExpiresOn);
      setAmount(data.amount);
      setReference(data.reference);
      setTitle(data.title);
      setShares(data.shares);
      setUploaded((previous) => [
        ...new Map(
          [...previous, ...(result.contracts ?? [])].map((file) => [file.id, file])
        ).values(),
      ]);
      setFiles([]);
      if (fileInput.current) fileInput.current.value = "";
      setSavedSnapshot(draftSnapshot(data));
      setSuccess("Saved draft loaded. Review it before posting.");
    });
  }
  const allContracts = [
    ...new Map([...contracts.items, ...uploaded].map((row) => [row.id, row])).values(),
  ];
  const selectedContract = allContracts.find((row) => row.id === contract);
  const selectedMembers = members.items.filter((member) => Object.hasOwn(shares, member.id));
  const frozen = busy || preview !== null || reversalPending !== null;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{crew.name}</h2>
        <Button
          variant="outline"
          disabled={busy || uncertain || reversalPending !== null}
          onClick={() => (dirty || preview ? setChangeOpen(true) : onBack())}
        >
          Change Crew
        </Button>
      </div>
      <ConfirmDialog
        open={changeOpen}
        onOpenChange={setChangeOpen}
        title="Change Crew?"
        description="Unsaved entries and the current preview will be cleared. Any saved draft remains available for this Crew."
        confirmLabel="Change Crew"
        cancelLabel="Keep editing"
        onConfirm={onBack}
      />
      <ConfirmDialog
        open={loadOpen}
        onOpenChange={setLoadOpen}
        title="Load saved draft?"
        description="This replaces your current entries with the saved draft."
        confirmLabel="Load draft"
        cancelLabel="Keep editing"
        onConfirm={loadDraft}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          disabled={frozen}
          onClick={() => (dirty ? setLoadOpen(true) : void loadDraft())}
        >
          Load saved draft
        </Button>
        <Button
          variant="outline"
          disabled={frozen || !hasValues || files.length > 0}
          onClick={() =>
            void run(async (signal) => {
              const result = await revenueApi<SavedDraft>(`${base}/draft`, signal, {
                revision: draftRevision,
                data: draft,
              });
              if (signal.aborted) return;
              setDraftRevision(result.revision);
              setSavedSnapshot(snapshot);
              setSuccess("Draft saved. No earnings have been posted.");
            })
          }
        >
          Save draft
        </Button>
        {files.length > 0 && (
          <span className="text-xs text-muted-foreground">
            Upload selected files before saving a draft.
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="text-sm">
          {success}
        </p>
      )}
      <section className="space-y-3 border-b pb-5">
        <h3 className="text-sm font-semibold">Contract</h3>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            Saved contract
            <select
              aria-label="Saved contract"
              className={selectClass}
              value={contract}
              disabled={frozen}
              onChange={(event) => {
                const next = event.target.value;
                setAdditionalContracts((previous) =>
                  [...new Set([...previous, ...(contract ? [contract] : [])])].filter(
                    (id) => id !== next
                  )
                );
                setContract(next);
              }}
            >
              <option value="">Select a contract</option>
              {allContracts.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.filename} · {new Date(row.verifiedAt).toLocaleDateString()} ·{" "}
                  {row.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end gap-2">
            <Input
              ref={fileInput}
              type="file"
              aria-label="Contract files"
              accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
              multiple
              disabled={frozen}
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
            />
            <Button
              disabled={frozen || !files.length}
              onClick={() =>
                void run(async (signal) => {
                  if (
                    !files.length ||
                    files.length > 20 ||
                    files.some(
                      (file) =>
                        file.size > 10 * 1024 * 1024 ||
                        file.size === 0 ||
                        !["application/pdf", "image/jpeg", "image/png"].includes(file.type)
                    )
                  )
                    throw new Error("Choose up to 20 PDF, JPG or PNG files, each up to 10 MB.");
                  let primary = contract;
                  for (const file of files) {
                    const body = new FormData();
                    body.set("crewId", crew.id);
                    body.set("file", file);
                    const result = await revenueApi<RevenueContract>("/contracts", signal, body);
                    if (signal.aborted) return;
                    setUploaded((previous) => [
                      ...new Map([...previous, result].map((row) => [row.id, row])).values(),
                    ]);
                    if (!primary) {
                      primary = result.id;
                      setContract(result.id);
                    } else if (result.id !== primary)
                      setAdditionalContracts((previous) => [...new Set([...previous, result.id])]);
                  }
                  setFiles([]);
                  if (fileInput.current) fileInput.current.value = "";
                  contracts.refresh();
                })
              }
            >
              Upload files
            </Button>
          </div>
        </div>
        {allContracts.length > 1 && (
          <fieldset disabled={frozen} className="space-y-2">
            <legend className="text-sm font-medium">Supporting contract files</legend>
            {allContracts
              .filter((row) => row.id !== contract)
              .map((row) => (
                <label key={row.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={additionalContracts.includes(row.id)}
                    onChange={(event) =>
                      setAdditionalContracts((previous) =>
                        event.target.checked
                          ? [...new Set([...previous, row.id])]
                          : previous.filter((id) => id !== row.id)
                      )
                    }
                  />
                  {row.filename}
                </label>
              ))}
          </fieldset>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <PageControls data={contracts} />
          {selectedContract && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                void run(async (signal) => {
                  await openContract(contract, signal);
                })
              }
            >
              Open contract
            </Button>
          )}
        </div>
      </section>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async (signal) => {
            if (!selectedContract) throw new Error("Select a verified contract.");
            if (!/^\d{4}-\d{2}-\d{2}$/.test(incomeDate) || !incomeType)
              throw new Error("Enter the income date and income type.");
            if (additionalContracts.filter((id) => id !== contract).length > 19)
              throw new Error("Select at most 20 contract files including the primary contract.");
            const participants = Object.entries(shares).map(([crewMemberId, share]) => ({
              crewMemberId,
              shareBps: revenueShareBps(share),
            }));
            if (
              !participants.length ||
              participants.reduce((sum, row) => sum + row.shareBps, 0) !== 10000
            )
              throw new Error("Select beneficiaries whose shares total exactly 100%.");
            const result = await revenueApi<Allocation>("/preview", signal, {
              currency,
              amountMinor: revenueMinorUnits(amount),
              participants,
            });
            if (!signal.aborted) {
              requestId.current = crypto.randomUUID();
              setPreview(result);
            }
          });
        }}
      >
        <fieldset disabled={frozen} className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="space-y-1 text-sm">
              Income date{" "}
              <Input
                type="date"
                aria-label="Income date"
                value={incomeDate}
                onChange={(event) => setIncomeDate(event.target.value)}
                required
              />
            </label>
            <label className="space-y-1 text-sm">
              Income type{" "}
              <select
                aria-label="Income type"
                className={selectClass}
                value={incomeType}
                onChange={(event) => setIncomeType(event.target.value)}
                required
              >
                <option value="">Select income type</option>
                {Object.entries(incomeTypes).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              Source / customer{" "}
              <Input
                aria-label="Source / customer"
                value={incomeSource}
                maxLength={180}
                onChange={(event) => setIncomeSource(event.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm">
              Contract number{" "}
              <Input
                aria-label="Contract number"
                value={contractNumber}
                maxLength={180}
                onChange={(event) => setContractNumber(event.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm">
              Signing party{" "}
              <Input
                aria-label="Signing party"
                value={signingParty}
                maxLength={180}
                onChange={(event) => setSigningParty(event.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm">
              Contract expiry{" "}
              <Input
                type="date"
                aria-label="Contract expiry"
                value={contractExpiresOn}
                onChange={(event) => setContractExpiresOn(event.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm md:col-span-3">
              Notes{" "}
              <Input
                aria-label="Notes"
                value={notes}
                maxLength={200}
                onChange={(event) => setNotes(event.target.value)}
              />
              <span className="text-xs text-muted-foreground">{notes.length} / 200</span>
            </label>
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <label className="space-y-1 text-sm">
              Revenue title
              <Input
                aria-label="Revenue title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
                maxLength={180}
              />
            </label>
            <label className="space-y-1 text-sm">
              Revenue reference
              <Input
                aria-label="Revenue reference"
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                required
                maxLength={180}
              />
            </label>
            <label className="space-y-1 text-sm">
              Confirmed revenue
              <Input
                aria-label="Confirmed revenue"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                required
              />
            </label>
            <label className="space-y-1 text-sm">
              Currency
              <Input aria-label="Currency" value={currency} readOnly />
            </label>
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Revenue-share participants</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Include</TableHead>
                  <TableHead>Creator</TableHead>
                  <TableHead>Membership</TableHead>
                  <TableHead>Share (%)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.items.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell>
                      <input
                        type="checkbox"
                        aria-label={`Include ${member.name ?? member.publicId}`}
                        checked={Object.hasOwn(shares, member.id)}
                        onChange={(event) =>
                          setShares((previous) => {
                            const next = { ...previous };
                            if (event.target.checked) next[member.id] = "";
                            else delete next[member.id];
                            return next;
                          })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      {member.name ?? "Name unavailable"}
                      <span className="block text-xs text-muted-foreground">
                        Public ID {member.publicId}
                      </span>
                    </TableCell>
                    <TableCell>{member.status}</TableCell>
                    <TableCell>
                      <Input
                        className="max-w-28"
                        aria-label={`Share for ${member.name ?? member.publicId}`}
                        inputMode="decimal"
                        disabled={!Object.hasOwn(shares, member.id)}
                        value={shares[member.id] ?? ""}
                        onChange={(event) =>
                          setShares((previous) => ({
                            ...previous,
                            [member.id]: event.target.value,
                          }))
                        }
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!members.loading && !members.error && !members.items.length && (
              <p className="text-sm text-muted-foreground">No beneficiaries found for this Crew.</p>
            )}
            <PageControls data={members} refreshDisabled={Object.keys(shares).length > 0} />
          </div>
          <Button type="submit" disabled={members.loading || Boolean(members.error) || !contract}>
            Preview allocation
          </Button>
        </fieldset>
      </form>
      {preview && (
        <section className="space-y-3 rounded-md border p-4" aria-label="Allocation preview">
          <h3 className="font-semibold">
            Confirm {revenueMoney(preview.amountMinor, preview.currency)}
          </h3>
          <p className="text-sm text-muted-foreground">
            {title} · {reference} · {selectedContract?.filename}. Posting makes these earnings
            available for withdrawal.
          </p>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            {Object.entries({
              "Income date": incomeDate,
              "Income type": incomeTypes[incomeType],
              "Source / customer": incomeSource,
              Notes: notes,
              "Contract number": contractNumber,
              "Signing party": signingParty,
              "Contract expiry": contractExpiresOn,
              "Supporting files": allContracts
                .filter((row) => additionalContracts.includes(row.id) && row.id !== contract)
                .map((row) => row.filename)
                .join(", "),
            })
              .filter(([, value]) => value)
              .map(([label, value]) => (
                <div key={label}>
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="break-words">{value}</dd>
                </div>
              ))}
          </dl>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Creator</TableHead>
                <TableHead>Share</TableHead>
                <TableHead>Confirmed earnings</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.participants.map((row) => {
                const member = selectedMembers.find((item) => item.id === row.crewMemberId);
                return (
                  <TableRow key={row.crewMemberId}>
                    <TableCell>
                      {member?.name ?? "Name unavailable"}
                      <span className="block text-xs text-muted-foreground">
                        Public ID {member?.publicId}
                      </span>
                    </TableCell>
                    <TableCell>{row.shareBps / 100}%</TableCell>
                    <TableCell>{revenueMoney(row.amountMinor, preview.currency)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {uncertain && (
            <p role="status" className="text-sm">
              The posting result is unknown. Retry the same allocation to recover its receipt
              without posting twice.
            </p>
          )}
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={busy || uncertain}
              onClick={() => {
                setPreview(null);
                setError("");
                requestId.current = null;
              }}
            >
              Edit allocation
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                void run(async (signal) => {
                  try {
                    const result = await revenueApi<RevenueReceipt>("/distributions", signal, {
                      requestId: requestId.current,
                      contractId: contract,
                      additionalContractIds: additionalContracts.filter((id) => id !== contract),
                      incomeDate,
                      incomeType,
                      ...(incomeSource.trim() ? { incomeSource: incomeSource.trim() } : {}),
                      ...(notes.trim() ? { notes: notes.trim() } : {}),
                      ...(contractNumber.trim() ? { contractNumber: contractNumber.trim() } : {}),
                      ...(signingParty.trim() ? { signingParty: signingParty.trim() } : {}),
                      ...(contractExpiresOn ? { contractExpiresOn } : {}),
                      revenueReference: reference.trim(),
                      title: title.trim(),
                      allocation: {
                        currency: preview.currency,
                        amountMinor: preview.amountMinor,
                        participants: preview.participants.map(({ crewMemberId, shareBps }) => ({
                          crewMemberId,
                          shareBps,
                        })),
                      },
                    });
                    if (signal.aborted) return;
                    setUncertain(false);
                    setPreview(null);
                    requestId.current = null;
                    setAmount("");
                    setReference("");
                    setTitle("");
                    let draftNotice = "";
                    if (draftRevision > 0) {
                      try {
                        const cleared = await revenueApi<SavedDraft>(`${base}/draft`, signal, {
                          revision: draftRevision,
                          data: null,
                        });
                        if (signal.aborted) return;
                        setDraftRevision(cleared.revision);
                      } catch {
                        draftNotice =
                          " The saved draft could not be cleared; load it before saving another draft.";
                      }
                    }
                    setSavedSnapshot(null);
                    setSuccess(`Revenue posted. Receipt ${result.id}${draftNotice}`);
                    history.refresh();
                  } catch (failure) {
                    if (!signal.aborted)
                      setUncertain(
                        !(
                          failure instanceof RevenueRequestError &&
                          failure.status >= 400 &&
                          failure.status < 500
                        )
                      );
                    throw failure;
                  }
                })
              }
            >
              {uncertain ? "Retry posting" : "Post confirmed revenue"}
            </Button>
          </div>
        </section>
      )}
      <section className="space-y-3 border-t pt-5">
        <h3 className="font-semibold">Distribution history</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Revenue</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Posted</TableHead>
              <TableHead>Operator</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {history.items.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  {row.title}
                  <span className="block text-xs text-muted-foreground">
                    {row.revenueReference} · {row.id}
                  </span>
                </TableCell>
                <TableCell>{revenueMoney(row.amountMinor, row.currency)}</TableCell>
                <TableCell>{new Date(row.postedAt).toLocaleString()}</TableCell>
                <TableCell className="text-xs">{row.postedByAdminId}</TableCell>
                <TableCell>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy || reversalPending !== null}
                    onClick={() =>
                      void run(async (signal) => {
                        const result = await revenueApi<RevenueReceiptDetail>(
                          `/distributions/${encodeURIComponent(row.id)}`,
                          signal
                        );
                        if (!signal.aborted) {
                          setReceipt(result);
                          setReversalReason("");
                        }
                      })
                    }
                  >
                    View receipt
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!history.loading && !history.error && !history.items.length && (
          <p className="text-sm text-muted-foreground">No revenue posted for this Crew.</p>
        )}
        <PageControls data={history} />
        {receipt && (
          <section className="space-y-3 rounded-md border p-4" aria-label="Revenue receipt">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h4 className="font-semibold">{receipt.title}</h4>
                <p className="text-sm text-muted-foreground">
                  {receipt.crew.name} · {receipt.revenueReference}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || reversalPending !== null}
                onClick={() => setReceipt(null)}
              >
                Close receipt
              </Button>
            </div>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Confirmed revenue</dt>
                <dd>{revenueMoney(receipt.amountMinor, receipt.currency)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Contract</dt>
                <dd className="space-y-1">
                  {[receipt.contract, ...(receipt.supportingContracts ?? [])].map((file) => (
                    <div key={file.id}>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => void run((signal) => openContract(file.id, signal))}
                      >
                        Open {file.filename}
                      </Button>
                    </div>
                  ))}
                </dd>
              </div>
              {Object.entries({
                "Income date": receipt.incomeDate,
                "Income type": receipt.incomeType
                  ? (incomeTypes[receipt.incomeType] ?? receipt.incomeType)
                  : null,
                "Source / customer": receipt.incomeSource,
                Notes: receipt.notes,
                "Contract number": receipt.contractNumber,
                "Signing party": receipt.signingParty,
                "Contract expiry": receipt.contractExpiresOn,
              })
                .filter(([, value]) => value)
                .map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="break-words">{value}</dd>
                  </div>
                ))}
              <div>
                <dt className="text-muted-foreground">Posted</dt>
                <dd>{new Date(receipt.postedAt).toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Operator</dt>
                <dd className="break-all">{receipt.postedByAdminId}</dd>
              </div>
            </dl>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Creator public ID</TableHead>
                  <TableHead>Share</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Earning status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {receipt.participants.map((participant) => (
                  <TableRow key={participant.crewMemberId}>
                    <TableCell>{participant.publicId}</TableCell>
                    <TableCell>{participant.shareBps / 100}%</TableCell>
                    <TableCell>{revenueMoney(participant.amountMinor, receipt.currency)}</TableCell>
                    <TableCell>
                      {participant.status === "zero_amount"
                        ? "No earning (rounded to zero)"
                        : participant.status}
                      <span className="block text-xs text-muted-foreground">
                        {participant.reversalReason}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="break-all text-xs text-muted-foreground">Receipt {receipt.id}</p>
            {receipt.participants.some((row) => row.status === "posted") &&
              receipt.participants.every((row) =>
                ["posted", "zero_amount"].includes(row.status)
              ) && (
                <div className="space-y-2 border-t pt-3">
                  <p className="text-sm text-muted-foreground">
                    Reverse an incorrect allocation only before its earnings are reserved or paid.
                    The original receipt is retained. Post corrected revenue under a new reference.
                  </p>
                  <label className="block space-y-1 text-sm">
                    Reversal reason
                    <Input
                      aria-label="Reversal reason"
                      value={reversalReason}
                      maxLength={2000}
                      disabled={busy || reversalPending !== null}
                      onChange={(event) => setReversalReason(event.target.value)}
                    />
                  </label>
                  {reversalPending && (
                    <p role="status" className="text-sm">
                      The reversal result is unknown. Retry with the same reason to recover the
                      result.
                    </p>
                  )}
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={busy || !reversalReason.trim() || uncertain}
                    onClick={() => {
                      setError("");
                      setReverseOpen(true);
                    }}
                  >
                    {reversalPending ? "Retry reversal" : "Reverse allocation"}
                  </Button>
                </div>
              )}
            <ConfirmDialog
              open={reverseOpen}
              onOpenChange={setReverseOpen}
              title="Reverse this revenue allocation?"
              confirmLabel="Confirm reversal"
              cancelLabel="Cancel"
              destructive
              description={
                <>
                  <span>
                    {revenueMoney(receipt.amountMinor, receipt.currency)} ·{" "}
                    {receipt.revenueReference}. This removes all unwithdrawn earnings from this
                    allocation. Reason: {reversalPending?.reason ?? reversalReason.trim()}
                  </span>
                  {error && (
                    <span role="alert" className="mt-2 block text-destructive">
                      {error}
                    </span>
                  )}
                </>
              }
              onConfirm={async () => {
                if (operation.current) throw new Error("Another operation is running.");
                const attempt = reversalPending ?? {
                  id: receipt.id,
                  reason: reversalReason.trim(),
                };
                const controller = new AbortController();
                operation.current = controller;
                setReversalPending(attempt);
                setBusy(true);
                setError("");
                try {
                  await revenueApi(
                    `/distributions/${encodeURIComponent(attempt.id)}/reverse`,
                    controller.signal,
                    { reason: attempt.reason }
                  );
                  if (controller.signal.aborted) return;
                  setReceipt((previous) =>
                    previous?.id === attempt.id
                      ? {
                          ...previous,
                          participants: previous.participants.map((row) =>
                            row.status === "zero_amount"
                              ? row
                              : { ...row, status: "reversed", reversalReason: attempt.reason }
                          ),
                        }
                      : previous
                  );
                  setReversalPending(null);
                  setSuccess(`Allocation reversed. Receipt ${attempt.id}`);
                  history.refresh();
                } catch (failure) {
                  if (!controller.signal.aborted) {
                    if (
                      failure instanceof RevenueRequestError &&
                      failure.status >= 400 &&
                      failure.status < 500
                    )
                      setReversalPending(null);
                    setError(message(failure));
                  }
                  throw failure;
                } finally {
                  if (!controller.signal.aborted) {
                    operation.current = null;
                    setBusy(false);
                  }
                }
              }}
            />
          </section>
        )}
      </section>
    </div>
  );
}
