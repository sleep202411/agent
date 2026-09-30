export function ProductionDocumentView({
  html,
  title,
  onError,
}: {
  html: string;
  title: string;
  onError: () => void;
}) {
  return (
    <iframe
      title={title}
      srcDoc={html}
      sandbox=""
      referrerPolicy="no-referrer"
      onError={onError}
      style={{ width: "100%", flex: 1, minHeight: 320, border: 0, background: "#0B0D12" }}
    />
  );
}
