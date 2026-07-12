import type { Metadata } from "next";
import { InteractiveFilmCanvas } from "../../_components/interactive-film/interactive-film-canvas";

export const metadata: Metadata = {
  title: "Dream of Jinling · Story Studio",
  description: "Edit the official interactive-film example in Story Studio.",
};

export default function JinlingInteractiveFilmPage() {
  return <InteractiveFilmCanvas />;
}
