import type { ComponentType } from "react";
import type { SvgProps } from "react-native-svg";
import IconChevronRight from "@tabler/icons-react-native/IconChevronRight";
import IconHome from "@tabler/icons-react-native/IconHome";
import IconNews from "@tabler/icons-react-native/IconNews";
import IconUser from "@tabler/icons-react-native/IconUser";
import IconUserCircle from "@tabler/icons-react-native/IconUserCircle";
import IconUsersGroup from "@tabler/icons-react-native/IconUsersGroup";

export type AppIconName = "chevronRight" | "creators" | "crews" | "home" | "mine" | "news";

type TablerIconProps = SvgProps & {
  size?: number | string;
  strokeWidth?: number | string;
  title?: string;
};

type TablerIconComponent = ComponentType<TablerIconProps>;

const icons = {
  chevronRight: IconChevronRight,
  creators: IconUserCircle,
  crews: IconUsersGroup,
  home: IconHome,
  mine: IconUser,
  news: IconNews,
} satisfies Record<AppIconName, TablerIconComponent>;

export type AppIconProps = Omit<TablerIconProps, "height" | "width"> & {
  name: AppIconName;
  size?: number;
};

export function AppIcon({ color, name, size = 20, strokeWidth = 2, ...props }: AppIconProps) {
  const Icon = icons[name];

  return <Icon color={color} size={size} strokeWidth={strokeWidth} {...props} />;
}
