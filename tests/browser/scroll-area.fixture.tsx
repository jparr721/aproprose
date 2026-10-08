import { createRoot } from "react-dom/client";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import "@/index.css";

const direction = new URL(window.location.href).searchParams.get("dir");
if (direction !== "ltr" && direction !== "rtl") {
  throw new Error("The scroll-area fixture requires dir=ltr or dir=rtl");
}

const host = document.getElementById("root");
if (host === null) throw new Error("Missing scroll-area fixture root");

createRoot(host).render(
  <div className="flex flex-wrap items-start gap-8 p-8">
    {[
      { name: "fixed", className: "h-48 w-80" },
      { name: "existing-padding", className: "h-48 w-80 pr-3" },
      { name: "both-axes", className: "h-48 w-80" },
    ].map(({ name, className }) => (
      <ScrollArea key={name} dir={direction} className={className} type="always" data-testid={name}>
        <div className={name === "both-axes" ? "h-96 w-[720px]" : "h-96 w-full"}>
          <button className="w-full border">{name}</button>
        </div>
        {name === "both-axes" && <ScrollBar orientation="horizontal" />}
      </ScrollArea>
    ))}
    <div className="flex h-48 w-80 flex-col">
      <ScrollArea dir={direction} className="min-h-0 flex-1" type="always" data-testid="flex">
        <div className="h-96 w-full">Flex content</div>
      </ScrollArea>
    </div>
    <ScrollArea dir={direction} className="h-48 w-80" type="auto" data-testid="overflow-toggle">
      <div className="h-24 w-full" data-testid="resizable-content">Resizable content</div>
    </ScrollArea>
    <ScrollArea dir={direction} className="w-80" type="auto" data-testid="auto-height">
      <div className="h-24 w-full">Auto-height content</div>
    </ScrollArea>
  </div>,
);
