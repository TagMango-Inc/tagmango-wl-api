import { Hono } from 'hono';

const router = new Hono();

router.post('/login', async (c) => {
  return c.json({
    message: 'Login',
  });
});

export default router;
