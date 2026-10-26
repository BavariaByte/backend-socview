import mongoose from "mongoose";
import { UserModel } from "@girp/database-models";

/**
 * Converts a User mongoose document into the API payload shape.
 */
export function mapUser(doc) {
  if (!doc) return null;
  const createdAt = doc.createdAt instanceof Date ? doc.createdAt.toISOString() : doc.createdAt;
  const updatedAt = doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : doc.updatedAt;
  return {
    id: doc._id ? doc._id.toString() : undefined,
    userid: doc.userid,
    sso_provider: doc.sso_provider,
    username: doc.username,
    e_mail: doc.e_mail,
    image: doc.image,
    roles: Array.isArray(doc.roles) ? doc.roles : [],
    createdAt,
    updatedAt,
  };
}

/**
 * Resolves a user by Mongo ObjectId or by userid when the string is non-ObjectId.
 */
export async function findUserByIdentifier(identifier) {
  if (!identifier) return null;
  if (mongoose.Types.ObjectId.isValid(identifier)) {
    const byId = await UserModel.findById(identifier);
    if (byId) return byId;
  }
  return UserModel.findOne({ userid: identifier });
}

export function ensureRolesArray(roles) {
  if (!Array.isArray(roles)) return null;
  if (!roles.every((role) => typeof role === "string" && role.trim().length > 0)) {
    return null;
  }
  return roles;
}
