import type { CertificateDownload } from "./download-certificate";
export async function saveCertificate(file: CertificateDownload, current: () => boolean) {
  if (!current()) return;
  const url = URL.createObjectURL(new Blob([new Uint8Array(file.bytes)], { type: file.mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.filename;
  try {
    document.body.appendChild(link);
    if (current()) link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
