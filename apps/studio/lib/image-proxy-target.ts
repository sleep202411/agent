/** Storage origins already used by Studio images. Never proxy arbitrary URLs. */
export function imageProxyTarget(value: string): URL | null {
  try {
    const url = new URL(value);
    const allowed =
      /^([a-z0-9-]+\.blob\.core\.windows\.net|v3\.fal\.media|media\.fizzdragon\.com|media\.fizzspace\.cn|r2\.fizzdragon\.com)$/i;
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      allowed.test(url.hostname)
      ? url
      : null;
  } catch {
    return null;
  }
}
