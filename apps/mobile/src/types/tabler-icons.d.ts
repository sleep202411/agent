/**
 * This package's per-icon .mjs files load, but the matching .d.ts files sit one
 * directory deeper than the export map says. Tell TypeScript the shape so the
 * editor stops flagging every `@tabler/icons-react-native/Icon*` import.
 */
declare module "@tabler/icons-react-native/*" {
  import type { ForwardRefExoticComponent, RefAttributes } from "react";
  import type { SvgProps } from "react-native-svg";

  interface IconProps extends SvgProps {
    size?: string | number;
    strokeWidth?: string | number;
    title?: string;
  }

  const Icon: ForwardRefExoticComponent<IconProps & RefAttributes<IconProps>>;
  export default Icon;
}
