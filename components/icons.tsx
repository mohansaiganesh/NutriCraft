import Svg, { Circle, Line, Path, Polyline, Rect } from 'react-native-svg';

/**
 * Line-icon set for NutriCraft "Garden" — one consistent style (24px grid,
 * rounded caps/joins), stroke-based so everything scales and recolors.
 * Replaces every emoji the app used to render as an icon.
 */

type IconProps = { size?: number; color?: string; strokeWidth?: number };

const base = (size = 24, color = '#16241A', strokeWidth = 2) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: color,
  strokeWidth,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

export function IconToday({ size, color, strokeWidth = 2.1 }: IconProps) {
  return (
    <Svg {...base(size, color, strokeWidth)}>
      <Path d="M3 3v18h18" />
      <Rect x="7" y="11" width="3" height="6" rx="1" />
      <Rect x="12.5" y="7" width="3" height="10" rx="1" />
      <Rect x="18" y="13" width="3" height="4" rx="1" />
    </Svg>
  );
}

export function IconLeaf({ size, color, strokeWidth = 2.1 }: IconProps) {
  return (
    <Svg {...base(size, color, strokeWidth)}>
      <Path d="M11 20A7 7 0 0 1 4 13c0-4 3-8 8-9 0 5-1 9-1 16z" />
      <Path d="M20 5c0 5-3 9-8 9" />
    </Svg>
  );
}

export function IconPlate({ size, color, strokeWidth = 2.1 }: IconProps) {
  return (
    <Svg {...base(size, color, strokeWidth)}>
      <Circle cx="12" cy="12" r="9" />
      <Circle cx="12" cy="12" r="3.4" />
    </Svg>
  );
}

export function IconGear({ size, color, strokeWidth = 2.1 }: IconProps) {
  return (
    <Svg {...base(size, color, strokeWidth)}>
      <Circle cx="12" cy="12" r="3" />
      <Path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 6.6 19a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H1a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 2.2 6.6a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H7a1.6 1.6 0 0 0 1-1.5V1a2 2 0 1 1 4 0v.1A1.6 1.6 0 0 0 15 2.2a1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V7a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
    </Svg>
  );
}

export function IconSunrise({ size, color, strokeWidth = 2 }: IconProps) {
  return (
    <Svg {...base(size, color, strokeWidth)}>
      <Path d="M17 18a5 5 0 0 0-10 0" />
      <Line x1="12" y1="9" x2="12" y2="2" />
      <Line x1="4.2" y1="10.2" x2="5.6" y2="11.6" />
      <Line x1="1" y1="18" x2="3" y2="18" />
      <Line x1="21" y1="18" x2="23" y2="18" />
      <Line x1="18.4" y1="11.6" x2="19.8" y2="10.2" />
      <Line x1="23" y1="22" x2="1" y2="22" />
      <Polyline points="8 6 12 2 16 6" />
    </Svg>
  );
}

export function IconSun({ size, color, strokeWidth = 2 }: IconProps) {
  return (
    <Svg {...base(size, color, strokeWidth)}>
      <Circle cx="12" cy="12" r="4.2" />
      <Line x1="12" y1="2" x2="12" y2="4.5" />
      <Line x1="12" y1="19.5" x2="12" y2="22" />
      <Line x1="2" y1="12" x2="4.5" y2="12" />
      <Line x1="19.5" y1="12" x2="22" y2="12" />
      <Line x1="4.9" y1="4.9" x2="6.6" y2="6.6" />
      <Line x1="17.4" y1="17.4" x2="19.1" y2="19.1" />
      <Line x1="19.1" y1="4.9" x2="17.4" y2="6.6" />
      <Line x1="6.6" y1="17.4" x2="4.9" y2="19.1" />
    </Svg>
  );
}

export function IconMoon({ size, color, strokeWidth = 2 }: IconProps) {
  return (
    <Svg {...base(size, color, strokeWidth)}>
      <Path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </Svg>
  );
}

export function IconApple({ size, color, strokeWidth = 2 }: IconProps) {
  return (
    <Svg {...base(size, color, strokeWidth)}>
      <Path d="M12 7c1.5-3 5-3 6.5-1s.5 6-2 8.5S12.5 20 12 20s-2-2-4.5-5.5S5 8 6.5 6 10.5 4 12 7z" />
      <Path d="M12 7c0-2 1-4 3-4.5" />
    </Svg>
  );
}

export function IconChevronLeft({ size, color, strokeWidth = 2.3 }: IconProps) {
  return (
    <Svg {...base(size, color, strokeWidth)}>
      <Path d="M15 18l-6-6 6-6" />
    </Svg>
  );
}

export function IconChevronRight({ size, color, strokeWidth = 2.3 }: IconProps) {
  return (
    <Svg {...base(size, color, strokeWidth)}>
      <Path d="M9 18l6-6-6-6" />
    </Svg>
  );
}

export function IconPlus({ size, color, strokeWidth = 2.6 }: IconProps) {
  return (
    <Svg {...base(size, color, strokeWidth)}>
      <Line x1="12" y1="5" x2="12" y2="19" />
      <Line x1="5" y1="12" x2="19" y2="12" />
    </Svg>
  );
}

export function IconSearch({ size, color, strokeWidth = 2.2 }: IconProps) {
  return (
    <Svg {...base(size, color, strokeWidth)}>
      <Circle cx="11" cy="11" r="7" />
      <Line x1="21" y1="21" x2="16.65" y2="16.65" />
    </Svg>
  );
}

export function IconX({ size, color, strokeWidth = 2.4 }: IconProps) {
  return (
    <Svg {...base(size, color, strokeWidth)}>
      <Line x1="18" y1="6" x2="6" y2="18" />
      <Line x1="6" y1="6" x2="18" y2="18" />
    </Svg>
  );
}

export function IconDownload({ size, color, strokeWidth = 2.1 }: IconProps) {
  return (
    <Svg {...base(size, color, strokeWidth)}>
      <Path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <Polyline points="7 10 12 15 17 10" />
      <Line x1="12" y1="15" x2="12" y2="3" />
    </Svg>
  );
}

export function IconUpload({ size, color, strokeWidth = 2.1 }: IconProps) {
  return (
    <Svg {...base(size, color, strokeWidth)}>
      <Path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <Polyline points="17 8 12 3 7 8" />
      <Line x1="12" y1="3" x2="12" y2="15" />
    </Svg>
  );
}

export function IconCheck({ size, color, strokeWidth = 2.5 }: IconProps) {
  return (
    <Svg {...base(size, color, strokeWidth)}>
      <Polyline points="20 6 9 17 4 12" />
    </Svg>
  );
}

export function IconMeal({ size, color, strokeWidth = 2 }: IconProps) {
  return (
    <Svg {...base(size, color, strokeWidth)}>
      <Path d="M4 3v18" />
      <Path d="M8 3v6a3 3 0 0 1-4 3" />
      <Path d="M8 3v18" />
      <Path d="M20 3c-2 0-3 2-3 5s1 4 3 4v9" />
    </Svg>
  );
}

/** Meal-section icon by key (used on the Today dashboard + meal builder). */
export type MealIconName = 'sunrise' | 'sun' | 'moon' | 'apple';
export function MealIcon({ name, size, color, strokeWidth }: IconProps & { name: MealIconName }) {
  switch (name) {
    case 'sunrise':
      return <IconSunrise size={size} color={color} strokeWidth={strokeWidth} />;
    case 'sun':
      return <IconSun size={size} color={color} strokeWidth={strokeWidth} />;
    case 'moon':
      return <IconMoon size={size} color={color} strokeWidth={strokeWidth} />;
    case 'apple':
      return <IconApple size={size} color={color} strokeWidth={strokeWidth} />;
  }
}
