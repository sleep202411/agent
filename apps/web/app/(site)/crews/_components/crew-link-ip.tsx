"use client";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useState } from "react";
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { api } from "@/src/lib/api";
import { useLocale, useTranslations } from "@/src/i18n/i18n";

type Origin = { crewId: string | null; version: number; choices: { id: string; name: string }[] };
export function CrewLinkIp({ crewId, userId }: { crewId: string; userId: string }) {
  const [open, setOpen] = useState(false);
  const t = useTranslations("crewLinks");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" color="muted" size="sm">
          {t("linkIp")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("linkIp")}</DialogTitle>
        </DialogHeader>
        {open && (
          <LinkIpForm
            key={`${crewId}:${userId}`}
            crewId={crewId}
            userId={userId}
            done={() => setOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
function LinkIpForm({
  crewId,
  userId,
  done,
}: {
  crewId: string;
  userId: string;
  done: () => void;
}) {
  const t = useTranslations("crewLinks");
  const locale = useLocale();
  const qc = useQueryClient();
  const [selected, setSelected] = useState("");
  const list = useInfiniteQuery({
    queryKey: ["crew-link-ip-options", userId, locale],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api.get<{ items: { id: string; title: string }[]; nextCursor: string | null }>(
        "/aurora/ip-commerce/me/ips",
        { params: { locale, limit: 30, cursor: pageParam }, signal }
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });
  const path = `/aurora/ip-commerce/me/ips/${encodeURIComponent(selected)}/crew`;
  const origin = useQuery({
    queryKey: ["crew-link-ip-origin", userId, selected],
    enabled: Boolean(selected),
    queryFn: ({ signal }) => api.get<Origin>(path, { signal }),
    retry: false,
  });
  const save = useMutation({
    mutationFn: async () => {
      if (!origin.data || origin.isError) throw new Error(t("retry"));
      await api.put(path, { data: { crewId, expectedVersion: origin.data.version } });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["crew-linked-ips", crewId] });
      done();
    },
    onError: () => {
      void origin.refetch();
    },
  });
  const options = list.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("linkIpHint")}</p>
      {list.isPending ? (
        <p role="status">{t("loading")}</p>
      ) : list.isError ? (
        <div role="alert">
          <p>{list.error.message}</p>
          <Button onClick={() => void list.refetch()}>{t("retry")}</Button>
        </div>
      ) : (
        <label className="block space-y-2 text-sm">
          <span>{t("selectIp")}</span>
          <NativeSelect
            value={selected}
            disabled={save.isPending}
            onChange={(value) => {
              setSelected(value);
              save.reset();
            }}
            className="h-10 w-full rounded-md border border-input bg-background px-3"
          >
            <NativeSelectOption value="">{t("selectIp")}</NativeSelectOption>
            {options.map((ip) => (
              <NativeSelectOption key={ip.id} value={ip.id}>
                {ip.title}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
      )}
      {list.isSuccess && !options.length && (
        <p className="text-sm text-muted-foreground">{t("noOwnedIps")}</p>
      )}
      {list.hasNextPage && (
        <Button
          variant="ghost"
          disabled={list.isFetching || save.isPending}
          onClick={() => void list.fetchNextPage()}
        >
          {t("more")}
        </Button>
      )}
      {selected && origin.isPending && <p role="status">{t("loading")}</p>}
      {origin.isError && (
        <div role="alert">
          <p>{origin.error.message}</p>
          <Button onClick={() => void origin.refetch()}>{t("retry")}</Button>
        </div>
      )}
      {origin.data && !origin.isError && origin.data.crewId && origin.data.crewId !== crewId && (
        <p className="text-sm text-muted-foreground">{t("linkedElsewhere")}</p>
      )}
      {save.isError && (
        <p role="alert" className="text-sm">
          {save.error.message}
        </p>
      )}
      <Button
        disabled={
          !selected ||
          !origin.data ||
          origin.isError ||
          origin.isFetching ||
          save.isPending ||
          !origin.data.choices.some((crew) => crew.id === crewId)
        }
        onClick={() => save.mutate()}
      >
        {t("confirmLink")}
      </Button>
    </div>
  );
}
