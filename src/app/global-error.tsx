"use client";

/** Last-resort boundary if the root layout itself fails. Must render its own <html>. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#f3f5f7", color: "#16233a", padding: "64px 24px" }}>
        <div style={{ maxWidth: 520, margin: "0 auto" }}>
          <h1 style={{ fontSize: 28, margin: 0 }}>Store register is having trouble</h1>
          <p style={{ color: "#3a4863" }}>Reload the page in a moment. If it keeps happening, tell your admin.</p>
          <button onClick={reset} style={{ marginTop: 16, padding: "8px 14px", background: "#16233a", color: "#fff", border: 0, borderRadius: 4 }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
