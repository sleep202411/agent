# DESIGN.md — Frontend Design Conventions

Single source of truth for shared UI patterns across `apps/web`. New
features should match an existing pattern here before inventing a new
one. When two patterns disagree, **the canonical reference is whichever
file is named below** (e.g. `CreateIPDialog` for the create-dialog
pattern); update both this doc and the second instance to align.

## Table of contents

- [Create dialog conventions](#create-dialog-conventions)
- [Form fields](#form-fields)
- [Error toasts](#error-toasts)
- [File uploads](#file-uploads)
- [State reset on close](#state-reset-on-close)
- [Submit button states](#submit-button-states)
- [i18n key placement](#i18n-key-placement)

---

## Create dialog conventions

**Canonical reference:** `apps/web/app/(site)/ips/_components/create-ip-dialog.tsx`

Every "create entity" dialog (Create IP, Create Crew, Create Episode,
Create Project, …) must match this skeleton so the platform feels
consistent:

```tsx
<Dialog open={open} onOpenChange={onOpenChange}>
  <DialogContent className="overflow-hidden p-0 sm:max-w-lg">
    <DialogHero
      src={HERO_IMG_URL}
      eyebrow="STORYOS / SECTION"
      title={t("dialogTitle")}
      description={t("dialogSubtitle")}
    />
    <DialogBody>
      <FieldGroup>
        <Field>
          <FieldLabel required>{t("fieldX")}</FieldLabel>
          <Input value={…} onChange={…} placeholder={…} maxLength={…} />
        </Field>
        {/* … more <Field> rows … */}
      </FieldGroup>
    </DialogBody>
    <DialogFooter>
      <Button variant="outline" color="muted" onClick={…} disabled={submitting}>
        {tc("cancel")}
      </Button>
      <Button onClick={handleCreate} disabled={!canSubmit}>
        {submitting ? <IconLoader2 className="size-4 animate-spin" /> : null}
        {submitting ? t("submitting") : t("submit")}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

**Hard rules:**

1. **`<DialogContent className="overflow-hidden p-0 sm:max-w-lg">`** —
   `overflow-hidden` + `p-0` are required so `<DialogHero>` bleeds to
   the rounded corners of the content. `sm:max-w-lg` is the default
   width; override only with explicit reason.
2. **Always start with `<DialogHero>`** — eyebrow + title + description
   over a hero image. The hero image lives on the static CDN
   (`https://static.fizzspace.cn/static/pc/...`) and is `encodeURI`'d
   because filenames contain spaces / CJK. Use the same CDN-hosted
   illustration across creation dialogs unless product gives a
   feature-specific one.
3. **Use `<DialogBody>` + `<FieldGroup>` + `<Field>`** — never raw
   `<div>` stacks. The primitives encode the spacing, label sizing,
   required-marker behaviour. See `components/ui/field.tsx` and
   `components/ui/dialog.tsx` for the contracts.
4. **`<DialogFooter>` always has a Cancel and a primary action**.
   Cancel is `variant="outline" color="muted"`; primary action is the
   default `<Button>`. Cancel is disabled while submitting.
5. **Eyebrow text is short, all-caps, slash-separated** —
   `STORYOS / IP`, `STORYOS / CREW`, etc. See existing translations.

**Multi-step variant:** when the form is too long for one screen,
split with `step` state ∈ `1 | 2 | …`. Each step gets its own
`<DialogBody>` + `<DialogFooter>`. Footer of intermediate steps shows
"Previous / Next"; the final step shows "Previous / Submit".
`<DialogHero>` stays mounted across steps so the title doesn't flash.

---

## Form fields

**Canonical reference:** `components/ui/field.tsx`

- Always wrap in `<Field>`. Never put a `<label>` directly next to an
  `<Input>`.
- Always use `<FieldLabel required>` for required fields — the marker
  styling is part of the primitive, not a manual `*` you sprinkle
  yourself.
- For "AI-suggested" fields, render `<AiSuggestedChip>` inside the
  label so the chip aligns with the label text (don't put it in a
  separate row).
- Multi-line inputs are `<Textarea className="max-h-40 overflow-y-auto">` —
  cap the auto-grow so a long paste doesn't push buttons off-screen.
- `maxLength` on text inputs is REQUIRED — pick a sensible cap per
  field semantics. 60 for names, 500 for descriptions, 120 for org /
  location strings.

---

## Error toasts

**Canonical reference:** the `catch (err)` block in
`apps/web/app/(site)/profile/experience-dialog.tsx`

When a backend mutation fails, **always surface the raw HTTP status +
response body** rather than a generic "request failed" message:

```tsx
} catch (err) {
  if (err instanceof ApiRequestError) {
    toast.error(`HTTP ${err.status}`, {
      description: err.responseBody?.slice(0, 1000) || err.message,
      duration: 10000,
    });
  } else {
    toast.error(err instanceof Error ? err.message : String(err), {
      duration: 10000,
    });
  }
}
```

Why:

- Backend errors carry actionable context (validation messages, auth
  state, field-level rejections). Hiding them behind a generic toast
  forces users to ping eng for every failure.
- The default 4-second toast is too short for users to read a long
  response body — bump to 10 seconds for error toasts.
- Cap the response body at ~1000 chars so large HTML error pages
  don't overflow the toast layout.

**Don't** write `catch { toast.error(t("genericFailed")) }` — it
silently swallows the diagnostic info.

---

## File uploads

**Canonical reference:** `apps/web/app/(site)/ips/_hooks/uploads.ts`

- For banner / avatar images: use the existing `uploadBanner(file)`
  from `@/src/services/user` (it hits `/project/uploadBanner`,
  generic across modules) or write a feature-private wrapper if
  you need the two-step signed-URL → OSS PUT flow.
- For domain-specific uploads (episode video, project banner,
  scene reference), each feature owns its own upload helpers in
  `_hooks/uploads.ts` per the AGENTS.md "feature-private wins" rule.
- Hidden `<input type="file" ref={ref}>` triggered by clicking a
  styled button. **Always reset `event.target.value = ""`** after
  reading the file so the same filename can be picked again after a
  failed upload — without this, `onChange` won't fire on re-pick.
- Image previews use `aspect-video` containers with `object-cover`.
  The button-styled dropzone is `cursor-wait opacity-60` while
  uploading.
- Show `<IconLoader2 className="animate-spin" />` while uploading;
  swap back to the picker icon on idle.

---

## State reset on close

Every dialog with form state must reset on close:

```tsx
useEffect(() => {
  if (open) return; // only run on close
  setName("");
  setDescription("");
  // ... reset all stateful fields, abort any in-flight request
}, [open]);
```

Why: a dialog opened twice in a row should never show stale values
from the previous attempt. Especially important after a failed submit
— the user expects "cancel" + reopen to be a fresh slate.

---

## Submit button states

The primary action button:

```tsx
<Button onClick={handleSubmit} disabled={!canSubmit}>
  {submitting ? <IconLoader2 className="size-4 animate-spin" /> : null}
  {submitting ? t("submitting") : t("submit")}
</Button>
```

- `canSubmit` checks: form is valid + no upload in flight + not
  already submitting.
- Spinner icon appears INSIDE the button (left of the label) — never
  in a separate "loading overlay".
- Label changes to a "-ing" form during submit (`Creating...`,
  `Saving...`) — gives users feedback the click landed.

The cancel button stays clickable until the success callback fires —
users sometimes want to bail out mid-request.

---

## i18n key placement

**Canonical reference:** `apps/web/messages/en-US.json`

- Each feature gets its own top-level namespace (`crew`, `ip`,
  `profile`, `produce`, `ipEdit`, `ipCreate`, …).
- Dialog-specific keys go in the parent feature's namespace, not a
  separate `crewCreate` namespace — keep one namespace per surface.
- Always update **all three** locale files in the same commit:
  `en-US.json` / `zh-CN.json` / `zh-HK.json`. zh-HK is traditional;
  don't paste zh-CN content into it.
- New strings default to **English-first** (per memory
  `feedback_english_first_ui.md`) — even when editing a Chinese-heavy
  file, source new strings as English with the Chinese variant as a
  translation. Do not introduce new Chinese string literals into JSX.

---

## When this doc is wrong

If you find a place where the codebase contradicts this doc, the
codebase wins for the existing case but **fix this doc, the
contradicting file, or both** in the same PR. This document is a
living spec, not an archive — drift is the enemy.

Last updated 2026-05-08, after refactoring `CreateCrewDialog` to match
`CreateIPDialog` conventions.
