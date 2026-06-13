import { redirect } from "next/navigation";

// 用户管理 lands on the user directory.
export default function MembersIndexPage() {
  redirect("/members/directory");
}
