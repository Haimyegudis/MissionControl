// /api/reminders — log-work reminder config (GET current, PUT apply).
// Applying writes reminders.json and creates/removes the Windows scheduled
// task, so the toast fires even when the app and server are closed.

import { Router } from 'express';
import { applyReminderConfig, loadReminderConfig } from '../reminders.js';

export function reminderRoutes(): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json(loadReminderConfig());
  });

  router.put('/', (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { config, error } = applyReminderConfig(body);
    if (error) {
      res.status(500).json({ ...config, error });
      return;
    }
    res.json(config);
  });

  return router;
}
