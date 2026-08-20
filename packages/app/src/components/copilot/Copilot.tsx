import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../../store/app-store";
import type { CopilotThreadEntry } from "../../store/app-store";
import { useSettingsState } from "../../settings/settings-state.js";

/**
 * specs/ux-copilot.md UX-1000..1011: the Copilot tab's real content --
 * context row (UX-1001/1002), thread (UX-1003), proposal cards
 * (UX-1004..1007/1010), history integration is the store's job
 * (UX-1008, `acceptCopilotProposal`), and the composer (UX-1011). UX-1012:
 * a small provider indicator naming the active `AgentService` provider,
 * with a link into `specs/ux-settings.md`'s settings dialog to change it.
 */
export function Copilot(): JSX.Element {
  const document = useAppStore((s) => s.document);
  const activeProvider = useSettingsState((s) => s.provider);
  const activeModel = useSettingsState((s) => s.model);
  const activeBaseUrl = useSettingsState((s) => s.baseUrl);
  const openSettings = useSettingsState((s) => s.open);
  const contextChips = useAppStore((s) => s.copilotContextChips);
  const thread = useAppStore((s) => s.copilotThread);
  const prompt = useAppStore((s) => s.copilotPrompt);
  const setPrompt = useAppStore((s) => s.setCopilotPrompt);
  const sendPrompt = useAppStore((s) => s.sendCopilotPrompt);
  const removeChip = useAppStore((s) => s.removeCopilotContextChip);
  const addChip = useAppStore((s) => s.addCopilotContextChip);
  const acceptProposal = useAppStore((s) => s.acceptCopilotProposal);
  const rejectProposal = useAppStore((s) => s.rejectCopilotProposal);
  const toggleExpanded = useAppStore((s) => s.toggleCopilotProposalExpanded);
  const startTryInPlay = useAppStore((s) => s.startTryInPlay);
  const stopTryInPlay = useAppStore((s) => s.stopTryInPlay);
  const tryInPlayEntryId = useAppStore((s) => s.tryInPlayEntryId);
  const selectedNodeIndex = useAppStore((s) => s.selectedNodeIndex);
  const selectedGraphIndex = useAppStore((s) => s.selectedGraphIndex);
  const selectedAsset = useAppStore((s) => s.selectedAsset);
  const focusSeq = useAppStore((s) => s.copilotComposerFocusSeq);

  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  // UX-1009/inline "✦" affordances: an inline affordance elsewhere in the
  // shell bumps `copilotComposerFocusSeq` after switching to this tab and
  // adding its chip -- autofocus the composer once that happens.
  useEffect(() => {
    if (focusSeq > 0) textareaRef.current?.focus();
  }, [focusSeq]);

  // Keep the thread scrolled to the newest message/card.
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [thread]);

  if (!document) {
    return (
      <div className="copilot-panel" data-testid="copilot.panel">
        <div className="empty-note" data-testid="copilot.empty">
          Import a .glb to start a Copilot conversation.
        </div>
      </div>
    );
  }

  function send(): void {
    if (!prompt.trim()) return;
    void sendPrompt();
  }

  const json = document.json as { extensions?: { KHR_interactivity?: { graphs?: unknown[] } } };
  const graphCount = json.extensions?.KHR_interactivity?.graphs?.length ?? 0;

  const providerLabel =
    activeProvider === "mock" ? "Mock" : `Local model${activeModel ? ` (${activeModel})` : ` (${activeBaseUrl})`}`;

  return (
    <div className="copilot-panel" data-testid="copilot.panel">
      <div className="copilot-provider-indicator" data-testid="copilot.provider-indicator">
        Provider: {providerLabel}
        <button type="button" className="copilot-provider-indicator-link" data-testid="copilot.provider-indicator.settings-link" onClick={openSettings}>
          Settings
        </button>
      </div>
      <div className="copilot-context-row" data-testid="copilot.context">
        {contextChips.map((chip) => (
          <span className="copilot-chip" data-testid={`copilot.context.chip.${chip.id}`} key={chip.id}>
            {chip.label}
            <button type="button" data-testid={`copilot.context.chip.${chip.id}.remove`} title="Remove context" onClick={() => removeChip(chip.id)}>
              ✕
            </button>
          </span>
        ))}
        <div className="copilot-context-add-wrap">
          <button className="btn small" data-testid="copilot.context.add" onClick={() => setAddMenuOpen((v) => !v)}>
            + Add context
          </button>
          {addMenuOpen && (
            <div className="copilot-context-add-menu" data-testid="copilot.context.add-menu">
              {selectedNodeIndex !== null ? (
                <button
                  type="button"
                  data-testid="copilot.context.add-menu.selection"
                  onClick={() => {
                    setAddMenuOpen(false);
                    addChip({ kind: "explicit", label: `Node #${selectedNodeIndex}`, pointer: `/nodes/${selectedNodeIndex}` }, `Node #${selectedNodeIndex}`);
                  }}
                >
                  Current selection
                </button>
              ) : null}
              {graphCount > 0 ? (
                <button
                  type="button"
                  data-testid="copilot.context.add-menu.graph"
                  onClick={() => {
                    setAddMenuOpen(false);
                    addChip(
                      { kind: "explicit", label: `Graph ${selectedGraphIndex}`, pointer: `/extensions/KHR_interactivity/graphs/${selectedGraphIndex}` },
                      `Graph ${selectedGraphIndex}`
                    );
                  }}
                >
                  Current graph
                </button>
              ) : null}
              {selectedAsset ? (
                <button
                  type="button"
                  data-testid="copilot.context.add-menu.asset"
                  onClick={() => {
                    setAddMenuOpen(false);
                    const pointer = `/${selectedAsset.tab}/${selectedAsset.index}`;
                    addChip({ kind: "explicit", label: pointer, pointer }, pointer);
                  }}
                >
                  Selected asset
                </button>
              ) : null}
              {selectedNodeIndex === null && graphCount === 0 && !selectedAsset ? (
                <div className="empty-note">Nothing to attach yet.</div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <div className="copilot-thread" id="copilot-thread" data-testid="copilot.thread" ref={threadRef}>
        {thread.length === 0 ? (
          <div className="empty-note" data-testid="copilot.thread.empty">
            Ask Copilot to spin a node, move something, wire up a click sound, or generate a few cubes.
          </div>
        ) : (
          thread.map((entry) => (
            <ThreadEntryView
              key={entry.id}
              entry={entry}
              onAccept={() => acceptProposal(entry.id)}
              onReject={() => rejectProposal(entry.id)}
              onToggleExpanded={() => toggleExpanded(entry.id)}
              onTryInPlay={() => (tryInPlayEntryId === entry.id ? void stopTryInPlay() : void startTryInPlay(entry.id))}
              isPreviewing={tryInPlayEntryId === entry.id}
            />
          ))
        )}
      </div>

      <div className="copilot-composer" data-testid="copilot.composer">
        <textarea
          ref={textareaRef}
          data-testid="copilot.composer.input"
          placeholder='Ask Copilot… e.g. "spin the selected node" or "add 3 cubes"'
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="copilot-composer-actions">
          <button className="btn primary small" data-testid="copilot.composer.send" disabled={!prompt.trim()} onClick={send}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

function ThreadEntryView({
  entry,
  onAccept,
  onReject,
  onToggleExpanded,
  onTryInPlay,
  isPreviewing
}: {
  entry: CopilotThreadEntry;
  onAccept: () => void;
  onReject: () => void;
  onToggleExpanded: () => void;
  onTryInPlay: () => void;
  isPreviewing: boolean;
}): JSX.Element {
  if (entry.kind === "user") {
    return (
      <div className="copilot-msg copilot-msg-user" data-testid={`copilot.thread.user.${entry.id}`}>
        {entry.text}
      </div>
    );
  }
  if (entry.kind === "pending") {
    return (
      <div className="copilot-msg copilot-msg-pending" data-testid={`copilot.thread.pending.${entry.id}`}>
        Thinking…
      </div>
    );
  }
  if (entry.kind === "refusal") {
    return (
      <div className="copilot-msg copilot-msg-assistant" data-testid={`copilot.thread.refusal.${entry.id}`}>
        {entry.text}
      </div>
    );
  }

  // entry.kind === "proposal" (UX-1004..1007/1010)
  const { proposal } = entry;
  const hasErrorFinding = proposal.validationReport.findings.some((f) => f.severity === "error");
  const equivChecks = proposal.validationReport.equivChecks;
  const equivBadge = !equivChecks || equivChecks.length === 0 ? "EQUIV: n/a" : equivChecks.every((c) => c.equivalent) ? "EQUIV: pass" : "EQUIV: fail";
  const equivBadgeClass = !equivChecks || equivChecks.length === 0 ? "" : equivChecks.every((c) => c.equivalent) ? "copilot-badge-ok" : "copilot-badge-error";

  return (
    <div className="copilot-proposal-card" data-testid={`copilot.proposal.${entry.id}`}>
      <div className="copilot-proposal-summary">
        <span>{proposal.summary}</span>
        <button className="copilot-proposal-toggle" data-testid={`copilot.proposal.${entry.id}.toggle`} onClick={onToggleExpanded}>
          {entry.expanded ? "Hide commands ▾" : `Show ${proposal.commands.length} command${proposal.commands.length === 1 ? "" : "s"} ▸`}
        </button>
      </div>

      <div className="copilot-badge-row" data-testid={`copilot.proposal.${entry.id}.badges`}>
        <span className={`copilot-badge ${hasErrorFinding ? "copilot-badge-error" : "copilot-badge-ok"}`} data-testid={`copilot.proposal.${entry.id}.badge.validation`}>
          {hasErrorFinding ? "Validation: errors" : "Validation: passed"}
        </span>
        <span className={`copilot-badge ${equivBadgeClass}`} data-testid={`copilot.proposal.${entry.id}.badge.equiv`}>
          {equivBadge}
        </span>
        <span className="copilot-badge" data-testid={`copilot.proposal.${entry.id}.badge.commands`}>
          {proposal.commands.length} command{proposal.commands.length === 1 ? "" : "s"}
        </span>
      </div>

      {entry.expanded && (
        <ul className="copilot-command-list" data-testid={`copilot.proposal.${entry.id}.commands`}>
          {proposal.commands.map((command) => (
            <li key={command.id}>{command.label}</li>
          ))}
        </ul>
      )}

      {hasErrorFinding && (
        <ul className="copilot-command-list" data-testid={`copilot.proposal.${entry.id}.findings`}>
          {proposal.validationReport.findings
            .filter((f) => f.severity === "error")
            .map((f, i) => (
              <li key={i}>{f.message}</li>
            ))}
        </ul>
      )}

      {proposal.generatedAssets && proposal.generatedAssets.length > 0 && (
        <div className="copilot-asset-row" data-testid={`copilot.proposal.${entry.id}.assets`}>
          {proposal.generatedAssets.map((asset, i) => (
            <span className="copilot-asset-swatch" key={i} data-testid={`copilot.proposal.${entry.id}.asset.${i}`} title={asset.provenance}>
              <span className="swatch-dot" />
              {asset.kind}: {asset.pointers.join(", ")}
            </span>
          ))}
        </div>
      )}

      <div className="copilot-action-row" data-testid={`copilot.proposal.${entry.id}.actions`}>
        {entry.state === "pending" && (
          <>
            <button className="btn small primary" data-testid={`copilot.proposal.${entry.id}.accept`} onClick={onAccept}>
              Accept
            </button>
            <button className="btn small" data-testid={`copilot.proposal.${entry.id}.reject`} onClick={onReject}>
              Reject
            </button>
          </>
        )}
        {entry.state === "accepted" && (
          <span className="copilot-status-tag applied" data-testid={`copilot.proposal.${entry.id}.status`}>
            ✓ Applied
          </span>
        )}
        {entry.state === "rejected" && (
          <span className="copilot-status-tag rejected" data-testid={`copilot.proposal.${entry.id}.status`}>
            Rejected
          </span>
        )}
        {/* UX-1007: Try in play is ALWAYS available, regardless of pending/accepted/rejected. */}
        <button className="btn small" data-testid={`copilot.proposal.${entry.id}.try-in-play`} onClick={onTryInPlay}>
          {isPreviewing ? "Stop preview" : "Try in play"}
        </button>
      </div>
    </div>
  );
}
