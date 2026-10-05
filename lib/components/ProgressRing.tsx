import Svg, { Circle } from 'react-native-svg'
import { View } from 'react-native'

/**
 * Circular progress ring — the calorie/macro visual signature borrowed from
 * the Cal AI reference (structure/layout only, not its color or copy; this
 * app stays monochrome per the existing theme). Built on react-native-svg,
 * already a dependency, so no new native module risk.
 */
export function ProgressRing({
  size,
  strokeWidth,
  progress,
  trackColor,
  fillColor,
  children,
}: {
  size: number
  strokeWidth: number
  /** 0..1 */
  progress: number
  trackColor: string
  fillColor: string
  children?: React.ReactNode
}) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const clamped = Math.min(1, Math.max(0, progress))
  const dashoffset = circumference * (1 - clamped)

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke={trackColor} strokeWidth={strokeWidth} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={fillColor}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={dashoffset}
          strokeLinecap="round"
          rotation="-90"
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      {children ? <View style={{ position: 'absolute', alignItems: 'center', justifyContent: 'center' }}>{children}</View> : null}
    </View>
  )
}
