/**
 * Auth utilities
 *
 * TODO: 对接具体认证方案（JWT / Cookie + Redis）
 * 当前只定义接口，具体实现待定
 */

export interface User {
  id: string;
  email: string;
  nickname: string;
  avatar?: string;
}

/** 不需要登录即可访问的路径 */
export const PUBLIC_PATHS = ["/login", "/register", "/forgot-password"];

/**
 * 获取当前用户信息
 * TODO: 实现具体逻辑（读 cookie → 验证 token / 查 redis）
 */
export async function getCurrentUser(): Promise<User | null> {
  // TODO: implement
  return null;
}

/**
 * 检查是否已登录
 */
export async function isAuthenticated(): Promise<boolean> {
  const user = await getCurrentUser();
  return user !== null;
}

/**
 * 登出 — 清除客户端状态
 * TODO: 对接后端登出接口 + 清除 cookie
 */
export async function logout(): Promise<void> {
  // TODO: call backend logout API
  // TODO: clear cookie
}
