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
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
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
            placeholder={configured ? "Replace stored key" : "sk-"}
            autoComplete="off"
            spellCheck={false}
            className="pr-7 font-mono"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setShow((s) => !s)}
            title={show ? "Hide key" : "Show key"}
            className="absolute inset-y-0 right-0 text-muted-foreground"
          >
            {show ? <IconEyeOff /> : <IconEye />}
          </Button>
        </div>
        <Button size="sm" onClick={() => void save()} disabled={!draft.trim() || saving}>
          {saving ? <Spinner /> : null}
          Save
        </Button>
      </div>

      {configured ? (
        <div className="flex items-center justify-between">
          <TypographyForeground className="flex items-center gap-1.5 font-sans text-xs text-success">
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
            <AlertDialogContent className="font-sans">
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
        <TypographyMuted className="font-sans text-xs">
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
        <TypographyMutedSpan className="flex items-center gap-1.5 font-sans text-xs">
          <Spinner /> Loading models
        </TypographyMutedSpan>
      ) : null}
      {error ? (
        <TypographyForeground className="font-sans text-xs text-destructive">
          {error}
        </TypographyForeground>
      ) : null}
      {!loading && !error && !aiModel ? (
        <TypographyMuted className="font-sans text-xs">
          AI features are off until you pick a model.
        </TypographyMuted>
      ) : null}
    </Field>
  );
}

export function AiTab() {
  const [keyConfigured, setKeyConfigured] = useState(false);
  useEffect(() => {
    void hasOpenAiKey()
      .then(setKeyConfigured)
      .catch((e) => {
        console.error("hasOpenAiKey failed:", e);
        setKeyConfigured(false);
      });
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <OpenAiKeyField configured={keyConfigured} onConfiguredChange={setKeyConfigured} />
      <AiModelField keyConfigured={keyConfigured} />
    </div>
  );
}
