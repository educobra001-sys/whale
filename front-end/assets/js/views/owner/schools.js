// Schools and organizations: the same page as learning centers, filtered to schools.
import { placesPage } from "./centers.js";

export default function ownerSchools(ctx) {
  return placesPage(ctx, "school");
}
