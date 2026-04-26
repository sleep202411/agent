"use client";

import { useState } from "react";
import { IconX, IconPlus, IconInfoCircle } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { PRESET_REWARDS, type IPCreateForm, type IPRewardTier } from "../../_data/ip";

interface Props {
  form: IPCreateForm;
  update: (patch: Partial<IPCreateForm>) => void;
}

export function StepRewards({ form, update }: Props) {
  const t = useTranslations("ipCreate");
  const [showCustom, setShowCustom] = useState(false);
  const [custom, setCustom] = useState({
    title: "",
    amount: "",
    description: "",
    perkInput: "",
    perks: [] as string[],
  });

  const addReward = (reward: IPRewardTier) => {
    if (form.rewards.some((r) => r.id === reward.id)) return;
    update({ rewards: [...form.rewards, reward] });
  };

  const removeReward = (id: string) => {
    update({ rewards: form.rewards.filter((r) => r.id !== id) });
  };

  const submitCustom = () => {
    if (!custom.title || !custom.amount) return;
    const reward: IPRewardTier = {
      id: `custom-${Date.now()}`,
      title: custom.title,
      amount: Number(custom.amount),
      description: custom.description,
      perks: custom.perks,
    };
    update({ rewards: [...form.rewards, reward] });
    setCustom({ title: "", amount: "", description: "", perkInput: "", perks: [] });
    setShowCustom(false);
  };

  return (
    <div className="space-y-6">
      {/* Presets */}
      <div>
        <label className="mb-3 block text-sm font-medium text-foreground">
          {t("suggestedRewards")}
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {PRESET_REWARDS.map((preset) => {
            const added = form.rewards.some((r) => r.id === preset.id);
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => (added ? removeReward(preset.id) : addReward(preset))}
                className={cn(
                  "rounded-xl border p-4 text-left transition-all",
                  added
                    ? "border-primary/40 bg-primary/5"
                    : "border-border bg-card hover:border-border/80"
                )}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-sm font-semibold text-foreground">
                    {"\u00A5"}
                    {preset.amount} {preset.title}
                  </span>
                  {added && <span className="text-xs text-primary">{t("added")}</span>}
                </div>
                <p className="mb-2 text-xs text-muted-foreground">{preset.description}</p>
                <div className="flex flex-wrap gap-1">
                  {preset.perks.slice(0, 3).map((perk) => (
                    <span
                      key={perk}
                      className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground"
                    >
                      {perk}
                    </span>
                  ))}
                  {preset.perks.length > 3 && (
                    <span className="text-[10px] text-muted-foreground">
                      +{preset.perks.length - 3}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Current rewards */}
      {form.rewards.length > 0 && (
        <div>
          <label className="mb-3 block text-sm font-medium text-foreground">
            {t("currentRewards")} ({form.rewards.length})
          </label>
          <div className="space-y-2">
            {form.rewards.map((reward) => (
              <div
                key={reward.id}
                className="flex items-start justify-between rounded-xl border border-border bg-card p-3"
              >
                <div>
                  <div className="text-sm font-medium text-foreground">
                    {"\u00A5"}
                    {reward.amount} {reward.title}
                  </div>
                  {reward.description && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{reward.description}</p>
                  )}
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {reward.perks.map((perk) => (
                      <span
                        key={perk}
                        className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary"
                      >
                        {perk}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeReward(reward.id)}
                  className="ml-2 shrink-0 text-muted-foreground hover:text-destructive"
                >
                  <IconX className="size-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Custom reward */}
      {showCustom ? (
        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h4 className="text-sm font-medium text-foreground">{t("customReward")}</h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input
              type="text"
              value={custom.title}
              onChange={(e) => setCustom({ ...custom, title: e.target.value })}
              placeholder={t("rewardTitle")}
              className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none"
            />
            <input
              type="number"
              value={custom.amount}
              onChange={(e) => setCustom({ ...custom, amount: e.target.value })}
              placeholder={t("rewardAmount")}
              className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none"
            />
          </div>
          <textarea
            value={custom.description}
            onChange={(e) => setCustom({ ...custom, description: e.target.value })}
            placeholder={t("rewardDesc")}
            rows={2}
            className="w-full resize-none rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none"
          />
          <div>
            <input
              type="text"
              value={custom.perkInput}
              onChange={(e) => setCustom({ ...custom, perkInput: e.target.value })}
              placeholder={t("perkPlaceholder")}
              onKeyDown={(e) => {
                if (e.key === "Enter" && custom.perkInput.trim()) {
                  e.preventDefault();
                  setCustom({
                    ...custom,
                    perks: [...custom.perks, custom.perkInput.trim()],
                    perkInput: "",
                  });
                }
              }}
              className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none"
            />
            {custom.perks.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {custom.perks.map((perk, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary"
                  >
                    {perk}
                    <button
                      type="button"
                      onClick={() =>
                        setCustom({ ...custom, perks: custom.perks.filter((_, j) => j !== i) })
                      }
                    >
                      <IconX className="size-2.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowCustom(false)}
              className="rounded-lg border border-border px-4 py-2 text-xs text-muted-foreground hover:text-foreground"
            >
              {t("cancel")}
            </button>
            <button
              type="button"
              onClick={submitCustom}
              disabled={!custom.title || !custom.amount}
              className="rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              {t("addReward")}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowCustom(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border bg-secondary/50 py-3 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          <IconPlus className="size-3.5" /> {t("addCustomReward")}
        </button>
      )}

      {/* Info tip */}
      <div className="flex items-start gap-2 rounded-lg bg-primary/5 p-3">
        <IconInfoCircle className="mt-0.5 size-4 shrink-0 text-primary" />
        <p className="text-xs leading-relaxed text-muted-foreground">{t("rewardsTip")}</p>
      </div>
    </div>
  );
}
