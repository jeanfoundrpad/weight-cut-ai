import Svg, { Circle, Line, Path } from 'react-native-svg'
import { Text, View } from 'react-native'
import { spacing, type, type Theme } from '../theme'
import type { WeightPoint } from '../repo'
import { KG_TO_LB } from '../units'

/**
 * Simple index-spaced line chart, not date-proportional — good enough for
 * "am I trending toward my weigh-in weight," which is the only question
 * this needs to answer. Target weight (if a fight-cut goal is active)
 * renders as a dashed reference line, matching how goals already read
 * elsewhere in the app (a number to move toward, not decoration).
 */
export function WeightTrendChart({
  points,
  targetLb,
  theme,
  width,
  height = 140,
}: {
  points: WeightPoint[]
  targetLb: number | null
  theme: Theme
  width: number
  height?: number
}) {
  if (points.length === 0) return null

  const lbs = points.map((p) => p.weightKg * KG_TO_LB)
  const allValues = targetLb != null ? [...lbs, targetLb] : lbs
  const minV = Math.min(...allValues)
  const maxV = Math.max(...allValues)
  const pad = Math.max(2, (maxV - minV) * 0.15)
  const lo = minV - pad
  const hi = maxV + pad

  const yFor = (v: number) => height - ((v - lo) / (hi - lo)) * height
  const xFor = (i: number) => (points.length <= 1 ? width / 2 : (i / (points.length - 1)) * width)

  const pathD = lbs.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i)},${yFor(v)}`).join(' ')
  const latest = lbs[lbs.length - 1]

  return (
    <View>
      <Svg width={width} height={height}>
        {targetLb != null ? (
          <Line x1={0} y1={yFor(targetLb)} x2={width} y2={yFor(targetLb)} stroke={theme.textFaint} strokeWidth={1.5} strokeDasharray="4 4" />
        ) : null}
        {lbs.length > 1 ? <Path d={pathD} stroke={theme.accentLine} strokeWidth={2.5} fill="none" strokeLinejoin="round" strokeLinecap="round" /> : null}
        {lbs.map((v, i) => (
          <Circle
            key={i}
            cx={xFor(i)}
            cy={yFor(v)}
            r={i === lbs.length - 1 ? 5 : 3}
            fill={i === lbs.length - 1 ? theme.accentLine : theme.surface}
            stroke={theme.accentLine}
            strokeWidth={i === lbs.length - 1 ? 0 : 1.5}
          />
        ))}
      </Svg>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs }}>
        <Text style={[type.caption, { color: theme.textMuted }]}>{points[0].localDate}</Text>
        <Text style={[type.bodyStrong, { color: theme.text }]}>{latest.toFixed(1)} lbs</Text>
      </View>
    </View>
  )
}
