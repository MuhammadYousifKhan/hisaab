'use client';
import { useRef, useState } from 'react';

export default function CopySummary({ text, label, copied, fallback }: { text: string; label: string; copied: string; fallback: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const pre = useRef<HTMLPreElement>(null);
  function selectText() {
    setShow(true);
    setMsg(fallback);
    requestAnimationFrame(() => {
      if (!pre.current) return;
      const r = document.createRange();
      r.selectNodeContents(pre.current);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(r);
    });
  }
  function copy() {
    try {
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => setMsg(copied), selectText);
      else selectText();
    } catch { selectText(); }
  }
  return (
    <>
      <button type="button" className="btn full" onClick={copy}>{label}</button>
      {msg && <p className="muted" role="status">{msg}</p>}
      <pre ref={pre} className="raw" dir="auto" hidden={!show}>{text}</pre>
    </>
  );
}
