const TEXT_GAME_COVER_RATIO = 16 / 9;
const TEXT_GAME_COVER_RATIO_TOLERANCE = 0.02;

export function hasTextGameCoverAspect(width: number, height: number): boolean {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return false;
  }

  return Math.abs(width / height - TEXT_GAME_COVER_RATIO) <= TEXT_GAME_COVER_RATIO_TOLERANCE;
}

export function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    const release = () => URL.revokeObjectURL(objectUrl);
    image.onload = () => {
      const dimensions = { width: image.naturalWidth, height: image.naturalHeight };
      release();
      resolve(dimensions);
    };
    image.onerror = () => {
      release();
      reject(new Error("The selected cover could not be read as an image."));
    };
    image.src = objectUrl;
  });
}
