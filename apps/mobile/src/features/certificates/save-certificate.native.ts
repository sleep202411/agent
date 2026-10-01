import { Directory, File, Paths } from "expo-file-system";
import { isAvailableAsync, shareAsync } from "expo-sharing";
import type { CertificateDownload } from "./download-certificate";
export async function saveCertificate(file: CertificateDownload, current: () => boolean) {
  if (!current()) return;
  if (!(await isAvailableAsync())) throw new Error("File sharing is unavailable on this device.");
  if (!current()) return;
  const directory = new Directory(
    Paths.cache,
    `certificate-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  try {
    directory.create();
    const target = new File(directory, file.filename);
    target.write(file.bytes);
    if (current()) await shareAsync(target.uri, { mimeType: file.mimeType, UTI: "public.image" });
  } finally {
    if (directory.exists) directory.delete();
  }
}
