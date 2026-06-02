import { snakeSlot } from "./snake-order";

/** Map of overall pick number → the team (league_members.id) that owns it,
 *  when it differs from the default snake owner (i.e. the slot was traded). */
export type PickOwnerOverrides = Map<number, number>;

type MemberSlot = { id: number; draftPosition: number | null };

/**
 * The team on the clock for a given overall pick. Defaults to the snake owner
 * derived from draft positions; a traded-slot override takes precedence. With
 * no overrides this is identical to the plain snake order, so untraded drafts
 * are unaffected.
 */
export function resolvePickOwnerId(
  overallPick: number,
  members: MemberSlot[],
  thirdRoundReversal: boolean,
  overrides?: PickOwnerOverrides | null,
): number | null {
  const override = overrides?.get(overallPick);
  if (override != null) return override;

  const positioned = members.filter((m) => m.draftPosition != null);
  const numTeams = positioned.length;
  if (numTeams === 0) return null;

  const { slot } = snakeSlot(overallPick, numTeams, thirdRoundReversal);
  return positioned.find((m) => m.draftPosition === slot)?.id ?? null;
}

/** Builds the override map from current_draft_pick_owners rows. */
export function buildPickOwnerOverrides(
  rows: { overall_pick: number; owner_team_id: number }[] | null | undefined,
): PickOwnerOverrides {
  const map: PickOwnerOverrides = new Map();
  for (const r of rows ?? []) map.set(r.overall_pick, r.owner_team_id);
  return map;
}
