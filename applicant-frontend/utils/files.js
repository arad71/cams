// utils/files.js (or inside DocumentList)
export async function fetchDocumentBlob({ appId, docId, token, apiBase = "http://localhost:8000/api" }) {
  const res = await fetch(`${apiBase}/applications/${appId}/documents/${docId}/file`, {
    method: "GET",
    headers: token ? { "Authorization": `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to fetch document: ${res.status} ${text}`);
  }
  // Grab metadata
  const contentType = res.headers.get("Content-Type") || "application/octet-stream";
  const dispo = res.headers.get("Content-Disposition") || "";
  const fileName = (dispo.match(/filename\*=UTF-8''([^;]+)/)?.[1] && decodeURIComponent(dispo.match(/filename\*=UTF-8''([^;]+)/)[1]))
                || (dispo.match(/filename="?([^"]+)"?/)?.[1])
                || `document-${docId}`;
  const blob = await res.blob();
  return { blob, contentType, fileName };
}

export function openBlobInNewTab(blob, fallbackName = "file") {
  const url = URL.createObjectURL(blob);
  // Try to open; if popup blocked, fall back to download
  const win = window.open(url, "_blank", "noopener,noreferrer");
  if (!win) {
    const a = document.createElement("a");
    a.href = url;
    a.download = fallbackName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  // Revoke later to avoid revoking while open
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function downloadBlob(blob, fileName = "download") {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}