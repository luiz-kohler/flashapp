import * as Haptics from 'expo-haptics';
import { useRef, type ReactNode } from 'react';
import { Animated, Dimensions, StyleSheet } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';

import { IconSymbol } from '@/components/ui/icon-symbol';

// Row width ≈ screen width minus the two side paddings (Spacing.four = 24 each).
const ROW_WIDTH = Dimensions.get('window').width - 48;
// Must swipe at least 30% of the row to actually delete — avoids accidents
// without requiring a very long drag.
const THRESHOLD = ROW_WIDTH * 0.3;

type Props = {
  children: ReactNode;
  onConfirm: () => void;
  /** Match the row's corner radius so the red fills the same shape. */
  radius?: number;
};

// Full-swipe to delete (no confirmation dialog): drag the row right past ~30%
// and release to delete. Anything shorter springs back untouched. The red fills
// the whole row (same shape) with just a trash icon as the drag progresses.
// Requires <GestureHandlerRootView> at the app root.
export function SwipeToDelete({ children, onConfirm, radius = 16 }: Props) {
  const ref = useRef<Swipeable>(null);

  return (
    <Swipeable
      ref={ref}
      friction={1}
      leftThreshold={THRESHOLD}
      overshootLeft={false}
      onSwipeableWillOpen={() => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        onConfirm();
      }}
      renderLeftActions={(progress) => {
        // Fade the whole red panel with the drag, so releasing/cancelling
        // dissolves it smoothly back to the default background instead of
        // snapping from red to black.
        const bgOpacity = progress.interpolate({
          inputRange: [0, 0.35],
          outputRange: [0, 1],
          extrapolate: 'clamp',
        });
        const iconOpacity = progress.interpolate({
          inputRange: [0, 0.25],
          outputRange: [0, 1],
          extrapolate: 'clamp',
        });
        // Grows a touch as you approach the threshold — "armed to delete".
        const scale = progress.interpolate({
          inputRange: [0, 0.6, 1],
          outputRange: [0.6, 0.95, 1.2],
          extrapolate: 'clamp',
        });
        return (
          <Animated.View style={[styles.action, { borderRadius: radius, opacity: bgOpacity }]}>
            <Animated.View style={{ opacity: iconOpacity, transform: [{ scale }] }}>
              <IconSymbol name="trash" size={28} color="#fff" />
            </Animated.View>
          </Animated.View>
        );
      }}>
      {children}
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  action: {
    flex: 1,
    backgroundColor: '#FF453A',
    justifyContent: 'center',
    alignItems: 'flex-start',
    paddingLeft: 28,
  },
});
