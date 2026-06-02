import { redirect } from "next/navigation";

// 账号权限 is now a multi-page module (账号 / 角色权限 / 会话); the index lands on
// the accounts page — the first item of the second rail.
export default function UsersAdminPage() {
  redirect("/users/accounts");
}
