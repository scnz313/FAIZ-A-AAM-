import { z } from "zod";

/**
 * Staff access profile codes (provisioning presets, never an authorization
 * shortcut). The signed-in product exposes exactly two staff portals:
 * Administrator and Principal. Teachers remain non-login school records for
 * timetable and subject attribution; they do not receive a portal profile.
 */
export const STAFF_PROFILE_CODES = ["administrator", "principal"] as const;
export const staffProfileCodeSchema = z.enum(STAFF_PROFILE_CODES);
export type StaffProfileCode = z.infer<typeof staffProfileCodeSchema>;
