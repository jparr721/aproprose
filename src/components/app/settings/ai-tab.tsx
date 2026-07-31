import { useEffect, useState } from "react";
import { IconCheck, IconEye, IconEyeOff, IconTrash } from "@tabler/icons-react";
import { toast } from "sonner";
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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  TypographyForeground,
  TypographyMuted,
  TypographyMutedSpan,
} from "@/components/ui/typography";
import { Field } from "@/components/app/settings/field";
import { useSettingsStore } from "@/stores/settings-store";
import { hasOpenAiKey, setOpenAiKey } from "@/lib/tauri";
import { resetAiProvider } from "@/lib/ai/model";
import { listTextModels } from "@/lib/ai/models";
import { describeAiError } from "@/lib/ai/errors";
import { PREFERENCE_MAX_CHARS } from "@/lib/types";

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
        <InputGroup className="flex-1">
          <InputGroupInput
            type={show ? "text" : "password"}
            value={draft}
            onChange={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void save();
              }
            }}
            placeholder={configured ? "Replace stored key" : "sk-"}
            autoComplete="off"
            spellCheck={false}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              size="icon-xs"
              aria-label={show ? "Hide key" : "Show key"}
              title={show ? "Hide key" : "Show key"}
              onClick={() => setShow((s) => !s)}
            >
              {show ? <IconEyeOff /> : <IconEye />}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        <Button onClick={() => void save()} disabled={!draft.trim() || saving}>
          {saving ? <Spinner /> : null}
          Save
        </Button>
      </div>

      {configured ? (
        <div className="flex items-center justify-between">
          <TypographyForeground className="flex items-center gap-1.5 text-xs text-success">
            <IconCheck className="size-3.5" /> A key is configured.
          </TypographyForeground>
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
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove the OpenAI key?</AlertDialogTitle>
                <AlertDialogDescription>
                  The stored key is deleted from this machine. AI features stop working
                  until you add a key again.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep it</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => void clear()}>
                  Remove key
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ) : (
        <TypographyMuted className="text-xs">
          Stored locally in your app config dir - never written into the app bundle or your
          manuscript.
        </TypographyMuted>
      )}
    </Field>
  );
}

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
      setLoading(false);
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

  const options = aiModel && !models.includes(aiModel) ? [aiModel, ...models] : models;

  if (!keyConfigured) {
    return (
      <Field label="AI model">
        <TypographyMuted className="text-xs">
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
        <SelectTrigger className="w-full">
          <SelectValue placeholder={loading ? "Loading models" : "Select a model"} />
        </SelectTrigger>
        <SelectContent>
          {options.map((id) => (
            <SelectItem key={id} value={id}>
              {id}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {loading ? (
        <TypographyMutedSpan className="flex items-center gap-1.5 text-xs">
          <Spinner /> Loading models
        </TypographyMutedSpan>
      ) : null}
      {error ? (
        <TypographyForeground className="text-xs text-destructive">
          {error}
        </TypographyForeground>
      ) : null}
      {!loading && !error ? (
        <TypographyMuted className="text-xs">
          {aiModel ? `Using ${aiModel}.` : "AI features are off until you pick a model."}
        </TypographyMuted>
      ) : null}
    </Field>
  );
}

function PreferencesFields() {
  const styleGuide = useSettingsStore((s) => s.styleGuide);
  const editingRules = useSettingsStore((s) => s.editingRules);
  const setStyleGuide = useSettingsStore((s) => s.setStyleGuide);
  const setEditingRules = useSettingsStore((s) => s.setEditingRules);
  return (
    <>
      <Field label="Writing voice" hint={`${styleGuide.length}/${PREFERENCE_MAX_CHARS}`}>
        <Textarea
          value={styleGuide}
          onChange={(e) => setStyleGuide(e.currentTarget.value)}
          maxLength={PREFERENCE_MAX_CHARS}
          placeholder="Describe the voice the AI should write and edit in"
          className="min-h-24"
        />
        <TypographyMuted className="text-xs">Shapes every AI response.</TypographyMuted>
      </Field>
      <Field
        label="Writing and editing instructions"
        hint={`${editingRules.length}/${PREFERENCE_MAX_CHARS}`}
      >
        <Textarea
          value={editingRules}
          onChange={(event) => setEditingRules(event.currentTarget.value)}
          maxLength={PREFERENCE_MAX_CHARS}
          placeholder="Standing rules for drafting and revising - e.g. cut throat-clearing, no 'suddenly'"
          className="min-h-24"
        />
        <TypographyMuted className="text-xs">
          Applies to Writing and Edit.
        </TypographyMuted>
      </Field>
    </>
  );
}

export function AiTab() {
  const [keyConfigured, setKeyConfigured] = useState(false);

  useEffect(() => {
    void hasOpenAiKey()
      .then(setKeyConfigured)
      .catch((error) => {
        console.error("hasOpenAiKey failed:", error);
        setKeyConfigured(false);
      });
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <OpenAiKeyField
        configured={keyConfigured}
        onConfiguredChange={setKeyConfigured}
      />
      <AiModelField keyConfigured={keyConfigured} />
      <PreferencesFields />
    </div>
  );
}
