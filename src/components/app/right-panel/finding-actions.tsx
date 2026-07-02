// finding-actions.tsx - the action row on an anchored critique/continuity card:
// jump to the first block that still resolves, and hand the finding to the Edit
// tab as an instruction (via the AI intent seam). Stale anchors are tolerated -
// the jump only offers itself when at least one id resolves to a live block.

import { IconArrowRight, IconPencil } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { scrollBlockIntoView } from "@/components/app/editor";
import { useProjectStore } from "@/stores/project-store";
import { dispatchAiIntent } from "@/stores/ai-intent-store";

export function FindingActions({
  blockIds,
  instruction,
}: {
  /** The finding's anchors; [] for a scene-level finding. */
  blockIds: string[];
  /** The finding text, handed to Edit as the prefilled instruction. */
  instruction: string;
}) {
  const blocks = useProjectStore((s) => s.blocks);
  const setSelection = useProjectStore((s) => s.setSelection);
  const liveId = blockIds.find((id) => blocks.some((b) => b.id === id));
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {liveId ? (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => {
            setSelection([liveId]);
            scrollBlockIntoView(liveId);
          }}
        >
          <IconArrowRight /> Go to block
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground"
        onClick={() =>
          dispatchAiIntent({
            tab: "edit",
            instruction,
            blockIds,
            scope: blockIds.length ? "block" : "chapter",
          })
        }
      >
        <IconPencil /> Send to Edit
      </Button>
    </div>
  );
}
