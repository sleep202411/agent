export async function shareReviewReport(
  bytes: Uint8Array,
  filename: string,
  current: () => boolean
) {
  if (!current()) return;
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(bytes)], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    })
  );
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    try {
      if (current()) link.click();
    } finally {
      link.remove();
    }
  } finally {
    // Let the browser begin consuming the URL before revoking it.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
