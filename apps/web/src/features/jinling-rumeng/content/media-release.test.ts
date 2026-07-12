import assert from "node:assert/strict";
import test from "node:test";
import {
  JINLING_MEDIA_RELEASE,
  jinlingAudio,
  jinlingFilmChapter,
  jinlingFilmClip,
  jinlingMediaUrl,
  jinlingP00Video,
} from "./media-release";

test("builds immutable Azure Blob media URLs under the locked release prefix", () => {
  assert.equal(JINLING_MEDIA_RELEASE.provider, "azure-blob");
  assert.equal(
    jinlingMediaUrl("film-cut-v2/a1-s01-carriage-wake.mp4"),
    "https://fizzdragonblob.blob.core.windows.net/foundry-outputs/interactive-films/jinling-rumeng/s01/v1/film-cut-v2/a1-s01-carriage-wake.mp4"
  );
  assert.equal(
    jinlingFilmClip("A1-S01-CARRIAGE-WAKE"),
    jinlingMediaUrl("film-cut-v2/a1-s01-carriage-wake.mp4")
  );
  assert.equal(jinlingFilmChapter("C1"), jinlingMediaUrl("film-cut-v2/chapters/c1.mp4"));
  assert.equal(
    jinlingP00Video("ledger-opening-16x9-v03.mp4"),
    jinlingMediaUrl("p00/ledger-opening-16x9-v03.mp4")
  );
  assert.equal(
    jinlingAudio("s01-p00-ambience-v1.wav"),
    jinlingMediaUrl("audio/s01-p00-ambience-v1.wav")
  );
});
