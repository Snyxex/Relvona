import assert from "node:assert/strict";
import { ProfileAvatarService } from "../services/profileAvatarService.js";

const userId = "11111111-1111-4111-8111-111111111111";
const objectId = "22222222-2222-4222-8222-222222222222";
const key = `users/${userId}/avatar/${objectId}/original`;
const reference = `storage://${key}`;

assert.equal(ProfileAvatarService.isStorageReference(reference), true);
assert.equal(ProfileAvatarService.keyFromReference(reference), key);
assert.equal(ProfileAvatarService.isStorageReference("https://example.com/avatar.png"), false);
assert.equal(ProfileAvatarService.isStorageReference("data:image/png;base64,AAAA"), false);

for (const invalid of [
  "storage://../secrets",
  `storage://users/${userId}/avatar/../../secrets`,
  `storage://organizations/${userId}/avatar/${objectId}/original`,
  `storage://users/${userId}/avatar/not-a-uuid/original`,
]) {
  assert.throws(() => ProfileAvatarService.keyFromReference(invalid), /AVATAR_REFERENCE_INVALID/);
}

console.log("Profile avatar storage reference tests passed");
