import { useEffect, useRef, useState, type ReactElement } from "react";
import { IconSparkles } from "@tabler/icons-react";
import { Field } from "@/components/app/settings/field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { TypographyForeground, TypographyMuted } from "@/components/ui/typography";
import { failureFromError } from "@/lib/ai/agent-failure";
import { refinePreference, type PreferenceField } from "@/lib/ai/refine-preference";
import { PREFERENCE_MAX_CHARS, type AiProvider } from "@/lib/types";
import { useSettingsDialogStore, type AiSettingsTarget } from "@/stores/settings-dialog-store";
import { useSettingsStore } from "@/stores/settings-store";

const FIELD_LABELS: Record<PreferenceField, string> = {
  styleGuide: "Writing voice",
  editingRules: "Writing and editing instructions",
};

type RefinementState =
  | { status: "idle" }
  | { status: "generating" }
  | { status: "ready"; source: string; text: string }
  | { status: "failed"; message: string; settingsTarget: AiSettingsTarget | null };

interface PreferenceAssistantFormProps {
  field: PreferenceField;
  provider: AiProvider;
  modelId: string | null;
  keyConfigured: boolean;
  onClose: () => void;
}

function PreferenceAssistantForm({
  field,
  provider,
  modelId,
  keyConfigured,
  onClose,
}: PreferenceAssistantFormProps): ReactElement {
  const value = useSettingsStore((state) => state[field]);
  const [request, setRequest] = useState("");
  const [refinement, setRefinement] = useState<RefinementState>({ status: "idle" });
  const controllerRef = useRef<AbortController | null>(null);
  const label = FIELD_LABELS[field];
  const generating = refinement.status === "generating";
  const stale = refinement.status === "ready" && refinement.source !== value;
  const configurationTarget: AiSettingsTarget | null = !keyConfigured
    ? "key"
    : modelId === null
      ? "model"
      : null;

  useEffect(() => {
    if (value.trim() && keyConfigured && modelId !== null) void generate();
    return () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, []);

  const openConfiguration = (target: AiSettingsTarget): void => {
    onClose();
    useSettingsDialogStore.getState().openAiSettings(target);
  };

  const generate = async (): Promise<void> => {
    if (modelId === null || !keyConfigured || generating) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const source = useSettingsStore.getState()[field];
    setRefinement({ status: "generating" });
    try {
      const text = await refinePreference(
        { field, current: source, request },
        { provider, modelId, signal: controller.signal },
      );
      if (controller.signal.aborted || controllerRef.current !== controller) return;
      setRefinement({ status: "ready", source, text });
    } catch (error: unknown) {
      if (controller.signal.aborted || controllerRef.current !== controller) return;
      const failure = failureFromError(error, provider, null);
      setRefinement({
        status: "failed",
        message: failure.message,
        settingsTarget: failure.settingsTarget,
      });
    }
  };

  const apply = (): void => {
    if (refinement.status !== "ready") return;
    const settings = useSettingsStore.getState();
    if (
      settings[field] !== refinement.source ||
      settings.aiProvider !== provider ||
      settings.aiModel !== modelId
    ) {
      setRefinement({
        status: "failed",
        message: "The preference or AI settings changed. Generate a new suggestion.",
        settingsTarget: null,
      });
      return;
    }
    const text = refinement.text.trim();
    if (text.length === 0 || text.length > PREFERENCE_MAX_CHARS) {
      setRefinement({
        status: "failed",
        message: `Enter between 1 and ${PREFERENCE_MAX_CHARS} characters before applying.`,
        settingsTarget: null,
      });
      return;
    }
    if (field === "styleGuide") settings.setStyleGuide(text);
    else settings.setEditingRules(text);
    onClose();
  };

  return (
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>Clarify {label.toLowerCase()}</DialogTitle>
        <DialogDescription>
          AI clarifies the text already in this field. Review the suggestion before replacing it.
        </DialogDescription>
      </DialogHeader>
      {value.trim() ? (
        <Field label="Current text">
          <Textarea aria-label="Current preference" value={value} readOnly className="min-h-20" />
        </Field>
      ) : null}
      <Field label={value.trim() ? "Additional direction (optional)" : "What should this say?"}>
        <Textarea
          aria-label="Your intent"
          value={request}
          onChange={(event) => {
            setRequest(event.currentTarget.value);
            setRefinement({ status: "idle" });
          }}
          disabled={generating}
          maxLength={PREFERENCE_MAX_CHARS}
          placeholder={field === "styleGuide"
            ? "Describe the tone, perspective, and details you want to preserve"
            : "Describe what to change, what to avoid, and what to preserve"}
          className="min-h-20"
        />
      </Field>
      {configurationTarget === null ? null : (
        <div className="flex items-center justify-between gap-2">
          <TypographyMuted>
            {configurationTarget === "key" ? "Add a provider key to use AI help." : "Choose a model to use AI help."}
          </TypographyMuted>
          <Button variant="outline" onClick={() => openConfiguration(configurationTarget)}>
            {configurationTarget === "key" ? "Configure key" : "Choose model"}
          </Button>
        </div>
      )}
      {refinement.status === "ready" ? (
        <Field label="Suggested text" hint={`${refinement.text.length}/${PREFERENCE_MAX_CHARS}`}>
          <Textarea
            aria-label="Suggested preference"
            value={refinement.text}
            onChange={(event) => {
              const text = event.currentTarget.value;
              setRefinement({ ...refinement, text });
            }}
            maxLength={PREFERENCE_MAX_CHARS}
            className="min-h-32"
          />
          {stale ? (
            <TypographyForeground role="alert" className="text-destructive">
              Your text changed. Generate a new suggestion to preserve your latest edits.
            </TypographyForeground>
          ) : null}
        </Field>
      ) : null}
      {refinement.status === "failed" ? (
        <div className="flex items-center justify-between gap-2">
          <TypographyForeground role="alert" className="text-destructive">
            {refinement.message}
          </TypographyForeground>
          {refinement.settingsTarget === null ? null : (
            <Button variant="outline" onClick={() => {
              if (refinement.settingsTarget !== null) openConfiguration(refinement.settingsTarget);
            }}>
              Open AI settings
            </Button>
          )}
        </div>
      ) : null}
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button
          variant="outline"
          disabled={configurationTarget !== null || generating || (!value.trim() && !request.trim())}
          onClick={() => void generate()}
        >
          {generating ? <Spinner /> : <IconSparkles />}
          {generating ? "Generating" : "Generate suggestion"}
        </Button>
        {refinement.status === "ready" ? (
          <Button disabled={stale || !refinement.text.trim()} onClick={apply}>Apply suggestion</Button>
        ) : null}
      </DialogFooter>
    </DialogContent>
  );
}

export function PreferenceAssistant({
  field,
  keyConfigured,
}: {
  field: PreferenceField;
  keyConfigured: boolean;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const provider = useSettingsStore((state) => state.aiProvider);
  const modelId = useSettingsStore((state) => state.aiModel);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" aria-label={`AI help for ${FIELD_LABELS[field].toLowerCase()}`}>
          <IconSparkles /> AI help
        </Button>
      </DialogTrigger>
      {open ? (
        <PreferenceAssistantForm
          key={`${provider}:${modelId}:${keyConfigured}`}
          field={field}
          provider={provider}
          modelId={modelId}
          keyConfigured={keyConfigured}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </Dialog>
  );
}
