import { useEffect, useRef } from 'react'
import { Animated, Easing } from 'react-native'

/**
 * A slow, continuous breathing scale -- for the one or two elements on a
 * screen that should read as "live" (Trending's activity badge), not for
 * general decoration. Loops until unmounted.
 */
export function Pulse({ children, style }: { children: React.ReactNode; style?: object }) {
  const scale = useRef(new Animated.Value(1)).current

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.06, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [scale])

  return <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
}
