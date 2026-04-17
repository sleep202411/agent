import { redirect } from "next/navigation";

export default function StudioIndex(): never {
  redirect("/studio/projects");
}
