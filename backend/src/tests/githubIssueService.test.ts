import assert from "node:assert/strict";
import { isValidGitHubRepository } from "../services/githubIssueService.js";

assert.equal(isValidGitHubRepository("devion-systems/ai-customer-support"), true);
assert.equal(isValidGitHubRepository("org.with-dots/repo_with-dashes"), true);
assert.equal(isValidGitHubRepository("https://github.com/org/repo"), false);
assert.equal(isValidGitHubRepository("org/repo/extra"), false);
assert.equal(isValidGitHubRepository("org repo"), false);
assert.equal(isValidGitHubRepository(""), false);
console.log("GitHub repository validation: 6 cases passed.");
