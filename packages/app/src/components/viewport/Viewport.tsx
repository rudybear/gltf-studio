import { useAppStore } from "../../store/app-store";

/**
 * Center viewport region (specs/ux-shell.md UX-100). Rendering itself is
 * out of scope here — engine-three (RenderHost, specs/render-host.md) is
 * being built concurrently and this package deliberately does not depend
 * on it. `#viewport-mount` is the hand-off point: whenever engine-three
 * lands, it mounts its canvas into this div instead of the placeholder note.
 */
export function Viewport(): JSX.Element {
  const document = useAppStore((s) => s.document);

  return (
    <div id="viewport" data-testid="viewport.panel">
      <div id="viewport-mount" data-testid="viewport.mount">
        <p className="viewport-placeholder-note" data-testid="viewport.placeholder-note">
          {document ? "Viewport engine loads here (engine-three, arriving separately)." : "Import a .glb to get started."}
        </p>
      </div>
    </div>
  );
}
