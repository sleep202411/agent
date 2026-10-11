import { Directory, File, Paths } from "expo-file-system";
import { isAvailableAsync, shareAsync } from "expo-sharing";
export async function shareReviewReport(
  bytes: Uint8Array,
  filename: string,
  current: () => boolean
) {
  if (!(await isAvailableAsync())) throw new Error("File sharing is unavailable on this device");
  if (!current()) return;
  const directory = new Directory(
    Paths.cache,
    `review-export-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  try {
    directory.create();
    const file = new File(directory, filename);
    file.write(bytes);
    if (current())
      await shareAsync(file.uri, {
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        UTI: "org.openxmlformats.spreadsheetml.sheet",
      });
  } finally {
    if (directory.exists) directory.delete();
  }
}
