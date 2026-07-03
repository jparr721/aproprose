// muse-tab.tsx -- the Muse agent tab. P3.1 shell: registers the tab so the
// rail, palette, and typecheck all know it; the directive composer, activity
// feed, and staging wiring land with the agent core (P3.4).

import { IconWand } from "@tabler/icons-react";
import { PanelEmpty } from "@/components/app/right-panel/shared";

export function MuseTab() {
  return (
    <PanelEmpty icon={IconWand} title="Muse">
      Give Muse a directive and it reads the chapter, gathers what it needs, and
      stages a reviewable set of changes in the Edit tab.
    </PanelEmpty>
  );
}
