import type { Metadata } from "next";
import { NarrativeStudioCanvas } from "./_components/narrative-studio-canvas";

export const metadata: Metadata = {
  title: "叙事工作台",
  description: "互动故事创作画布原型。",
};

export default function NarrativeStudioPage() {
  return <NarrativeStudioCanvas />;
}
