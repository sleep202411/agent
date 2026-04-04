"use client";

import { cn } from "@/lib/utils";

interface ImageCollageProps {
  images: string[];
  className?: string;
  onImageClick?: (index: number) => void;
}

/*
 * Base grid: 6 columns × 6 rows.
 * Each layout specifies [colStart, rowStart, colSpan, rowSpan] per image.
 * Image 1 is always square and largest.
 */

type CellPos = [colStart: number, rowStart: number, colSpan: number, rowSpan: number];

const GRID = 12;

const layouts12: Record<number, CellPos[]> = {
  1: [[1, 1, 12, 12]],
  2: [
    [1, 1, 8, 12], // img1: square left
    [9, 1, 4, 12], // img2: right strip
  ],
  3: [
    [1, 1, 8, 12], // img1: square left
    [9, 1, 4, 6], // img2: right top
    [9, 7, 4, 6], // img3: right bottom
  ],
  4: [
    [1, 1, 6, 6], // img1: top-left square
    [7, 1, 6, 6], // img2: top-right
    [1, 7, 6, 6], // img3: bottom-left
    [7, 7, 6, 6], // img4: bottom-right
  ],
  5: [
    [1, 1, 8, 8], // img1: big square top-left
    [9, 1, 4, 4], // img2: right top
    [9, 5, 4, 4], // img3: right middle
    [1, 9, 6, 4], // img4: bottom-left
    [7, 9, 6, 4], // img5: bottom-right
  ],
  6: [
    [1, 1, 8, 8], // img1: big square top-left
    [9, 1, 4, 4], // img2: right top
    [9, 5, 4, 4], // img3: right bottom
    [1, 9, 4, 4], // img4: bottom 1
    [5, 9, 4, 4], // img5: bottom 2
    [9, 9, 4, 4], // img6: bottom 3
  ],
  7: [
    [1, 1, 8, 8], // img1: big square top-left
    [9, 1, 4, 4], // img2: right top
    [9, 5, 4, 4], // img3: right bottom
    [1, 9, 3, 4], // img4
    [4, 9, 3, 4], // img5
    [7, 9, 3, 4], // img6
    [10, 9, 3, 4], // img7
  ],
  8: [
    [1, 1, 7, 8], // img1: big square top-left
    [8, 1, 5, 4], // img2: right top
    [8, 5, 5, 4], // img3: right bottom
    [1, 9, 3, 4], // img4
    [4, 9, 3, 4], // img5
    [7, 9, 2, 4], // img6
    [9, 9, 2, 4], // img7
    [11, 9, 2, 4], // img8
  ],
};

export function ImageCollage({ images, className, onImageClick }: ImageCollageProps) {
  const count = Math.min(images.length, 8);
  if (count === 0) return null;

  const positions = layouts12[count];
  if (!positions) return null;

  return (
    <div
      className={cn("grid gap-1", className)}
      style={{
        gridTemplateColumns: `repeat(${GRID}, 1fr)`,
        gridTemplateRows: `repeat(${GRID}, 1fr)`,
        aspectRatio: "1 / 1",
      }}
    >
      {positions.map(([col, row, colSpan, rowSpan], i) => {
        if (i >= images.length) return null;
        return (
          <div
            key={i}
            className="cursor-pointer overflow-hidden rounded-xs bg-muted"
            style={{
              gridColumn: `${col} / span ${colSpan}`,
              gridRow: `${row} / span ${rowSpan}`,
            }}
            onClick={() => onImageClick?.(i)}
          >
            <img
              src={images[i]}
              alt=""
              className="h-full w-full object-cover transition-transform hover:scale-105"
              loading="lazy"
            />
          </div>
        );
      })}
    </div>
  );
}
