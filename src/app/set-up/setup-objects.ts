export type SetupReferenceObject = {
  id: string;
  label: string;
  description: string;
  stationId: "service-cart" | "tortillas" | "lettuce-wraps" | "hot-food" | "cold-sides" | "chafer-one" | "chafer-two" | "sauces" | "dessert" | "bar-chafer" | "bar-sauces";
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

/** Reference-image identification only; equipment counts do not replace event calculations. */
export const APPETIZER_WINGS_DESSERT_SETUP_OBJECTS: readonly SetupReferenceObject[] = [
  {
    id: "buffet-table", label: "Buffet table", stationId: "chafer-one", left: 16, top: 26.5, width: 69, height: 72.5,
    description: "The 8 ft × 3 ft buffet table supports this reference serving line. Its measured size does not confirm that the pictured equipment fits with the required clearances.",
  },
  {
    id: "marble-cart-left", label: "Left marble serving cart", stationId: "service-cart", left: 26.7, top: 6.7, width: 23.3, height: 19.3,
    description: "One of the two 21.5 × 15.5 inch marble serving carts. Place the carts side by side at the start, with plates, napkins and forks accessible from each side.",
  },
  {
    id: "marble-cart-right", label: "Right marble serving cart", stationId: "service-cart", left: 50.2, top: 6.7, width: 23.2, height: 19.3,
    description: "The second marble serving cart sits beside the first. The paired carts have a 21.5 × 31 inch combined footprint; check access and clearances separately.",
  },
  {
    id: "chafer-one-left-utensil-plate", label: "First chafing dish — left black utensil plate", stationId: "chafer-one", left: 26.7, top: 29.5, width: 11.6, height: 15.5,
    description: "Place this long black plate on the left of the first reference chafing dish. The reference has 3 tongs on this plate; no particular food is assigned to them.",
  },
  {
    id: "chafer-one-right-utensil-plate", label: "First chafing dish — right black utensil plate", stationId: "chafer-one", left: 61.8, top: 29.5, width: 11.6, height: 15.5,
    description: "Place this long black plate on the right of the first reference chafing dish. Keep 3 tongs on this side as shown in the reference.",
  },
  {
    id: "chafer-two-left-utensil-plate", label: "Second chafing dish — left black utensil plate", stationId: "chafer-two", left: 26.1, top: 51.1, width: 11.5, height: 15.8,
    description: "Place this long black plate on the left of the second reference chafing dish. The reference has 2 tongs on this plate, without assigning their food contents.",
  },
  {
    id: "chafer-two-right-utensil-plate", label: "Second chafing dish — right black utensil plate", stationId: "chafer-two", left: 63, top: 51.1, width: 12, height: 15.8,
    description: "Place this long black plate on the right of the second reference chafing dish. Keep 2 tongs on this side as shown in the reference.",
  },
  {
    id: "sauce-plate", label: "Long black sauce plate", stationId: "sauces", left: 31.1, top: 70.9, width: 37.7, height: 6.1,
    description: "Place this long black plate after the second reference chafing dish, with 3 spoons. The reference does not identify sauce contents or purchased sauce quantities.",
  },
  {
    id: "dessert-riser", label: "Clear dessert riser", stationId: "dessert", left: 30.6, top: 80, width: 39, height: 11.3,
    description: "This small clear riser supports the dessert platter at the far end of the serving line. Its pictured size does not confirm physical fit or required clearances.",
  },
  {
    id: "plate-stack-left", label: "Left plate stack", stationId: "service-cart", left: 29.4, top: 8.4, width: 15.6, height: 8.4,
    description: "Place a stack of plates on this side of the marble carts before the food line. The plate quantity is not calculated from the illustration.",
  },
  {
    id: "plate-stack-right", label: "Right plate stack", stationId: "service-cart", left: 55.2, top: 8.4, width: 15.6, height: 8.4,
    description: "Provide plates on the other side of the marble carts as well, so guests can collect their supplies from both sides.",
  },
  {
    id: "napkins-left", label: "Left napkins", stationId: "service-cart", left: 33.4, top: 1.8, width: 8.3, height: 6.4,
    description: "Place napkins with the serving supplies on this side of the carts. The reference calls for napkins accessible from each side.",
  },
  {
    id: "napkins-right", label: "Right napkins", stationId: "service-cart", left: 59, top: 1.8, width: 8.5, height: 6.4,
    description: "Place napkins on this side of the carts too, within reach of guests collecting their plates and forks.",
  },
  {
    id: "fork-caddy", label: "Fork caddy", stationId: "service-cart", left: 46.2, top: 3.9, width: 7.5, height: 11.6,
    description: "The central caddy holds the guest forks. Keep forks accessible from each side of the two marble serving carts.",
  },
  {
    id: "chafer-one", label: "First chafing dish", stationId: "chafer-one", left: 39.8, top: 26.8, width: 20.7, height: 19,
    description: "The first reference chafing dish follows the serving carts, with a black utensil plate on each side. Use the event’s calculated equipment count separately; this picture does not assign pan contents or food quantities.",
  },
  {
    id: "chafer-two", label: "Second chafing dish", stationId: "chafer-two", left: 39, top: 47.7, width: 22.4, height: 20.5,
    description: "The second reference chafing dish follows the first, with its own black utensil plate on each side. The reference does not replace the event’s calculated equipment count or identify which foods go in the pans.",
  },
  {
    id: "dessert-platter", label: "Raised black dessert platter", stationId: "dessert", left: 32.6, top: 78.8, width: 35, height: 9.6,
    description: "Place the black dessert platter on the clear riser at the far end, with 2 tongs. The picture does not change the purchased dessert quantity or specify individual dessert contents.",
  },
  {
    id: "chafer-one-left-tongs-upper", label: "First chafing dish — left upper tongs", stationId: "chafer-one", left: 28, top: 31, width: 9.7, height: 3.8,
    description: "The upper of the 3 tongs on the first chafing dish’s left black plate. The reference specifies the tool position, not the food it serves.",
  },
  {
    id: "chafer-one-left-tongs-middle", label: "First chafing dish — left middle tongs", stationId: "chafer-one", left: 27.8, top: 35.1, width: 9.7, height: 3.5,
    description: "The middle of the 3 tongs on the first chafing dish’s left black plate. Keep all 3 tongs at that reference station.",
  },
  {
    id: "chafer-one-left-tongs-lower", label: "First chafing dish — left lower tongs", stationId: "chafer-one", left: 27.6, top: 39.4, width: 9.7, height: 3.8,
    description: "The lower of the 3 tongs on the first chafing dish’s left black plate. Check the actual food before assigning a serving tool.",
  },
  {
    id: "chafer-one-right-tongs-upper", label: "First chafing dish — right upper tongs", stationId: "chafer-one", left: 62.7, top: 31, width: 9.7, height: 3.8,
    description: "The upper of the 3 tongs on the first chafing dish’s right black plate. The reference does not assign a particular food to these tongs.",
  },
  {
    id: "chafer-one-right-tongs-middle", label: "First chafing dish — right middle tongs", stationId: "chafer-one", left: 63.1, top: 35.1, width: 9.7, height: 3.6,
    description: "The middle of the 3 tongs on the first chafing dish’s right black plate. Keep these tools together at the first station.",
  },
  {
    id: "chafer-one-right-tongs-lower", label: "First chafing dish — right lower tongs", stationId: "chafer-one", left: 63.2, top: 39.3, width: 9.7, height: 4.1,
    description: "The lower of the 3 tongs on the first chafing dish’s right black plate. Its position is a reference, not a food-quantity calculation.",
  },
  {
    id: "chafer-two-left-tongs-upper", label: "Second chafing dish — left upper tongs", stationId: "chafer-two", left: 27, top: 53.5, width: 10, height: 5.2,
    description: "One of the 2 tongs on the second chafing dish’s left black plate. Keep it with the other tongs on this side of the second station.",
  },
  {
    id: "chafer-two-left-tongs-lower", label: "Second chafing dish — left lower tongs", stationId: "chafer-two", left: 26.8, top: 59.8, width: 10, height: 4.8,
    description: "The second tongs on the second chafing dish’s left black plate. The reference identifies its location without assigning a food.",
  },
  {
    id: "chafer-two-right-tongs-upper", label: "Second chafing dish — right upper tongs", stationId: "chafer-two", left: 63.8, top: 53.5, width: 10, height: 5.2,
    description: "One of the 2 tongs on the second chafing dish’s right black plate. Keep both tongs at that reference station.",
  },
  {
    id: "chafer-two-right-tongs-lower", label: "Second chafing dish — right lower tongs", stationId: "chafer-two", left: 63.8, top: 59.7, width: 10, height: 4.8,
    description: "The second tongs on the second chafing dish’s right black plate. Select serving tools for the actual food separately from this illustration.",
  },
  {
    id: "sauce-spoon-left", label: "Sauce plate — left spoon", stationId: "sauces", left: 33.4, top: 71.5, width: 11, height: 4.4,
    description: "The left of the 3 spoons on the long black sauce plate. The reference does not specify which sauce this spoon serves.",
  },
  {
    id: "sauce-spoon-center", label: "Sauce plate — center spoon", stationId: "sauces", left: 44.5, top: 71.5, width: 10.5, height: 4.4,
    description: "The center of the 3 spoons on the long black sauce plate. Confirm the actual sauce contents rather than inferring them from the picture.",
  },
  {
    id: "sauce-spoon-right", label: "Sauce plate — right spoon", stationId: "sauces", left: 55.4, top: 71.5, width: 10.5, height: 4.4,
    description: "The right of the 3 spoons on the long black sauce plate. Keep all 3 spoons together at this reference station.",
  },
  {
    id: "dessert-tongs-left", label: "Dessert platter — left tongs", stationId: "dessert", left: 39, top: 80.4, width: 9.4, height: 6,
    description: "One of the 2 tongs kept with the raised dessert platter. The illustration does not set the purchased dessert quantity or assign a dessert type.",
  },
  {
    id: "dessert-tongs-right", label: "Dessert platter — right tongs", stationId: "dessert", left: 53, top: 80.4, width: 9.5, height: 6,
    description: "The second of the 2 tongs kept with the raised dessert platter. Keep both tongs with the platter at the far end of the serving line.",
  },
];

/** Hotspots authored against the inspected 1024 × 1536 one-chafer reference. */
export const APPETIZER_WING_BAR_SETUP_OBJECTS: readonly SetupReferenceObject[] = [
  {
    id: "buffet-table", label: "Buffet table", stationId: "bar-chafer", left: 15.8, top: 26.5, width: 69, height: 72.5,
    description: "The 8 ft × 3 ft buffet table supports the reference serving line. Its measured size does not confirm physical fit or the equipment clearances.",
  },
  {
    id: "marble-cart-left", label: "Left marble serving cart", stationId: "service-cart", left: 26.8, top: 6.8, width: 23.2, height: 19.6,
    description: "One of the two 21.5 × 15.5 inch marble serving carts at the start of this serving line. Arrange the carts side by side with supplies accessible from each side.",
  },
  {
    id: "marble-cart-right", label: "Right marble serving cart", stationId: "service-cart", left: 50.2, top: 6.8, width: 23.2, height: 19.6,
    description: "The second marble cart sits beside the first. Together the carts have a 21.5 × 31 inch footprint; confirm access and clearances separately.",
  },
  {
    id: "chafer-left-utensil-plate", label: "Left black utensil plate", stationId: "bar-chafer", left: 25.4, top: 38.1, width: 12.6, height: 19.5,
    description: "Place a long black plate on the left of the single reference serving chafing dish, with 3 tongs on this plate. The reference does not assign their food contents.",
  },
  {
    id: "chafer-right-utensil-plate", label: "Right black utensil plate", stationId: "bar-chafer", left: 62.3, top: 38.1, width: 13.1, height: 19.5,
    description: "Place a long black plate on the right of the single reference serving chafing dish, with 3 tongs on this plate as well. Keep these tools together at this station.",
  },
  {
    id: "sauce-plate", label: "End-of-table black sauce plate", stationId: "bar-sauces", left: 27.8, top: 79.9, width: 44.1, height: 9.1,
    description: "Place this long black plate at the end of the table with 3 sauce containers and 3 spoons. Check the contract for sauce contents; pictured tools do not change purchased quantities.",
  },
  {
    id: "plate-stack-left", label: "Left plate stack", stationId: "service-cart", left: 29.9, top: 8.3, width: 15, height: 8.5,
    description: "Place plates on this side of the marble carts for guests collecting their serving supplies. The illustration does not calculate the number of plates to provide.",
  },
  {
    id: "plate-stack-right", label: "Right plate stack", stationId: "service-cart", left: 55.2, top: 8.3, width: 15.8, height: 8.5,
    description: "Provide a plate stack on the other side of the marble carts too. Keep supplies reachable from each side of the serving line.",
  },
  {
    id: "napkins-left", label: "Left napkins", stationId: "service-cart", left: 33.5, top: 1.8, width: 8.1, height: 6.7,
    description: "Keep napkins with the serving supplies on this side of the carts, accessible to guests collecting plates and forks.",
  },
  {
    id: "napkins-right", label: "Right napkins", stationId: "service-cart", left: 59.1, top: 1.8, width: 8.1, height: 6.7,
    description: "Provide napkins on the opposite side of the carts too, so guests can collect supplies from either side of the serving line.",
  },
  {
    id: "fork-caddy", label: "Fork caddy", stationId: "service-cart", left: 46.2, top: 3.9, width: 7.6, height: 11.7,
    description: "The central caddy holds the guest forks. Place it where forks are accessible from each side of the two marble serving carts.",
  },
  {
    id: "bar-chafer", label: "Bar serving chafing dish", stationId: "bar-chafer", left: 39, top: 36.4, width: 22.3, height: 21.8,
    description: "This single serving chafing dish belongs to the basic reference line. Use the event’s calculated equipment separately; the picture does not assign pan contents, additional platters or all prepared-pan containers.",
  },
  {
    id: "sauce-container-left", label: "Left sauce container", stationId: "bar-sauces", left: 32.5, top: 80, width: 7.8, height: 5.2,
    description: "The left of the 3 sauce containers on the end-of-table plate. Use the contract to identify its contents; the empty pictured container does not select a sauce.",
  },
  {
    id: "sauce-container-center", label: "Center sauce container", stationId: "bar-sauces", left: 45.5, top: 80, width: 7.8, height: 5.2,
    description: "The center of the 3 sauce containers on the long black plate. Its sauce contents and purchased quantity must come from the contract, not the illustration.",
  },
  {
    id: "sauce-container-right", label: "Right sauce container", stationId: "bar-sauces", left: 58.6, top: 80, width: 8, height: 5.2,
    description: "The right of the 3 sauce containers on the end plate. Confirm the actual sauce from the contract and keep a serving spoon at each container.",
  },
  {
    id: "chafer-left-tongs-upper", label: "Left chafing-dish tongs — upper", stationId: "bar-chafer", left: 27.1, top: 40.1, width: 10, height: 4.5,
    description: "The upper of the 3 tongs on the left black plate beside the reference chafing dish. The reference locates the tool without assigning a food to it.",
  },
  {
    id: "chafer-left-tongs-middle", label: "Left chafing-dish tongs — middle", stationId: "bar-chafer", left: 27, top: 45.1, width: 9.8, height: 4.7,
    description: "The middle of the 3 tongs on the left black plate. Keep all 3 tongs together beside the single reference serving chafing dish.",
  },
  {
    id: "chafer-left-tongs-lower", label: "Left chafing-dish tongs — lower", stationId: "bar-chafer", left: 26.4, top: 50.7, width: 10.1, height: 4.8,
    description: "The lower of the 3 tongs on the left black plate. Select its actual food use separately from the reference placement.",
  },
  {
    id: "chafer-right-tongs-upper", label: "Right chafing-dish tongs — upper", stationId: "bar-chafer", left: 63.5, top: 40.2, width: 9.3, height: 4.4,
    description: "The upper of the 3 tongs on the right black plate beside the reference chafing dish. The illustration does not decide which food it serves.",
  },
  {
    id: "chafer-right-tongs-middle", label: "Right chafing-dish tongs — middle", stationId: "bar-chafer", left: 63.8, top: 45.2, width: 9.3, height: 4.6,
    description: "The middle of the 3 tongs on the right black plate. Keep the reference tools together at this serving station.",
  },
  {
    id: "chafer-right-tongs-lower", label: "Right chafing-dish tongs — lower", stationId: "bar-chafer", left: 64.4, top: 50.7, width: 9.4, height: 4.9,
    description: "The lower of the 3 tongs on the right black plate. Its pictured location is a guide, not a calculated food or prep quantity.",
  },
  {
    id: "sauce-spoon-left", label: "Left sauce spoon", stationId: "bar-sauces", left: 32.1, top: 84, width: 11, height: 3.9,
    description: "One of the 3 spoons on the end-of-table sauce plate, paired with the left sauce container. Confirm its actual sauce from the contract.",
  },
  {
    id: "sauce-spoon-center", label: "Center sauce spoon", stationId: "bar-sauces", left: 45.4, top: 84, width: 10.9, height: 3.9,
    description: "One of the 3 spoons on the end-of-table sauce plate, paired with the center container. The reference does not select its sauce contents.",
  },
  {
    id: "sauce-spoon-right", label: "Right sauce spoon", stationId: "bar-sauces", left: 59, top: 84, width: 10.9, height: 3.9,
    description: "The third sauce spoon on the end-of-table plate, paired with the right container. Keep one spoon available for each of the 3 containers.",
  },
];
