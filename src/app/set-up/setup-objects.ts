export type SetupReferenceObject = {
  id: string;
  label: string;
  description: string;
  stationId: "service-cart" | "tortillas" | "lettuce-wraps" | "hot-food" | "cold-sides";
  left: number;
  top: number;
  width: number;
  height: number;
};

/** Percentages refer only to the 1024 × 1536 reference image, not physical fit.
 * Broad furniture/support targets precede the individual objects above them.
 */
export const TACO_BAR_SETUP_OBJECTS: readonly SetupReferenceObject[] = [
  {
    id: "buffet-table", label: "Buffet table", stationId: "hot-food", left: 16, top: 26.5, width: 69, height: 72.5,
    description: "The 8 ft × 3 ft buffet table supports the Taco Bar stations. Its measured size does not confirm that the illustrated equipment fits with the required clearances.",
  },
  {
    id: "marble-cart-left", label: "Left marble serving cart", stationId: "service-cart", left: 26.7, top: 6.7, width: 23.3, height: 19.3,
    description: "One of the two 21.5 × 15.5 inch marble serving carts. Place the carts side by side at the start, with plates, napkins and forks accessible from each side.",
  },
  {
    id: "marble-cart-right", label: "Right marble serving cart", stationId: "service-cart", left: 50.2, top: 6.7, width: 23.2, height: 19.3,
    description: "The second marble serving cart sits beside the first. The paired carts have a 21.5 × 31 inch combined footprint; keep the serving supplies accessible from each side.",
  },
  {
    id: "clear-riser-left", label: "Left tortilla-warmer riser", stationId: "tortillas", left: 27.2, top: 33.6, width: 14.6, height: 4.9,
    description: "The clear riser supports the left tortilla warmer in the reference arrangement. Check the equipment footprint before confirming its placement.",
  },
  {
    id: "clear-riser-center", label: "Center taco-stand riser", stationId: "tortillas", left: 43, top: 35.2, width: 14.9, height: 3.1,
    description: "The center clear riser supports the taco stands between the two tortilla warmers.",
  },
  {
    id: "clear-riser-right", label: "Right tortilla-warmer riser", stationId: "tortillas", left: 59.2, top: 33.6, width: 14.4, height: 4.9,
    description: "The clear riser supports the right tortilla warmer, opposite the left warmer.",
  },
  {
    id: "lettuce-wrap-riser", label: "Lettuce-wrap riser box", stationId: "lettuce-wraps", left: 42.1, top: 41.1, width: 16, height: 5.7,
    description: "Use this small clear riser box for lettuce wraps, with 2 tongs. The illustration does not specify the purchased amount of lettuce wraps.",
  },
  {
    id: "chafer-left-utensil-tray", label: "Left black utensil plate", stationId: "hot-food", left: 25, top: 52.6, width: 12, height: 14.6,
    description: "Place this long black plate on the left of the centered chafing dish. It holds 1 spoon and 2 large tongs.",
  },
  {
    id: "chafer-right-utensil-tray", label: "Right black utensil plate", stationId: "hot-food", left: 63.4, top: 52.6, width: 12.4, height: 14.6,
    description: "Place this long black plate on the right of the centered chafing dish. It also holds 1 spoon and 2 large tongs.",
  },
  {
    id: "three-tier-stand", label: "Three-tier serving stack", stationId: "cold-sides", left: 35.7, top: 72.7, width: 27.7, height: 20.2,
    description: "The three-tier stack organizes the reference serving tools: 2 small tongs on top, 2 spoons in the middle and 2 spoons on the bottom. No food contents are assigned by this picture.",
  },
  {
    id: "plate-stack-left", label: "Left plate stack", stationId: "service-cart", left: 29.4, top: 8.4, width: 15.6, height: 8.4,
    description: "Place a stack of plates on this side of the marble carts for guests to collect before entering the food line. The plate quantity is not calculated from the illustration.",
  },
  {
    id: "plate-stack-right", label: "Right plate stack", stationId: "service-cart", left: 55.2, top: 8.4, width: 15.6, height: 8.4,
    description: "Provide plates on the other side of the marble carts as well, so the supplies are accessible from both sides.",
  },
  {
    id: "napkins-left", label: "Left napkins", stationId: "service-cart", left: 33.4, top: 1.8, width: 8.3, height: 6.4,
    description: "Place napkins with the serving supplies on this side of the carts. The reference calls for napkins on each side.",
  },
  {
    id: "napkins-right", label: "Right napkins", stationId: "service-cart", left: 59, top: 1.8, width: 8.5, height: 6.4,
    description: "Place napkins on this side of the carts too, within reach of guests collecting their plates and forks.",
  },
  {
    id: "fork-caddy", label: "Fork caddy", stationId: "service-cart", left: 46.2, top: 3.9, width: 7.5, height: 11.6,
    description: "This caddy holds the guest forks. Keep forks accessible from each side of the marble serving carts.",
  },
  {
    id: "tortilla-warmer-left", label: "Left tortilla warmer", stationId: "tortillas", left: 27.4, top: 27.1, width: 14.5, height: 7.8,
    description: "The left tortilla warmer holds tortillas at the start of the Taco Bar. Set it on its clear riser with small tongs.",
  },
  {
    id: "taco-stands", label: "Taco stands", stationId: "tortillas", left: 43.3, top: 25.6, width: 14.2, height: 10.3,
    description: "Place the taco stands in the center, between the two tortilla warmers. They support tacos while guests assemble them; this image does not set a quantity to prepare.",
  },
  {
    id: "tortilla-warmer-right", label: "Right tortilla warmer", stationId: "tortillas", left: 59, top: 27.1, width: 14.5, height: 7.8,
    description: "The right tortilla warmer sits on the other side of the center taco stands, with small tongs and its clear riser.",
  },
  {
    id: "chafing-dish", label: "Centered chafing dish", stationId: "hot-food", left: 38.5, top: 48.9, width: 23.4, height: 22,
    description: "Center the reference chafing dish for hot-food service. Use the event’s calculated equipment count separately; do not infer pan contents, purchased food or a final dish count from this illustration.",
  },
  {
    id: "tortilla-tongs-left", label: "Left tortilla-warmer small tongs", stationId: "tortillas", left: 31.4, top: 28, width: 7.6, height: 4.9,
    description: "Use these small tongs with the left tortilla warmer to serve tortillas.",
  },
  {
    id: "tortilla-tongs-right", label: "Right tortilla-warmer small tongs", stationId: "tortillas", left: 64.3, top: 28, width: 7.6, height: 4.9,
    description: "Use these small tongs with the right tortilla warmer to serve tortillas.",
  },
  {
    id: "lettuce-wrap-tongs-left", label: "Lettuce-wrap tongs — left", stationId: "lettuce-wraps", left: 43.4, top: 41.8, width: 6.6, height: 3.7,
    description: "One of the 2 tongs kept with the small clear lettuce-wrap riser box, for serving lettuce wraps.",
  },
  {
    id: "lettuce-wrap-tongs-right", label: "Lettuce-wrap tongs — right", stationId: "lettuce-wraps", left: 50.5, top: 41.8, width: 6.6, height: 3.7,
    description: "The second of the 2 tongs kept with the lettuce-wrap riser box. Keep both tongs at that station.",
  },
  {
    id: "chafer-left-spoon", label: "Left chafing-dish spoon", stationId: "hot-food", left: 24.6, top: 54.4, width: 10.6, height: 2.8,
    description: "The 1 spoon assigned to the long black plate on the left of the chafing dish. Keep it with that plate’s 2 large tongs; the reference does not specify which food it serves.",
  },
  {
    id: "chafer-right-spoon", label: "Right chafing-dish spoon", stationId: "hot-food", left: 65.3, top: 54.4, width: 10.7, height: 2.8,
    description: "The 1 spoon assigned to the right long black plate, beside its 2 large tongs. Check the actual food before assigning a serving utensil.",
  },
  {
    id: "chafer-left-tongs-upper", label: "Left chafing-dish large tongs — upper", stationId: "hot-food", left: 24.5, top: 58, width: 11.1, height: 3,
    description: "One of the 2 large tongs on the black plate to the left of the chafing dish. The reference specifies the tool and position, not a particular food.",
  },
  {
    id: "chafer-right-tongs-upper", label: "Right chafing-dish large tongs — upper", stationId: "hot-food", left: 65.1, top: 57.8, width: 11.1, height: 3,
    description: "One of the 2 large tongs on the black plate to the right of the chafing dish. Keep it at that serving station.",
  },
  {
    id: "chafer-left-tongs-lower", label: "Left chafing-dish large tongs — lower", stationId: "hot-food", left: 24.4, top: 61.4, width: 11.1, height: 2.8,
    description: "The second large tongs on the left black plate. Together, this plate holds 1 spoon and 2 large tongs.",
  },
  {
    id: "chafer-right-tongs-lower", label: "Right chafing-dish large tongs — lower", stationId: "hot-food", left: 65.1, top: 61.2, width: 11.1, height: 2.8,
    description: "The second large tongs on the right black plate. Together, this plate holds 1 spoon and 2 large tongs.",
  },
  {
    id: "tier-top-tongs-left", label: "Top-tier small tongs — left", stationId: "cold-sides", left: 37.9, top: 74.2, width: 6.9, height: 4.6,
    description: "One of the 2 small tongs on the top tier of the three-tier stack. Food contents are not specified by the reference.",
  },
  {
    id: "tier-top-tongs-right", label: "Top-tier small tongs — right", stationId: "cold-sides", left: 52, top: 74.1, width: 8.3, height: 4.7,
    description: "The second small tongs on the top tier. Keep both small tongs on the top of the three-tier stack.",
  },
  {
    id: "tier-middle-spoon-left", label: "Middle-tier spoon — left", stationId: "cold-sides", left: 37.2, top: 80.6, width: 12, height: 4,
    description: "One of the 2 spoons on the middle tier of the serving stack. The reference does not assign a specific food to this spoon.",
  },
  {
    id: "tier-middle-spoon-right", label: "Middle-tier spoon — right", stationId: "cold-sides", left: 49.6, top: 80.6, width: 10.1, height: 4,
    description: "The second spoon on the middle tier. Keep 2 spoons together at this level of the stack.",
  },
  {
    id: "tier-bottom-spoon-left", label: "Bottom-tier spoon — left", stationId: "cold-sides", left: 37.4, top: 86.4, width: 11.8, height: 4.2,
    description: "One of the 2 spoons on the bottom tier. Check the actual food setup before assigning any food contents.",
  },
  {
    id: "tier-bottom-spoon-right", label: "Bottom-tier spoon — right", stationId: "cold-sides", left: 49.7, top: 86.4, width: 10.2, height: 4.2,
    description: "The second spoon on the bottom tier. The reference arrangement has 2 spoons at this level.",
  },
];
