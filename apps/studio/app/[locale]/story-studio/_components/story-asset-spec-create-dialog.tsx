"use client";

import { useStoryOperationScope } from "../_lib/use-story-operation-scope";
import { useAuth } from "@/app/_components/auth-provider";

import { IconPlus } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FIELD_BUTTON, FIELD_CONTROL } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  createStoryAssetSpec,
  createStoryProductionIdempotencyKey,
  storyProductionKeys,
  type StoryAssetSpec,
  type StoryAssetSpecKind,
} from "@/lib/story-production-api";
import { storyApiErrorMessage } from "@/lib/story-projects-api";

export function StoryAssetSpecCreateDialog({
  projectId,
  chapterId,
  initialKind,
  open,
  onOpenChange,
}: {
  projectId: string;
  chapterId: string;
  initialKind: StoryAssetSpecKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { user } = useAuth();
  const isCurrent = useStoryOperationScope(
    JSON.stringify([projectId, chapterId, user?.id, initialKind, open])
  );
  const t = useTranslations("storyStudio.assetsPage.createDialog");
  const addT = useTranslations("storyStudio.assetsPage.addByKind");
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const trimmedName = name.trim();
  const valid = trimmedName.length > 0;

  const mutation = useMutation({
    retry: false,
    onMutate: () => ({
      isCurrent,
      cacheKey: storyProductionKeys.assets(projectId, chapterId, user?.id ?? null),
    }),
    mutationFn: () =>
      createStoryAssetSpec(
        projectId,
        chapterId,
        createStoryProductionIdempotencyKey("story-asset-create"),
        {
          kind: initialKind,
          name: trimmedName,
          imagePrompt: trimmedName,
        }
      ),
    onSuccess: async (created, _input, context) => {
      if (!context) return;
      queryClient.setQueryData<StoryAssetSpec[]>(context.cacheKey, (current) => [
        ...(current ?? []),
        created,
      ]);
      if (!context.isCurrent()) return;
      onOpenChange(false);
      toast.success(t("created"));
      await queryClient.invalidateQueries({
        queryKey: storyProductionKeys.state(projectId, chapterId),
      });
    },
    onError: (error, _input, context) => {
      if (!context?.isCurrent()) return;
      toast.error(storyApiErrorMessage(error, t("createError")));
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!mutation.isPending) onOpenChange(next);
      }}
    >
      <DialogContent className="border-0 bg-popover text-white shadow-2xl sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{addT(initialKind)}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && !mutation.isPending) mutation.mutate();
          }}
        >
          <Field dense required label={t("name")} htmlFor="asset-create-name">
            <Input
              id="asset-create-name"
              className={FIELD_CONTROL}
              value={name}
              maxLength={240}
              disabled={mutation.isPending}
              aria-required="true"
              autoFocus
              onChange={(event) => setName(event.target.value)}
            />
          </Field>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              className={FIELD_BUTTON}
              disabled={mutation.isPending}
              onClick={() => onOpenChange(false)}
            >
              {t("cancel")}
            </Button>
            <Button
              type="submit"
              className={FIELD_BUTTON}
              disabled={!valid || mutation.isPending}
              loading={mutation.isPending}
            >
              <IconPlus />
              {t("create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
