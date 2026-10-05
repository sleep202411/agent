"use client";

import { CreatorDeviceCity } from "./creator-device-city";
import { CreatorCityGeocode } from "./creator-city-geocode";
import type { CreatorLocationProfile } from "@repo/shared/creator-location";
import { REGIONS, regionLabel } from "@repo/shared/regions";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useCreatorLocationEditor } from "../_hooks/use-creator-location-editor";

type City = NonNullable<CreatorLocationProfile["basedIn"]>;

export function CreatorLocationEditor() {
  const { user } = useCurrentUser();
  return user ? <Editor key={String(user.id)} userId={String(user.id)} /> : null;
}

function CityFields({
  value,
  change,
  disabled,
}: {
  value: City;
  change: (value: City) => void;
  disabled: boolean;
}) {
  const t = useTranslations("creatorLocation");
  const locale = useLocale();
  return (
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      <label className="min-w-0 space-y-1">
        <span>{t("country")}</span>
        <NativeSelect
          aria-label={t("country")}
          disabled={disabled}
          value={value.countryCode}
          onChange={(countryCode) => change({ ...value, countryCode })}
          className="min-h-11 w-full"
        >
          <NativeSelectOption value="">{t("chooseCountry")}</NativeSelectOption>
          {value.countryCode && !REGIONS.some((r) => r.code === value.countryCode) && (
            <NativeSelectOption value={value.countryCode}>{value.countryCode}</NativeSelectOption>
          )}
          {REGIONS.filter((r) => r.code !== "GLOBAL").map((r) => (
            <NativeSelectOption key={r.code} value={r.code}>
              {regionLabel(r.code, locale)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </label>
      <label className="min-w-0 space-y-1">
        <span>{t("city")}</span>
        <Input
          className="min-h-11"
          required
          maxLength={150}
          value={value.city}
          onChange={(event) => change({ ...value, city: event.target.value })}
        />
      </label>
    </div>
  );
}

function Editor({ userId }: { userId: string }) {
  const locale = useLocale();
  const t = useTranslations("creatorLocation");
  const state = useCreatorLocationEditor(userId);
  const { profile, change, busy, denied, pending, blocked } = state;
  const disabled = busy || Boolean(pending) || blocked;
  return (
    <section
      aria-label={t("title")}
      className="min-w-0 space-y-4 rounded-xl bg-muted/20 p-4 text-sm sm:p-6"
    >
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <p className="text-muted-foreground">{t("description")}</p>
      </div>
      {busy && <p role="status">{t("loading")}</p>}
      {state.saved && <p role="status">{t("saved")}</p>}
      {state.error && (
        <p role="alert" className="break-words text-red-400">
          {state.error}
        </p>
      )}
      {pending && !denied && <p>{t("pending")}</p>}
      {!denied && state.result && (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void state.save();
          }}
        >
          <fieldset className="min-w-0 space-y-5" disabled={disabled}>
            <fieldset className="min-w-0 space-y-3">
              <legend className="mb-2 font-medium">{t("basedIn")}</legend>
              <p className="text-muted-foreground">{t("basedInHint")}</p>
              <CreatorDeviceCity
                key={`${userId}:${locale}:${state.result.version}`}
                disabled={disabled}
                confirm={(basedIn) => change({ ...profile, basedIn })}
                onDenied={state.failure}
              />
              {profile.basedIn ? (
                <>
                  <CityFields
                    value={profile.basedIn}
                    disabled={disabled}
                    change={(basedIn) => change({ ...profile, basedIn })}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    onClick={() => change({ ...profile, basedIn: null, showOnMap: false })}
                  >
                    {t("removeBase")}
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={() => change({ ...profile, basedIn: { countryCode: "", city: "" } })}
                >
                  {t("addBase")}
                </Button>
              )}
              <label className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  checked={profile.showOnMap}
                  disabled={!profile.basedIn || disabled}
                  onChange={(event) => change({ ...profile, showOnMap: event.target.checked })}
                  className="size-5 shrink-0 accent-primary"
                />
                {t("showOnMap")}
              </label>
            </fieldset>
            <fieldset className="min-w-0 space-y-3">
              <legend className="mb-2 font-medium">{t("serves")}</legend>
              <p className="text-muted-foreground">{t("servesHint")}</p>
              {profile.serves.map((place, index) => (
                <fieldset key={index} className="min-w-0 space-y-2">
                  <legend className="mb-2">{t("serviceCity", { number: index + 1 })}</legend>
                  <CityFields
                    value={place}
                    disabled={disabled}
                    change={(next) =>
                      change({
                        ...profile,
                        serves: profile.serves.map((city, i) => (i === index ? next : city)),
                      })
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    className="min-h-11"
                    onClick={() =>
                      change({ ...profile, serves: profile.serves.filter((_, i) => i !== index) })
                    }
                  >
                    {t("removeServiceCity", { number: index + 1 })}
                  </Button>
                </fieldset>
              ))}
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={profile.serves.length >= 30}
                onClick={() =>
                  change({ ...profile, serves: [...profile.serves, { countryCode: "", city: "" }] })
                }
              >
                {t("addServiceCity")}
              </Button>
              <label className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  checked={profile.remote}
                  onChange={(event) => change({ ...profile, remote: event.target.checked })}
                  className="size-5 shrink-0 accent-primary"
                />
                {t("remote")}
              </label>
            </fieldset>
          </fieldset>
          <Button type="submit" className="min-h-11" disabled={busy || blocked}>
            {t(pending ? "retrySave" : "save")}
          </Button>
        </form>
      )}
      {!denied && state.result && (
        <CreatorCityGeocode
          key={`${userId}:${locale}:${state.result.version}`}
          version={state.result.version}
          disabled={disabled || JSON.stringify(profile) !== JSON.stringify(state.result.profile)}
          onDenied={state.failure}
        />
      )}
      <Button
        type="button"
        variant="outline"
        className="min-h-11"
        disabled={busy}
        onClick={() => void state.load(true)}
      >
        {t(state.result && !denied ? "discard" : "reload")}
      </Button>
    </section>
  );
}
