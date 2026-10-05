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
  const [contract, setContract] = useState("");
  const [uploaded, setUploaded] = useState<RevenueContract | null>(null);
  const [file, setFile] = useState<File | null>(null);
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
  const allContracts = [
    ...new Map(
      [...contracts.items, ...(uploaded ? [uploaded] : [])].map((row) => [row.id, row])
    ).values(),
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
          onClick={onBack}
        >
          Change Crew
        </Button>
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
              onChange={(event) => setContract(event.target.value)}
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
              type="file"
              aria-label="PDF contract"
              accept="application/pdf,.pdf"
              disabled={frozen}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            <Button
              disabled={frozen || !file}
              onClick={() =>
                void run(async (signal) => {
                  if (!file || file.size > 20 * 1024 * 1024 || file.size === 0)
                    throw new Error("Choose a PDF contract up to 20 MB.");
                  const body = new FormData();
                  body.set("crewId", crew.id);
                  body.set("file", file);
                  const result = await revenueApi<RevenueContract>("/contracts", signal, body);
                  if (signal.aborted) return;
                  setUploaded(result);
                  setContract(result.id);
                  contracts.refresh();
                })
              }
            >
              Upload PDF
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PageControls data={contracts} />
          {selectedContract && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                void run(async (signal) => {
                  const link = await revenueApi<{ url: string }>(
                    `/contracts/${encodeURIComponent(contract)}/download`,
                    signal,
                    {}
                  );
                  if (!signal.aborted) {
                    const anchor = document.createElement("a");
                    anchor.href = link.url;
                    anchor.target = "_blank";
                    anchor.rel = "noopener noreferrer";
                    anchor.click();
                  }
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
                    setSuccess(`Revenue posted. Receipt ${result.id}`);
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
                <dd>{receipt.contract.filename}</dd>
              </div>
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
