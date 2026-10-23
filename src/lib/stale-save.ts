/** A saved revision changed after the editor loaded it. Never retry blindly. */
export class StaleSaveError extends Error {
  readonly status = 409;

  constructor(message = "Another staff member saved a newer version. Your draft has been kept. Reload and review the latest version before saving again.") {
    super(message);
    this.name = "StaleSaveError";
  }
}
