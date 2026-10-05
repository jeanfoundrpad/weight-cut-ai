import { useEffect, useRef } from 'react'
import { Animated } from 'react-native'

/**
 * A small mount-in reveal: fades and slides up. Built on RN's own Animated
 * API, not react-native-reanimated -- that needs native linking and this
 * project ships JS-only changes over EAS Update, a new native dependency
 * would force a fresh App Store build for something this small.
 *
 * `delayMs` staggers a list of these (Trending/Gyms/Fighters cards) so they
 * reveal in sequence rather than all popping in at once -- capped by
 * callers at a handful of items so a long list doesn't ramp up a multi-
 * second delay on its last row.
 */
export function FadeSlideIn({ children, delayMs = 0, style }: { children: React.ReactNode; delayMs?: number; style?: object }) {
  const progress = useRef(new Animated.Value(0)).current

  useEffect(() => {
    const anim = Animated.timing(progress, { toValue: 1, duration: 320, delay: delayMs, useNativeDriver: true })
    anim.start()
    return () => anim.stop()
  }, [progress, delayMs])

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
        },
      ]}
    >
      {children}
    </Animated.View>
  )
}
