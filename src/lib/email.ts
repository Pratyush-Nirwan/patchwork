import { sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { AppError } from "./errors";

/**
 * Normalizes an email address:
 * - Trims leading and trailing whitespace
 * - Converts to lower case
 */
export function normalizeEmail(email: unknown): string {
  if (typeof email !== "string") return "";
  return email.trim().toLowerCase();
}

/**
 * Validates standard email format:
 * - Contains non-empty local-part and domain-part separated by @
 * - No internal whitespace
 * - Domain has at least one dot with alphanumeric labels
 */
export function isValidEmailFormat(email: unknown): boolean {
  if (typeof email !== "string") return false;
  const normalized = email.trim();
  if (!normalized || normalized.length > 254) return false;
  // Standard RFC 5322 regex pattern for production email validation
  const emailRegex =
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  return emailRegex.test(normalized);
}

/**
 * Error returned when an email is already in use by another user.
 * HTTP 409 with { error: "email_taken", field: "email" }
 */
export class EmailTakenError extends AppError {
  public readonly field: string = "email";
  public readonly usedBy?: string;

  constructor(message: string, usedBy?: string) {
    super(message, 409, "email_taken");
    this.name = "EmailTakenError";
    this.usedBy = usedBy;
  }
}

/**
 * Check if a normalized email is already used by a user in the database.
 * If excludeUserId is provided, matching that specific user is not considered a collision
 * (allows users/employees to re-save with their own email).
 */
export async function checkEmailAvailability(
  rawEmail: string,
  excludeUserId?: string | null
): Promise<{
  available: boolean;
  normalized: string;
  usedBy?: string;
  userId?: string;
}> {
  const normalized = normalizeEmail(rawEmail);
  if (!normalized) {
    return { available: false, normalized };
  }

  const [existing] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
    })
    .from(users)
    .where(sql`lower(${users.email}) = lower(${normalized})`)
    .limit(1);

  if (!existing) {
    return { available: true, normalized };
  }

  if (excludeUserId && existing.id === excludeUserId) {
    return { available: true, normalized, userId: existing.id, usedBy: existing.name };
  }

  return {
    available: false,
    normalized,
    usedBy: existing.name,
    userId: existing.id,
  };
}
