import Svg, { Rect } from 'react-native-svg'
import { meterColors } from '../theme'

/**
 * The one tab icon that isn't a monochrome Ionicon on purpose — four bars,
 * ascending low to high, colored red -> orange -> yellow -> green (the same
 * fixed meter ramp used for the weight-progress bar) so the Progress tab
 * itself visually reads as "getting better," not just a generic bar-chart
 * glyph. Dimmed via opacity when inactive, same as every other tab icon,
 * rather than swapping in an "outline" variant — there's no monochrome
 * outline equivalent for four independently-colored bars.
 */
export function ProgressTabIcon({ focused }: { focused: boolean }) {
  const bars = [
    { x: 1, height: 8, color: meterColors.low },
    { x: 6.5, height: 13, color: meterColors.mid1 },
    { x: 12, height: 17, color: meterColors.mid2 },
    { x: 17.5, height: 21, color: meterColors.high },
  ]
  const size = 22
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ opacity: focused ? 1 : 0.7 }}>
      {bars.map((b) => (
        <Rect key={b.x} x={b.x} y={size - b.height} width={3.5} height={b.height} rx={1.5} fill={b.color} />
      ))}
    </Svg>
  )
}
