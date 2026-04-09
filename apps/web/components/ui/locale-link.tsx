import { Link, type LinkProps } from "@tanstack/react-router";
import { useLocale } from "@/src/i18n/i18n";

/**
 * Link that auto-prefixes the current locale to the path.
 *
 * Usage:
 *   <LocaleLink to="/projects">       →  /zh-CN/projects
 *   <LocaleLink to="/creators/42">    →  /zh-CN/creators/42
 */
export function LocaleLink({ to, ...props }: Omit<LinkProps, "to"> & { to: string }) {
  const locale = useLocale();
  const localeTo = typeof to === "string" && to.startsWith("/") ? `/${locale}${to}` : to;
  return <Link to={localeTo} {...props} />;
}

/**
 * Hook to build locale-prefixed paths for programmatic navigation.
 *
 * Usage:
 *   const lp = useLocalePath();
 *   navigate({ to: lp("/projects") });
 */
export function useLocalePath() {
  const locale = useLocale();
  return (path: string) => `/${locale}${path}`;
}
