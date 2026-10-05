import { useEffect, useState } from 'react'
import { Alert, Pressable, Text, View } from 'react-native'
import { deleteFighterYearRecord, fighterYearRecords, upsertFighterYearRecord, type YearRecord } from '../fightersClient'
import { radius, spacing, type, useTheme } from '../theme'
import { NumberField } from './NumberField'

const CURRENT_YEAR = new Date().getFullYear()

/**
 * Add/edit a claimed fighter's fight count per year -- the low-friction
 * alternative to logging every individual bout (app/fighter/add-fight.tsx):
 * "5 fights in 2023," no opponent names required. Shared between onboarding
 * (right after claiming or creating a profile) and app/fighter/edit.tsx
 * (editing it later) rather than duplicated, since it's the exact same
 * data and the exact same ownership rule either way.
 *
 * Tapping an existing year loads it back into the form -- upsert_fighter_
 * year_record (0032) is keyed by (fighter_slug, year), so "add a new year"
 * and "correct a year I got wrong" are the same Save action, not two
 * different flows.
 */
export function YearRecordsEditor({ slug }: { slug: string }) {
  const theme = useTheme()
  const [records, setRecords] = useState<YearRecord[]>([])
  const [year, setYear] = useState(CURRENT_YEAR.toString())
  const [fights, setFights] = useState('')
  const [wins, setWins] = useState('')
  const [losses, setLosses] = useState('')
  const [draws, setDraws] = useState('')
  const [saving, setSaving] = useState(false)

  function load() {
    void fighterYearRecords(slug).then(setRecords)
  }

  useEffect(load, [slug])

  function editRow(r: YearRecord) {
    setYear(r.year.toString())
    setFights(r.fights.toString())
    setWins(r.wins != null ? r.wins.toString() : '')
    setLosses(r.losses != null ? r.losses.toString() : '')
    setDraws(r.draws != null ? r.draws.toString() : '')
  }

  async function save() {
    if (saving) return
    const yearV = Number.parseInt(year, 10)
    const fightsV = Number.parseInt(fights, 10)
    if (!Number.isFinite(yearV) || yearV < 1950 || yearV > 2100) {
      Alert.alert('Invalid year', 'Enter a real year.')
      return
    }
    if (!Number.isFinite(fightsV) || fightsV < 0) {
      Alert.alert('Missing fights', 'Enter how many fights you had that year.')
      return
    }
    setSaving(true)
    const winsV = Number.parseInt(wins, 10)
    const lossesV = Number.parseInt(losses, 10)
    const drawsV = Number.parseInt(draws, 10)
    const { ok, error } = await upsertFighterYearRecord(slug, {
      year: yearV,
      fights: fightsV,
      wins: Number.isFinite(winsV) ? winsV : null,
      losses: Number.isFinite(lossesV) ? lossesV : null,
      draws: Number.isFinite(drawsV) ? drawsV : null,
    })
    setSaving(false)
    if (ok) {
      setYear(CURRENT_YEAR.toString())
      setFights('')
      setWins('')
      setLosses('')
      setDraws('')
      load()
    } else {
      Alert.alert("Couldn't save that year", error ?? 'Try again.')
    }
  }

  async function removeRow(y: number) {
    const { ok, error } = await deleteFighterYearRecord(slug, y)
    if (ok) load()
    else Alert.alert("Couldn't remove that year", error ?? 'Try again.')
  }

  return (
    <View>
      {records.length > 0 ? (
        <View style={{ gap: spacing.sm, marginBottom: spacing.md }}>
          {records.map((r) => (
            <Pressable
              key={r.year}
              onPress={() => editRow(r)}
              style={{
                flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                backgroundColor: theme.surface, borderRadius: radius.md, padding: spacing.md,
              }}
            >
              <Text style={[type.bodyStrong, { color: theme.text }]}>{r.year}</Text>
              <Text style={[type.caption, { color: theme.textMuted }]}>
                {r.fights} fight{r.fights === 1 ? '' : 's'}
                {r.wins != null || r.losses != null || r.draws != null ? ` · ${r.wins ?? 0}-${r.losses ?? 0}-${r.draws ?? 0}` : ''}
              </Text>
              <Pressable accessibilityRole="button" onPress={() => removeRow(r.year)} hitSlop={spacing.sm}>
                <Text style={[type.caption, { color: theme.danger }]}>Remove</Text>
              </Pressable>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <NumberField label="Year" unit="" value={year} onChange={setYear} placeholder={CURRENT_YEAR.toString()} />
        </View>
        <View style={{ flex: 1 }}>
          <NumberField label="Fights" unit="" value={fights} onChange={setFights} placeholder="0" />
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <NumberField label="" unit="W" value={wins} onChange={setWins} placeholder="0" />
        </View>
        <View style={{ flex: 1 }}>
          <NumberField label="" unit="L" value={losses} onChange={setLosses} placeholder="0" />
        </View>
        <View style={{ flex: 1 }}>
          <NumberField label="" unit="D" value={draws} onChange={setDraws} placeholder="0" />
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        disabled={saving}
        onPress={save}
        style={{
          marginTop: spacing.sm, height: 44, borderRadius: radius.pill, backgroundColor: theme.primary,
          alignItems: 'center', justifyContent: 'center', opacity: saving ? 0.6 : 1,
        }}
      >
        <Text style={[type.bodyStrong, { color: theme.onPrimary }]}>{saving ? 'Saving…' : 'Save year'}</Text>
      </Pressable>
    </View>
  )
}
