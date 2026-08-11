import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
const destinationArgument = process.argv[2];

if (!destinationArgument) {
  throw new Error("Provide an empty destination directory.");
}

const destination = path.resolve(destinationArgument);
const relativeDestination = path.relative(projectRoot, destination);

if (
  destination === projectRoot ||
  relativeDestination === "" ||
  (!relativeDestination.startsWith("..") && !path.isAbsolute(relativeDestination))
) {
  throw new Error("The sanitized Production bundle must be created outside the project.");
}

const allowlist = [
  ".vercel/project.json",
  "next-env.d.ts",
  "next.config.ts",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "vercel.json",
  "deploy/sanitized-production",
  "public/brand",
  "public/entertainment-schedules",
  "public/floor-plans",
  "public/itinerary-assets",
  "public/itinerary-pdfs",
  "src/app",
  "src/lib/admin-auth.ts",
  "src/lib/admin-operations-loader.ts",
  "src/lib/admin-operations.ts",
  "src/lib/admin-state.ts",
  "src/lib/admin-types.ts",
  "src/lib/checklist-events.ts",
  "src/lib/checklist-model.ts",
  "src/lib/checklist-storage.ts",
  "src/lib/entertainment",
  "src/lib/event-format.ts",
  "src/lib/event-lifecycle.ts",
  "src/lib/event-plans",
  "src/lib/floor-plans",
  "src/lib/itineraries",
  "src/lib/events.ts",
  "src/lib/kitchen",
  "src/lib/vip-prep",
  "src/lib/legacy-proxy.ts",
  "src/proxy.ts",
];

await mkdir(destination);

function isProductionSource(sourcePath) {
  return !sourcePath.split(path.sep).includes("__tests__");
}

for (const relativePath of allowlist) {
  const sourcePath = path.join(projectRoot, relativePath);
  const destinationPath = path.join(destination, relativePath);
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await cp(sourcePath, destinationPath, {
    recursive: true,
    filter: isProductionSource,
  });
}

const eventPlanSource = JSON.parse(
  await readFile(path.join(projectRoot, "public/data/event-plan-data.json"), "utf8"),
);
const eventPlanDestination = path.join(
  destination,
  "public/data/event-plan-data.json",
);
const sanitizedEventPlan = {
  date_range: eventPlanSource.date_range,
  events: eventPlanSource.events.map(
    ({
      id,
      name,
      date,
      day,
      time,
      guest_count,
      rooms,
      color,
      food,
      drink_options,
      entertainment,
      verification_status,
      special_instructions,
    }) => ({
      id,
      name,
      date,
      day,
      time,
      guest_count,
      rooms,
      color,
      food,
      drink_options,
      entertainment,
      verification_status,
      special_instructions,
    }),
  ),
};

await mkdir(path.dirname(eventPlanDestination), { recursive: true });
await writeFile(
  eventPlanDestination,
  `${JSON.stringify(sanitizedEventPlan, null, 2)}\n`,
);

console.log(`Prepared sanitized Production bundle at ${destination}`);
console.log(
  `Copied ${allowlist.length} allowlisted paths plus sanitized event data.`,
);
