// Single source of truth for unit conversions. Previously redeclared
// locally in 12+ files, which let one copy (profile.tsx's inline weigh-in
// target row) drift to a different precision (2.20462 vs 2.20462262)
// elsewhere in the same file — small, but exactly the kind of silent bug
// duplication invites.

export const KG_TO_LB = 2.20462262
export const LB_TO_KG = 1 / KG_TO_LB
export const CM_TO_IN = 1 / 2.54
export const IN_TO_CM = 2.54
export const ML_PER_FL_OZ = 29.5735
