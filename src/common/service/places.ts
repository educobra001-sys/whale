// Learning centers and schools / organizations are both "places" a teacher teaches at. They share one
// collection and one set of rules (linking, schedule, sessions, closings); only the account type and
// the wording differ. Documents saved before schools existed have no kind and count as centers.
export const placeKinds = ["center", "school"] as const
export type PlaceKind = (typeof placeKinds)[number]

export const kindOfRole = (role: string): PlaceKind => (role === "school" ? "school" : "center")
export const kindFilter = (kind: PlaceKind) => (kind === "school" ? { kind: "school" } : { kind: { $ne: "school" } })
export const placeWord = (kind: unknown) => (kind === "school" ? "school" : "center")
export const placeTitle = (kind: unknown) => (kind === "school" ? "School" : "Center")
