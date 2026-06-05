import * as Haptics from 'expo-haptics';
import { useRef, type ReactNode } from 'react';
import { Animated, Dimensions, StyleSheet, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';

import { IconSymbol } from '@/components/ui/icon-symbol';

// Row width ≈ screen width minus the two side paddings (Spacing.four = 24 each).
const ROW_WIDTH = Dimensions.get('window').width - 48;
// Must swipe at least 75% of the row to actually delete — avoids accidents.
const THRESHOLD = ROW_WIDTH * 0.75;

type Props = {
  children: ReactNode;
  onConfirm: () => void;
  /** Match the row's corner radius so the red fills the same shape. */
  radius?: number;
};

// Full-swipe to delete (no confirmation dialog): drag the row right past ~75%
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
        const opacity = progress.interpolate({
          inputRange: [0, 0.25],
          outputRange: [0, 1],
          extrapolate: 'clamp',
        });
        // Grows a touch as you approach the 75% point — "armed to delete".
        const scale = progress.interpolate({
          inputRange: [0, 0.6, 1],
          outputRange: [0.6, 0.95, 1.2],
          extrapolate: 'clamp',
        });
        return (
          <View style={[styles.action, { borderRadius: radius }]}>
            <Animated.View style={{ opacity, transform: [{ scale }] }}>
              <IconSymbol name="trash" size={28} color="#fff" />
            </Animated.View>
          </View>
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
