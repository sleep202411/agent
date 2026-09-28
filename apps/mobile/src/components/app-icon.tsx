import {
  IconChevronRight,
  IconHome,
  IconNews,
  IconUser,
  IconUserCircle,
  IconUsersGroup,
} from "@tabler/icons-react-native";
import type { ComponentType } from "react";
import type { SvgProps } from "react-native-svg";

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
