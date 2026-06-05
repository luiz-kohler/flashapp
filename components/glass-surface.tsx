import { BlurView } from 'expo-blur';
import { StyleSheet, type ViewProps } from 'react-native';

import { useColorScheme } from '@/hooks/use-color-scheme';

type Props = ViewProps & {
  /** Blur strength (0–100). Higher = more frosted. */
  intensity?: number;
  /** Corner radius. */
  radius?: number;
};

/**
 * A frosted "glass" surface that approximates iOS 26 Liquid Glass using
 * expo-blur. This works in Expo Go on any iOS version. On a Development Build
 * running iOS 26 this is the spot to swap in expo-glass-effect's <GlassView>
 * for the real material — the rest of the UI wouldn't change.
 *
 * Blur only reads as "glass" when there's content behind it, so use it over a
 * gradient/scrolling content, not a flat background.
 */
export function GlassSurface({ intensity = 50, radius = 24, style, children, ...rest }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const isDark = scheme === 'dark';

  return (
    <BlurView
      intensity={intensity}
      tint={isDark ? 'systemThickMaterialDark' : 'systemThinMaterialLight'}
      style={[
        styles.base,
        {
          borderRadius: radius,
          borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.6)',
        },
        style,
      ]}
      {...rest}>
      {children}
    </BlurView>
  );
}

const styles = StyleSheet.create({
  base: {
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
});
