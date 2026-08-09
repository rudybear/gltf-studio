export function Placeholder({ testId, text }: { testId: string; text: string }): JSX.Element {
  return (
    <div className="dock-placeholder" data-testid={testId}>
      {text}
    </div>
  );
}
