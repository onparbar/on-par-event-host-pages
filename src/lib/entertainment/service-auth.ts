import { createHash, timingSafeEqual } from "node:crypto";

export function entertainmentServiceAuthorized(
  request: Request,
  env: NodeJS.ProcessEnv = process.env,
) {
  const configured = env.ENTERTAINMENT_SCHEDULE_API_TOKEN?.trim() ?? "";
  const supplied = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1].trim() ?? "";
  return configured.length > 0 && supplied.length > 0 && timingSafeEqual(
    createHash("sha256").update(configured).digest(),
    createHash("sha256").update(supplied).digest(),
  );
}
