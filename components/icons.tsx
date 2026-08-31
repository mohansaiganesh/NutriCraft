import Svg, { Circle, Line, Path, Polyline } from 'react-native-svg';

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

export function IconHome({ size, color, strokeWidth = 2.1 }: IconProps) {
  return (
    <Svg {...base(size, color, strokeWidth)}>
      <Path d="M3 10.5L12 3l9 7.5" />
      <Path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
      <Path d="M9.5 21v-6h5v6" />
    </Svg>
  );
}

export function IconLeaf({ size, color, strokeWidth = 2.1 }: IconProps) {
  return (
    <Svg {...base(size, color, strokeWidth)}>
      <Path d="M12 3C7 7 6 14 12 21C18 14 17 7 12 3z" />
      <Path d="M12 20L12 5" />
      <Path d="M12 9.5L8.7 6.9" />
      <Path d="M12 13L15.3 10.4" />
    </Svg>
  );
}

export function IconBowl({ size, color, strokeWidth = 2.1 }: IconProps) {
  return (
    <Svg {...base(size, color, strokeWidth)}>
      <Path d="M3 11h18" />
      <Path d="M4 11a8 8 0 0 0 16 0" />
      <Path d="M11 4c0 1.2-1 1.5-1 2.7" />
      <Path d="M14 4c0 1.2-1 1.5-1 2.7" />
    </Svg>
  );
}

export function IconCatalog({ size, color, strokeWidth = 2.1 }: IconProps) {
  return (
    <Svg {...base(size, color, strokeWidth)}>
      {/* book cover + spine */}
      <Path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H19a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H6a2 2 0 0 0-2 2z" />
      <Path d="M4 5.5V18" />
      {/* catalog entry lines */}
      <Path d="M8 8.5h6" />
      <Path d="M8 12h4" />
      {/* leaf accent */}
      <Path d="M15.6 12c1.5-.2 2.6.7 2.7 2.1-.1 1.4-1.2 2.3-2.7 2.1.1-1.4.1-2.8 0-4.2z" />
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
      <Path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
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

export function IconChevronDown({ size, color, strokeWidth = 2.3 }: IconProps) {
  return (
    <Svg {...base(size, color, strokeWidth)}>
      <Path d="M6 9l6 6 6-6" />
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

export function IconPencil({ size, color, strokeWidth = 2.1 }: IconProps) {
  return (
    <Svg {...base(size, color, strokeWidth)}>
      <Path d="M12 20h9" />
      <Path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
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

/** Meal-section icon by key (used on the Home dashboard + meal builder). */
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
