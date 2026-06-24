// settings-sheet.tsx — the "Tweaks" of the prototype, rebuilt on shadcn.
//
// Theme, layout preset, block style, and prose size. The floating drag-panel of
// the design was a design-tool artifact; here it's a proper shadcn Sheet opened
// from the top bar's gear. Layout presets are applied through the view store.

import { useEffect, useState } from "react";
import {
  IconCheck,
  IconEye,
  IconEyeOff,
  IconSettings,
  IconTrash,
} from "@tabler/icons-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TypographyEyebrow, TypographyMuted } from "@/components/ui/typography";
import { KeybindingHint } from "@/components/app/keybinding-hint";
import { useKeybinding } from "@/hooks/use-keybinding";
import { KEYBINDINGS, KEYBINDING_IDS } from "@/lib/keybindings";
import { useSettingsStore } from "@/stores/settings-store";
import { useViewStore } from "@/stores/view-store";
import { useSyncStore } from "@/stores/sync-store";
import { hasOpenAiKey, setOpenAiKey, gitToolingStatus } from "@/lib/tauri";
import { resetAiProvider } from "@/lib/ai/model";
import { listTextModels } from "@/lib/ai/models";
import { describeAiError } from "@/lib/ai/errors";
import type { BlockStyle, LayoutMode, Theme, ToolingStatus } from "@/lib/types";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <TypographyEyebrow>{label}</TypographyEyebrow>
        {hint ? (
          <span className="font-sans text-xs tabular-nums text-faint">{hint}</span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/**
 * OpenAI key entry. The secret is written to the app-config dir on the Rust side
 * and is never read back into the UI — we only surface whether a key is set. The
 * cached AI provider is reset on every change so the next call uses the new key.
 */
function OpenAiKeyField({
  configured,
  onConfiguredChange,
}: {
  configured: boolean;
  onConfiguredChange: (configured: boolean) => void;
}) {
  const [draft, setDraft] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const key = draft.trim();
    if (!key || saving) return;
    setSaving(true);
    try {
      await setOpenAiKey(key);
      resetAiProvider();
      setDraft("");
      setShow(false);
      onConfiguredChange(true);
      toast.success("OpenAI key saved");
    } catch (e) {
      toast.error(`Couldn't save key: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    try {
      await setOpenAiKey("");
      resetAiProvider();
      onConfiguredChange(false);
      toast.success("OpenAI key removed");
    } catch (e) {
      toast.error(`Couldn't remove key: ${String(e)}`);
    }
  };

  return (
    <Field label="OpenAI key">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Input
            type={show ? "text" : "password"}
            value={draft}
            onChange={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void save();
              }
            }}
            placeholder={configured ? "Replace stored key…" : "sk-…"}
            autoComplete="off"
            spellCheck={false}
            className="pr-7 font-mono"
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            title={show ? "Hide key" : "Show key"}
            className="absolute inset-y-0 right-1.5 grid place-items-center text-faint transition-colors hover:text-foreground"
          >
            {show ? (
              <IconEyeOff className="size-3.5" />
            ) : (
              <IconEye className="size-3.5" />
            )}
          </button>
        </div>
        <Button
          size="sm"
          onClick={() => void save()}
          disabled={!draft.trim() || saving}
        >
          {saving ? <Spinner /> : null}
          Save
        </Button>
      </div>

      {configured ? (
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 font-sans text-xs text-success">
            <IconCheck className="size-3.5" /> A key is configured.
          </span>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
              >
                <IconTrash className="size-3.5" /> Remove
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="font-sans">
              <AlertDialogHeader>
                <AlertDialogTitle>Remove the OpenAI key?</AlertDialogTitle>
                <AlertDialogDescription>
                  The stored key is deleted from this machine. AI features stop
                  working until you add a key again.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep it</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => void clear()}
                >
                  Remove key
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ) : (
        <TypographyMuted className="font-sans text-xs">
          Stored locally in your app config dir — never written into the app
          bundle or your manuscript.
        </TypographyMuted>
      )}
    </Field>
  );
}

/**
 * Model picker. Lists the text-capable models available to the configured key
 * (fetched live from OpenAI through Rust) and persists the choice to the settings
 * store. Disabled until a key is configured; AI stays unusable until a model is
 * chosen (no default).
 */
function AiModelField({ keyConfigured }: { keyConfigured: boolean }) {
  const aiModel = useSettingsStore((s) => s.aiModel);
  const setAiModel = useSettingsStore((s) => s.setAiModel);
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!keyConfigured) {
      setModels([]);
      setError(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    listTextModels()
      .then((m) => {
        if (active) setModels(m);
      })
      .catch((e) => {
        if (active) setError(describeAiError(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [keyConfigured]);

  // Keep a stored selection visible even when it is not in the fetched list
  // (e.g. the key changed accounts), so the current choice still shows.
  const options =
    aiModel && !models.includes(aiModel) ? [aiModel, ...models] : models;

  if (!keyConfigured) {
    return (
      <Field label="AI model">
        <TypographyMuted className="font-sans text-xs">
          Add a key above to choose a model.
        </TypographyMuted>
      </Field>
    );
  }

  return (
    <Field label="AI model">
      <Select
        value={aiModel ?? undefined}
        onValueChange={(v) => setAiModel(v)}
        disabled={loading || options.length === 0}
      >
        <SelectTrigger className="w-full font-mono">
          <SelectValue placeholder={loading ? "Loading models" : "Select a model"} />
        </SelectTrigger>
        <SelectContent className="font-mono">
          {options.map((id) => (
            <SelectItem key={id} value={id}>
              {id}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {loading ? (
        <span className="flex items-center gap-1.5 font-sans text-xs text-muted-foreground">
          <Spinner /> Loading models
        </span>
      ) : null}
      {error ? (
        <span className="font-sans text-xs text-destructive">{error}</span>
      ) : null}
      {!loading && !error && !aiModel ? (
        <TypographyMuted className="font-sans text-xs">
          AI features are off until you pick a model.
        </TypographyMuted>
      ) : null}
    </Field>
  );
}

/** The one-line tooling status under the Backup heading; nothing until probed. */
function ToolingNotice({ tooling }: { tooling: ToolingStatus | null }) {
  if (!tooling) return null;
  const cls = "font-sans text-xs";
  if (!tooling.gitInstalled) {
    return <TypographyMuted className={cls}>git isn't installed — backup is unavailable.</TypographyMuted>;
  }
  if (!tooling.ghInstalled) {
    return (
      <TypographyMuted className={cls}>
        The GitHub CLI (gh) isn't installed — creating repos and name checks need it.
      </TypographyMuted>
    );
  }
  if (!tooling.ghAuthed) {
    return (
      <TypographyMuted className={cls}>
        Not signed in to GitHub — run <span className="font-mono">gh auth login</span>.
      </TypographyMuted>
    );
  }
  return (
    <TypographyMuted className={cls}>
      Signed in as <span className="font-mono">{tooling.login ?? "—"}</span>.
    </TypographyMuted>
  );
}

function BackupSyncField() {
  const autoSync = useSyncStore((s) => s.autoSync);
  const intervalMinutes = useSyncStore((s) => s.intervalMinutes);
  const isRepo = useSyncStore((s) => s.isRepo);
  const setAutoSync = useSyncStore((s) => s.setAutoSync);
  const setIntervalMinutes = useSyncStore((s) => s.setIntervalMinutes);
  const [tooling, setTooling] = useState<ToolingStatus | null>(null);

  useEffect(() => {
    void gitToolingStatus().then(setTooling).catch(() => setTooling(null));
  }, []);

  return (
    <Field label="Backup & sync">
      <ToolingNotice tooling={tooling} />

      <div className="flex items-center justify-between">
        <span className="font-sans text-sm">Auto-sync this project</span>
        <Switch checked={autoSync} disabled={!isRepo} onCheckedChange={setAutoSync} />
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="font-sans text-sm text-muted-foreground">Every</span>
          <span className="font-mono text-xs text-muted-foreground">{intervalMinutes} min</span>
        </div>
        <Slider
          min={1}
          max={60}
          step={1}
          value={[intervalMinutes]}
          onValueChange={([v]) => setIntervalMinutes(v)}
          disabled={!autoSync || !isRepo}
        />
      </div>
    </Field>
  );
}

export function SettingsSheet({ trigger }: { trigger?: React.ReactNode }) {
  // Open state is lifted to the view store so the command palette can open the
  // sheet too; the sidebar gear, Cmd/Ctrl+,, and the palette all drive one flag.
  // The controlled Sheet means the trigger still works.
  const open = useViewStore((s) => s.settingsOpen);
  const setOpen = useViewStore((s) => s.setSettingsOpen);
  useKeybinding(KEYBINDING_IDS.TOGGLE_SETTINGS, () => {
    const v = useViewStore.getState();
    v.setSettingsOpen(!v.settingsOpen);
  });

  const { theme, layout, blockStyle, proseSize } = useSettingsStore();
  const setTheme = useSettingsStore((s) => s.setTheme);
  const setLayout = useSettingsStore((s) => s.setLayout);
  const setBlockStyle = useSettingsStore((s) => s.setBlockStyle);
  const setProseSize = useSettingsStore((s) => s.setProseSize);
  const applyLayoutPreset = useViewStore((s) => s.applyLayoutPreset);

  const [keyConfigured, setKeyConfigured] = useState(false);
  useEffect(() => {
    void hasOpenAiKey()
      .then(setKeyConfigured)
      .catch(() => setKeyConfigured(false));
  }, []);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {trigger ?? (
          <Button variant="ghost" size="icon" className="font-sans" title="Settings">
            <IconSettings />
          </Button>
        )}
      </SheetTrigger>
      <SheetContent className="font-sans">
        <SheetHeader>
          <SheetTitle className="font-heading">Tweaks</SheetTitle>
          <SheetDescription>Appearance, layout, and your OpenAI key.</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-6 px-4 pb-6">
          <Field label="Color">
            <ToggleGroup
              type="single"
              value={theme}
              onValueChange={(v) => v && setTheme(v as Theme)}
              variant="outline"
              className="w-full"
            >
              <ToggleGroupItem value="light" className="flex-1">
                Light
              </ToggleGroupItem>
              <ToggleGroupItem value="sepia" className="flex-1">
                Sepia
              </ToggleGroupItem>
              <ToggleGroupItem value="dark" className="flex-1">
                Dark
              </ToggleGroupItem>
            </ToggleGroup>
          </Field>

          <Field label="Layout">
            <ToggleGroup
              type="single"
              value={layout}
              onValueChange={(v) => {
                if (!v) return;
                setLayout(v as LayoutMode);
                applyLayoutPreset(v as LayoutMode);
              }}
              variant="outline"
              className="w-full"
            >
              <ToggleGroupItem value="two" className="flex-1">
                2-pane
              </ToggleGroupItem>
              <ToggleGroupItem value="three" className="flex-1">
                3-pane
              </ToggleGroupItem>
              <ToggleGroupItem value="focus" className="flex-1">
                Focus
              </ToggleGroupItem>
            </ToggleGroup>
            <TypographyMuted className="font-sans text-xs">
              2-pane shows the AI panel · 3-pane adds the PDF · Focus hides both.
            </TypographyMuted>
          </Field>

          <Separator />

          <Field label="Block style">
            <ToggleGroup
              type="single"
              value={blockStyle}
              onValueChange={(v) => v && setBlockStyle(v as BlockStyle)}
              variant="outline"
              className="w-full"
            >
              <ToggleGroupItem value="typo" className="flex-1">
                Typographic
              </ToggleGroupItem>
              <ToggleGroupItem value="cards" className="flex-1">
                Cards
              </ToggleGroupItem>
            </ToggleGroup>
          </Field>

          <Field label="Prose size" hint={`${proseSize}px`}>
            <Slider
              min={14}
              max={22}
              step={0.5}
              value={[proseSize]}
              onValueChange={([v]) => setProseSize(v)}
            />
          </Field>

          <Separator />

          <OpenAiKeyField
            configured={keyConfigured}
            onConfiguredChange={setKeyConfigured}
          />

          <AiModelField keyConfigured={keyConfigured} />

          <Separator />

          <BackupSyncField />

          <Separator />

          <Field label="Keyboard">
            <div className="flex flex-col gap-2">
              {Object.values(KEYBINDINGS).map((kb) => (
                <div key={kb.id} className="flex items-center justify-between gap-3">
                  <span className="font-sans text-sm text-foreground">{kb.label}</span>
                  <KeybindingHint keybinding={kb} />
                </div>
              ))}
            </div>
            <TypographyMuted className="mt-1 font-sans text-xs">
              Highlight text in a block to convert or isolate the selection.
            </TypographyMuted>
          </Field>
        </div>
      </SheetContent>
    </Sheet>
  );
}
