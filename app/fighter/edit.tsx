import * as ImagePicker from 'expo-image-picker'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { NumberField } from '../../lib/components/NumberField'
import { OptionRow } from '../../lib/components/OptionRow'
import { YearRecordsEditor } from '../../lib/components/YearRecordsEditor'
import { fighterBySlug, updateFighterProfile, uploadFighterPhoto, type Fighter } from '../../lib/fightersClient'
import { setShareProgressPublicly, shareProgressPublicly } from '../../lib/groupsClient'
import { radius, spacing, type, useTheme } from '../../lib/theme'
import { KG_TO_LB, LB_TO_KG } from '../../lib/units'

/** Self-service edit for a claimed fighter -- see lib/fightersClient.ts's updateFighterProfile/uploadFighterPhoto for the ownership checks this relies on. */
export default function EditFighterProfile() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { slug } = useLocalSearchParams<{ slug: string }>()

  const [fighter, setFighter] = useState<Fighter | null>(null)
  const [gym, setGym] = useState('')
  const [weightLb, setWeightLb] = useState('')
  const [division, setDivision] = useState<'amateur' | 'pro' | ''>('')
  const [age, setAge] = useState('')
  const [height, setHeight] = useState('')
  const [sex, setSex] = useState<'male' | 'female' | ''>('')
  const [wins, setWins] = useState('')
  const [losses, setLosses] = useState('')
  const [draws, setDraws] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [sharingProgress, setSharingProgress] = useState(false)
  const [savingShare, setSavingShare] = useState(false)

  useEffect(() => {
    void fighterBySlug(slug).then((f) => {
      if (!f) return
      setFighter(f)
      setGym(f.gym ?? '')
      setWeightLb(f.weightKg != null ? Math.round(f.weightKg * KG_TO_LB).toString() : '')
      setDivision(f.division ?? '')
      setAge(f.age != null ? f.age.toString() : '')
      setHeight(f.height ?? '')
      setSex(f.sex ?? '')
      setWins(f.wins != null ? f.wins.toString() : '')
      setLosses(f.losses != null ? f.losses.toString() : '')
      setDraws(f.draws != null ? f.draws.toString() : '')
    })
    void shareProgressPublicly().then(setSharingProgress)
  }, [slug])

  async function toggleShareProgress(next: boolean) {
    if (savingShare) return
    setSavingShare(true)
    const { ok } = await setShareProgressPublicly(next)
    setSavingShare(false)
    if (ok) {
      setSharingProgress(next)
    } else {
      Alert.alert("Couldn't change that", 'Try again.')
    }
  }

  async function save() {
    if (saving) return
    setSaving(true)
    const weightLbV = Number.parseFloat(weightLb)
    const ageV = Number.parseInt(age, 10)
    const winsV = Number.parseInt(wins, 10)
    const lossesV = Number.parseInt(losses, 10)
    const drawsV = Number.parseInt(draws, 10)
    const { ok, error } = await updateFighterProfile(slug, {
      gym: gym.trim() || null,
      weightKg: Number.isFinite(weightLbV) && weightLbV > 0 ? weightLbV * LB_TO_KG : null,
      division: division || null,
      age: Number.isFinite(ageV) ? ageV : null,
      height: height.trim() || null,
      sex: sex || null,
      wins: Number.isFinite(winsV) ? winsV : null,
      losses: Number.isFinite(lossesV) ? lossesV : null,
      draws: Number.isFinite(drawsV) ? drawsV : null,
    })
    setSaving(false)
    if (ok) {
      router.back()
    } else {
      Alert.alert("Couldn't save", error ?? 'Try again.')
    }
  }

  async function pickPhoto(useCamera: boolean) {
    const permission = useCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) {
      Alert.alert('Permission needed', useCamera ? 'Allow camera access to take a photo.' : 'Allow photo library access to choose a photo.')
      return
    }

    const result = useCamera
      ? await ImagePicker.launchCameraAsync({ base64: true, quality: 0.6, allowsEditing: true, aspect: [1, 1] })
      : await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.6, allowsEditing: true, aspect: [1, 1] })
    if (result.canceled || !result.assets[0]?.base64) return

    setUploadingPhoto(true)
    const { ok, error } = await uploadFighterPhoto(slug, result.assets[0].base64)
    setUploadingPhoto(false)
    if (ok) {
      const refreshed = await fighterBySlug(slug)
      if (refreshed) setFighter(refreshed)
    } else {
      Alert.alert("Couldn't upload photo", error ?? 'Try again.')
    }
  }

  function choosePhotoSource() {
    Alert.alert('Add a photo', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Take photo', onPress: () => pickPhoto(true) },
      { text: 'Choose from library', onPress: () => pickPhoto(false) },
    ])
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top + spacing.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg }}>
        <Text style={[type.title, { color: theme.text }]}>Edit profile</Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={spacing.md}>
          <Text style={[type.body, { color: theme.textMuted }]}>Cancel</Text>
        </Pressable>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
        <Pressable onPress={choosePhotoSource} disabled={uploadingPhoto} style={{ alignItems: 'center', marginBottom: spacing.xl }}>
          <View
            style={{
              width: 96, height: 96, borderRadius: 48, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border,
              alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
            }}
          >
            {uploadingPhoto ? (
              <ActivityIndicator color={theme.text} />
            ) : fighter?.photoUrl ? (
              <Image source={{ uri: fighter.photoUrl }} style={{ width: 96, height: 96 }} />
            ) : (
              <Text style={[type.caption, { color: theme.textFaint }]}>Add photo</Text>
            )}
          </View>
          <Text style={[type.caption, { color: theme.textMuted, marginTop: spacing.xs }]}>
            {fighter?.photoUrl ? 'Change photo' : 'Add a photo'}
          </Text>
        </Pressable>

        <Text style={[type.label, { color: theme.textMuted, marginBottom: spacing.xs }]}>Gym</Text>
        <TextInput
          value={gym}
          onChangeText={setGym}
          placeholder="Your gym"
          placeholderTextColor={theme.textFaint}
          style={{
            backgroundColor: theme.surface, borderRadius: radius.md, borderWidth: 1, borderColor: theme.border,
            padding: spacing.md, color: theme.text, marginBottom: spacing.lg,
          }}
        />

        <NumberField label="Weight" unit="lbs" value={weightLb} onChange={setWeightLb} placeholder="150" />

        <OptionRow
          label="Division"
          value={division}
          onChange={setDivision}
          options={[
            { value: 'amateur', label: 'Amateur' },
            { value: 'pro', label: 'Pro' },
          ]}
        />

        <OptionRow
          label="Sex"
          value={sex}
          onChange={setSex}
          options={[
            { value: 'male', label: 'Male' },
            { value: 'female', label: 'Female' },
          ]}
        />

        <NumberField label="Age" unit="years" value={age} onChange={setAge} placeholder="25" />

        <Text style={[type.label, { color: theme.textMuted, marginBottom: spacing.xs }]}>Height</Text>
        <TextInput
          value={height}
          onChangeText={setHeight}
          placeholder={"e.g. 5'10"}
          placeholderTextColor={theme.textFaint}
          style={{
            backgroundColor: theme.surface, borderRadius: radius.md, borderWidth: 1, borderColor: theme.border,
            padding: spacing.md, color: theme.text, marginBottom: spacing.lg,
          }}
        />

        <Text style={[type.label, { color: theme.textMuted, marginBottom: spacing.xs }]}>Record</Text>
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

        <View style={{ marginTop: spacing.lg, backgroundColor: theme.surface, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: theme.border }}>
          <Text style={[type.bodyStrong, { color: theme.text }]}>Share your tracked weight</Text>
          <Text style={[type.caption, { color: theme.textMuted, marginTop: spacing.xs, lineHeight: 18 }]}>
            Off by default. When on, your real weight from this app (not just what's typed above) shows on your
            public profile, so other fighters can see your actual current weight, not just your last recorded fight weight.
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={savingShare}
            onPress={() => toggleShareProgress(!sharingProgress)}
            style={{
              marginTop: spacing.md, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center',
              backgroundColor: sharingProgress ? theme.primary : 'transparent',
              borderWidth: 1, borderColor: sharingProgress ? theme.primary : theme.border, opacity: savingShare ? 0.6 : 1,
            }}
          >
            <Text style={[type.bodyStrong, { color: sharingProgress ? theme.onPrimary : theme.text }]}>
              {sharingProgress ? 'Sharing on my public profile' : 'Not shared'}
            </Text>
          </Pressable>
        </View>

        <Text style={[type.label, { color: theme.textMuted, marginTop: spacing.lg, marginBottom: spacing.xs }]}>Fights by year</Text>
        <YearRecordsEditor slug={slug} />
      </ScrollView>

      <View style={{ padding: spacing.lg, paddingBottom: Math.max(insets.bottom, spacing.lg) }}>
        <Pressable
          accessibilityRole="button"
          disabled={saving}
          onPress={save}
          style={{ height: 60, borderRadius: radius.pill, backgroundColor: theme.primary, alignItems: 'center', justifyContent: 'center', opacity: saving ? 0.6 : 1 }}
        >
          <Text style={[type.bodyStrong, { color: theme.onPrimary, fontSize: 18 }]}>{saving ? 'Saving…' : 'Save'}</Text>
        </Pressable>
      </View>
    </View>
  )
}
