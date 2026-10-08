import { useState } from "react";
import {
  IconBell,
  IconChevronRight,
  IconCircleCheck,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  TypographyEyebrow,
  TypographyMuted,
  TypographyP,
  TypographySmall,
} from "@/components/ui/typography";
import {
  NOTIFICATION_DEFINITIONS,
  type AppNotification,
} from "@/lib/notification-model";
import { useNotificationStore } from "@/stores/notification-store";
import { useProjectStore } from "@/stores/project-store";
import {
  SETTINGS_TABS,
  useSettingsDialogStore,
} from "@/stores/settings-dialog-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useStoryRefreshStore } from "@/stores/story-refresh-store";
import { useViewStore } from "@/stores/view-store";

function NotificationDetails({
  notification,
  onClose,
}: {
  notification: AppNotification;
  onClose: () => void;
}) {
  const definition = NOTIFICATION_DEFINITIONS[notification.type];
  const project = useProjectStore((state) => state.project);
  const refreshStatus = useStoryRefreshStore((state) => state.status);
  const currentProject =
    project !== null && project.root === notification.projectRoot;
  const resolve = useNotificationStore((state) => state.resolve);
  const action = definition.action;

  const openAction = (): void => {
    onClose();
    if (action === "key" || action === "model") {
      const settings = useSettingsStore.getState();
      if (
        notification.provider !== null &&
        settings.aiProvider !== notification.provider
      ) {
        settings.setAiProvider(notification.provider);
      }
      useSettingsDialogStore.getState().openAiSettings(action);
    } else if (action === "backup") {
      useSettingsDialogStore.getState().openWithTab(SETTINGS_TABS.BACKUP);
    } else if (action === "build-log") {
      useSettingsDialogStore.getState().setOpen(false);
      useViewStore.getState().setBuildErrorsOpen(true);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{definition.title}</DialogTitle>
          <DialogDescription>
            {notification.source} needs attention.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <TypographyEyebrow>How to fix</TypographyEyebrow>
            <TypographyP>{definition.steps}</TypographyP>
          </div>
          {notification.projectRoot === null ? null : (
            <div className="flex min-w-0 flex-col gap-1">
              <TypographyEyebrow>Project</TypographyEyebrow>
              <TypographyMuted className="break-all">
                {notification.projectRoot}
              </TypographyMuted>
              {currentProject ? null : (
                <TypographyMuted>
                  Open this project before retrying its action.
                </TypographyMuted>
              )}
            </div>
          )}
          {notification.provider === null ? null : (
            <TypographySmall>
              Provider:{" "}
              {notification.provider === "openai" ? "OpenAI" : "OpenRouter"}
            </TypographySmall>
          )}
          <TypographyMuted>
            {notification.occurrences} occurrence
            {notification.occurrences === 1 ? "" : "s"}. Last seen{" "}
            {new Date(notification.lastAt).toLocaleString()}.
          </TypographyMuted>
        </div>
        <DialogFooter className="flex-wrap">
          {notification.resolvedAt === null ? (
            <Button
              variant="outline"
              onClick={() => {
                resolve(notification.id);
                onClose();
              }}
            >
              Mark resolved
            </Button>
          ) : null}
          {notification.source === "Story refresh" && currentProject ? (
            <Button
              variant="outline"
              disabled={refreshStatus !== "failed"}
              onClick={() => {
                useStoryRefreshStore.getState().retry();
                onClose();
              }}
            >
              Retry story refresh
            </Button>
          ) : null}
          {action === null ? null : (
            <Button
              disabled={
                (action === "build-log" || action === "backup") &&
                notification.projectRoot !== null &&
                !currentProject
              }
              onClick={openAction}
            >
              {action === "key" || action === "model"
                ? "Open AI settings"
                : action === "backup"
                  ? "Open backup settings"
                  : "View build log"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function NotificationsTab() {
  const notifications = useNotificationStore((state) => state.notifications);
  const [resolved, setResolved] = useState(false);
  const [type, setType] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const types = [...new Set(notifications.map((item) => item.type))];
  const visible = notifications.filter(
    (item) =>
      (item.resolvedAt !== null) === resolved &&
      (type === "all" || item.type === type),
  );
  const selected = notifications.find((item) => item.id === selectedId);
  const pendingCount = notifications.filter(
    (item) => item.resolvedAt === null,
  ).length;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <TypographyEyebrow>Notifications</TypographyEyebrow>
        <TypographyP>
          Things that need your attention, with steps to fix them.
        </TypographyP>
        <TypographyMuted>
          {pendingCount} pending. Repeated issues are grouped. The latest 100
          issues are kept.
        </TypographyMuted>
      </div>
      <ButtonGroup>
        <Button
          variant={resolved ? "outline" : "default"}
          onClick={() => setResolved(false)}
        >
          Needs attention
        </Button>
        <Button
          variant={resolved ? "default" : "outline"}
          onClick={() => setResolved(true)}
        >
          Resolved
        </Button>
      </ButtonGroup>
      <Select value={type} onValueChange={setType}>
        <SelectTrigger aria-label="Notification type">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All error types</SelectItem>
          {types.map((key) => (
            <SelectItem key={key} value={key}>
              {NOTIFICATION_DEFINITIONS[key].title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {visible.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          {resolved ? (
            <IconBell className="size-6 text-muted-foreground" />
          ) : (
            <IconCircleCheck className="size-6 text-muted-foreground" />
          )}
          <TypographySmall>
            {resolved ? "No resolved notifications" : "Nothing needs attention"}
          </TypographySmall>
          <TypographyMuted>
            {type === "all"
              ? "App issues will appear here with steps to fix them."
              : "No notifications match this error type."}
          </TypographyMuted>
        </div>
      ) : (
        <ItemGroup>
          {visible.map((item) => (
            <Item key={item.id} variant="outline" asChild>
              <button
                type="button"
                className="text-left hover:bg-muted"
                onClick={() => setSelectedId(item.id)}
              >
                <ItemContent className="min-w-0">
                  <ItemTitle>
                    {NOTIFICATION_DEFINITIONS[item.type].title}
                  </ItemTitle>
                  <TypographyMuted>
                    {item.source}
                    {item.provider === null
                      ? ""
                      : ` - ${item.provider === "openai" ? "OpenAI" : "OpenRouter"}`}
                  </TypographyMuted>
                  {item.projectRoot === null ? null : (
                    <TypographyMuted className="truncate text-xs">
                      {item.projectRoot}
                    </TypographyMuted>
                  )}
                  <TypographyMuted className="text-xs">
                    {new Date(item.lastAt).toLocaleString()}
                  </TypographyMuted>
                </ItemContent>
                <ItemActions>
                  {item.occurrences > 1 ? (
                    <Badge variant="secondary">{item.occurrences} times</Badge>
                  ) : null}
                  <IconChevronRight className="size-4 text-muted-foreground" />
                </ItemActions>
              </button>
            </Item>
          ))}
        </ItemGroup>
      )}
      {selected === undefined ? null : (
        <NotificationDetails
          notification={selected}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
