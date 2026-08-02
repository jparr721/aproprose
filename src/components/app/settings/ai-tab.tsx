import { useEffect, useRef, useState, type RefObject } from "react";
import { Check as IconCheck, Eye as IconEye, EyeOff as IconEyeOff, Trash as IconTrash } from "lucide-react";
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
import {
  failureFromError,
  settingsUnavailableFailure,
} from "@/lib/ai/agent-failure";
import type { AgentFailure } from "@/lib/ai/agent-types";
import { getAiKeyStatus, setAiKey, type AiKeyStatus } from "@/lib/tauri";
import { resetAiProvider } from "@/lib/ai/model";
import { listTextModels, resetModelMetadata } from "@/lib/ai/models";
import {
  isAiProvider,
  PREFERENCE_MAX_CHARS,
  type AiProvider,
} from "@/lib/types";
import { useSettingsDialogStore } from "@/stores/settings-dialog-store";

const providerLabels: Record<AiProvider, string> = {
  openai: "OpenAI",
  openrouter: "OpenRouter",
};

const providerKeyPlaceholders: Record<AiProvider, string> = {
  openai: "sk-",
  openrouter: "sk-or-v1-",
};

function ApiKeyField({
  provider,
  configured,
  failure,
  inputRef,
  onConfiguredChange,
  onRetry,
}: {
  provider: AiProvider;
  configured: boolean;
  failure: AgentFailure | null;
  inputRef: RefObject<HTMLInputElement | null>;
  onConfiguredChange: (configured: boolean) => void;
  onRetry: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const key = draft.trim();
    if (!key || saving) return;
    setSaving(true);
    try {
      const outcome = await setAiKey(provider, key);
      if (outcome.status === "failure") {
        toast.error(outcome.failure.message);
        return;
      }
      resetAiProvider();
      resetModelMetadata();
      setDraft("");
      setShow(false);
      onConfiguredChange(true);
      toast.success(`${providerLabels[provider]} key saved`);
    } catch {
      toast.error("AI settings are unavailable. Retry.");
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    try {
      const outcome = await setAiKey(provider, "");
      if (outcome.status === "failure") {
        toast.error(outcome.failure.message);
        return;
      }
      resetAiProvider();
      resetModelMetadata();
      onConfiguredChange(false);
      toast.success(`${providerLabels[provider]} key removed`);
    } catch {
      toast.error("AI settings are unavailable. Retry.");
    }
  };

  return (
    <Field label={`${providerLabels[provider]} key`}>
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
            placeholder={
              configured
                ? "Replace stored key"
                : providerKeyPlaceholders[provider]
            }
            autoComplete="off"
            spellCheck={false}
            ref={inputRef}
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
                <AlertDialogTitle>
                  Remove the {providerLabels[provider]} key?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  The stored key is deleted from this machine. This provider stops
                  working until you add a key again.
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
      {failure === null ? null : (
        <div className="flex items-center justify-between gap-2">
          <TypographyForeground className="text-xs text-destructive" role="alert">
            {failure.message}
          </TypographyForeground>
          <Button onClick={onRetry} size="sm" type="button" variant="outline">
            Retry
          </Button>
        </div>
      )}
    </Field>
  );
}

function ProviderField() {
  const aiProvider = useSettingsStore((state) => state.aiProvider);
  const setAiProvider = useSettingsStore((state) => state.setAiProvider);

  return (
    <Field label="AI provider">
      <Select
        value={aiProvider}
        onValueChange={(value) => {
          if (!isAiProvider(value)) {
            throw new Error(`Unsupported AI provider: ${value}`);
          }
          setAiProvider(value);
          resetAiProvider();
          resetModelMetadata();
        }}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="openai">OpenAI</SelectItem>
          <SelectItem value="openrouter">OpenRouter</SelectItem>
        </SelectContent>
      </Select>
    </Field>
  );
}

function AiModelField({
  provider,
  keyConfigured,
  modelRef,
  onLoadingChange,
}: {
  provider: AiProvider;
  keyConfigured: boolean;
  modelRef: RefObject<HTMLButtonElement | null>;
  onLoadingChange: (loading: boolean) => void;
}) {
  const aiModel = useSettingsStore((s) => s.aiModel);
  const setAiModel = useSettingsStore((s) => s.setAiModel);
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AgentFailure | null>(null);
  const [reload, setReload] = useState(0);

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
    listTextModels(provider)
      .then((m) => {
        if (active) setModels(m);
      })
      .catch((e) => {
        if (active) setError(failureFromError(e, provider, null));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [keyConfigured, provider, reload]);

  useEffect(() => {
    onLoadingChange(loading);
  }, [loading, onLoadingChange]);

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
        <SelectTrigger className="w-full" ref={modelRef}>
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
        <div className="flex items-center justify-between gap-2">
          <TypographyForeground className="text-xs text-destructive" role="alert">
            {error.message}
          </TypographyForeground>
          <Button
            onClick={() => setReload((value) => value + 1)}
            size="sm"
            type="button"
            variant="outline"
          >
            Retry
          </Button>
        </div>
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
  const aiProvider = useSettingsStore((state) => state.aiProvider);
  const aiTarget = useSettingsDialogStore((state) => state.aiTarget);
  const clearAiSettingsTarget = useSettingsDialogStore(
    (state) => state.clearAiSettingsTarget,
  );
  const keyInputRef = useRef<HTMLInputElement>(null);
  const modelTriggerRef = useRef<HTMLButtonElement>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [keyStatus, setKeyStatus] = useState<{
    provider: AiProvider;
    status: AiKeyStatus;
  } | null>(null);
  const activeKeyStatus =
    keyStatus?.provider === aiProvider ? keyStatus.status : null;
  const keyConfigured = activeKeyStatus?.status === "configured";
  const keyFailure =
    activeKeyStatus?.status === "unavailable"
      ? activeKeyStatus.failure
      : null;

  const refreshKeyStatus = (): void => {
    void getAiKeyStatus(aiProvider)
      .then((status) => {
        setKeyStatus({ provider: aiProvider, status });
      })
      .catch(() => {
        setKeyStatus({
          provider: aiProvider,
          status: {
            status: "unavailable",
            failure: settingsUnavailableFailure(),
          },
        });
      });
  };

  useEffect(() => {
    refreshKeyStatus();
  }, [aiProvider]);

  useEffect(() => {
    if (aiTarget === null || (aiTarget === "model" && modelsLoading)) return;
    const element = aiTarget === "key" ? keyInputRef.current : modelTriggerRef.current;
    if (element === null) return;
    const timeout = window.setTimeout(() => {
      const scrollable = element as HTMLButtonElement & {
        scrollIntoView?: (options: ScrollIntoViewOptions) => void;
      };
      if (scrollable.scrollIntoView !== undefined) {
        scrollable.scrollIntoView({ block: "nearest" });
      }
      element.focus();
      clearAiSettingsTarget();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [aiTarget, clearAiSettingsTarget, modelsLoading]);

  return (
    <div className="flex flex-col gap-6">
      <ProviderField />
      <ApiKeyField
        key={`key-${aiProvider}`}
        provider={aiProvider}
        configured={keyConfigured}
        failure={keyFailure}
        inputRef={keyInputRef}
        onConfiguredChange={(configured) =>
          setKeyStatus({
            provider: aiProvider,
            status: { status: configured ? "configured" : "missing" },
          })
        }
        onRetry={refreshKeyStatus}
      />
      <AiModelField
        key={`model-${aiProvider}`}
        keyConfigured={keyConfigured}
        modelRef={modelTriggerRef}
        onLoadingChange={setModelsLoading}
        provider={aiProvider}
      />
      <PreferencesFields />
    </div>
  );
}
