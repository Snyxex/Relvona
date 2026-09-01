import { Router } from "express";
import { AuthService } from "../services/authService.js";
import { authenticate, AuthRequest } from "../middleware/auth.js";

const router = Router();

// POST /api/v1/auth/register
router.post("/register", async (req, res) => {
  try {
    const { name, email, password, orgName } = req.body;

    if (!name || !email || !password || !orgName) {
      return res.status(400).json({ error: "Missing required fields: name, email, password, orgName" });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const result = await AuthService.registerUser({ name, email, password, orgName });
    return res.status(201).json(result);
  } catch (error) {
    return res.status(400).json({ error: (error as Error).message });
  }
});

// POST /api/v1/auth/login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const result = await AuthService.loginUser({ email, password });
    return res.json(result);
  } catch (error) {
    return res.status(401).json({ error: (error as Error).message });
  }
});

// GET /api/v1/auth/me
router.get("/me", authenticate, async (req: AuthRequest, res) => {
  return res.json({ user: req.user });
});

export default router;
